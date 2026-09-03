/**
 * Phase Zero-One regression — /ai customer surface must not leak founder-only
 * tabs or internal agent codenames.
 *
 * Constitution rule (fb46d356 commit): non-founder customers must NEVER see
 *   - the "Team" tab (renders Acquisitions VA / Collections VA / Executive VA)
 *   - the "Background" tab (renders the agent-roster codenames)
 *   - the "AI Ops" tab (founder-only operational tooling)
 *
 * Pax controls program (2026-09-02, docs/autonomous/AUTONOMY_SPEC.md §3b):
 * customers see the conversation ALONE. The old "Tasks" tab (a dead-letter
 * queue with an invented "$0.02 per task" price) is deleted for everyone, so
 * assertion 2 is now "Tasks tab ABSENT" — the mutation that must go red is
 * rendering that tab again.
 *
 * The test-auth bypass seeds TWO identities (tests/e2e-mobile/global-setup.ts):
 * the customer `e2e@acreos.test` and the founder `founder-e2e@acreos.test`.
 * The workflow's FOUNDER_EMAIL/FOUNDER_EMAILS names the founder email ONLY,
 * and the bypass selects identity by `__session` cookie value — "e2e-founder"
 * = founder, anything else = customer (server/auth/testAuth.ts). This spec
 * seeds value "e2e", so it runs as a genuine non-founder customer session.
 *
 * What we assert:
 *   1. /ai renders (no auth bounce, no error fallback): the composer is there.
 *   2. The Tasks tab trigger is ABSENT (and its invented price with it).
 *   3. The Team / Background / AI Ops tab triggers are NOT present.
 *   4. The body text never contains the internal codenames
 *      "Acquisitions VA" / "Collections VA" / "Executive VA" / "Sophie" /
 *      "Forge" / "Atlas" on any of these views.
 *   5. Deep-linking to /ai#team bounces the user to the conversation (the
 *      mount-time bouncer in CommandCenterPage).
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

const IGNORED_PAGE_ERRORS = [
  /Clerk/i,
  /clerk\.browser\.js/i,
  /failed to load/i,
  /ResizeObserver/i,
  // WebKit-in-CI fetch-abort noise: WebKit reports aborted same-origin
  // fetches (page teardown / rapid nav) as "…due to access control checks."
  // while the server log shows the request completed 200. Not a CORS or
  // app bug — same rationale as customer-surface-journeys.spec.ts.
  /due to access control checks/i,
  /\bsw\.js\b/i,
];

async function seedSessionCookie(page: Page, baseURL: string) {
  const { hostname } = new URL(baseURL);
  await page.context().addCookies([{ name: "__session", value: "e2e", domain: hostname, path: "/" }]);
  // Returning-user consent state — keeps the first-visit cookie banner
  // (fixed z-40 over the bottom strip) from intercepting taps. Same
  // rationale + incident as customer-surface-journeys.spec.ts.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("acreos_cookie_consent", "declined");
    } catch {
      /* storage unavailable — banner shows, test degrades visibly */
    }
  });
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
  test("renders the conversation alone: no Tasks tab, no Team / Background / AI Ops", async ({ page, baseURL }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => {
      const msg = e.message || String(e);
      if (!IGNORED_PAGE_ERRORS.some((re) => re.test(msg))) pageErrors.push(msg);
    });

    await seedSessionCookie(page, baseURL!);
    await page.goto("/ai", { waitUntil: "domcontentloaded" });
    await waitForRoot(page);

    // 1. The conversation renders: the composer is the customer's surface.
    await expect(page.locator('[data-testid="input-message"]')).toBeVisible({ timeout: 30000 });

    // 2. The Tasks tab is ABSENT for everyone (deleted, not gated). Render
    //    it again and this goes red.
    await expect(
      page.locator('[data-testid="tab-tasks"]'),
      "Tasks tab must not render — it was deleted in the Pax controls program",
    ).toHaveCount(0);
    const bodyForPrice = await page.locator("body").innerText();
    expect(bodyForPrice, "the invented per-task price must not render").not.toContain("$0.02");

    // 3. Founder-only triggers MUST NOT exist (the {isFounder && …} wrap removes
    //    the entire node from the DOM, so .count() is the correct probe).
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

    // 4. No codename text on the default render.
    const body = await page.locator("body").innerText();
    for (const name of CODENAMES_THAT_MUST_NOT_LEAK) {
      expect(body, `Internal codename "${name}" leaked to non-founder /ai surface`).not.toContain(
        name,
      );
    }

    expect(pageErrors, `/ai threw: ${pageErrors.join(" | ")}`).toEqual([]);
  });

  test("deep-link /ai#team bounces a non-founder back to the conversation", async ({ page, baseURL }) => {
    // The mount-time useEffect in CommandCenterPage redirects mainTab to
    // "chat" when isFounder is false. Even if mainTab is restored from a
    // hash or saved session, the user must end up on the conversation.
    await seedSessionCookie(page, baseURL!);
    await page.goto("/ai#team", { waitUntil: "domcontentloaded" });
    await waitForRoot(page);

    // Still no team trigger, still no Tasks trigger.
    await expect(page.locator('[data-testid="tab-team"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="tab-tasks"]')).toHaveCount(0);
    // The conversation is what renders.
    await expect(page.locator('[data-testid="input-message"]')).toBeVisible({ timeout: 30000 });

    const body = await page.locator("body").innerText();
    for (const name of CODENAMES_THAT_MUST_NOT_LEAK) {
      expect(body, `Codename "${name}" rendered after /ai#team bounce`).not.toContain(name);
    }
  });
});
