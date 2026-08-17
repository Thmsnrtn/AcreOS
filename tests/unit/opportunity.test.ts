/**
 * Opportunity gets a canonical home.
 *
 * `opportunity` was one of BI12's canonical objects that canon.ts recorded as
 * ABSENT. This file does three things, in this order, and the order matters:
 *
 *   1. PROVES THE PREMISE against the live repo — that the concept really was
 *      absent, and that the tables which look like they already hold it
 *      structurally cannot. A test that only guards the fix leaves the next
 *      session unable to tell whether the fix was ever needed; worse, a premise
 *      that has quietly stopped being true turns every assertion below it into
 *      theatre. The `parcel` entry in canon.ts exists because exactly that
 *      happened once: canon claimed parcel identity was absent when it already
 *      had two owners, and a third table was nearly built on the strength of it.
 *   2. Pins the SHAPE of the new table — what it owns and, more importantly,
 *      what it must never grow (economics, a properties.id, a convenience FK).
 *   3. Pins the migration's existence, idempotency, mirror-fidelity, and its
 *      deliberate ABSENCE from scripts/migrate.mjs (Fly's release_command).
 *
 * Everything here reads real files or real Drizzle metadata. Nothing is
 * hardcoded from prose.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { getTableConfig } from "drizzle-orm/pg-core";

import {
  opportunities,
  opportunityParcelRef,
  parcelRefColumns,
  OPPORTUNITY_KINDS,
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_ORIGINS,
} from "../../shared/schema/opportunity";
import { normalizeParcelRef, parcelKey, sameParcel } from "../../shared/parcel/parcelRef";
import { SCENARIO_SUBJECT_TYPES } from "../../shared/economics/scenario";
import { DECISION_SUBJECT_TYPES } from "../../shared/decisions/snapshot";
import { objectById, objectsWithoutCanonicalHome } from "../../shared/architecture/canon";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const MIGRATION = "migrations/0237_opportunities.sql";
const SCHEMA_FILE = "shared/schema/opportunity.ts";

const cfg = getTableConfig(opportunities);
const columnsByName = new Map(cfg.columns.map((c) => [c.name, c]));
const col = (name: string) => {
  const c = columnsByName.get(name);
  if (!c) throw new Error(`no column "${name}" on ${cfg.name} — has: ${[...columnsByName.keys()].join(", ")}`);
  return c;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE PREMISE — checked against the code, not against the prompt.
// ─────────────────────────────────────────────────────────────────────────────

describe("the premise this table exists to satisfy (vacuity guard, first)", () => {
  it("two already-canonical layers declare an `opportunity` subject", () => {
    // If these ever stop naming "opportunity", the layers above the Reality
    // Graph have decided they do not need it and this table's justification is
    // gone — re-read before trusting anything below.
    expect(SCENARIO_SUBJECT_TYPES).toContain("opportunity");
    expect(DECISION_SUBJECT_TYPES).toContain("opportunity");
  });

  it("decisionStore no longer resolves an `opportunity` subject AS a properties.id", () => {
    // RESTATED, NOT DELETED. This assertion originally pinned the DEFECT —
    // that `subjectType === "property" || subjectType === "opportunity"` shared
    // one branch, so an opportunity id was passed to
    // `resolveSubject(…, "property", …)` and a decision against opportunity #5
    // froze PROPERTY #5's evidence. It was written to fail the moment someone
    // fixed it, precisely so the fix had to be recorded rather than slipped in.
    // This is that record: the table landed, the branch became real, and the
    // invariant is now stated in the direction that keeps it true.
    const src = read("server/services/decisions/decisionStore.ts");
    expect(
      src,
      "the two subject types share a branch again — an opportunity id is being " +
        "resolved as a properties.id",
    ).not.toContain(
      'if (input.subjectType === "property" || input.subjectType === "opportunity") {',
    );

    // The property branch still resolves property evidence…
    const propertyBranch = src.slice(src.indexOf('input.subjectType === "property"'));
    expect(propertyBranch.slice(0, 400)).toContain('resolveSubject(organizationId, "property"');

    // …and the opportunity branch checks the id against `opportunities`,
    // org-scoped, instead of resolving anything off it. `requireOpportunity`
    // throws rather than returning null, so an unavailable id cannot be
    // silently skipped into a decision that reads as fully evidenced.
    const opportunityBranch = src.slice(src.indexOf('if (input.subjectType === "opportunity")'));
    expect(opportunityBranch.length, "the opportunity branch is gone entirely").toBeGreaterThan(0);
    expect(opportunityBranch.slice(0, 1800)).toContain(
      "requireOpportunity(organizationId, input.subjectId)",
    );
    expect(
      opportunityBranch.slice(0, 1800),
      "the opportunity branch resolves property evidence again",
    ).not.toContain('resolveSubject(organizationId, "property"');
  });

  it("`opportunity_scores` cannot host an Opportunity — one parcel, one row, kind overwritten", () => {
    // The closest existing table, and the one a careless reading would reuse.
    // Its writer's match predicate is the whole argument: no opportunity_type
    // in it, so rescoring a parcel with a different type UPDATEs the same row.
    const radar = read("server/services/acquisitionRadar.ts");
    const save = radar.slice(radar.indexOf("async saveOpportunityScore("));
    expect(save.length, "saveOpportunityScore not found — re-verify the premise").toBeGreaterThan(0);

    const predicate = save.slice(save.indexOf(".where(and("), save.indexOf(".limit(1)"));
    expect(predicate).toContain("opportunityScores.organizationId");
    expect(predicate).toContain("opportunityScores.apn");
    expect(predicate).toContain("opportunityScores.county");
    expect(predicate).toContain("opportunityScores.state");
    expect(
      predicate.includes("opportunityScores.opportunityType"),
      "the radar's match predicate now includes opportunityType — one parcel can hold several kinds there, so re-examine whether opportunity_scores became an identity table",
    ).toBe(false);

    // And the update path overwrites the kind in place.
    expect(save.slice(0, save.indexOf(".returning()"))).toContain(
      "opportunityType: result.opportunityType",
    );

    // Its key is built with an empty-string fallback: every unknown-APN parcel
    // in an org collides. That is the "default to a plausible value rather than
    // admit unknown" failure, and it is why this table does not reuse it.
    expect(save).toContain("parcel.apn || ''");
  });

  it("`properties` carries pipeline state as ONE scalar status — so one parcel cannot host two evaluations (BI93)", () => {
    const schema = read("shared/schema.ts");
    const props = schema.slice(schema.indexOf('export const properties = pgTable("properties"'));
    const statusLine = props.slice(0, props.indexOf("// Financial"));
    expect(statusLine).toContain('status: text("status").notNull().default("prospect")');
    // A single text column: two simultaneous strategy evaluations on one parcel
    // are not expressible, which is exactly the gap canon named.
    expect(statusLine).toContain("prospect, due_diligence, offer_sent");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE SHAPE — identity and lifecycle, never economics.
// ─────────────────────────────────────────────────────────────────────────────

describe("opportunities — tenancy", () => {
  it("is org-scoped with a NOT NULL organization_id", () => {
    expect(cfg.name).toBe("opportunities");
    expect(col("organization_id").notNull).toBe(true);
  });

  it("declares an org-LEADING composite index (scripts/check-org-leading-index.mjs)", () => {
    const leading = cfg.indexes.map((i) => ({
      name: i.config.name,
      cols: (i.config.columns as ReadonlyArray<{ name?: string }>).map((c) => c.name),
    }));
    expect(leading.length, "no indexes declared").toBeGreaterThan(0);
    expect(
      leading.some((i) => i.cols[0] === "organization_id" && i.cols.length > 1),
      `no composite index leads with organization_id: ${JSON.stringify(leading)}`,
    ).toBe(true);
    // Both of them lead with the tenant key, not just one.
    for (const i of leading) {
      expect(i.cols[0], `${i.name} does not lead with organization_id`).toBe("organization_id");
    }
  });

  it("the parcel read is indexed on the full natural key", () => {
    const parcelIdx = cfg.indexes.find((i) => i.config.name === "opportunities_org_parcel_idx");
    expect(parcelIdx, "opportunities_org_parcel_idx missing").toBeDefined();
    expect(
      (parcelIdx!.config.columns as ReadonlyArray<{ name?: string }>).map((c) => c.name),
    ).toEqual(["organization_id", "parcel_state", "parcel_county", "parcel_apn"]);
  });
});

describe("opportunities — the parcel reference is the natural key, not a properties.id", () => {
  it("carries state/county/apn, all NOT NULL", () => {
    for (const name of ["parcel_state", "parcel_county", "parcel_apn"]) {
      expect(col(name).notNull, `${name} must be NOT NULL`).toBe(true);
      expect(col(name).hasDefault, `${name} must not have a default`).toBe(false);
    }
  });

  it("has NO property/parcel foreign key column at all", () => {
    // The whole point of the parcel work: an opportunity precedes the
    // commitment that would create a `properties` row, so pointing at one would
    // both re-conflate identity and make most opportunities unrepresentable.
    const names = [...columnsByName.keys()];
    expect(names).not.toContain("property_id");
    expect(names).not.toContain("parcel_id");
    expect(cfg.foreignKeys.map((fk) => fk.reference().foreignTable)).toHaveLength(1);
  });

  it("round-trips through the ONE definition of the same parcel", () => {
    const r = normalizeParcelRef({ state: "ca", county: "  Fresno ", apn: "a-1-2" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const cols = parcelRefColumns(r.ref);
    expect(cols).toEqual({ parcelState: "CA", parcelCounty: "fresno", parcelApn: "A-1-2" });

    const back = opportunityParcelRef(cols);
    expect(sameParcel(back, r.ref)).toBe(true);
    expect(parcelKey(back)).toBe("CA fresno A-1-2");
  });

  it("refuses to be constructed from a half-formed key — the NOT NULLs cannot be faked", () => {
    // parcelRefColumns takes a ParcelRef, and the only way to get one is
    // normalizeParcelRef, which REFUSES rather than guessing. So there is no
    // in-type path from an unknown APN to a stored row.
    const bad = normalizeParcelRef({ state: "CA", county: "fresno", apn: "   " });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.problems).toContain("apn-missing");
  });
});

describe("opportunities — the Reality Graph owns identity, NOT economics", () => {
  it("carries no money, score or valuation column", () => {
    const names = [...columnsByName.keys()];
    // Matched on whole snake_case WORDS, not substrings: an earlier form of
    // this test flagged `strategy` because it contains "rate", which is the
    // kind of false positive that gets a real guard deleted rather than fixed.
    const economics = new Set([
      "price",
      "amount",
      "value",
      "cost",
      "score",
      "roi",
      "margin",
      "profit",
      "equity",
      "rate",
      "fee",
      "fees",
      "bid",
      "offer",
      "basis",
      "yield",
    ]);
    const offenders = names.filter((n) => n.split("_").some((w) => economics.has(w)));
    expect(
      offenders,
      `economics belongs to scenarios/decision_snapshots/outcomes (layers 4/5/7), not to the Reality Graph: ${offenders.join(", ")}`,
    ).toEqual([]);
    // Vacuity guard: the word list must be capable of firing.
    expect(["market_value", "offer_amount"].filter((n) =>
      n.split("_").some((w) => economics.has(w)),
    )).toEqual(["market_value", "offer_amount"]);
  });

  it("carries no numeric column at all beyond ids and the shape version", () => {
    const numeric = cfg.columns
      .filter((c) => /Serial|Integer|Numeric|Real|Double|BigInt/.test(c.columnType))
      .map((c) => c.name)
      .sort();
    expect(numeric).toEqual(["id", "organization_id", "shape_version"]);
  });

  it("does not restate a decision — status has no `passed`/`won`/`lost`", () => {
    // Those are DECISIONS; decision_snapshots owns them with the rationale,
    // the authority, the evidence as it stood and the economics behind it.
    expect([...OPPORTUNITY_STATUSES]).toEqual(["open", "converted", "closed"]);
  });
});

describe("opportunities — unknown is first-class", () => {
  it("`strategy` is nullable with NO default", () => {
    expect(col("strategy").notNull).toBe(false);
    expect(col("strategy").hasDefault).toBe(false);
  });

  it("`origin_type` is NOT NULL but can say `unknown`", () => {
    expect(col("origin_type").notNull).toBe(true);
    expect(col("origin_type").hasDefault, "a default origin would fabricate provenance").toBe(
      false,
    );
    expect([...OPPORTUNITY_ORIGINS]).toContain("unknown");
  });

  it("`closed_at` null means still open — an absence, not a guess", () => {
    expect(col("closed_at").notNull).toBe(false);
    expect(col("closed_at").hasDefault).toBe(false);
  });

  it("`status` defaults to open, which is a fact rather than a plausible guess", () => {
    expect(col("status").notNull).toBe(true);
    expect(col("status").default).toBe("open");
  });
});

describe("opportunities — the three kinds BI12 names", () => {
  it("acquisition, disposition, financing — a closed set", () => {
    expect([...OPPORTUNITY_KINDS]).toEqual(["acquisition", "disposition", "financing"]);
    expect(col("kind").notNull).toBe(true);
    expect(col("kind").hasDefault, "a default kind would invent an intent").toBe(false);
  });

  it("`strategy` is what makes BI93 expressible: two rows, one parcel", () => {
    // Nothing in the schema prevents two rows differing only in `strategy` —
    // no unique constraint over the parcel key. That is the capability the
    // canon gap named, so assert the absence deliberately rather than by luck.
    expect(cfg.uniqueConstraints).toHaveLength(0);
    const uniqueIndexes = cfg.indexes.filter((i) => i.config.unique);
    expect(uniqueIndexes, "a unique index over the parcel key would re-break BI93").toHaveLength(
      0,
    );
  });
});

describe("opportunities — no convenience foreign keys (BI184)", () => {
  it("organization is the only foreign key", () => {
    const fkColumns = cfg.foreignKeys.flatMap((fk) =>
      fk.reference().columns.map((c) => c.name),
    );
    expect(fkColumns).toEqual(["organization_id"]);
  });

  it("no lead_id / deal_id / party_id — those edges belong to Relationship", () => {
    const names = [...columnsByName.keys()];
    for (const forbidden of ["lead_id", "deal_id", "party_id", "buyer_id", "seller_id"]) {
      expect(names, `${forbidden} is a convenience FK; BI184 forbids it`).not.toContain(forbidden);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE MIGRATION — exists, idempotent, mirrors, and is NOT in migrate.mjs.
// ─────────────────────────────────────────────────────────────────────────────

describe("the migration", () => {
  const sql = read(MIGRATION);

  it("creates the table idempotently", () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "opportunities"');
    // Every DDL statement in the file must be re-runnable.
    const creates = sql.match(/CREATE\s+(TABLE|INDEX)[^\n]*/gi) ?? [];
    expect(creates.length).toBeGreaterThan(2);
    for (const c of creates) {
      expect(c, `not idempotent: ${c}`).toMatch(/IF NOT EXISTS/i);
    }
  });

  it("mirrors every column the Drizzle schema declares", () => {
    const body = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS "opportunities"'));
    for (const name of columnsByName.keys()) {
      expect(body, `migration is missing column "${name}"`).toContain(`"${name}"`);
    }
  });

  it("mirrors the NOT NULL tenancy key with ON DELETE CASCADE", () => {
    expect(sql).toMatch(/"organization_id"\s+integer NOT NULL/);
    expect(sql).toContain('REFERENCES "organizations"("id") ON DELETE CASCADE');
  });

  it("mirrors both org-leading indexes by name", () => {
    for (const idx of cfg.indexes) {
      expect(sql, `migration is missing index ${idx.config.name}`).toContain(
        `"${idx.config.name}"`,
      );
    }
    expect(sql).toContain(
      '("organization_id", "parcel_state", "parcel_county", "parcel_apn")',
    );
  });

  it("IS registered in scripts/migrate.mjs, because it is additive", () => {
    // This assertion originally pinned the OPPOSITE — that the migration was
    // deliberately absent from Fly's release_command, mirroring 0236. It is
    // rewritten rather than deleted (CLAUDE.md wave discipline: when a wave
    // makes a stubbed thing real, restate the invariant to the new truth so it
    // survives), because the reasoning behind it was half right and the half
    // that was right is asserted below.
    //
    // WHAT CHANGED THE ANSWER: the distinction is the VERB, not the file. 0236
    // is `DROP TABLE` — destructive, irreversible, and rightly held until
    // someone inspects the rows. This is `CREATE TABLE IF NOT EXISTS` —
    // additive, idempotent, reversible by not writing to it. Withholding it
    // would leave shared/schema.ts exporting a table with NO RELATION BEHIND
    // IT, which does not fail the deploy; it 500s the first caller.
    const migrate = read("scripts/migrate.mjs");
    // The quoted, exact table name. NOT a bare substring: migrate.mjs already
    // creates `team_improvement_opportunities`, and a substring match would
    // match that instead and pass for the wrong reason.
    expect(migrate).toContain('CREATE TABLE IF NOT EXISTS "opportunities"');
    for (const idx of cfg.indexes) {
      expect(
        migrate,
        `release_command creates the table without index ${idx.config.name} — ` +
          "the schema and the deployed relation would disagree",
      ).toContain(`"${idx.config.name}"`);
    }
    // Vacuity guard: this file really is the production release_command and
    // really does create tables, so a claim about its contents means something.
    expect(migrate).toContain("Release-command schema patch");
    expect(migrate).toContain('CREATE TABLE IF NOT EXISTS "team_improvement_opportunities"');
  });

  it("the DESTRUCTIVE neighbour 0236 is still absent from release_command", () => {
    // The invariant the original assertion was really protecting, kept intact
    // and pointed at the statement that actually warrants it. A deploy must
    // never drop a table as a side effect of a merge (founder decision
    // 2026-08-17: "merge everything, HOLD THE DROP").
    const migrate = read("scripts/migrate.mjs");
    const held = read("migrations/0236_drop_experiment_residue_tables.sql");

    // The 13 names are DERIVED from the migration, never hardcoded here: a
    // hardcoded list silently stops covering a table if 0236 is ever edited,
    // and this test would keep passing while protecting less than it says.
    const tables = [...held.matchAll(/DROP\s+TABLE\s+IF\s+EXISTS\s+"([a-z0-9_]+)"/gi)].map(
      (m) => m[1],
    );
    expect(tables.length, "0236 no longer parses as a list of DROP TABLE statements").toBe(13);

    // Scoped to the 13, not to DROP TABLE generally: `migrate.mjs` legitimately
    // carries seven earlier drops that a previous ruling authorised, plus a
    // pg_temp scratch drop. Asserting "no DROP TABLE anywhere" would be false
    // about this repo and would fail for reasons that have nothing to do with
    // the decision being protected.
    const executable = migrate.replace(/^\s*\/\/.*$/gm, "");
    const dropsTable = (t: string): boolean =>
      new RegExp(`DROP\\s+TABLE\\s+IF\\s+EXISTS\\s+"${t}"`, "i").test(executable);

    // POSITIVE CONTROL. Without it, a matcher that silently stopped matching —
    // a changed quoting style, an extra keyword — would report an empty `leaked`
    // list forever and read as a clean bill of health. `voice_calls` is one of
    // seven drops an EARLIER ruling authorised and which really are registered,
    // so it proves the matcher can still see a drop that is genuinely there.
    expect(
      dropsTable("voice_calls"),
      "the drop matcher no longer detects a DROP TABLE that IS in migrate.mjs, " +
        "so the empty result below would prove nothing.",
    ).toBe(true);
    expect(tables, "voice_calls is unexpectedly one of the held 13").not.toContain("voice_calls");

    const leaked = tables.filter(dropsTable);
    expect(
      leaked,
      "a table held by founder decision 2026-08-17 (\"merge everything, HOLD " +
        "THE DROP\") is dropped by Fly's release_command, making a production " +
        "drop the side effect of a deploy rather than a decision someone made.",
    ).toEqual([]);
  });

  it("declares no money movement (founder ruling: be the rail, not the provider)", () => {
    const moneyish = /(stripe|payment_intent|charge|payout|balance|transfer)/i;
    expect(moneyish.test(sql.replace(/^--.*$/gm, ""))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE REGISTRY — canon agrees, and the ratchet moved.
// ─────────────────────────────────────────────────────────────────────────────

describe("canon registry agreement", () => {
  it("records opportunity as canonical, homed in `opportunities`, with no gap", () => {
    const entry = objectById("opportunity");
    expect(entry, "canon.ts lost its opportunity entry").toBeDefined();
    expect(entry!.layer).toBe("reality-graph");
    expect(entry!.status).toBe("canonical");
    expect(entry!.tables).toEqual(["opportunities"]);
    expect(entry!.gap).toBe("");
    expect(entry!.disposition).toBe("KEEP_HARDEN");
  });

  it("opportunity is no longer counted among the objects without a home", () => {
    expect(objectsWithoutCanonicalHome().map((o) => o.id)).not.toContain("opportunity");
  });

  it("it is the FIRST Reality-Graph object to get a canonical home", () => {
    // Recorded because it is the interesting fact about this change: the four
    // canonical homes that landed before it (evidence-claim, scenario,
    // decision-snapshot, outcome) are all in layers ABOVE the graph, every one
    // of which was already pointing an `opportunity` subject at nothing.
    const realityGraphCanonical = objectsWithoutCanonicalHome();
    const graphIds = ["property", "parcel", "party", "relationship", "holding", "instrument", "document"];
    for (const id of graphIds) {
      expect(
        realityGraphCanonical.map((o) => o.id),
        `${id} now has a canonical home — update this test's account of what landed when, do not delete it`,
      ).toContain(id);
    }
  });

  it("the schema file names the table canon claims", () => {
    expect(read(SCHEMA_FILE)).toContain('pgTable(\n  "opportunities"');
  });
});
