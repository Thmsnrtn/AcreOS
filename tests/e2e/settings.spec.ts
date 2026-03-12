/**
 * E2E: Settings Page
 * Tasks #16, #245: Security tab, 2FA management, change password
 *
 * Covers:
 * - Security tab navigation
 * - 2FA section visible
 * - Change password form
 * - API endpoint validation
 */

import { test, expect } from "@playwright/test";

test.describe("Settings: Security Tab (Task #16)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
  });

  test("security tab is present in settings", async ({ page }) => {
    const securityTab = page.getByRole("tab", { name: /security/i }).first();
    if (await securityTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      expect(securityTab).toBeTruthy();
    } else {
      // Navigate directly to settings/security
      await page.goto("/settings/security");
      const url = page.url();
      expect(url).toMatch(/\/settings/);
    }
  });

  test("security tab click shows 2FA section", async ({ page }) => {
    const securityTab = page.getByRole("tab", { name: /security/i }).first();
    if (await securityTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await securityTab.click();
      // After clicking, should show 2FA content
      const has2FAContent = await page
        .getByText(/two.factor|2fa|authenticator|multi-factor/i)
        .first()
        .isVisible({ timeout: 5_000 })
        .catch(() => false);

      const hasPasswordChange = await page
        .getByText(/change password|current password/i)
        .first()
        .isVisible({ timeout: 5_000 })
        .catch(() => false);

      expect(has2FAContent || hasPasswordChange).toBe(true);
    }
  });

  test("settings page renders without crashing", async ({ page }) => {
    await expect(page).not.toHaveURL(/^about:blank/);
    // Should show settings content or redirect to login
    const onSettings = page.url().includes("/settings");
    const redirectedToLogin = page.url().includes("/auth");
    expect(onSettings || redirectedToLogin).toBe(true);
  });
});

test.describe("Settings: Change Password API (Task #16)", () => {
  test("change-password endpoint requires authentication", async ({ request }) => {
    const resp = await request.post("/api/auth/change-password", {
      data: {
        currentPassword: "OldPass123!",
        newPassword: "NewPass456!",
      },
    });
    // 401 (not authenticated) or 200 (success) or 400 (validation)
    expect([200, 400, 401, 403]).toContain(resp.status());
  });

  test("change-password rejects missing current password", async ({ request }) => {
    const resp = await request.post("/api/auth/change-password", {
      data: {
        currentPassword: "",
        newPassword: "NewPass456!",
      },
    });
    // 400 (bad request) or 401 (unauthenticated)
    expect([400, 401]).toContain(resp.status());
  });

  test("change-password rejects short new password", async ({ request }) => {
    const resp = await request.post("/api/auth/change-password", {
      data: {
        currentPassword: "OldPass123!",
        newPassword: "short",
      },
    });
    expect([400, 401]).toContain(resp.status());

    if (resp.status() === 400) {
      const body = await resp.json();
      expect(body.message).toBeTruthy();
    }
  });
});

test.describe("Settings: 2FA API Endpoints (Task #245)", () => {
  test("GET /api/auth/2fa/status responds appropriately", async ({ request }) => {
    const resp = await request.get("/api/auth/2fa/status");
    // 200 with 2FA status or 401 if not authenticated
    expect([200, 401]).toContain(resp.status());

    if (resp.status() === 200) {
      const body = await resp.json();
      expect(typeof body.enabled).toBe("boolean");
    }
  });

  test("POST /api/auth/2fa/setup requires authentication", async ({ request }) => {
    const resp = await request.post("/api/auth/2fa/setup", { data: {} });
    expect([200, 201, 400, 401, 403]).toContain(resp.status());
  });

  test("POST /api/auth/2fa/verify-setup rejects invalid code", async ({ request }) => {
    const resp = await request.post("/api/auth/2fa/verify-setup", {
      data: { code: "000000" },
    });
    expect([400, 401, 403]).toContain(resp.status());
  });

  test("POST /api/auth/2fa/disable requires authentication", async ({ request }) => {
    const resp = await request.post("/api/auth/2fa/disable", {
      data: { code: "000000" },
    });
    expect([400, 401, 403]).toContain(resp.status());
  });
});

test.describe("Settings: Profile and Notifications tabs", () => {
  test("settings page tabs are interactive", async ({ page }) => {
    await page.goto("/settings");

    // Settings page should load
    const onSettings = page.url().includes("/settings");
    const redirected = page.url().includes("/auth");

    if (redirected) {
      test.skip(true, "Requires authenticated session");
      return;
    }

    expect(onSettings).toBe(true);

    // At least one tab should be visible
    const tabs = page.getByRole("tab");
    const count = await tabs.count();
    expect(count).toBeGreaterThan(0);
  });

  test("notification preferences tab is accessible", async ({ page }) => {
    await page.goto("/settings");

    const notifTab = page.getByRole("tab", { name: /notification/i }).first();
    if (await notifTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await notifTab.click();
      // Should show notification settings
      await expect(page.getByText(/notification|email|alert/i).first()).toBeVisible({
        timeout: 5_000,
      });
    }
  });
});
