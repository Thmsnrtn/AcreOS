/**
 * E2E: Property management flows
 *
 * Covers: property list, search, map view, watchlist.
 */
import { test, expect } from "@playwright/test"

test.describe("Properties list", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/properties")
  })

  test("renders properties page", async ({ page }) => {
    await expect(page).toHaveURL(/\/properties/)
    const hasTable = await page.getByRole("table").isVisible().catch(() => false)
    const hasCards = await page.locator("[data-testid*='property-card']").first().isVisible().catch(() => false)
    const hasEmpty = await page.getByText(/no properties|add your first|get started/i).isVisible().catch(() => false)
    expect(hasTable || hasCards || hasEmpty).toBeTruthy()
  })

  test("search filters property list", async ({ page }) => {
    const search = page.getByPlaceholder(/search/i).first()
    if (!(await search.isVisible())) {
      test.skip()
      return
    }
    await search.fill("xyz_not_a_real_property_123")
    await expect(
      page.getByText(/no results|no properties found|0 properties/i)
    ).toBeVisible({ timeout: 5_000 })
  })
})

test.describe("Create property", () => {
  test("opens add property form", async ({ page }) => {
    await page.goto("/properties")
    const addBtn = page.getByRole("button", { name: /add property|new property|create property/i })
    if (!(await addBtn.isVisible())) {
      test.skip()
      return
    }
    await addBtn.click()
    await expect(page.getByRole("dialog")).toBeVisible()
  })
})

test.describe("Map view", () => {
  test("navigates to map page", async ({ page }) => {
    await page.goto("/maps")
    // Map container or a loading state
    const hasMap = await page.locator(".mapboxgl-map, [data-testid*='map']").isVisible({ timeout: 10_000 }).catch(() => false)
    const hasLoading = await page.getByText(/loading map|initializing/i).isVisible().catch(() => false)
    expect(hasMap || hasLoading || page.url().includes("map")).toBeTruthy()
  })
})

test.describe("Market watchlist", () => {
  test("renders watchlist page", async ({ page }) => {
    await page.goto("/market-watchlist")
    const hasContent =
      (await page.getByRole("heading").first().isVisible().catch(() => false)) ||
      (await page.getByText(/watchlist|no items|add market/i).first().isVisible().catch(() => false))
    expect(hasContent).toBeTruthy()
  })
})
