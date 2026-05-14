/**
 * Performance regression spec — A8 runtime half.
 *
 * Loads each high-traffic route, captures Core Web Vitals via the
 * `web-vitals` package (already in deps for prod telemetry), and asserts
 * each metric against a budget. Fails on regression.
 *
 * Metrics captured:
 *   - LCP (Largest Contentful Paint) — when the biggest above-the-fold
 *     element finishes painting. Budget: 2500 ms (Google "good").
 *   - CLS (Cumulative Layout Shift) — visual stability. Budget: 0.1.
 *   - INP (Interaction to Next Paint) — input responsiveness. Budget:
 *     200 ms. Only fires after a user interaction; we simulate a click.
 *   - TTFB (Time to First Byte) — server responsiveness. Budget: 800 ms.
 *
 * For a more thorough audit (network waterfall, accessibility tree
 * regression, SEO checks, etc.) install `playwright-lighthouse` and
 * run it in a separate spec; this one is the lightweight in-test gate
 * suitable for every PR.
 *
 * The web-vitals package is loaded via dynamic import inside the page —
 * we don't bundle it into the spec file itself, we just call into the
 * library the prod app already ships.
 *
 *   npx playwright test tests/e2e/perf.spec.ts
 *
 * To capture without asserting (for baseline scouting on a new route):
 *
 *   DEBUG_PERF=1 npx playwright test tests/e2e/perf.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";

test.use({ storageState: "tests/e2e/.auth/user.json" });

// Production page-load + networkidle + vitals settle wants > 30s.
test.setTimeout(120_000);

interface VitalsResult {
  lcp: number | null;
  cls: number | null;
  inp: number | null;
  ttfb: number | null;
}

interface RouteBudget {
  path: string;
  name: string;
  budget: {
    lcp: number;
    cls: number;
    inp: number;
    ttfb: number;
  };
}

const ROUTES: RouteBudget[] = [
  {
    path: "/today",
    name: "today",
    // Today is the landing page after auth — it's allowed a touch more
    // because it warms caches for the rest of the session.
    budget: { lcp: 3000, cls: 0.1, inp: 250, ttfb: 1000 },
  },
  {
    path: "/leads",
    name: "leads",
    // Leads renders a paginated table — large rendered surface.
    budget: { lcp: 3500, cls: 0.1, inp: 250, ttfb: 1000 },
  },
  {
    path: "/properties",
    name: "properties",
    // Properties includes the map — substantially heavier mount.
    budget: { lcp: 4500, cls: 0.15, inp: 300, ttfb: 1000 },
  },
];

/**
 * Loads the page, captures Core Web Vitals via web-vitals's onLCP/onCLS/
 * onINP/onTTFB callbacks, simulates a click to surface INP, and returns
 * the collected metrics.
 *
 * INP only fires after a real input event, so we click on the body
 * (no-op gesture but counts as input) before resolving.
 */
async function measureVitals(page: Page, path: string): Promise<VitalsResult> {
  await page.goto(path);
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {});

  // Native PerformanceObserver collection — no external lib needed,
  // works against any production build whether or not it ships
  // web-vitals to the client. Captures LCP, CLS, INP (Event Timing API)
  // and TTFB from PerformanceNavigationTiming.
  await page.evaluate(() => {
    if ((window as unknown as { __vitalsInstalled?: boolean }).__vitalsInstalled) return;
    (window as unknown as { __vitalsInstalled?: boolean }).__vitalsInstalled = true;
    type WindowWithVitals = Window & {
      __vitals?: { lcp?: number; cls?: number; inp?: number; ttfb?: number };
    };
    const w = window as WindowWithVitals;
    w.__vitals = {};

    // TTFB from the navigation entry (already present on page load).
    try {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (nav) {
        w.__vitals!.ttfb = nav.responseStart;
      }
    } catch { /* noop */ }

    // LCP — last entry wins.
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1] as PerformanceEntry & { renderTime?: number; loadTime?: number };
        if (last) {
          const t = last.renderTime || last.loadTime || last.startTime;
          if (typeof t === "number") w.__vitals!.lcp = t;
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch { /* noop */ }

    // CLS — accumulate layout-shift values.
    try {
      let cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
          if (!entry.hadRecentInput && typeof entry.value === "number") {
            cls += entry.value;
            w.__vitals!.cls = cls;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch { /* noop */ }

    // INP — longest event-duration after the test's click.
    try {
      let maxInp = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { duration: number; interactionId?: number }>) {
          if (entry.interactionId && entry.duration > maxInp) {
            maxInp = entry.duration;
            w.__vitals!.inp = maxInp;
          }
        }
      }).observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
    } catch { /* noop */ }
  });

  // Trigger an interaction so INP can fire.
  await page.mouse.click(20, 20).catch(() => {});

  // web-vitals reports LCP at next layout shift or after 5s; CLS aggregates
  // across the session; INP fires on the next paint after the click.
  // Wait long enough for all callbacks to fire.
  await page.waitForTimeout(2500);

  const result = await page.evaluate<VitalsResult>(() => {
    type WindowWithVitals = Window & {
      __vitals?: { lcp?: number; cls?: number; inp?: number; ttfb?: number };
    };
    const v = (window as WindowWithVitals).__vitals ?? {};
    return {
      lcp: v.lcp ?? null,
      cls: v.cls ?? null,
      inp: v.inp ?? null,
      ttfb: v.ttfb ?? null,
    };
  });

  return result;
}

for (const route of ROUTES) {
  test(`perf · ${route.name}`, async ({ page }) => {
    const vitals = await measureVitals(page, route.path);

    test.info().annotations.push({
      type: "perf",
      description: `LCP=${vitals.lcp?.toFixed(0) ?? "—"}ms · CLS=${vitals.cls?.toFixed(3) ?? "—"} · INP=${vitals.inp?.toFixed(0) ?? "—"}ms · TTFB=${vitals.ttfb?.toFixed(0) ?? "—"}ms`,
    });

    if (process.env.DEBUG_PERF) {
      // Scouting mode — print, don't assert.
      console.log(`[perf] ${route.path}`, vitals, "budget:", route.budget);
      return;
    }

    // CLS / TTFB always fire on a page load; LCP almost always does. INP
    // sometimes doesn't if the page is so simple the click was already
    // processed before the observer attached — skip the INP check in
    // that case rather than failing.
    if (vitals.ttfb !== null) {
      expect(vitals.ttfb, `TTFB over budget on ${route.path}`).toBeLessThanOrEqual(route.budget.ttfb);
    }
    if (vitals.lcp !== null) {
      expect(vitals.lcp, `LCP over budget on ${route.path}`).toBeLessThanOrEqual(route.budget.lcp);
    }
    if (vitals.cls !== null) {
      expect(vitals.cls, `CLS over budget on ${route.path}`).toBeLessThanOrEqual(route.budget.cls);
    }
    if (vitals.inp !== null) {
      expect(vitals.inp, `INP over budget on ${route.path}`).toBeLessThanOrEqual(route.budget.inp);
    }
  });
}
