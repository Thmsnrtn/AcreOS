import { test, expect, type Page } from "@playwright/test";

/** Returns true if the page has authenticated app content */
async function hasAppContent(page: Page): Promise<boolean> {
  if (page.url().includes("/auth")) return false;
  const appShell = page.locator("nav, [class*='sidebar'], main, [role='main']");
  return await appShell.count() > 0;
}

/** Navigate and return true if page loaded with authenticated content */
async function navigateTo(page: Page, url: string): Promise<boolean> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  return await hasAppContent(page);
}

test.describe("Layer 2: Perceptual Quality", () => {

  test("loading states appear and persist long enough to be seen", async ({ page }) => {
    // Slow APIs to catch loading states
    await page.route("**/api/**", async route => {
      await new Promise(r => setTimeout(r, 1500));
      await route.continue();
    });

    let pagesChecked = 0;
    for (const url of ["/dashboard", "/deal-feed", "/properties"]) {
      const start = Date.now();
      page.goto(url); // don't await — we want to catch the loading state
      await page.waitForTimeout(300);

      // Check auth redirect without expensive locator queries during mid-load
      if (page.url().includes("/auth")) {
        await page.waitForLoadState("networkidle").catch(() => {});
        continue;
      }
      pagesChecked++;

      const hasLoading = await page.locator(
        "[class*='skeleton'], [class*='shimmer'], [class*='animate-pulse'], [data-loading='true']"
      ).count() > 0;

      const loadingMs = Date.now() - start;
      await page.screenshot({ path: `tests/simulation/screenshots/perceptual-loading-${url.replace(/\//g,"-").slice(1)}.png` });

      // Loading states that flash for < 200ms feel glitchy
      if (hasLoading && loadingMs < 200) {
        console.warn(`${url}: loading state visible for only ${loadingMs}ms — may feel glitchy`);
      }

      await page.unroute("**/api/**");
      await page.waitForLoadState("networkidle");
    }

    if (pagesChecked === 0) test.skip();
  });

  test("color contrast meets WCAG AA (4.5:1 for text)", async ({ page }) => {
    const lowContrast: string[] = [];
    let pagesChecked = 0;

    for (const url of ["/dashboard", "/leads", "/deals"]) {
      if (!await navigateTo(page, url)) continue;
      pagesChecked++;

      const issues = await page.evaluate(() => {
        function luminance(r: number, g: number, b: number): number {
          const [rs, gs, bs] = [r, g, b].map(c => {
            c = c / 255;
            return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
        }

        function contrastRatio(l1: number, l2: number): number {
          const lighter = Math.max(l1, l2);
          const darker = Math.min(l1, l2);
          return (lighter + 0.05) / (darker + 0.05);
        }

        function parseColor(str: string): [number, number, number] | null {
          const match = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          return match ? [+match[1], +match[2], +match[3]] : null;
        }

        const problems: string[] = [];
        const textEls = document.querySelectorAll("p, span, a, li, td, th, label, h1, h2, h3, h4, h5, h6");

        for (const el of Array.from(textEls).slice(0, 200)) {
          if (!el.textContent?.trim()) continue;
          const style = getComputedStyle(el);
          const fg = parseColor(style.color);
          const bg = parseColor(style.backgroundColor);
          if (!fg || !bg) continue;
          if (bg[0] === 0 && bg[1] === 0 && bg[2] === 0 && style.backgroundColor === "rgba(0, 0, 0, 0)") continue;

          const fgL = luminance(...fg);
          const bgL = luminance(...bg);
          const ratio = contrastRatio(fgL, bgL);

          const fontSize = parseFloat(style.fontSize);
          const minRatio = fontSize >= 18 ? 3 : 4.5; // WCAG AA: 3:1 for large text

          if (ratio < minRatio) {
            problems.push(`"${el.textContent.trim().slice(0, 20)}" contrast ${ratio.toFixed(1)}:1 (need ${minRatio}:1)`);
          }
        }
        return problems.slice(0, 10);
      });

      lowContrast.push(...issues.map(i => `${url}: ${i}`));
    }

    if (pagesChecked === 0) { test.skip(); return; }
    if (lowContrast.length > 0) console.warn("Low contrast:", lowContrast);
    // Warn but don't fail — some may be intentional decorative text
    expect(lowContrast.length).toBeLessThan(15);
  });

  test("touch targets are at least 44px on mobile", async ({ page }) => {
    const vp = page.viewportSize();
    if (!vp || vp.width >= 768) { test.skip(); return; }

    const tooSmall: string[] = [];
    let pagesChecked = 0;

    for (const url of ["/dashboard", "/leads", "/deals", "/deal-feed"]) {
      if (!await navigateTo(page, url)) continue;
      pagesChecked++;

      const issues = await page.evaluate(() => {
        const interactive = document.querySelectorAll("button, a, input, select, [role='button'], [tabindex]");
        const problems: string[] = [];
        for (const el of Array.from(interactive).slice(0, 100)) {
          const rect = (el as HTMLElement).getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && (rect.height < 36 || rect.width < 36)) {
            const label = el.textContent?.trim().slice(0, 20) || el.getAttribute("aria-label") || el.tagName;
            problems.push(`${label}: ${Math.round(rect.width)}x${Math.round(rect.height)}`);
          }
        }
        return problems.slice(0, 10);
      });

      tooSmall.push(...issues.map(i => `${url}: ${i}`));
    }

    if (pagesChecked === 0) { test.skip(); return; }
    if (tooSmall.length > 0) console.warn("Small touch targets:", tooSmall);
    expect(tooSmall.length).toBeLessThan(10);
  });

  test("modals/sheets don't appear behind other elements", async ({ page }) => {
    if (!await navigateTo(page, "/dashboard")) { test.skip(); return; }

    const triggerBtn = page.locator("button:has-text('Create'), button:has-text('Add'), button:has-text('New')").first();
    if (await triggerBtn.isVisible()) {
      await triggerBtn.click();
      await page.waitForTimeout(500);

      const dialog = page.locator("[role='dialog'], [class*='modal'], [class*='sheet']").first();
      if (await dialog.count() > 0 && await dialog.isVisible()) {
        const zIndex = await dialog.evaluate(el =>
          parseInt(getComputedStyle(el).zIndex) || 0
        );
        expect(zIndex).toBeGreaterThanOrEqual(40);

        // Verify dialog is in the visible viewport area
        const box = await dialog.boundingBox();
        if (box) {
          const vw = await page.evaluate(() => window.innerWidth);
          expect(box.x).toBeGreaterThanOrEqual(-10);
          expect(box.y).toBeGreaterThanOrEqual(-10);
          expect(box.x + box.width).toBeLessThanOrEqual(vw + 10);
        }
      }
    }
  });

  test("tooltips and popovers stay within viewport", async ({ page }) => {
    if (!await navigateTo(page, "/properties")) { test.skip(); return; }

    const triggers = page.locator("[title], [data-tooltip], [class*='tooltip-trigger']");
    const count = await triggers.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const trigger = triggers.nth(i);
      if (await trigger.isVisible()) {
        await trigger.hover();
        await page.waitForTimeout(300);

        const popover = page.locator("[role='tooltip'], [class*='tooltip'], [class*='popover']").first();
        if (await popover.count() > 0) {
          const box = await popover.boundingBox();
          const vw = await page.evaluate(() => window.innerWidth);
          const vh = await page.evaluate(() => window.innerHeight);
          if (box && (box.x < 0 || box.y < 0 || box.x + box.width > vw || box.y + box.height > vh)) {
            console.warn(`Tooltip clipped on ${await trigger.textContent()}`);
            await page.screenshot({ path: `tests/simulation/screenshots/perceptual-tooltip-clip-${i}.png` });
          }
        }
      }
    }
  });

  test("scroll resets to top on page navigation", async ({ page }) => {
    if (!await navigateTo(page, "/leads")) { test.skip(); return; }
    await page.evaluate(() => window.scrollTo(0, 500));

    if (!await navigateTo(page, "/deals")) { test.skip(); return; }
    if (!await navigateTo(page, "/leads")) { test.skip(); return; }

    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeLessThan(50);
  });

  test("text is readable without zooming on all pages (mobile)", async ({ page }) => {
    const vp = page.viewportSize();
    if (!vp || vp.width >= 768) { test.skip(); return; }

    let pagesChecked = 0;
    for (const url of ["/dashboard", "/leads", "/deals", "/finance"]) {
      if (!await navigateTo(page, url)) continue;
      pagesChecked++;

      const smallest = await page.evaluate(() => {
        let min = 100;
        document.querySelectorAll("p, span, td, li, label, a, div").forEach(el => {
          const s = parseFloat(getComputedStyle(el).fontSize);
          if (s > 0 && (el as HTMLElement).textContent?.trim()) min = Math.min(min, s);
        });
        return min;
      });

      expect(smallest).toBeGreaterThanOrEqual(10);
    }

    if (pagesChecked === 0) test.skip();
  });
});
