/**
 * BURDEN LEDGER + UNIT ECONOMICS — reads what cohort-90-days.ts left behind
 * (MARKET_OUT/cohort), the provider stand-in log and the DB, and produces:
 *
 *   1. AUDITS the cohort could not do inline (each becomes burden rows):
 *      - SMS that reached a seller AFTER that seller opted out (provider log,
 *        attributed by the org's own from-number; opt-out instant from the
 *        reply the cohort delivered);
 *      - SMS delivered inside quiet hours on the RECIPIENT's clock (zone of the
 *        recipient's area code as generated — the cohort's own truth table);
 *      - SMS bodies without opt-out language.
 *   2. OWNER HOURS / WEEK at 3, 10, 25 customers for calendar weeks 1–13.
 *      Each org's events carry its TENURE week; the org's arrival day on the
 *      band's curve places tenure week t at calendar week
 *      floor((arrival + 7(t−1)) / 7) + 1. Dedupe rule: one org × one issue key
 *      × one tenure week = one ticket (a customer who hits the same wall five
 *      times in a week writes in once); for SILENT classes (silent no-op, wrong
 *      money, billing dispute) one ticket per org × issue × tenure MONTH. Minutes per class: common.ts RUBRIC.
 *      Exclusions, each stated in the output with its count:
 *        - environment gaps (Stripe unconfigured: checkout 500, credit pack 400,
 *          "No active subscription to cancel") — not product behaviour here;
 *        - "Insufficient credits" 402s after tenure week 2: the 14-day trial's
 *          $5 spend cap (credits.ts hasEnoughCredits) is evaluated on the REAL
 *          clock, which this compressed run never advances — so only weeks 1–2
 *          are product-true.
 *   3. UNIT ECONOMICS per tier from the app's OWN metering (financial_ledger,
 *      ai_telemetry_events, credit_transactions) + plan prices from
 *      shared/billing/tier-pricing.ts. Anything not metered says so; estimates
 *      are a separate, labelled column with their source.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { q, writeJson, RUBRIC_MINUTES, type BurdenClass } from "./common";
import { TIER_PRICES_CENTS } from "../../../../shared/billing/tier-pricing";
import { FIXED_COST_INPUTS_USD_MONTHLY } from "../../../../shared/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.MARKET_OUT!;
const COHORT = process.env.COHORT_DIR ?? join(OUT, "cohort");
const PROVIDER_LOG = join(process.env.PROVIDER_DIR ?? "", "provider-calls.jsonl");
const L = (f: string) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

// arrival curves, read from the cohort source (single source of truth)
const src = readFileSync(join(HERE, "cohort-90-days.ts"), "utf8");
const arr = (name: string): number[] => { const m = new RegExp(`export const ${name} = (\\[[^\\]]*\\])`).exec(src); if (!m) throw new Error(`cohort-90-days.ts no longer exports ${name}`); return JSON.parse(m[1]); };
const CURVES: Record<number, number[]> = { 3: arr("ARRIVAL_3"), 10: arr("ARRIVAL_10"), 25: arr("ARRIVAL_25") };

const orgs: any[] = JSON.parse(readFileSync(join(COHORT, "cohort-orgs.json"), "utf8"));
const bySlug = new Map(orgs.map((o) => [o.slug, o]));
const started = new Date(readFileSync(join(COHORT, "started-at"), "utf8").trim());
const events: any[] = L(join(COHORT, "burden.jsonl")).map((e) => ({ ...e, n: bySlug.get(e.org)?.n }));
const steps = L(join(COHORT, "cohort-steps.jsonl"));

// ── 1. audits over the provider log ──────────────────────────────────────────
const prov = L(PROVIDER_LOG).filter((x) => new Date(x.ts) >= started);
const AREA_ZONE: Record<string, string> = { "213": "America/Los_Angeles", "713": "America/Chicago", "312": "America/Chicago", "973": "America/New_York", "617": "America/New_York", "305": "America/New_York", "602": "America/Phoenix", "206": "America/Los_Angeles", "303": "America/Denver", "716": "America/New_York", "404": "America/New_York", "503": "America/Los_Angeles" };
const localHour = (zone: string, t: Date) => { const p = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(t); return (Number(p.find((x) => x.type === "hour")!.value) % 24) + Number(p.find((x) => x.type === "minute")!.value) / 60; };
const audit = { smsAfterOptOut: [] as any[], quietHours: [] as any[], noOptOutLanguage: 0, smsDelivered: 0, smsRefusedByCarrier: 0 };
for (const o of orgs) {
  const number = `+1500555${String(o.orgId).padStart(4, "0")}`;
  const mine = prov.filter((x) => x.rail === "twilio" && x.op === "message" && x.from === number);
  for (const m of mine) {
    if (m.fail) { audit.smsRefusedByCarrier++; continue; }
    audit.smsDelivered++;
    const to = String(m.to).replace(/\D/g, "").slice(-10);
    const zone = AREA_ZONE[to.slice(0, 3)];
    if (zone) { const h = localHour(zone, new Date(m.ts)); if (h < 8 || h >= 21) audit.quietHours.push({ org: o.slug, to: to.slice(0, 3) + "…", zone, ts: m.ts, localHour: +h.toFixed(2) }); }
    if (!/stop|opt.?out/i.test(String(m.body ?? ""))) audit.noOptOutLanguage++;
    const opt = (o.optedOut ?? []).find((x: any) => String(x.phone ?? "").replace(/\D/g, "").slice(-10) === to);
    if (opt && new Date(m.ts) > new Date(opt.at)) audit.smsAfterOptOut.push({ org: o.slug, n: o.n, how: opt.how, optedOutWeek: opt.week, ts: m.ts, bodyHasStop: /stop/i.test(String(m.body)) });
  }
}
// carrier-refused sends to STOP'd numbers are still ATTEMPTS the product made after an opt-out
const attemptsAfterStop = orgs.reduce((a, o) => a + prov.filter((x) => x.rail === "twilio" && x.op === "message" && x.from === `+1500555${String(o.orgId).padStart(4, "0")}` && x.fail).length, 0);
for (const v of audit.smsAfterOptOut) {
  const o = bySlug.get(v.org);
  const tenureWeek = Math.max(v.optedOutWeek, 1) + 1; // the violating send happens in a later week
  events.push({ org: v.org, n: o.n, orgId: o.orgId, persona: o.kind, tenureWeek, cls: "compliance_event", key: "sms-after-optout", what: `Marketing SMS delivered to a seller who had opted out (${v.how})`, evidence: `${v.ts}`, legalBasis: "47 U.S.C. §227(b)(3): $500 per message, up to $1,500 if willful", legalExposureUsd: 500, minutes: RUBRIC_MINUTES.compliance_event, fromAudit: true });
}
for (const v of audit.quietHours) {
  const o = bySlug.get(v.org);
  events.push({ org: v.org, n: o.n, orgId: o.orgId, persona: o.kind, tenureWeek: 1, cls: "compliance_event", key: "quiet-hours", what: "SMS delivered outside 8am–9pm recipient local time", evidence: `${v.ts} ${v.zone} ${v.localHour}`, legalExposureUsd: 500, minutes: RUBRIC_MINUTES.compliance_event, fromAudit: true });
}

// ── 2. owner hours / week ────────────────────────────────────────────────────
const excluded: Record<string, number> = {};
const keep = events.filter((e) => {
  const ev = String(e.evidence ?? "");
  if (/stripe\/checkout|credits\/purchase|subscription\/cancel/.test(String(e.what)) || /No active subscription to cancel/.test(ev)) { excluded["env-gap (Stripe unconfigured)"] = (excluded["env-gap (Stripe unconfigured)"] ?? 0) + 1; return false; }
  if (/402 Insufficient credits/.test(ev) && e.tenureWeek > 2) { excluded["trial $5 cap 402 after week 2 (real clock never advanced)"] = (excluded["trial $5 cap 402 after week 2 (real clock never advanced)"] ?? 0) + 1; return false; }
  return true;
});
// reclassify: POST /api/import/notes answered by the API 404 fallback is a broken feature, not a self-serve refusal
for (const e of keep) if (e.key === "notes-import") e.cls = "refusal_no_next_step";
const ticket = new Map<string, any>();
// SILENT failures are discovered, not reported per occurrence: a customer whose
// postcards keep going to the vacant parcel writes in once a month, not weekly.
const SILENT = new Set(["silent_noop", "wrong_money_number", "billing_dispute"]);
const period = (e: any) => (SILENT.has(e.cls) ? `m${Math.min(3, Math.ceil(e.tenureWeek / 4.34))}` : `w${e.tenureWeek}`);
for (const e of keep) { const k = `${e.org}|${e.key ?? e.what}|${period(e)}`; if (!ticket.has(k)) ticket.set(k, e); }
const tickets = [...ticket.values()];
const minutesOf = (e: any) => RUBRIC_MINUTES[e.cls as BurdenClass] ?? 0;
const bands: Record<string, any> = {};
for (const N of [3, 10, 25]) {
  const curve = CURVES[N];
  const weeks = Array.from({ length: 13 }, () => ({ minutes: 0, events: 0, byClass: {} as Record<string, number>, customers: 0 }));
  for (const e of tickets) {
    if (!e.n || e.n > N) continue;
    const cal = Math.floor((curve[e.n - 1] + 7 * (e.tenureWeek - 1)) / 7) + 1;
    if (cal < 1 || cal > 13) continue;
    const w = weeks[cal - 1];
    w.minutes += minutesOf(e); w.events++; w.byClass[e.cls] = (w.byClass[e.cls] ?? 0) + minutesOf(e);
  }
  weeks.forEach((w, i) => (w.customers = curve.filter((d) => d <= i * 7 + 6).length));
  bands[N] = { arrival: curve, weeks: weeks.map((w, i) => ({ week: i + 1, customers: w.customers, ownerHours: +(w.minutes / 60).toFixed(1), tickets: w.events, byClassHours: Object.fromEntries(Object.entries(w.byClass).map(([k, v]) => [k, +(v / 60).toFixed(1)])) })) };
}
const byKey: Record<string, { cls: string; tickets: number; hours: number; orgs: Set<string>; legal: number; money: number; what: string }> = {};
for (const e of tickets) {
  const k = e.key ?? e.what;
  const b = (byKey[k] ??= { cls: e.cls, tickets: 0, hours: 0, orgs: new Set(), legal: 0, money: 0, what: e.what });
  b.tickets++; b.hours += minutesOf(e) / 60; b.orgs.add(e.org); b.legal += e.legalExposureUsd ?? 0; b.money += e.moneyUsd ?? 0;
}
const topIssues = Object.entries(byKey).map(([k, v]) => ({ key: k, cls: v.cls, what: v.what, tickets: v.tickets, ownerHours: +v.hours.toFixed(1), orgs: v.orgs.size, legalExposureUsd: v.legal, moneyUsd: +v.money.toFixed(2) })).sort((a, b) => b.ownerHours - a.ownerHours);

// ── 3. unit economics ────────────────────────────────────────────────────────
const ids = orgs.map((o) => o.orgId);
const ledger = await q(`SELECT organization_id AS org, category, count(*)::int n, sum(amount_cents)::int cents FROM financial_ledger WHERE organization_id = ANY($1) GROUP BY 1,2`, [ids]);
const tel = await q(`SELECT organization_id AS org, count(*)::int n, coalesce(sum(estimated_cost_cents),0)::float cents FROM ai_telemetry_events WHERE organization_id = ANY($1) GROUP BY 1`, [ids]);
const debits = await q(`SELECT organization_id AS org, coalesce(sum(abs(amount_cents)),0)::int cents FROM credit_transactions WHERE organization_id = ANY($1) AND type='debit' GROUP BY 1`, [ids]);
const topups = L(join(COHORT, "cohort-topups.jsonl"));
const lobPieces = (o: any) => prov.filter((x) => x.rail === "lob" && /POST/.test(x.op) && new RegExp(`^(Market|Main) ${o.n}( |$)`).test(String(x.fromName ?? ""))).length;
const MONTHS = 3; // 13 tenure weeks
const perOrg = orgs.map((o) => {
  const tierPrice = (TIER_PRICES_CENTS as any)[o.tier]?.priceMonthlyCents ?? null;
  const led = ledger.filter((r: any) => r.org === o.orgId);
  const ledgerCogsCents = -led.reduce((a: number, r: any) => a + Math.min(0, r.cents), 0);
  const aiTelCents = tel.find((r: any) => r.org === o.orgId)?.cents ?? 0;
  const credPurchasedCents = 5000 + topups.filter((t: any) => t.org === o.slug).reduce((a: number, t: any) => a + t.cents, 0);
  const pieces = lobPieces(o);
  return {
    n: o.n, tier: o.tier, tierPriceCents: tierPrice,
    creditsPurchasedCents: credPurchasedCents, creditsConsumedCents: debits.find((r: any) => r.org === o.orgId)?.cents ?? 0,
    meteredLedger: Object.fromEntries(led.map((r: any) => [r.category, { rows: r.n, cents: r.cents }])),
    meteredLedgerCogsCents: ledgerCogsCents, aiTelemetryCents: +aiTelCents.toFixed(2),
    lobPiecesOnPlatformRail: pieces, lobCostMetered: led.some((r: any) => r.category === "mail"),
  };
});
const STRIPE = { pct: 0.029, fixedCents: 30, source: "Stripe standard US card pricing (public list price) — ASSUMPTION, not in repo" };
const fixedMonthlyUsd = Object.values(FIXED_COST_INPUTS_USD_MONTHLY).reduce((a, b) => a + b, 0);
const tierEcon: Record<string, any> = {};
for (const t of ["starter", "pro", "scale"]) {
  const g = perOrg.filter((o) => o.tier === t);
  if (!g.length) continue;
  const avg = (f: (o: any) => number) => g.reduce((a, o) => a + f(o), 0) / g.length / MONTHS;
  const price = g[0].tierPriceCents;
  const credRev = avg((o) => o.creditsPurchasedCents);
  const meteredCogs = avg((o) => o.meteredLedgerCogsCents);
  const aiTel = avg((o) => o.aiTelemetryCents);
  const pieces = avg((o) => o.lobPiecesOnPlatformRail);
  const revenue = price + credRev;
  const stripeFees = (price ? price * STRIPE.pct + STRIPE.fixedCents : 0) + credRev * STRIPE.pct + (credRev > 0 ? STRIPE.fixedCents : 0);
  tierEcon[t] = {
    orgs: g.length, planPriceUsd: price / 100, creditPurchasesUsdPerMonth: +(credRev / 100).toFixed(2), revenueUsdPerMonth: +(revenue / 100).toFixed(2),
    metered: { financialLedgerCogsUsd: +(meteredCogs / 100).toFixed(2), aiTelemetryUsd: +(aiTel / 100).toFixed(2), note: "ledger = what /founder/unit-economics reads; telemetry = per-call estimate. They disagree — see summary." },
    notMetered: { lobPostcardsPerMonth: +pieces.toFixed(1), lobCost: "NOT METERED (no financial_ledger 'mail' rows for any piece)", infra: "fixed only", paymentProcessing: "not netted (DEFECT-0133 in unitEconomics.ts)" },
    estimate: {
      lobAt75c: +(pieces * 0.75).toFixed(2), lobAt75cSource: "assumes Lob costs AcreOS what AcreOS charges (CREDIT_COSTS direct_mail 75¢) — pass-through, zero margin; Lob's real price is not in the repo",
      stripeFeesUsd: +(stripeFees / 100).toFixed(2), stripeSource: STRIPE.source,
    },
  };
}
const bandEcon: Record<string, any> = {};
for (const N of [3, 10, 25]) {
  const g = perOrg.filter((o) => o.n <= N);
  const sum = (f: (o: any) => number) => g.reduce((a, o) => a + f(o), 0) / MONTHS;
  const sub = sum((o) => o.tierPriceCents * MONTHS) / 100; // month-3 steady state: every org in the band paying
  const cred = sum((o) => o.creditsPurchasedCents) / 100;
  const metered = sum((o) => o.meteredLedgerCogsCents) / 100;
  const aiTel = sum((o) => o.aiTelemetryCents) / 100;
  const lob = sum((o) => o.lobPiecesOnPlatformRail) * 0.75;
  const stripe = (sub + cred) * STRIPE.pct + (STRIPE.fixedCents / 100) * g.length * 2;
  const revenue = sub + cred;
  const cogsMeteredOnly = metered + fixedMonthlyUsd;
  const cogsWithEstimates = Math.max(metered, aiTel) + lob + stripe + fixedMonthlyUsd;
  bandEcon[N] = { customers: N, revenueUsdPerMonth: +revenue.toFixed(2), subscriptionUsd: +sub.toFixed(2), creditPurchasesUsd: +cred.toFixed(2), fixedUsd: fixedMonthlyUsd, meteredVariableUsd: +metered.toFixed(2), aiTelemetryUsd: +aiTel.toFixed(2), estLobUsd: +lob.toFixed(2), estStripeUsd: +stripe.toFixed(2), grossMarginMeteredOnlyPct: +(100 * (revenue - cogsMeteredOnly) / revenue).toFixed(1), grossMarginWithEstimatesPct: +(100 * (revenue - cogsWithEstimates) / revenue).toFixed(1), subscriptionOnlyMarginPct: +(100 * (sub - Math.max(metered, aiTel) - fixedMonthlyUsd - sub * STRIPE.pct) / sub).toFixed(1) };
}

const summary = {
  rubricMinutes: RUBRIC_MINUTES, dedupeRule: "one org × issue key × tenure week = one ticket; silent classes: one per org × issue × tenure month", excluded,
  audit: { smsDelivered: audit.smsDelivered, smsRefusedByCarrier: audit.smsRefusedByCarrier, attemptsToCarrierBlockedNumbers: attemptsAfterStop, smsAfterOptOut: audit.smsAfterOptOut.length, smsAfterOptOutByHow: audit.smsAfterOptOut.reduce((m: any, v) => ((m[v.how] = (m[v.how] ?? 0) + 1), m), {}), quietHoursViolations: audit.quietHours.length, quietHoursExamples: audit.quietHours.slice(0, 5), smsWithoutOptOutLanguage: audit.noOptOutLanguage },
  ownerHoursPerWeek: Object.fromEntries(Object.entries(bands).map(([N, b]: any) => [N, b.weeks.map((w: any) => w.ownerHours)])),
  bands, topIssues: topIssues.slice(0, 25),
  economics: { perTier: tierEcon, perBand: bandEcon, fixedCostsSource: "shared/schema.ts FIXED_COST_INPUTS_USD_MONTHLY", months: MONTHS, perOrg },
  stepsTotal: steps.length,
};
writeJson("burden-summary.json", summary);
console.log("owner hours/week (weeks 1..13):");
for (const N of [3, 10, 25]) console.log(`  ${String(N).padStart(2)} customers: ${bands[N].weeks.map((w: any) => w.ownerHours).join(" ")}`);
console.log("excluded", JSON.stringify(excluded));
console.log("audit", JSON.stringify(summary.audit));
console.log("top issues"); for (const t of topIssues.slice(0, 15)) console.log(`  ${t.ownerHours.toString().padStart(6)} h  ${String(t.tickets).padStart(4)} tickets  ${t.orgs} orgs  ${t.cls.padEnd(22)} ${t.key}`);
console.log("economics per tier", JSON.stringify(tierEcon, null, 1));
console.log("economics per band", JSON.stringify(bandEcon, null, 1));
process.exit(0);
