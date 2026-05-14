/**
 * Auth setup — runs before all tests to create a persisted signed-in state.
 *
 * For Clerk-based auth, we use @clerk/testing/playwright if available,
 * otherwise attempt to interact with the Clerk sign-in component directly.
 *
 * If no credentials are configured, creates an empty storage state so tests
 * can still run (pages will redirect to /auth, and tests should handle that).
 */
import { test as setup, expect } from "@playwright/test"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const authDir = path.join(__dirname, ".auth")
const authFile = path.join(authDir, "user.json")

setup("authenticate", async ({ page }) => {
  // Ensure .auth directory exists
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true })
  }

  // When the parallel auth-clerk-ticket.setup.ts is handling auth via a
  // Clerk Backend-API ticket, this legacy UI flow MUST not run — its
  // empty-state fallback would clobber the good session.
  if (process.env.CLERK_SIGN_IN_TICKET) {
    console.log("CLERK_SIGN_IN_TICKET set — deferring to auth-clerk-ticket.setup.ts")
    return
  }

  const email = process.env.E2E_USER_EMAIL ?? ""
  const password = process.env.E2E_USER_PASSWORD ?? ""

  if (!email || !password) {
    // No credentials — write an empty storage state so dependent tests can proceed
    // Tests will land on /auth and should handle unauthenticated state
    console.log("No E2E_USER_EMAIL/E2E_USER_PASSWORD — writing empty auth state")
    await page.goto("/auth")
    await page.context().storageState({ path: authFile })
    return
  }

  try {
    await page.goto("/auth")
    await page.waitForLoadState("networkidle")

    // Clerk renders sign-in inside an iframe or shadow DOM
    // Try to find the email input in Clerk's form
    const clerkRoot = page.locator(".cl-rootBox, .cl-signIn-root, [data-clerk-component]").first()

    if (await clerkRoot.count() > 0) {
      // Clerk component detected — interact with it
      const emailInput = page.locator("input[name='identifier'], input[type='email'], input[name='emailAddress']").first()
      await emailInput.waitFor({ timeout: 10000 })
      await emailInput.fill(email)

      // Click continue/next button
      const continueBtn = page.locator("button:has-text('Continue'), button[type='submit']").first()
      await continueBtn.click()
      await page.waitForTimeout(1000)

      // Fill password
      const passwordInput = page.locator("input[type='password'], input[name='password']").first()
      if (await passwordInput.count() > 0) {
        await passwordInput.fill(password)
        const signInBtn = page.locator("button:has-text('Continue'), button:has-text('Sign in'), button[type='submit']").first()
        await signInBtn.click()
      }

      // Wait for redirect away from /auth
      await expect(page).not.toHaveURL(/\/auth/, { timeout: 15000 })
    } else {
      // Fallback: try standard form fields
      const emailField = page.getByLabel(/email/i)
      if (await emailField.count() > 0) {
        await emailField.fill(email)
        const passwordField = page.getByLabel(/password/i)
        if (await passwordField.count() > 0) await passwordField.fill(password)
        await page.getByRole("button", { name: /sign in|log in|continue/i }).click()
        await expect(page).not.toHaveURL(/\/auth/, { timeout: 15000 })
      }
    }
  } catch (err) {
    console.warn("Auth setup failed — writing current state as-is:", err)
  }

  // Persist whatever auth state we have
  await page.context().storageState({ path: authFile })
})
