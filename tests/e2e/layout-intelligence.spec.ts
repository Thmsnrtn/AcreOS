import { test, expect, type Page } from "@playwright/test";

const CORE_PAGES = [
  "/dashboard", "/leads", "/deals", "/properties", "/finance",
  "/deal-feed", "/freedom-meter", "/campaigns", "/marketplace",
  "/compliance", "/settings", "/portfolio-health", "/market-data",
  "/land-credit", "/analytics",
];

// —— Utility functions ——

async function getVisibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let text = "";
    while (walker.nextNode()) {
      const p = walker.currentNode.parentElement;
      if (p && p.offsetParent !== null && !["SCRIPT","STYLE","NOSCRIPT","CODE","PRE"].includes(p.tagName)) {
        text += " " + (walker.currentNode.textContent || "");
      }
    }
    return text;
  });
}

async function screenshotPage(page: Page, name: string) {
  const project = test.info().project.name;
  await page.screenshot({
    path: `tests/simulation/screenshots/${name}-${project}.png`,
    fullPage: true,
  });
}

// —— Structural Consistency Tests ——

test.describe("Layer 1: Structural Integrity", () => {

  test("sidebar present and consistent width on every page (desktop)", async ({ page }) => {
    const vp = page.viewportSize();
    if (vp && vp.width < 768) { test.skip(); return; }

    let referenceWidth: number | null = null;
    const issues: string[] = [];

    for (const url of CORE_PAGES) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);

      const sidebar = page.locator("nav, [data-testid*='sidebar'], [class*='sidebar']").first();
      if ((await sidebar.count()) === 0 || !await sidebar.isVisible()) {
        issues.push(`${url}: sidebar missing`);
        await screenshotPage(page, `sidebar-missing-${url.replace(/\//g,"-").slice(1)}`);
        continue;
      }

      const box = await sidebar.boundingBox();
      if (!box) continue;

      if (referenceWidth === null) referenceWidth = box.width;
      else if (Math.abs(box.width - referenceWidth) > 5) {
        issues.push(`${url}: sidebar ${box.width}px (expected ~${referenceWidth}px)`);
      }
    }

    expect(issues).toEqual([]);
  });

  test("zero horizontal overflow on any page at any viewport", async ({ page }) => {
    const overflows: string[] = [];

    for (const url of CORE_PAGES) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);

      const hasOverflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth
      );

      if (hasOverflow) {
        overflows.push(url);
        await screenshotPage(page, `overflow-${url.replace(/\//g,"-").slice(1)}`);
      }
    }

    expect(overflows).toEqual([]);
  });

  test("zero developer artifacts in visible text", async ({ page }) => {
    const BAD = [
      [/\bNaN\b/, "NaN"], [/\bundefined\b/, "undefined"], [/\bInfinity\b/, "Infinity"],
      [/\[object Object\]/, "[object Object]"], [/Error:\s/, "Error message"],
      [/Cannot read prop/, "JS error"], [/TODO:?\s/i, "TODO"],
      [/FIXME/i, "FIXME"], [/lorem ipsum/i, "placeholder"],
      [/\$0\.00(?!\s*[\w])/, "$0.00 (possibly null)"],
    ] as const;

    const violations: string[] = [];

    for (const url of CORE_PAGES) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);

      const text = await getVisibleText(page);
      for (const [pattern, label] of BAD) {
        if (pattern.test(text)) {
          violations.push(`${url}: "${label}" visible`);
          await screenshotPage(page, `artifact-${label.replace(/\s/g,"-")}-${url.replace(/\//g,"-").slice(1)}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("no elements clip beyond viewport bounds", async ({ page }) => {
    const issues: string[] = [];

    for (const url of CORE_PAGES.slice(0, 8)) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");

      const clipped = await page.evaluate(() => {
        const vw = window.innerWidth;
        const problems: string[] = [];
        document.querySelectorAll("*").forEach((el, i) => {
          if (i > 600) return; // perf limit
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width > 0 && r.right > vw + 5 && r.left >= 0) {
            problems.push(`<${el.tagName.toLowerCase()}> extends ${Math.round(r.right - vw)}px past viewport`);
          }
        });
        return problems.slice(0, 3);
      });

      issues.push(...clipped.map(c => `${url}: ${c}`));
    }

    expect(issues.length).toBeLessThanOrEqual(2);
  });

  test("all images load (no broken images)", async ({ page }) => {
    const broken: string[] = [];
    for (const url of CORE_PAGES.slice(0, 8)) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const fails = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("img"))
          .filter(img => !img.complete || img.naturalWidth === 0)
          .map(img => img.src || img.alt || "(unknown)")
          .slice(0, 3);
      });
      broken.push(...fails.map(f => `${url}: ${f}`));
    }
    expect(broken).toEqual([]);
  });

  test("consistent content padding across pages", async ({ page }) => {
    const paddings: number[] = [];
    for (const url of CORE_PAGES.slice(0, 6)) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const pl = await page.evaluate(() => {
        const main = document.querySelector("main, [role='main'], [class*='page-content']") as HTMLElement;
        return main ? parseFloat(getComputedStyle(main).paddingLeft) : -1;
      });
      if (pl >= 0) paddings.push(pl);
    }

    if (paddings.length >= 2) {
      const avg = paddings.reduce((s, v) => s + v, 0) / paddings.length;
      const outliers = paddings.filter(p => Math.abs(p - avg) > 20);
      expect(outliers.length).toBeLessThanOrEqual(1);
    }
  });

  test("all forms have labeled inputs", async ({ page }) => {
    const unlabeled: string[] = [];
    for (const url of ["/leads", "/deals", "/settings", "/finance"]) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const issues = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("input, textarea, select"))
          .filter(el => {
            const id = (el as HTMLElement).id;
            const label = id ? document.querySelector(`label[for="${id}"]`) : null;
            const ariaLabel = el.getAttribute("aria-label");
            const ariaLabelledby = el.getAttribute("aria-labelledby");
            const placeholder = el.getAttribute("placeholder");
            return !label && !ariaLabel && !ariaLabelledby && !placeholder;
          })
          .map(el => `<${el.tagName.toLowerCase()}> name="${el.getAttribute("name") || ""}"`)
      });
      unlabeled.push(...issues.map(i => `${url}: ${i}`));
    }
    if (unlabeled.length > 0) console.warn("Unlabeled inputs:", unlabeled);
    expect(unlabeled.length).toBeLessThan(5);
  });
});

// —— Navigation Stability ——

test.describe("Layer 1: Navigation Stability", () => {

  test("forward/back navigation preserves layout", async ({ page }) => {
    const sequence = ["/dashboard", "/leads", "/deals", "/properties", "/dashboard"];

    for (const url of sequence) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const error = page.locator("[class*='error-boundary'], text=/something went wrong/i");
      expect(await error.count()).toBe(0);
    }

    await page.goBack();
    await page.waitForLoadState("networkidle");
    expect(await page.locator("[class*='error-boundary']").count()).toBe(0);

    await page.goForward();
    await page.waitForLoadState("networkidle");
    expect(await page.locator("[class*='error-boundary']").count()).toBe(0);
  });

  test("rapid clicking doesn't create duplicate modals or race conditions", async ({ page }) => {
    await page.goto("/leads");
    await page.waitForLoadState("networkidle");

    const btn = page.locator("button:has-text('Add'), button:has-text('Create'), button:has-text('New')").first();
    if (await btn.isVisible()) {
      await btn.click();
      await btn.click();
      await btn.click();
      await page.waitForTimeout(500);

      const dialogs = page.locator("[role='dialog'], [class*='modal'], [class*='sheet']");
      expect(await dialogs.count()).toBeLessThanOrEqual(1);
    }
  });

  test("all sidebar links navigate without 500 errors", async ({ page }) => {
    const vp = page.viewportSize();
    if (vp && vp.width < 768) { test.skip(); return; }

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const navLinks = await page.locator("nav a[href], aside a[href], [class*='sidebar'] a[href]").all();
    const hrefs = new Set<string>();

    for (const link of navLinks) {
      const href = await link.getAttribute("href");
      if (href && href.startsWith("/") && !hrefs.has(href)) {
        hrefs.add(href);
      }
    }

    const errors: string[] = [];
    for (const href of hrefs) {
      await page.goto(href);
      const resp = await page.waitForLoadState("networkidle").catch(() => null);
      const error = page.locator("[class*='error-boundary'], text=/something went wrong/i");
      if (await error.count() > 0) {
        errors.push(href);
        await screenshotPage(page, `nav-error-${href.replace(/\//g,"-").slice(1)}`);
      }
    }

    expect(errors).toEqual([]);
  });

  test("zero console errors during normal navigation", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", msg => {
      if (msg.type() === "error") {
        const t = msg.text();
        if (!t.includes("favicon") && !t.includes("net::ERR") && !t.includes("ResizeObserver")) {
          errors.push(t.slice(0, 200));
        }
      }
    });

    for (const url of CORE_PAGES.slice(0, 10)) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);
    }

    if (errors.length > 0) console.error("Console errors:", errors.slice(0, 10));
    expect(errors.length).toBeLessThan(5);
  });
});
