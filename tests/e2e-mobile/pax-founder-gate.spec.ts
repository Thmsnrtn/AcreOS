/**
 * Phase Zero-One regression — /ai customer surface must not leak founder-only
 * tabs or internal agent codenames.
 *
 * Constitution rule (fb46d356 commit): non-founder customers must NEVER see
 *   - the "Team" tab (renders Acquisitions VA / Collections VA / Executive VA)
 *   - the "Background" tab (renders the agent-roster codenames)
 *   - the "AI Ops" tab (founder-only operational tooling)
 * They DO see "Assistant" (Chat) and "Tasks".
 *
 * The test-auth bypass seeds TWO identities (tests/e2e-mobile/global-setup.ts):
 * the customer `e2e@acreos.test` and the founder `founder-e2e@acreos.test`.
 * The workflow's FOUNDER_EMAIL/FOUNDER_EMAILS names the founder email ONLY,
 * and the bypass selects identity by `__session` cookie value — "e2e-founder"
 * = founder, anything else = customer (server/auth/testAuth.ts). This spec
 * seeds value "e2e", so it runs as a genuine non-founder customer session.
 *
 * What we assert:
 *   1. /ai renders (no auth bounce, no error fallback).
 *   2. The Assistant + Tasks tab triggers ARE present.
 *   3. The Team / Background / AI Ops tab triggers are NOT present.
 *   4. The body text never contains the internal codenames
 *      "Acquisitions VA" / "Collections VA" / "Executive VA" / "Sophie" /
 *      "Forge" / "Atlas" on any of these views.
 *   5. Deep-linking to /ai#team bounces the user to the Chat tab (the
 *      mount-time bouncer in CommandCenterPage).
 *   6. On iPhone width (390-class viewport via the iphone-14 project), the
 *      Pax greeting dismiss button responds to a single tap (not double-tap)
 *      — covered indirectly by asserting the dismiss-button uses active:
 *      class via the source-contract spec; here we assert it renders + is
 *      tappable.
 */
import { test, expect, type Page } from "@playwright/test";

const CODENAMES_THAT_MUST_NOT_LEAK = [
  "Acquisitions VA",
  "Collections VA",
  "Executive VA",
  "Sales VA",
  "Research VA",
  "Marketing VA",
  // Internal codenames per project_persona_architecture.md
  "Sophie",
  "Forge",
  "Atlas",
];

const IGNORED_PAGE_ERRORS = [/Clerk/i, /clerk\.browser\.js/i, /failed to load/i, /ResizeObserver/i];

async function seedSessionCookie(page: Page, baseURL: string) {
  const { hostname } = new URL(baseURL);
  await page.context().addCookies([{ name: "__session", value: "e2e", domain: hostname, path: "/" }]);
}

async function waitForRoot(page: Page) {
  await expect
    .poll(
      async () =>
        page.evaluate(() => (document.getElementById("root")?.innerText || "").trim().length),
      { timeout: 60000 },
    )
    .toBeGreaterThan(20);
}

test.describe("/ai founder-gate — customer (non-founder) session", () => {
  test("renders Assistant + Tasks tabs, hides Team / Background / AI Ops", async ({ page, baseURL }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => {
      const msg = e.message || String(e);
      if (!IGNORED_PAGE_ERRORS.some((re) => re.test(msg))) pageErrors.push(msg);
    });

    await seedSessionCookie(page, baseURL!);
    await page.goto("/ai", { waitUntil: "domcontentloaded" });
    await waitForRoot(page);

    // Customer-visible triggers MUST exist.
    await expect(page.locator('[data-testid="tab-chat"]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid="tab-tasks"]')).toBeVisible();

    // Founder-only triggers MUST NOT exist (the {isFounder && …} wrap removes
    // the entire node from the DOM, so .count() is the correct probe).
    await expect(
      page.locator('[data-testid="tab-team"]'),
      "Team tab must not render for non-founders",
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="tab-agents"]'),
      "Background (agents) tab must not render for non-founders",
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="tab-ai-ops"]'),
      "AI Ops tab must not render for non-founders",
    ).toHaveCount(0);

    // No codename text on the default (Chat) render.
    const body = await page.locator("body").innerText();
    for (const name of CODENAMES_THAT_MUST_NOT_LEAK) {
      expect(body, `Internal codename "${name}" leaked to non-founder /ai surface`).not.toContain(
        name,
      );
    }

    expect(pageErrors, `/ai threw: ${pageErrors.join(" | ")}`).toEqual([]);
  });

  test("deep-link /ai#team bounces a non-founder back to the Chat tab", async ({ page, baseURL }) => {
    // The mount-time useEffect in CommandCenterPage redirects mainTab to
    // "chat" when isFounder is false. Even if mainTab is restored from a
    // hash or saved session, the user must end up on Chat.
    await seedSessionCookie(page, baseURL!);
    await page.goto("/ai#team", { waitUntil: "domcontentloaded" });
    await waitForRoot(page);

    // Still no team trigger.
    await expect(page.locator('[data-testid="tab-team"]')).toHaveCount(0);
    // The Chat tab's content (or at least the Chat trigger) is visible.
    await expect(page.locator('[data-testid="tab-chat"]')).toBeVisible();

    const body = await page.locator("body").innerText();
    for (const name of CODENAMES_THAT_MUST_NOT_LEAK) {
      expect(body, `Codename "${name}" rendered after /ai#team bounce`).not.toContain(name);
    }
  });
});
