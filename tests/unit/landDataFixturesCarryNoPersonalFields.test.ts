/**
 * No land-data fixture carries personal fields (W3 part 0).
 *
 * The repo is public. tests/fixtures/land-data/ holds real parcels (the TN
 * accuracy sample was pulled from a now-retired state service), so anything
 * about the PEOPLE who own them — names, mailing addresses, phone numbers,
 * e-mail, or a fact derived from where the owner lives — must never be
 * committed there.
 *
 * Population: EVERY *.json under tests/fixtures/land-data/, found by listing
 * the directory, not by a hand-kept list — a new fixture is scanned the day it
 * lands. Each file must parse and must yield keys (vacuity guard: a walker
 * that silently read nothing would read as clean).
 *
 * Three rules, so a renamed field cannot walk past one spelling:
 *   1. no KEY at any depth looks personal (owner, mailing, address, phone…);
 *   2. no string VALUE at any depth looks like a street address, PO box,
 *      phone number or e-mail;
 *   3. a parcel record in a sample file carries ONLY the fields the accuracy
 *      test needs (ids, geometry, the context layers it recomputes from, and
 *      the fact labels). An unknown field fails whatever it is called.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const FIXTURE_DIR = path.join(root, "tests/fixtures/land-data");

/** Keys that name a person or where they live. Case-insensitive, any depth. */
export const PERSONAL_KEY =
  /(owner|ownnam|own_?nm|mail|addr|street|phone|e_?mail|taxpayer|grantee|grantor|contact|resident|occupant|careof|care_of|c\/o)/i;

const STREET_SUFFIXES = [
  "rd", "road", "st", "street", "ave", "avenue", "ln", "lane", "dr", "drive", "hwy", "highway", "pike",
  "cir", "circle", "ct", "court", "blvd", "way", "trl", "trail", "pl", "place", "pkwy", "loop",
];

/** String values that read as a person's contact details. */
export const PERSONAL_VALUE: Array<{ what: string; re: RegExp }> = [
  {
    // A house number, then one to four Capitalised words, then a street
    // suffix in upper or title case. Case-sensitive on purpose: prose such as
    // "4 with no access road" is not an address.
    what: "street address",
    re: new RegExp(
      String.raw`\b\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Z][A-Za-z0-9.'-]*\s+){1,4}(?:` +
        STREET_SUFFIXES.flatMap((w) => [w.toUpperCase(), w[0].toUpperCase() + w.slice(1)]).join("|") +
        String.raw`)\b\.?`,
    ),
  },
  { what: "PO box", re: /\bP\.?\s?O\.?\s*BOX\b/i },
  { what: "phone number", re: /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/ },
  { what: "e-mail", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
];

/** The only fields a sampled parcel record may carry. */
export const SAMPLE_PARCEL_FIELDS = new Set([
  "parcelKey",
  "sourceParcelId",
  "gisLink",
  "county",
  "deededAcres",
  "geometry",
  "context",
  "labels",
]);

interface Finding {
  file: string;
  path: string;
  why: string;
}

/** Walk any JSON value; report personal keys and values. Returns keys walked. */
export function scanValue(value: unknown, file: string, at: string, out: Finding[]): number {
  let keys = 0;
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      keys += scanValue(v, file, `${at}[${i}]`, out);
    });
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      keys++;
      const p = `${at}.${k}`;
      if (PERSONAL_KEY.test(k)) out.push({ file, path: p, why: `personal key "${k}"` });
      keys += scanValue(v, file, p, out);
    }
  } else if (typeof value === "string") {
    for (const { what, re } of PERSONAL_VALUE) {
      if (re.test(value)) out.push({ file, path: at, why: `${what}: ${JSON.stringify(value.slice(0, 60))}` });
    }
  }
  return keys;
}

/** Rule 3: a sample file's parcel records carry only the allowed fields. */
export function scanSampleParcels(json: unknown, file: string, out: Finding[]): number {
  const parcels = (json as { parcels?: unknown })?.parcels;
  if (!Array.isArray(parcels)) return 0;
  parcels.forEach((p, i) => {
    for (const k of Object.keys((p ?? {}) as object)) {
      if (!SAMPLE_PARCEL_FIELDS.has(k)) out.push({ file, path: `.parcels[${i}].${k}`, why: `field "${k}" is not one the accuracy test needs` });
    }
  });
  return parcels.length;
}

function listJson(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listJson(full));
    else if (name.endsWith(".json")) out.push(full);
  }
  return out.sort();
}

describe("land-data fixtures carry no personal fields", () => {
  const files = listJson(FIXTURE_DIR);

  it("reads a real population (vacuity guard)", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((f) => path.basename(f))).toContain("tn-accuracy-sample.json");
  });

  for (const file of files) {
    const rel = path.relative(root, file);
    it(`${rel}: no personal keys, values or extra parcel fields`, () => {
      const json = JSON.parse(readFileSync(file, "utf8"));
      const findings: Finding[] = [];
      const keys = scanValue(json, rel, "", findings);
      expect(keys, `${rel} yielded no keys — the walker read nothing`).toBeGreaterThan(0);
      scanSampleParcels(json, rel, findings);
      expect(findings.map((f) => `${f.path}: ${f.why}`)).toEqual([]);
    });
  }

  // Canaries: each rule must go red on the shape it exists to catch, so a
  // regex that stops matching cannot read as a clean fixture.
  it("canary: a personal key at any depth is caught, under several spellings", () => {
    for (const k of ["OWNER1", "ownerName", "OWNNAME", "MAILADDR", "mailing_state", "Address", "taxpayer", "out_of_state_owner"]) {
      const out: Finding[] = [];
      scanValue({ parcels: [{ labels: { nested: { [k]: "x" } } }] }, "canary", "", out);
      expect(out.length, k).toBeGreaterThan(0);
    }
  });

  it("canary: a personal value is caught even under an innocent key", () => {
    for (const v of ["1205 SMITH RD", "412 N Main St.", "PO BOX 77", "P.O. Box 9", "(615) 555-0100", "jo@example.com"]) {
      const out: Finding[] = [];
      scanValue({ note: v }, "canary", "", out);
      expect(out.length, v).toBeGreaterThan(0);
    }
  });

  it("canary: an unknown parcel field fails whatever it is called", () => {
    const out: Finding[] = [];
    scanSampleParcels({ parcels: [{ parcelKey: "k", holder: "someone" }] }, "canary", out);
    expect(out.map((f) => f.path)).toEqual([".parcels[0].holder"]);
  });

  it("canary: non-personal sample text stays clean (no false positives on the real meta)", () => {
    const out: Finding[] = [];
    scanValue(
      {
        selection:
          "Parcels with DEEDAC >= 2 lying fully inside the sample box. Strata: 4 within 30 m of PAD-US public land, 4 intersecting a 1% flood zone, 4 with no access road within 20 m; then the rest in hash order, 20 in all.",
      },
      "canary",
      "",
      out,
    );
    expect(out).toEqual([]);
  });
});
