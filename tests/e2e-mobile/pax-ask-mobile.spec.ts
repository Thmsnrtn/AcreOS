/**
 * A phone can answer an ask — "Waiting for your tap" on /ai at 390px
 * (docs/autonomous/AUTONOMY_SPEC.md §4.5, §7 "paxAsksAreReachable +
 * pax-ask-mobile"). Project: iphone-14 (playwright.mobile.config.ts).
 *
 * The desktop copilot rail returns null on a phone, so the pinned strip on
 * /ai is the ONLY way a mobile customer sees and answers an ask. This spec
 * seeds two pending `send_sms` rows straight into pending_actions (the
 * server's own content hash, so the approve path's integrity check holds),
 * opens /ai as the seeded customer, and answers both from the strip WITHOUT
 * leaving the page:
 *
 *   - Reject → the card says "Rejected — nothing was sent", the row is
 *     `rejected` in the database, the strip count drops by one.
 *   - Approve → the tap POSTs to /api/pax/pending-actions/:id/approve and the
 *     card shows the SERVER's outcome. In the throwaway E2E org there is no
 *     connected Twilio identity, so the honest outcome is either `executed`
 *     (simulation mode records a simulated send) or "Not completed" (the
 *     server refused and put the row back to pending). Both are asserted as
 *     what they are; nothing is claimed that the row does not show.
 *
 * Touch targets: the Approve button must be ≥ 44px tall at 390px.
 *
 * Env (see .github/workflows/e2e-mobile.yml): DATABASE_URL, E2E_TEST_AUTH=1.
 * Skips when DATABASE_URL is absent — it cannot seed without the database.
 */
import { test, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";
import pg from "pg";

const CUSTOMER_CLERK_ID = process.env.E2E_TEST_USER_ID || "e2e_test_user";

/** Mirrors server/services/approvalKernel.ts canonicalizeToolArgs (sorted keys, undefined dropped). */
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

/** sha256(toolName + "\n" + canonical args) — the server's actionContentHash. */
function actionContentHash(toolName: string, args: Record<string, unknown>): string {
  return crypto
    .createHash("sha256")
    .update(`${toolName}\n${JSON.stringify(sortValue(args))}`, "utf8")
    .digest("hex");
}

async function seedSessionCookie(page: Page, baseURL: string) {
  const { hostname } = new URL(baseURL);
  await page.context().addCookies([{ name: "__session", value: "e2e", domain: hostname, path: "/" }]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("acreos_cookie_consent", "declined");
    } catch {
      /* storage unavailable — banner shows, test degrades visibly */
    }
  });
}

async function seedAsk(
  db: pg.Client,
  orgId: number,
  userId: string,
  args: Record<string, unknown>,
): Promise<number> {
  const toolName = "send_sms";
  const { rows } = await db.query(
    `INSERT INTO pending_actions
       (organization_id, tool_name, args, content_hash, status, expires_at, created_by_user_id, origin, reason)
     VALUES ($1, $2, $3::jsonb, $4, 'pending', NOW() + INTERVAL '23 hours', $5, 'chat', $6)
     RETURNING id`,
    [orgId, toolName, JSON.stringify(args), actionContentHash(toolName, args), userId, "e2e: seeded ask"],
  );
  return rows[0].id as number;
}

test.describe("Waiting for your tap — answered from /ai on a phone", () => {
  test("seeded send_sms asks can be rejected and approved from the strip without leaving /ai", async ({
    page,
    baseURL,
  }, testInfo) => {
    test.skip(!process.env.DATABASE_URL, "requires DATABASE_URL (CI service / local PG)");
    test.skip(testInfo.project.name !== "iphone-14", "the phone contract runs on the iphone-14 project");
    test.setTimeout(120_000);

    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    let rejectId = 0;
    let approveId = 0;
    try {
      const {
        rows: [org],
      } = await db.query(`SELECT id FROM organizations WHERE slug = 'e2e-test-org'`);
      expect(org, "global-setup must have seeded e2e-test-org").toBeTruthy();
      const {
        rows: [user],
      } = await db.query(`SELECT id FROM users WHERE clerk_user_id = $1`, [CUSTOMER_CLERK_ID]);
      expect(user, "global-setup must have seeded the customer user").toBeTruthy();

      // Clean reruns: no stale seeded asks competing for the strip.
      await db.query(`DELETE FROM pending_actions WHERE organization_id = $1 AND reason = 'e2e: seeded ask'`, [
        org.id,
      ]);

      const stamp = Date.now();
      rejectId = await seedAsk(db, org.id, user.id, {
        to: "+15125550101",
        message: `E2E reject me ${stamp}`,
      });
      approveId = await seedAsk(db, org.id, user.id, {
        to: "+15125550102",
        message: `E2E approve me ${stamp}`,
      });

      await seedSessionCookie(page, baseURL!);
      await page.goto("/ai", { waitUntil: "domcontentloaded" });

      // The strip is pinned above the composer and carries the live count.
      const strip = page.locator('[data-testid="pax-needs-you-strip"]');
      await expect(strip).toBeVisible({ timeout: 60_000 });
      const countLabel = page.locator('[data-testid="pax-needs-you-count"]');
      await expect(countLabel).toContainText("Waiting for your tap (");
      const before = Number((await countLabel.innerText()).match(/\((\d+)\)/)?.[1] ?? "0");
      expect(before).toBeGreaterThanOrEqual(2);

      // Expand to the cards.
      await page.locator('[data-testid="pax-needs-you-toggle"]').click();
      const rejectCard = page.locator(`[data-testid="pax-ask-card-${rejectId}"]`);
      await expect(rejectCard).toBeVisible();
      // The wording is the server's: the verb line names the recipient.
      await expect(rejectCard.locator(`[data-testid="pax-ask-verb-${rejectId}"]`)).toContainText("+15125550101");
      await expect(rejectCard.locator(`[data-testid="pax-ask-text-${rejectId}"]`)).toContainText(
        `E2E reject me ${stamp}`,
      );

      // Touch target contract: the Approve tap is ≥ 44px tall on a phone.
      const approveCard = page.locator(`[data-testid="pax-ask-card-${approveId}"]`);
      const approveButton = approveCard.locator(`[data-testid="pax-ask-approve-${approveId}"]`);
      const box = await approveButton.boundingBox();
      expect(box, "Approve button must be laid out").toBeTruthy();
      expect(box!.height, "Approve must be a 44px touch target at 390px").toBeGreaterThanOrEqual(44);

      // ── Reject ────────────────────────────────────────────────────────
      const rejectResponse = page.waitForResponse(
        (r) => r.url().includes(`/api/pax/pending-actions/${rejectId}/reject`) && r.request().method() === "POST",
      );
      await rejectCard.locator(`[data-testid="pax-ask-reject-${rejectId}"]`).click();
      const rejectRes = await rejectResponse;
      expect(rejectRes.status(), await rejectRes.text()).toBe(200);
      await expect(rejectCard.locator(`[data-testid="pax-ask-status-${rejectId}"]`)).toContainText(
        "Rejected — nothing was sent",
      );
      const {
        rows: [rejectedRow],
      } = await db.query(`SELECT status FROM pending_actions WHERE id = $1`, [rejectId]);
      expect(rejectedRow.status).toBe("rejected");
      // Still on /ai — answered in place.
      expect(new URL(page.url()).pathname).toBe("/ai");

      // ── Approve ───────────────────────────────────────────────────────
      const approveResponse = page.waitForResponse(
        (r) => r.url().includes(`/api/pax/pending-actions/${approveId}/approve`) && r.request().method() === "POST",
      );
      await approveButton.click();
      const approveRes = await approveResponse;
      // 200 = executed (or already executed); 400 = the server refused the
      // send and put the row back to pending. Anything else is a bug.
      expect([200, 400], `approve answered ${approveRes.status()}: ${await approveRes.text()}`).toContain(
        approveRes.status(),
      );
      const {
        rows: [approvedRow],
      } = await db.query(`SELECT status FROM pending_actions WHERE id = $1`, [approveId]);
      const status = approveCard.locator(`[data-testid="pax-ask-status-${approveId}"]`);
      if (approveRes.status() === 200) {
        await expect(status).toContainText("Approved and sent");
        expect(approvedRow.status).toBe("executed");
      } else {
        await expect(status).toContainText("Not completed");
        expect(approvedRow.status).toBe("pending");
      }
      // Still on /ai — the phone answered without leaving the page.
      expect(new URL(page.url()).pathname).toBe("/ai");

      // The count drops by at least the rejected row (the approved row too
      // when it executed) — read back live, not computed here.
      await expect
        .poll(async () => Number((await countLabel.innerText().catch(() => "(0)")).match(/\((\d+)\)/)?.[1] ?? "0"), {
          timeout: 15_000,
        })
        .toBeLessThanOrEqual(before - 1);
    } finally {
      await db.query(`DELETE FROM pending_actions WHERE id = ANY($1::int[])`, [[rejectId, approveId].filter(Boolean)]).catch(
        () => {},
      );
      await db.end();
    }
  });
});
