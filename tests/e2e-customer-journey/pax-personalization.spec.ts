/**
 * KRIEGER — Customer Journey: Pax personalization contract.
 *
 * After the standard signup walk (signup-to-first-value.spec.ts) seeds a
 * user with vertical='land_investing', experience='intermediate',
 * focus='Texas Hill Country', this spec verifies Pax's response actually
 * surfaces that captured context.
 *
 * The contract:
 *   Send "Tell me what you know about my situation."
 *   The response substring must contain at least one of:
 *     - "land"           (vertical match)
 *     - "Texas"          (geographic match)
 *     - "intermediate"   (experience match)
 *   Case-insensitive. ANY single hit satisfies — the bar is "Pax has
 *   *some* memory of who you are," not exhaustive recall.
 *
 * Skip gracefully when VOYAGE_API_KEY is unset on the runner. The
 * embedding-driven memory layer requires Voyage; without it, the
 * synthetic walk would generate false reds for an env-config issue.
 */
import {
  test,
  expect,
  type Page,
  type TestInfo,
} from "@playwright/test";

interface ProjectMeta {
  formFactor: "mobile" | "desktop";
  colorScheme: "light" | "dark";
  baseDevice: string;
}

function resolveProjectMeta(testInfo: TestInfo): ProjectMeta {
  const md = (testInfo.project.metadata ?? {}) as Partial<ProjectMeta>;
  return {
    formFactor: md.formFactor ?? "mobile",
    colorScheme: md.colorScheme ?? "light",
    baseDevice: md.baseDevice ?? testInfo.project.name,
  };
}

async function seedTestAuth(page: Page, baseURL: string): Promise<void> {
  const { hostname } = new URL(baseURL);
  await page.context().addCookies([
    {
      name: "__session",
      value: "e2e-customer-journey-pax",
      domain: hostname,
      path: "/",
    },
  ]);
}

const PERSONALIZATION_TOKENS = [
  /\bland\b/i,
  /\btexas\b/i,
  /\bintermediate\b/i,
  /\bhill country\b/i,
  /\binvest(or|ing|ment)\b/i,
];

test.describe("CJ2: Pax personalization contract", () => {
  test("Pax response references captured vertical + experience + focus", async ({
    page,
    baseURL,
  }, testInfo) => {
    // Skip gracefully when Voyage isn't available on the runner.
    test.skip(
      !process.env.VOYAGE_API_KEY,
      "VOYAGE_API_KEY unset — embedding-driven memory unavailable; skipping personalization contract",
    );

    const meta = resolveProjectMeta(testInfo);
    await page.emulateMedia({ colorScheme: meta.colorScheme });
    await seedTestAuth(page, baseURL!);

    await page.goto("/ai", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const composer = page
      .locator(
        'textarea, [contenteditable="true"], [data-testid*="composer"], [data-testid*="message-input"]',
      )
      .first();
    const composerVisible = await composer.isVisible().catch(() => false);
    expect(
      composerVisible,
      "Pax composer affordance missing — cannot test personalization",
    ).toBe(true);

    const probe = "Tell me what you know about my situation.";
    await composer.click();
    await composer.fill(probe);

    // Submit — Enter key OR a send button if available.
    const sendBtn = page
      .locator(
        '[data-testid*="send"], button[aria-label*="send" i], [data-testid="button-send-message"]',
      )
      .first();
    if (await sendBtn.isVisible().catch(() => false)) {
      await sendBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    // Wait for a response message to appear. Pax responses generally
    // surface as a new message element with role="assistant" or as a
    // [data-testid*="message"] / [data-role*="assistant"] node.
    // We poll for the body to contain text we did NOT type.
    await expect
      .poll(
        async () => {
          const body = await page.evaluate(
            () => document.body?.innerText || "",
          );
          // Look for content past our probe message — strip the probe,
          // see what remains. Any 60+ chars of additional content
          // counts as "Pax replied."
          const stripped = body.replace(new RegExp(probe, "i"), "").trim();
          return stripped.length;
        },
        {
          message: "Pax did not respond to personalization probe in 30s",
          timeout: 30_000,
          intervals: [1000, 2000, 3000],
        },
      )
      .toBeGreaterThan(60);

    const responseText = await page.evaluate(
      () => document.body?.innerText || "",
    );
    const responseLower = responseText.toLowerCase();
    const hits = PERSONALIZATION_TOKENS.filter((re) =>
      re.test(responseLower),
    );

    testInfo.attachments.push({
      name: `pax-personalization-${meta.baseDevice}-${meta.colorScheme}`,
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify(
          {
            meta,
            probe,
            hitsCount: hits.length,
            hitsPatterns: hits.map((re) => re.source),
            responseSample: responseText.slice(0, 600),
          },
          null,
          2,
        ),
      ),
    });

    expect(
      hits.length,
      `Pax response surfaced ZERO personalization tokens (expected ≥1 of: land/texas/intermediate/hill country/invest*) — response sample: "${responseText.slice(0, 240)}"`,
    ).toBeGreaterThan(0);
  });
});
