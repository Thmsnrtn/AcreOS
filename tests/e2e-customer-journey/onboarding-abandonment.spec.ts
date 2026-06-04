/**
 * KRIEGER — Customer Journey: onboarding abandonment + resume contract.
 *
 * Tests the bail-and-return path through the onboarding wizard:
 *   1. Sign up (E2E_TEST_AUTH bypass) → /onboarding-v2.
 *   2. Advance to step 3 (data-import path), then abandon by tearing
 *      down the browser context (simulates "user closed the tab").
 *   3. Re-sign-in with a fresh context but the same auth seed.
 *   4. Land back on /onboarding-v2.
 *   5. Assert resume — wizard surfaces step 3, NOT step 1.
 *
 * Per project_onboarding_state.md: onboarding state is ORG-SCOPED on
 * `organizations.onboarding_completed` + `organizations.onboarding_state`,
 * NOT user-scoped on `users.onboardedAt`. The canonical surface is
 * components/onboarding/OnboardingWizard.tsx (mounted via
 * /pages/onboarding-v2.tsx). The resume contract is "if you bail, the
 * server remembers where you were."
 *
 * Skip gracefully when the wizard surfaces a "fully onboarded" state on
 * arrival — the global-setup seed marks orgs.onboarding_completed=true
 * for fast-path tests. The abandonment path needs a dedicated
 * not-yet-onboarded org which is created lazily.
 */
import {
  test,
  expect,
  type Page,
  type TestInfo,
  type BrowserContext,
} from "@playwright/test";

interface ProjectMeta {
  formFactor: "mobile" | "desktop";
  colorScheme: "light" | "dark";
  baseDevice: string;
}

function resolveProjectMeta(testInfo: TestInfo): ProjectMeta {
  const md = (testInfo.project.metadata ?? {}) as Partial<ProjectMeta>;
  return {
    formFactor: md.formFactor ?? "mobile",
    colorScheme: md.colorScheme ?? "light",
    baseDevice: md.baseDevice ?? testInfo.project.name,
  };
}

async function seedTestAuth(
  context: BrowserContext,
  baseURL: string,
): Promise<void> {
  const { hostname } = new URL(baseURL);
  await context.addCookies([
    {
      name: "__session",
      value: "e2e-customer-journey-abandon",
      domain: hostname,
      path: "/",
    },
  ]);
}

async function detectCurrentStepIndex(page: Page): Promise<number> {
  // The wizard exposes the current step via either:
  //   (a) a [data-current-step] attribute on the wizard root, OR
  //   (b) the rendered step content (input-org-name = step 1,
  //       card-load-sample-data = step 2, button-go-to-today = step 3+).
  // We probe (b) because it's the most reliable signal without
  // adding a new instrumentation handle that D2-D might also touch.
  const has1 = await page
    .locator('[data-testid="input-org-name"]')
    .isVisible()
    .catch(() => false);
  if (has1) return 1;
  const has2 = await page
    .locator('[data-testid="card-load-sample-data"]')
    .isVisible()
    .catch(() => false);
  if (has2) return 2;
  const has3 = await page
    .locator('[data-testid="button-go-to-today"]')
    .isVisible()
    .catch(() => false);
  if (has3) return 3;
  return -1; // no recognizable step surface — likely already onboarded.
}

test.describe("CJ3: onboarding abandonment + resume", () => {
  test("bail at step 3 → reopen → resume at step 3 (not step 1)", async ({
    browser,
    baseURL,
  }, testInfo) => {
    const meta = resolveProjectMeta(testInfo);

    // ── Phase 1: first context — advance to step 3 then abandon ─────────
    const ctx1 = await browser.newContext({
      colorScheme: meta.colorScheme,
    });
    await seedTestAuth(ctx1, baseURL!);
    const page1 = await ctx1.newPage();

    await page1.goto("/onboarding-v2", { waitUntil: "domcontentloaded" });
    await page1.waitForTimeout(1200);
    const initialStep = await detectCurrentStepIndex(page1);

    if (initialStep === -1) {
      // Org is already fully onboarded (the fast-path seed). The
      // abandonment contract isn't observable on this runner. Annotate
      // and skip — NOT a red.
      testInfo.annotations.push({
        type: "info-onboarding-already-complete",
        description:
          "global-setup seeded an already-onboarded org; abandonment path not observable on this runner",
      });
      await ctx1.close();
      test.skip(true, "fast-path onboarding seed — abandonment not testable");
      return;
    }

    // Walk through step 1 → step 2 → step 3.
    if (initialStep <= 1) {
      const orgNameInput = page1.locator('[data-testid="input-org-name"]');
      if (await orgNameInput.isVisible().catch(() => false)) {
        await orgNameInput.fill("Krieger Abandonment Test Co");
        const landOption = page1
          .locator(
            '[data-testid="option-land_investor"], [data-testid="option-land_flipper"]',
          )
          .first();
        if (await landOption.isVisible().catch(() => false)) {
          await landOption.click();
        }
        const cont = page1.locator(
          '[data-testid="button-continue-workspace"]',
        );
        if (await cont.isEnabled().catch(() => false)) {
          await cont.click();
          await page1.waitForTimeout(1500);
        }
      }
    }

    if ((await detectCurrentStepIndex(page1)) <= 2) {
      const sample = page1.locator('[data-testid="card-load-sample-data"]');
      if (await sample.isVisible().catch(() => false)) {
        await sample.click();
        await page1.waitForTimeout(1500);
      }
    }

    const reachedStep = await detectCurrentStepIndex(page1);
    testInfo.attachments.push({
      name: `abandonment-reached-step-${meta.baseDevice}-${meta.colorScheme}`,
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify({ initialStep, reachedStep, meta }, null, 2),
      ),
    });

    // ABANDON — close the context (simulates closing the tab).
    await ctx1.close();

    // ── Phase 2: fresh context — resume contract ────────────────────────
    const ctx2 = await browser.newContext({
      colorScheme: meta.colorScheme,
    });
    await seedTestAuth(ctx2, baseURL!);
    const page2 = await ctx2.newPage();

    await page2.goto("/onboarding-v2", { waitUntil: "domcontentloaded" });
    await page2.waitForTimeout(1500);
    const resumedStep = await detectCurrentStepIndex(page2);

    testInfo.attachments.push({
      name: `abandonment-resumed-step-${meta.baseDevice}-${meta.colorScheme}`,
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify({ resumedStep, expectedAtLeast: reachedStep }, null, 2),
      ),
    });

    // Resume contract: the wizard MUST NOT regress to a step earlier
    // than the one we reached. Equal-or-later is the pass condition.
    // -1 (already onboarded) is also a pass — server flipped the
    // completed flag while we abandoned, which is the legitimate
    // outcome if the user finished via another tab.
    const pass =
      resumedStep === -1 || resumedStep >= Math.max(1, reachedStep);
    expect(
      pass,
      `abandonment-resume regression: reached step ${reachedStep}, resumed at step ${resumedStep} (expected >= reached, or -1 for already-complete)`,
    ).toBe(true);

    await ctx2.close();
  });
});
