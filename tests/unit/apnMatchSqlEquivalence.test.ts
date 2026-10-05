/**
 * W10.3 second audit, finding 11 — the SQL APN pre-filter equals apnMatchForm.
 *
 * Every lead-creating dedupe (the list-builder save, the CSV and
 * tax-delinquent imports, importLeads) pre-filters the org's leads — DELETED
 * ones included, because a deleted lead may carry an opt-out — by comparing a
 * SQL-normalised stored APN against JS-normalised incoming APNs. The SQL side
 * was `upper(regexp_replace(trim(apn), '\s+', ' ', 'g'))`; Postgres's trim()
 * strips SPACES only, so a deleted, opted-out lead stored as "\t123" never
 * matched an incoming "123", the dedupe never saw it, and a fresh contactable
 * lead was minted for a parcel whose owner had said stop.
 *
 * Pinned three ways:
 *  1. the whitespace class is EXACTLY JavaScript's `\s` (every BMP code point);
 *  2. the SQL expression apnMatchSql renders, evaluated with that pattern,
 *     equals apnMatchForm on every whitespace variant — and the rendered
 *     statement is that expression with that pattern bound (no other shape);
 *  3. POPULATION: no server file normalises an `.apn` column in raw SQL by
 *     hand — the whitespace-normalising shape the bug lived in may occur only
 *     inside parcelDedupe.ts — and each of the three known sites calls the
 *     shared helper.
 * (Also verified against a real Postgres 16, UTF8: 0 of 106 whitespace
 * variants differ from apnMatchForm with the new expression; 76 did with the
 * old one; the class matches JS `\s` on every BMP code point.)
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { leads } from "@shared/schema";
import { apnMatchForm, apnMatchesAny } from "../../server/services/leads/parcelDedupe";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = resolve(__dirname, "../..");

/**
 * The pre-filter exactly as it reaches Postgres. The whitespace class is read
 * back from the BOUND PATTERN of the rendered statement — what the database
 * actually receives — not from a constant beside it.
 */
const rendered = new PgDialect().sqlToQuery(apnMatchesAny(leads.apn, [" r-1\t", "R-1", "x 2"]));
const BOUND_PATTERN = String(rendered.params[0]);
const APN_WHITESPACE_CLASS = BOUND_PATTERN.replace(/\+$/, "");

/** Every BMP code point JavaScript's `\s` matches. */
const JS_WHITESPACE: string[] = [];
for (let cp = 0; cp <= 0xffff; cp++) {
  const ch = String.fromCharCode(cp);
  if (/\s/.test(ch)) JS_WHITESPACE.push(ch);
}

/** apnMatchSql's expression — upper(btrim(regexp_replace(x, CLASS+, ' ', 'g'), ' ')) — evaluated in JS. */
function evalSqlExpression(x: string): string {
  return x.replace(new RegExp(`${APN_WHITESPACE_CLASS}+`, "g"), " ").replace(/^ +| +$/g, "").toUpperCase();
}

describe("the whitespace class is exactly JavaScript's \\s", () => {
  it("over every BMP code point", () => {
    expect(JS_WHITESPACE.length, "vacuity: ECMAScript defines 25 BMP whitespace code points").toBe(25);
    const cls = new RegExp(APN_WHITESPACE_CLASS);
    for (let cp = 0; cp <= 0xffff; cp++) {
      const ch = String.fromCharCode(cp);
      expect(cls.test(ch), `U+${cp.toString(16).padStart(4, "0")}`).toBe(/\s/.test(ch));
    }
  });
});

describe("apnMatchSql ≡ apnMatchForm", () => {
  it("on every whitespace variant — leading, trailing, internal runs, mixed", () => {
    const samples: string[] = ["123", "abc-1", "  Abc  -1 ", "R-005", "r-005", "", "   "];
    for (const w of JS_WHITESPACE) samples.push(`${w}123`, `123${w}`, `12${w}${w}3`, `${w}${w}ab-1 ${w}c${w}`, `\t${w} 4-5 ${w}\n`);
    for (const x of samples) expect(evalSqlExpression(x), JSON.stringify(x)).toBe(apnMatchForm(x));
    // The case the finding named, and the old expression's answer to it.
    expect(evalSqlExpression("\t123")).toBe(apnMatchForm("123"));
    const oldSql = (x: string) => x.replace(/^ +| +$/g, "").replace(/\s+/g, " ").toUpperCase();
    expect(oldSql("\t123"), "the old trim() kept the tab — the defect").not.toBe(apnMatchForm("123"));
  });

  it("renders exactly that expression — the class bound as ONE run-matching pattern — against the apnMatchForm of each incoming APN", () => {
    expect(rendered.sql).toBe(`upper(btrim(regexp_replace("leads"."apn", $1, ' ', 'g'), ' ')) in ($2, $3)`);
    expect(BOUND_PATTERN).toMatch(/^\[.*\]\+$/);
    expect(rendered.params.slice(1)).toEqual(["R-1", "X 2"]);
  });
});

describe("POPULATION — every lead dedupe pre-filter uses the shared expression", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(p, out);
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  }
  const files = walk(join(ROOT, "server"));
  const HELPER = "server/services/leads/parcelDedupe.ts";
  // A raw SQL template that trims / collapses whitespace on an `.apn` column.
  const HAND_ROLLED = /sql`[^`]*(?:regexp_replace|\btrim|btrim)\s*\([^`]*\$\{\s*[\w.]+\.apn\s*\}[^`]*`/i;

  it("no server file normalises an APN column's whitespace in raw SQL outside parcelDedupe.ts", () => {
    expect(files.length, "vacuity: the server tree was read").toBeGreaterThan(500);
    const offenders = files
      .map((f) => relative(ROOT, f))
      .filter((rel) => rel !== HELPER)
      .filter((rel) => {
        const raw = readFileSync(join(ROOT, rel), "utf8");
        // Cheap superset first (stripping comments only removes text), then the real check.
        return raw.includes(".apn") && HAND_ROLLED.test(stripComments(raw));
      });
    expect(offenders).toEqual([]);
    // Canary: the predicate does see the old shape (in code, not a comment).
    expect(HAND_ROLLED.test("x(sql`upper(regexp_replace(trim(${leads.apn}), '\\\\s+', ' ', 'g'))`)")).toBe(true);
  });

  it.each([
    ["server/storage/listBuilderRepo.ts", 1],
    ["server/routes-leads.ts", 2],
    ["server/services/importExport.ts", 1],
  ] as const)("%s pre-filters through apnMatchesAny (%i site(s))", (rel, n) => {
    const src = stripComments(readFileSync(join(ROOT, rel), "utf8"));
    expect((src.match(/\bapnMatchesAny\(/g) ?? []).length).toBe(n);
  });
});
