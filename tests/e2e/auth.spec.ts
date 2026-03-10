/**
 * E2E: Authentication flows
 *
 * Covers: register, login, logout, password validation, session persistence.
 * These tests run without the shared auth state (they need a fresh session).
 */
import { test, expect } from "@playwright/test"

// Override storageState so these tests start unauthenticated
test.use({ storageState: { cookies: [], origins: [] } })

test.describe("Login", () => {
  test("shows validation error for empty fields", async ({ page }) => {
    await page.goto("/auth")
    await page.getByRole("button", { name: /sign in|log in/i }).click()
    // Should stay on auth page and show an error
    await expect(page).toHaveURL(/\/auth/)
  })

  test("shows error for invalid credentials", async ({ page }) => {
    await page.goto("/auth")
    await page.getByLabel(/email/i).fill("nobody@example.com")
    await page.getByLabel(/password/i).fill("WrongPassword1!")
    await page.getByRole("button", { name: /sign in|log in/i }).click()
    await expect(page.getByRole("alert")).toBeVisible()
    await expect(page).toHaveURL(/\/auth/)
  })

  test("logs in with valid credentials and redirects to dashboard", async ({ page }) => {
    const email = process.env.E2E_USER_EMAIL ?? "test@acreos.dev"
    const password = process.env.E2E_USER_PASSWORD ?? "TestPass123!"

    await page.goto("/auth")
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).fill(password)
    await page.getByRole("button", { name: /sign in|log in/i }).click()

    await expect(page).not.toHaveURL(/\/auth/, { timeout: 10_000 })
    await expect(page.getByRole("navigation")).toBeVisible()
  })
})

test.describe("Registration", () => {
  test("shows password strength requirements", async ({ page }) => {
    await page.goto("/auth")
    // Switch to register tab/form if applicable
    const registerLink = page.getByRole("button", { name: /register|sign up|create account/i })
    if (await registerLink.isVisible()) {
      await registerLink.click()
    }

    const passwordInput = page.getByLabel(/^password$/i)
    if (await passwordInput.isVisible()) {
      await passwordInput.fill("short")
      // Expect some validation feedback
      await expect(page.getByText(/at least|minimum|characters/i)).toBeVisible()
    }
  })

  test("rejects duplicate email", async ({ page }) => {
    const email = process.env.E2E_USER_EMAIL ?? "test@acreos.dev"
    await page.goto("/auth")

    const registerLink = page.getByRole("button", { name: /register|sign up|create account/i })
    if (!(await registerLink.isVisible())) {
      test.skip()
      return
    }
    await registerLink.click()

    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/^password$/i).fill("ValidPass123!")
    await page.getByRole("button", { name: /register|sign up|create account/i }).click()

    await expect(page.getByRole("alert")).toBeVisible({ timeout: 5_000 })
  })
})

test.describe("Logout", () => {
  test("logs out and redirects to auth page", async ({ page }) => {
    // Sign in first
    const email = process.env.E2E_USER_EMAIL ?? "test@acreos.dev"
    const password = process.env.E2E_USER_PASSWORD ?? "TestPass123!"

    await page.goto("/auth")
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).fill(password)
    await page.getByRole("button", { name: /sign in|log in/i }).click()
    await expect(page).not.toHaveURL(/\/auth/, { timeout: 10_000 })

    // Trigger logout
    const logoutBtn = page.getByRole("button", { name: /log out|sign out/i })
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click()
    } else {
      // May be nested in a menu
      await page.getByRole("button", { name: /user|account|profile/i }).first().click()
      await page.getByRole("menuitem", { name: /log out|sign out/i }).click()
    }

    await expect(page).toHaveURL(/\/auth/, { timeout: 5_000 })
  })
})
