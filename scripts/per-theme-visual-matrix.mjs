#!/usr/bin/env node
/**
 * F.2 — Per-theme visual matrix.
 *
 * For each (theme × mode) combination, set the theme via localStorage,
 * navigate to a representative authenticated page, and capture a full-page
 * screenshot. Used post-deploy to spot-check that no theme regressed
 * (missing tokens, broken contrast, ghost backgrounds).
 *
 * Themes: homestead, quarry, nocturne, meadow, slate (5)
 * Modes: light, dark (2)
 * Pages: /today, /leads, /settings/appearance (3 representative)
 * Total: 5 × 2 × 3 = 30 screenshots.
 *
 * Run: STORAGE_STATE=storageState.json node scripts/per-theme-visual-matrix.mjs
 * Output: docs/archive/exhaustive-completion/auth-screenshots/theme-matrix/
 */

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs/archive/exhaustive-completion/auth-screenshots/theme-matrix");
const REPORT_MD = path.join(ROOT, "docs/archive/exhaustive-completion/THEME-MATRIX-RESULTS.md");
const HOST = process.env.AUDIT_HOST ?? "https://acreos.io";
const VIEWPORT = { width: 1440, height: 900 };
// Settle waits for networkidle (post-XHR/fetch quiet) before screenshot,
// then a small fixed buffer for animation/transition stability. The earlier
// fixed 3000ms wasn't enough to catch the post-auth content render.
const NETWORK_IDLE_TIMEOUT = 15000;
const POST_IDLE_MS = 1500;
const NAV_TIMEOUT = 30000;
// Spacing between captures — without this the rapid-fire navs trigger
// backend rate limits (429 on multiple endpoints in the prior run).
const INTER_CAPTURE_DELAY_MS = 2500;
const STORAGE_KEY = "acreos-theme-config";

const THEMES = ["homestead", "quarry", "nocturne", "meadow", "slate"];
const MODES = ["light", "dark"];
const PAGES = [
  { path: "/today", slug: "today" },
  { path: "/leads", slug: "leads" },
  { path: "/settings/appearance", slug: "settings-appearance" },
];

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

const storagePath = process.env.STORAGE_STATE || "storageState.json";
if (!fs.existsSync(storagePath)) {
  console.error(`[matrix] storageState file not found at: ${storagePath}`);
  console.error(`[matrix] Run scripts/capture-storage-state-chrome.mjs first.`);
  process.exit(1);
}

ensureDir(OUT_DIR);
console.log(`[matrix] host: ${HOST}`);
console.log(`[matrix] storageState: ${storagePath}`);
console.log(`[matrix] output: ${OUT_DIR}`);
console.log(`[matrix] running ${THEMES.length} × ${MODES.length} × ${PAGES.length} = ${THEMES.length * MODES.length * PAGES.length} captures`);

const results = [];
const browser = await chromium.launch();

for (const theme of THEMES) {
  for (const mode of MODES) {
    const themeConfig = {
      theme,
      mode,
      fontPairing: "editorial",
      density: "adaptive",
      motion: "reduced", // disable animations for stable screenshots
    };
    const initScript = `
      try {
        localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(JSON.stringify(themeConfig))});
        localStorage.setItem("acreos-theme", ${JSON.stringify(mode)});
      } catch (e) {}
    `;

    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      storageState: storagePath,
      colorScheme: mode,
      reducedMotion: "reduce",
    });
    await context.addInitScript(initScript);

    for (const p of PAGES) {
      const slug = `${theme}-${mode}-${p.slug}`;
      const out = path.join(OUT_DIR, `${slug}.png`);
      const page = await context.newPage();
      const consoleErrors = [];
      const failedRequests = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      page.on("response", (resp) => {
        if (resp.status() >= 500) failedRequests.push(`${resp.status()} ${resp.url()}`);
      });

      let category = "OK";
      let httpStatus = null;
      let error = null;
      const failedUrls = []; // capture URLs of any 4xx/5xx for triage
      page.on("response", (resp) => {
        const s = resp.status();
        if (s >= 400) failedUrls.push(`${s} ${resp.url()}`);
      });
      try {
        const resp = await page.goto(`${HOST}${p.path}`, {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT,
        });
        httpStatus = resp?.status() ?? null;
        // Wait for the "Loading AcreOS..." splash to disappear. networkidle
        // is unreliable because the SPA polls (sessions/touch, telemetry)
        // and never quiets — splash-text wait is the actual "auth bootstrap
        // finished" signal.
        try {
          await page.waitForFunction(
            () => {
              const text = document.body?.innerText || "";
              return !/Loading AcreOS|^Loading\.\.\.$/i.test(text);
            },
            null,
            { timeout: NETWORK_IDLE_TIMEOUT },
          );
        } catch { /* splash still showing — capture anyway */ }
        await page.waitForTimeout(POST_IDLE_MS);
        await page.screenshot({ path: out, fullPage: true });
        if (consoleErrors.length || failedRequests.length) category = "DEGRADED";
        if (httpStatus && httpStatus >= 400) category = "ERROR";
      } catch (err) {
        category = "ERROR";
        error = err.message;
      } finally {
        await page.close();
      }

      const note4xx = failedUrls.length ? failedUrls[0] : "";
      console.log(`  [${slug}] ${category} status=${httpStatus ?? "—"} consoleErr=${consoleErrors.length} failedReq=${failedRequests.length}${note4xx ? ` first4xx=${note4xx.slice(0, 80)}` : ""}${error ? ` (${error})` : ""}`);
      results.push({ theme, mode, page: p.path, slug, category, httpStatus, consoleErrors, failedRequests, failedUrls, error });

      // Throttle to avoid backend rate limits.
      await new Promise((r) => setTimeout(r, INTER_CAPTURE_DELAY_MS));
    }

    await context.close();
  }
}

await browser.close();

// Write report
const lines = [];
lines.push(`# F.2 — Per-Theme Visual Matrix Results`);
lines.push(``);
lines.push(`**Run:** ${new Date().toISOString()}`);
lines.push(`**Host:** ${HOST}`);
lines.push(`**Captures:** ${results.length}`);
lines.push(``);

const counts = results.reduce((a, r) => { a[r.category] = (a[r.category] ?? 0) + 1; return a; }, {});
lines.push(`## Summary`);
lines.push(``);
for (const c of Object.keys(counts).sort()) lines.push(`- **${c}:** ${counts[c]}`);
lines.push(``);

lines.push(`## Per-capture results`);
lines.push(``);
lines.push(`| Theme | Mode | Page | Category | Status | Console errs | Failed reqs | Note |`);
lines.push(`|---|---|---|---|---|---|---|---|`);
for (const r of results) {
  const note = r.error ? r.error : (r.consoleErrors[0] ? `\`${r.consoleErrors[0].slice(0, 80)}\`` : "");
  lines.push(`| ${r.theme} | ${r.mode} | ${r.page} | ${r.category} | ${r.httpStatus ?? "—"} | ${r.consoleErrors.length} | ${r.failedRequests.length} | ${note} |`);
}
lines.push(``);
lines.push(`Screenshots in \`docs/archive/exhaustive-completion/auth-screenshots/theme-matrix/\`.`);
lines.push(``);

fs.writeFileSync(REPORT_MD, lines.join("\n"));
console.log(``);
console.log(`[matrix] wrote ${REPORT_MD}`);
console.log(`[matrix] wrote ${results.length} screenshots to ${OUT_DIR}`);
const ok = results.filter((r) => r.category === "OK").length;
console.log(`[matrix] OK ${ok}/${results.length}, DEGRADED ${counts.DEGRADED ?? 0}, ERROR ${counts.ERROR ?? 0}`);
