/**
 * THE WEDGE JOURNEY — lead in → mail out → seller responds → offer.
 *
 * This is the one flow every ad dollar buys (roadmap-2026-07 "The
 * through-line"; mature-machine H0 §6.4 requires it green in CI before the
 * first campaign). It runs on the unattended test-auth path
 * (server/auth/testAuth.ts, E2E_TEST_AUTH=1) — no Clerk credentials — and
 * exercises the REAL production surfaces end to end:
 *
 *   1. The Today door renders for the seeded customer.
 *   1b. LIST (W10.3): from the Map door, the county list builder counts a
 *      county's matching parcels and saves them as a list. The browser path
 *      is real; the /api/list-builder/* answers are contract fixtures —
 *      the server reads county GIS over https only and refuses loopback at
 *      fetch time (server/services/providers/fetchGeo.ts), so CI cannot
 *      stand up a fake county. The server path is proven by its HTTP tests.
 *   2. An SMS campaign is created via the real API (CSRF double-submit).
 *   3. The campaign is SENT through /api/campaigns/:id/send-sms — the full
 *      TCPA consent + quiet-hours pre-filter and upfront credit debit run
 *      for real; only the Twilio call is simulated (org simulationMode,
 *      seeded in global-setup), recorded to simulated_actions.
 *   4. The seller replies: a correctly HMAC-SHA1-SIGNED Twilio webhook hits
 *      /api/webhooks/twilio/sms (verifyTwilioSignature runs for real with
 *      the dummy TWILIO_AUTH_TOKEN; no test bypass exists — by design).
 *   5. Roadmap W1.4 regression: the matched inbound SMS flips the lead to
 *      "responded".
 *   6. An offer is recorded (deal via the real API) and the Deals door
 *      renders.
 *
 * Determinism notes:
 *   - Quiet hours can never flake: the spec stamps the lead's timezone with
 *     a zone where it is currently mid-day (there is always one).
 *   - MessageSid is unique per run, so the webhook's MessageSid dedup
 *     (Pillar 9.5) never swallows a rerun.
 *   - The spec resets the wedge lead's status before starting, so it is
 *     rerunnable against a persistent local DB.
 *
 * Env (see .github/workflows/e2e-mobile.yml): DATABASE_URL, E2E_TEST_AUTH=1,
 * TWILIO_AUTH_TOKEN + TWILIO_ACCOUNT_SID + TWILIO_PHONE_NUMBER (dummies —
 * simulation mode means Twilio is never actually called).
 */
import { test, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";
import pg from "pg";

const CSRF_TOKEN = "e2e-wedge-csrf-double-submit";
const WEDGE_LEAD_PHONE = "+14805550142";
const ORG_TWILIO_NUMBER = "+15005550006";

/** Same bypass helper as the other mobile specs (see nav-smoke.spec.ts). */
async function seedSessionCookies(page: Page, baseURL: string) {
  const { hostname } = new URL(baseURL);
  await page.context().addCookies([
    { name: "__session", value: "e2e", domain: hostname, path: "/" },
    // Double-submit CSRF: the server compares cookie to header verbatim,
    // so the spec supplies both (matching what the SPA does after its
    // first GET issues the cookie).
    { name: "csrf_token", value: CSRF_TOKEN, domain: hostname, path: "/" },
  ]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("acreos_cookie_consent", "declined");
    } catch {}
  });
}

/**
 * Pick an IANA zone where it is currently mid-day (10:00–18:59 local), so
 * the TCPA quiet-hours gate (8 AM–9 PM recipient-local) can never block the
 * send regardless of when CI runs. The candidates span the globe, so one
 * always qualifies.
 */
function currentlyDaytimeZone(): string {
  const candidates = [
    "Pacific/Honolulu",
    "America/Anchorage",
    "America/Los_Angeles",
    "America/Denver",
    "America/Chicago",
    "America/New_York",
    "America/Sao_Paulo",
    "Atlantic/Azores",
    "Europe/London",
    "Europe/Berlin",
    "Europe/Moscow",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Asia/Bangkok",
    "Asia/Tokyo",
    "Australia/Sydney",
    "Pacific/Auckland",
  ];
  for (const zone of candidates) {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour: "numeric",
        hour12: false,
      }).format(new Date()),
    );
    if (hour >= 10 && hour < 19) return zone;
  }
  return "America/Chicago"; // unreachable — the list spans all offsets
}

/**
 * Twilio's request-signing algorithm, mirrored from
 * server/middleware/twilioSignature.ts: HMAC-SHA1 over
 * `url + <POST params concatenated as key+value, keys sorted>`, base64.
 */
function signTwilioRequest(
  url: string,
  params: Record<string, string>,
  authToken: string,
): string {
  const paramString = Object.keys(params)
    .sort()
    .reduce((s, key) => s + key + params[key], "");
  return crypto
    .createHmac("sha1", authToken)
    .update(Buffer.from(url + paramString, "utf-8"))
    .digest("base64");
}

async function expectRouteRenders(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  const root = page.locator("#root");
  await expect(root).toBeVisible();
  await expect
    .poll(async () => ((await root.textContent()) ?? "").trim().length, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
}

test.describe("wedge journey (lead → mail → reply → offer)", () => {
  test("runs end to end on the test-auth path", async ({ page, baseURL }) => {
    test.skip(!process.env.DATABASE_URL, "requires DATABASE_URL (CI service / local PG)");
    test.skip(
      !process.env.TWILIO_AUTH_TOKEN,
      "requires a (dummy) TWILIO_AUTH_TOKEN so the signed inbound webhook can be exercised",
    );
    test.setTimeout(120_000);

    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      // ── Fixtures: seeded org, wedge lead, a property to hang the offer on ──
      const {
        rows: [org],
      } = await db.query(`SELECT id FROM organizations WHERE slug = 'e2e-test-org'`);
      expect(org, "global-setup must have seeded e2e-test-org").toBeTruthy();

      const {
        rows: [lead],
      } = await db.query(
        `SELECT id, phone FROM leads
         WHERE organization_id = $1 AND first_name = 'Wedge' AND last_name = 'Seller'`,
        [org.id],
      );
      expect(lead, "global-setup must have seeded the Wedge Seller lead").toBeTruthy();
      expect(lead.phone).toBe(WEDGE_LEAD_PHONE);

      // Rerunnable + quiet-hours-proof: reset status, stamp a daytime zone.
      const zone = currentlyDaytimeZone();
      await db.query(`UPDATE leads SET status = 'new', timezone = $2 WHERE id = $1`, [
        lead.id,
        zone,
      ]);

      const {
        rows: [property],
      } = await db.query(
        `SELECT id FROM properties WHERE organization_id = $1 ORDER BY id LIMIT 1`,
        [org.id],
      );
      expect(property, "global-setup must have seeded a property").toBeTruthy();

      await seedSessionCookies(page, baseURL!);
      const apiHeaders = { "x-csrf-token": CSRF_TOKEN };

      // ── 1. Lead in: the Today door renders for the authed customer ──────
      await test.step("Today door renders", async () => {
        await expectRouteRenders(page, "/today");
      });

      // ── 1b. List: build a county list from the Map door (W10.3) ─────────
      await test.step("list builder counts, then saves, from the Map door", async () => {
        // Distinctive figures: the UI must render the server's numbers, never
        // compute its own.
        const PREVIEW = {
          count: 1387,
          sample: [{ apn: "202-15-007", owner: "MESA HOLDINGS LLC", acres: 4.75, address: "1 Vulture Mine Rd" }],
          // The five parts sum to the count (212 + 1175 + 0 + 0 + 0 = 1387).
          alreadyLeads: 212,
          newLeads: 1175,
          suppressedDeleted: 0,
          skippedNoApn: 0,
          skippedDuplicateApn: 0,
          attribution: null,
          cost: { pullCredits: 0, source: "Maricopa County Assessor (public GIS)", mailEstimate: null },
          saveable: true,
          saveRefusal: null,
          maxPerList: 2500,
          tooLarge: false,
          status: "covered",
        };
        let committed: Record<string, unknown> | undefined;
        await page.route("**/api/list-builder/counties**", (route) =>
          route.fulfill({
            json: {
              counties: [
                {
                  state: "AZ",
                  county: "Maricopa",
                  status: "covered",
                  label: "Covered",
                  message: "Public parcel records are live for this county.",
                  filters: { acreage: true, ownerType: true, yearsOwned: true },
                },
              ],
            },
          }),
        );
        await page.route("**/api/list-builder/lists**", (route) => route.fulfill({ json: { lists: [] } }));
        await page.route("**/api/list-builder/preview", (route) => route.fulfill({ json: PREVIEW }));
        await page.route("**/api/list-builder/commit", async (route) => {
          committed = route.request().postDataJSON();
          await route.fulfill({
            status: 200,
            json: { listId: 41, created: 1175, linkedExisting: 212, total: 1387, suppressedDeleted: 0, skippedNoApn: 0, skippedDuplicateApn: 0 },
          });
        });

        // The Today step's client-side redirect can land after this goto and
        // interrupt it ("navigation … interrupted by another navigation to
        // /today", seen in CI): navigate until the Map door is what rendered.
        await expect(async () => {
          await page.goto("/maps", { waitUntil: "domcontentloaded" });
          await expect(page).toHaveURL(/\/maps(?:$|[?#])/);
          await expect(page.getByTestId("button-open-list-builder").first()).toBeVisible();
        }).toPass({ timeout: 45_000 });
        await page.getByTestId("button-open-list-builder").first().click();
        await expect(page.getByTestId("list-builder-sheet")).toBeVisible();
        await page.getByTestId("select-list-state").click();
        await page.getByRole("option", { name: "Arizona" }).click();
        await page.getByTestId("county-option-Maricopa").click();
        await page.getByTestId("input-acreage-min").fill("2");
        await page.getByTestId("button-list-count").click();

        await expect(page.getByTestId("preview-count")).toContainText("1,387");
        await expect(page.getByTestId("preview-already-leads")).toContainText("212");
        await expect(page.getByTestId("preview-new-leads")).toContainText("1,175");
        await expect(page.getByTestId("preview-sample-row")).toHaveCount(1);

        await page.getByTestId("input-list-name").fill("Maricopa 2+ acres (e2e)");
        await page.getByTestId("button-list-save").click();
        await expect(page.getByTestId("commit-success")).toBeVisible();
        await expect(page.getByTestId("link-saved-list-leads")).toHaveAttribute("href", /listId=41\b/);
        // The save re-runs the count server-side against what was shown.
        expect(committed).toMatchObject({ state: "AZ", county: "Maricopa", acreageMin: 2, expectedCount: 1387 });

        await page.unrouteAll({ behavior: "ignoreErrors" });
      });

      // ── 2. Mail out: create + send the SMS campaign (simulated Twilio) ──
      let campaignId: number;
      await test.step("create SMS campaign", async () => {
        const res = await page.request.post("/api/campaigns", {
          headers: apiHeaders,
          data: {
            // The send route reads campaign.content as the message body and
            // REFUSES a contentless campaign (2026-08-21, ledger 64: the old
            // fallback texted recipients the campaign's INTERNAL NAME). This
            // journey exercises the honest contract: message in content,
            // internal label in name.
            name: "Wickenburg acreage outreach (e2e)",
            type: "sms",
            content: "Would you consider an offer on your Wickenburg acreage? Reply YES/STOP.",
          },
        });
        expect(res.status(), await res.text()).toBe(201);
        campaignId = (await res.json()).id;
        expect(campaignId).toBeGreaterThan(0);
      });

      await test.step("send campaign through the real TCPA + credit gates", async () => {
        const res = await page.request.post(`/api/campaigns/${campaignId}/send-sms`, {
          headers: apiHeaders,
          data: { leadIds: [lead.id] },
        });
        expect(res.ok(), await res.text()).toBeTruthy();
        const body = await res.json();
        expect(body.sent, JSON.stringify(body)).toBe(1);
        expect(body.tcpaBlocked).toBe(0);
        expect(body.quietHoursBlocked).toBe(0);

        // The "send" must be a recorded simulation, not a real Twilio call.
        const {
          rows: [sim],
        } = await db.query(
          `SELECT count(*)::int AS n FROM simulated_actions
           WHERE organization_id = $1 AND category = 'sms' AND action = 'campaign_batch_send'`,
          [org.id],
        );
        expect(sim.n).toBeGreaterThan(0);
      });

      // ── 3. Seller responds: signed inbound Twilio webhook ───────────────
      const messageSid = `SMe2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      await test.step("inbound SMS reply passes signature verification", async () => {
        const url = `${baseURL}/api/webhooks/twilio/sms`;
        const params: Record<string, string> = {
          From: WEDGE_LEAD_PHONE,
          To: ORG_TWILIO_NUMBER,
          Body: "Yes, I would consider an offer on my land. What did you have in mind?",
          MessageSid: messageSid,
          AccountSid: "ACe2e00000000000000000000000000000",
        };
        const signature = signTwilioRequest(url, params, process.env.TWILIO_AUTH_TOKEN!);
        const res = await page.request.post(url, {
          form: params,
          headers: { "x-twilio-signature": signature },
        });
        expect(res.status(), await res.text()).toBe(200);
      });

      await test.step("lead flips to responded (roadmap W1.4)", async () => {
        await expect
          .poll(
            async () =>
              (await db.query(`SELECT status FROM leads WHERE id = $1`, [lead.id])).rows[0]
                ?.status,
            { timeout: 20_000 },
          )
          .toBe("responded");
      });

      // ── 4. Offer: record the deal and see it on the Deals door ──────────
      await test.step("offer recorded as a deal", async () => {
        const res = await page.request.post("/api/deals", {
          headers: apiHeaders,
          data: {
            type: "acquisition",
            status: "negotiating",
            offerAmount: "45000",
            propertyId: property.id,
          },
        });
        expect([200, 201], await res.text()).toContain(res.status());
      });

      await test.step("Deals door renders", async () => {
        await expectRouteRenders(page, "/deals");
      });
    } finally {
      await db.end();
    }
  });
});
