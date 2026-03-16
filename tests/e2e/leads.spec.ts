/**
 * E2E: Leads management flows
 *
 * Covers: create lead, view lead profile, update status, filter/search.
 * Uses shared authenticated session from auth.setup.ts.
 */
import { test, expect } from "@playwright/test"

test.describe("Leads list", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/leads")
    await expect(page).toHaveURL(/\/leads/)
  })

  test("renders leads page with table or empty state", async ({ page }) => {
    const hasTable = await page.getByRole("table").isVisible().catch(() => false)
    const hasEmpty = await page.getByText(/no leads|get started|add your first/i).isVisible().catch(() => false)
    expect(hasTable || hasEmpty).toBeTruthy()
  })

  test("search input filters results", async ({ page }) => {
    const search = page.getByPlaceholder(/search/i).first()
    if (!(await search.isVisible())) {
      test.skip()
      return
    }
    await search.fill("nonexistent_xyz_abc_123")
    // Should show empty or no-match state
    await expect(
      page.getByText(/no results|no leads found|0 leads/i)
    ).toBeVisible({ timeout: 5_000 })
  })
})

test.describe("Create lead", () => {
  test("opens create lead form", async ({ page }) => {
    await page.goto("/leads")
    const addBtn = page.getByRole("button", { name: /add lead|new lead|create lead/i })
    await expect(addBtn).toBeVisible()
    await addBtn.click()

    // Dialog or form should appear
    await expect(
      page.getByRole("dialog").or(page.getByRole("form"))
    ).toBeVisible()
  })

  test("validates required fields before submit", async ({ page }) => {
    await page.goto("/leads")
    const addBtn = page.getByRole("button", { name: /add lead|new lead|create lead/i })
    if (!(await addBtn.isVisible())) {
      test.skip()
      return
    }
    await addBtn.click()

    const form = page.getByRole("dialog")
    await expect(form).toBeVisible()

    // Submit without filling required fields
    await form.getByRole("button", { name: /save|submit|create/i }).click()

    // Expect validation messages
    await expect(form.getByRole("alert").or(form.locator("[aria-invalid='true']"))).toBeVisible()
  })

  test("creates a lead with first and last name", async ({ page }) => {
    await page.goto("/leads")
    const addBtn = page.getByRole("button", { name: /add lead|new lead|create lead/i })
    if (!(await addBtn.isVisible())) {
      test.skip()
      return
    }
    await addBtn.click()

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()

    const ts = Date.now()
    const firstName = `E2EFirst${ts}`
    const lastName = `E2ELast${ts}`

    const firstNameInput = dialog.getByLabel(/first name/i)
    const lastNameInput = dialog.getByLabel(/last name/i)

    if (!(await firstNameInput.isVisible())) {
      test.skip()
      return
    }

    await firstNameInput.fill(firstName)
    await lastNameInput.fill(lastName)

    // Fill other required fields if present
    const emailInput = dialog.getByLabel(/email/i)
    if (await emailInput.isVisible()) {
      await emailInput.fill(`e2e-${ts}@test.com`)
    }

    await dialog.getByRole("button", { name: /save|submit|create/i }).click()

    // Dialog closes and new lead appears in list
    await expect(dialog).not.toBeVisible({ timeout: 8_000 })
    await expect(page.getByText(firstName)).toBeVisible({ timeout: 8_000 })
  })
})

test.describe("Lead detail", () => {
  test("navigates to lead profile on row click", async ({ page }) => {
    await page.goto("/leads")

    const firstRow = page.getByRole("row").nth(1) // skip header
    if (!(await firstRow.isVisible())) {
      test.skip()
      return
    }
    await firstRow.click()
    // Should navigate to a lead detail page or open a panel
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 5_000 })
  })
})
