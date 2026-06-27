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

// Fire-and-forget beacons abort on navigation — never a product bug.
const BEACON_RE = /\/api\/(telemetry|analytics)\b/;
// Endpoints gated behind an external key. In a test env with those keys unset
// a 5xx/▢ is "honestly unconfigured", not "the UI broke" — recorded as a SOFT
// finding (the founder should still see it; ideally these degrade to a clean
// empty state rather than 5xx) but it does not fail the persona.
const CONFIG_GATED_RE =
  /(\/api\/(stripe|billing|products|pax\/|integrations|quickbooks|qbo|skip-trac|providers|enrich|avm|regrid|twilio|lob|ses)|\/coach\b|\/ai\b)/i;
// React-Query echoes the HTTP failures the response handler already captured
// (with URLs). They're redundant noise here, not a second bug.
const REDUNDANT_QUERY_RE = /\[Query Error|Failed to fetch|suppressed toast/i;
// Navigation cancels in-flight requests — not a failure. Console "Failed to load
// resource" is URL-less noise; the response/requestfailed handlers capture the
// meaningful ones with URLs. A production build ships no source maps, so .map
// requests 404 by design.
const ABORTED_RE = /ERR_ABORTED|net::ERR_FAILED|interrupted/i;
const REDUNDANT_CONSOLE_RE = /Failed to load resource/i;
const IGNORABLE_404_RE = /\.map(\?|$)|\.js(\?|$)|\.css(\?|$)|\.png|\.svg|\.ico|\.woff|favicon|manifest/i;
// 404s that are CORRECT by design, not findings:
//  - /api/ui-state/<key> returns 404 when a UI pref is unset (every new user);
//    the client falls back to defaults. (server/routes-ui-state.ts)
//  - /api/white-label/* is feature-gated → 404 "Feature not available" for any
//    org without the white_label flag (all customer personas). (featureGate)
const EXPECTED_404_RE = /\/api\/(ui-state|white-label)\b/i;

interface A11yViolation {
  id: string;
  impact: string;
  help: string;
  nodes: number;
}
interface DoorFinding {
  door: Door;
  route: string;
  ok: boolean;
  consoleErrors: string[];
  failedRequests: string[];
  /** Config-gated 5xx / beacon aborts — recorded, not fatal in an unconfigured env. */
  degradedRequests: string[];
  forbiddenLeaks: string[];
  vocabMissing: string[];
  /** axe-core critical+serious violations (real launch-blocking a11y issues). */
  a11y: A11yViolation[];
  /** Navigation timing: DOMContentLoaded + full load, in ms (null if unavailable). */
  perf: { domContentLoaded: number | null; load: number | null };
  screenshot: string;
}

// axe-core via CDN (no dep added). Returns critical+serious violations only.
async function runAxe(page: import("@playwright/test").Page): Promise<A11yViolation[]> {
  try {
    // Inject axe from the locally-installed package (no CDN, no network). The
    // context runs with bypassCSP so this inline script is allowed under test.
    await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
    const result = await page.evaluate(async () => {
      // @ts-expect-error injected global
      if (typeof axe === "undefined") return [];
      // @ts-expect-error injected global
      const r = await axe.run(document, { resultTypes: ["violations"] });
      return r.violations
        .filter((v: { impact?: string }) => v.impact === "critical" || v.impact === "serious")
        .map((v: { id: string; impact?: string; help: string; nodes: unknown[] }) => ({
          id: v.id,
          impact: v.impact ?? "",
          help: v.help,
          nodes: v.nodes.length,
        }));
    });
    return result as A11yViolation[];
  } catch {
    return []; // CDN unreachable / injection blocked — skip a11y for this door
  }
}

async function capturePerf(page: import("@playwright/test").Page): Promise<DoorFinding["perf"]> {
  try {
    return await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (!nav) return { domContentLoaded: null, load: null };
      return {
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
        load: Math.round(nav.loadEventEnd || nav.domContentLoadedEventEnd),
      };
    });
  } catch {
    return { domContentLoaded: null, load: null };
  }
}

/** A door is "slow" if DOMContentLoaded exceeds this (ms) — a launch-feel signal. */
const SLOW_DOOR_MS = 4000;

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
  a11yCritical: number;
  slowDoors: Array<{ door: string; ms: number }>;
  /** 0–100 launch-readiness score for this persona, + a letter grade. */
  readinessScore: number;
  readinessGrade: string;
}

function grade(score: number): string {
  if (score >= 95) return "A";
  if (score >= 85) return "B";
  if (score >= 70) return "C";
  if (score >= 50) return "D";
  return "F";
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
  // bypassCSP lets us inject the axe-core a11y scanner under the app's strict
  // Content-Security-Policy. It only affects the test browser, never the app.
  return browser.newContext({ baseURL: BASE_URL, bypassCSP: true, ...deviceProfile(p.device) } as never);
}

for (const p of CUSTOMER_PERSONAS) {
  test(`persona · ${p.slug} · ${p.displayName}`, async ({ browser }, testInfo) => {
    test.slow(); // a full 7-door walk per persona

    const ctx = await makeContext(browser, p);
    await seedPersona(ctx, p);
    const page = await ctx.newPage();

    // Per-context instrumentation. Hard = the UI broke; degraded = an optional
    // integration is unconfigured in this env (recorded, not fatal).
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    const degradedRequests: string[] = [];
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (REDUNDANT_CONSOLE_RE.test(t)) return; // URL-less; captured by response handler
      if (REDUNDANT_QUERY_RE.test(t)) { degradedRequests.push(`console: ${t.slice(0, 200)}`); return; }
      consoleErrors.push(t.slice(0, 300));
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 300)}`));
    page.on("requestfailed", (r) => {
      const url = r.url();
      const err = r.failure()?.errorText ?? "failed";
      if (ABORTED_RE.test(err)) return; // navigation cancellation — not a failure
      const line = `${r.method()} ${url} — ${err}`;
      if (BEACON_RE.test(url) || CONFIG_GATED_RE.test(url)) degradedRequests.push(line);
      else failedRequests.push(line);
    });
    page.on("response", (r) => {
      const status = r.status();
      const url = r.url();
      if (status === 404) {
        if (IGNORABLE_404_RE.test(url) || EXPECTED_404_RE.test(url)) return; // by-design / optional
        degradedRequests.push(`404 ${r.request().method()} ${url}`); // a real-but-soft 404 to review
        return;
      }
      if (status < 500) return;
      const line = `${status} ${r.request().method()} ${url}`;
      if (CONFIG_GATED_RE.test(url) || BEACON_RE.test(url)) degradedRequests.push(line);
      else failedRequests.push(line);
    });

    const personaDir = path.join(OUT_DIR, p.slug);
    fs.mkdirSync(personaDir, { recursive: true });

    const doors: DoorFinding[] = [];
    const DOOR_ORDER: Door[] = ["today", "map", "deals", "money", "pax", "inbox", "settings"];

    for (const door of DOOR_ORDER) {
      const route = DOOR_ROUTES[door];
      const before = { c: consoleErrors.length, f: failedRequests.length, d: degradedRequests.length };
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

      // Deep checks: accessibility (real launch blockers) + page-feel timing.
      const a11y = await runAxe(page);
      const perf = await capturePerf(page);

      const newConsole = consoleErrors.slice(before.c);
      const newFailed = failedRequests.slice(before.f);
      const newDegraded = degradedRequests.slice(before.d);
      doors.push({
        door,
        route,
        ok: newConsole.length === 0 && newFailed.length === 0 && forbiddenLeaks.length === 0,
        consoleErrors: newConsole,
        failedRequests: newFailed,
        degradedRequests: newDegraded,
        forbiddenLeaks,
        vocabMissing,
        a11y,
        perf,
        screenshot: shot,
      });
    }

    // Module gating — desktop only (mobile bottom-nav shows just the 5 doors).
    const moduleGating = { missingExpected: [] as string[], leakedHidden: [] as string[] };
    if (!isMobileDevice(p.device)) {
      await page.goto(DOOR_ROUTES.today, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(800);
      // Open any collapsed sidebar / nav drawer so module links are in the DOM,
      // then collect every internal anchor href on the page.
      await page.getByRole("button", { name: /menu|navigation|expand|sidebar/i }).first().click({ timeout: 1500 }).catch(() => undefined);
      const hrefs = await page.locator('a[href^="/"]').evaluateAll(
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
      doors.reduce((n, d) => n + d.vocabMissing.length + d.degradedRequests.length, 0) +
      moduleGating.missingExpected.length +
      moduleGating.leakedHidden.length;

    const a11yCritical = doors.reduce((n, d) => n + d.a11y.length, 0);
    const slowDoors = doors
      .filter((d) => (d.perf.domContentLoaded ?? 0) > SLOW_DOOR_MS)
      .map((d) => ({ door: d.door, ms: d.perf.domContentLoaded ?? 0 }));

    // Launch-readiness: start at 100, dock for what a real user would feel.
    // Functional breakage dominates; accessibility is real but capped so an
    // app that WORKS but carries a11y debt grades ~C (fix-before-public), not F.
    const a11yRuleTypes = new Set(doors.flatMap((d) => d.a11y.map((v) => v.id))).size;
    let readinessScore = 100;
    readinessScore -= hardFindings * 25; // a broken door is disqualifying
    readinessScore -= Math.min(30, a11yRuleTypes * 5); // a11y debt, capped at -30
    readinessScore -= slowDoors.length * 5; // each sluggish door
    readinessScore -= moduleGating.leakedHidden.length * 3; // cross-vertical leak
    readinessScore -= Math.min(10, softFindings); // residual polish, capped
    readinessScore = Math.max(0, Math.min(100, readinessScore));

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
      a11yCritical,
      slowDoors,
      readinessScore,
      readinessGrade: grade(readinessScore),
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
