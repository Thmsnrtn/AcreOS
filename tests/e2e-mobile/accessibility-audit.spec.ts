/**
 * WCAG 2 A/AA audit of the doors — the first one that actually runs.
 *
 * WHAT THIS REPLACES. tests/e2e/accessibility.spec.ts was 262 lines titled
 * "Accessibility Audit", named in a CI job called "Accessibility Audit", and it
 * had never once checked accessibility. Six independent reasons, any one
 * sufficient:
 *
 *   1. @axe-core/playwright was never installed. Its loader was
 *      `import(...).catch(() => ({ checkA11y: null }))`, so a missing dependency
 *      returned null and every axe assertion was skipped in silence. The file's
 *      own header carried the install command that was never run.
 *   2. The CI invocation passed no storageState, so all nine "critical page"
 *      tests hit the /auth redirect and returned early by design.
 *   3. The step ended in `|| true`.
 *   4. The `accessibility` job was not in security-gate's `needs:`, so even a
 *      real failure could not have failed the pipeline.
 *   5. Its job ran `npm ci` and `playwright install` with no build and no
 *      database, so `npm run start` could not boot and the webServer timed out.
 *   6. Two of its remaining assertions were literally `expect(true).toBe(true)`,
 *      one named "color contrast passes" asserted that the page has text, and
 *      checkFocusIndicators' evaluator ended in `return true; // Default pass`.
 *
 * WHY IT LIVES HERE. tests/e2e-mobile already has what an audit needs and CI
 * already runs it blocking: a pgvector service, a real build, a seeded org, and
 * the E2E_TEST_AUTH `__session` bypass. Rebuilding that in security.yml would
 * have been a second harness to keep honest. One harness, one set of fixtures.
 *
 * WHAT IT ASSERTS.
 *   · Zero `critical` axe violations on any door. Critical means a blocking
 *     barrier — an unlabelled control, a trap, an image conveying meaning with
 *     no text alternative. There is no baseline for these: none may ship.
 *   · `serious` violations are counted and REPORTED per route, and the totals
 *     are attached to the run. They are not yet gated: a threshold invented
 *     without a measurement is the same fiction this file replaces. The
 *     follow-up commit sets the ratchet from the first real numbers.
 *   · Each page is authenticated and rendered. A door that redirects to /auth
 *     or renders no landmark FAILS — under the old spec that was the silent
 *     early-return that hid everything else.
 *
 * VACUITY. axe returning zero violations and axe never running are the same
 * green result, so every route asserts that axe evaluated a non-trivial number
 * of rules (`passes` + `violations` + `incomplete`) before believing the zero.
 */

import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { CUSTOMER_AUDIT_ROUTES, FOUNDER_DOOR_ROUTES } from "./door-routes";

/** WCAG 2.0/2.1 level A and AA — the conformance target, not "everything axe knows". */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * A page that renders nothing has no violations either. This is the floor that
 * separates "clean" from "never looked": axe evaluates ~90 rules on a real
 * document, so a run reporting a handful means the page was blank or the
 * injection failed.
 */
const MIN_RULES_EVALUATED = 20;

/**
 * The audit runs on the phone and tablet baselines rather than all six device
 * projects. Axe's findings are overwhelmingly DOM-level and repeat verbatim
 * across viewports; the two that differ are the ones where the layout itself
 * differs. Nine routes across six projects is 54 audits on a one-worker runner
 * for a handful of extra findings.
 *
 * A typo here would skip every test and report a clean run, so
 * tests/unit/accessibilityAuditIsReal.test.ts asserts this set is non-empty and
 * that every name is a real project in playwright.mobile.config.ts.
 */
const AUDIT_PROJECTS = new Set(["iphone-14", "ipad-mini"]);

async function authenticate(page: Page, session: string) {
  await page.context().addCookies([
    {
      name: "__session",
      value: session,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function settle(page: Page) {
  await page
    .locator('[data-testid="app-loading"]')
    .waitFor({ state: "detached", timeout: 20_000 })
    .catch(() => {});
  // A door is "rendered" when its main landmark exists. Waiting on this rather
  // than networkidle keeps the audit off pages that are still skeletons —
  // auditing a skeleton is how you get a clean report for an unbuilt page.
  await page
    .locator("main, [role='main']")
    .first()
    .waitFor({ state: "attached", timeout: 20_000 })
    .catch(() => {});
}

async function auditRoute(page: Page, route: string, testInfo: import("@playwright/test").TestInfo) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await settle(page);

  // The old spec treated this as a reason to skip. It is the finding: an
  // authenticated door that bounces to /auth is broken for every user of it.
  expect(
    page.url(),
    `${route} redirected to /auth — the authenticated fixture did not apply, and ` +
      "every assertion below would have been vacuous",
  ).not.toContain("/auth");

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

  const evaluated =
    results.passes.length + results.violations.length + results.incomplete.length;
  expect(
    evaluated,
    `axe evaluated only ${evaluated} rules on ${route}. Either the page did not ` +
      "render or axe never ran — a zero-violation result here means nothing.",
  ).toBeGreaterThanOrEqual(MIN_RULES_EVALUATED);

  const critical = results.violations.filter((v) => v.impact === "critical");
  const serious = results.violations.filter((v) => v.impact === "serious");

  // Annotations do not reach the list reporter's output, and a finding nobody
  // can read is a finding nobody fixes — the first run of this audit named six
  // rules across eleven doors and not one element, which made it a report you
  // could not act on. Everything goes to stdout, which CI keeps.
  const line = (v: (typeof results.violations)[number]) =>
    `    ${v.id} [${v.impact}] ×${v.nodes.length} — ${v.help}\n` +
    v.nodes
      .slice(0, 5)
      .map(
        (n) =>
          `      at ${n.target.join(" ")}\n` +
          `         ${(n.html ?? "").replace(/\s+/g, " ").slice(0, 200)}`,
      )
      .join("\n") +
    (v.nodes.length > 5 ? `\n      …and ${v.nodes.length - 5} more nodes` : "");

  // eslint-disable-next-line no-console -- test output, not server logging
  console.log(
    `[a11y] ${route} (${testInfo.project.name}): ${evaluated} rules · ` +
      `${critical.length} critical · ${serious.length} serious\n` +
      [...critical, ...serious].map(line).join("\n"),
  );

  testInfo.annotations.push({
    type: "a11y",
    description:
      `${route}: ${evaluated} rules evaluated · ${critical.length} critical · ` +
      `${serious.length} serious · ${results.violations.length} total`,
  });

  // The full JSON is attached so a baseline can be read out of the artifact
  // rather than reconstructed by eye from a log.
  await testInfo.attach(`axe-${route.replace(/\//g, "_")}.json`, {
    contentType: "application/json",
    body: Buffer.from(
      JSON.stringify(
        results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.map((n) => ({ target: n.target, html: n.html })),
        })),
        null,
        2,
      ),
    ),
  });

  expect(
    critical.map(line),
    `critical WCAG violations on ${route}. Critical means a user relying on ` +
      "assistive technology cannot complete the task at all.",
  ).toEqual([]);
}

test.describe("WCAG A/AA — the five customer doors", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      !AUDIT_PROJECTS.has(testInfo.project.name),
      "axe findings are DOM-level; the audit runs on the phone + tablet baselines",
    );
    await authenticate(page, "e2e-a11y-customer");
  });

  for (const route of CUSTOMER_AUDIT_ROUTES) {
    test(`no critical accessibility violations on ${route}`, async ({ page }, testInfo) => {
      await auditRoute(page, route, testInfo);
    });
  }
});

test.describe("WCAG A/AA — the four founder doors", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      !AUDIT_PROJECTS.has(testInfo.project.name),
      "axe findings are DOM-level; the audit runs on the phone + tablet baselines",
    );
    // The founder identity is selected by this exact cookie value — see
    // server/auth/testAuth.ts and tests/e2e-mobile/global-setup.ts.
    await authenticate(page, "e2e-founder");
  });

  for (const route of FOUNDER_DOOR_ROUTES) {
    test(`no critical accessibility violations on ${route}`, async ({ page }, testInfo) => {
      await auditRoute(page, route, testInfo);
    });
  }
});
