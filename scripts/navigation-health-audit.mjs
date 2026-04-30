#!/usr/bin/env node
/**
 * Navigation Health Audit — walk every route from client/src/App.tsx and
 * record render quality. Unauth-only by default; for auth-gated coverage
 * the founder must provide a Clerk session ticket (see README block at end).
 *
 * Categories:
 *   HEALTHY      — main content rendered, no console errors, no failed XHRs
 *   DEGRADED     — rendered but has console errors or failed network reqs
 *   BLANK        — DOM has no meaningful main content after settle
 *   ERROR        — page error / uncaught exception / 5xx response
 *   AUTH_REDIRECT— navigated to /auth (expected for protected routes unauth)
 *
 * Output:
 *   docs/exhaustive-completion/auth-screenshots/_nav-audit-<slug>.png
 *   docs/exhaustive-completion/NAVIGATION-HEALTH-AUDIT.md
 *   docs/exhaustive-completion/_nav-audit-results.json
 */

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APP_TSX = path.join(ROOT, "client/src/App.tsx");
const OUT_DIR = path.join(ROOT, "docs/exhaustive-completion/auth-screenshots");
const RESULTS_JSON = path.join(ROOT, "docs/exhaustive-completion/_nav-audit-results.json");
const REPORT_MD = path.join(ROOT, "docs/exhaustive-completion/NAVIGATION-HEALTH-AUDIT.md");

const HOST = process.env.AUDIT_HOST ?? "https://acreos.io";
const VIEWPORT = { width: 1440, height: 900 };
const SETTLE_MS = 5000;
const NAV_TIMEOUT = 25000;

// Realistic parameter substitutions for parameterized routes
const PARAM_SUBS = {
  ":docId": "demo-doc",
  ":accessToken": "demo-token",
  ":eventId": "1",
  ":codename": "atlas",
  ":id": "1",
};

function slugify(p) {
  if (p === "/") return "root";
  return p
    .replace(/^\//, "")
    .replace(/\//g, "-")
    .replace(/:/g, "")
    .replace(/[^a-z0-9-]/gi, "-")
    .toLowerCase();
}

function extractRoutes(appTsx) {
  // Match `<Route path="..."` or `<Route path={"..."}` — capture the path string.
  const re = /<Route\s+path\s*=\s*"([^"]+)"/g;
  const seen = new Set();
  const routes = [];
  let m;
  while ((m = re.exec(appTsx)) !== null) {
    const p = m[1];
    if (seen.has(p)) continue;
    seen.add(p);
    // Determine wrapper kind by looking ahead 600 chars for protection wrappers
    const tail = appTsx.slice(m.index, m.index + 600);
    let kind = "PUBLIC";
    if (tail.includes("FounderProtectedRoute")) kind = "FOUNDER";
    else if (tail.includes("ProtectedRoute")) kind = "PROTECTED";
    else if (tail.includes("FlaggedRoute")) kind = "FLAGGED";
    else if (tail.includes("<Redirect to=")) kind = "REDIRECT";
    routes.push({ path: p, kind });
  }
  return routes;
}

function substitute(p) {
  let out = p;
  for (const [k, v] of Object.entries(PARAM_SUBS)) {
    out = out.replace(k, v);
  }
  return out;
}

async function auditRoute(context, route) {
  const concretePath = substitute(route.path);
  const fullUrl = `${HOST}${concretePath}`;
  const slug = slugify(route.path);

  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const failedRequests = [];
  let httpStatus = null;
  let finalUrl = null;
  const start = Date.now();

  const page = await context.newPage();

  page.on("console", (msg) => {
    const t = msg.type();
    if (t === "error") consoleErrors.push(msg.text().slice(0, 300));
    else if (t === "warning") consoleWarnings.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (err) => pageErrors.push(`${err.name}: ${err.message}`.slice(0, 300)));
  page.on("requestfailed", (req) => {
    const f = req.failure();
    failedRequests.push({ url: req.url().slice(0, 200), reason: f?.errorText ?? "unknown" });
  });
  page.on("response", (resp) => {
    // Only record top-level navigation status
    if (resp.url() === fullUrl || (httpStatus === null && resp.url().startsWith(HOST) && resp.request().resourceType() === "document")) {
      httpStatus = resp.status();
    }
  });

  let navError = null;
  try {
    const resp = await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    if (resp) httpStatus = resp.status();
  } catch (err) {
    navError = err.message;
  }

  // Settle: wait for SPA hydration, lazy chunks, queries
  await page.waitForTimeout(SETTLE_MS);

  // Capture state after settle
  finalUrl = page.url();

  // Detect "blank" — main content size + visible text
  const renderInfo = await page.evaluate(() => {
    const main = document.getElementById("main-content");
    const text = document.body?.innerText ?? "";
    const textLen = text.replace(/\s+/g, " ").trim().length;
    const mainText = main?.innerText?.replace(/\s+/g, " ").trim().length ?? 0;
    const hasLoadingSpinner = !!document.querySelector('[role="status"], [aria-busy="true"]');
    const stillLoadingText = /Loading AcreOS|^Loading\.\.\.$/i.test(text);
    return {
      bodyTextLen: textLen,
      mainTextLen: mainText,
      hasMain: !!main,
      hasLoadingSpinner,
      stillLoadingText,
    };
  }).catch(() => ({ bodyTextLen: 0, mainTextLen: 0, hasMain: false, hasLoadingSpinner: false, stillLoadingText: false }));

  const tti = Date.now() - start;

  // Screenshot
  const screenshotPath = path.join(OUT_DIR, `_nav-audit-${slug}.png`);
  try {
    await page.screenshot({ path: screenshotPath, fullPage: false });
  } catch {
    // ignore
  }

  // Categorize
  const isAuthRedirect = finalUrl && /\/auth(\?|$|#)/.test(new URL(finalUrl).pathname + new URL(finalUrl).search);
  let category;
  if (navError) category = "ERROR";
  else if (httpStatus && httpStatus >= 500) category = "ERROR";
  else if (pageErrors.length > 0) category = "ERROR";
  else if (isAuthRedirect && route.kind !== "PUBLIC") category = "AUTH_REDIRECT";
  else if (renderInfo.mainTextLen < 20 && renderInfo.bodyTextLen < 50) category = "BLANK";
  else if (consoleErrors.length > 0 || failedRequests.length > 0) category = "DEGRADED";
  else category = "HEALTHY";

  await page.close();

  return {
    path: route.path,
    concretePath,
    kind: route.kind,
    slug,
    category,
    httpStatus,
    finalUrl,
    tti,
    navError,
    renderInfo,
    consoleErrors,
    consoleWarnings: consoleWarnings.slice(0, 5),
    pageErrors,
    failedRequests: failedRequests.slice(0, 10),
    screenshot: path.relative(ROOT, screenshotPath),
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const appTsx = fs.readFileSync(APP_TSX, "utf8");
  const routes = extractRoutes(appTsx);
  console.log(`[audit] extracted ${routes.length} routes from App.tsx`);
  console.log(`[audit] host: ${HOST}`);
  console.log(`[audit] mode: UNAUTH (no Clerk session)`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  });

  const results = [];
  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    process.stdout.write(`[${i + 1}/${routes.length}] ${r.path} (${r.kind}) ... `);
    try {
      const res = await auditRoute(context, r);
      console.log(`${res.category} ${res.httpStatus ?? "—"} ${res.tti}ms`);
      results.push(res);
    } catch (err) {
      console.log(`SCRIPT_ERROR ${err.message}`);
      results.push({
        path: r.path,
        kind: r.kind,
        slug: slugify(r.path),
        category: "ERROR",
        scriptError: err.message,
      });
    }
  }

  await context.close();
  await browser.close();

  fs.writeFileSync(RESULTS_JSON, JSON.stringify(results, null, 2));
  writeReport(results);
  console.log(`\n[audit] results → ${path.relative(ROOT, RESULTS_JSON)}`);
  console.log(`[audit] report  → ${path.relative(ROOT, REPORT_MD)}`);
}

function writeReport(results) {
  const buckets = { HEALTHY: [], DEGRADED: [], BLANK: [], ERROR: [], AUTH_REDIRECT: [] };
  for (const r of results) buckets[r.category]?.push(r);

  const lines = [];
  lines.push(`# Navigation Health Audit`);
  lines.push("");
  lines.push(`**Host:** ${HOST}`);
  lines.push(`**Mode:** UNAUTH (no Clerk session)`);
  lines.push(`**Date:** ${new Date().toISOString()}`);
  lines.push(`**Routes audited:** ${results.length}`);
  lines.push("");
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`| Category | Count |`);
  lines.push(`|----------|-------|`);
  for (const k of ["HEALTHY", "AUTH_REDIRECT", "DEGRADED", "BLANK", "ERROR"]) {
    lines.push(`| ${k} | ${buckets[k].length} |`);
  }
  lines.push("");

  lines.push(`## Coverage caveat`);
  lines.push("");
  lines.push(`This run was **unauthenticated**. Routes protected by \`ProtectedRoute\` /`);
  lines.push(`\`FounderProtectedRoute\` redirect to \`/auth\` and are correctly categorized`);
  lines.push(`as \`AUTH_REDIRECT\` — but their *authenticated render quality* is not`);
  lines.push(`covered. To extend coverage to auth-gated surfaces tomorrow, founder needs to`);
  lines.push(`provide one of:`);
  lines.push("");
  lines.push(`- A Clerk-minted sign-in ticket (\`POST /v1/sign_in_tokens\` against the Clerk`);
  lines.push(`  Backend API with \`CLERK_SECRET_KEY\`) that the script can redeem via`);
  lines.push(`  \`Clerk.client.signIn.create({ strategy: 'ticket', ticket })\` in Playwright.`);
  lines.push(`- Or, more practically: a saved \`storageState.json\` from a logged-in browser`);
  lines.push(`  session (\`page.context().storageState({ path: ... })\`) that the audit can`);
  lines.push(`  load into a new context. This is the lowest-friction path — founder runs it`);
  lines.push(`  once after signing in, hands back the JSON, audit re-runs against all`);
  lines.push(`  protected routes.`);
  lines.push("");
  lines.push(`I deliberately did NOT pull \`CLERK_SECRET_KEY\` from Fly to mint tickets`);
  lines.push(`locally — that's adjacent to the auth-flow modifications the overnight`);
  lines.push(`directive disallows.`);
  lines.push("");

  lines.push(`## Summary table`);
  lines.push("");
  lines.push(`| Path | Kind | Category | HTTP | TTI (ms) | Errors | Notes |`);
  lines.push(`|------|------|----------|------|----------|--------|-------|`);
  for (const r of results) {
    const errCount = (r.consoleErrors?.length ?? 0) + (r.pageErrors?.length ?? 0);
    const failedCount = r.failedRequests?.length ?? 0;
    const note = r.navError
      ? `nav: ${r.navError.slice(0, 60)}`
      : failedCount > 0
        ? `${failedCount} failed XHR`
        : "";
    lines.push(`| \`${r.path}\` | ${r.kind} | ${r.category} | ${r.httpStatus ?? "—"} | ${r.tti ?? "—"} | ${errCount} | ${note} |`);
  }
  lines.push("");

  // Common-pattern detection: error/warning strings appearing in 3+ routes
  const stringCounts = new Map();
  for (const r of results) {
    const all = [...(r.consoleErrors ?? []), ...(r.pageErrors ?? [])];
    for (const e of all) {
      // Truncate to first 80 chars as fingerprint
      const key = e.slice(0, 80);
      stringCounts.set(key, (stringCounts.get(key) ?? 0) + 1);
    }
  }
  const commonPatterns = [...stringCounts.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]);
  if (commonPatterns.length > 0) {
    lines.push(`## Common patterns (3+ routes)`);
    lines.push("");
    for (const [str, count] of commonPatterns) {
      lines.push(`- **${count}× routes:** \`${str.replace(/`/g, "'")}\``);
    }
    lines.push("");
  }

  // Common failed-request patterns
  const reqCounts = new Map();
  for (const r of results) {
    for (const f of r.failedRequests ?? []) {
      const u = new URL(f.url, HOST).pathname;
      reqCounts.set(u, (reqCounts.get(u) ?? 0) + 1);
    }
  }
  const commonReqs = [...reqCounts.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]);
  if (commonReqs.length > 0) {
    lines.push(`## Common failed network requests`);
    lines.push("");
    for (const [u, count] of commonReqs) {
      lines.push(`- **${count}× routes:** \`${u}\``);
    }
    lines.push("");
  }

  // Per-route detail for non-HEALTHY and non-AUTH_REDIRECT
  const detailRoutes = results.filter((r) => r.category !== "HEALTHY" && r.category !== "AUTH_REDIRECT");
  if (detailRoutes.length > 0) {
    lines.push(`## Per-route detail (non-HEALTHY)`);
    lines.push("");
    for (const r of detailRoutes) {
      lines.push(`### \`${r.path}\` — ${r.category}`);
      lines.push("");
      lines.push(`- **Kind:** ${r.kind}`);
      lines.push(`- **Final URL:** ${r.finalUrl ?? "—"}`);
      lines.push(`- **HTTP:** ${r.httpStatus ?? "—"}`);
      lines.push(`- **TTI:** ${r.tti}ms`);
      if (r.navError) lines.push(`- **Nav error:** ${r.navError}`);
      if (r.renderInfo) {
        lines.push(`- **Render:** main=${r.renderInfo.mainTextLen}c body=${r.renderInfo.bodyTextLen}c spinner=${r.renderInfo.hasLoadingSpinner} loading=${r.renderInfo.stillLoadingText}`);
      }
      if (r.pageErrors?.length) {
        lines.push(`- **Page errors:**`);
        for (const e of r.pageErrors) lines.push(`  - \`${e.replace(/`/g, "'")}\``);
      }
      if (r.consoleErrors?.length) {
        lines.push(`- **Console errors (top 5):**`);
        for (const e of r.consoleErrors.slice(0, 5)) lines.push(`  - \`${e.replace(/`/g, "'")}\``);
      }
      if (r.failedRequests?.length) {
        lines.push(`- **Failed requests (top 5):**`);
        for (const f of r.failedRequests.slice(0, 5)) {
          lines.push(`  - \`${f.url}\` (${f.reason})`);
        }
      }
      lines.push(`- **Screenshot:** \`${r.screenshot}\``);
      lines.push("");
    }
  }

  // Recommended fix priority
  lines.push(`## Recommended fix priority`);
  lines.push("");
  lines.push(`1. **ERROR routes (highest)** — broken navigation surfaces; shipping this is`);
  lines.push(`   user-blocking.`);
  lines.push(`2. **BLANK routes on PUBLIC paths** — visible to unauthenticated visitors,`);
  lines.push(`   includes landing/marketing pages.`);
  lines.push(`3. **Common-pattern errors (3+ routes)** — single fix lands wide impact.`);
  lines.push(`4. **DEGRADED routes** — render-but-noisy; lower urgency unless console`);
  lines.push(`   error is itself functional (failed data fetches, not just CSP cosmetic).`);
  lines.push(`5. **BLANK on protected routes** — only confirmable once auth coverage is`);
  lines.push(`   wired up (see "Coverage caveat").`);
  lines.push("");

  fs.writeFileSync(REPORT_MD, lines.join("\n"));
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
