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

test.describe("Forgot Password", () => {
  test("forgot password page loads and form submits successfully", async ({ page }) => {
    await page.goto("/forgot-password")
    await expect(page.getByRole("heading", { name: /forgot/i })).toBeVisible()
    await page.getByTestId("input-forgot-email").fill("test@example.com")
    await page.getByTestId("button-forgot-submit").click()
    // Should show confirmation message (always 200 to prevent enumeration)
    await expect(page.getByText(/if an account exists/i)).toBeVisible({ timeout: 5_000 })
  })

  test("forgot password rejects invalid email", async ({ page }) => {
    await page.goto("/forgot-password")
    await page.getByTestId("input-forgot-email").fill("not-an-email")
    await page.getByTestId("button-forgot-submit").click()
    // HTML5 validation or server error
    await expect(page).toHaveURL(/\/forgot-password/)
  })
})

test.describe("Reset Password", () => {
  test("reset password page shows invalid token error for missing token", async ({ page }) => {
    await page.goto("/reset-password")
    // No token in URL — should show error
    await expect(page.getByRole("heading", { name: /invalid reset link/i })).toBeVisible()
  })

  test("reset password with expired token shows error", async ({ page }) => {
    await page.goto("/reset-password?token=0000000000000000000000000000000000000000000000000000000000000000")
    await page.getByTestId("input-new-password").fill("NewPass123!")
    await page.getByTestId("input-confirm-password").fill("NewPass123!")
    await page.getByTestId("button-reset-submit").click()
    await expect(page.getByText(/invalid or expired/i)).toBeVisible({ timeout: 5_000 })
  })
})
