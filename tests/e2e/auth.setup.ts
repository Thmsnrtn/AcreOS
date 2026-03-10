/**
 * Auth setup — runs before all tests to create a persisted signed-in state.
 *
 * The resulting storageState is saved to tests/e2e/.auth/user.json and reused
 * by all test projects, so login only happens once per test run.
 */
import { test as setup, expect } from "@playwright/test"
import path from "path"

const authFile = path.join(__dirname, ".auth/user.json")

setup("authenticate", async ({ page }) => {
  await page.goto("/auth")

  // Fill in test credentials (set via env or use a seeded test user)
  const email = process.env.E2E_USER_EMAIL ?? "test@acreos.dev"
  const password = process.env.E2E_USER_PASSWORD ?? "TestPass123!"

  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill(password)
  await page.getByRole("button", { name: /sign in|log in/i }).click()

  // Wait until we land on the dashboard (not the auth page)
  await expect(page).not.toHaveURL(/\/auth/)
  await expect(page).toHaveURL(/\/(dashboard|$)/)

  // Persist the signed-in cookies/localStorage so other tests can skip login
  await page.context().storageState({ path: authFile })
})
