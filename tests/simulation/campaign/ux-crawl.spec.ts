/**
 * Campaign UX crawl — every customer + founder route, four viewports, measured.
 *
 * For each route × persona × viewport (one Playwright test each, so a failure
 * lands on exactly one page) this spec navigates under the E2E test-auth
 * bypass (server/auth/testAuth.ts) and records:
 *
 *   a. HTTP failures (4xx/5xx on same-origin requests), console errors,
 *      uncaught page errors, error-boundary / not-found fallbacks.
 *   b. Text artifacts in the rendered body ("undefined", "NaN", "{{", …).
 *   c. a11y: axe serious/critical violations; icon-only buttons without an
 *      accessible name; form controls without an associated label.
 *   d. Mobile ergonomics (mobile projects only): touch targets < 44×44,
 *      horizontal overflow, sub-12px text, fixed bottom nav presence.
 *   e. Performance: navigation timing, LCP, JS bytes, request count,
 *      largest JS chunk.
 *   f. Loading/empty-state honesty: a skeleton/spinner still up >5s after
 *      network idle; EmptyState presence + whether it carries a CTA.
 *   g. Founder-codename leakage + founder-only nav on customer routes.
 *   h. A screenshot per route×viewport.
 *
 * Results: one JSON line per test in <campaign>/ux/results.jsonl; findings
 * go through the campaign ledger (recordFinding). Only P0/P1 classes fail
 * the test — everything else is evidence for the report, never a fabricated
 * verdict.
 *
 * Runs ONLY via playwright.campaign.config.ts:
 *   PLAYWRIGHT_BASE_URL=http://localhost:5000 \
 *     npx playwright test --config=playwright.campaign.config.ts
 */
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { recordFinding, outDir, type Severity } from "./ledger";
import { CUSTOMER_PERSONAS, FORBIDDEN_EVERYWHERE } from "../../personas/customer-personas";
import { personaCookieValue, E2E_FOUNDER_COOKIE } from "../../../server/auth/testAuth";

test.describe.configure({ mode: "parallel" });

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5000";
const UX_DIR = path.join(outDir(), "ux");
const RESULTS_FILE = path.join(UX_DIR, "results.jsonl");
const SIM = "ux-crawl";

// ── Route population ─────────────────────────────────────────────────────────
// Mirrors tests/e2e/route-sweep.spec.ts (hand-curated, not scraped from
// App.tsx — see the rationale there). Keep in sync.
const CUSTOMER_ROUTES = [
  "/today",
  "/pipeline",
  "/money",
  "/leads",
  "/properties",
  "/deals",
  "/deals/discover",
  "/contractors",
  "/tenants",
  "/leases",
  "/permits",
  "/rehabs",
  "/tasks",
  "/maintenance",
  "/campaigns",
  "/buyer-blasts",
  "/team",
  "/automation",
  "/analytics",
  "/portfolio",
  "/cash-flow",
  "/bookkeeping",
  "/forecasting",
  "/avm",
  "/marketplace",
  "/negotiation",
  "/capital-markets",
  "/market-intelligence",
  "/decision-queue",
  "/inbox",
  "/account/security",
  "/settings",
] as const;

const FOUNDER_ROUTES = [
  "/founder",
  "/founder/ai-observatory",
  "/founder/financials",
  "/founder/compliance-ops",
  "/founder/features",
  "/founder/keys",
  "/founder/readiness",
  "/founder/customers/health",
  "/founder/growth/campaigns",
  "/founder/telemetry",
  "/founder/integrations",
  "/founder/admin/costs",
  "/founder/feedback",
  "/founder/agent-queue",
  "/founder/feed",
  "/founder/beta-analytics",
  "/founder/agents",
  "/founder/daily-digest",
  "/founder/decisions",
  "/founder/letter",
  "/founder/settings",
  "/founder/strategy",
  "/founder/trends",
  "/founder/expansion",
  "/founder/experiments",
  "/founder/todo",
] as const;

// The five customer doors with their REAL routes (App.tsx: /pax redirects to
// /ai; the Map door is /maps — "/map" is a 404). Same as DOOR_ROUTES in
// tests/personas/customer-personas.ts.
const DOOR_ROUTES = ["/today", "/maps", "/deals", "/money", "/ai"] as const;

const PRIMARY_PERSONA = "land-operator-desktop";
const DOOR_PERSONAS = ["note-investor-buyer", "land-rookie-mobile"] as const;
const FOUNDER = "founder";

interface Visit {
  persona: string;
  route: string;
  founder: boolean;
}
const VISITS: Visit[] = [
  ...CUSTOMER_ROUTES.map((route) => ({ persona: PRIMARY_PERSONA, route, founder: false })),
  ...DOOR_PERSONAS.flatMap((persona) => DOOR_ROUTES.map((route) => ({ persona, route, founder: false }))),
  ...FOUNDER_ROUTES.map((route) => ({ persona: FOUNDER, route, founder: true })),
];

// ── Noise filters (same rationale as customer-personas.spec.ts) ──────────────
const BEACON_RE = /\/api\/(telemetry|analytics)\b/;
const ABORTED_RE = /ERR_ABORTED|net::ERR_FAILED|interrupted/i;
// URL-less console echo of a response the response handler already captured.
const REDUNDANT_CONSOLE_RE = /Failed to load resource/i;
// React-Query echoes of HTTP failures (captured with URLs by the response handler).
const REDUNDANT_QUERY_RE = /\[Query Error|Failed to fetch|suppressed toast/i;
// Production build ships no source maps; static-asset 404s are not route defects.
const IGNORABLE_404_RE = /\.map(\?|$)|\.js(\?|$)|\.css(\?|$)|\.png|\.svg|\.ico|\.woff|favicon|manifest/i;
// By-design 404s (ui-state compat, feature-gated white-label).
const EXPECTED_404_RE = /\/api\/(ui-state|white-label)\b/i;
// requireClerkMFA (server/middleware/requireClerkMFA.ts) fails CLOSED when the
// Clerk user lookup fails. Under the local test-auth bypass there is no Clerk
// user, so every /api/founder/* + /api/admin/* data read answers 403
// "Could not verify MFA status". That is the environment, not the page —
// recorded as `degraded` (with the reason) so the founder crawl still
// measures layout/leaks/a11y of the pages honestly, without 104 bogus 4xx.
const MFA_GATED_RE = /\/api\/(founder|admin)\//i;

const TEXT_ARTIFACTS: Array<{ label: string; re: RegExp }> = [
  { label: "undefined", re: /\bundefined\b/ },
  { label: "null", re: /\bnull\b/ },
  { label: "NaN", re: /\bNaN\b/ },
  { label: "[object Object]", re: /\[object Object\]/ },
  { label: "Invalid Date", re: /Invalid Date/ },
  { label: "Infinity%", re: /Infinity%/ },
  { label: "$NaN", re: /\$NaN/ },
  { label: "Lorem ipsum", re: /lorem ipsum/i },
  { label: "TODO", re: /\bTODO\b/ },
  { label: "{{", re: /\{\{/ },
];

// A NAMED progressbar (the Getting Started checklist, due-diligence progress
// — aria-label "Getting started: 2 of 5 steps complete") is CONTENT. An
// unnamed one is the loader idiom. Radix <Progress> omits aria-valuenow while
// its value is undefined, so "determinate" is not a usable discriminator.
const SKELETON_SELECTOR =
  '[role="progressbar"]:not([aria-label]):not([aria-labelledby]), .animate-pulse, .animate-spin, [data-testid="app-loading"]';
const SKELETON_GRACE_MS = 5_000;

// ── Result shape (one line per test in results.jsonl) ────────────────────────
interface AxeViolation {
  id: string;
  impact: string;
  count: number;
  firstTarget: string;
}
interface RouteResult {
  sim: string;
  at: string;
  persona: string;
  viewport: string;
  isMobile: boolean;
  route: string;
  finalUrl: string;
  http: {
    documentStatus: number | null;
    failures5xx: string[];
    failures4xx: string[];
    rateLimited429: string[];
    requestFailed: string[];
    degraded: string[];
  };
  console: { errors: string[]; pageErrors: string[]; queryEchoes: number };
  errorBoundary: boolean;
  notFound: boolean;
  textArtifacts: Array<{ label: string; snippet: string }>;
  a11y: {
    axeRan: boolean;
    critical: AxeViolation[];
    serious: AxeViolation[];
    iconOnlyButtonsUnlabeled: { count: number; first: string[] };
    inputsUnlabeled: { count: number; first: string[] };
  };
  mobile: null | {
    touchTargetViolations: { count: number; first: string[] };
    horizontalOverflow: { present: boolean; scrollWidth: number; innerWidth: number };
    smallTextCount: number;
    fixedBottomNavPresent: boolean;
  };
  perf: {
    domContentLoaded: number | null;
    load: number | null;
    lcp: number | null;
    jsTransferredBytes: number;
    requestCount: number;
    largestJsChunk: { name: string; bytes: number } | null;
  };
  /** First-run overlays dismissed before measuring (see claimIdentity). */
  preDismissed: string[];
  honesty: {
    skeletonAfterIdleMs: number | null;
    skeletonStuck: boolean;
    /** The visible skeleton/spinner elements when stuck (first 3). */
    skeletonSelectors: string[];
    emptyStatePresent: boolean;
    emptyStateHasCta: boolean | null;
    bodyTextLength: number;
  };
  leak: { codenames: string[]; founderNavLinks: number };
  screenshot: string;
  findings: Array<{ sev: Severity; title: string }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function routeSlug(route: string): string {
  return route.replace(/^\//, "").replace(/\//g, "_") || "root";
}

function appendResult(r: RouteResult) {
  fs.mkdirSync(UX_DIR, { recursive: true });
  fs.appendFileSync(RESULTS_FILE, JSON.stringify(r) + "\n");
}

// One identity bootstrap per worker per persona. A first authed GET provisions
// the org (getOrCreateOrg); for customer personas the onboarding call sets the
// businessType/noteRole so the persona frame (vocab, Finance hero, modules)
// is live. Idempotent against orgs other sims already seeded.
//
// First-run blockers are pre-dismissed so the crawl measures the product, not
// the same two overlays 272 times: the AI-disclosure modal (a non-closable
// Dialog that intercepts pointer events until /api/me/ai-disclosure/accept is
// recorded for the CURRENT version — read from the source, exactly as
// tests/e2e-mobile/global-setup.ts does, so a wording bump cannot silently
// re-block the crawl) and the cookie-consent banner (localStorage). The
// results line records `preDismissed` so nobody mistakes this for a first-run
// measurement.
const AI_DISCLOSURE_VERSION = (() => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "client/src/components/onboarding/AiDisclosureDialog.tsx"),
    "utf8",
  );
  const m = /export const AI_DISCLOSURE_VERSION\s*=\s*"([^"]+)"/.exec(src);
  if (!m) throw new Error("AI_DISCLOSURE_VERSION not found in AiDisclosureDialog.tsx");
  return m[1];
})();
const PRE_DISMISSED = ["ai-disclosure-dialog", "cookie-consent-banner", "pwa-install-prompt"] as const;

const bootstrapped = new Set<string>();
async function claimIdentity(ctx: BrowserContext, persona: string, founder: boolean) {
  // CSRF is double-submit (server/middleware/csrf.ts): a `csrf_token` cookie
  // mirrored into `x-csrf-token`. The server does not mint the cookie on a
  // GET under test-auth, so the crawl mints its own, exactly as
  // tests/simulation/campaign/client.ts does.
  const csrf = `campaign-ux-${Math.random().toString(36).slice(2)}`;
  await ctx.addCookies([
    {
      name: "__session",
      value: founder ? E2E_FOUNDER_COOKIE : personaCookieValue(persona),
      url: BASE_URL,
    },
    { name: "csrf_token", value: csrf, url: BASE_URL },
  ]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("acreos_cookie_consent", "accepted");
      // The iOS "Add to Home Screen" coach-mark (pwa-install-prompt.tsx)
      // covers the top of every mobile page for 7 days per dismissal.
      localStorage.setItem("pwa-install-dismissed", Date.now().toString());
    } catch {
      /* private mode etc. */
    }
  });
  if (bootstrapped.has(persona)) return;
  bootstrapped.add(persona);
  await ctx.request.get("/api/auth/user").catch(() => undefined);
  await ctx.request
    .post("/api/me/ai-disclosure/accept", {
      headers: { "X-CSRF-Token": csrf },
      data: { version: AI_DISCLOSURE_VERSION },
    })
    .catch(() => undefined);
  if (founder) return;
  const p = CUSTOMER_PERSONAS.find((c) => c.slug === persona);
  if (!p) return;
  await ctx.request
    .post("/api/onboarding/complete", {
      headers: { "X-CSRF-Token": csrf },
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

async function runAxe(page: Page): Promise<{ ran: boolean; violations: AxeViolation[] }> {
  try {
    await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
    const raw = await page.evaluate(async () => {
      // @ts-expect-error injected global
      if (typeof axe === "undefined") return null;
      const run = (async () => {
        // @ts-expect-error injected global
        const r = await axe.run(document, { resultTypes: ["violations"] });
        return r.violations as Array<{
          id: string;
          impact?: string;
          nodes: Array<{ target: unknown[] }>;
        }>;
      })();
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000));
      const v = await Promise.race([run, timeout]);
      if (!v) return null;
      return v
        .filter((x) => x.impact === "critical" || x.impact === "serious")
        .map((x) => ({
          id: x.id,
          impact: x.impact ?? "",
          count: x.nodes.length,
          firstTarget: x.nodes[0]
            ? Array.isArray(x.nodes[0].target)
              ? x.nodes[0].target.join(" ")
              : String(x.nodes[0].target)
            : "",
        }));
    });
    if (raw === null) return { ran: false, violations: [] };
    return { ran: true, violations: raw };
  } catch {
    return { ran: false, violations: [] };
  }
}

/** DOM-level measurements that need no injected library. Runs in-page. */
async function measureDom(page: Page, opts: { mobile: boolean }) {
  return page.evaluate(({ mobile }) => {
    const sel = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const tid = el.getAttribute("data-testid");
      if (tid) return `${tag}[data-testid="${tid}"]`;
      if (el.id) return `${tag}#${el.id}`;
      const al = el.getAttribute("aria-label");
      if (al) return `${tag}[aria-label="${al.slice(0, 40)}"]`;
      const name = el.getAttribute("name");
      if (name) return `${tag}[name="${name}"]`;
      const txt = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      const parent = el.parentElement;
      const idx = parent ? Array.from(parent.children).indexOf(el) + 1 : 0;
      const ptid = parent?.closest("[data-testid]")?.getAttribute("data-testid");
      return `${ptid ? `[data-testid="${ptid}"] ` : ""}${tag}:nth-child(${idx})${txt ? ` "${txt}"` : ""}`;
    };
    const visible = (el: Element): boolean => {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    // Icon-only buttons without an accessible name.
    const iconOnly: string[] = [];
    document.querySelectorAll('button, [role="button"]').forEach((el) => {
      if (!visible(el)) return;
      const text = (el.textContent ?? "").trim();
      if (text) return;
      if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title")) return;
      if (el.querySelector("img[alt]:not([alt=''])")) return;
      iconOnly.push(sel(el));
    });

    // Form controls without an associated label.
    const unlabeled: string[] = [];
    document.querySelectorAll("input, select, textarea").forEach((el) => {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      if (["hidden", "submit", "button", "reset", "image"].includes(type)) return;
      if (!visible(el)) return;
      if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title")) return;
      if (el.closest("label")) return;
      if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return;
      unlabeled.push(sel(el));
    });

    // Error boundary / not-found surfaces.
    const bodyText = document.body?.innerText ?? "";
    const errorBoundary =
      document.querySelectorAll('[data-testid="error-boundary"], [class*="error-boundary"]').length > 0 ||
      /something went wrong/i.test(bodyText);
    const notFound =
      document.querySelectorAll('[data-testid="page-not-found"]').length > 0 ||
      /page not found/i.test(bodyText) ||
      /^\s*404\s*$/m.test(bodyText);

    // Empty state (canonical primitive renders data-testid="empty-state" by default).
    const empty = document.querySelector('[data-testid="empty-state"], [data-testid$="-empty-state"]');
    const emptyStatePresent = !!empty && visible(empty);
    const emptyStateHasCta = emptyStatePresent
      ? Array.from(empty!.querySelectorAll("button, a[href]")).some((c) => visible(c))
      : null;

    // Founder-only nav visible to a customer.
    const founderNavLinks = Array.from(document.querySelectorAll('a[href^="/founder"]')).filter(visible).length;

    // Perf from the browser's own timeline.
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    let jsBytes = 0;
    let largest: { name: string; bytes: number } | null = null;
    for (const r of resources) {
      if (!/\.js(\?|$)/.test(r.name) && r.initiatorType !== "script") continue;
      const b = r.transferSize || r.encodedBodySize || 0;
      jsBytes += b;
      if (!largest || b > largest.bytes) largest = { name: r.name.replace(location.origin, ""), bytes: b };
    }
    // @ts-expect-error set by the init script
    const lcp: number | null = typeof window.__lcp === "number" ? Math.round(window.__lcp) : null;

    let mobileOut: null | {
      touchTargetViolations: { count: number; first: string[] };
      horizontalOverflow: { present: boolean; scrollWidth: number; innerWidth: number };
      smallTextCount: number;
      fixedBottomNavPresent: boolean;
    } = null;
    if (mobile) {
      const tt: string[] = [];
      document.querySelectorAll('button, a[href], [role="button"], [role="link"], input:not([type="hidden"]), select, textarea').forEach((el) => {
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden" || s.pointerEvents === "none") return;
        if ((el as HTMLButtonElement).disabled) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        // Only what is actually on screen; offscreen rows in a long list are
        // not what a thumb meets first.
        if (r.bottom < 0 || r.top > window.innerHeight) return;
        const w = Math.round(r.width);
        const h = Math.round(r.height);
        if (w < 44 || h < 44) tt.push(`${sel(el)} ${w}×${h}`);
      });
      let small = 0;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const seen = new Set<Element>();
      let n: Node | null;
      while ((n = walker.nextNode())) {
        if (!n.textContent || !n.textContent.trim()) continue;
        const el = n.parentElement;
        if (!el || seen.has(el)) continue;
        seen.add(el);
        if (!visible(el)) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs && fs < 12) small++;
      }
      const bottomNav = document.querySelector('[data-testid="mobile-bottom-nav"]');
      const fixedBottomNavPresent =
        !!bottomNav && visible(bottomNav) && getComputedStyle(bottomNav).position === "fixed";
      mobileOut = {
        touchTargetViolations: { count: tt.length, first: tt.slice(0, 3) },
        horizontalOverflow: {
          present: document.documentElement.scrollWidth > window.innerWidth + 1,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        },
        smallTextCount: small,
        fixedBottomNavPresent,
      };
    }

    return {
      bodyText,
      iconOnly,
      unlabeled,
      errorBoundary,
      notFound,
      emptyStatePresent,
      emptyStateHasCta,
      founderNavLinks,
      perf: {
        domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
        load: nav ? Math.round(nav.loadEventEnd || nav.domContentLoadedEventEnd) : null,
        lcp,
        jsTransferredBytes: jsBytes,
        requestCount: resources.length + 1,
        largestJsChunk: largest,
      },
      mobile: mobileOut,
    };
  }, opts);
}

function snippetAround(text: string, re: RegExp): string {
  const m = re.exec(text);
  if (!m) return "";
  const start = Math.max(0, m.index - 40);
  return text.slice(start, m.index + m[0].length + 40).replace(/\s+/g, " ");
}

// ── The crawl ────────────────────────────────────────────────────────────────
for (const v of VISITS) {
  test(`ux · ${v.persona} · ${v.route}`, async ({ page, context }, testInfo) => {
    const viewport = testInfo.project.name;
    const isMobile = Boolean((testInfo.project.use as { isMobile?: boolean }).isMobile);

    await claimIdentity(context, v.persona, v.founder);
    // Collect LCP from the page's own observer, buffered so entries before
    // script execution still count.
    await context.addInitScript(() => {
      // @ts-expect-error test-only global
      window.__lcp = null;
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) {
            // @ts-expect-error test-only global
            window.__lcp = e.startTime;
          }
        }).observe({ type: "largest-contentful-paint", buffered: true });
      } catch {
        /* unsupported */
      }
    });

    const origin = new URL(BASE_URL).origin;
    const failures5xx: string[] = [];
    const failures4xx: string[] = [];
    const rateLimited429: string[] = [];
    const requestFailed: string[] = [];
    const degraded: string[] = [];
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    let queryEchoes = 0;
    let documentStatus: number | null = null;

    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (REDUNDANT_CONSOLE_RE.test(t)) return;
      if (REDUNDANT_QUERY_RE.test(t)) {
        queryEchoes++;
        return;
      }
      consoleErrors.push(t.slice(0, 300));
    });
    page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 300)));
    page.on("requestfailed", (r) => {
      const url = r.url();
      if (!url.startsWith(origin)) return;
      const err = r.failure()?.errorText ?? "failed";
      if (ABORTED_RE.test(err)) return;
      const line = `${r.method()} ${url.replace(origin, "")} — ${err}`;
      if (BEACON_RE.test(url)) degraded.push(line);
      else requestFailed.push(line);
    });
    page.on("response", (r) => {
      const url = r.url();
      if (!url.startsWith(origin)) return;
      const status = r.status();
      const req = r.request();
      if (req.resourceType() === "document" && documentStatus === null) documentStatus = status;
      if (status < 400) return;
      const line = `${status} ${req.method()} ${url.replace(origin, "")}`;
      if (status >= 500) {
        if (BEACON_RE.test(url)) degraded.push(line);
        else failures5xx.push(line);
        return;
      }
      if (status === 429) {
        rateLimited429.push(line);
        return;
      }
      if (status === 404 && (IGNORABLE_404_RE.test(url) || EXPECTED_404_RE.test(url))) return;
      if (status === 403 && MFA_GATED_RE.test(url)) {
        degraded.push(`${line} (mfa-gated: Clerk lookup unavailable under test-auth)`);
        return;
      }
      failures4xx.push(line);
    });

    // Navigate + settle: DOM, network, app shell, then a beat for lazy chunks.
    const navErrors: string[] = [];
    await page.goto(v.route, { waitUntil: "domcontentloaded" }).catch((e) => navErrors.push(String(e.message ?? e)));
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page
      .locator('[data-testid="app-loading"], [aria-label="Loading AcreOS"]')
      .first()
      .waitFor({ state: "detached", timeout: 12_000 })
      .catch(() => undefined);
    await page.waitForTimeout(600);

    // Loading honesty: is a skeleton/spinner still up, and for how long past
    // network idle? Poll up to the grace window; a visible skeleton that
    // outlives it is a page that never resolved to data, empty, or error.
    const idleAt = Date.now();
    let skeletonAfterIdleMs: number | null = null;
    let skeletonStuck = false;
    let skeletonSelectors: string[] = [];
    // Visible skeleton/spinner elements, named so a stuck one can be traced
    // to the component that rendered it (a persistent `.animate-pulse` live
    // dot would otherwise be indistinguishable from a page that never loaded).
    const visibleSkeletons = async (): Promise<string[]> =>
      page
        .evaluate((selector) => {
          const out: string[] = [];
          document.querySelectorAll(selector).forEach((el) => {
            const s = getComputedStyle(el);
            if (s.display === "none" || s.visibility === "hidden") return;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return;
            const tid = el.getAttribute("data-testid");
            const ptid = el.parentElement?.closest("[data-testid]")?.getAttribute("data-testid");
            out.push(
              `${el.tagName.toLowerCase()}${tid ? `[data-testid="${tid}"]` : ""}` +
                `${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""}` +
                `${ptid && !tid ? ` in [data-testid="${ptid}"]` : ""} ${Math.round(r.width)}×${Math.round(r.height)}`,
            );
          });
          return out;
        }, SKELETON_SELECTOR)
        .catch(() => []);
    let current = await visibleSkeletons();
    if (current.length) {
      skeletonAfterIdleMs = 0;
      const deadline = idleAt + SKELETON_GRACE_MS;
      while (Date.now() < deadline) {
        await page.waitForTimeout(500);
        current = await visibleSkeletons();
        if (!current.length) {
          skeletonAfterIdleMs = Date.now() - idleAt;
          break;
        }
      }
      if (current.length) {
        skeletonAfterIdleMs = Date.now() - idleAt;
        skeletonStuck = true;
        skeletonSelectors = current.slice(0, 3);
      }
    }

    // Screenshot (viewport-sized; the full page can be tens of thousands of px
    // on list routes and is not what a user sees).
    const shotDir = path.join(UX_DIR, v.persona, viewport);
    fs.mkdirSync(shotDir, { recursive: true });
    const screenshot = path.join(shotDir, `${routeSlug(v.route)}.png`);
    await page.screenshot({ path: screenshot, fullPage: false }).catch(() => undefined);

    // Measurements.
    const dom = await measureDom(page, { mobile: isMobile }).catch(() => null);
    const axe = await runAxe(page);
    const bodyText = dom?.bodyText ?? "";

    const textArtifacts = TEXT_ARTIFACTS.filter((a) => a.re.test(bodyText)).map((a) => ({
      label: a.label,
      snippet: snippetAround(bodyText, a.re),
    }));
    const codenames = v.founder ? [] : FORBIDDEN_EVERYWHERE.filter((s) => bodyText.includes(s));
    const founderNavLinks = v.founder ? 0 : (dom?.founderNavLinks ?? 0);

    // ── Findings → ledger ───────────────────────────────────────────────────
    const findings: Array<{ sev: Severity; title: string }> = [];
    const where = `${v.persona} @ ${viewport} ${v.route}`;
    const idBase = `UX-${v.persona}-${viewport}-${routeSlug(v.route)}`;
    const area = v.founder ? "founder-ui" : "customer-ui";
    const file = (sev: Severity, kind: string, title: string, evidence: string, impact?: string) => {
      findings.push({ sev, title });
      recordFinding({
        id: `${idBase}-${kind}`,
        product: "AcreOS",
        sev,
        area,
        title,
        evidence,
        impact,
        repro: `GET ${v.route} as ${v.persona} at ${viewport}`,
        sim: SIM,
      });
    };

    if (codenames.length || founderNavLinks > 0) {
      file(
        "P0",
        "founder-leak",
        `Founder surface leaks to customer: ${where}`,
        [
          codenames.length ? `codenames in body: ${codenames.join(", ")}` : "",
          founderNavLinks ? `${founderNavLinks} visible link(s) to /founder/*` : "",
        ]
          .filter(Boolean)
          .join("; "),
        "A paying customer can see founder-only vocabulary or navigation.",
      );
    }
    if (failures5xx.length) {
      file("P1", "http-5xx", `5xx on ${where}`, failures5xx.slice(0, 5).join("\n"));
    }
    if (pageErrors.length) {
      file("P1", "page-error", `Uncaught page error on ${where}`, pageErrors.slice(0, 3).join("\n"));
    }
    if (consoleErrors.length) {
      file("P1", "console-error", `Console error on ${where}`, consoleErrors.slice(0, 3).join("\n"));
    }
    if (navErrors.length || dom?.errorBoundary) {
      file(
        "P1",
        "error-boundary",
        `Error boundary / navigation failure on ${where}`,
        navErrors[0] ?? "error-boundary fallback rendered",
      );
    }
    if (dom?.notFound) {
      file("P2", "not-found", `Not-found surface on a listed route: ${where}`, bodyText.slice(0, 160));
    }
    if (textArtifacts.length) {
      file(
        "P2",
        "text-artifact",
        `Text artifact (${textArtifacts.map((t) => t.label).join(", ")}) on ${where}`,
        textArtifacts.map((t) => `${t.label}: …${t.snippet}…`).join("\n"),
      );
    }
    const critical = axe.violations.filter((x) => x.impact === "critical");
    const serious = axe.violations.filter((x) => x.impact === "serious");
    if (critical.length) {
      file(
        "P2",
        "axe-critical",
        `axe critical: ${critical.map((c) => `${c.id}×${c.count}`).join(", ")} on ${where}`,
        critical.map((c) => `${c.id} (${c.count}) first: ${c.firstTarget}`).join("\n"),
      );
    }
    if (serious.length) {
      file(
        "P3",
        "axe-serious",
        `axe serious: ${serious.map((c) => `${c.id}×${c.count}`).join(", ")} on ${where}`,
        serious.map((c) => `${c.id} (${c.count}) first: ${c.firstTarget}`).join("\n"),
      );
    }
    if (dom?.mobile) {
      if (dom.mobile.touchTargetViolations.count) {
        file(
          "UX",
          "touch-target",
          `${dom.mobile.touchTargetViolations.count} on-screen touch target(s) < 44×44 on ${where}`,
          dom.mobile.touchTargetViolations.first.join("\n"),
        );
      }
      if (dom.mobile.horizontalOverflow.present) {
        file(
          "UX",
          "h-overflow",
          `Horizontal overflow on ${where}`,
          `scrollWidth=${dom.mobile.horizontalOverflow.scrollWidth} innerWidth=${dom.mobile.horizontalOverflow.innerWidth}`,
        );
      }
    }
    if (skeletonStuck) {
      file(
        "UX",
        "skeleton-stuck",
        `Skeleton/spinner still visible ${Math.round((skeletonAfterIdleMs ?? 0) / 1000)}s after network idle on ${where}`,
        skeletonSelectors.join("\n") || `selector: ${SKELETON_SELECTOR}`,
        "The page never resolved to content, an empty state, or an error for the user.",
      );
    }

    const result: RouteResult = {
      sim: SIM,
      at: new Date().toISOString(),
      persona: v.persona,
      viewport,
      isMobile,
      route: v.route,
      finalUrl: page.url().replace(origin, ""),
      http: { documentStatus, failures5xx, failures4xx, rateLimited429, requestFailed, degraded },
      console: { errors: consoleErrors, pageErrors, queryEchoes },
      errorBoundary: Boolean(dom?.errorBoundary) || navErrors.length > 0,
      notFound: Boolean(dom?.notFound),
      textArtifacts,
      a11y: {
        axeRan: axe.ran,
        critical,
        serious,
        iconOnlyButtonsUnlabeled: { count: dom?.iconOnly.length ?? 0, first: (dom?.iconOnly ?? []).slice(0, 3) },
        inputsUnlabeled: { count: dom?.unlabeled.length ?? 0, first: (dom?.unlabeled ?? []).slice(0, 3) },
      },
      mobile: dom?.mobile ?? null,
      perf: dom?.perf ?? {
        domContentLoaded: null,
        load: null,
        lcp: null,
        jsTransferredBytes: 0,
        requestCount: 0,
        largestJsChunk: null,
      },
      preDismissed: [...PRE_DISMISSED],
      honesty: {
        skeletonAfterIdleMs,
        skeletonStuck,
        skeletonSelectors,
        emptyStatePresent: Boolean(dom?.emptyStatePresent),
        emptyStateHasCta: dom?.emptyStateHasCta ?? null,
        bodyTextLength: bodyText.length,
      },
      leak: { codenames, founderNavLinks },
      screenshot: path.relative(process.cwd(), screenshot),
      findings,
    };
    appendResult(result);
    await testInfo.attach("route-result", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });

    // Only the classes that mean "the page broke or leaked" fail the test;
    // everything else is evidence for the report.
    const hard = findings.filter((f) => f.sev === "P0" || f.sev === "P1").map((f) => `[${f.sev}] ${f.title}`);
    expect(hard, `${where}: ${hard.length} hard finding(s)`).toEqual([]);
  });
}
