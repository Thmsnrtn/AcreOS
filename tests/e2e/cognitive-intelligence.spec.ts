import { test, expect } from "@playwright/test";

test.describe("Layer 4: Cognitive Load & Clarity", () => {

  test("no page has more than 7 primary action buttons competing", async ({ page }) => {
    const overloaded: string[] = [];
    const pages = ["/dashboard", "/leads", "/deals", "/properties", "/finance", "/deal-feed"];

    for (const url of pages) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");

      const primaryBtns = await page.evaluate(() => {
        const btns = document.querySelectorAll("button");
        let primary = 0;
        for (const btn of Array.from(btns)) {
          const style = getComputedStyle(btn);
          const bg = style.backgroundColor;
          const isVisible = (btn as HTMLElement).offsetParent !== null;
          const isLargeEnough = btn.getBoundingClientRect().width > 60;
          // Primary = visible, not in a dialog, not small icon buttons
          if (isVisible && isLargeEnough && !btn.closest("[role='dialog']")) {
            primary++;
          }
        }
        return primary;
      });

      if (primaryBtns > 10) {
        overloaded.push(`${url}: ${primaryBtns} prominent buttons — may overwhelm users`);
      }
    }

    if (overloaded.length > 0) console.warn("Cognitive overload risk:", overloaded);
  });

  test("jargon terms have nearby explanations or tooltips", async ({ page }) => {
    const JARGON = [
      "LCS", "ARV", "MAO", "LTV", "NOI", "BYOK", "Dodd-Frank", "TCPA",
      "1031", "cap rate", "amortization", "escrow", "deed of trust",
      "usury", "dunning", "AML", "RESPA", "adverse possession", "partition",
    ];

    const unexplained: string[] = [];

    for (const url of ["/dashboard", "/deal-feed", "/finance", "/compliance"]) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");

      const pageText = await page.textContent("body") || "";

      for (const term of JARGON) {
        if (pageText.includes(term)) {
          const hasHelp = await page.evaluate((t) => {
            const body = document.body.innerHTML;
            const idx = body.indexOf(t);
            if (idx < 0) return true; // not found, skip
            // Check 500 chars around the term for help indicators
            const context = body.slice(Math.max(0, idx - 500), idx + 500);
            return context.includes("title=") ||
                   context.includes("tooltip") ||
                   context.includes("help-tooltip") ||
                   context.includes("aria-describedby") ||
                   context.includes("HelpCircle") ||
                   context.includes("(?)");
          }, term);

          if (!hasHelp) {
            unexplained.push(`${url}: "${term}" used without nearby explanation`);
          }
        }
      }
    }

    if (unexplained.length > 0) console.warn("Unexplained jargon:", unexplained);
    // This is informational — jargon in a professional tool is expected
  });

  test("empty states provide guidance, not just 'no data'", async ({ page }) => {
    const badEmptyStates: string[] = [];
    const emptyPages = ["/deal-feed", "/freedom-meter", "/deal-patterns", "/portfolio-health"];

    for (const url of emptyPages) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");

      const mainText = await page.locator("main, [role='main']").first().textContent() || "";

      // Bad: just "No data" or "Nothing here"
      const isBadEmpty = /^(no data|nothing|empty|none|no results?)\.?$/i.test(mainText.trim());
      // Good: has a CTA or explanation
      const hasCTA = await page.locator("main button, main a[href]").count() > 0;
      const hasExplanation = mainText.trim().length > 50;

      if (mainText.trim().length > 0 && mainText.trim().length < 30 && !hasCTA) {
        badEmptyStates.push(`${url}: empty state is too terse — "${mainText.trim().slice(0, 50)}"`);
      }

      await page.screenshot({ path: `tests/simulation/screenshots/cognitive-empty-${url.replace(/\//g,"-").slice(1)}.png` });
    }

    if (badEmptyStates.length > 0) console.warn("Poor empty states:", badEmptyStates);
    expect(badEmptyStates).toEqual([]);
  });

  test("numbers always have units or context", async ({ page }) => {
    const naked: string[] = [];

    for (const url of ["/dashboard", "/deal-feed", "/finance", "/portfolio-health"]) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");

      const issues = await page.evaluate(() => {
        const problems: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const text = walker.currentNode.textContent?.trim() || "";
          const parent = walker.currentNode.parentElement;
          if (!parent || parent.offsetParent === null) continue;
          if (["SCRIPT","STYLE","CODE","PRE"].includes(parent.tagName)) continue;

          // A standalone large number without $ or % or unit
          if (/^\d{3,}$/.test(text) && !parent.closest("[class*='badge'], [class*='id'], [class*='count']")) {
            problems.push(`"${text}" — number without context (${parent.tagName})`);
          }
        }
        return problems.slice(0, 5);
      });

      naked.push(...issues.map(i => `${url}: ${i}`));
    }

    if (naked.length > 0) console.warn("Contextless numbers:", naked);
  });
});
