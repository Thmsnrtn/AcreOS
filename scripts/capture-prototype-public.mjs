#!/usr/bin/env node
/**
 * Gap 1.0 Phase A.4 — capture landing + onboarding prototypes.
 *
 * Landing: http://localhost:8766/acreos-landing.html
 * Onboarding: http://localhost:8767/acreos-onboarding.html
 *
 * For landing: capture full page at 1440 + 375 (one shot each — it's a
 * single scrolling page with all sections).
 *
 * For onboarding: capture each step (welcome through reveal). The wizard
 * advances via the "Continue" button.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const OUT = "docs/archive/exhaustive-completion/prototype-screenshots";
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "375", width: 375, height: 800 },
];

async function captureLanding(page) {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("http://localhost:8766/acreos-landing.html", {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2000); // let Babel + animations settle
    const path = `${OUT}/landing-${vp.name}.png`;
    await page.screenshot({ path, fullPage: true });
    console.log(`  ✓ landing ${vp.name}px → ${path}`);
  }
}

async function captureOnboarding(page) {
  // Step keys per app.jsx STEPS array
  const steps = ["welcome", "markets", "buybox", "goals", "autonomy", "connections", "phone", "billing", "reveal"];

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("http://localhost:8767/acreos-onboarding.html", {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2000);

    for (let i = 0; i < steps.length; i++) {
      const path = `${OUT}/onboarding-${steps[i]}-${vp.name}.png`;
      await page.screenshot({ path, fullPage: true });
      console.log(`  ✓ onboarding ${vp.name}px step ${i} (${steps[i]}) → ${path}`);
      // Advance via Enter key (welcome screen) or Continue button
      if (i < steps.length - 1) {
        try {
          await page.keyboard.press("Enter");
          await page.waitForTimeout(500);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newContext().then((c) => c.newPage());
  page.on("pageerror", (e) => console.warn(`  ! pageerror: ${e.message}`));

  console.log("[landing prototype]");
  await captureLanding(page);

  console.log("\n[onboarding prototype]");
  await captureOnboarding(page);

  await browser.close();
  console.log("\n✓ Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
