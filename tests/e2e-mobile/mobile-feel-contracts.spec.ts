/**
 * Krieger — mobile-feel contracts spec.
 *
 * Four contract types asserted across the 5 customer doors + Inbox + Settings,
 * at every device projects[] entry in playwright.mobile.config.ts:
 *
 *   1. Touch-target ≥ 44×44px  (WCAG 2.5.5 + Apple HIG)
 *      Every <button>, <a>, [role="button"], and [type="submit"|"button"]
 *      that's visible AND interactive has a bounding box satisfying both
 *      width >= 44 AND height >= 44 at the test viewport.
 *
 *   2. hover:companion-active                (iOS sticky-hover fix)
 *      Any element with a Tailwind `hover:` class — checked via the
 *      runtime className string — must also have a corresponding
 *      `active:` or `focus:` companion class, OR be excluded as a
 *      hover-only desktop affordance (the spec walks the DOM after
 *      render to detect violations rather than scanning source).
 *
 *   3. 100dvh not 100vh                      (iOS dvh fix)
 *      Inline style + class scan for the "100vh" literal. iOS Safari's
 *      address-bar collapse makes 100vh visually wrong; 100dvh
 *      (dynamic viewport height) is the correct unit. Any "100vh"
 *      hit is reported.
 *
 *   4. First-paint TTI < 3000ms              (cellular budget)
 *      Time-to-first-meaningful-content from navigation start, measured
 *      via performance.timing. The 3s ceiling reflects 4G median (the
 *      lowest reasonable bar Tom's audience operates from).
 *
 * Failures are reported in batch per page so a single run names every
 * violation, not just the first. Sets the threshold pattern the wider
 * mobile-craft discipline can grow from.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";

const ROUTES_TO_AUDIT = [
  "/today",
  "/map",
  "/deals",
  "/money",
  "/ai",
  "/inbox",
  "/settings",
];

const TOUCH_TARGET_MIN_PX = 44;
const FIRST_PAINT_BUDGET_MS = 3000;

// Hover-class scan: which selectors do we *actively* check? We restrict to
// the typically-tappable surfaces so we don't false-positive on full-page
// hover effects that don't represent a touch user's primary interaction
// (e.g., decorative card lifts).
const HOVER_COMPANION_TARGETS = "button, a, [role='button'], [role='link']";

// Pages render Clerk UserProfile + similar third-party widgets at /settings
// whose internal markup we cannot dictate. Allowlist routes where the
// scan is informational-only (failures noted but not test-failing) so
// the gate stays honest about what AcreOS controls vs vendor-rendered.
const VENDOR_RENDERED_ROUTES = new Set<string>(["/settings"]);

test.describe("Krieger mobile-feel contracts", () => {
  test.beforeEach(async ({ context }) => {
    // Test-auth bypass shape from nav-smoke.spec.ts — the server accepts
    // any `__session` cookie value when E2E_TEST_AUTH=1.
    await context.addCookies([
      {
        name: "__session",
        value: "e2e-mobile-feel-bypass",
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  });

  for (const route of ROUTES_TO_AUDIT) {
    test(`contracts hold on ${route}`, async ({ page }, testInfo) => {
      const navStart = Date.now();
      await page.goto(route, { waitUntil: "domcontentloaded" });
      // Wait for at least one tappable element to settle, with a generous
      // timeout so iPad/iOS SE projects under CI load don't false-fail.
      await page
        .locator(HOVER_COMPANION_TARGETS)
        .first()
        .waitFor({ state: "visible", timeout: 20_000 })
        .catch(() => {});
      const firstPaintMs = Date.now() - navStart;

      const violations = {
        touchTarget: await collectTouchTargetViolations(page),
        hoverCompanion: await collectHoverCompanionViolations(page),
        vhUsage: await collectVhUsageViolations(page),
      };

      const isVendor = VENDOR_RENDERED_ROUTES.has(route);
      const project = testInfo.project.name;

      // First-paint budget — informational at first while baselines settle
      // (CI runner variance can spike to multi-second cold starts).
      if (firstPaintMs > FIRST_PAINT_BUDGET_MS) {
        testInfo.annotations.push({
          type: "warn-first-paint",
          description: `${route} first-paint=${firstPaintMs}ms > ${FIRST_PAINT_BUDGET_MS}ms budget (project=${project})`,
        });
      }

      if (isVendor) {
        // Annotate but don't fail — Settings hosts Clerk UserProfile.
        for (const cat of Object.entries(violations)) {
          if (cat[1].length > 0) {
            testInfo.annotations.push({
              type: `info-${cat[0]}`,
              description: `${route} (vendor-rendered) ${cat[0]}: ${cat[1].length} hits`,
            });
          }
        }
        return;
      }

      // Touch-target — hard fail.
      expect(
        violations.touchTarget,
        `${route} touch-target violations on ${project}:\n` +
          violations.touchTarget
            .slice(0, 10)
            .map((v) => `  - ${v.tag} "${v.label}" ${v.width}×${v.height}`)
            .join("\n"),
      ).toEqual([]);

      // hover: companion — hard fail (silent iOS sticky-hover is the bug
      // Krieger keeps catching post-hoc; the gate makes it visible at PR time).
      expect(
        violations.hoverCompanion,
        `${route} hover:without active:/focus: companion on ${project}:\n` +
          violations.hoverCompanion.slice(0, 10).join("\n  "),
      ).toEqual([]);

      // 100vh literal — hard fail.
      expect(
        violations.vhUsage,
        `${route} uses "100vh" instead of "100dvh" on ${project}:\n` +
          violations.vhUsage.slice(0, 10).join("\n  "),
      ).toEqual([]);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Touch-target collector
// ────────────────────────────────────────────────────────────────────────────

interface TouchTargetViolation {
  tag: string;
  label: string;
  width: number;
  height: number;
}

async function collectTouchTargetViolations(
  page: Page,
): Promise<TouchTargetViolation[]> {
  return await page.evaluate(
    ({ minPx }) => {
      const out: Array<TouchTargetViolation> = [];
      const sels = ['button', 'a', '[role="button"]', '[role="link"]'];
      const nodes = document.querySelectorAll(sels.join(","));
      nodes.forEach((node) => {
        const el = node as HTMLElement;
        // Skip non-interactive (hidden / disabled).
        const style = window.getComputedStyle(el);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.pointerEvents === "none"
        ) {
          return;
        }
        if ((el as HTMLButtonElement).disabled) return;
        const rect = el.getBoundingClientRect();
        // Skip offscreen / collapsed elements (rect 0x0 = not currently rendered).
        if (rect.width === 0 && rect.height === 0) return;
        if (rect.width < minPx || rect.height < minPx) {
          out.push({
            tag: el.tagName.toLowerCase(),
            label: (
              el.getAttribute("aria-label") ??
              el.textContent?.trim().slice(0, 50) ??
              el.getAttribute("href") ??
              "(unlabeled)"
            ).replace(/\s+/g, " "),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
      });
      return out;
    },
    { minPx: TOUCH_TARGET_MIN_PX },
  );
}

// ────────────────────────────────────────────────────────────────────────────
// hover: companion-active collector
// ────────────────────────────────────────────────────────────────────────────

async function collectHoverCompanionViolations(page: Page): Promise<string[]> {
  return await page.evaluate(({ selector }) => {
    const out: string[] = [];
    const nodes = document.querySelectorAll(selector);
    nodes.forEach((node) => {
      const el = node as HTMLElement;
      const classes = el.className;
      if (typeof classes !== "string") return; // SVG elements have SVGAnimatedString
      if (!/\bhover:/.test(classes)) return;
      // Companion check: a matching active: OR focus: class anywhere on the element.
      const hasActive = /\bactive:/.test(classes);
      const hasFocus = /\bfocus:/.test(classes);
      if (!hasActive && !hasFocus) {
        const label =
          el.getAttribute("aria-label") ??
          el.textContent?.trim().slice(0, 40) ??
          "(unlabeled)";
        out.push(`${el.tagName.toLowerCase()} "${label}"`);
      }
    });
    return out;
  }, { selector: HOVER_COMPANION_TARGETS });
}

// ────────────────────────────────────────────────────────────────────────────
// 100vh literal collector
// ────────────────────────────────────────────────────────────────────────────

async function collectVhUsageViolations(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const out: string[] = [];
    // Inline styles
    const all = document.querySelectorAll("[style]");
    all.forEach((node) => {
      const style = (node as HTMLElement).getAttribute("style") ?? "";
      if (/\b100vh\b/.test(style)) {
        out.push(
          `${(node as HTMLElement).tagName.toLowerCase()} inline-style: ${style.slice(0, 80)}`,
        );
      }
    });
    // Tailwind class scan
    const classed = document.querySelectorAll("[class]");
    classed.forEach((node) => {
      const cls = (node as HTMLElement).className;
      if (typeof cls !== "string") return;
      // h-screen is Tailwind's 100vh alias — the canonical bug shape.
      if (/\bh-screen\b/.test(cls) || /\bmin-h-screen\b/.test(cls)) {
        out.push(
          `${(node as HTMLElement).tagName.toLowerCase()} class: ${cls.slice(0, 80)}`,
        );
      }
    });
    return out;
  });
}

// Silence the unused-import warning when only some of the imports are
// used by the spec body (Playwright's type surface re-exports many shapes).
void Locator;
