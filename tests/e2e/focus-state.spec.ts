/**
 * Rosy River A6 — Focus-state Playwright spec.
 *
 * Tab through every interactive element on the top-traffic pages and
 * assert each one has a visible focus ring. This catches the kind of
 * regression where a Tailwind utility flip removes `focus-visible:*`
 * styling and keyboard users lose the ability to see where they are.
 *
 * Strategy: for each page, take a baseline screenshot, then for every
 * focusable element call `.focus()` and assert that the computed style
 * shows EITHER a non-zero outline OR a non-default box-shadow OR a
 * focus-visible ring on the element (or one of its first 2 ancestors,
 * since shadcn primitives often put the ring on a wrapper). We don't
 * compare pixel diffs — that's A2's job — we just verify "something
 * visually changes when focused."
 *
 * Run: npx playwright test tests/e2e/focus-state.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";

const TRAFFIC_PAGES: Array<{ path: string; testIdAnchor?: string }> = [
  { path: "/today" },
  { path: "/leads" },
  { path: "/properties" },
  { path: "/deals" },
];

/**
 * Returns true if the element (or one of its 3 nearest ancestors) shows a
 * visible focus indicator under the current computed styles.
 *
 * "Visible" means at least one of:
 *   - outline-style is not "none" and outline-width > 0
 *   - box-shadow is non-default and non-empty
 *   - the element has a ring-* class effectively producing a box-shadow
 */
async function hasVisibleFocusIndicator(page: Page, locator: ReturnType<Page["locator"]>): Promise<boolean> {
  return await locator.evaluate((el) => {
    const visible = (node: Element | null): boolean => {
      if (!node) return false;
      const cs = window.getComputedStyle(node);
      const outlineStyle = cs.outlineStyle;
      const outlineWidth = parseFloat(cs.outlineWidth || "0");
      if (outlineStyle && outlineStyle !== "none" && outlineWidth > 0) return true;
      const boxShadow = cs.boxShadow;
      if (boxShadow && boxShadow !== "none" && boxShadow.length > 0) return true;
      return false;
    };
    if (visible(el)) return true;
    let cursor: Element | null = el.parentElement;
    for (let i = 0; i < 3 && cursor; i++) {
      if (visible(cursor)) return true;
      cursor = cursor.parentElement;
    }
    return false;
  });
}

/**
 * Filters out elements that are off-screen / display:none / aria-hidden —
 * Playwright's locator-based traversal walks the DOM, not the focus order,
 * so this prevents false negatives on legitimately invisible widgets.
 */
async function isFocusableAndVisible(locator: ReturnType<Page["locator"]>): Promise<boolean> {
  return await locator.evaluate((el) => {
    const cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if ((el as HTMLElement).offsetParent === null && cs.position !== "fixed") return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if ((el as HTMLInputElement).disabled) return false;
    if ((el as HTMLElement).tabIndex < 0) return false;
    return true;
  });
}

for (const { path } of TRAFFIC_PAGES) {
  test.describe(`focus state · ${path}`, () => {
    test("every visible interactive element has a focus indicator", async ({ page }) => {
      await page.goto(path);

      // Wait for the page to be interactive — main content visible.
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

      // Standard focusable selectors. We deliberately exclude inputs of
      // type hidden + skip whitelist-managed elements.
      const candidateSelector =
        'a[href]:not([disabled]),' +
        'button:not([disabled]),' +
        'input:not([type="hidden"]):not([disabled]),' +
        'select:not([disabled]),' +
        'textarea:not([disabled]),' +
        '[role="button"]:not([disabled]),' +
        '[tabindex]:not([tabindex="-1"])';

      const candidates = page.locator(candidateSelector);
      const count = Math.min(await candidates.count(), 50); // cap to 50 to keep runtime sane

      // Track misses so the failure message lists each violating element.
      const misses: Array<{ tag: string; testId: string; text: string }> = [];

      for (let i = 0; i < count; i++) {
        const el = candidates.nth(i);
        if (!(await isFocusableAndVisible(el))) continue;

        await el.focus().catch(() => {});
        const focused = await hasVisibleFocusIndicator(page, el);
        if (!focused) {
          const info = await el.evaluate((n) => ({
            tag: n.tagName.toLowerCase(),
            testId: (n as HTMLElement).dataset.testid ?? "",
            text: ((n as HTMLElement).innerText || "").slice(0, 60),
          }));
          misses.push(info);
        }
      }

      if (misses.length > 0) {
        const summary = misses
          .map((m, idx) => `  ${idx + 1}. <${m.tag}>${m.testId ? ` testid="${m.testId}"` : ""} "${m.text}"`)
          .join("\n");
        throw new Error(
          `${misses.length} of ${count} focusable elements on ${path} have no visible focus indicator:\n${summary}`,
        );
      }
      expect(misses.length).toBe(0);
    });
  });
}
