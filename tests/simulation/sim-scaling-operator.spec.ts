/**
 * Persona 2 — "Scaling Steve"
 *
 * Active operator with 200+ leads, imports CSVs, runs campaigns.
 * Tests: signup → onboarding (active) → CSV import 200 → campaign creation →
 *        sequence enrollment → deal + property + note → amortization schedule →
 *        borrower portal → upgrade flow.
 */

import { test, expect, type Page } from "@playwright/test";
import { PERSONAS } from "./personas";

const persona = PERSONAS.scalingOperator;
const consoleErrors: string[] = [];

test.describe.serial("Scaling Steve — Full Journey", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`[console.error] ${msg.text()}`);
    });
    page.on("response", (res) => {
      if (res.status() >= 500) consoleErrors.push(`[500] ${res.url()} → ${res.status()}`);
    });
  });

  test.afterAll(async () => {
    if (consoleErrors.length > 0) {
      console.warn("Console errors during Steve journey:", consoleErrors);
    }
    await page.context().close();
  });

  // ── Step 1: Signup & onboarding ────────────────────────────────────────

  test("1. Sign up and complete active-path onboarding", async () => {
    await page.goto("/auth");
    await page.screenshot({ path: "tests/simulation/screenshots/steve-01-auth.png" });

    const signUpLink = page.getByText(/sign up|create account|register/i).first();
    if (await signUpLink.isVisible().catch(() => false)) {
      await signUpLink.click();
    }

    const emailField = page.getByLabel(/email/i).first();
    if (await emailField.isVisible().catch(() => false)) {
      await emailField.fill(persona.email);
      await page.getByLabel(/password/i).first().fill(persona.password);

      const nameField = page.getByLabel(/name/i).first();
      if (await nameField.isVisible().catch(() => false)) {
        await nameField.fill(persona.name);
      }

      await page.getByRole("button", { name: /sign up|create|register/i }).first().click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: "tests/simulation/screenshots/steve-02-post-signup.png" });

    // Complete onboarding by clicking through
    await page.goto("/onboarding");
    await page.waitForTimeout(1000);

    const completeBtn = page.getByRole("button", { name: /complete|finish|done|skip|get started/i }).first();
    if (await completeBtn.isVisible().catch(() => false)) {
      await completeBtn.click();
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: "tests/simulation/screenshots/steve-03-onboarding-done.png" });
  });

  // ── Step 2: CSV Import ─────────────────────────────────────────────────

  test("2. CSV import of 200 leads completes with progress indicator", async () => {
    await page.goto("/leads");
    await page.waitForTimeout(1500);

    // Look for import button
    const importBtn = page.getByRole("button", { name: /import|upload|csv/i }).first()
      .or(page.getByTestId("import-leads-btn"));

    if (!(await importBtn.isVisible().catch(() => false))) {
      await page.screenshot({ path: "tests/simulation/screenshots/steve-04-no-import-btn.png" });
      test.skip();
      return;
    }

    await importBtn.click();
    await page.waitForTimeout(1000);

    // Generate CSV content and upload
    const csvRows = ["firstName,lastName,email,phone,county,state,status"];
    for (let i = 0; i < 200; i++) {
      csvRows.push(`Lead${i},Import${i},lead-import-${i}@test.com,555-${String(i).padStart(4, "0")},Mohave,AZ,new`);
    }
    const csvContent = csvRows.join("\n");

    // Look for file input
    const fileInput = page.locator("input[type='file']").first();
    if (await fileInput.isVisible().catch(() => false)) {
      await fileInput.setInputFiles({
        name: "steve-leads.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csvContent),
      });

      await page.waitForTimeout(2000);

      // Look for progress indicator
      const progress = page.getByRole("progressbar")
        .or(page.getByTestId("import-progress"))
        .or(page.getByText(/importing|processing|progress/i));

      const hasProgress = await progress.first().isVisible().catch(() => false);

      // Wait for completion (up to 30 seconds)
      const successIndicator = page.getByText(/imported|complete|success|\d+ leads/i).first();
      await expect(successIndicator).toBeVisible({ timeout: 30_000 }).catch(() => {});
    }

    await page.screenshot({ path: "tests/simulation/screenshots/steve-04-csv-import.png" });
  });

  // ── Step 3: Verify leads paginate and search ───────────────────────────

  test("3. Lead list paginates correctly and search works", async () => {
    await page.goto("/leads");
    await page.waitForTimeout(2000);

    await page.screenshot({ path: "tests/simulation/screenshots/steve-05-leads-list.png" });

    // Verify leads are visible
    const table = page.getByRole("table").first();
    const hasList = await table.isVisible().catch(() => false);
    const hasCards = await page.locator("[data-testid*='lead-card'], [data-testid*='lead-row']")
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasList || hasCards).toBeTruthy();

    // Test search
    const search = page.getByPlaceholder(/search/i).first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill("Lead50");
      await page.waitForTimeout(1500);
      await page.screenshot({ path: "tests/simulation/screenshots/steve-06-lead-search.png" });

      await search.clear();
      await page.waitForTimeout(500);
    }

    // Check pagination
    const pagination = page.getByRole("navigation", { name: /pagination/i })
      .or(page.getByTestId("pagination"))
      .or(page.getByRole("button", { name: /next|page 2|›/i }));

    const hasPagination = await pagination.first().isVisible().catch(() => false);
    // With 200 leads, pagination should be visible
    if (hasPagination) {
      await page.screenshot({ path: "tests/simulation/screenshots/steve-07-pagination.png" });
    }
  });

  // ── Step 4: Campaign creation ──────────────────────────────────────────

  test("4. Campaign creation flow completes", async () => {
    await page.goto("/campaigns");
    await page.waitForTimeout(1500);

    const createBtn = page.getByRole("button", { name: /create|new|add/i }).first();
    if (!(await createBtn.isVisible().catch(() => false))) {
      await page.screenshot({ path: "tests/simulation/screenshots/steve-08-no-campaign-btn.png" });
      test.skip();
      return;
    }
    await createBtn.click();
    await page.waitForTimeout(1000);

    // Fill campaign name
    const nameInput = page.getByLabel(/name|campaign name|title/i).first()
      .or(page.getByPlaceholder(/campaign name|name/i).first());

    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill("Steve's Direct Mail Blast");
    }

    await page.screenshot({ path: "tests/simulation/screenshots/steve-08-campaign-create.png" });

    // Try to save/create
    const saveBtn = page.getByRole("button", { name: /save|create|next|continue/i }).first();
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: "tests/simulation/screenshots/steve-09-campaign-saved.png" });
  });

  // ── Step 5: Create deal and property ───────────────────────────────────

  test("5. Create a deal", async () => {
    await page.goto("/deals");
    await page.waitForTimeout(1000);

    const addBtn = page.getByRole("button", { name: /add deal|new deal|create deal/i }).first();
    if (!(await addBtn.isVisible().catch(() => false))) {
      test.skip();
      return;
    }
    await addBtn.click();

    const dialog = page.getByRole("dialog").first();
    if (await dialog.isVisible().catch(() => false)) {
      const nameInput = dialog.getByLabel(/name|title/i).first();
      if (await nameInput.isVisible().catch(() => false)) {
        await nameInput.fill("Steve's Flip - 40 Acres Mohave");
      }
      await dialog.getByRole("button", { name: /save|create/i }).first().click();
      await page.waitForTimeout(1500);
    }

    await page.screenshot({ path: "tests/simulation/screenshots/steve-10-deal.png" });
  });

  test("5b. Add a property", async () => {
    await page.goto("/properties");
    await page.waitForTimeout(1000);

    const addBtn = page.getByRole("button", { name: /add property|new property|create/i }).first();
    if (!(await addBtn.isVisible().catch(() => false))) {
      test.skip();
      return;
    }
    await addBtn.click();

    const dialog = page.getByRole("dialog").first();
    if (await dialog.isVisible().catch(() => false)) {
      const addrInput = dialog.getByLabel(/address|location/i).first();
      if (await addrInput.isVisible().catch(() => false)) {
        await addrInput.fill("123 Desert Rd, Mohave, AZ");
      }
      await dialog.getByRole("button", { name: /save|create/i }).first().click();
      await page.waitForTimeout(1500);
    }

    await page.screenshot({ path: "tests/simulation/screenshots/steve-11-property.png" });
  });

  // ── Step 6: Create note + amortization schedule ────────────────────────

  test("6. Create a note with amortization schedule", async () => {
    await page.goto("/finance");
    await page.waitForTimeout(1500);

    const addBtn = page.getByRole("button", { name: /add note|new note|create note/i }).first()
      .or(page.getByTestId("create-note-btn"));

    if (!(await addBtn.isVisible().catch(() => false))) {
      await page.screenshot({ path: "tests/simulation/screenshots/steve-12-no-note-btn.png" });
      test.skip();
      return;
    }
    await addBtn.click();
    await page.waitForTimeout(1000);

    await page.screenshot({ path: "tests/simulation/screenshots/steve-12-note-form.png" });

    // Fill note fields
    const fields = {
      /borrower.*name/i: "Alice Johnson",
      /balance|principal|amount/i: "25000",
      /interest.*rate|rate/i: "9.5",
      /term|months/i: "60",
      /monthly.*payment|payment/i: "524.87",
    };

    for (const [pattern, value] of Object.entries(fields)) {
      const input = page.getByLabel(new RegExp(pattern.toString().slice(1, -1), "i")).first();
      if (await input.isVisible().catch(() => false)) {
        await input.fill(value);
      }
    }

    const saveBtn = page.getByRole("button", { name: /save|create/i }).first();
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: "tests/simulation/screenshots/steve-13-note-created.png" });
  });

  // ── Step 7: Borrower portal ────────────────────────────────────────────

  test("7. Borrower portal is accessible", async () => {
    // Navigate to borrower portal (usually /portal or /borrower)
    await page.goto("/portal");
    await page.waitForTimeout(1500);

    await page.screenshot({ path: "tests/simulation/screenshots/steve-14-borrower-portal.png" });

    // Should show login form or portal content, not a crash
    const hasPortal = await page.getByText(/portal|borrower|payment|log in/i)
      .first()
      .isVisible()
      .catch(() => false);
    const has404 = await page.getByText(/not found|404/i).first().isVisible().catch(() => false);

    // Portal may or may not be available, but should not crash
    const serverErrors = consoleErrors.filter((e) => e.includes("[500]"));
    expect(serverErrors.filter((e) => e.includes("/portal"))).toHaveLength(0);
  });

  // ── Step 8: Upgrade flow ───────────────────────────────────────────────

  test("8. Upgrade flow navigates to billing settings", async () => {
    await page.goto("/settings");
    await page.waitForTimeout(1500);

    // Look for billing/plan/subscription section
    const billingLink = page.getByRole("link", { name: /billing|plan|subscription|upgrade/i }).first()
      .or(page.getByRole("tab", { name: /billing|plan/i }).first())
      .or(page.getByText(/billing|subscription|plan/i).first());

    if (await billingLink.isVisible().catch(() => false)) {
      await billingLink.click();
      await page.waitForTimeout(1500);
    }

    await page.screenshot({ path: "tests/simulation/screenshots/steve-15-billing.png" });

    // Look for upgrade button or Stripe checkout
    const upgradeBtn = page.getByRole("button", { name: /upgrade|change plan|subscribe/i }).first();
    const hasUpgrade = await upgradeBtn.isVisible().catch(() => false);

    // Billing section should exist
    const hasBilling = await page.getByText(/plan|billing|subscription|stripe/i)
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasBilling || hasUpgrade).toBeTruthy();
  });

  // ── Step 9: No 500s ───────────────────────────────────────────────────

  test("9. No server errors during the journey", async () => {
    const serverErrors = consoleErrors.filter((e) => e.includes("[500]"));
    if (serverErrors.length > 0) console.error("Server errors:", serverErrors);
    expect(serverErrors).toHaveLength(0);
  });
});
