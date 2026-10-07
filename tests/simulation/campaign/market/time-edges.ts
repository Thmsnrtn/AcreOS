/**
 * TIME EDGES — DST transitions, month-end and recipient-vs-org time zones,
 * evaluated IN-PROCESS against the product's own functions with an EXPLICIT
 * clock (the global Date is swapped for the duration of each evaluation), so
 * every verdict is about a stated instant, never "whenever the sim ran".
 *
 *  A. SMS quiet hours (8:00–21:00 recipient local): isWithinQuietHours() for a
 *     phone in each of 10 real area codes, swept every 15 min across the 2026
 *     spring-forward (Mar 8) and fall-back (Nov 1) weekends, with and without
 *     an explicit lead.timezone. Ground truth = the area code's real zone. A
 *     "false allow" is a send the product permits inside quiet hours.
 *  B. Late-fee grace (shouldAssessLateFee, the §1026.36(c)(2) rule): a payment
 *     made on the LAST local day of grace, late evening, in each US zone —
 *     does the UTC day arithmetic call it late? Plus month-end due dates.
 *  C. Campaign "Schedule" date (campaigns-content.tsx): the client's own
 *     `new Date(e.target.value)` + `format(d, 'PPP')` round-trip, run in a child
 *     process per TZ — what date does the customer see after picking one?
 *     And: is there any server-side executor for campaigns.scheduledDate?
 *
 * Results → MARKET_OUT/time-edges.json.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJson } from "./common";
import { isWithinQuietHours, resolveZoneForPhone } from "../../../../server/services/tcpaCompliance";
import { shouldAssessLateFee } from "../../../../server/services/lateFees";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../../..");
const RealDate = Date;
function atClock<T>(iso: string, fn: () => T): T {
  const fixed = new RealDate(iso).getTime();
  class Fake extends RealDate {
    constructor(...a: any[]) { if (a.length === 0) super(fixed); else super(...(a as [any])); }
    static now() { return fixed; }
  }
  (globalThis as any).Date = Fake;
  try { return fn(); } finally { (globalThis as any).Date = RealDate; }
}
function localHour(zone: string, t: Date) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(t);
  const h = Number(p.find((x) => x.type === "hour")!.value) % 24, m = Number(p.find((x) => x.type === "minute")!.value);
  return h + m / 60;
}

// ── A ──
const PHONES: Array<[string, string, string]> = [
  ["+12135550100", "America/Los_Angeles", "Los Angeles"], ["+12125550100", "America/New_York", "New York"],
  ["+13125550100", "America/Chicago", "Chicago"], ["+16025550100", "America/Phoenix", "Phoenix (no DST)"],
  ["+13035550100", "America/Denver", "Denver"], ["+18085550100", "Pacific/Honolulu", "Honolulu"],
  ["+19075550100", "America/Anchorage", "Anchorage"], ["+17875550100", "America/Puerto_Rico", "San Juan"],
  ["+19455550100", "America/Chicago", "Dallas overlay 945 (2021)"], ["+17265550100", "America/Chicago", "San Antonio overlay 726 (2023)"],
];
const WINDOWS = [["2026-03-07T00:00:00Z", "2026-03-10T00:00:00Z"], ["2026-10-31T00:00:00Z", "2026-11-03T00:00:00Z"]];
const quiet: any[] = [];
for (const [phone, zone, label] of PHONES) {
  const inferred = resolveZoneForPhone(phone);
  for (const withTz of [false, true]) {
    let falseAllow = 0, overBlock = 0, samples = 0;
    const examples: string[] = [];
    for (const [a, b] of WINDOWS) {
      for (let t = new RealDate(a).getTime(); t < new RealDate(b).getTime(); t += 15 * 60_000) {
        const iso = new RealDate(t).toISOString();
        const r = atClock(iso, () => isWithinQuietHours(phone, withTz ? zone : null));
        const lh = localHour(zone, new RealDate(t));
        const truthBlocked = lh < 8 || lh >= 21;
        samples++;
        if (!r.blocked && truthBlocked) { falseAllow++; if (examples.length < 3) examples.push(`${iso} allowed; ${label} local ${Math.floor(lh)}:${String(Math.round((lh % 1) * 60)).padStart(2, "0")}`); }
        if (r.blocked && !truthBlocked) overBlock++;
      }
    }
    quiet.push({ phone, label, trueZone: zone, inferredZone: inferred.zone, inferred: inferred.inferred, leadTimezoneSet: withTz, samples, falseAllow, overBlock, examples });
  }
}

// ── B ──
const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];
function zonedInstant(ymd: string, hh: number, mm: number, zone: string): Date {
  // the UTC instant whose wall clock in `zone` is ymd hh:mm
  let guess = new RealDate(`${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`).getTime();
  for (let i = 0; i < 3; i++) { const lh = localHour(zone, new RealDate(guess)); const want = hh + mm / 60; let d = want - lh; if (d > 12) d -= 24; if (d < -12) d += 24; guess += d * 3600_000; }
  return new RealDate(guess);
}
const grace: any[] = [];
const cases = [
  { name: "due Mar 1, grace 10 — paid Mar 11 (last grace day, spans spring-forward)", due: "2026-03-01", graceDays: 10, payDay: "2026-03-11" },
  { name: "due Oct 25, grace 10 — paid Nov 4 (spans fall-back)", due: "2026-10-25", graceDays: 10, payDay: "2026-11-04" },
  { name: "due Jan 31, grace 5 — paid Feb 5", due: "2026-01-31", graceDays: 5, payDay: "2026-02-05" },
];
for (const c of cases) for (const z of ZONES) for (const [hh, mm] of [[9, 0], [19, 30], [23, 30]]) {
  const evaluationDate = zonedInstant(c.payDay, hh, mm, z);
  const r = shouldAssessLateFee({ dueDate: new RealDate(`${c.due}T00:00:00Z`), gracePeriodDays: c.graceDays, periodicPaymentAmountCents: 38003, amountCreditedToCycleCents: 0, evaluationDate, configuredLateFeeCents: 2500, periodStart: new RealDate(`${c.due}T00:00:00Z`) } as any);
  grace.push({ case: c.name, zone: z, localTime: `${c.payDay} ${hh}:${String(mm).padStart(2, "0")}`, evaluationUtc: evaluationDate.toISOString(), feeAssessed: r.shouldAssess, borrowerLocallyInGrace: true });
}
const graceFalseFees = grace.filter((g) => g.feeAssessed);

// ── C ──
const scheduled: any[] = [];
for (const tz of ["America/New_York", "America/Chicago", "America/Los_Angeles", "Pacific/Honolulu", "UTC"]) {
  const out = execFileSync(process.execPath, ["-e", `const {format}=require("date-fns");const picks=["2026-03-08","2026-11-01","2026-12-31"];console.log(JSON.stringify(picks.map(p=>({picked:p,shown:format(new Date(p),"PPP"),stored:new Date(p).toISOString()}))))`], { cwd: ROOT, env: { ...process.env, TZ: tz } }).toString();
  scheduled.push({ tz, rows: JSON.parse(out) });
}
// any executor for campaigns.scheduledDate? scan server/ (comment-insensitive enough: we want ANY reader)
function walk(d: string, acc: string[] = []) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, acc); else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f)) acc.push(p); } return acc; }
const readers = walk(join(ROOT, "server")).filter((f) => /campaigns\.scheduledDate|scheduled_date/.test(readFileSync(f, "utf8"))).map((f) => f.replace(ROOT + "/", ""));

const summary = {
  quietHours: { rows: quiet, falseAllowTotal: quiet.reduce((a, r) => a + r.falseAllow, 0), falseAllowWithoutLeadTz: quiet.filter((r) => !r.leadTimezoneSet).reduce((a, r) => a + r.falseAllow, 0), falseAllowWithLeadTz: quiet.filter((r) => r.leadTimezoneSet).reduce((a, r) => a + r.falseAllow, 0) },
  lateFeeGrace: { evaluated: grace.length, falseFees: graceFalseFees.length, examples: graceFalseFees.slice(0, 8) },
  campaignSchedule: { roundTrip: scheduled, serverReadersOfScheduledDate: readers },
};
writeJson("time-edges.json", summary);
console.log(JSON.stringify({ quiet: quiet.filter((r) => r.falseAllow || r.overBlock).map((r) => `${r.label} tz=${r.leadTimezoneSet} inferred=${r.inferredZone}${r.inferred ? "(guess)" : ""} falseAllow=${r.falseAllow} overBlock=${r.overBlock}`), graceFalseFees: graceFalseFees.length + "/" + grace.length, graceEx: graceFalseFees.slice(0, 3).map((g) => `${g.zone} ${g.localTime}`), schedule: scheduled.map((s) => `${s.tz}: ${s.rows.map((r: any) => `${r.picked}→${r.shown}`).join(", ")}`), readers }, null, 1));
process.exit(0);
