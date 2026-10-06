/**
 * MESSY LIST IMPORTS — six lead lists shaped like what land investors actually
 * download (county parcel exports, list-broker exports, a tax-delinquent roll,
 * a skip-traced return, and a 5,000-row file), pushed through EVERY import path
 * a customer can reach in the UI, with the generated ground truth as the
 * oracle.
 *
 *   path A  Leads → "Import CSV" sheet (CsvImportSheet.tsx): the CLIENT parses
 *           and auto-maps headers, then POSTs /api/leads/csv-import. This sim
 *           runs the client's OWN `parseCsv` + `suggestField` (extracted from
 *           the .tsx and transpiled at run time), so the mapping measured is
 *           the shipped mapping, not a re-implementation.
 *   path B  Leads page legacy import: multipart /api/leads/import (fixed headers)
 *   path C  Onboarding / Data import: multipart /api/import/leads (job > 500 rows)
 *
 * Measured per fixture × path: rows in file, leads persisted, what the response
 * reported, rows silently dropped (neither persisted nor reported), duplicates
 * of the same owner, wrong field mapping (situs address stored as the mailing
 * address, LAST-FIRST county names greeted by surname, APNs mangled by Excel,
 * ZIPs that lost their leading zero, phones present in the file but not
 * stored, list-broker DNC flags ignored), wall time, and the message shown.
 *
 *   SIM_BASE_URL=… DATABASE_URL=… MARKET_OUT=… npx tsx tests/simulation/campaign/market/csv-imports.ts
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { OUT, q, count, provisionOrg, msg, jsonl, writeJson, burden, rnd, reseed, type Org } from "./common";
import { recordMetric, recordSkip } from "../ledger";

const SIM = "market-csv-imports";
const HERE = dirname(fileURLToPath(import.meta.url));
const SHEET = join(HERE, "../../../../client/src/components/leads/CsvImportSheet.tsx");
const FIX_DIR = join(OUT, "fixtures");
mkdirSync(FIX_DIR, { recursive: true });

// ─── the client's own parser + header heuristic ─────────────────────────────
function extractFn(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`CsvImportSheet.tsx no longer declares ${name}() — the extraction must be updated, not skipped`);
  // Both signatures are one line; the body opens at the LAST "{" on it (the
  // parseCsv return type itself contains braces).
  const eol = src.indexOf("\n", start);
  const open = src.lastIndexOf("{", eol);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    const ch = src[j];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error(`could not find the end of ${name}()`);
}
const sheetSrc = readFileSync(SHEET, "utf8");
const clientCode = transformSync(
  `${extractFn(sheetSrc, "suggestField")}\n${extractFn(sheetSrc, "parseCsv")}\nmodule.exports = { suggestField, parseCsv };`,
  { loader: "ts", format: "cjs" },
).code;
const clientMod: any = { exports: {} };
new Function("module", "exports", clientCode)(clientMod, clientMod.exports);
const { suggestField, parseCsv } = clientMod.exports as {
  suggestField: (h: string) => string;
  parseCsv: (t: string) => { headers: string[]; rows: string[][] };
};
// vacuity guard: the extracted functions must behave like the shipped sheet on
// the shapes its own header comment promises.
if (suggestField("Parcel #") !== "apn" || suggestField("Owner Mailing Address") !== "address") throw new Error("extracted suggestField does not behave like the shipped heuristic");

// ─── realistic data ─────────────────────────────────────────────────────────
const SURNAMES = ["SMITH", "JOHNSON", "GARCIA", "MARTINEZ", "BROWN", "LOPEZ", "HERNANDEZ", "DAVIS", "MILLER", "WILSON", "ANDERSON", "TAYLOR", "THOMAS", "MOORE", "JACKSON", "WHITE", "HARRIS", "CLARK", "LEWIS", "YOUNG", "NGUYEN", "O'BRIEN", "MCDONALD", "DE LA CRUZ", "VAN DYKE"];
const GIVEN = ["JOHN", "MARY", "ROBERT", "PATRICIA", "JAMES", "LINDA", "MICHAEL", "BARBARA", "DAVID", "ELIZABETH", "WILLIAM", "JENNIFER", "RICHARD", "MARIA", "JOSE", "SUSAN", "CHARLES", "MARGARET", "DANIEL", "DOROTHY"];
const ENTITY = ["SUNRISE LAND HOLDINGS LLC", "DESERT VIEW TRUST", "HIGH PLAINS INVESTMENTS INC", "ESTATE OF %S %G", "%S FAMILY TRUST", "%S %G TR", "%S LIVING TRUST"];
const MAIL_STATES: Array<[string, string, string, string]> = [ // state, city, zip, area code — absentee owners live everywhere
  ["CA", "LOS ANGELES", "90012", "213"], ["TX", "HOUSTON", "77002", "713"], ["IL", "CHICAGO", "60601", "312"], ["NJ", "NEWARK", "07102", "973"], ["MA", "BOSTON", "02108", "617"],
  ["FL", "MIAMI", "33101", "305"], ["AZ", "PHOENIX", "85004", "602"], ["WA", "SEATTLE", "98101", "206"], ["CO", "DENVER", "80202", "303"], ["NY", "BUFFALO", "14202", "716"], ["CT", "HARTFORD", "06103", "860"],
];
const COUNTIES: Array<{ state: string; county: string; apn: (i: number) => string; city: string; zip: string }> = [
  { state: "AZ", county: "COCHISE", apn: (i) => `${100 + (i % 80)}-${String(10 + (i % 89)).padStart(2, "0")}-${String(i % 997).padStart(3, "0")}${i % 7 === 0 ? "A" : ""}`, city: "WILLCOX", zip: "85643" },
  { state: "AZ", county: "MOHAVE", apn: (i) => `${300 + (i % 60)}-${String(i % 99).padStart(2, "0")}-${String(i % 499).padStart(3, "0")}`, city: "KINGMAN", zip: "86401" },
  { state: "NM", county: "LUNA", apn: (i) => `3-0${String(10 + (i % 80)).padStart(2, "0")}-${String(100 + (i % 899))}-${String(i % 400).padStart(3, "0")}`, city: "DEMING", zip: "88030" },
  { state: "TX", county: "HUDSPETH", apn: (i) => `R${String(1000 + i).padStart(6, "0")}`, city: "SIERRA BLANCA", zip: "79851" },
  { state: "CO", county: "COSTILLA", apn: (i) => `70${String(1000000 + i * 37).slice(0, 7)}`, city: "SAN LUIS", zip: "81152" },
];

interface Truth {
  row: number;
  ownerRaw: string; // as written on the list
  givenName: string; // the truth: who the person is
  surname: string;
  entity: boolean;
  mailAddr: string; mailCity: string; mailState: string; mailZip: string;
  situsAddr: string; situsCity: string; situsState: string; situsZip: string;
  county: string; state: string; apn: string; // canonical apn as the county writes it
  phones: string[]; email: string | null; dnc: boolean;
  ownerKey: string; // same human across rows
}
function person(i: number) {
  const s = SURNAMES[Math.floor(rnd() * SURNAMES.length)];
  const g = GIVEN[Math.floor(rnd() * GIVEN.length)];
  const g2 = GIVEN[Math.floor(rnd() * GIVEN.length)];
  const roll = rnd();
  if (roll < 0.14) {
    const e = ENTITY[Math.floor(rnd() * ENTITY.length)].replace("%S", s).replace("%G", g);
    return { ownerRaw: e, given: "", surname: e, entity: true };
  }
  if (roll < 0.34) return { ownerRaw: `${s} ${g} & ${g2}`, given: g, surname: s, entity: false };
  return { ownerRaw: `${s} ${g}${rnd() < 0.3 ? " " + "ABCDEFGHJKLMNPRSTW"[i % 18] : ""}`, given: g, surname: s, entity: false };
}
function makeTruth(n: number, seedN: number, opts: { dupOwnerEvery?: number; phoneRate?: number; emailRate?: number; dncRate?: number }): Truth[] {
  reseed(seedN);
  const out: Truth[] = [];
  for (let i = 0; i < n; i++) {
    const c = COUNTIES[i % COUNTIES.length];
    const dupOf = opts.dupOwnerEvery && i > 0 && i % opts.dupOwnerEvery === 0 ? out[Math.floor(rnd() * out.length)] : null;
    const p = dupOf ? { ownerRaw: dupOf.ownerRaw, given: dupOf.givenName, surname: dupOf.surname, entity: dupOf.entity } : person(i);
    const m = dupOf ? null : MAIL_STATES[Math.floor(rnd() * MAIL_STATES.length)];
    const ac = m?.[3] ?? "602";
    const phones: string[] = [];
    if (!dupOf && rnd() < (opts.phoneRate ?? 0)) phones.push(`(${ac}) 555-${String(1000 + ((i * 7919) % 9000)).padStart(4, "0")}`);
    if (phones.length && rnd() < 0.35) phones.push(`${ac}-556-${String(1000 + ((i * 104729) % 9000)).padStart(4, "0")}`);
    out.push({
      row: i + 1, ownerRaw: p.ownerRaw, givenName: p.given, surname: p.surname, entity: p.entity,
      mailAddr: dupOf ? dupOf.mailAddr : `${100 + ((i * 37) % 9800)} ${["N MAIN ST", "E ELM AVE", "W OAK DR", "PO BOX " + (1000 + i), "S 4TH ST APT 2"][i % 5]}`,
      mailCity: dupOf ? dupOf.mailCity : m![1], mailState: dupOf ? dupOf.mailState : m![0], mailZip: dupOf ? dupOf.mailZip : m![2],
      situsAddr: i % 3 === 0 ? "" : `${1000 + i} ${["CHOLLA RD", "SAGE LN", "MESA TRL", "JUNIPER WAY"][i % 4]}`,
      situsCity: c.city, situsState: c.state, situsZip: c.zip,
      county: c.county, state: c.state, apn: c.apn(i),
      phones: dupOf ? dupOf.phones : phones,
      email: dupOf ? dupOf.email : rnd() < (opts.emailRate ?? 0) ? `${p.surname.replace(/[^A-Z]/g, "").toLowerCase()}${i}@example.net` : null,
      dnc: phones.length > 0 && rnd() < (opts.dncRate ?? 0),
      ownerKey: dupOf ? dupOf.ownerKey : `${p.ownerRaw}|${i}`,
    });
  }
  return out;
}

const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
function toCsv(headers: string[], rows: string[][], opts: { bom?: boolean; crlf?: boolean } = {}) {
  const nl = opts.crlf ? "\r\n" : "\n";
  return (opts.bom ? "\uFEFF" : "") + [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join(nl) + nl;
}
/** what Excel does to a long numeric APN when the list was opened and re-saved */
const excelMangle = (apn: string) => {
  const digits = apn.replace(/\D/g, "");
  return digits.length >= 11 ? (Number(digits) / 10 ** (digits.length - 1)).toFixed(2) + "E+" + (digits.length - 1) : digits.replace(/^0+/, "");
};

interface Fixture { name: string; file: string; truth: Truth[]; describe: string; mangledApn: Set<number> }
function buildFixtures(): Fixture[] {
  const fx: Fixture[] = [];
  { // 1. county parcel export (Cochise-style): BOM, CRLF, UPPER, LAST FIRST, mailing + situs, no phones
    const t = makeTruth(420, 11, { dupOwnerEvery: 9 });
    const h = ["PARCEL_NUM", "OWNER_NAME", "MAIL_ADDR1", "MAIL_CITY", "MAIL_STATE", "MAIL_ZIP", "SITUS_ADDR", "SITUS_CITY", "SITUS_ZIP", "COUNTY", "ACRES", "LAND_USE"];
    const rows = t.map((r, i) => [r.apn + (i % 11 === 0 ? "  " : ""), r.ownerRaw + (i % 13 === 0 ? " " : ""), r.mailAddr, r.mailCity, r.mailState, r.mailZip, r.situsAddr, r.situsCity, r.situsZip, r.county, (1 + (i % 40) * 1.25).toFixed(2), "VACANT RESIDENTIAL"]);
    writeFileSync(join(FIX_DIR, "01-county-parcel-export.csv"), toCsv(h, rows, { bom: true, crlf: true }));
    fx.push({ name: "county-parcel-export", file: "01-county-parcel-export.csv", truth: t, describe: "county assessor export: BOM+CRLF, LAST FIRST owners, mailing vs situs, no phones, 420 rows", mangledApn: new Set() });
  }
  { // 2. list-broker vacant-land export (ListSource-style): split owner names, APN with spaces, Excel-mangled APNs, zips lost leading zero
    const t = makeTruth(380, 22, { dupOwnerEvery: 12, phoneRate: 0.45, emailRate: 0.15 });
    const mangled = new Set<number>();
    const h = ["Owner 1 First Name", "Owner 1 Last Name", "Mailing Address", "Mailing City", "Mailing State", "Mailing Zip", "Property Address", "Property City", "Property State", "Property Zip", "APN", "County", "Lot Acreage", "Phone 1", "Phone 2", "Email"];
    const rows = t.map((r, i) => {
      let apn = r.apn;
      if (i % 6 === 0) apn = apn.replace(/-/g, " ");
      if (r.county === "COSTILLA" && i % 2 === 0) { apn = excelMangle(r.apn); mangled.add(i); }
      const zip = i % 8 === 0 ? r.mailZip.replace(/^0+/, "") : r.mailZip;
      return [r.entity ? "" : titleCase(r.givenName), titleCase(r.surname), r.mailAddr, titleCase(r.mailCity), r.mailState, zip, r.situsAddr, titleCase(r.situsCity), r.situsState, r.situsZip, apn, titleCase(r.county), String(1 + (i % 20)), r.phones[0] ?? "", r.phones[1] ?? "", r.email ?? ""];
    });
    writeFileSync(join(FIX_DIR, "02-list-broker-vacant-land.csv"), toCsv(h, rows, { crlf: true }));
    fx.push({ name: "list-broker-vacant-land", file: "02-list-broker-vacant-land.csv", truth: t, describe: "list-broker export: split names, APN spaces, 1.23E+11 APNs, 4-digit zips, 45% phones, 380 rows", mangledApn: mangled });
  }
  { // 3. PropStream-style: full-name owner, owner-mailing + property columns, mobile/landline
    const t = makeTruth(300, 33, { dupOwnerEvery: 10, phoneRate: 0.6, emailRate: 0.25 });
    const h = ["Owner 1 Full Name", "Owner Mailing Address", "Owner Mailing City", "Owner Mailing State", "Owner Mailing Zip", "Address", "City", "State", "Zip", "County", "APN", "Lot Size Sqft", "Mobile Phone 1", "Landline 1", "Email 1"];
    const rows = t.map((r, i) => [r.entity ? r.ownerRaw : `${titleCase(r.givenName)} ${titleCase(r.surname)}`, r.mailAddr, titleCase(r.mailCity), r.mailState, r.mailZip, r.situsAddr, titleCase(r.situsCity), r.situsState, r.situsZip, titleCase(r.county), r.apn, String(43560 * (1 + (i % 10))), r.phones[0] ?? "", r.phones[1] ?? "", r.email ?? ""]);
    writeFileSync(join(FIX_DIR, "03-propstream-style.csv"), toCsv(h, rows));
    fx.push({ name: "propstream-style", file: "03-propstream-style.csv", truth: t, describe: "PropStream-style: full-name owner, Owner Mailing vs Address columns, 60% phones, 300 rows", mangledApn: new Set() });
  }
  { // 4. tax-delinquent roll: combined "City State Zip", entities/estates/trusts
    const t = makeTruth(260, 44, { dupOwnerEvery: 7 });
    const h = ["Account #", "Parcel ID", "Owner", "Owner Address", "City State Zip", "Amount Due", "Years Delinquent", "County"];
    const rows = t.map((r, i) => [`ACCT-${20000 + i}`, r.apn, r.ownerRaw, r.mailAddr, `${r.mailCity} ${r.mailState} ${r.mailZip}`, `$${(200 + i * 13.37).toFixed(2)}`, String(1 + (i % 5)), r.county]);
    writeFileSync(join(FIX_DIR, "04-tax-delinquent-roll.csv"), toCsv(h, rows, { crlf: true }));
    fx.push({ name: "tax-delinquent-roll", file: "04-tax-delinquent-roll.csv", truth: t, describe: "tax-delinquent roll: combined City State Zip, estates/trusts/LLCs, 260 rows", mangledApn: new Set() });
  }
  { // 5. skip-traced return: phone types + DNC + litigator flags from the vendor
    const t = makeTruth(240, 55, { phoneRate: 0.9, emailRate: 0.4, dncRate: 0.22 });
    const h = ["First Name", "Last Name", "Mailing Address", "Mailing City", "Mailing State", "Mailing Zip", "Property Address", "Property County", "Property State", "APN", "Phone1", "Phone1 Type", "Phone1 DNC", "Phone2", "Phone2 Type", "Litigator", "Email1"];
    const rows = t.map((r, i) => [r.entity ? "" : titleCase(r.givenName), r.entity ? r.ownerRaw : titleCase(r.surname), r.mailAddr, titleCase(r.mailCity), r.mailState, r.mailZip, r.situsAddr, titleCase(r.county), r.state, r.apn, r.phones[0] ?? "", r.phones[0] ? (i % 3 ? "Wireless" : "Landline") : "", r.dnc ? "Y" : "N", r.phones[1] ?? "", r.phones[1] ? "Wireless" : "", i % 41 === 0 ? "Y" : "N", r.email ?? ""]);
    writeFileSync(join(FIX_DIR, "05-skip-traced-return.csv"), toCsv(h, rows));
    fx.push({ name: "skip-traced-return", file: "05-skip-traced-return.csv", truth: t, describe: "skip-trace vendor return: 90% phones, 22% flagged DNC by the vendor, litigator flags, 240 rows", mangledApn: new Set() });
  }
  { // 6. 5,000-row county pull: BOM, CRLF, trailing whitespace
    const t = makeTruth(5000, 66, { dupOwnerEvery: 15, phoneRate: 0.3, emailRate: 0.1 });
    const h = ["APN", "Owner Name", "Mailing Address", "Mailing City", "Mailing State", "Mailing Zip", "Situs Address", "County", "State", "Acres", "Phone"];
    const rows = t.map((r, i) => [r.apn, r.ownerRaw + (i % 17 === 0 ? "   " : ""), r.mailAddr, r.mailCity, r.mailState, r.mailZip, r.situsAddr, r.county, r.state, String(1 + (i % 30)), r.phones[0] ?? ""]);
    writeFileSync(join(FIX_DIR, "06-county-pull-5000.csv"), toCsv(h, rows, { bom: true, crlf: true }));
    fx.push({ name: "county-pull-5000", file: "06-county-pull-5000.csv", truth: t, describe: "5,000-row county pull: BOM+CRLF, trailing whitespace, 30% phones", mangledApn: new Set() });
  }
  return fx;
}
function titleCase(s: string) { return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()); }

// ─── oracle: compare what the DB holds with the truth ────────────────────────
const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
async function audit(org: Org, fx: Fixture) {
  const rows = await q(`SELECT first_name, last_name, address, city, state, zip, county, apn, phone, email, do_not_contact FROM leads WHERE organization_id=$1 AND deleted_at IS NULL`, [org.orgId]);
  const byApn = new Map<string, Truth>();
  for (const t of fx.truth) byApn.set(digits(t.apn), t);
  let situsAsMailing = 0, mixedAddressBlock = 0, mailingCorrect = 0, surnameGreeted = 0, entityOk = 0, apnMangled = 0, zipLostZero = 0, phoneDropped = 0, dncIgnored = 0, stateMissing = 0, countyMissing = 0, matched = 0;
  const examples: Record<string, string> = {};
  for (const r of rows) {
    const t = byApn.get(digits(r.apn)) ?? fx.truth.find((x) => norm(x.mailAddr) === norm(r.address) || norm(x.situsAddr) === norm(r.address));
    if (/E\+/i.test(r.apn ?? "")) { apnMangled++; examples.apnMangled ??= `stored apn "${r.apn}"`; }
    if (!t) continue;
    matched++;
    if (t.situsAddr && norm(r.address) === norm(t.situsAddr) && norm(t.situsAddr) !== norm(t.mailAddr)) { situsAsMailing++; examples.situsAsMailing ??= `owner ${t.ownerRaw}: stored address "${r.address}" (situs) — mailing is "${t.mailAddr}, ${t.mailCity} ${t.mailState}"`; }
    // The one question that decides whether a mailer reaches the owner: is the
    // stored address block (street, city, state, zip) the owner's MAILING address?
    if (norm(r.address) === norm(t.mailAddr) && norm(r.city) === norm(t.mailCity) && norm(r.state) === norm(t.mailState) && digits(r.zip) === digits(t.mailZip)) mailingCorrect++;
    else examples.wrongMailingBlock ??= `owner ${t.ownerRaw}: stored "${r.address ?? ""}, ${r.city ?? ""} ${r.state ?? ""} ${r.zip ?? ""}" — mailing is "${t.mailAddr}, ${t.mailCity} ${t.mailState} ${t.mailZip}"`;
    // the address block must be ONE place: mailing street with situs city/zip mails nowhere
    if (r.zip && t.situsZip !== t.mailZip && r.zip === t.situsZip && norm(r.address) !== norm(t.situsAddr)) { mixedAddressBlock++; examples.mixedAddressBlock ??= `street "${r.address}" + city/zip "${r.city} ${r.zip}" — mailing is ${t.mailCity} ${t.mailZip}, parcel is ${t.situsCity} ${t.situsZip}`; }
    if (!t.entity && norm(r.first_name) === norm(t.surname)) { surnameGreeted++; examples.surnameGreeted ??= `"${t.ownerRaw}" → firstName "${r.first_name}", lastName "${r.last_name}" — {{firstName}} greets the surname`; }
    if (t.entity && !r.first_name) entityOk++;
    if (r.zip && /^\d{4}$/.test(r.zip)) { zipLostZero++; examples.zipLostZero ??= `zip "${r.zip}" (${t.mailState})`; }
    if (t.phones.length && !r.phone) { phoneDropped++; examples.phoneDropped ??= `file phone ${t.phones[0]} → lead phone NULL`; }
    if (t.dnc && !r.do_not_contact) dncIgnored++;
    if (!r.state) stateMissing++;
    if (!r.county) countyMissing++;
  }
  const humans = new Set(fx.truth.map((t) => t.ownerKey)).size;
  const dupOwnerLeads = (await q(`SELECT count(*)::int n FROM (SELECT upper(coalesce(first_name,''))||'|'||upper(coalesce(last_name,''))||'|'||upper(coalesce(address,'')) k, count(*) c FROM leads WHERE organization_id=$1 AND deleted_at IS NULL GROUP BY 1 HAVING count(*)>1) x`, [org.orgId]))[0].n;
  const dncInFile = fx.truth.filter((t) => t.dnc).length;
  return { leadsInDb: rows.length, matched, humansInFile: humans, ownersWithMultipleLeads: dupOwnerLeads, situsAsMailing, mixedAddressBlock, mailingCorrect, surnameGreeted, entityOk, apnMangled, zipLostZero, phoneDropped, dncInFile, dncIgnored, stateMissing, countyMissing, examples };
}

// ─── the three import paths ─────────────────────────────────────────────────
async function viaSheet(org: Org, csv: string) {
  const { headers, rows } = parseCsv(csv);
  const mapping: Record<string, string> = {};
  for (const h of headers) mapping[h] = suggestField(h);
  const mapped = rows.map((r) => {
    const out: Record<string, string> = {};
    headers.forEach((h, i) => { const t = mapping[h]; if (t && t !== "skip" && r[i]) out[t] = r[i]; });
    return out;
  });
  const t0 = performance.now();
  const resp = await org.client.post("/api/leads/csv-import", { rows: mapped });
  return { resp, ms: performance.now() - t0, mapping, parsedRows: rows.length, toast: resp.status < 300 ? `Import complete: ${resp.body?.imported} imported · ${resp.body?.skippedExisting} skipped (existing APN) · ${resp.body?.skippedInvalid} invalid` : `Import failed: ${msg(resp)}` };
}
async function viaMultipart(org: Org, path: string, csv: string, file: string) {
  const fd = new FormData();
  fd.append("file", new Blob([csv], { type: "text/csv" }), file);
  const t0 = performance.now();
  const resp = await org.client.call("POST", path, undefined, { raw: fd as any });
  let job: any = null;
  if (resp.status === 202 && resp.body?.jobId) {
    for (let i = 0; i < 120; i++) {
      const j = await org.client.get(`/api/import/jobs/${resp.body.jobId}`);
      job = j.body;
      const st = job?.status ?? job?.job?.status;
      if (["completed", "failed", "done", "error", "partial", "succeeded"].includes(st)) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return { resp, ms: performance.now() - t0, job };
}

async function main() {
  const fixtures = buildFixtures();
  const results: any[] = [];
  for (const fx of fixtures) {
    const csv = readFileSync(join(FIX_DIR, fx.file), "utf8");
    for (const path of ["A:csv-import-sheet", "B:/api/leads/import", "C:/api/import/leads"] as const) {
      for (const tier of fx.truth.length > 500 ? ["pro", "scale"] : ["pro"]) {
        const org = await provisionOrg(`mkt-csv-${fx.name}-${path[0]}-${tier}`, { businessType: "land_flipper", orgName: `CSV ${fx.name}` });
        await org.client.post("/api/onboarding/complete", { businessType: "land_flipper", orgName: `CSV ${fx.name}`, seedSampleData: false });
        await q(`UPDATE organizations SET subscription_tier=$2 WHERE id=$1`, [org.orgId, tier]);
        let r: any, reported: any = {}, told = "";
        if (path.startsWith("A")) {
          r = await viaSheet(org, csv);
          reported = { imported: r.resp.body?.imported, skippedExisting: r.resp.body?.skippedExisting, skippedInvalid: r.resp.body?.skippedInvalid, skippedDuplicateInFile: r.resp.body?.skippedDuplicateInFile };
          told = r.toast;
        } else {
          r = await viaMultipart(org, path.slice(2), csv, fx.file);
          const b = r.job ?? r.resp.body ?? {};
          reported = { imported: b.successCount ?? b.imported ?? b.job?.successCount ?? b.processedRows, errors: b.errorCount ?? b.job?.errorCount, duplicatesSkipped: b.duplicatesSkipped ?? b.job?.duplicatesSkipped, jobStatus: b.status ?? b.job?.status, firstErrors: (b.errors ?? b.job?.errors ?? []).slice?.(0, 3) };
          told = r.resp.status >= 400 ? msg(r.resp) : r.resp.status === 202 ? `Import started: ${r.resp.body?.totalRows} rows are importing in the background` : `imported ${reported.imported}, skipped ${reported.duplicatesSkipped}, failed ${reported.errors}`;
        }
        const a = await audit(org, fx);
        // Every row in the file must be either persisted or REPORTED as skipped;
        // anything else vanished without the customer being told.
        const accounted = path.startsWith("A")
          ? (reported.imported ?? 0) + (reported.skippedExisting ?? 0) + (reported.skippedInvalid ?? 0) + (reported.skippedDuplicateInFile ?? 0)
          : (reported.imported ?? 0) + (reported.errors ?? 0) + (reported.duplicatesSkipped ?? 0);
        const silentlyDropped = r.resp.status < 300 ? fx.truth.length - accounted : 0;
        const reportedVsPersisted = r.resp.status < 300 ? (reported.imported ?? 0) - a.leadsInDb : 0;
        const row = {
          fixture: fx.name, describe: fx.describe, path, tier, rowsInFile: fx.truth.length, status: r.resp.status, seconds: +(r.ms / 1000).toFixed(1),
          reported, told: told.slice(0, 240), leadsPersisted: a.leadsInDb, silentlyDropped, reportedVsPersisted, mapping: (r as any).mapping, audit: a,
        };
        results.push(row);
        jsonl("csv-imports.jsonl", row);
        console.log(`${fx.name.padEnd(26)} ${path.padEnd(22)} ${tier.padEnd(5)} rows=${fx.truth.length} status=${r.resp.status} persisted=${a.leadsInDb} dropped=${silentlyDropped} mailBlockOK=${a.mailingCorrect}/${a.matched} situs→mail=${a.situsAsMailing} mixedBlock=${a.mixedAddressBlock} surnameGreeted=${a.surnameGreeted} apnE+=${a.apnMangled} zip4=${a.zipLostZero} phoneLost=${a.phoneDropped} dncIgnored=${a.dncIgnored}/${a.dncInFile} multiLeadOwners=${a.ownersWithMultipleLeads} ${row.seconds}s | ${told.slice(0, 110)}`);
        // A customer told nothing usable about a refused or partial import is a support ticket.
        if (r.resp.status >= 500) burden({ org: org.slug, orgId: org.orgId, persona: "csv", day: 0, tenureWeek: 1, cls: "error_5xx", what: `${path} ${fx.name}`, evidence: told });
      }
    }
  }
  // ── plan-limit probe: a STARTER org (250-lead cap) imports a 420-row county list via the sheet
  {
    const fx = fixtures[0];
    const org = await provisionOrg(`mkt-csv-limit-starter`, { businessType: "land_flipper", orgName: "CSV limit" });
    await org.client.post("/api/onboarding/complete", { businessType: "land_flipper", orgName: "CSV limit", seedSampleData: false });
    await q(`UPDATE organizations SET subscription_tier='starter' WHERE id=$1`, [org.orgId]);
    const r = await viaSheet(org, readFileSync(join(FIX_DIR, fx.file), "utf8"));
    const n = await count(`leads WHERE organization_id=$1 AND deleted_at IS NULL`, [org.orgId]);
    const after = await org.client.post("/api/leads", { firstName: "One", lastName: "More" });
    const row = { probe: "starter-limit-via-sheet", cap: 250, imported: r.resp.body?.imported, status: r.resp.status, persisted: n, nextLeadCreate: after.status, nextLeadMsg: msg(after) };
    jsonl("csv-imports.jsonl", row); results.push(row);
    console.log("starter limit probe:", JSON.stringify(row));
  }
  // ── what a customer does with the 5,000-row file after "Validation failed": split it.
  {
    const fx = fixtures[5];
    const org = await provisionOrg(`mkt-csv-5000-chunked-scale`, { businessType: "land_flipper", orgName: "CSV chunked" });
    await org.client.post("/api/onboarding/complete", { businessType: "land_flipper", orgName: "CSV chunked", seedSampleData: false });
    await q(`UPDATE organizations SET subscription_tier='scale' WHERE id=$1`, [org.orgId]);
    const csv = readFileSync(join(FIX_DIR, fx.file), "utf8");
    const { headers, rows } = parseCsv(csv);
    const t0 = performance.now();
    let imported = 0, statuses: number[] = [];
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = [headers.join(","), ...rows.slice(i, i + 500).map((r) => r.map(esc).join(","))].join("\n");
      const r = await viaSheet(org, chunk);
      statuses.push(r.resp.status);
      imported += r.resp.body?.imported ?? 0;
    }
    const a = await audit(org, fx);
    const row = { probe: "5000-rows-in-10-chunks-scale", chunks: statuses.length, statuses, imported, persisted: a.leadsInDb, seconds: +((performance.now() - t0) / 1000).toFixed(1), audit: a };
    jsonl("csv-imports.jsonl", row); results.push(row);
    console.log("chunked 5000:", JSON.stringify({ ...row, audit: undefined }), "situs→mail", a.situsAsMailing, "surnameGreeted", a.surnameGreeted, "multiLeadOwners", a.ownersWithMultipleLeads);
  }
  writeJson("csv-imports-summary.json", results);
  recordMetric(SIM, "csv-import-results", results.map((r) => ({ f: r.fixture, p: r.path, t: r.tier, s: r.status, n: r.leadsPersisted })));
  process.exit(0);
}
main().catch((e) => { console.error(e); recordSkip({ sim: SIM, step: "main", reason: String(e).slice(0, 300) }); process.exit(2); });
