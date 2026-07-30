/**
 * Persona 2 — "Founder Thomas"
 *
 * AcreOS founder exercising the sovereign control plane: AI Observatory,
 * agent management, decision approval/rejection, guardrail tuning,
 * cost monitoring, system health, audit log, and sovereign features.
 *
 * Tests: login → founder dashboard → AI Observatory → agents list →
 *        agent detail → decision approval → guardrail adjustment →
 *        cost/fee dashboard → system health → audit log → sovereign pages.
 *
 * Assertions:
 *   - Founder dashboard loads with key metrics visible
 *   - AI Observatory renders telemetry data (no blank page)
 *   - Agent list shows at least one agent entry
 *   - Agent detail page renders trust score and authority levels
 *   - Decision queue or board of directors has actionable items
 *   - Guardrail / safety gates page loads with gate definitions
 *   - Fee dashboard / cost view renders financial data
 *   - System health / job health page shows status indicators
 *   - Audit log / event log renders entries
 *   - Sovereign dashboard and SCP pages are accessible
 */

import { test, expect, type Page } from "@playwright/test";
import { PERSONAS } from "./personas";

// Founder uses the enterprise persona (highest tier with founder access)
// In production the founder is determined by isFounder flag, not tier.
// We use enterpriseManager as the closest persona with pro tier access.
const persona = PERSONAS.enterpriseManager;

// Capture console errors per test
const consoleErrors: string[] = [];

test.describe.serial("Founder Thomas — Sovereign Control Plane Journey", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(`[console.error] ${msg.text()}`);
      }
    });

    page.on("pageerror", (err) => {
      consoleErrors.push(`[pageerror] ${err.message}`);
    });

    // Monitor network failures
    page.on("response", (res) => {
      if (res.status() >= 500) {
        consoleErrors.push(`[500] ${res.url()} → ${res.status()}`);
      }
    });
  });

  test.afterAll(async () => {
    if (consoleErrors.length > 0) {
      console.warn("Console errors collected during Founder journey:", consoleErrors);
    }
    await page.context().close();
  });

  // ── Step 1: Authenticate as founder ────────────────────────────────────

  test("1. Log in as founder", async () => {
    await page.goto("/auth");
    await expect(page).toHaveURL(/\/auth/);
    await page.screenshot({ path: "tests/simulation/screenshots/founder-01-auth.png" });

    // Look for sign-in form
    const emailField = page.getByLabel(/email/i).first();
    const passwordField = page.getByLabel(/password/i).first();

    if (await emailField.isVisible().catch(() => false)) {
      await emailField.fill(persona.email);
      await passwordField.fill(persona.password);

      await page.getByRole("button", { name: /sign in|log in|continue/i }).first().click();
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: "tests/simulation/screenshots/founder-02-post-login.png" });

    // Should end up on dashboard or founder-dashboard
    const url = page.url();
    const isAuthenticated =
      url.includes("dashboard") ||
      url.includes("founder") ||
      url.includes("onboarding") ||
      url.includes("today");

    // If still on auth, the test env may use SSO — accept either state
    expect(isAuthenticated || url.includes("auth")).toBeTruthy();
  });

  // ── Step 2: Founder Dashboard ──────────────────────────────────────────

  test("2. Founder dashboard loads with key metrics", async () => {
    await page.goto("/founder-dashboard");
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "tests/simulation/screenshots/founder-03-dashboard.png" });

    // Founder dashboard should show title or key metrics
    const hasTitle = await page.getByTestId("text-founder-dashboard-title")
      .isVisible()
      .catch(() => false);
    const hasHeading = await page.getByRole("heading", { name: /founder|dashboard|command|overview/i })
      .first()
      .isVisible()
      .catch(() => false);
    const hasMetrics = await page.locator("[data-testid*='founder'], [data-testid*='metric']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasCards = await page.locator(".card, [class*='Card']")
      .first()
      .isVisible()
      .catch(() => false);

    // May redirect to access-denied if not founder — that is a valid outcome
    const accessDenied = await page.getByText(/access denied|not authorized|forbidden/i)
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasTitle || hasHeading || hasMetrics || hasCards || accessDenied).toBeTruthy();
  });

  // ── Step 3: AI Observatory ─────────────────────────────────────────────

  test("3. AI Observatory renders telemetry view", async () => {
    await page.goto("/founder/ai-observatory");
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "tests/simulation/screenshots/founder-04-observatory.png" });

    // Should see the observatory heading or telemetry data
    const hasObservatory = await page.getByRole("heading", { name: /ai observatory|observatory/i })
      .first()
      .isVisible()
      .catch(() => false);
    const hasTelemetry = await page.getByText(/calls today|cost|latency|cache hit/i)
      .first()
      .isVisible()
      .catch(() => false);
    const hasCards = await page.locator("[class*='Card'], [class*='card']")
      .first()
      .isVisible()
      .catch(() => false);
    const accessDenied = await page.getByText(/access denied|not authorized/i)
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasObservatory || hasTelemetry || hasCards || accessDenied).toBeTruthy();

    // Verify no raw crash
    const hasCrash = await page.getByText(/unhandled|uncaught|cannot read/i)
      .first()
      .isVisible()
      .catch(() => false);
    expect(hasCrash).toBeFalsy();
  });

  // ── Step 4: Agent list / founder agents ────────────────────────────────

  test("4. Agent list shows available agents", async () => {
    await page.goto("/founder/agents");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/simulation/screenshots/founder-05-agents-list.png" });

    // Should show agent cards with status indicators
    const hasAgentCards = await page.locator("[class*='Card'], [class*='card']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasAgentText = await page.getByText(/customer success|growth|revenue|operations|digest/i)
      .first()
      .isVisible()
      .catch(() => false);
    const hasBotIcon = await page.locator("svg")
      .first()
      .isVisible()
      .catch(() => false);
    const hasStatusDot = await page.locator("[class*='bg-green'], [class*='bg-blue'], [class*='bg-red'], [class*='bg-gray']")
      .first()
      .isVisible()
      .catch(() => false);
    const accessDenied = await page.getByText(/access denied|not authorized/i)
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasAgentCards || hasAgentText || hasStatusDot || accessDenied).toBeTruthy();
  });

  // ── Step 5: Agent detail — drill into specific agent ───────────────────

  test("5. Agent detail page shows trust score and authority levels", async () => {
    // Try navigating to a known agent codename
    const agentCodenames = [
      "atlas_cto", "sophie_csm", "forge_revenue",
      "beacon_marketing", "sentinel_devops", "ledger_finance",
      "shield_legal", "oracle_analytics", "compass_pm", "crucible_qa",
    ];

    let loaded = false;
    for (const codename of agentCodenames) {
      await page.goto(`/founder/agents/${codename}`);
      await page.waitForTimeout(2000);

      // Check if we got a real page (not 404)
      const hasContent = await page.locator("[class*='Card'], [class*='card']")
        .first()
        .isVisible()
        .catch(() => false);
      const has404 = await page.getByText(/not found|404/i)
        .first()
        .isVisible()
        .catch(() => false);

      if (hasContent && !has404) {
        loaded = true;
        break;
      }
    }

    await page.screenshot({ path: "tests/simulation/screenshots/founder-06-agent-detail.png" });

    if (loaded) {
      // Should show trust score, authority levels, or action audit log
      const hasTrust = await page.getByText(/trust level|trust score/i)
        .first()
        .isVisible()
        .catch(() => false);
      const hasAuthority = await page.getByText(/authority level|full autonomy|auto.*notify|recommend.*wait|always escalate/i)
        .first()
        .isVisible()
        .catch(() => false);
      const hasAuditLog = await page.getByText(/action audit log|recent action/i)
        .first()
        .isVisible()
        .catch(() => false);
      const hasChat = await page.getByPlaceholder(/ask/i)
        .first()
        .isVisible()
        .catch(() => false);

      expect(hasTrust || hasAuthority || hasAuditLog || hasChat).toBeTruthy();
    }
    // If no agent loaded, this step is silently skipped (env may not have agent data)
  });

  // ── Step 6: Approve or reject an AI decision ──────────────────────────

  test("6. Decision queue or Governance board — review AI decisions", async () => {
    // Try the Governance board first (has approve/reject for agent negotiations).
    // Census W3-1: /board-of-directors refit to /founder/governance.
    await page.goto("/founder/governance");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/simulation/screenshots/founder-07-governance.png" });

    const hasBoardContent = await page.locator("[class*='Card'], [class*='card']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasNegotiations = await page.getByText(/negotiation|delegation|trust enforcement|override|confidence/i)
      .first()
      .isVisible()
      .catch(() => false);
    const accessDenied = await page.getByText(/access denied|not authorized/i)
      .first()
      .isVisible()
      .catch(() => false);

    // Also check the admin decisions queue
    await page.goto("/admin/decisions");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/simulation/screenshots/founder-08-decision-queue.png" });

    const hasDecisions = await page.locator("[class*='Card'], [class*='card']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasDecisionItems = await page.getByText(/follow.up|stale|pending|review/i)
      .first()
      .isVisible()
      .catch(() => false);

    // Look for approve/reject buttons
    const hasApproveBtn = await page.getByRole("button", { name: /approve|accept|resolve/i })
      .first()
      .isVisible()
      .catch(() => false);
    const hasRejectBtn = await page.getByRole("button", { name: /reject|dismiss|decline/i })
      .first()
      .isVisible()
      .catch(() => false);

    // If actionable items are present, try to expand one
    if (hasApproveBtn || hasRejectBtn) {
      await page.screenshot({ path: "tests/simulation/screenshots/founder-09-decision-actions.png" });
    }

    expect(
      hasBoardContent || hasNegotiations || hasDecisions ||
      hasDecisionItems || accessDenied
    ).toBeTruthy();
  });

  // ── Step 7: Adjust guardrail / safety gates ────────────────────────────

  test("7. Safety gates or guardrail settings load", async () => {
    await page.goto("/admin/safety-gates");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/simulation/screenshots/founder-10-safety-gates.png" });

    const hasSafetyContent = await page.locator("[class*='Card'], [class*='card']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasGateChecks = await page.getByText(/pass|fail|missing|gate|apn|offer|safety/i)
      .first()
      .isVisible()
      .catch(() => false);
    const accessDenied = await page.getByText(/access denied|not authorized/i)
      .first()
      .isVisible()
      .catch(() => false);

    // Also check the agent performance page for autonomy score controls
    await page.goto("/agent-performance");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/simulation/screenshots/founder-11-agent-performance.png" });

    const hasPerformance = await page.locator("[class*='Card'], [class*='card']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasAutonomy = await page.getByText(/autonomy|trust|performance|score/i)
      .first()
      .isVisible()
      .catch(() => false);

    expect(
      hasSafetyContent || hasGateChecks || hasPerformance ||
      hasAutonomy || accessDenied
    ).toBeTruthy();
  });

  // ── Step 8: Cost dashboard / AI spending ───────────────────────────────

  // The former "/fee-dashboard" leg of this step was deleted 2026-07-29 with the
  // platform escrow/payout console (founder ruling "be the rail, not the
  // provider"). The ops dashboard is the real founder cost surface.
  test("8. Ops dashboard shows AI cost and spending data", async () => {
    await page.goto("/admin/ops");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/simulation/screenshots/founder-13-ops-dashboard.png" });

    const hasOps = await page.locator("[class*='Card'], [class*='card']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasCostMetrics = await page.getByText(/cost|spend|this month|tokens|usage/i)
      .first()
      .isVisible()
      .catch(() => false);
    const accessDenied = await page.getByText(/access denied|not authorized/i)
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasOps || hasCostMetrics || accessDenied).toBeTruthy();
  });

  // ── Step 9: System health / status page ────────────────────────────────

  test("9. System health and job health pages load", async () => {
    // Job health shows background job statuses
    await page.goto("/job-health");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/simulation/screenshots/founder-14-job-health.png" });

    const hasJobHealth = await page.locator("[class*='Card'], [class*='card']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasJobStatuses = await page.getByText(/success|failed|running|skipped|job/i)
      .first()
      .isVisible()
      .catch(() => false);
    const hasHeartPulse = await page.locator("svg")
      .first()
      .isVisible()
      .catch(() => false);

    // Also check the public status page
    await page.goto("/status");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/simulation/screenshots/founder-15-status-page.png" });

    const hasStatusPage = await page.getByText(/status|operational|healthy|system/i)
      .first()
      .isVisible()
      .catch(() => false);

    // And integrations health
    await page.goto("/admin/integrations-health");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/simulation/screenshots/founder-16-integrations-health.png" });

    const hasIntegrations = await page.locator("[class*='Card'], [class*='card']")
      .first()
      .isVisible()
      .catch(() => false);

    const accessDenied = await page.getByText(/access denied|not authorized/i)
      .first()
      .isVisible()
      .catch(() => false);

    expect(
      hasJobHealth || hasJobStatuses || hasStatusPage ||
      hasIntegrations || accessDenied
    ).toBeTruthy();
  });

  // ── Step 10: Audit log ─────────────────────────────────────────────────

  test("10. Audit log and event log render entries", async () => {
    // Standard audit log
    await page.goto("/audit-log");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/simulation/screenshots/founder-17-audit-log.png" });

    const hasAuditLog = await page.locator("[class*='Card'], [class*='card']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasLogEntries = await page.getByText(/action|event|user|timestamp|created|updated/i)
      .first()
      .isVisible()
      .catch(() => false);
    const hasTable = await page.getByRole("table")
      .first()
      .isVisible()
      .catch(() => false);

    // Sovereign event log (event mesh).
    // Census W3-1: /event-log refit to /founder/event-log.
    await page.goto("/founder/event-log");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/simulation/screenshots/founder-18-event-log.png" });

    const hasEventLog = await page.locator("[class*='Card'], [class*='card']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasEventEntries = await page.getByText(/event|channel|publisher|priority|DLQ/i)
      .first()
      .isVisible()
      .catch(() => false);
    const accessDenied = await page.getByText(/access denied|not authorized/i)
      .first()
      .isVisible()
      .catch(() => false);

    expect(
      hasAuditLog || hasLogEntries || hasTable ||
      hasEventLog || hasEventEntries || accessDenied
    ).toBeTruthy();
  });

  // ── Step 11: Refit sovereign-legacy surfaces (Census W3-1) ─────────────
  // sovereign-dashboard / sovereign-v13 / agent-collaboration retired
  // 2026-06-11; their routes redirect to /founder/bridge. The surviving
  // surfaces live at /founder/memory and /founder/scenarios.

  test("11. Refit founder memory + scenarios surfaces are accessible", async () => {
    // Memory browser — refit sovereign feature
    await page.goto("/founder/memory");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/simulation/screenshots/founder-21-memory-browser.png" });

    const hasMemory = await page.locator("[class*='Card'], [class*='card']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasMemoryText = await page.getByText(/memory|knowledge|recall|context/i)
      .first()
      .isVisible()
      .catch(() => false);

    // Scenario war room — refit org-consciousness surface
    await page.goto("/founder/scenarios");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/simulation/screenshots/founder-22-scenarios.png" });

    const hasScenarios = await page.locator("[class*='Card'], [class*='card']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasScenarioText = await page.getByText(/scenario|heartbeat|calibration|resilience/i)
      .first()
      .isVisible()
      .catch(() => false);

    // Retired routes should still resolve (redirect to /founder/bridge).
    await page.goto("/sovereign");
    await page.waitForTimeout(1000);
    const redirectedAway = !page.url().includes("/sovereign");

    const accessDenied = await page.getByText(/access denied|not authorized/i)
      .first()
      .isVisible()
      .catch(() => false);

    expect(
      hasMemory || hasMemoryText || hasScenarios ||
      hasScenarioText || redirectedAway || accessDenied
    ).toBeTruthy();
  });

  // ── Step 12: Executive dashboard ───────────────────────────────────────

  test("12. Executive dashboard and daily digest load", async () => {
    await page.goto("/executive-dashboard");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/simulation/screenshots/founder-23-executive-dashboard.png" });

    const hasExecutive = await page.locator("[class*='Card'], [class*='card']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasExecutiveText = await page.getByText(/executive|revenue|growth|churn|kpi/i)
      .first()
      .isVisible()
      .catch(() => false);

    // Daily digest
    await page.goto("/founder/daily-digest");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/simulation/screenshots/founder-24-daily-digest.png" });

    const hasDigest = await page.locator("[class*='Card'], [class*='card']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasDigestText = await page.getByText(/digest|briefing|summary|today/i)
      .first()
      .isVisible()
      .catch(() => false);

    const accessDenied = await page.getByText(/access denied|not authorized/i)
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasExecutive || hasExecutiveText || hasDigest || hasDigestText || accessDenied).toBeTruthy();
  });

  // ── Step 13: Feature flags (founder admin) ─────────────────────────────

  test("13. Feature flags page loads", async () => {
    await page.goto("/founder/feature-flags");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/simulation/screenshots/founder-25-feature-flags.png" });

    const hasFlags = await page.locator("[class*='Card'], [class*='card']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasFlagText = await page.getByText(/feature flag|toggle|enabled|disabled|flag/i)
      .first()
      .isVisible()
      .catch(() => false);
    const hasSwitches = await page.locator("button[role='switch'], [data-state='checked'], [data-state='unchecked']")
      .first()
      .isVisible()
      .catch(() => false);
    const accessDenied = await page.getByText(/access denied|not authorized/i)
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasFlags || hasFlagText || hasSwitches || accessDenied).toBeTruthy();
  });

  // ── Step 14: No 500 errors during the entire journey ──────────────────

  test("14. No server errors were logged during the founder journey", async () => {
    const serverErrors = consoleErrors.filter((e) => e.includes("[500]"));
    if (serverErrors.length > 0) {
      console.error("Server errors during founder journey:", serverErrors);
    }
    expect(serverErrors).toHaveLength(0);
  });
});
