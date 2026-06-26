/**
 * The 30 First Users — a genuine, instrumented persona walk of the customer UI.
 *
 * For each of the 30 code-grounded personas (tests/personas/customer-personas.ts)
 * this spec:
 *   1. Opens a fresh browser context on the persona's REAL device profile and
 *      claims the persona's isolated identity via the `e2e-persona-<slug>`
 *      cookie (server/auth/testAuth.ts → its own org via getOrCreateOrg).
 *   2. Seeds the org's businessType/noteRole so the persona frame is live.
 *   3. Walks all five doors (+ Inbox, Settings), capturing on EVERY page:
 *        · uncaught console errors + page errors        (→ hard finding)
 *        · failed network requests / 5xx responses      (→ hard finding)
 *        · founder-codename leakage onto a customer page (→ hard finding)
 *        · persona-vocabulary presence                   (→ soft finding)
 *        · cross-vertical module-gating violations       (→ soft finding)
 *        · a screenshot per door                         (→ evidence)
 *   4. Writes test-results/personas/<slug>.json with the persona's findings.
 *
 * Hard findings FAIL the persona's test (the UI broke for that user). Soft
 * findings are recorded for the report but don't fail — a roadmap vertical
 * that degrades to a base persona is honest, not a bug. Aggregate the JSON
 * with `tsx tests/personas/report.ts` into a human-readable findings report.
 *
 * Prereqs: a running app with E2E_TEST_AUTH=1 (local: docker-compose.test.yml
 * or `E2E_TEST_AUTH=1 npm run start`; never on Fly). See tests/personas/README.md.
 */

import { test, expect, devices, type Browser, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  CUSTOMER_PERSONAS,
  DOOR_ROUTES,
  FORBIDDEN_EVERYWHERE,
  type CustomerPersona,
  type Device,
  type Door,
} from "../personas/customer-personas";
import { personaCookieValue } from "../../server/auth/testAuth";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5000";
const OUT_DIR = path.join("test-results", "personas");

// Persona device → a Playwright context descriptor (matches playwright.config.ts).
function deviceProfile(device: Device): Record<string, unknown> {
  switch (device) {
    case "iphone-14": return { ...devices["iPhone 14"] };
    case "iphone-se": return { ...devices["iPhone SE"] };
    case "pixel-5": return { ...devices["Pixel 5"] };
    case "galaxy-s9": return { ...devices["Galaxy S9+"] };
    case "tiny-phone": return { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true };
    case "ipad-portrait": return { ...devices["iPad (gen 7)"] };
    case "ipad-landscape": return { ...devices["iPad (gen 7) landscape"] };
    case "ipad-pro": return { ...devices["iPad Pro 11"] };
    case "desktop-chrome": return { ...devices["Desktop Chrome"] };
    case "desktop-1280": return { viewport: { width: 1280, height: 720 } };
    case "desktop-ultrawide": return { viewport: { width: 2560, height: 1080 } };
    case "short-wide": return { viewport: { width: 1920, height: 600 } };
  }
}

const isMobileDevice = (d: Device) =>
  ["iphone-14", "iphone-se", "pixel-5", "galaxy-s9", "tiny-phone"].includes(d);

interface DoorFinding {
  door: Door;
  route: string;
  ok: boolean;
  consoleErrors: string[];
  failedRequests: string[];
  forbiddenLeaks: string[];
  vocabMissing: string[];
  screenshot: string;
}

interface PersonaReport {
  slug: string;
  displayName: string;
  businessType: string;
  persona: string;
  investorType: string;
  device: Device;
  experience: string;
  tier: string;
  goals: string[];
  doors: DoorFinding[];
  moduleGating: { missingExpected: string[]; leakedHidden: string[] };
  hardFindings: number;
  softFindings: number;
}

/** Establish the persona's identity + provision/seed its org via the API. */
async function seedPersona(ctx: BrowserContext, p: CustomerPersona): Promise<void> {
  await ctx.addCookies([
    { name: "__session", value: personaCookieValue(p.slug), url: BASE_URL },
  ]);
  // A first authed GET provisions the org (getOrCreateOrg) and mints the CSRF cookie.
  await ctx.request.get("/api/auth/user").catch(() => undefined);
  const csrf = (await ctx.cookies()).find((c) => c.name === "csrf_token")?.value ?? "";
  // Set businessType + note role so the persona frame (vocab, modules, hero) is live.
  await ctx.request
    .post("/api/onboarding/complete", {
      headers: csrf ? { "X-CSRF-Token": csrf } : {},
      data: {
        orgName: `${p.displayName} Org`,
        businessType: p.businessType,
        investorType: p.investorType,
        ...(p.noteRole ? { noteRole: p.noteRole } : {}),
        goals: p.goals,
      },
    })
    .catch(() => undefined);
}

function makeContext(browser: Browser, p: CustomerPersona): Promise<BrowserContext> {
  return browser.newContext({ baseURL: BASE_URL, ...deviceProfile(p.device) } as never);
}

for (const p of CUSTOMER_PERSONAS) {
  test(`persona · ${p.slug} · ${p.displayName}`, async ({ browser }, testInfo) => {
    test.slow(); // a full 7-door walk per persona

    const ctx = await makeContext(browser, p);
    await seedPersona(ctx, p);
    const page = await ctx.newPage();

    // Per-context instrumentation.
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 300)}`));
    page.on("requestfailed", (r) =>
      failedRequests.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText ?? "failed"}`),
    );
    page.on("response", (r) => {
      if (r.status() >= 500) failedRequests.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    });

    const personaDir = path.join(OUT_DIR, p.slug);
    fs.mkdirSync(personaDir, { recursive: true });

    const doors: DoorFinding[] = [];
    const DOOR_ORDER: Door[] = ["today", "map", "deals", "money", "pax", "inbox", "settings"];

    for (const door of DOOR_ORDER) {
      const route = DOOR_ROUTES[door];
      const before = { c: consoleErrors.length, f: failedRequests.length };
      await page.goto(route, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      // Settle animations / lazy chunks.
      await page.waitForTimeout(600);

      const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";

      // Founder-codename leakage — a hard finding.
      const forbiddenLeaks = FORBIDDEN_EVERYWHERE.filter((s) => bodyText.includes(s));

      // Persona vocabulary expected on this door — soft.
      const expectedVocab = p.expect.vocab[door] ?? [];
      const vocabMissing = expectedVocab.filter((v) => !bodyText.includes(v));

      const shot = path.join(personaDir, `${door}.png`);
      await page.screenshot({ path: shot, fullPage: false }).catch(() => undefined);

      const newConsole = consoleErrors.slice(before.c);
      const newFailed = failedRequests.slice(before.f);
      doors.push({
        door,
        route,
        ok: newConsole.length === 0 && newFailed.length === 0 && forbiddenLeaks.length === 0,
        consoleErrors: newConsole,
        failedRequests: newFailed,
        forbiddenLeaks,
        vocabMissing,
        screenshot: shot,
      });
    }

    // Module gating — desktop only (mobile bottom-nav shows just the 5 doors).
    const moduleGating = { missingExpected: [] as string[], leakedHidden: [] as string[] };
    if (!isMobileDevice(p.device)) {
      await page.goto(DOOR_ROUTES.today, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(800);
      const hrefs = await page.locator("nav a[href], aside a[href]").evaluateAll(
        (els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""),
      ).catch(() => [] as string[]);
      const hrefSet = new Set(hrefs);
      moduleGating.missingExpected = p.expect.modulesVisible.filter(
        (m) => !Array.from(hrefSet).some((h) => h === m || h.startsWith(`${m}?`) || h.startsWith(`${m}/`)),
      );
      moduleGating.leakedHidden = p.expect.modulesHidden.filter((m) => hrefSet.has(m));
    }

    const hardFindings =
      doors.reduce((n, d) => n + d.consoleErrors.length + d.failedRequests.length + d.forbiddenLeaks.length, 0);
    const softFindings =
      doors.reduce((n, d) => n + d.vocabMissing.length, 0) +
      moduleGating.missingExpected.length +
      moduleGating.leakedHidden.length;

    const report: PersonaReport = {
      slug: p.slug,
      displayName: p.displayName,
      businessType: p.businessType,
      persona: p.persona,
      investorType: p.investorType,
      device: p.device,
      experience: p.experience,
      tier: p.tier,
      goals: p.goals,
      doors,
      moduleGating,
      hardFindings,
      softFindings,
    };
    fs.writeFileSync(path.join(OUT_DIR, `${p.slug}.json`), JSON.stringify(report, null, 2));
    await testInfo.attach(`${p.slug}-report`, {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });

    await ctx.close();

    // Hard findings = the UI genuinely broke for this user. Soft findings are
    // captured in the report but never fail the run (intentional degradation).
    const crashes = doors.flatMap((d) => [
      ...d.consoleErrors.map((e) => `[${d.door}] console: ${e}`),
      ...d.failedRequests.map((e) => `[${d.door}] request: ${e}`),
      ...d.forbiddenLeaks.map((e) => `[${d.door}] founder-leak: ${e}`),
    ]);
    expect(crashes, `${p.slug} hit ${crashes.length} hard finding(s)`).toEqual([]);
  });
}
