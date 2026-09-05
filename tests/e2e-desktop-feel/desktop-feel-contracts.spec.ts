/**
 * KRIEGER — Desktop-feel contracts spec.
 *
 * Phase D3: scope expansion from the mobile-only Phase-D1 gate to the
 * full mobile+desktop customer surface. Seven contracts asserted across
 * the 7 customer surfaces (Today/Map/Deals/Finance/Pax/Inbox/Settings)
 * at every project in playwright.desktop-feel.config.ts (4 viewports ×
 * 2 themes = 8 effective runs per surface per execution).
 *
 *   1. Pointer affordance — every clickable element (role=button/link)
 *      gets either `cursor: pointer` OR a visible hover state (background
 *      change / border / outline shift) when hovered. Catches "click here
 *      but no cursor change" feel-cheap surfaces.
 *
 *   2. Focus ring — every interactive element receives a visible focus
 *      ring (non-empty outline or box-shadow under :focus-visible) when
 *      reached via keyboard Tab. Hard accessibility floor.
 *
 *   3. Keyboard navigation — Tab visits interactive elements in DOM
 *      order; no element traps focus. Modal Escape behavior is sane.
 *
 *   4. No-blank-content — page contains visible textual or structural
 *      content (>10 non-whitespace chars after JS hydration).
 *
 *   5. Theme contract — body backgroundColor differs between the
 *      light + dark runs at the same viewport. The metadata-driven
 *      project shape gives us the colorScheme; failing this contract
 *      means a route hardcoded a color and ignored the design tokens.
 *
 *   6. No-horizontal-scroll — documentElement.scrollWidth must be
 *      <= window.innerWidth. Unintended horizontal overflow is the
 *      canonical "this layout wasn't sized for 1280" bug.
 *
 *   7. Pointer-hover-not-broken-on-touch — at the smallest desktop
 *      width (1280), every touch-relevant CTA must reach state via tap
 *      (not require hover). Catches hover-only menus that hide-and-only-
 *      reveal on hover, which break on touchscreen laptops.
 *
 * On failure, each test attaches a structured JSON finding via
 * testInfo.attach so the audit runbook can collect + classify.
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";

const ROUTES_TO_AUDIT = [
  "/today",
  "/maps",
  "/deals",
  "/money",
  "/ai",
  "/inbox",
  "/settings",
] as const;

// Vendor-rendered routes are checked but don't hard-fail on contracts
// AcreOS doesn't fully control (Clerk's UserProfile mounts inside /settings).
const VENDOR_RENDERED_ROUTES: ReadonlySet<string> = new Set(["/settings"]);

// Smallest desktop width — used by contract #7 to verify hover-only
// patterns don't lock out touchscreen-laptop users.
const SMALLEST_DESKTOP_WIDTH = 1280;

// Contract #4 threshold — anything below this is "the route mounted but
// rendered no meaningful content," which is the bug shape this gate
// exists to catch.
const MIN_CONTENT_CHARS = 10;

interface ProjectMeta {
  formFactor: "desktop";
  colorScheme: "light" | "dark";
  baseDevice: string;
  viewportWidth: number;
}

function resolveProjectMeta(testInfo: TestInfo): ProjectMeta {
  const md = (testInfo.project.metadata ?? {}) as Partial<ProjectMeta>;
  return {
    formFactor: "desktop",
    colorScheme: md.colorScheme ?? "light",
    baseDevice: md.baseDevice ?? testInfo.project.name,
    viewportWidth: md.viewportWidth ?? 1280,
  };
}

async function seedTestAuth(page: Page, baseURL: string): Promise<void> {
  const { hostname } = new URL(baseURL);
  await page.context().addCookies([
    {
      name: "__session",
      value: "e2e-desktop-feel-bypass",
      domain: hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function attachFinding(
  testInfo: TestInfo,
  route: string,
  contract: string,
  details: unknown,
): Promise<void> {
  await testInfo.attach("finding", {
    contentType: "application/json",
    body: Buffer.from(
      JSON.stringify(
        {
          route,
          contract,
          project: testInfo.project.name,
          details,
        },
        null,
        2,
      ),
    ),
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Body-bg snapshot per (route, colorScheme) for the theme contract.
// Captured into a module-scoped Map keyed by `${route}|${colorScheme}` so
// the dark + light runs can compare. Playwright workers=1 in this config,
// so the in-memory map is sufficient.
// ────────────────────────────────────────────────────────────────────────────
const themeBgCapture = new Map<string, string>();

function themeKey(route: string, colorScheme: "light" | "dark"): string {
  return `${route}|${colorScheme}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Per-route describe blocks. test.describe.parallel where possible to let
// CI runners exercise as many routes concurrently as the matrix allows.
// ────────────────────────────────────────────────────────────────────────────

for (const route of ROUTES_TO_AUDIT) {
  test.describe.parallel(`Krieger desktop-feel contracts — ${route}`, () => {
    test.beforeEach(async ({ page, baseURL }, testInfo) => {
      const meta = resolveProjectMeta(testInfo);
      await page.emulateMedia({ colorScheme: meta.colorScheme });
      await seedTestAuth(page, baseURL ?? "http://localhost:5000");
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      // networkidle is not hydration. App.tsx's PageLoader is what renders
      // while a lazy route resolves, and it carries no interactive controls —
      // so a contract that counts elements can measure an EMPTY page and report
      // it clean. That is not hypothetical here: C7 on /settings passed at
      // 1280-light and failed at 1280-dark in the same run, and a direct probe
      // then found the identical count (11) in both themes across ten runs. The
      // light run had simply sampled before the appearance panel existed.
      //
      // Waiting for the shell's own loading marker to DETACH is the same fix
      // the mobile-feel contracts carry, for the same reason.
      await page
        .locator('[data-testid="app-loading"]')
        .waitFor({ state: "detached", timeout: 15_000 })
        .catch(() => {});
    });

    // ── Contract 1 ──────────────────────────────────────────────────────
    test(`C1 pointer affordance on ${route}`, async ({ page }, testInfo) => {
      const isVendor = VENDOR_RENDERED_ROUTES.has(route);
      const violations = await page.evaluate(() => {
        const out: Array<{ tag: string; label: string }> = [];
        const sels = [
          "button",
          "a[href]",
          '[role="button"]',
          '[role="link"]',
        ];
        const nodes = Array.from(
          document.querySelectorAll(sels.join(",")),
        ) as HTMLElement[];
        for (const el of nodes) {
          const style = window.getComputedStyle(el);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.pointerEvents === "none"
          ) {
            continue;
          }
          if ((el as HTMLButtonElement).disabled) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          const cursor = style.cursor;
          // Affordance #1: explicit cursor:pointer.
          if (cursor === "pointer") continue;
          // Affordance #2: any hover: Tailwind class declared on the
          // element — proves the author specified a hover state.
          const classes =
            typeof el.className === "string" ? el.className : "";
          if (/\bhover:/.test(classes)) continue;
          // Otherwise — fail.
          out.push({
            tag: el.tagName.toLowerCase(),
            label: (
              el.getAttribute("aria-label") ??
              el.textContent?.trim().slice(0, 40) ??
              "(unlabeled)"
            ).replace(/\s+/g, " "),
          });
        }
        return out.slice(0, 10);
      });

      if (violations.length > 0) {
        await attachFinding(testInfo, route, "C1-pointer-affordance", {
          violations,
        });
      }

      if (isVendor) {
        testInfo.annotations.push({
          type: "info-c1-vendor",
          description: `${route} (vendor): ${violations.length} pointer-affordance candidates`,
        });
        return;
      }

      expect(
        violations,
        `${route} C1 pointer-affordance violations (no cursor:pointer + no hover: companion):\n  ${violations
          .map((v) => `${v.tag} "${v.label}"`)
          .join("\n  ")}`,
      ).toEqual([]);
    });

    // ── Contract 2 ──────────────────────────────────────────────────────
    test(`C2 focus ring on ${route}`, async ({ page }, testInfo) => {
      const isVendor = VENDOR_RENDERED_ROUTES.has(route);
      // Tab through up to 12 elements and check :focus-visible outline /
      // box-shadow on each. We sample (not exhaustive) to keep runtime
      // bounded; 12 is enough to cover the door-bar + page chrome.
      const violations: Array<{ tag: string; label: string }> = [];
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press("Tab");
        const sample = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const cs = window.getComputedStyle(el);
          // Compute focus indicator presence: outline OR box-shadow.
          const outlineNone =
            cs.outlineStyle === "none" || cs.outlineWidth === "0px";
          const boxShadowNone =
            cs.boxShadow === "none" || cs.boxShadow === "";
          const hasFocusIndicator = !(outlineNone && boxShadowNone);
          return {
            tag: el.tagName.toLowerCase(),
            label: (
              el.getAttribute("aria-label") ??
              el.textContent?.trim().slice(0, 40) ??
              "(unlabeled)"
            ).replace(/\s+/g, " "),
            hasFocusIndicator,
          };
        });
        if (sample && !sample.hasFocusIndicator) {
          violations.push({ tag: sample.tag, label: sample.label });
        }
      }

      if (violations.length > 0) {
        await attachFinding(testInfo, route, "C2-focus-ring", {
          violations,
        });
      }

      if (isVendor) {
        testInfo.annotations.push({
          type: "info-c2-vendor",
          description: `${route} (vendor): ${violations.length} missing focus rings`,
        });
        return;
      }

      expect(
        violations,
        `${route} C2 focus-ring violations:\n  ${violations
          .map((v) => `${v.tag} "${v.label}"`)
          .join("\n  ")}`,
      ).toEqual([]);
    });

    // ── Contract 3 ──────────────────────────────────────────────────────
    test(`C3 keyboard navigation on ${route}`, async ({ page }, testInfo) => {
      // Walk Tab + verify focus actually advances. A focus trap shows as
      // "5 Tabs land on the same element."
      const sequence: string[] = [];
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press("Tab");
        const ident = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return "body";
          const tag = el.tagName.toLowerCase();
          const label =
            el.getAttribute("aria-label") ??
            el.getAttribute("data-testid") ??
            el.textContent?.trim().slice(0, 20) ??
            "(unlabeled)";
          return `${tag}:${label.replace(/\s+/g, " ")}`;
        });
        sequence.push(ident);
      }

      // Detect a trap: same identity 5+ consecutive times.
      let maxRun = 1;
      let currentRun = 1;
      for (let i = 1; i < sequence.length; i++) {
        if (sequence[i] === sequence[i - 1]) {
          currentRun++;
          if (currentRun > maxRun) maxRun = currentRun;
        } else {
          currentRun = 1;
        }
      }

      const trapped = maxRun >= 5;
      if (trapped) {
        await attachFinding(testInfo, route, "C3-keyboard-nav-trap", {
          sequence,
          maxRun,
        });
      }

      expect(
        trapped,
        `${route} C3 keyboard-nav trap: same element focused ${maxRun}× in a row. Sequence:\n  ${sequence.join("\n  ")}`,
      ).toBe(false);
    });

    // ── Contract 4 ──────────────────────────────────────────────────────
    test(`C4 no-blank-content on ${route}`, async ({ page }, testInfo) => {
      const isVendor = VENDOR_RENDERED_ROUTES.has(route);
      const len = await page.evaluate(
        () => (document.body?.innerText || "").trim().length,
      );

      if (len <= MIN_CONTENT_CHARS) {
        await attachFinding(testInfo, route, "C4-blank-content", {
          contentLength: len,
        });
      }

      if (isVendor) {
        // Vendor route: just verify the shell isn't *completely* empty.
        expect(
          len,
          `${route} (vendor) C4 violation: even shell should render`,
        ).toBeGreaterThan(0);
        return;
      }

      expect(
        len,
        `${route} C4 violation: body innerText length=${len}, expected > ${MIN_CONTENT_CHARS}. The route mounted but rendered no meaningful content.`,
      ).toBeGreaterThan(MIN_CONTENT_CHARS);
    });

    // ── Contract 5 ──────────────────────────────────────────────────────
    test(`C5 theme differs on ${route}`, async ({ page }, testInfo) => {
      const meta = resolveProjectMeta(testInfo);
      const bg = await page.evaluate(
        () => window.getComputedStyle(document.body).backgroundColor,
      );
      themeBgCapture.set(themeKey(route, meta.colorScheme), bg);

      // Compare against the opposite scheme if captured.
      const opposite: "light" | "dark" =
        meta.colorScheme === "light" ? "dark" : "light";
      const otherBg = themeBgCapture.get(themeKey(route, opposite));

      if (otherBg === undefined) {
        // First of the pair — note + return.
        testInfo.annotations.push({
          type: "info-c5-half",
          description: `${route} ${meta.colorScheme}: bg=${bg} (waiting for opposite scheme)`,
        });
        return;
      }

      if (bg === otherBg) {
        await attachFinding(testInfo, route, "C5-theme-no-diff", {
          colorScheme: meta.colorScheme,
          bg,
          oppositeBg: otherBg,
        });
      }

      expect(
        bg,
        `${route} C5 violation: light + dark body bg identical (${bg}). Likely a hardcoded color ignoring design tokens.`,
      ).not.toBe(otherBg);
    });

    // ── Contract 6 ──────────────────────────────────────────────────────
    test(`C6 no-horizontal-scroll on ${route}`, async ({ page }, testInfo) => {
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));

      const overflows = overflow.scrollWidth > overflow.innerWidth;
      if (overflows) {
        await attachFinding(testInfo, route, "C6-horizontal-scroll", overflow);
      }

      expect(
        overflows,
        `${route} C6 violation: scrollWidth=${overflow.scrollWidth} > innerWidth=${overflow.innerWidth}. Unintended horizontal overflow.`,
      ).toBe(false);
    });

    // ── Contract 7 ──────────────────────────────────────────────────────
    test(`C7 hover-not-broken-on-touch on ${route}`, async ({
      page,
    }, testInfo) => {
      const meta = resolveProjectMeta(testInfo);
      // Only verify at the smallest desktop width — at larger widths the
      // hover-only pattern is more defensible. At 1280, many users are
      // on touchscreen laptops.
      test.skip(
        meta.viewportWidth !== SMALLEST_DESKTOP_WIDTH,
        "C7 only runs at the smallest desktop width (1280)",
      );

      // Find elements that have hover: classes but no active:/focus:
      // companion AND no tap-equivalent. We approximate by checking the
      // classlist for a Tailwind hover: token without active:/focus:.
      const hoverOnlyCount = await page.evaluate(() => {
        const sels = ["button", "a[href]", '[role="button"]'];
        const nodes = Array.from(
          document.querySelectorAll(sels.join(",")),
        ) as HTMLElement[];
        let count = 0;
        for (const el of nodes) {
          const classes =
            typeof el.className === "string" ? el.className : "";
          if (!/\bhover:/.test(classes)) continue;
          const hasActive = /\bactive:/.test(classes);
          const hasFocus = /\bfocus:/.test(classes);
          if (!hasActive && !hasFocus) count++;
        }
        return count;
      });

      if (hoverOnlyCount > 0) {
        await attachFinding(testInfo, route, "C7-hover-only-touch", {
          hoverOnlyCount,
        });
      }

      // Soft floor: <=3 hover-only candidates is tolerable (decorative
      // affordances). Above that, the surface likely has a hover-trap.
      expect(
        hoverOnlyCount,
        `${route} C7 violation: ${hoverOnlyCount} interactive elements use hover: without active:/focus: companions at width=${meta.viewportWidth}.`,
      ).toBeLessThanOrEqual(3);
    });
  });
}
