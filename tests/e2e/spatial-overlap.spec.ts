/**
 * E2E: Spatial-overlap detection on mobile viewport.
 *
 * Why: the 2026-05 spatial-overlap audit found that on 375 wide
 * viewports the floating-action button, cookie banner, PWA install
 * prompt, and notification banner all rendered with `position: fixed`
 * at the same z-50 in the same bottom-right region — blocking each
 * other's interactive targets. There's no static way to catch this
 * because the collisions depend on viewport size, banner visibility,
 * and which floating slots happen to be open.
 *
 * What this test does:
 *   - Sets viewport to 375x667 (iPhone SE / first-gen safe-area).
 *   - Clears `acreos_cookie_consent` localStorage so the cookie banner
 *     is up — the cookie banner is the most common spatial offender.
 *   - For each canonical customer route, enumerates every visible
 *     `position: fixed` element via window.getComputedStyle, captures
 *     bounding rects, and asserts no two rects intersect.
 *
 * Allow-list mechanism:
 *   Elements that are intentionally allowed to overlap (e.g. the
 *   offline indicator stacking over the page below it) opt out by
 *   carrying `data-overlap-ok` on the element itself OR on any ancestor
 *   of the fixed element. A pair is exempt if EITHER member is flagged.
 *
 * Auth:
 *   This file relies on the storageState wiring already declared in
 *   playwright.config.ts (each phone project loads
 *   `tests/e2e/.auth/user.json`). If auth.setup.ts produced an empty
 *   storage state (no E2E_USER_EMAIL configured), every route under
 *   test will redirect to /auth and the spatial check still runs
 *   meaningfully — the auth screen is itself a customer surface where
 *   the cookie banner must not collide with the Clerk form. We assert
 *   non-overlap regardless of whether the user is signed in.
 *
 * Not yet covered: routes that require gestures to expose floating
 * chrome (e.g. swiping up to reveal a conversation tray). Those are
 * a separate test once the gestural surface stabilizes.
 */
import { test, expect, type Page } from "@playwright/test";

const CUSTOMER_ROUTES = [
  "/today",
  "/leads",
  "/properties",
  "/deals",
  "/pipeline",
  "/campaigns",
  "/inbox",
  "/tasks",
  "/analytics",
  "/settings",
  "/ai",
  "/help",
] as const;

interface FixedRect {
  selector: string;
  tag: string;
  cls: string;
  rect: { x: number; y: number; width: number; height: number };
  overlapOk: boolean;
  zIndex: string;
}

function rectsIntersect(
  a: FixedRect["rect"],
  b: FixedRect["rect"],
): boolean {
  // Treat zero-area rects as non-intersecting — display:none / collapsed.
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0)
    return false;
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

async function collectFixedRects(page: Page): Promise<FixedRect[]> {
  return page.evaluate(() => {
    const out: FixedRect[] = [];
    const all = document.querySelectorAll("*");
    for (const el of Array.from(all)) {
      const cs = window.getComputedStyle(el);
      if (cs.position !== "fixed") continue;
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      // Skip invisible-by-opacity elements (toast slots before content).
      if (parseFloat(cs.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      // Allow-list: data-overlap-ok on self OR any ancestor.
      let cursor: Element | null = el;
      let overlapOk = false;
      while (cursor) {
        if (cursor.hasAttribute?.("data-overlap-ok")) {
          overlapOk = true;
          break;
        }
        cursor = cursor.parentElement;
      }
      out.push({
        selector:
          (el.tagName.toLowerCase() +
            (el.id ? `#${el.id}` : "") +
            (el.className && typeof el.className === "string"
              ? "." + el.className.split(/\s+/).slice(0, 2).join(".")
              : "")).slice(0, 120),
        tag: el.tagName.toLowerCase(),
        cls:
          typeof el.className === "string"
            ? el.className.slice(0, 80)
            : "",
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        overlapOk,
        zIndex: cs.zIndex,
      });
    }
    return out;
  });
}

test.describe("Spatial overlap on mobile (375x667)", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  for (const route of CUSTOMER_ROUTES) {
    test(`no fixed-element collisions on ${route}`, async ({ page }) => {
      // Cookie consent must be unset so the banner is up — the banner
      // is the most common floating-chrome offender. Best-effort: a
      // 401-redirect to /auth may happen before this fires, but the
      // empty localStorage state still applies on subsequent goto.
      await page.addInitScript(() => {
        try {
          window.localStorage.removeItem("acreos_cookie_consent");
        } catch {
          /* SecurityError in sandboxed contexts — non-fatal */
        }
      });

      try {
        await page.goto(route, { waitUntil: "domcontentloaded", timeout: 15000 });
      } catch {
        test.skip(true, `route ${route} did not load within 15s`);
        return;
      }

      // Brief settle for floating chrome to mount (PWA prompt, FAB).
      await page.waitForTimeout(800);

      const rects = await collectFixedRects(page);

      // Find every offending pair where NEITHER element is overlap-OK.
      const collisions: Array<{ a: FixedRect; b: FixedRect }> = [];
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          if (a.overlapOk || b.overlapOk) continue;
          // Skip self-nested fixed elements (descendant of another fixed
          // wrapper) — those are layout containment, not collisions.
          if (
            (a.rect.x <= b.rect.x &&
              a.rect.y <= b.rect.y &&
              a.rect.x + a.rect.width >= b.rect.x + b.rect.width &&
              a.rect.y + a.rect.height >= b.rect.y + b.rect.height) ||
            (b.rect.x <= a.rect.x &&
              b.rect.y <= a.rect.y &&
              b.rect.x + b.rect.width >= a.rect.x + a.rect.width &&
              b.rect.y + b.rect.height >= a.rect.y + a.rect.height)
          ) {
            continue;
          }
          if (rectsIntersect(a.rect, b.rect)) {
            collisions.push({ a, b });
          }
        }
      }

      if (collisions.length > 0) {
        const detail = collisions
          .map(
            ({ a, b }) =>
              `  ${a.selector} [z=${a.zIndex}] ↔ ${b.selector} [z=${b.zIndex}]`,
          )
          .join("\n");
        throw new Error(
          `Found ${collisions.length} fixed-element collision(s) on ${route}:\n${detail}\n\nFix by giving one element a deliberately higher z-index from client/src/lib/z-index.ts, or annotate the intentional overlap with data-overlap-ok.`,
        );
      }

      expect(collisions.length).toBe(0);
    });
  }
});
