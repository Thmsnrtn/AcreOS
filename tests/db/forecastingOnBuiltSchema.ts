/**
 * tests/db/forecastingOnBuiltSchema.ts — does W4's stage 0 actually record,
 * issue and score against a database built from this repository?
 *
 *     DATABASE_URL=postgres://… npx tsx tests/db/forecastingOnBuiltSchema.ts
 *
 * Drives the REAL entry points the monthly job calls — recordPublicVintages,
 * recordCustomerOutcomes, issueForecasts, scoreDueForecasts, liveTrackRecord —
 * through the real provider registry and provider_cache, with the network
 * replaced by a fixture (FRED API, Census BPS, NASS Quick Stats) and the
 * calendar moved by the one clock.
 *
 * WHAT IT PROVES
 *   1. Every public family is recorded as known on the run date; a second
 *      month appends ONLY new and revised values, and the earlier vintage of a
 *      revised value is still there, unchanged.
 *   2. Without a key a family is refused with the reason and nothing is fetched.
 *   3. A customer's closed deal, offer results and outreach response are
 *      recorded with only OUTCOME_FIELDS; editing the deal later does not
 *      change what was recorded.
 *   4. Forecasts are issued from recorded data only, once per key; when the
 *      target month is published they are scored, and the customer gate stays
 *      shut on a record this thin.
 *
 * Seeds its own rows and deletes them afterwards. Exits non-zero on failure.
 */
import { and, eq, gte, inArray } from "drizzle-orm";
import {
  campaignResponses,
  customerOutcomeObservations,
  deals,
  forecastLedger,
  leads,
  offers,
  organizations,
  properties,
  providerCache,
  publicSeriesVintages,
} from "@shared/schema";

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`[forecasting-on-built-schema] ${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

// ── Network fixture ───────────────────────────────────────────────────────
// A payroll series per state that cycles, so phases change over time.
const STATES_FIPS: Record<string, string> = {};
let revisionBump = 0; // added to TN's 2020-01 value from the second month on
let publishedThrough = "2026-08-01";

function addMonths(d: string, n: number): string {
  const [y, m] = d.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`;
}
function payrolls(seriesId: string): Array<{ date: string; value: string }> {
  const st = seriesId.slice(0, 2);
  const phase = st.charCodeAt(0) + st.charCodeAt(1);
  const out: Array<{ date: string; value: string }> = [];
  let x = 1000 + phase;
  for (let d = "1990-01-01"; d <= publishedThrough; d = addMonths(d, 1)) {
    const i = out.length;
    let v = x;
    if (st === "TN" && d === "2020-01-01") v += revisionBump;
    out.push({ date: d, value: i === 5 ? "." : v.toFixed(1) });
    x *= Math.pow(1 + (1.5 + 3 * Math.sin((i + phase) / 10)) / 100, 1 / 12);
  }
  return out;
}

const fetched: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  fetched.push(url);
  const u = new URL(url);
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (u.host === "api.stlouisfed.org") {
    const sid = u.searchParams.get("series_id") ?? "";
    if (sid.endsWith("UR")) return json({ observations: [{ date: "2026-08-01", value: "4.1" }] });
    return json({ observations: payrolls(sid) });
  }
  if (u.host === "www2.census.gov") {
    const m = /st(\d{2})(\d{2})c\.txt$/.exec(u.pathname);
    const month = m ? `20${m[1]}-${m[2]}-01` : "";
    if (!m || month > publishedThrough) return new Response("not found", { status: 404 });
    const rows = Object.entries(STATES_FIPS).map(([, fips], k) => `20${m[1]}${m[2]},${fips},3,6,X,0,${100 + k},0,0,0,0,0,0,0,0,0,0`);
    return new Response(["Survey,FIPS", "Date,State", ...rows].join("\n"), { status: 200 });
  }
  if (u.host === "quickstats.nass.usda.gov") {
    const st = u.searchParams.get("state_alpha") ?? "";
    const data = Array.from({ length: 30 }, (_, i) => ({ year: 1997 + i, Value: Math.round(2000 * Math.pow(1.04 + 0.01 * Math.sin(i + st.charCodeAt(0)), i)).toLocaleString("en-US"), reference_period_desc: "YEAR" }));
    return json({ data });
  }
  return new Response("unexpected host in fixture", { status: 599 });
}) as typeof fetch;

async function main() {
  const { STATES } = await import("../../shared/forecasting/publicSeries");
  for (const s of STATES) STATES_FIPS[s.code] = s.fips;
  const { db, pool } = await import("../../server/db");
  const { setSimulatedClockOffset } = await import("../../server/utils/clock");
  const { initializeProviders } = await import("../../server/providers-init");
  const { recordPublicVintages, recordCustomerOutcomes } = await import("../../server/services/forecasting/vintageRecorder");
  const { issueForecasts, scoreDueForecasts, liveTrackRecord } = await import("../../server/services/forecasting/forecastLedger");
  const { OUTCOME_FIELDS } = await import("../../shared/forecasting/models");
  const OUTCOME_FIELD_KEYS = Object.keys(OUTCOME_FIELDS);
  const { customerForecastGate } = await import("../../shared/forecasting/scoring");
  const { CYCLE_PHASE_ENGINE_ID } = await import("../../shared/forecasting/cyclePhase");
  initializeProviders();

  const startedAt = new Date();
  const at = (iso: string) => setSimulatedClockOffset(Date.parse(iso) - Date.now());
  const tag = `w4fc-${Date.now()}`;
  let orgId: number | undefined;
  try {
    // ── 2. refusal without a key: nothing fetched for that family ─────────
    delete process.env.FRED_API_KEY;
    delete process.env.NASS_API_KEY;
    at("2026-10-25T06:10:00Z");
    fetched.length = 0;
    const refusedRun = await recordPublicVintages();
    const pay0 = refusedRun.families.find((f) => f.family === "state_payrolls")!;
    check(/FRED_API_KEY not set/.test(pay0.refused ?? "") && pay0.rowsAppended === 0, "payrolls refused without FRED_API_KEY, nothing appended");
    check(!fetched.some((u) => u.includes("stlouisfed") || u.includes("nass.usda")), "no FRED or NASS request was made without its key");
    check((refusedRun.families.find((f) => f.family === "state_permits_nsa")?.rowsAppended ?? 0) > 0, "Census permits (keyless) still recorded");

    // ── 1. record, then a month later only revisions are appended ─────────
    process.env.FRED_API_KEY = "fixture";
    process.env.NASS_API_KEY = "fixture";
    await db.delete(providerCache).where(inArray(providerCache.category, ["macro_series"]));
    const run1 = await recordPublicVintages();
    const pay1 = run1.families.find((f) => f.family === "state_payrolls")!;
    check(pay1.seriesRead === 51 && pay1.rowsAppended > 51 * 400, `payrolls recorded for 51 series (${pay1.seriesRead}, ${pay1.rowsAppended} rows)`);
    check((run1.families.find((f) => f.family === "state_ag_land_value")?.rowsAppended ?? 0) === 51 * 30, "land values recorded");
    const tnJan = async () => db.select().from(publicSeriesVintages).where(and(eq(publicSeriesVintages.seriesId, "TNNA"), eq(publicSeriesVintages.observationDate, "2020-01-01")));
    const before = await tnJan();
    check(before.length === 1 && before[0].vintageDate === "2026-10-25", "TN Jan-2020 recorded once, as known 2026-10-25");
    const missing = await db.select().from(publicSeriesVintages).where(and(eq(publicSeriesVintages.seriesId, "TNNA"), eq(publicSeriesVintages.observationDate, "1990-06-01")));
    check(missing.length === 0, "a '.' (missing) observation is not recorded as a number");

    revisionBump = 7;
    publishedThrough = "2026-09-01";
    at("2026-11-25T06:10:00Z");
    const run2 = await recordPublicVintages();
    const pay2 = run2.families.find((f) => f.family === "state_payrolls")!;
    check(pay2.rowsAppended === 51 + 1, `month two appends one new month per state plus TN's one revision (${pay2.rowsAppended})`);
    const after = await tnJan();
    check(after.length === 2 && after.some((r) => r.vintageDate === "2026-10-25" && r.value === before[0].value) && after.some((r) => r.vintageDate === "2026-11-25" && r.value === before[0].value + 7), "the revision is a new row; the earlier vintage is unchanged");

    // ── 3. customer outcomes, frozen as known ────────────────────────────
    const [o] = await db.insert(organizations).values({ name: tag, slug: tag, ownerId: tag }).returning({ id: organizations.id });
    orgId = o.id;
    const [p] = await db.insert(properties).values({ organizationId: orgId, apn: `${tag}-1`, county: "Knox", state: "TN", sizeAcres: "5.5", purchasePrice: "10000", purchaseDate: new Date("2025-01-10"), soldPrice: "25000", soldDate: new Date("2026-06-10") }).returning({ id: properties.id });
    const [d] = await db.insert(deals).values({ organizationId: orgId, propertyId: p.id, type: "disposition", status: "closed", acceptedAmount: "25000", closingDate: new Date("2026-06-10") }).returning({ id: deals.id });
    await db.insert(offers).values([
      { organizationId: orgId, propertyId: p.id, status: "accepted", cashOffer: "9000", respondedAt: new Date("2025-01-02") },
      { organizationId: orgId, propertyId: p.id, status: "rejected", cashOffer: "5000", respondedAt: new Date("2024-12-01") },
    ]);
    const [l] = await db.insert(leads).values({ organizationId: orgId, firstName: "Pat", lastName: "Owner", state: "TN", county: "Knox" }).returning({ id: leads.id });
    await db.insert(campaignResponses).values({ organizationId: orgId, leadId: l.id, channel: "text", responseDate: new Date("2026-05-01"), content: "call me" });
    const rec1 = await recordCustomerOutcomes();
    const mine = async () => db.select().from(customerOutcomeObservations).where(eq(customerOutcomeObservations.organizationId, orgId!));
    const obs = await mine();
    check(obs.length === 4 && rec1.appended >= 4, `four outcomes recorded for the org (${obs.length})`);
    const closed = obs.find((x) => x.kind === "deal_closed");
    check(closed?.values.priceCents === 2_500_000 && closed?.values.daysHeld === 516 && closed?.values.acres === 5.5, "the closed deal carries price, days held and acres");
    check(obs.every((x) => Object.keys(x.values).every((k) => OUTCOME_FIELD_KEYS.includes(k))), "no outcome carries a field outside OUTCOME_FIELDS");
    check(!JSON.stringify(obs).includes("Pat") && !JSON.stringify(obs).includes("call me"), "no name or message text is recorded");
    await db.update(deals).set({ acceptedAmount: "99999" }).where(eq(deals.id, d.id));
    await db.update(properties).set({ soldPrice: "99999" }).where(eq(properties.id, p.id));
    await recordCustomerOutcomes();
    const again = await mine();
    check(again.length === 4 && again.find((x) => x.kind === "deal_closed")?.values.priceCents === 2_500_000, "editing the deal later does not change what was recorded");

    // ── 4. issue, re-issue (no duplicates), publish, score ───────────────
    const iss = await issueForecasts();
    const cyc = iss.engines.find((e) => e.engineId === CYCLE_PHASE_ENGINE_ID)!;
    check(cyc.issued === 51 && cyc.refused == null, `51 cycle forecasts issued from recorded data (${cyc.issued})`);
    check((iss.engines.find((e) => e.engineId !== CYCLE_PHASE_ENGINE_ID)?.issued ?? 0) === 51, "51 land-value forecasts issued");
    const iss2 = await issueForecasts();
    check(iss2.engines.every((e) => e.issued === 0), "issuing again the same day adds nothing");
    check((await scoreDueForecasts()) === 0, "nothing is scored before its target month is published");

    publishedThrough = "2027-04-01";
    at("2027-05-25T06:10:00Z");
    await recordPublicVintages();
    const scored = await scoreDueForecasts();
    check(scored === 51, `the 51 cycle forecasts are scored once their target month is published (${scored})`);
    const rec = await liveTrackRecord(CYCLE_PHASE_ENGINE_ID);
    check(rec.phase.n === 51 && rec.phase.brier != null && rec.ranges.coverage != null, "the live record has a Brier score and a range coverage");
    check(!customerForecastGate(rec).allowed, "one month of live forecasts does not open the customer gate");
  } finally {
    setSimulatedClockOffset(0);
    globalThis.fetch = realFetch;
    if (orgId) {
      // Several of these FKs do not cascade; delete children first.
      await db.delete(campaignResponses).where(eq(campaignResponses.organizationId, orgId));
      await db.delete(offers).where(eq(offers.organizationId, orgId));
      await db.delete(deals).where(eq(deals.organizationId, orgId));
      await db.delete(leads).where(eq(leads.organizationId, orgId));
      await db.delete(properties).where(eq(properties.organizationId, orgId));
      await db.delete(customerOutcomeObservations).where(eq(customerOutcomeObservations.organizationId, orgId));
      await db.delete(organizations).where(eq(organizations.id, orgId));
    }
    await db.delete(publicSeriesVintages).where(gte(publicSeriesVintages.recordedAt, startedAt));
    await db.delete(forecastLedger).where(gte(forecastLedger.recordedAt, startedAt));
    await db.delete(providerCache).where(eq(providerCache.category, "macro_series"));
    await pool.end().catch(() => {});
  }
  if (failures.length) {
    console.error(`[forecasting-on-built-schema] ${failures.length} failure(s)`);
    process.exit(1);
  }
  console.log("[forecasting-on-built-schema] PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error("[forecasting-on-built-schema] crashed:", err);
  process.exit(1);
});
