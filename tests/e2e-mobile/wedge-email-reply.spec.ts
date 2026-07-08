/**
 * WEDGE EMAIL-REPLY LEG — a seller's inbound EMAIL reply reaches the platform.
 *
 * Sibling of wedge-journey.spec.ts (the SMS leg). This spec proves the second
 * inbound channel end to end against the REAL production webhook:
 *
 *   1. A synthetic inbound email "from" the seeded lead's real email address
 *      (Emmy Replywell, seeded in global-setup) is POSTed to
 *      POST /api/webhooks/inbound-email.
 *   2. The request is authenticated by the webhook's HMAC fallback
 *      (server/middleware/inboundEmailSignature.ts): headers
 *      x-acreos-timestamp + x-acreos-signature =
 *      hex HMAC-SHA256(INBOUND_EMAIL_WEBHOOK_SECRET, `${ts}.${rawBody}`).
 *      No test bypass exists — by design. Unsigned and mis-signed requests
 *      are asserted to be REJECTED (fail-closed, F2) before the signed one
 *      is accepted.
 *   3. The handler (server/services/inboundEmailService.ts:
 *      processInboundEmail) routes on the reply-to address
 *      `inbox+{leadId}-{hash}@…`, verifies the per-lead hash, and writes:
 *        - a lead_emails row (direction='inbound'),
 *        - an inbox_messages row (the Inbox door's email tab reads these),
 *        - lead.status = 'responded',
 *        - a lead_activities row (type='email_received').
 *      The spec asserts exactly those writes — nothing wishful.
 *   4. The customer-visible surfaces confirm it: the authenticated email
 *      thread API (GET /api/leads/:id/emails — what the DealInbox component
 *      reads), the Inbox door's list API (GET /api/inbox) + its unread
 *      count, the per-lead unread-count API, and the /leads/:id page
 *      showing the "responded" status.
 *
 * WHICH AUTH PATH — and why HMAC, not SNS:
 *   Production receives mail via SES → SNS → HTTPS; that path verifies a
 *   SHA1withRSA signature against a real *.amazonaws.com certificate and
 *   cannot be synthesized from a test without private AWS keys (the only
 *   test hooks, _setCertFetcherForTests, are in-process unit-test seams —
 *   unreachable from an E2E HTTP client). The HMAC fallback is the
 *   documented path for non-SNS forwarders AND is verified by the very same
 *   middleware. Note: INBOUND_EMAIL_SNS_ONLY=1 (set in CI) only relaxes the
 *   production BOOT assertion; it does NOT disable the HMAC verify branch —
 *   that branch simply fail-closes (401) when INBOUND_EMAIL_WEBHOOK_SECRET
 *   is unset. The CI workflow therefore also sets a dummy
 *   INBOUND_EMAIL_WEBHOOK_SECRET (≥32 chars) so this spec can exercise the
 *   verification for real (see .github/workflows/e2e-mobile.yml).
 *
 * Determinism notes:
 *   - messageId is unique per run, so neither the envelope replay cache nor
 *     the Message-ID dedup ever swallows a rerun.
 *   - The spec resets the lead's status before starting, so it is
 *     rerunnable against a persistent local DB.
 *   - The reply-to hash is derived with the server's exact recipe
 *     (INBOUND_EMAIL_HMAC_SECRET || SESSION_SECRET); the Playwright process
 *     shares the webServer's environment, so the secrets always agree.
 *
 * Env (see .github/workflows/e2e-mobile.yml): DATABASE_URL, E2E_TEST_AUTH=1,
 * SESSION_SECRET, INBOUND_EMAIL_WEBHOOK_SECRET (dummy — the signature is
 * still computed and verified for real).
 */
import { test, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";
import pg from "pg";

const CSRF_TOKEN = "e2e-email-reply-csrf-double-submit";
const LEAD_EMAIL = "emmy.replywell@seller-e2e.test";

/** Same bypass helper as the other mobile specs (see nav-smoke.spec.ts). */
async function seedSessionCookies(page: Page, baseURL: string) {
  const { hostname } = new URL(baseURL);
  await page.context().addCookies([
    { name: "__session", value: "e2e", domain: hostname, path: "/" },
    { name: "csrf_token", value: CSRF_TOKEN, domain: hostname, path: "/" },
  ]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("acreos_cookie_consent", "declined");
    } catch {}
  });
}

/**
 * The server's per-lead reply-address recipe, mirrored from
 * server/services/inboundEmailService.ts: first 12 hex chars of
 * HMAC-SHA256(INBOUND_EMAIL_HMAC_SECRET || SESSION_SECRET, `${leadId}:${orgId}`),
 * addressed as inbox+{leadId}-{hash}@{INBOUND_EMAIL_DOMAIN || replies.acreos.io}.
 */
function replyToAddress(leadId: number, orgId: number): string {
  const secret =
    process.env.INBOUND_EMAIL_HMAC_SECRET ||
    process.env.SESSION_SECRET ||
    "dev-fallback-not-for-production";
  const hash = crypto
    .createHmac("sha256", secret)
    .update(`${leadId}:${orgId}`)
    .digest("hex")
    .slice(0, 12);
  const domain = process.env.INBOUND_EMAIL_DOMAIN || "replies.acreos.io";
  return `inbox+${leadId}-${hash}@${domain}`;
}

/**
 * The webhook's HMAC fallback signature, mirrored from
 * server/middleware/inboundEmailSignature.ts: hex
 * HMAC-SHA256(INBOUND_EMAIL_WEBHOOK_SECRET, `${timestamp}.${rawBody}`).
 * The raw body bytes matter, so callers pass the exact JSON string they POST.
 */
function signInboundEmail(rawBody: string, timestampSec: number, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestampSec}.`)
    .update(Buffer.from(rawBody, "utf-8"))
    .digest("hex");
}

test.describe("wedge email-reply leg (inbound email → lead responded)", () => {
  test("signed inbound email reply reaches the platform", async ({ page, baseURL }) => {
    test.skip(!process.env.DATABASE_URL, "requires DATABASE_URL (CI service / local PG)");
    test.skip(
      !process.env.INBOUND_EMAIL_WEBHOOK_SECRET,
      "requires INBOUND_EMAIL_WEBHOOK_SECRET so the HMAC-signed webhook can be exercised (SNS-only mode has no synthesizable path)",
    );
    test.setTimeout(120_000);

    const webhookSecret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET!;
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      // ── Fixtures: seeded org + the email lead ─────────────────────────
      const {
        rows: [org],
      } = await db.query(`SELECT id FROM organizations WHERE slug = 'e2e-test-org'`);
      expect(org, "global-setup must have seeded e2e-test-org").toBeTruthy();

      const {
        rows: [lead],
      } = await db.query(
        `SELECT id, email FROM leads
         WHERE organization_id = $1 AND first_name = 'Emmy' AND last_name = 'Replywell'`,
        [org.id],
      );
      expect(lead, "global-setup must have seeded the Emmy Replywell lead").toBeTruthy();
      expect(lead.email).toBe(LEAD_EMAIL);

      // Rerunnable: reset the status so the 'responded' flip below is
      // genuinely caused by THIS run's webhook.
      await db.query(`UPDATE leads SET status = 'contacted' WHERE id = $1`, [lead.id]);

      await seedSessionCookies(page, baseURL!);

      const webhookUrl = `${baseURL}/api/webhooks/inbound-email`;
      // Unique per run so the envelope replay cache + Message-ID dedup can
      // never swallow a rerun (mirrors the wedge SMS spec's MessageSid).
      const messageId = `<e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@seller-e2e.test>`;
      const payload = {
        from: LEAD_EMAIL,
        to: replyToAddress(lead.id, org.id),
        subject: "Re: Your offer on my Taos parcel",
        textBody: "Yes — I got your letter and I'd like to hear the offer. Call me.",
        messageId,
      };
      // Sign the EXACT bytes we send: serialize once, sign that string, and
      // POST the same string (Playwright sends string data verbatim).
      const rawBody = JSON.stringify(payload);

      // ── 1. Fail-closed proof: unsigned + mis-signed requests bounce ────
      await test.step("unsigned request is rejected (fail-closed)", async () => {
        const res = await page.request.post(webhookUrl, {
          headers: { "content-type": "application/json" },
          data: rawBody,
        });
        expect(res.status(), await res.text()).toBe(401);
      });

      await test.step("mis-signed request is rejected", async () => {
        const ts = Math.floor(Date.now() / 1000);
        const badSignature = signInboundEmail(rawBody, ts, "the-wrong-secret-entirely-0000000000");
        const res = await page.request.post(webhookUrl, {
          headers: {
            "content-type": "application/json",
            "x-acreos-timestamp": String(ts),
            "x-acreos-signature": badSignature,
          },
          data: rawBody,
        });
        expect(res.status(), await res.text()).toBe(401);
      });

      // ── 2. The correctly signed reply is accepted and routed ───────────
      await test.step("signed inbound email passes HMAC verification", async () => {
        const ts = Math.floor(Date.now() / 1000);
        const signature = signInboundEmail(rawBody, ts, webhookSecret);
        const res = await page.request.post(webhookUrl, {
          headers: {
            "content-type": "application/json",
            "x-acreos-timestamp": String(ts),
            "x-acreos-signature": signature,
          },
          data: rawBody,
        });
        expect(res.status(), await res.text()).toBe(200);
        const body = await res.json();
        // The handler's real success contract (routes-inbound-email.ts).
        expect(body.success, JSON.stringify(body)).toBe(true);
        expect(body.leadId).toBe(lead.id);
      });

      // ── 3. Assert exactly what processInboundEmail writes ──────────────
      await test.step("lead_emails row stored (direction=inbound)", async () => {
        const {
          rows: [email],
        } = await db.query(
          `SELECT direction, from_email, subject, organization_id, lead_id
           FROM lead_emails WHERE message_id = $1`,
          [messageId],
        );
        expect(email, "handler must insert a lead_emails row").toBeTruthy();
        expect(email.direction).toBe("inbound");
        expect(email.from_email).toBe(LEAD_EMAIL);
        expect(email.subject).toBe(payload.subject);
        expect(email.organization_id).toBe(org.id);
        expect(email.lead_id).toBe(lead.id);
      });

      await test.step("inbox_messages row stored (Inbox door surface)", async () => {
        const {
          rows: [msg],
        } = await db.query(
          `SELECT sender_email, sender_name, subject, organization_id, lead_id, is_read
           FROM inbox_messages WHERE message_id = $1`,
          [messageId],
        );
        expect(msg, "handler must insert an inbox_messages row — without it the reply is invisible in the Inbox door").toBeTruthy();
        expect(msg.sender_email).toBe(LEAD_EMAIL);
        expect(msg.sender_name).toBe("Emmy Replywell");
        expect(msg.subject).toBe(payload.subject);
        expect(msg.organization_id).toBe(org.id);
        expect(msg.lead_id).toBe(lead.id);
        expect(msg.is_read).toBe(false);
      });

      await test.step("lead flips to responded", async () => {
        await expect
          .poll(
            async () =>
              (await db.query(`SELECT status FROM leads WHERE id = $1`, [lead.id])).rows[0]
                ?.status,
            { timeout: 20_000 },
          )
          .toBe("responded");
      });

      await test.step("lead activity 'email_received' logged", async () => {
        const {
          rows: [activity],
        } = await db.query(
          `SELECT count(*)::int AS n FROM lead_activities
           WHERE lead_id = $1 AND organization_id = $2 AND type = 'email_received'`,
          [lead.id, org.id],
        );
        expect(activity.n).toBeGreaterThan(0);
      });

      // ── 4. Customer-visible surfaces ────────────────────────────────────
      await test.step("email thread API returns the reply (DealInbox surface)", async () => {
        // First-party auth: the seeded __session cookie rides along on
        // page.request. This is the endpoint the DealInbox email-thread
        // component reads (client/src/components/deal-inbox.tsx).
        const res = await page.request.get(`/api/leads/${lead.id}/emails`);
        expect(res.status(), await res.text()).toBe(200);
        const thread = await res.json();
        const mine = (thread as Array<{ messageId?: string; direction?: string; fromEmail?: string }>).find(
          (e) => e.messageId === messageId,
        );
        expect(mine, "thread must contain this run's inbound email").toBeTruthy();
        expect(mine!.direction).toBe("inbound");
        expect(mine!.fromEmail).toBe(LEAD_EMAIL);
      });

      await test.step("Inbox door API lists the reply with a live unread count", async () => {
        // The Inbox page's email tab (client/src/pages/inbox.tsx) reads
        // GET /api/inbox and its unread badge reads /api/inbox/unread-count.
        const listRes = await page.request.get(`/api/inbox`);
        expect(listRes.status(), await listRes.text()).toBe(200);
        const inbox = await listRes.json();
        const mine = (inbox as Array<{ messageId?: string; senderEmail?: string }>).find(
          (m) => m.messageId === messageId,
        );
        expect(mine, "GET /api/inbox must list this run's reply").toBeTruthy();
        expect(mine!.senderEmail).toBe(LEAD_EMAIL);

        const countRes = await page.request.get(`/api/inbox/unread-count`);
        expect(countRes.status(), await countRes.text()).toBe(200);
        const { count } = await countRes.json();
        expect(count).toBeGreaterThan(0);
      });

      await test.step("unread email count reflects the reply", async () => {
        const res = await page.request.get(`/api/emails/unread-count`);
        expect(res.status(), await res.text()).toBe(200);
        const { count } = await res.json();
        expect(count).toBeGreaterThan(0);
      });

      await test.step("/leads/:id shows the responded status", async () => {
        await page.goto(`/leads/${lead.id}`, { waitUntil: "domcontentloaded" });
        // Lead name proves the detail surface (mobile or desktop variant)
        // actually loaded this lead; the status text proves the flip is
        // visible to the customer, not just in the DB.
        await expect(page.getByText("Emmy Replywell").first()).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText(/responded/i).first()).toBeVisible({ timeout: 20_000 });
      });
    } finally {
      await db.end();
    }
  });
});
