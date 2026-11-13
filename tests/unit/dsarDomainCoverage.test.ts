/**
 * PKG-1 §4 — every personal-data table has a DSAR decision, or is NAMED as
 * undecided debt (docs/pkg1-dsar-design-2026-11.md §4).
 *
 * POPULATION (import-based — this file does NOT scan the filesystem, so it
 * carries no sweep budget, design §8): every value exported from
 * `@shared/schema` (plus `@shared/models/auth`, belt-and-braces for `users`)
 * that drizzle recognises as a PgTable, read through `getTableConfig`. A new
 * `pgTable(...)` re-exported from the schema barrel is in the population the
 * moment it exists; nothing has to remember to list it.
 *
 * CANDIDATE PREDICATE — a table is a personal-data candidate if ANY arm holds:
 *   (a) a column's SQL name satisfies `looksLikePII` (shared/data-classification.ts);
 *   (b) it has a foreign key to `leads.id` or `users.id`, or a column named
 *       `lead_id`, `borrower_id` or `user_id`;
 *   (c) a column is classified `pii` / `sensitive_financial` in
 *       CLASSIFICATION_REGISTRY (a risk register, NOT the population — :58).
 * The predicate is deliberately NOT narrowed to make the population small.
 *
 * The canaries (assertion 7) falsify the predicate SEMANTICALLY: a synthetic
 * table carrying each arm's defect must be a candidate AND be reported
 * undecided, and disabling each arm in a local variant must flip exactly the
 * canary that arm catches — so an arm that silently stops matching reads red,
 * not as "every table is clean".
 */
import { describe, it, expect, vi } from "vitest";

// dsarExporters imports server/db, which throws without DATABASE_URL. The
// coverage test only reads the exporter KEYS (design §4 assertion 4).
vi.mock("../../server/db", () => ({ db: {} }));

import { is } from "drizzle-orm";
import { PgTable, getTableConfig, pgTable, serial, text, integer } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";
import * as authModels from "@shared/models/auth";
import { CLASSIFICATION_REGISTRY, looksLikePII, type DataClass } from "@shared/data-classification";
import { DSAR_DOMAINS, DSAR_UNDECIDED_TABLES } from "@shared/privacy/dsarDomains";
import { DSAR_EXPORTERS } from "../../server/services/privacy/dsarExporters";

/**
 * Measured 2026-11-09 by the PKG-1 driver with the repo's own drizzle and
 * data-classification modules, applying this file's predicate exactly. A
 * floor, not a target: the candidate set may grow; it may not silently
 * collapse (a parser change that stops reading a schema module would).
 */
const DSAR_CANDIDATE_FLOOR = 138;

type Arm = "pii_name" | "subject_fk" | "registry";

const SUBJECT_LINK_COLUMNS = new Set(["lead_id", "borrower_id", "user_id"]);
const SUBJECT_FK_TABLES = new Set(["leads", "users"]);
const SENSITIVE_CLASSES: ReadonlySet<DataClass> = new Set<DataClass>(["pii", "sensitive_financial"]);

interface PredicateOptions {
  /** Arms switched OFF in a local variant (canary falsification). */
  disabled?: ReadonlySet<Arm>;
  /** Registry to read for arm (c); defaults to the real CLASSIFICATION_REGISTRY. */
  registry?: Record<string, DataClass>;
}

/** Which arms of the §4 predicate a table satisfies. */
function candidateArms(table: PgTable, opts: PredicateOptions = {}): Set<Arm> {
  const disabled = opts.disabled ?? new Set<Arm>();
  const registry = opts.registry ?? CLASSIFICATION_REGISTRY;
  const cfg = getTableConfig(table);
  const arms = new Set<Arm>();

  if (!disabled.has("pii_name") && cfg.columns.some((c) => looksLikePII(c.name))) arms.add("pii_name");

  if (!disabled.has("subject_fk")) {
    const byName = cfg.columns.some((c) => SUBJECT_LINK_COLUMNS.has(c.name));
    const byFk = cfg.foreignKeys.some((fk) => {
      const ref = fk.reference();
      const target = getTableConfig(ref.foreignTable).name;
      return SUBJECT_FK_TABLES.has(target) && ref.foreignColumns.some((fc) => fc.name === "id");
    });
    if (byName || byFk) arms.add("subject_fk");
  }

  const classOf = (col: string): DataClass | undefined => registry[`${cfg.name}.${col}`];
  if (!disabled.has("registry") && cfg.columns.some((c) => { const cls = classOf(c.name); return cls !== undefined && SENSITIVE_CLASSES.has(cls); })) {
    arms.add("registry");
  }
  return arms;
}

function isCandidate(table: PgTable, opts?: PredicateOptions): boolean {
  return candidateArms(table, opts).size > 0;
}

/** Every PgTable reachable from the schema barrel, keyed by SQL table name. */
function schemaPopulation(): Map<string, PgTable[]> {
  const byName = new Map<string, PgTable[]>();
  for (const mod of [schema, authModels] as Array<Record<string, unknown>>) {
    for (const v of Object.values(mod)) {
      if (!is(v, PgTable)) continue;
      const name = getTableConfig(v).name;
      const list = byName.get(name) ?? [];
      if (!list.includes(v)) list.push(v);
      byName.set(name, list);
    }
  }
  return byName;
}

const POPULATION = schemaPopulation();

/** Candidate table names over the real population (a name is a candidate if any table object under it is). */
function candidateNames(opts?: PredicateOptions): Set<string> {
  const out = new Set<string>();
  for (const [name, tables] of POPULATION) if (tables.some((t) => isCandidate(t, opts))) out.add(name);
  return out;
}

const CANDIDATES = candidateNames();
const DECIDED = new Set(DSAR_DOMAINS.flatMap((d) => d.tables));
const UNDECIDED = new Set(DSAR_UNDECIDED_TABLES);

/** The "reported undecided" projection assertion 1 enforces, applied to any table. */
function reportedUndecided(name: string, table: PgTable, opts?: PredicateOptions): boolean {
  return isCandidate(table, opts) && !DECIDED.has(name) && !UNDECIDED.has(name);
}

describe("PKG-1 §4 — DSAR domain coverage", () => {
  it("1. every personal-data candidate table is decided in DSAR_DOMAINS or named in DSAR_UNDECIDED_TABLES", () => {
    const missing = [...CANDIDATES].filter((n) => !DECIDED.has(n) && !UNDECIDED.has(n)).sort();
    expect(
      missing,
      `Personal-data candidate table(s) with NO DSAR decision: ${missing.join(", ")}. ` +
        "Add each to a DSAR_DOMAINS entry (export with scope + erasure, or exclude with basis + reason) " +
        "in shared/privacy/dsarDomains.ts. Do not narrow the predicate.",
    ).toEqual([]);
  });

  it("2. every DSAR_UNDECIDED_TABLES entry is still a candidate and is not also decided (stale debt fails)", () => {
    const notCandidates = DSAR_UNDECIDED_TABLES.filter((n) => !CANDIDATES.has(n));
    const alsoDecided = DSAR_UNDECIDED_TABLES.filter((n) => DECIDED.has(n));
    const duplicates = DSAR_UNDECIDED_TABLES.filter((n, i) => DSAR_UNDECIDED_TABLES.indexOf(n) !== i);
    expect(notCandidates, `stale undecided entries (no longer candidates — delete them): ${notCandidates.join(", ")}`).toEqual([]);
    expect(alsoDecided, `undecided entries that are now decided — delete them from DSAR_UNDECIDED_TABLES: ${alsoDecided.join(", ")}`).toEqual([]);
    expect(duplicates).toEqual([]);
  });

  it("3. every table named in DSAR_DOMAINS exists in the schema population (catches renames)", () => {
    const unknown = [...DECIDED].filter((n) => !POPULATION.has(n)).sort();
    expect(unknown, `DSAR_DOMAINS names table(s) not in @shared/schema: ${unknown.join(", ")}`).toEqual([]);
  });

  it("4. DSAR_EXPORTERS keys ≡ the registry's export domains, in both directions", () => {
    const exportDomains = DSAR_DOMAINS.filter((d) => d.decision === "export").map((d) => d.domain).sort();
    const exporterKeys = Object.keys(DSAR_EXPORTERS).sort();
    expect(exporterKeys).toEqual(exportDomains);
    // Domain names are the join key for exporters, exclusions and erasure — unique.
    const all = DSAR_DOMAINS.map((d) => d.domain);
    expect(new Set(all).size).toBe(all.length);
  });

  it("5. every retain erasure carries a reason; every exclusion carries a basis and a reason", () => {
    for (const d of DSAR_DOMAINS) {
      if (d.decision === "export") {
        if (d.erasure.action === "retain") {
          expect((d.erasure.reason ?? "").trim().length, `${d.domain}: retain without a reason`).toBeGreaterThan(0);
        }
        expect(d.scope.trim().length, `${d.domain}: export without a scope`).toBeGreaterThan(0);
        expect(d.tables.length, `${d.domain}: export names no table`).toBeGreaterThan(0);
      } else {
        expect(["third_party_data", "no_subject_link", "hash_only", "secret_material"]).toContain(d.basis);
        expect(d.reason.trim().length, `${d.domain}: exclude without a reason`).toBeGreaterThan(0);
      }
    }
  });

  it("6. vacuity floors: the population is real and contains the anchor tables by name", () => {
    expect(CANDIDATES.size).toBeGreaterThanOrEqual(DSAR_CANDIDATE_FLOOR);
    // The candidate set is a strict subset of a much larger table population.
    expect(POPULATION.size).toBeGreaterThan(CANDIDATES.size);

    const ANCHORS = ["users", "leads", "notes", "lead_consent_events", "properties", "payments", "conversations", "support_tickets"];
    for (const name of ANCHORS) expect(POPULATION.has(name), `anchor table ${name} missing from the population`).toBe(true);
    // Every anchor the predicate must catch by construction IS a candidate.
    // (payments has no PII-named column and no subject FK — it is in the
    // population and decided via loan_payments, not a predicate hit.)
    for (const name of ["users", "leads", "notes", "lead_consent_events", "properties", "conversations", "support_tickets"]) {
      expect(CANDIDATES.has(name), `anchor table ${name} is not a candidate`).toBe(true);
    }

    // Per-arm vacuity: each arm alone finds real tables. An arm whose parser
    // silently stopped matching would read as "nothing to decide".
    const only = (arm: Arm) => candidateNames({ disabled: new Set<Arm>((["pii_name", "subject_fk", "registry"] as Arm[]).filter((a) => a !== arm)) });
    expect(only("pii_name").has("users")).toBe(true);
    expect(only("subject_fk").has("lead_consent_events")).toBe(true);
    expect(only("registry").has("organizations")).toBe(true);
    // Registry-arm anchor is organizations, not support_tickets: the
    // CLASSIFICATION_REGISTRY's support_tickets entries name columns
    // (body, requester_email) the current table does not have — registry
    // drift, measured 2026-11-09. support_tickets is still a candidate via
    // the subject_fk arm (its user_id column) and is decided in DSAR_DOMAINS,
    // so coverage does not depend on the stale entries.
    expect(only("pii_name").size).toBeGreaterThan(10);
    expect(only("subject_fk").size).toBeGreaterThan(10);
  });

  describe("7. canaries — the predicate catches the semantic defect, arm by arm", () => {
    // Canaries live in THIS test file, never in shared/ (table-count ratchet, design §8).
    const piiCanary = pgTable("dsar_canary_table", { id: serial("id"), contactEmail: text("contact_email") });
    const leadRefCanary = pgTable("dsar_canary_lead_ref", {
      id: serial("id"),
      leadId: integer("lead_id").references(() => schema.leads.id),
    });
    // FK-only: no subject-named column, so only the FK sub-arm can catch it.
    const fkOnlyCanary = pgTable("dsar_canary_fk_only", {
      id: serial("id"),
      ownerRef: text("owner_ref").references(() => schema.users.id),
    });
    // Registry-only: an innocuous column name the registry variant classifies.
    const registryCanary = pgTable("dsar_canary_registry", { id: serial("id"), blob: text("blob") });
    const canaryRegistry: Record<string, DataClass> = { ...CLASSIFICATION_REGISTRY, "dsar_canary_registry.blob": "pii" };

    it("both design canaries are candidates and would be reported undecided", () => {
      expect(isCandidate(piiCanary)).toBe(true);
      expect(isCandidate(leadRefCanary)).toBe(true);
      expect(reportedUndecided("dsar_canary_table", piiCanary)).toBe(true);
      expect(reportedUndecided("dsar_canary_lead_ref", leadRefCanary)).toBe(true);
    });

    it("disabling arm (a) flips the PII-name canary and only it", () => {
      const off = { disabled: new Set<Arm>(["pii_name"]) };
      expect(isCandidate(piiCanary, off)).toBe(false);
      expect(isCandidate(leadRefCanary, off)).toBe(true);
    });

    it("disabling arm (b) flips the subject-link canaries and only them", () => {
      const off = { disabled: new Set<Arm>(["subject_fk"]) };
      expect(isCandidate(fkOnlyCanary)).toBe(true);
      expect(isCandidate(leadRefCanary, off)).toBe(false);
      expect(isCandidate(fkOnlyCanary, off)).toBe(false);
      expect(isCandidate(piiCanary, off)).toBe(true);
    });

    it("disabling arm (c) flips the registry canary and only it", () => {
      expect(isCandidate(registryCanary)).toBe(false); // not in the real registry
      expect(isCandidate(registryCanary, { registry: canaryRegistry })).toBe(true);
      expect(reportedUndecided("dsar_canary_registry", registryCanary, { registry: canaryRegistry })).toBe(true);
      const off = { registry: canaryRegistry, disabled: new Set<Arm>(["registry"]) };
      expect(isCandidate(registryCanary, off)).toBe(false);
      expect(isCandidate(piiCanary, off)).toBe(true);
    });
  });
});
