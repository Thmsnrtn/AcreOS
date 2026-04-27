#!/usr/bin/env node
/**
 * Gap 1.0 Phase A — capture every Claude Design prototype surface at
 * desktop 1440 + mobile 375. Drives the prototype's window.__nav
 * function to switch routes; toggles window.__founderMode for the
 * founder routes.
 *
 * Output: docs/exhaustive-completion/prototype-screenshots/<slug>-{1440,375}.png
 *
 * Prereq: prototype already running at http://localhost:8765/acreos/acreos.html
 *         (see Gap 1.0 instructions in the exhaustive completion prompt)
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const URL = "http://localhost:8765/acreos/acreos.html";
const OUT = "docs/exhaustive-completion/prototype-screenshots";

// Customer-visible canonical surfaces (no founder mode)
const CUSTOMER = [
  ["home", "CommandCenterC (canonical Today)"],
  ["inbox", "InboxC"],
  ["pipeline", "Pipeline"],
  ["parcels", "ParcelDetailB"],
  ["contacts", "Contacts"],
  ["calendar", "CalendarPage"],
  ["buybox", "BuyBoxes"],
  ["lists", "Lists"],
  ["campaigns", "Campaigns"],
  ["perf", "CampaignPerf"],
  ["offers", "Offers"],
  ["documents", "Documents"],
  ["finance", "SellerFinance"],
  ["dispos", "Dispositions"],
  ["agents", "AgentWorkspace"],
  ["automation", "Automations"],
  ["audit", "AuditLog"],
  ["settings", "SettingsC"],
  ["team", "Team"],
  ["billing", "Billing"],
  ["integrations", "Integrations"],
  ["pax", "Pax"],
];

// Founder surfaces — require __founderMode = true
const FOUNDER = [
  ["founder", "FounderHomeC"],
  ["atlas-run", "AtlasRunC"],
  ["founder-rev", "FounderRevenueC"],
  ["founder-tenants", "FounderTenants"],
  ["founder-cost", "FounderCost"],
  ["founder-ops", "FounderOps"],
];

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "375", width: 375, height: 800 },
];

async function captureAt(page, viewport, surfaces, label) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  for (const [route, name] of surfaces) {
    try {
      await page.evaluate((r) => window.__nav(r), route);
      await page.waitForTimeout(700);
      const path = `${OUT}/${route}-${viewport.name}.png`;
      await page.screenshot({ path, fullPage: true });
      console.log(`  ✓ ${label} ${viewport.name}px /${route} → ${path} (${name})`);
    } catch (e) {
      console.log(`  ✗ ${label} ${viewport.name}px /${route} — ${e.message}`);
    }
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => console.warn(`  ! pageerror: ${e.message}`));

  console.log(`→ ${URL}`);
  await page.goto(URL, { waitUntil: "networkidle" });
  // Give Babel + React time to render the initial route
  await page.waitForTimeout(1500);

  // Customer surfaces — both viewports
  console.log("\n[customer surfaces, no founder mode]");
  await page.evaluate(() => { window.__founderMode = false; });
  for (const vp of VIEWPORTS) {
    await captureAt(page, vp, CUSTOMER, "customer");
  }

  // Founder surfaces — toggle mode + reload to apply, then capture
  console.log("\n[founder surfaces, __founderMode = true]");
  await page.evaluate(() => {
    window.__founderMode = true;
    // The prototype reads __founderMode at render time; force a re-render
    window.dispatchEvent(new Event("resize"));
  });
  for (const vp of VIEWPORTS) {
    await captureAt(page, vp, FOUNDER, "founder");
  }

  await browser.close();
  console.log("\n✓ Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
