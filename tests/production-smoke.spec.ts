/**
 * Production Smoke Test — Navigate every page, capture errors
 *
 * Run: npx playwright test tests/production-smoke.spec.ts --headed
 * Or headless: npx playwright test tests/production-smoke.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.SMOKE_URL || "https://acreos.io";

// Every route from App.tsx, grouped by area
const ALL_ROUTES = [
  // Public
  "/auth",
  "/terms",
  "/privacy",
  "/pricing",
  "/status",
  "/changelog",
  "/portal",

  // Core
  "/",
  "/today",
  "/dashboard",
  "/pipeline",
  "/money",
  "/ai",
  "/pax",
  "/leads",
  "/properties",
  "/deals",
  "/tasks",
  "/inbox",
  "/help",
  "/support",

  // Team
  "/team-dashboard",
  "/team",
  "/team-inbox",
  "/team-leaderboard",
  "/team-kpi",

  // Automation
  "/automation",
  "/workflows",
  "/sequences",
  "/ab-tests",

  // Intelligence
  "/analytics",
  "/activity",
  "/counties",
  "/maps",
  "/avm",
  "/avm-bulk",
  "/radar",
  "/market-intelligence",
  "/market-watchlist",
  "/market-data",
  "/vision-ai",
  "/deal-hunter",
  "/deal-patterns",
  "/deal-feed",
  "/deal-underwriting",
  "/price-optimizer",
  "/seller-intent",
  "/land-credit",
  "/negotiation",
  "/document-intelligence",
  "/tax-researcher",
  "/compliance",
  "/regulatory-intel",

  // Finance
  "/finance",
  "/portfolio",
  "/portfolio-health",
  "/portfolio-pnl",
  "/portfolio-optimizer",
  "/cash-flow",
  "/forecasting",
  "/capital-markets",
  "/exchange-1031",
  "/tax-optimizer",
  "/tax-delinquent",
  "/bookkeeping",
  "/depreciation",
  "/closing-costs",
  "/property-tax",
  "/fee-dashboard",
  "/freedom-meter",

  // Campaigns & Comms
  "/campaigns",
  "/offers",
  "/listings",
  "/documents",
  "/blind-offer-wizard",
  "/marketplace",

  // Settings & Admin
  "/settings",
  "/settings/email",
  "/settings/mail",
  "/settings/privacy",
  "/usage",
  "/goals",
  "/webhooks",
  "/data-export",
  "/audit-log",
  "/cohort-analysis",
  "/kpis",

  // AI & Agents
  "/agents",
  "/ai-team",
  "/command-center",
  "/agent-command-center",
  "/tools",
  "/model-training",

  // Founder
  "/founder-dashboard",
  "/founder-home",
  "/founder",
  "/founder/ai-observatory",
  "/founder/feature-flags",
  "/founder/agents",
  "/founder/daily-digest",
  "/founder/v13",
  "/executive-dashboard",
  "/board-of-directors",
  "/agent-performance",
  "/memory-browser",
  "/event-log",
  "/job-health",
  "/agent-collaboration",
  "/sovereign",
  "/data-moat",
  "/reseller",

  // Admin
  "/admin/support",
  "/admin/beta",
  "/admin/safety-gates",
  "/admin/decisions",
  "/admin/ops",
  "/admin/beta-intake",
  "/admin/beta-analytics",
  "/admin/queues",
  "/admin/integrations-health",
  "/admin/monitor",
  "/founder/beta-analytics",

  // Misc
  "/investor-network",
  "/syndication",
  "/syndication-status",
  "/commissions",
  "/zoning",
  "/title-search",
  "/property-enrichment",
  "/dodd-frank",
  "/state-documents",
  "/dunning",
  "/night-cap",
  "/evening-review",
  "/onboarding-v2",

  // Sovereign / Advanced
  "/conscious-organization",
  "/anticipatory-enterprise",
  "/real-runtime",
];

interface PageResult {
  route: string;
  status: "OK" | "ERROR" | "REDIRECT" | "BLANK";
  httpErrors: string[];
  consoleErrors: string[];
  finalUrl: string;
  loadTimeMs: number;
}

test.describe("Production Smoke Test — All Pages", () => {
  const results: PageResult[] = [];

  test.afterAll(async () => {
    // Print summary
    const errors = results.filter((r) => r.status === "ERROR");
    const blanks = results.filter((r) => r.status === "BLANK");
    const redirects = results.filter((r) => r.status === "REDIRECT");
    const ok = results.filter((r) => r.status === "OK");

    console.log("\n\n========================================");
    console.log("  PRODUCTION SMOKE TEST RESULTS");
    console.log("========================================\n");
    console.log(`  OK:        ${ok.length}`);
    console.log(`  REDIRECT:  ${redirects.length}`);
    console.log(`  BLANK:     ${blanks.length}`);
    console.log(`  ERROR:     ${errors.length}`);
    console.log(`  TOTAL:     ${results.length}\n`);

    if (errors.length > 0) {
      console.log("--- ERRORS ---");
      for (const r of errors) {
        console.log(`\n  ${r.route}`);
        console.log(`    Final URL: ${r.finalUrl}`);
        for (const e of r.httpErrors) console.log(`    HTTP: ${e}`);
        for (const e of r.consoleErrors.slice(0, 3))
          console.log(`    Console: ${e.slice(0, 200)}`);
      }
    }

    if (blanks.length > 0) {
      console.log("\n--- BLANK PAGES ---");
      for (const r of blanks) {
        console.log(`  ${r.route} → ${r.finalUrl}`);
      }
    }

    // Write results to JSON for easy parsing
    const fs = await import("fs");
    fs.writeFileSync(
      "tests/smoke-results.json",
      JSON.stringify({ summary: { ok: ok.length, redirect: redirects.length, blank: blanks.length, error: errors.length, total: results.length }, errors, blanks, redirects }, null, 2)
    );
    console.log("\nFull results written to tests/smoke-results.json");
  });

  for (const route of ALL_ROUTES) {
    test(`Navigate: ${route}`, async ({ page }) => {
      const consoleErrors: string[] = [];
      const httpErrors: string[] = [];

      page.on("console", (msg) => {
        if (msg.type() === "error") {
          consoleErrors.push(msg.text());
        }
      });

      page.on("pageerror", (err) => {
        consoleErrors.push(`[pageerror] ${err.message}`);
      });

      page.on("response", (res) => {
        if (res.status() >= 500) {
          httpErrors.push(`${res.status()} ${res.url()}`);
        }
      });

      const start = Date.now();

      try {
        await page.goto(`${BASE}${route}`, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
      } catch (err: any) {
        results.push({
          route,
          status: "ERROR",
          httpErrors: [`Navigation failed: ${err.message}`],
          consoleErrors,
          finalUrl: page.url(),
          loadTimeMs: Date.now() - start,
        });
        return;
      }

      // Wait a beat for JS to render
      await page.waitForTimeout(2000);

      const loadTimeMs = Date.now() - start;
      const finalUrl = page.url();

      // Check for blank page (no visible text content)
      const bodyText = await page
        .locator("body")
        .innerText()
        .catch(() => "");
      const isBlank = bodyText.trim().length < 20;

      // Check if we were redirected (e.g., to /auth)
      const wasRedirected =
        !finalUrl.includes(route) && route !== "/" && !finalUrl.endsWith("/");

      let status: PageResult["status"] = "OK";
      if (httpErrors.length > 0 || consoleErrors.some((e) => e.includes("[pageerror]"))) {
        status = "ERROR";
      } else if (isBlank) {
        status = "BLANK";
      } else if (wasRedirected) {
        status = "REDIRECT";
      }

      results.push({
        route,
        status,
        httpErrors,
        consoleErrors,
        finalUrl,
        loadTimeMs,
      });
    });
  }
});
