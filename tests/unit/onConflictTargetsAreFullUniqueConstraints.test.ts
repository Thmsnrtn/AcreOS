/**
 * Every ON CONFLICT target in server/ has an arbiter in the database this
 * repository builds.
 *
 * Postgres resolves `INSERT … ON CONFLICT (cols)` by inference: it needs a
 * unique index whose key columns are exactly `cols`, and a PARTIAL unique index
 * qualifies only when the statement repeats a predicate implying the index's.
 * Without one, the insert fails every time with "there is no unique or
 * exclusion constraint matching the ON CONFLICT specification" — so an
 * idempotent write that looks exactly-once in review never writes at all.
 *
 * That is what payments.transaction_id was: shared/schema.ts declared it
 * `.unique()`, migration 0023 built a partial index, and the borrower-portal
 * and ACH writers name the column alone. Migration 0262 made it a full
 * constraint; this gate is the rule that would have caught it.
 *
 * POPULATION. Every .ts under server/ (tests excluded — they hold mocks),
 * comment-stripped and PARSED with TypeScript: each `onConflictDoNothing(...)`
 * / `onConflictDoUpdate(...)` call, and each raw-SQL `ON CONFLICT` inside a
 * string or template literal (sql`…` included). Targets are resolved through
 * the file's own imports to the real Drizzle table objects. A site whose target
 * cannot be resolved FAILS — it is never skipped — and the counts per kind are
 * floored, so a parser that silently stops matching a shape goes red.
 *
 * AUTHORITY. The DDL a build applies — migrations/*.sql in byte order, then
 * scripts/migrate.mjs (the release_command), replayed with Postgres's rules
 * (tests/helpers/onConflictTargets.ts). shared/schema.ts's `.unique()` and
 * `uniqueIndex()` declarations are NOT a source: nothing in the deploy applies
 * them, so a declaration with no DDL behind it describes a database that does
 * not exist. The real-database test
 * tests/integration/paymentsTransactionIdConflict.db.test.ts checks this
 * model's verdict against Postgres's catalog for every site.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import path from "node:path";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import {
  REPO_ROOT,
  buildShippedUniqueModel,
  collectConflictSites,
  makeTableResolver,
  migrateMjsSources,
  migrationSources,
  shippedDdlSources,
  siteKey,
  sitesInSource,
  siteVerdict,
  uniqueIndexesOf,
  type ConflictSite,
  type DdlSource,
  type ShippedModel,
  type SiteCollection,
  type TableResolver,
} from "../helpers/onConflictTargets";

// This gate walks server/ and replays every migration; its cost scales with the
// repo, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

/**
 * Sites whose target has NO arbiter in the shipped DDL today. Each one is an
 * insert that fails on a database built from this repository. They predate
 * this gate and each needs its own decision (a migration adding the unique
 * index, or a target predicate matching an intended partial index), which is
 * why they are recorded here rather than changed alongside the payments fix.
 *
 * RATCHET: this register may only SHRINK. Fixing a site and leaving its entry
 * fails the "stale entry" assertion below; adding a site fails the main one.
 * Lower KNOWN_UNARBITRATED_BASELINE in the same commit as the fix.
 *
 * Key: `<file> <kind> <table>(<cols>)` → number of such sites in that file.
 */
const KNOWN_UNARBITRATED: Record<string, number> = {
  // Schema declares `.unique()`; no migration creates it.
  "server/services/modelIntelligence.ts onConflictDoUpdate openrouter_model_catalog(model_id)": 1,
  "server/services/providers/provider-registry.ts onConflictDoUpdate provider_cache(cache_key)": 1,
  "server/services/providers/attom-provider.ts raw-sql provider_cache(cache_key)": 1,
  // No unique declared anywhere for the target columns.
  "server/jobs/countyAssessorIngest.ts onConflictDoUpdate county_markets(state,county)": 1,
  "server/routes-platform-features.ts raw-sql organization_integrations(organization_id,provider)": 2,
  "server/services/buyerMatchingAI.ts onConflictDoUpdate pax_memory(organization_id,key,user_id)": 1,
  "server/services/voiceCallAI.ts onConflictDoUpdate pax_memory(organization_id,key,user_id)": 1,
  "server/services/paxRelationshipArc.ts raw-sql pax_memory(organization_id,key)": 1,
  "server/services/customerNarrative.ts onConflictDoUpdate customer_letters(organization_id,month_key)": 1,
  "server/services/data-source-broker.ts onConflictDoUpdate data_source_cache(lookup_key,data_source_id)": 1,
  "server/services/dueDiligence.ts onConflictDoUpdate parcel_snapshots(state,county,apn)": 1,
  "server/services/intelligence/coordinator.ts raw-sql intelligence_job_runs(name)": 2,
};
// 15 → 14 on 2026-10-07: Stage 1 gave the keyed Solene enqueue the partial
// index's own predicate (IDEMPOTENCY_KEY_INDEX_PREDICATE, imported from
// shared/), and the gate learned to read an imported predicate constant — see
// the "imported predicate constant" canaries below.
const KNOWN_UNARBITRATED_BASELINE = 14;

/**
 * Population floors (measured 2026-10-06). A parser that stops matching a shape
 * reads exactly like that shape being clean, so each kind is counted. Lower a
 * floor only when sites are genuinely removed, in the same commit.
 */
const FILES_SCANNED_FLOOR = 1300;
const TARGETED_SITE_FLOOR: Record<ConflictSite["kind"], number> = {
  onConflictDoNothing: 38,
  onConflictDoUpdate: 72,
  "raw-sql": 11,
};
const UNTARGETED_DO_NOTHING_FLOOR = 32;

/** The writers this gate exists for — named, so losing one is visible. */
const PAYMENT_WRITERS = [
  "server/services/borrower/portalPaymentPosting.ts",
  "server/services/achAutopay.ts",
  "server/services/achAutopay.ts",
];

function failingSites(collection: SiteCollection, model: ShippedModel): Array<{ site: ConflictSite; why: string }> {
  const out: Array<{ site: ConflictSite; why: string }> = [];
  for (const site of collection.sites) {
    if (!site.targeted && !site.unresolved) continue;
    const v = siteVerdict(site, site.table ? uniqueIndexesOf(model, site.table) : []);
    if (!v.ok) out.push({ site, why: v.why });
  }
  return out;
}

function tally(sites: ConflictSite[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const s of sites) t[siteKey(s)] = (t[siteKey(s)] ?? 0) + 1;
  return t;
}

let collection: SiteCollection;
let shipped: ShippedModel;
let resolver: TableResolver;

beforeAll(async () => {
  resolver = await makeTableResolver();
  collection = await collectConflictSites(REPO_ROOT, resolver);
  shipped = buildShippedUniqueModel(shippedDdlSources());
});

describe("ON CONFLICT targets — population", () => {
  it("reads every server file and finds every conflict shape it relies on", () => {
    expect(collection.filesScanned).toBeGreaterThanOrEqual(FILES_SCANNED_FLOOR);
    for (const [kind, floor] of Object.entries(TARGETED_SITE_FLOOR)) {
      const n = collection.sites.filter((s) => s.kind === kind && s.targeted).length;
      expect(n, `${kind} targeted sites found`).toBeGreaterThanOrEqual(floor);
    }
    const untargeted = collection.sites.filter((s) => s.kind === "onConflictDoNothing" && !s.targeted).length;
    expect(untargeted, "untargeted onConflictDoNothing() sites found").toBeGreaterThanOrEqual(UNTARGETED_DO_NOTHING_FLOOR);
  });

  it("includes the three payment writers (vacuity: the sites this gate exists for)", () => {
    const payments = collection.sites.filter(
      (s) => s.table === "payments" && s.columns?.join(",") === "transaction_id" && !s.targetWhere,
    );
    expect(payments.map((s) => s.file).sort()).toEqual([...PAYMENT_WRITERS].sort());
  });

  it("resolves every target — an unresolvable site is a failure, never a skip", () => {
    const unresolved = collection.sites.filter((s) => s.unresolved).map((s) => `${s.file}:${s.line} ${s.kind} ${s.targetText} — ${s.unresolved}`);
    expect(unresolved, unresolved.join("\n")).toEqual([]);
  });

  it("models every unique-relevant DDL statement it reads (none hidden behind a template hole)", () => {
    expect(shipped.statementsRead).toBeGreaterThan(3000);
    expect(shipped.tables.size).toBeGreaterThan(700);
    expect(shipped.notModelled, shipped.notModelled.join("\n")).toEqual([]);
  });
});

describe("ON CONFLICT targets — every target has an arbiter in the shipped DDL", () => {
  it("payments.transaction_id is a full UNIQUE constraint in the shipped DDL", () => {
    const rel = shipped.relations.get("payments_transaction_id_unique");
    expect(rel, "payments_transaction_id_unique exists").toBeDefined();
    expect(rel!.table).toBe("payments");
    expect(rel!.columns).toEqual(["transaction_id"]);
    expect(rel!.predicate).toBeNull();
    expect(rel!.constraint).toBe(true);
  });

  it("no site outside the known register lacks an arbiter", () => {
    const failing = failingSites(collection, shipped);
    const counts = tally(failing.map((f) => f.site));
    const unexpected = failing.filter((f) => (counts[siteKey(f.site)] ?? 0) > (KNOWN_UNARBITRATED[siteKey(f.site)] ?? 0));
    expect(
      unexpected.map((f) => `${f.site.file}:${f.site.line} ${f.site.kind} ${f.site.targetText}\n    ${f.why}`),
      "ON CONFLICT target with no full unique constraint/index in migrations/*.sql + scripts/migrate.mjs. " +
        "Add the unique constraint in a migration (mirrored in migrate.mjs), or — for an intended partial " +
        "index — give the call the matching target predicate (onConflictDoNothing `where`, onConflictDoUpdate `targetWhere`).",
    ).toEqual([]);
  });

  it("the known register is exact and only shrinks (a fixed site must leave it)", () => {
    const counts = tally(failingSites(collection, shipped).map((f) => f.site));
    const stale = Object.entries(KNOWN_UNARBITRATED)
      .filter(([key, n]) => (counts[key] ?? 0) < n)
      .map(([key, n]) => `${key}: registered ${n}, failing ${counts[key] ?? 0}`);
    expect(stale, "stale register entries — remove them and lower KNOWN_UNARBITRATED_BASELINE").toEqual([]);
    const total = Object.values(KNOWN_UNARBITRATED).reduce((a, b) => a + b, 0);
    expect(total).toBe(KNOWN_UNARBITRATED_BASELINE);
    expect(KNOWN_UNARBITRATED_BASELINE).toBeLessThanOrEqual(14);
  });
});

describe("ON CONFLICT targets — the gate goes red on the defect it names", () => {
  it("without migration 0262 and its migrate.mjs mirror, exactly the three payment writers fail", () => {
    const without = shippedDdlSources().filter(
      (s) => s.label !== "migrations/0262_payments_transaction_id_constraint.sql" && !s.sql.includes("$mig0262$"),
    );
    // Vacuity: the mutation removed something from each source family.
    expect(without.length).toBe(shippedDdlSources().length - 2);
    expect(migrationSources().some((s) => s.label.includes("0262_"))).toBe(true);
    expect(migrateMjsSources().some((s) => s.sql.includes("$mig0262$"))).toBe(true);

    const mutant = buildShippedUniqueModel(without);
    const newlyFailing = failingSites(collection, mutant).filter(
      (f) => !failingSites(collection, shipped).some((g) => g.site.file === f.site.file && g.site.line === f.site.line),
    );
    expect(newlyFailing.map((f) => f.site.file).sort()).toEqual([...PAYMENT_WRITERS].sort());
    for (const f of newlyFailing) expect(f.why).toMatch(/WHERE "transaction_id" IS NOT NULL.*has no predicate/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Canaries: one fixture per shape the extractor and the DDL model rely on.
// Each runs through the same code path as the repository's files.
// ─────────────────────────────────────────────────────────────────────────────

const FIXTURE_FILE = path.join(REPO_ROOT, "server", "__onConflictCanary__.ts");
const PAYMENTS_TABLE = `CREATE TABLE "payments" ("id" serial PRIMARY KEY NOT NULL, "organization_id" integer NOT NULL, "transaction_id" text);`;
const MAILING_TABLE = `CREATE TABLE "mailing_orders" ("id" serial PRIMARY KEY NOT NULL, "organization_id" integer NOT NULL, "operation_key" text);`;
const PARTIAL = `CREATE UNIQUE INDEX IF NOT EXISTS "payments_transaction_id_unique" ON "payments" ("transaction_id") WHERE "transaction_id" IS NOT NULL;`;
const FULL_CONSTRAINT = `ALTER TABLE "payments" ADD CONSTRAINT "payments_transaction_id_unique" UNIQUE ("transaction_id");`;

function model(...sql: string[]): ShippedModel {
  return buildShippedUniqueModel(sql.map((s, i): DdlSource => ({ label: `fixture-${i}.sql`, sql: s })));
}

async function sites(body: string, imports = `import { payments, mailingOrders } from "@shared/schema";\nimport { sql, isNotNull } from "drizzle-orm";\n`): Promise<ConflictSite[]> {
  return sitesInSource(FIXTURE_FILE, imports + body, resolver);
}

async function verdictOf(body: string, m: ShippedModel): Promise<boolean> {
  const found = (await sites(body)).filter((s) => s.targeted || s.unresolved);
  expect(found, "the fixture holds exactly one targeted site").toHaveLength(1);
  return siteVerdict(found[0], found[0].table ? uniqueIndexesOf(m, found[0].table) : []).ok;
}

describe("canary — single-column target", () => {
  const call = `db.insert(payments).values(v).onConflictDoNothing({ target: payments.transactionId });`;

  it("resolves to payments(transaction_id)", async () => {
    const [s] = await sites(call);
    expect(s).toMatchObject({ kind: "onConflictDoNothing", table: "payments", columns: ["transaction_id"], targetWhere: null, targeted: true });
  });
  it("partial index only → red", async () => {
    expect(await verdictOf(call, model(PAYMENTS_TABLE, PARTIAL))).toBe(false);
  });
  it("full constraint → green; full unique index → green", async () => {
    expect(await verdictOf(call, model(PAYMENTS_TABLE, FULL_CONSTRAINT))).toBe(true);
    expect(await verdictOf(call, model(PAYMENTS_TABLE, `CREATE UNIQUE INDEX "x" ON "payments" ("transaction_id");`))).toBe(true);
  });
  it("partial index then the 0262 DO block → green; replayed twice → still green", async () => {
    const fix = migrationSources().find((s) => s.label.includes("0262_"))!.sql;
    expect(await verdictOf(call, model(PAYMENTS_TABLE, PARTIAL, fix))).toBe(true);
    expect(await verdictOf(call, model(PAYMENTS_TABLE, PARTIAL, fix, fix))).toBe(true);
  });
  it("Postgres ordering rules decide the answer", async () => {
    // A later IF NOT EXISTS with a taken name does nothing: the partial one stands.
    expect(await verdictOf(call, model(PAYMENTS_TABLE, PARTIAL, `CREATE UNIQUE INDEX IF NOT EXISTS "payments_transaction_id_unique" ON "payments" ("transaction_id");`))).toBe(false);
    // Dropped constraint → red.
    expect(await verdictOf(call, model(PAYMENTS_TABLE, FULL_CONSTRAINT, `ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_transaction_id_unique";`))).toBe(false);
    // DROP INDEX cannot drop a constraint's index → still green.
    expect(await verdictOf(call, model(PAYMENTS_TABLE, FULL_CONSTRAINT, `DROP INDEX IF EXISTS "payments_transaction_id_unique";`))).toBe(true);
    // CREATE TABLE IF NOT EXISTS on an existing table applies none of its inline constraints.
    expect(await verdictOf(call, model(PAYMENTS_TABLE, `CREATE TABLE IF NOT EXISTS "payments" ("id" serial PRIMARY KEY, "transaction_id" text UNIQUE);`))).toBe(false);
    // DROP COLUMN takes its index with it.
    expect(await verdictOf(call, model(PAYMENTS_TABLE, FULL_CONSTRAINT, `ALTER TABLE "payments" DROP COLUMN "transaction_id";`))).toBe(false);
    // An index on a table that does not exist yet errors; it does not exist later.
    expect(await verdictOf(call, model(`CREATE UNIQUE INDEX "x" ON "payments" ("transaction_id");`, PAYMENTS_TABLE))).toBe(false);
    // A DEFERRABLE constraint is never an arbiter.
    expect(await verdictOf(call, model(PAYMENTS_TABLE, `ALTER TABLE "payments" ADD CONSTRAINT "t_u" UNIQUE ("transaction_id") DEFERRABLE INITIALLY DEFERRED;`))).toBe(false);
    // DDL inside a comment or a string is not DDL.
    expect(await verdictOf(call, model(PAYMENTS_TABLE, `-- ${FULL_CONSTRAINT}\nDO $$ BEGIN RAISE NOTICE '${FULL_CONSTRAINT.replace(/"/g, "")}'; END $$;`))).toBe(false);
  });
  it("migrate.mjs's retry pass: an index whose table comes later in the file still lands", async () => {
    const m = buildShippedUniqueModel([
      { label: "scripts/migrate.mjs:1", sql: `CREATE UNIQUE INDEX IF NOT EXISTS "x" ON "payments" ("transaction_id")` },
      { label: "scripts/migrate.mjs:2", sql: PAYMENTS_TABLE },
    ]);
    expect(await verdictOf(call, m)).toBe(true);
  });
});

describe("canary — array target", () => {
  const call = `await db.insert(mailingOrders).values(v).onConflictDoUpdate({ target: [mailingOrders.organizationId, mailingOrders.operationKey], set: { status: "x" } });`;

  it("resolves to mailing_orders(organization_id, operation_key)", async () => {
    const [s] = await sites(call);
    expect(s).toMatchObject({ kind: "onConflictDoUpdate", table: "mailing_orders", columns: ["organization_id", "operation_key"] });
  });
  it("full composite index (any column order) → green", async () => {
    expect(await verdictOf(call, model(MAILING_TABLE, `CREATE UNIQUE INDEX "u" ON "mailing_orders" ("operation_key", "organization_id");`))).toBe(true);
  });
  it("index on a subset, a superset, or partial → red", async () => {
    expect(await verdictOf(call, model(MAILING_TABLE, `CREATE UNIQUE INDEX "u" ON "mailing_orders" ("organization_id");`))).toBe(false);
    expect(await verdictOf(call, model(MAILING_TABLE, `CREATE UNIQUE INDEX "u" ON "mailing_orders" ("organization_id", "operation_key", "id");`))).toBe(false);
    expect(await verdictOf(call, model(MAILING_TABLE, `CREATE UNIQUE INDEX "u" ON "mailing_orders" ("organization_id", "operation_key") WHERE "operation_key" IS NOT NULL;`))).toBe(false);
  });
});

describe("canary — target with a target predicate", () => {
  const partial = model(PAYMENTS_TABLE, PARTIAL);

  it("onConflictDoNothing `where` matching the partial index → green", async () => {
    expect(await verdictOf(`db.insert(payments).values(v).onConflictDoNothing({ target: payments.transactionId, where: sql\`\${payments.transactionId} IS NOT NULL\` });`, partial)).toBe(true);
    expect(await verdictOf(`db.insert(payments).values(v).onConflictDoNothing({ target: payments.transactionId, where: isNotNull(payments.transactionId) });`, partial)).toBe(true);
  });
  it("onConflictDoUpdate `targetWhere` matching → green", async () => {
    expect(await verdictOf(`db.insert(payments).values(v).onConflictDoUpdate({ target: payments.transactionId, targetWhere: sql\`\${payments.transactionId} IS NOT NULL\`, set: { status: "x" } });`, partial)).toBe(true);
  });
  it("onConflictDoUpdate `where` is the SET predicate, not the target's → red", async () => {
    expect(await verdictOf(`db.insert(payments).values(v).onConflictDoUpdate({ target: payments.transactionId, where: sql\`\${payments.transactionId} IS NOT NULL\`, set: { status: "x" } });`, partial)).toBe(false);
  });
  it("a predicate that differs from the index's → red", async () => {
    expect(await verdictOf(`db.insert(payments).values(v).onConflictDoNothing({ target: payments.transactionId, where: sql\`\${payments.organizationId} IS NOT NULL\` });`, partial)).toBe(false);
  });
});

describe("canary — imported predicate constant", () => {
  // The shape solene/dispatchQueue.ts uses: the partial index and the conflict
  // target share one exported `sql` constant, so the predicate is an identifier.
  const DISPATCH_TABLE = `CREATE TABLE "solene_dispatch_queue" ("id" serial PRIMARY KEY NOT NULL, "idempotency_key" text);`;
  const imports = `import { soleneDispatchQueue, IDEMPOTENCY_KEY_INDEX_PREDICATE } from "@shared/schema/solene-dispatch";\n`;
  const call = `db.insert(soleneDispatchQueue).values(v).onConflictDoNothing({ target: soleneDispatchQueue.idempotencyKey, where: IDEMPOTENCY_KEY_INDEX_PREDICATE });`;
  const verdict = async (body: string, m: ShippedModel) => {
    const found = (await sites(body, imports)).filter((x) => x.targeted || x.unresolved);
    expect(found).toHaveLength(1);
    return siteVerdict(found[0], found[0].table ? uniqueIndexesOf(m, found[0].table) : []).ok;
  };

  it("renders the constant's SQL as the target predicate", async () => {
    const [x] = (await sites(call, imports)).filter((y) => y.targeted);
    expect(x.targetWhere).toBe("idempotency_key IS NOT NULL");
  });
  it("matching partial index → green; a different predicate → red; no predicate → red", async () => {
    const partial = (pred: string) =>
      model(DISPATCH_TABLE, `CREATE UNIQUE INDEX "solene_dispatch_queue_idempotency_key_uq" ON "solene_dispatch_queue" ("idempotency_key") WHERE ${pred};`);
    expect(await verdict(call, partial(`"idempotency_key" IS NOT NULL`))).toBe(true);
    expect(await verdict(call, partial(`"id" IS NOT NULL`))).toBe(false);
    const bare = `db.insert(soleneDispatchQueue).values(v).onConflictDoNothing({ target: soleneDispatchQueue.idempotencyKey });`;
    expect(await verdict(bare, partial(`"idempotency_key" IS NOT NULL`))).toBe(false);
  });
  it("an identifier that is not an imported sql constant stays unparsed (red)", async () => {
    const local = `const P = pick();\ndb.insert(soleneDispatchQueue).values(v).onConflictDoNothing({ target: soleneDispatchQueue.idempotencyKey, where: P });`;
    const [x] = (await sites(local, imports)).filter((y) => y.targeted);
    expect(x.targetWhere).toBe("<unparsed predicate>");
  });
});

describe("canary — resolution and raw SQL", () => {
  it("an aliased import and a destructured dynamic import both resolve", async () => {
    const aliased = await sitesInSource(FIXTURE_FILE, `import { payments as p } from "@shared/schema";\ndb.insert(p).values(v).onConflictDoNothing({ target: p.transactionId });`, resolver);
    expect(aliased[0]).toMatchObject({ table: "payments", columns: ["transaction_id"] });
    const dynamic = await sitesInSource(FIXTURE_FILE, `async function f() { const { payments: pay } = await import("@shared/schema"); await db.insert(pay).values(v).onConflictDoNothing({ target: pay.transactionId }); }`, resolver);
    expect(dynamic[0]).toMatchObject({ table: "payments", columns: ["transaction_id"] });
  });
  it("a target the gate cannot name is reported unresolved, not skipped", async () => {
    const shapes = [
      `db.insert(payments).values(v).onConflictDoNothing({ target: someColumn });`,
      `db.insert(payments).values(v).onConflictDoNothing({ target: notImported.transactionId });`,
      `db.insert(payments).values(v).onConflictDoUpdate({ ...config, set: {} });`,
      `db.insert(payments).values(v).onConflictDoUpdate(config);`,
      `db.insert(payments).values(v).onConflictDoNothing({ target: payments.notAColumn });`,
    ];
    for (const body of shapes) {
      const found = await sites(body);
      expect(found, body).toHaveLength(1);
      expect(found[0].unresolved, body).toBeTruthy();
      expect(siteVerdict(found[0], []).ok, body).toBe(false);
    }
  });
  it("`as any` around the config does not hide the target", async () => {
    const [s] = await sites(`db.insert(payments).values(v).onConflictDoUpdate({ target: payments.transactionId, set: {} } as any);`);
    expect(s).toMatchObject({ table: "payments", columns: ["transaction_id"] });
    expect(s.unresolved).toBeUndefined();
  });
  it("raw SQL: literal table, interpolated table, target predicate, and untargeted", async () => {
    // The tag is joined at run time: these are fixtures for the parser, and a
    // literal tagged template here would read as a real query to the raw-SQL
    // column gate (rawSqlColumnsExist.test.ts), which also scans tests/.
    const tag = ["s", "q", "l"].join("");
    const lit = await sites("await db.execute(" + tag + "`INSERT INTO payments (transaction_id) VALUES (${t}) ON CONFLICT (transaction_id) DO NOTHING`);");
    expect(lit[0]).toMatchObject({ kind: "raw-sql", table: "payments", columns: ["transaction_id"], targetWhere: null });
    expect(siteVerdict(lit[0], uniqueIndexesOf(model(PAYMENTS_TABLE, PARTIAL), "payments")).ok).toBe(false);

    const interp = await sites("await db.execute(" + tag + "`INSERT INTO ${payments} (transaction_id) VALUES (${t}) ON CONFLICT (transaction_id) DO NOTHING`);");
    expect(interp[0]).toMatchObject({ kind: "raw-sql", table: "payments", columns: ["transaction_id"] });

    const pred = await sites("await pool.query(`INSERT INTO payments (transaction_id) VALUES ($1) ON CONFLICT (transaction_id) WHERE transaction_id IS NOT NULL DO NOTHING`);");
    expect(siteVerdict(pred[0], uniqueIndexesOf(model(PAYMENTS_TABLE, PARTIAL), "payments")).ok).toBe(true);

    const none = await sites("await pool.query(`INSERT INTO payments (transaction_id) VALUES ($1) ON CONFLICT DO NOTHING`);");
    expect(none[0]).toMatchObject({ kind: "raw-sql", targeted: false });
  });
  it("a comment is never a site", async () => {
    const found = await sites(
      `// db.insert(payments).values(v).onConflictDoNothing({ target: payments.transactionId });\n/* INSERT INTO payments (transaction_id) VALUES (1) ON CONFLICT (transaction_id) DO NOTHING */\nconst x = 1;`,
    );
    expect(found).toEqual([]);
  });
});
