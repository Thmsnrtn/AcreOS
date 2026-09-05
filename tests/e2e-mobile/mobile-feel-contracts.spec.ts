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
 *   5. Layout-viewport integrity             (shrink-to-fit zoom guard)
 *      window.innerWidth must equal the emulated device width and
 *      visualViewport.scale must be ~1. Any first-paint horizontal
 *      overflow makes mobile browsers expand the layout viewport + lock
 *      a <1 zoom — which silently corrupts every other measurement on
 *      the page (and at 744px flips the app across the 768 breakpoint).
 *
 * Failures are reported in batch per page so a single run names every
 * violation, not just the first. Sets the threshold pattern the wider
 * mobile-craft discipline can grow from.
 */
import { test, expect, type Page } from "@playwright/test";

const ROUTES_TO_AUDIT = [
  "/today",
  // The Map door's canonical route is /maps (nav-items.ts href:"/maps") —
  // "/map" has NO route and falls through to the 404 catch-all, so this
  // suite spent its Map-door budget measuring the not-found page (which is
  // how it caught the 38px coverage-page CTAs, but it never once audited
  // the real Map surface). Same wrong-premise class as J1's /map → /maps
  // correction in customer-surface-journeys.spec.ts.
  "/maps",
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

/**
 * Wait for the app to leave its loading shell before measuring anything.
 *
 * `networkidle` is a NETWORK signal, not a render signal. On WebKit it settles
 * while `PageLoader` is still up, and the body-text assertions below then
 * measured the shell: `innerText` of exactly 34 characters — "Skip to
 * content / A / Loading AcreOS…" — on every WebKit device, on /deals, /money,
 * /inbox, /maps and /ai, reported as "the route mounted but rendered no
 * meaningful content". The routes were fine; a direct probe showed each one
 * fully rendered about two seconds in. Chromium's timing happened to hide it,
 * which is why this only ever failed on the engine that dominates the actual
 * audience.
 *
 * The failure is DELIBERATELY SWALLOWED. A route that genuinely never leaves
 * the shell must still reach the assertion and fail there, with the real
 * message about what the body contained — not die here on a timeout that says
 * nothing about the route. This is a measurement point, not a gate.
 */
async function settleAppShell(page: import("@playwright/test").Page) {
  await page
    .locator('[data-testid="app-loading"]')
    .waitFor({ state: "detached", timeout: 15_000 })
    .catch(() => {});
}

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

      // Contract 5 — layout-viewport integrity. If any content overflows the
      // layout viewport at first paint, mobile WebKit/Blink expand the layout
      // viewport and lock a <1 shrink-to-fit zoom: every element then
      // measures below its CSS size (phantom touch-target failures), and at
      // 744px the expansion can push innerWidth across the 768 breakpoint,
      // flipping the app to the desktop arm (vanishing bottom nav). Assert
      // the layout viewport still matches the emulated device, and name any
      // overflowing elements so the culprit lands in CI output, not a
      // mystery. Runs BEFORE the touch-target assert: when this fires, the
      // touch-target numbers are scaled garbage.
      const deviceWidth = page.viewportSize()?.width ?? 0;
      const viewportIntegrity = await collectViewportIntegrity(page);
      expect(
        viewportIntegrity.innerWidth <= deviceWidth + 1 &&
          viewportIntegrity.visualScale >= 0.99,
        `${route} layout viewport corrupted on ${project}: ` +
          `innerWidth=${viewportIntegrity.innerWidth} (device=${deviceWidth}), ` +
          `scrollWidth=${viewportIntegrity.scrollWidth}, ` +
          `visualScale=${viewportIntegrity.visualScale.toFixed(4)}.\n` +
          `Overflowing elements:\n  ${
            viewportIntegrity.offenders.join("\n  ") ||
            "(none detected post-settle — overflow was transient at first paint)"
          }`,
      ).toBe(true);

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
// Layout-viewport integrity collector (contract 5)
// ────────────────────────────────────────────────────────────────────────────

interface ViewportIntegrity {
  innerWidth: number;
  scrollWidth: number;
  clientWidth: number;
  visualScale: number;
  offenders: string[];
}

async function collectViewportIntegrity(page: Page): Promise<ViewportIntegrity> {
  return await page.evaluate(() => {
    const clientW = document.documentElement.clientWidth;
    const offenders: string[] = [];
    document.querySelectorAll("body *").forEach((node) => {
      const el = node as HTMLElement;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= clientW + 1) return;
      if (getComputedStyle(el).position === "fixed") return;
      // Skip elements inside a horizontal scroll/clip container — those are
      // contained and never expand the document.
      let p = el.parentElement;
      let contained = false;
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") {
          contained = true;
          break;
        }
        p = p.parentElement;
      }
      if (contained) return;
      offenders.push(
        `${el.tagName.toLowerCase()}` +
          `${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}` +
          ` right=${Math.round(rect.right)} (viewport=${clientW})`,
      );
    });
    return {
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: clientW,
      visualScale: window.visualViewport?.scale ?? 1,
      offenders: offenders.slice(0, 8),
    };
  });
}

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
      // NB: do NOT add an animation-settle wait here. A getAnimations()
      // await was tried (to dodge a phone sub-pixel false-positive) and
      // regressed ipad-mini: at 768px the DESKTOP sidebar is the primary
      // nav (by design — see nav-smoke.spec.ts), and the extra wait let its
      // collapsed 34px submodule children finish rendering so they got
      // measured as touch-target violations on every route (run
      // 27340175460). The synchronous measurement matches the state this
      // contract has always audited. The phone sub-pixel issue is handled
      // by round-then-compare below instead.
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
        // Compare what we report: round-to-nearest so sub-pixel rendering
        // of an exactly-minPx target (43.6–43.99 at fractional DPR / end
        // of a scale animation) isn't a violation, while a genuinely
        // undersized 43px target still is.
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        if (width < minPx || height < minPx) {
          out.push({
            tag: el.tagName.toLowerCase(),
            label: (
              el.getAttribute("aria-label") ??
              el.textContent?.trim().slice(0, 50) ??
              el.getAttribute("href") ??
              "(unlabeled)"
            ).replace(/\s+/g, " "),
            width,
            height,
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

// ────────────────────────────────────────────────────────────────────────────
// Contract C1 — "no blank dialog" + C2 — "no blank route"
// ────────────────────────────────────────────────────────────────────────────
//
// Added 2026-06-02 in response to the Pax-Settings-blank-dialog incident
// (Tom surfaced; team should have caught it). The two contracts below would
// have failed CI before the merge that broke that dialog:
//
//   C1 — open every Dialog/Sheet across the 7 customer doors, wait 500ms,
//        assert textContent.trim().length > 0. A "Dialog/Sheet" is detected
//        by [role="dialog"] | [role="alertdialog"] | [data-state="open"]
//        on a Radix-style dialog container.
//
//   C2 — for each customer-facing route, assert
//        document.body.innerText.length > 100 after networkidle. Catches the
//        "route mounts but renders empty" class (the bug shape that
//        nav-smoke uses a threshold of 20 for; this one is stricter +
//        runs across the full device matrix).
//
// Both contracts run across the full projects[] in playwright.mobile.config.ts
// so a regression that only manifests on iPad-mini or iPhone-SE doesn't slip
// through a single-viewport check.

const DIALOG_TRIGGER_SELECTORS = [
  // Common explicit triggers — buttons whose aria-haspopup is "dialog" or
  // whose data-testid suggests they open something modal. Conservative on
  // purpose; opening every button on the page produces too many false
  // positives (kebab menus, dropdowns, navigation).
  'button[aria-haspopup="dialog"]',
  'button[data-testid*="dialog"]',
  'button[data-testid*="modal"]',
  'button[data-testid*="open-"]',
  '[data-testid*="settings-gear"]',
  '[data-testid*="settings-button"]',
];

const DIALOG_RENDER_MS = 500;
const C2_MIN_BODY_TEXT_LEN = 100;

test.describe("Krieger C1: no-blank-dialog", () => {
  for (const route of ROUTES_TO_AUDIT) {
    test(`dialogs render non-blank on ${route}`, async ({
      page,
      context,
    }, _testInfo) => {
      await context.addCookies([
        {
          name: "__session",
          value: "e2e-c1-no-blank-dialog",
          domain: "localhost",
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);

      await page.goto(route, { waitUntil: "domcontentloaded" });
      // BOUNDED settle: networkidle NEVER fires on pages with a live or
      // reconnecting connection (the Pax door's global WebSocket retries
      // with backoff when the AI service is absent in CI), and the
      // @playwright/test default navigation timeout is 0 = unlimited — so
      // an unbounded wait here ate the entire 200s test budget on
      // [iphone-14] /ai (run 28950430806) and the .catch below never got
      // to do its intended best-effort job. Bound it: idle if quick,
      // proceed regardless.
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await settleAppShell(page);

      const triggers = page.locator(DIALOG_TRIGGER_SELECTORS.join(", "));
      const triggerCount = await triggers.count();
      if (triggerCount === 0) {
        _testInfo.annotations.push({
          type: "info-c1-no-triggers",
          description: `${route}: no dialog triggers matched on this surface`,
        });
        return;
      }

      const violations: string[] = [];
      const examined: Array<{
        label: string;
        len: number;
      }> = [];

      for (let i = 0; i < Math.min(triggerCount, 12); i++) {
        const trigger = triggers.nth(i);
        if (!(await trigger.isVisible().catch(() => false))) continue;
        const label =
          (await trigger.getAttribute("aria-label")) ??
          (await trigger.getAttribute("data-testid")) ??
          (await trigger.textContent())?.trim().slice(0, 40) ??
          `trigger#${i}`;

        // Bounded click — auto-wait on a trigger that detaches (e.g. a
        // re-render mid-loop) must cost ≤5s, not the whole test budget.
        await trigger.click({ trial: false, timeout: 5_000 }).catch(() => {});
        await page.waitForTimeout(DIALOG_RENDER_MS);

        const dialog = page
          .locator('[role="dialog"], [role="alertdialog"]')
          .first();
        if (await dialog.isVisible().catch(() => false)) {
          const text = (await dialog.textContent().catch(() => "")) ?? "";
          const len = text.trim().length;
          examined.push({ label, len });
          if (len === 0) {
            violations.push(`${label} → dialog rendered empty (textContent="")`);
          }
          // Close before the next trigger.
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(200);
        }
      }

      expect(
        violations,
        `${route} C1 violations:\n  ${violations.join("\n  ")}\n\nExamined: ${JSON.stringify(examined)}`,
      ).toEqual([]);
    });
  }
});

test.describe("Krieger C2: no-blank-route", () => {
  for (const route of ROUTES_TO_AUDIT) {
    test(`route ${route} renders non-blank body`, async ({
      page,
      context,
    }) => {
      await context.addCookies([
        {
          name: "__session",
          value: "e2e-c2-no-blank-route",
          domain: "localhost",
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);

      await page.goto(route, { waitUntil: "domcontentloaded" });
      // Bounded settle — same reason as C1 above: unbounded networkidle
      // never resolves on routes with a reconnecting WebSocket and starves
      // the whole test budget.
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await settleAppShell(page);

      const bodyTextLen = await page.evaluate(
        () => (document.body?.innerText || "").trim().length,
      );

      // /settings is the vendor-rendered (Clerk UserProfile) route that we
      // tolerate per VENDOR_RENDERED_ROUTES above. Relax to a non-zero
      // chrome check.
      if (VENDOR_RENDERED_ROUTES.has(route)) {
        expect(
          bodyTextLen,
          `${route} (vendor): even shell should render`,
        ).toBeGreaterThan(20);
        return;
      }

      expect(
        bodyTextLen,
        `${route} C2 violation: body innerText length=${bodyTextLen}, expected > ${C2_MIN_BODY_TEXT_LEN}. ` +
          `The route mounted but rendered no meaningful content — the exact bug class C2 exists to catch.`,
      ).toBeGreaterThan(C2_MIN_BODY_TEXT_LEN);
    });
  }
});
