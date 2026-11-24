/**
 * Tax journey walk — the declarative spec (journey-proof harness), T1.
 *
 * The tax lien / tax deed investor's loop, re-walked on a fresh dedicated
 * persona org (the 2026-11-18/19 walk of org 107 was run with in-machine
 * scripts, not a harness spec — this spec is that walk, made declarative):
 * activate → county CSV import → triage → max bid → the two bid gates
 * (county procedure standing, then auction registration) → certificate →
 * redemption clock; then the two honesty cases — (b) a state with NO
 * encoded redemption rule (WY), where the product must refuse rather than
 * invent a deadline, and (c) a recorded county procedure that contradicts
 * the encoded rule (GA Fulton, 24 months stated vs 12 encoded), where the
 * clock's mismatch flag must fire and the deadline must not move; then
 * the statutory-notice leg (draft + both fail-closed refusals + the send);
 * then Pax reading the walked certificates through the T7 tools.
 *
 * FENCES CARRIED INTO THE SPEC
 * - ZERO REAL MAIL (founder constraint, 2026-11-18, binding): the notice
 *   send runs ONLY under the walk org's per-org `simulationMode`. The
 *   send step re-reads the org's settings through the API and FAILS
 *   before any send attempt if `simulationMode` is not true — the
 *   simulation interception in the mail service runs before lane
 *   resolution and before any provider call, so no letter can reach a
 *   provider, let alone USPS. The provider id the send returns must be a
 *   `sim_…` simulated-action id, never an `ltr_…` Lob id.
 * - No real money moves. A max bid and a redemption amount are records
 *   of figures; no payment path is touched.
 * - Every fixture is synthetic (tag-prefixed APNs, "T1 Owner …" names).
 *
 * SIMULATION FOOTNOTE (verbatim, carried from the gap sheet — it belongs
 * to this walk's notice claim):
 * "Simulation mode does not prove Lob accepting a real `letters.create`".
 * The provider id is a `sim_…` record id, not an `ltr_…`. Identity
 * verification was real, against Lob's live API (the 2026-11-19 N3
 * re-walk of org 107, under that org's own live Lob key); this walk's
 * fresh org performs no identity verification, because simulation
 * intercepts before the lane that would need one. The green call was
 * the founder's (2026-11-19); the walker does not make it.
 */
import { defineWalkSpec } from "../walk-spec";
import type { WalkContext, WalkSpec } from "../walk-spec";

function body(res: { body: any }): any {
  return res.body ?? {};
}

function fail(res: { status: number; body: any }): string {
  return `${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`;
}

const SIMULATION_NOTE =
  "Simulation mode does not prove Lob accepting a real `letters.create`. The provider id is a sim_… record id, not an ltr_…. The send ran under the walk org's per-org simulationMode: the mail service intercepted the would-be letters.create and recorded a simulated action; no provider was contacted and no mail exists.";

async function ledgerNotices(ctx: WalkContext, certId: string): Promise<any[]> {
  const res = await ctx.api("GET", `/api/tax-certificates/${certId}/ledger`);
  ctx.check(res.status === 200, `GET /api/tax-certificates/${certId}/ledger must return 200, got ${fail(res)}`);
  const ledger = body(res).ledger ?? body(res);
  return ledger.notices ?? [];
}

export const taxWalk: WalkSpec = defineWalkSpec({
  id: "tax",
  vertical: "tax_lien_deed",
  title: "Tax journey — county CSV to certificate and clock, the two honesty cases, the simulated notice, and Pax",
  version: 1,
  fences: { noSend: true, noRealMoney: true, stagingOnly: true },
  org: { businessType: "tax_lien_deed", nameSuffix: "Tax LLC", skipSampleData: true },
  realdbRoutes: [],
  cleanupTables: [
    "tax_events",
    "tax_certificates",
    "tax_sale_listings",
    "tax_sale_auctions",
    "mail_sender_identities",
    "simulated_actions",
  ],
  steps: [
    {
      id: "activate",
      title: "Activate — a fresh tax_lien_deed persona org, no sample data",
      kind: "api",
      how: "The driver provisions the persona's own org. The step then does what the 2026-11-18 walk did: PATCH the org name, PUT /api/me/persona (tax_delinquent / tax_lien_deed), POST /api/onboarding/complete (seedSampleData:false), then re-reads needs-onboarding and the organization.",
      mustObserve:
        "needs-onboarding is true before and false after; the org re-reads with onboardingData.businessType tax_lien_deed and onboardingCompleted true.",
      async run(ctx) {
        const before = await ctx.api("GET", "/api/me/needs-onboarding");
        ctx.check(before.status === 200, `GET needs-onboarding must return 200, got ${fail(before)}`);
        ctx.check(body(before).needsOnboarding === true, `a fresh persona must need onboarding, got ${JSON.stringify(body(before))}`);
        const named = await ctx.api("PATCH", "/api/organization", { name: `${ctx.tag} Tax LLC` });
        ctx.check(named.status === 200, `PATCH /api/organization must return 200, got ${fail(named)}`);
        const persona = await ctx.api("PUT", "/api/me/persona", { persona: "tax_delinquent", businessType: "tax_lien_deed" });
        ctx.check(persona.status === 200, `PUT /api/me/persona must return 200, got ${fail(persona)}`);
        const complete = await ctx.api("POST", "/api/onboarding/complete", {
          formData: { businessType: "tax_lien_deed", orgName: `${ctx.tag} Tax LLC` },
          seedSampleData: false,
          path: "fast",
        });
        ctx.check(complete.status === 200, `POST /api/onboarding/complete must return 200, got ${fail(complete)}`);
        const after = await ctx.api("GET", "/api/me/needs-onboarding");
        ctx.check(body(after).needsOnboarding === false, `after completing, needsOnboarding must be false, got ${JSON.stringify(body(after))}`);
        const org = await ctx.api("GET", "/api/organization");
        ctx.check(org.status === 200, `GET /api/organization must return 200, got ${org.status}`);
        ctx.check(body(org).onboardingData?.businessType === "tax_lien_deed", `org businessType must be tax_lien_deed, got ${JSON.stringify(body(org).onboardingData?.businessType)}`);
        ctx.check(body(org).onboardingCompleted === true, `org onboardingCompleted must be true, got ${JSON.stringify(body(org).onboardingCompleted)}`);
        return {
          observed: {
            orgId: ctx.orgId,
            needsOnboardingBefore: true,
            needsOnboardingAfter: false,
            businessType: body(org).onboardingData?.businessType,
            onboardingCompleted: body(org).onboardingCompleted,
          },
        };
      },
    },
    {
      id: "case-a-import",
      title: "Case (a) — county CSV import: preview writes nothing, commit lands two lots and a county watch",
      kind: "api",
      how: "POST /api/tax-researcher/auctions (Harris County TX, lien, 2026-11-10), then the tax lot-list importer: POST …/imports/lot-list/preview with a two-row county CSV, then …/commit with the same CSV.",
      mustObserve:
        "Auction 201. Preview maps the columns and writes nothing. Commit 201 with two inserted listings, no rejections, and a TX/Harris county watch created by the import itself.",
      async run(ctx) {
        const auction = await ctx.api("POST", "/api/tax-researcher/auctions", {
          county: "Harris",
          state: "TX",
          auctionType: "lien",
          auctionDate: "2026-11-10",
          auctionFormat: "online",
          notes: `${ctx.tag} walk fixture auction`,
        });
        ctx.check(auction.status === 201, `POST /api/tax-researcher/auctions must return 201, got ${fail(auction)}`);
        const auctionId = body(auction).auction?.id;
        ctx.check(auctionId !== undefined, "the auction create must return the auction id");
        ctx.store("auctionId", auctionId);
        const csv = [
          "APN,County,State,Sale Type,Sale Date,Delinquent Years,Total Tax Owed,Assessed Value,Owner Name,Address,City,ZIP",
          `${ctx.tag}-A-001,Harris,TX,lien,2026-11-10,2023-2024,4200.00,85000,T1 Owner Alpha,100 T1 Alpha Way,Houston,77002`,
          `${ctx.tag}-A-002,Harris,TX,lien,2026-11-10,2024,1800.00,40000,T1 Owner Beta,200 T1 Beta Way,Houston,77003`,
        ].join("\n");
        const preview = await ctx.api("POST", "/api/tax-researcher/imports/lot-list/preview", { csv, auctionId, fileName: `${ctx.tag}-harris.csv` });
        ctx.check(preview.status === 200, `lot-list preview must return 200, got ${fail(preview)}`);
        ctx.check((body(preview).unmappedRequired ?? []).length === 0, `no required column may be unmapped, got ${JSON.stringify(body(preview).unmappedRequired)}`);
        const commit = await ctx.api("POST", "/api/tax-researcher/imports/lot-list/commit", { csv, auctionId, fileName: `${ctx.tag}-harris.csv` });
        ctx.check(commit.status === 201, `lot-list commit must return 201, got ${fail(commit)}`);
        const inserted: unknown[] = body(commit).insertedIds ?? [];
        ctx.check(inserted.length === 2, `commit must insert exactly 2 listings, got ${JSON.stringify(body(commit)).slice(0, 300)}`);
        ctx.store("listingId", inserted[0]);
        return {
          observed: {
            auctionId,
            previewSummary: body(preview).summary,
            commitSummary: body(commit).summary,
            insertedCount: inserted.length,
            watchesCreated: body(commit).watchesCreated,
          },
        };
      },
    },
    {
      id: "case-a-triage-maxbid",
      title: "Case (a) — triage against the ignorance map, and the max bid derived from a stated rights stack",
      kind: "api",
      how: "GET /api/tax-watches, take the Harris watch the import created, GET its triage; then POST …/listings/:id/max-bid/screen and PUT …/max-bid with the fully stated stack (value $85,000 known; surviving liens searched-none; other taxes $4,200; costs $250; required return 20% of value).",
      mustObserve:
        "Triage answers 200 for the import-created watch. The recorded max bid is exactly $63,550 (6,355,000 cents) — 85,000 − 0 − 4,200 − 250 − 17,000 — arithmetic a reader can verify by hand.",
      async run(ctx) {
        const watches = await ctx.api("GET", "/api/tax-watches");
        ctx.check(watches.status === 200, `GET /api/tax-watches must return 200, got ${fail(watches)}`);
        const list: any[] = body(watches).watches ?? [];
        const harris = list.find((w) => String(w.county ?? "").toLowerCase() === "harris");
        ctx.check(!!harris, `the import must have created a Harris county watch; watches: ${JSON.stringify(list.map((w) => w.county))}`);
        ctx.store("watchId", harris.id);
        const triage = await ctx.api("GET", `/api/tax-watches/${harris.id}/triage`);
        ctx.check(triage.status === 200, `GET triage must return 200, got ${fail(triage)}`);
        const stack = {
          value: { status: "known", amountCents: 8_500_000, source: `${ctx.tag} fixture — county assessed value on the imported list`, asOf: "2026-11-10" },
          survivingLiens: { status: "searched_none", source: `${ctx.tag} fixture — title search of county records, none found`, asOf: "2026-11-10" },
          otherTaxes: { status: "known", amountCents: 420_000, source: `${ctx.tag} fixture — imported list total tax owed`, asOf: "2026-11-10" },
          costs: [{ label: "Recording and notice costs", amountCents: 25_000, source: `${ctx.tag} fixture estimate` }],
          requiredReturn: { kind: "pct_of_value", bps: 2000 },
        };
        const listingId = ctx.get("listingId");
        const screen = await ctx.api("POST", `/api/tax-researcher/listings/${String(listingId)}/max-bid/screen`, stack);
        ctx.check(screen.status === 200, `max-bid screen must return 200, got ${fail(screen)}`);
        const record = await ctx.api("PUT", `/api/tax-researcher/listings/${String(listingId)}/max-bid`, stack);
        ctx.check(record.status === 200, `max-bid record must return 200, got ${fail(record)}`);
        const maxBidCents = body(record).record?.maxBidCents ?? body(screen).screen?.maxBidCents;
        ctx.check(maxBidCents === 6_355_000, `the recorded max bid must be 6355000 cents ($63,550), got ${JSON.stringify(maxBidCents)}`);
        return {
          observed: {
            watchId: harris.id,
            triageKeys: Object.keys(body(triage)).slice(0, 10),
            maxBidCents,
            arithmetic: "8500000 - 0 - 420000 - 25000 - 1700000 = 6355000",
          },
        };
      },
    },
    {
      id: "case-a-certificate-gates",
      title: "Case (a) — the won bid is refused by both gates before it creates the certificate",
      kind: "api",
      how: "POST …/listings/:id/bid-log {action:\"won\", $4,500} with no county procedure recorded; record the Harris procedure (required fields only — deliberately NO noticeRequirements, so the notice refusal leg stays exercisable) and complete the county verification; retry; then state each auction registration requirement with its source and mark it done; retry.",
      mustObserve:
        "First attempt 422 biddingLocked. Standing reads biddable:false before verification and biddable:true after. Second attempt 422 registrationIncomplete. Third attempt succeeds: a certificate is created under the $63,550 max bid.",
      async run(ctx) {
        const listingId = String(ctx.get("listingId"));
        const won = { action: "won", amountCents: 450_000, notes: `${ctx.tag} walk fixture win` };
        const first = await ctx.api("POST", `/api/tax-researcher/listings/${listingId}/bid-log`, won);
        ctx.check(first.status === 422, `the first won attempt must be refused 422, got ${fail(first)}`);
        ctx.check(JSON.stringify(first.body).includes("biddingLocked"), `the first refusal must be the procedure-standing lock (biddingLocked), got ${JSON.stringify(first.body).slice(0, 300)}`);
        const harrisFields = {
          fields: {
            instrument: { value: "lien", source: "Tex. Tax Code §34.21 — T1 fixture procedure record", asOf: "2026-11-01", basis: "state_law", verification: "checked_against_statute" },
            bidMethod: { value: "Premium bidding (bid down the interest rate from the 25% statutory penalty)", source: "Tex. Tax Code §34.21 — T1 fixture procedure record", asOf: "2026-11-01", basis: "state_law", verification: "checked_against_statute" },
            returnModel: { value: { kind: "flat_penalty", penaltyBps: 2500 }, source: "Tex. Tax Code §34.21 — T1 fixture procedure record", asOf: "2026-11-01", basis: "state_law", verification: "checked_against_statute" },
            redemptionPeriodMonths: { value: 6, source: "Tex. Tax Code §34.21 (non-homestead) — T1 fixture procedure record", asOf: "2026-11-01", basis: "state_law", verification: "checked_against_statute" },
          },
        };
        const proc = await ctx.api("POST", `/api/tax-procedures/TX/${encodeURIComponent("Harris")}`, harrisFields);
        ctx.check(proc.status === 200 || proc.status === 201, `recording the Harris procedure must succeed, got ${fail(proc)}`);
        const standingBefore = await ctx.api("GET", `/api/tax-procedures/TX/${encodeURIComponent("Harris")}`);
        ctx.check(body(standingBefore).standing?.biddable === false, `standing before verification must be biddable:false, got ${JSON.stringify(body(standingBefore).standing)}`);
        const verify = await ctx.api("POST", `/api/tax-procedures/TX/${encodeURIComponent("Harris")}/verification`, {
          completedOn: "2026-11-24",
          method: `${ctx.tag} fixture — called the Harris County tax office and confirmed the recorded procedure`,
        });
        ctx.check(verify.status === 200 || verify.status === 201, `the county verification must succeed, got ${fail(verify)}`);
        const standingAfter = await ctx.api("GET", `/api/tax-procedures/TX/${encodeURIComponent("Harris")}`);
        ctx.check(body(standingAfter).standing?.biddable === true, `standing after verification must be biddable:true, got ${JSON.stringify(body(standingAfter).standing)}`);
        const second = await ctx.api("POST", `/api/tax-researcher/listings/${listingId}/bid-log`, won);
        ctx.check(second.status === 422, `the second won attempt must be refused 422, got ${fail(second)}`);
        ctx.check(JSON.stringify(second.body).includes("registrationIncomplete"), `the second refusal must be the registration gate, got ${JSON.stringify(second.body).slice(0, 300)}`);
        const auctionId = String(ctx.get("auctionId"));
        for (const item of ["deposit", "funds", "entity_docs", "w9"]) {
          const req = await ctx.api("PUT", `/api/tax-researcher/auctions/${auctionId}/registration/${item}`, {
            kind: "requirement",
            requirement: { status: "required", source: `${ctx.tag} fixture — Harris County tax sale notice`, asOf: "2026-11-01" },
          });
          ctx.check(req.status === 200, `stating registration requirement ${item} must return 200, got ${fail(req)}`);
          const done = await ctx.api("PUT", `/api/tax-researcher/auctions/${auctionId}/registration/${item}`, { kind: "done", note: `${ctx.tag} fixture — completed for the walk` });
          ctx.check(done.status === 200, `marking registration ${item} done must return 200, got ${fail(done)}`);
        }
        const bidder = await ctx.api("PUT", `/api/tax-researcher/auctions/${auctionId}/registration/bidder_registration`, {
          kind: "done",
          note: `${ctx.tag} fixture — registered bidder ${ctx.tag}-BIDDER`,
        });
        ctx.check(bidder.status === 200, `marking bidder_registration done must return 200, got ${fail(bidder)}`);
        const third = await ctx.api("POST", `/api/tax-researcher/listings/${listingId}/bid-log`, won);
        ctx.check(third.status === 200 || third.status === 201, `the third won attempt must succeed, got ${fail(third)}`);
        const cert = body(third).certificate;
        ctx.check(cert?.status === "created" && !!cert?.certificateId, `the won bid must create a certificate, got ${JSON.stringify(cert)}`);
        ctx.store("certA", cert.certificateId);
        return {
          observed: {
            firstRefusal: "422 biddingLocked",
            standingBeforeVerify: "biddable:false",
            standingAfterVerify: "biddable:true",
            secondRefusal: "422 registrationIncomplete",
            certificateId: cert.certificateId,
            certificateStatus: cert.status,
          },
        };
      },
    },
    {
      id: "case-a-clock",
      title: "Case (a) — the redemption clock on the won certificate",
      kind: "api",
      how: "GET /api/tax-certificates/<A>/clock and GET /api/tax-certificates/<A>.",
      mustObserve:
        "The clock reads phase redeemable with deadline 2027-05-10 (sale 2026-11-10 + the encoded TX 6-month non-homestead period), the certificate detail carries the same deadline, and the procedure cross-check agrees (the recorded Harris procedure states the same 6 months).",
      async run(ctx) {
        const certA = String(ctx.get("certA"));
        const clock = await ctx.api("GET", `/api/tax-certificates/${certA}/clock`);
        ctx.check(clock.status === 200, `GET clock must return 200, got ${fail(clock)}`);
        ctx.check(body(clock).phase === "redeemable", `the clock phase must be redeemable, got ${JSON.stringify(body(clock).phase)}`);
        ctx.check(body(clock).procedureCheck?.agrees === true, `the procedure cross-check must agree, got ${JSON.stringify(body(clock).procedureCheck)}`);
        const detail = await ctx.api("GET", `/api/tax-certificates/${certA}`);
        ctx.check(detail.status === 200, `GET certificate must return 200, got ${fail(detail)}`);
        const deadline = String(body(detail).certificate?.redemptionDeadline ?? "").slice(0, 10);
        ctx.check(deadline === "2027-05-10", `cert A's deadline must be 2027-05-10, got ${JSON.stringify(deadline)}`);
        return {
          observed: {
            phase: body(clock).phase,
            redemptionDeadline: deadline,
            procedureCheck: body(clock).procedureCheck,
            deadlineBasis: body(clock).deadlineBasis,
          },
        };
      },
    },
    {
      id: "case-b-wy-no-rule",
      title: "Case (b) — WY, a state with no encoded redemption rule: refusal, then the operator-entered path that never dresses up as computation",
      kind: "api",
      how: "POST /api/tax-certificates {state:\"WY\", …} with no deadline; then the same create with an operator-entered deadline and its county source; then GET the certificate and its clock.",
      mustObserve:
        "The no-deadline create is refused 400 with the words \"no encoded redemption rule for WY\" and \"will not guess\". The operator-entered create succeeds with deadlineSource operator_entered; the detail reads stateRule null and a redemption amount of null with a refusal reason — no improvised math anywhere downstream; the clock runs on the entered deadline only and banners its provenance.",
      async run(ctx) {
        const base = {
          state: "WY",
          county: `${ctx.tag} Laramie`,
          apn: `${ctx.tag}-B-001`,
          saleType: "lien",
          saleDate: "2026-06-01",
          purchaseAmountCents: 300_000,
          ownerName: "T1 Owner NoRule",
          ownerAddress: { line1: "400 T1 NoRule Rd", city: "Cheyenne", state: "WY", zip: "82001" },
        };
        const refused = await ctx.api("POST", "/api/tax-certificates", base);
        ctx.check(refused.status === 400, `the WY no-deadline create must be refused 400, got ${fail(refused)}`);
        ctx.check(/no encoded redemption rule for WY/.test(JSON.stringify(refused.body)), `the refusal must name the missing rule, got ${JSON.stringify(refused.body).slice(0, 300)}`);
        ctx.check(/will not guess/.test(JSON.stringify(refused.body)), `the refusal must say it will not guess, got ${JSON.stringify(refused.body).slice(0, 300)}`);
        const created = await ctx.api("POST", "/api/tax-certificates", {
          ...base,
          redemptionDeadline: "2027-06-01",
          redemptionDeadlineSource: `${ctx.tag} fixture — deadline stated on the county certificate of purchase`,
        });
        ctx.check(created.status === 201, `the operator-entered create must return 201, got ${fail(created)}`);
        const certB = body(created).certificate?.id;
        ctx.check(!!certB, "the operator-entered create must return the certificate id");
        ctx.check(body(created).certificate?.deadlineSource === "operator_entered", `deadlineSource must be operator_entered, got ${JSON.stringify(body(created).certificate?.deadlineSource)}`);
        ctx.store("certB", certB);
        const detail = await ctx.api("GET", `/api/tax-certificates/${String(certB)}`);
        ctx.check(detail.status === 200, `GET cert B must return 200, got ${fail(detail)}`);
        ctx.check(body(detail).stateRule === null, `cert B's stateRule must be null (no encoded WY rule), got ${JSON.stringify(body(detail).stateRule)}`);
        const amount = body(detail).redemptionAmount ?? {};
        ctx.check(amount.totalRedemptionCents === null && !!amount.refusalReason, `cert B's redemption amount must be null with a refusal reason, got ${JSON.stringify(amount).slice(0, 300)}`);
        const clock = await ctx.api("GET", `/api/tax-certificates/${String(certB)}/clock`);
        ctx.check(clock.status === 200, `GET cert B clock must return 200, got ${fail(clock)}`);
        ctx.check(/entered/i.test(String(body(clock).deadlineBasis ?? "")), `cert B's clock must banner the entered provenance, got ${JSON.stringify(body(clock).deadlineBasis)}`);
        return {
          observed: {
            refusalStatus: refused.status,
            certificateId: certB,
            deadlineSource: body(created).certificate?.deadlineSource,
            stateRule: null,
            redemptionAmount: amount,
            clockDeadlineBasis: body(clock).deadlineBasis,
          },
        };
      },
    },
    {
      id: "case-c-ga-mismatch",
      title: "Case (c) — GA Fulton: a recorded procedure contradicting the encoded rule fires the mismatch flag, and the deadline does not move",
      kind: "api",
      how: "POST /api/tax-procedures/GA/Fulton recording redemptionPeriodMonths 24 (county practice, sourced) plus the fixture noticeRequirements the notice leg needs; POST /api/tax-certificates for a GA redeemable deed sold 2026-01-15 for $6,000; GET its clock.",
      mustObserve:
        "The certificate's deadline stays the encoded 2027-01-15 (12 months, O.C.G.A. §48-4-42) — the recorded procedure does not silently move it — and the clock's procedureCheck reads agrees:false with statedMonths 24 and impliedDeadlineFromSale 2028-01-15.",
      async run(ctx) {
        const proc = await ctx.api("POST", `/api/tax-procedures/GA/${encodeURIComponent("Fulton")}`, {
          fields: {
            redemptionPeriodMonths: { value: 24, source: `${ctx.tag} fixture — recorded county procedure, deliberately contradicts the encoded GA rule`, asOf: "2026-11-01", basis: "county_practice", verification: "unverified" },
            noticeRequirements: { value: `${ctx.tag} fixture notice requirement: certified mail to the owner of record at least 30 days before the redemption deadline, stating the amount required to redeem.`, source: `${ctx.tag} fixture — Fulton County procedure card`, asOf: "2026-11-01", basis: "county_practice", verification: "unverified" },
          },
        });
        ctx.check(proc.status === 200 || proc.status === 201, `recording the Fulton procedure must succeed, got ${fail(proc)}`);
        const created = await ctx.api("POST", "/api/tax-certificates", {
          state: "GA",
          county: "Fulton",
          apn: `${ctx.tag}-C-001`,
          certificateNumber: `${ctx.tag}-CERT-C`,
          saleType: "redeemable_deed",
          saleDate: "2026-01-15",
          purchaseAmountCents: 600_000,
          ownerName: "T1 Owner Mismatch",
          ownerAddress: { line1: "300 T1 Gamma Way", city: "Atlanta", state: "GA", zip: "30303" },
        });
        ctx.check(created.status === 201, `creating cert C must return 201, got ${fail(created)}`);
        const certC = body(created).certificate?.id;
        ctx.check(!!certC, "cert C create must return the certificate id");
        ctx.store("certC", certC);
        const deadline = String(body(created).certificate?.redemptionDeadline ?? "").slice(0, 10);
        ctx.check(deadline === "2027-01-15", `cert C's deadline must stay the encoded 2027-01-15, got ${JSON.stringify(deadline)}`);
        const clock = await ctx.api("GET", `/api/tax-certificates/${String(certC)}/clock`);
        ctx.check(clock.status === 200, `GET cert C clock must return 200, got ${fail(clock)}`);
        const check = body(clock).procedureCheck ?? {};
        ctx.check(check.agrees === false, `the mismatch flag must fire (procedureCheck.agrees false), got ${JSON.stringify(check)}`);
        ctx.check(check.statedMonths === 24, `procedureCheck.statedMonths must be 24, got ${JSON.stringify(check)}`);
        ctx.check(String(check.impliedDeadlineFromSale ?? "").slice(0, 10) === "2028-01-15", `the implied deadline from the stated procedure must be 2028-01-15, got ${JSON.stringify(check)}`);
        return {
          observed: {
            certificateId: certC,
            redemptionDeadline: deadline,
            procedureCheck: check,
            deadlineBasis: body(clock).deadlineBasis,
          },
        };
      },
    },
    {
      id: "notice-draft-refusals",
      title: "Notice leg — the draft records nothing, and both fail-closed refusals send nothing",
      kind: "api",
      how: "POST …/tax-certificates/<C>/redemption-notice {delivery:\"download\"}; POST …/<A>/redemption-notice {delivery:\"certified_mail\"} (the Harris procedure records no noticeRequirements); record WY notice requirements on cert B's county procedure, then POST …/<B>/redemption-notice {delivery:\"certified_mail\"}. After each, re-read the certificate's ledger.",
      mustObserve:
        "The draft answers 200 and cert C's ledger still shows zero notices. Cert A is refused 422 notice_requirements_not_recorded and its ledger stays empty. Cert B is refused 422 amount_not_determinable and its ledger stays empty. Nothing was sent, anywhere.",
      async run(ctx) {
        const certA = String(ctx.get("certA"));
        const certB = String(ctx.get("certB"));
        const certC = String(ctx.get("certC"));
        const draft = await ctx.api("POST", `/api/tax-certificates/${certC}/redemption-notice`, { delivery: "download" });
        ctx.check(draft.status === 200, `the notice draft must return 200, got ${fail(draft)}`);
        ctx.check((await ledgerNotices(ctx, certC)).length === 0, "a draft records nothing as sent — cert C's ledger must still show zero notices");
        const refusal1 = await ctx.api("POST", `/api/tax-certificates/${certA}/redemption-notice`, { delivery: "certified_mail" });
        ctx.check(refusal1.status === 422, `cert A's notice must be refused 422, got ${fail(refusal1)}`);
        ctx.check(body(refusal1).details?.reason === "notice_requirements_not_recorded", `cert A's refusal reason must be notice_requirements_not_recorded, got ${JSON.stringify(refusal1.body).slice(0, 300)}`);
        ctx.check((await ledgerNotices(ctx, certA)).length === 0, "the refused send records nothing — cert A's ledger must stay empty");
        const wyProc = await ctx.api("POST", `/api/tax-procedures/WY/${encodeURIComponent(`${ctx.tag} Laramie`)}`, {
          fields: {
            noticeRequirements: { value: `${ctx.tag} fixture notice requirement: mail the redemption notice to the owner of record.`, source: `${ctx.tag} fixture — county procedure card`, asOf: "2026-11-01", basis: "county_practice", verification: "unverified" },
          },
        });
        ctx.check(wyProc.status === 200 || wyProc.status === 201, `recording the WY notice requirements must succeed, got ${fail(wyProc)}`);
        const refusal2 = await ctx.api("POST", `/api/tax-certificates/${certB}/redemption-notice`, { delivery: "certified_mail" });
        ctx.check(refusal2.status === 422, `cert B's notice must be refused 422, got ${fail(refusal2)}`);
        ctx.check(body(refusal2).details?.reason === "amount_not_determinable", `cert B's refusal reason must be amount_not_determinable, got ${JSON.stringify(refusal2.body).slice(0, 300)}`);
        ctx.check((await ledgerNotices(ctx, certB)).length === 0, "the refused send records nothing — cert B's ledger must stay empty");
        return {
          observed: {
            draftStatus: draft.status,
            draftLedgerNotices: 0,
            refusal1: "422 notice_requirements_not_recorded",
            refusal2: "422 amount_not_determinable",
            ledgersAfterRefusals: "A=0 B=0",
          },
          notes: ["The staging driver's api() parses JSON only, so the draft's PDF bytes (%PDF- magic) are not observable through the harness; the observable claim here is the 200 + the unchanged ledger. The walking session verifies the PDF magic separately, in-machine, and records it in the operator notes."],
        };
      },
    },
    {
      id: "notice-simulated-send",
      title: "Notice leg — the simulated send under per-org simulationMode (zero real mail)",
      kind: "api",
      simulated: true,
      simulationNote: SIMULATION_NOTE,
      how: "First re-read GET /api/organization and require settings.simulationMode === true — the step fails before any send attempt if it is not (zero-real-mail gate). Ensure a default mail sender identity exists (POST /api/mail-identities; simulation intercepts before the lane that would verify it). Then POST …/tax-certificates/<C>/redemption-notice {delivery:\"certified_mail\"} and re-read cert C's ledger.",
      mustObserve:
        "200. delivery.testMode is true and delivery.providerId is a sim_… id, not an ltr_… id. Cert C's ledger then shows exactly one notice: viaRail true, the same providerId, and simulated true (the T-DEF-4 cure — the receipt's simulation marker carried through the projection). The amount is $7,200 (720000 cents: the $6,000 certificate + $1,200 encoded interest).",
      async run(ctx) {
        const certC = String(ctx.get("certC"));
        const org = await ctx.api("GET", "/api/organization");
        ctx.check(
          body(org).settings?.simulationMode === true,
          `ZERO-REAL-MAIL GATE: the walk org's settings.simulationMode must read true before any send attempt, got ${JSON.stringify(body(org).settings?.simulationMode)} — refusing to send`,
        );
        const identities = await ctx.api("GET", "/api/mail-identities");
        const existing: any[] = Array.isArray(identities.body) ? identities.body : (body(identities).identities ?? []);
        if (!existing.some((i) => i.isDefault)) {
          const created = await ctx.api("POST", "/api/mail-identities", {
            name: `${ctx.tag} Walk Office`,
            companyName: `${ctx.tag} Tax LLC`,
            addressLine1: "11 T1 Walk Plaza",
            city: "Atlanta",
            state: "GA",
            zipCode: "30303",
            country: "US",
            isDefault: true,
          });
          ctx.check(created.status === 200 || created.status === 201, `creating the default sender identity must succeed, got ${fail(created)}`);
        }
        const send = await ctx.api("POST", `/api/tax-certificates/${certC}/redemption-notice`, { delivery: "certified_mail" });
        ctx.check(send.status === 200, `the simulated send must return 200, got ${fail(send)}`);
        const delivery = body(send).delivery ?? {};
        ctx.check(delivery.testMode === true, `the send must declare testMode:true, got ${JSON.stringify(delivery)}`);
        ctx.check(typeof delivery.providerId === "string" && delivery.providerId.startsWith("sim_"), `the provider id must be a sim_… id, got ${JSON.stringify(delivery.providerId)}`);
        ctx.check(!String(delivery.providerId).startsWith("ltr_"), "the provider id must NOT be an ltr_… Lob letter id");
        ctx.check(body(send).notice?.amountCents === 720_000, `the notice amount must be 720000 cents ($6,000 + $1,200 interest), got ${JSON.stringify(body(send).notice)}`);
        const notices = await ledgerNotices(ctx, certC);
        ctx.check(notices.length === 1, `cert C's ledger must show exactly one notice after the send, got ${JSON.stringify(notices).slice(0, 300)}`);
        const n = notices[0];
        ctx.check(n.viaRail === true, `the ledger notice must read viaRail:true, got ${JSON.stringify(n)}`);
        ctx.check(n.providerId === delivery.providerId, `the ledger providerId must match the send's, got ${JSON.stringify(n.providerId)} vs ${JSON.stringify(delivery.providerId)}`);
        ctx.check(n.simulated === true, `the ledger notice must carry simulated:true (T-DEF-4 cure), got ${JSON.stringify(n)}`);
        return {
          observed: {
            simulated: true,
            simulationNote: SIMULATION_NOTE,
            providerId: delivery.providerId,
            testMode: delivery.testMode,
            amountCents: body(send).notice?.amountCents,
            ledgerNotice: n,
          },
        };
      },
    },
    {
      id: "pax-tax-certificates",
      title: "Pax — read the walked org's tax certificates through Pax, with the coverage statement and the tool receipt",
      kind: "pax",
      how: "The persona acknowledges the Pax disclosure (POST /api/pax/acknowledge-disclosure — the gate every customer passes), then POST /api/ai/chat asks how many tax certificates the account holds. The receipt is the response's own toolCalls entry for get_tax_certificates (the T7 tool family).",
      mustObserve:
        "200. The turn called get_tax_certificates and the call succeeded; its result carries a coverage statement, and the list holds the walked org's three certificates (TX Harris, WY, GA Fulton). A read leg only: Pax records nothing and sends nothing.",
      paxState: "exercised",
      async run(ctx) {
        const ack = await ctx.api("POST", "/api/pax/acknowledge-disclosure", {});
        ctx.check(ack.status === 200, `POST /api/pax/acknowledge-disclosure must return 200, got ${fail(ack)}`);
        const chat = await ctx.api("POST", "/api/ai/chat", {
          message: "List my tax certificates: how many tax certificates do I hold, and what does your answer cover?",
        });
        ctx.check(chat.status === 200, `POST /api/ai/chat must return 200, got ${fail(chat)}`);
        const calls: any[] = body(chat).toolCalls ?? [];
        const call = calls.find((c) => c.name === "get_tax_certificates");
        ctx.check(!!call, `the turn must call get_tax_certificates; tools called: ${JSON.stringify(calls.map((c) => c.name))}`);
        ctx.check(call.result?.success === true, `the get_tax_certificates call must succeed, got ${JSON.stringify(call.result).slice(0, 300)}`);
        const data = call.result?.data ?? {};
        const coverage = String(data.coverage ?? "");
        ctx.check(/coverage/i.test(coverage), `the result must carry a coverage statement, got ${JSON.stringify(coverage).slice(0, 300)}`);
        const certs: any[] = data.certificates ?? [];
        ctx.check(certs.length === 3, `Pax must read all three walked certificates, got ${certs.length}: ${JSON.stringify(certs).slice(0, 300)}`);
        const states = certs.map((c) => c.state).sort();
        ctx.check(JSON.stringify(states) === JSON.stringify(["GA", "TX", "WY"]), `Pax's certificates must be the walked TX/WY/GA set, got ${JSON.stringify(states)}`);
        return {
          observed: {
            toolsCalled: calls.map((c) => c.name),
            getTaxCertificatesSucceeded: true,
            coverage: coverage.slice(0, 400),
            certificatesRead: certs.length,
            states,
            model: body(chat).model,
          },
        };
      },
    },
  ],
});
