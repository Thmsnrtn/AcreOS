/**
 * Jobs-To-Be-Done outcome suite (red-team blueprint #2).
 *
 * The persona "shell smoke" only navigated doors and checked for console
 * errors — it never operated the product, so it proved "doors load," not "a
 * user can do their job." This suite OPERATES the real UI and grades on the
 * OUTCOME (did the thing get created, persist, reject bad input, and stay safe
 * against hostile input), not on crash-absence.
 *
 * Auth: a seeded persona's e2e-persona cookie (its org already exists with
 * leads). Run against a running app (E2E_TEST_AUTH=1). Selectors were verified
 * live against the real Quick-add-lead dialog.
 *
 *   npx playwright test --project=jtbd
 */

import { test, expect, devices, type BrowserContext } from "@playwright/test";
import { personaCookieValue } from "../../server/auth/testAuth";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5050";
const PERSONA = "land-operator-desktop";

async function authedContext(browser: import("@playwright/test").Browser): Promise<BrowserContext> {
  // The Quick-add-lead FAB is a mobile affordance, and mobile is the more
  // representative first-user surface anyway.
  const ctx = await browser.newContext({ baseURL: BASE_URL, ...devices["iPhone 14"] } as never);
  await ctx.addCookies([
    { name: "__session", value: personaCookieValue(PERSONA), url: BASE_URL },
    // Pre-seed the CSRF double-submit cookie so the app's own mutations work
    // even on WebKit over plain HTTP (where the server's secure-flagged
    // csrf_token cookie would be dropped). The client mirrors this into the
    // x-csrf-token header; the server only matches cookie===header. Prod is
    // HTTPS so this is a local-WebKit-over-HTTP accommodation only.
    { name: "csrf_token", value: "e2e-jtbd-csrf-token", url: BASE_URL },
  ]);
  return ctx;
}

async function openQuickAdd(page: import("@playwright/test").Page) {
  await page.goto("/leads", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  // Dismiss the cookie-consent dialog if it's covering the FAB.
  await page.getByRole("button", { name: /decline optional|dismiss for now/i }).first().click({ timeout: 2500 }).catch(() => undefined);
  const fab = page.getByRole("button", { name: /quick add/i }).first();
  await fab.waitFor({ state: "visible", timeout: 15_000 });
  await fab.click();
  await expect(page.getByRole("dialog", { name: /quick add lead/i })).toBeVisible();
}

test.describe("JTBD · the user can actually do the job", () => {
  test("create a lead through the UI → it appears AND persists across reload", async ({ browser }) => {
    const ctx = await authedContext(browser);
    const page = await ctx.newPage();
    const first = "Jtbd";
    const last = `Persist-${Date.now()}`; // unique so we can find exactly this row

    await openQuickAdd(page);
    await page.getByRole("textbox", { name: "First name" }).fill(first);
    await page.getByRole("textbox", { name: "Last name" }).fill(last);
    await page.getByRole("textbox", { name: "Phone" }).fill("555-7777");
    await page.getByRole("button", { name: /save lead/i }).click();

    // OUTCOME 1: the new lead shows up in the list (mutation reflected in UI).
    await expect(page.getByText(`${first} ${last}`)).toBeVisible({ timeout: 10_000 });

    // OUTCOME 2: it survives a full reload (it actually persisted — the
    // use-mutation-must-invalidate / optimistic-rollback bug class).
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await expect(page.getByText(`${first} ${last}`)).toBeVisible({ timeout: 10_000 });

    await ctx.close();
  });

  test("empty required fields are rejected — no junk lead is created", async ({ browser }) => {
    const ctx = await authedContext(browser);
    const page = await ctx.newPage();

    await openQuickAdd(page);
    const before = await page.getByRole("listitem").count();
    // Submit with nothing filled.
    await page.getByRole("button", { name: /save lead/i }).click();
    await page.waitForTimeout(1500);

    // OUTCOME: either the dialog stayed open (validation blocked) OR no new row
    // was added — what must NOT happen is a blank lead silently created.
    const dialogStillOpen = await page.getByRole("dialog", { name: /quick add lead/i }).isVisible().catch(() => false);
    const after = await page.getByRole("listitem").count();
    expect(dialogStillOpen || after <= before, "empty submit must not create a junk lead").toBeTruthy();

    await ctx.close();
  });

  test("hostile input is escaped on render (stored-XSS safe)", async ({ browser }) => {
    const ctx = await authedContext(browser);
    const page = await ctx.newPage();
    // If this string is ever rendered as HTML, the <img onerror> fires and sets
    // the flag / a dialog. React should escape it to literal text.
    let dialogFired = false;
    page.on("dialog", (d) => { dialogFired = true; d.dismiss().catch(() => undefined); });
    const xss = `<img src=x onerror="window.__xss=1">Zed`;

    await openQuickAdd(page);
    // Payload in name AND notes (free-text, most likely to be stored).
    await page.getByRole("textbox", { name: "First name" }).fill(xss);
    await page.getByRole("textbox", { name: "Last name" }).fill("XSSProbe");
    await page.getByRole("textbox", { name: "Notes" }).fill(xss).catch(() => undefined);
    await page.getByRole("button", { name: /save lead/i }).click();
    await page.waitForTimeout(1500);
    // Navigate the list so any stored payload would get rendered.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // OUTCOME (the real security property): the payload NEVER executes — whether
    // the input was rejected on save OR stored-and-escaped on render. Either is a
    // pass; only execution is a fail.
    const executed = await page.evaluate(() => (window as unknown as { __xss?: number }).__xss === 1);
    expect(executed, "stored XSS executed — payload ran as HTML").toBe(false);
    expect(dialogFired, "stored XSS triggered a dialog").toBe(false);

    await ctx.close();
  });
});
