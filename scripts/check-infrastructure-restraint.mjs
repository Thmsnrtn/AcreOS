#!/usr/bin/env node
// ============================================================================
// scripts/check-infrastructure-restraint.mjs
// ----------------------------------------------------------------------------
// BI152's "New Database Test", made checkable.
//
// WHY
// ───
// Canonical law 11 (shared/architecture/canon.ts): "Infrastructure complexity
// must be earned by measured need." The Master Audit names the specific
// primitives that must NOT be introduced without one (BI56, and again in BL7
// "What Not to Build Merely Because These Audits Mention It"):
//
//     graph database · vector database as the knowledge store · Kafka or other
//     streaming infrastructure · data warehouse · Kubernetes · service mesh ·
//     microservice-per-module · dedicated search cluster
//
// BI152 states the test each must pass: "A proposed new datastore must show a
// measured access/scale/reliability requirement the relational system cannot
// meet acceptably. Conceptual novelty is not sufficient." That test was prose
// only — `infrastructure-restraint` was the LAST fitness function in canon.ts
// with no automated backstop, and prose alone is what let the ">$500
// founder-only" hard stop drift out of enforcement for months.
//
// This is the backstop. It is a preventative gate, not a remediation one: the
// repo PASSES today (166 dependencies, zero non-canonical infrastructure), and
// this exists so the first line of a `npm install neo4j-driver` conversation is
// a failing build rather than a merged PR.
//
// WHAT IT CHECKS
// ──────────────
//   1. package.json dependencies + devDependencies + optionalDependencies +
//      peerDependencies against the banned list.
//   2. Deploy/infra config (fly*.toml, docker-compose*.yml, k8s manifests) for
//      the same primitives.
//
// Anything matched must appear in REGISTERED_EXCEPTIONS with a written measured
// need. The exception list ratchets DOWN: a stale entry (the dependency is gone)
// FAILS, so the allowlist cannot rot the way an unmaintained one always does.
//
// VACUITY GUARDS — why this gate cannot report "0" from an empty scan
// ───────────────────────────────────────────────────────────────────
// Every number this gate reports is a count of BAD THINGS FOUND, so a scan that
// stops seeing anything reports zero and reads as a clean bill of health. That
// failure mode is not hypothetical in this repo: `scripts/ratchet.mjs` with one
// glob root misspelled printed "PASS — all ratchets at baseline" while scanning
// ZERO files, and check-tests-typecheck congratulated the reader on 161 fixed
// errors that were really a starved tsc.
//
// The specific way THIS gate goes blind: `deps` is built from
// `pkg.dependencies` + `pkg.devDependencies` of the ROOT package.json. A
// workspaces conversion, a pnpm catalog, or dependencies hoisted into a
// sub-package empties both objects — and then a repo that just installed
// neo4j-driver in `packages/api/package.json` prints "scanned 0 dependencies …
// banned primitives found: 0" and PASSES. So:
//
//   · ANCHOR_FILES  — three real-repo files decide whether this is the real repo
//                     (floors apply) or a synthetic fixture (they do not). ALL
//                     present or NONE present; a PARTIAL set is a hard failure,
//                     because a scan reaching part of the tree and not the rest
//                     produces a zero indistinguishable from compliance.
//   · POPULATION FLOORS — the two numbers the summary line prints (dependencies
//                     scanned, infra config files scanned) each have a floor.
//                     A missing floor is impossible by construction: both are
//                     checked, and a breach exits 1.
//   · PREDICATE_SELFTEST — every dep/infra regex is proved live against inline
//                     positives and proved quiet against the ordinary stack.
//                     This is the guard for the defect the header already
//                     records once: a `\b` anchor before `@` silently made the
//                     kubernetes and elasticsearch rules UNMATCHABLE, and the
//                     gate went on printing a confident zero. Only the vitest
//                     file caught it; now the gate catches itself.
//   · MIN_BANNED_RULES — the rule table travels with this script, so its floor
//                     applies in fixture mode too. Emptying BANNED is the
//                     cheapest possible way to make this gate "pass".
//
// WHAT IT DELIBERATELY DOES NOT DO
// ────────────────────────────────
// It does not ban a Postgres EXTENSION. pgvector runs INSIDE the one primary
// relational database, so it is a derived index rather than an alternate system
// of record — which is exactly what BI57 permits ("embeddings are a
// capability-specific index only where semantic retrieval beats relational/text
// search; they do not become the primary knowledge store") and what BI61
// requires ("one primary relational database is the default; specialized stores
// are derived indexes/projections, never alternate systems of record"). A
// standalone vector SERVICE is a different thing and is banned.
//
// Exit codes: 0 = clean; 1 = an unregistered primitive, a stale exception, a
// vacuous scan (population under floor), a partial anchor set, or a dead
// predicate.
// ============================================================================

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// ----------------------------------------------------------------------------
// The banned primitives, grouped by the audit rule that bans each one.
//
// TWO match lists per rule, deliberately:
//   `dep`   — npm package names, matched against package.json. These are
//             precise (a scoped package name is unambiguous), so they can be
//             narrow. NOTE: no `\b` anchor before `@` — a word boundary does
//             not exist before a leading `@`, which silently made the
//             kubernetes and elasticsearch rules unmatchable. The tests in
//             tests/unit/infrastructureRestraint.test.ts caught exactly that.
//   `infra` — service/image names, matched against fly*.toml and
//             docker-compose*.yml. Infrastructure arrives through CONFIG at
//             least as often as through npm, and config says `image:
//             elasticsearch:8`, not `@elastic/elasticsearch`. Kept separate
//             from `dep` so a bare word like "elasticsearch" can be matched in
//             a 40-line compose file without false-positiving on prose.
// ----------------------------------------------------------------------------
const BANNED = [
  {
    id: "graph-database",
    rule: "BI17/BI107 — graph is the DOMAIN relationship model; relational stays the storage. No graph database is implied.",
    dep: /(neo4j|dgraph|arangodb|gremlin|tinkerpop|janusgraph|nebula-graph)/i,
    infra: /(neo4j|dgraph|arangodb|janusgraph|nebula-?graph)/i,
  },
  {
    id: "vector-database",
    rule: "BI57 — embeddings are a capability-specific INDEX, never the primary knowledge store. A standalone vector SERVICE is banned; a Postgres extension is not.",
    dep: /(pinecone|weaviate|qdrant|milvus|chromadb|lancedb|vespa)/i,
    infra: /(pinecone|weaviate|qdrant|milvus|chromadb)/i,
  },
  {
    id: "streaming-bus",
    rule: "BI58 — semantic domain events + a transactional outbox now; distributed streaming only after measured need.",
    dep: /(kafkajs|node-rdkafka|@confluentinc|pulsar-client|amqplib|rabbitmq|@nats-io)/i,
    infra: /(kafka|zookeeper|pulsar|rabbitmq)/i,
  },
  {
    id: "data-warehouse",
    rule: "BI64 — no warehouse pre-customer. Semantic events can feed one later when analytical scale warrants it.",
    dep: /(snowflake-sdk|@google-cloud\/bigquery|redshift-data|@clickhouse|clickhouse-client)/i,
    infra: /(snowflake|bigquery|redshift|clickhouse)/i,
  },
  {
    id: "kubernetes",
    rule: "BI56/BI65 — prefer one understandable deployment path and very low idle cost. Preserve migration seams rather than pre-building hyperscale topology.",
    dep: /(@kubernetes\/client-node|kubernetes-client|^helm$)/i,
    infra: /(kubernetes|kubectl)/i,
  },
  {
    id: "service-mesh",
    rule: "BI56 — a service mesh presumes a service topology this repo deliberately does not have (BI59: modular monolith).",
    dep: /(istio|linkerd|consul-connect|envoy-control)/i,
    infra: /(istio|linkerd|envoyproxy)/i,
  },
  {
    id: "search-cluster",
    rule: "BI62 — start with database/native search. A dedicated cluster becomes justified by MEASURED corpus, relevance or latency requirements.",
    dep: /(@elastic\/elasticsearch|@opensearch-project|algoliasearch|meilisearch|typesense)/i,
    infra: /(elasticsearch|opensearch|meilisearch|typesense)/i,
  },
];

// ----------------------------------------------------------------------------
// REGISTERED EXCEPTIONS — a primitive that IS present and HAS a measured need.
//
// Adding an entry is a deliberate architectural act. `need` must state the
// MEASURED requirement the relational system cannot meet, not a conceptual
// benefit (BI152: "conceptual novelty is not sufficient"). A stale entry fails
// this gate, so the list cannot rot.
//
// Currently EMPTY, and that is the honest state: 166 dependencies, zero banned
// infrastructure primitives. pgvector is present in fly.pgvector.staging.toml
// but is a POSTGRES EXTENSION, not a standalone vector service, so no rule
// matches it — see the header note.
// ----------------------------------------------------------------------------
const REGISTERED_EXCEPTIONS = [
  // {
  //   id: "search-cluster",
  //   where: "package.json:@elastic/elasticsearch",
  //   need: "Measured: p95 parcel search 2.4s over 4.1M rows with pg_trgm ...",
  //   decidedBy: "founder decision YYYY-MM-DD, docs/adr/NNN-....md",
  // },
];

// ----------------------------------------------------------------------------
// ANCHOR FILES — how this gate knows it is looking at the real repo.
//
// tests/unit/infrastructureRestraint.test.ts drives this REAL script against
// synthetic repos (a temp dir holding a doctored package.json and this script
// copied into <dir>/scripts/), and those repos legitimately have 0–7
// dependencies. So the floors cannot be unconditional. They key on files that
// exist in the real tree and in no fixture:
//
//   all three present → REAL repo → floors apply
//   none present      → fixture   → floors skipped, and the run SAYS SO
//   some present      → FAIL      → the scan sees part of the real tree and not
//                                   the rest. Either something was deleted or
//                                   renamed without updating this gate, or the
//                                   walker is broken. Both make the zero below
//                                   meaningless. No env-var escape hatch: an
//                                   opt-out flag is a bypass with a nicer name.
// ----------------------------------------------------------------------------
const ANCHOR_FILES = [
  "CLAUDE.md",
  join("shared", "architecture", "canon.ts"), // canon.ts names this script as law 11's enforcement
  join("server", "index.ts"),
];

// ----------------------------------------------------------------------------
// POPULATION FLOORS — vacuity guards, NOT ratchets.
//
// Both numbers below are SCAN POPULATIONS (how much this gate looked at), not
// findings. They are set comfortably below live so that a broken scan trips them
// while ordinary dependency pruning — which this repo wants — does not. If a
// real removal wave takes a population under its floor, LOWER THE FLOOR IN THE
// SAME COMMIT and name the wave. Never raise a floor to silence anything, and
// never delete one: an unfloored population is exactly what this guard exists to
// prevent.
//
// MEASURED 2026-08-16 against this repo, by running the gate:
//   dependencies scanned  166  (126 dependencies + 39 devDependencies +
//                               1 optionalDependencies + 0 peerDependencies —
//                               the last two buckets were UNSCANNED until this
//                               revision, so the long-quoted "165" was the size
//                               of the scan, not the size of the manifest)
//   infra config files      6  (docker-compose.test.yml, docker-compose.yml,
//                               fly.pgbouncer.toml, fly.pgvector.staging.toml,
//                               fly.staging.toml, fly.toml)
//   banned rules            7  (the BANNED table above)
// ----------------------------------------------------------------------------
const MIN_DEPENDENCIES = 120; // ~72% of the live 166
const MIN_INFRA_CONFIG_FILES = 4; // live 6; room to retire two deploy targets
const MIN_BANNED_RULES = 7; // the BANNED table ships with this file — always checked

// ----------------------------------------------------------------------------
// PREDICATE SELF-TEST — every rule proved live before any count is believed.
//
// `must` strings MUST match; `mustNot` strings (the ordinary stack) must not.
// This is the guard for the exact defect this file already survived once: a
// word-boundary before `@` made two rules unmatchable while the gate kept
// printing "banned primitives found: 0".
// ----------------------------------------------------------------------------
const ORDINARY_STACK = [
  "express",
  "drizzle-orm",
  "pg",
  "postgres",
  "pgvector", // a Postgres EXTENSION — must never trip the vector rule (BI57/BI61)
  "ioredis",
  "bullmq",
  "stripe",
  "react",
  "@neondatabase/serverless",
];
const ORDINARY_CONFIG = [
  'app = "acreos-pgvector-staging"',
  'primary_region = "iad"',
  "  image: postgres:16-alpine",
  "  image: redis:7-alpine",
];
const PREDICATE_SELFTEST = [
  { id: "graph-database", dep: ["neo4j-driver", "@dgraph-io/dgraph-js", "arangodb"], infra: ["    image: neo4j:5"] },
  { id: "vector-database", dep: ["@pinecone-database/pinecone", "weaviate-ts-client", "qdrant-js"], infra: ["    image: qdrant/qdrant:latest"] },
  { id: "streaming-bus", dep: ["kafkajs", "amqplib", "@nats-io/nats-core"], infra: ["    image: confluentinc/cp-kafka:7.5.0"] },
  { id: "data-warehouse", dep: ["snowflake-sdk", "@google-cloud/bigquery"], infra: ["    image: clickhouse/clickhouse-server"] },
  { id: "kubernetes", dep: ["@kubernetes/client-node", "kubernetes-client", "helm"], infra: ["    command: kubectl apply -f ./deploy"] },
  { id: "service-mesh", dep: ["istio-client", "linkerd-api"], infra: ["    image: istio/proxyv2:1.20"] },
  { id: "search-cluster", dep: ["@elastic/elasticsearch", "meilisearch", "typesense"], infra: ["    image: elasticsearch:8.13.0"] },
];

// ----------------------------------------------------------------------------
// Config files that describe deployed infrastructure.
// ----------------------------------------------------------------------------
function infraConfigFiles() {
  const files = [];
  for (const name of readdirSync(REPO_ROOT)) {
    if (/^fly.*\.toml$/.test(name) || /^docker-compose.*\.ya?ml$/.test(name)) {
      files.push(name);
    }
  }
  // Kubernetes manifests anywhere near the root are themselves the signal.
  for (const dir of ["k8s", "kubernetes", "charts", "deploy"]) {
    if (existsSync(join(REPO_ROOT, dir))) files.push(`${dir}/`);
  }
  return files;
}

/**
 * Prove every rule still matches what it claims to match, and still ignores the
 * ordinary stack. A dead predicate reports zero exactly like a clean repo.
 */
function runSelfTest() {
  const failures = [];
  for (const t of PREDICATE_SELFTEST) {
    const rule = BANNED.find((b) => b.id === t.id);
    if (!rule) {
      failures.push(
        `PREDICATE SELF-TEST — no BANNED rule with id "${t.id}". The rule table and its ` +
          `self-test have diverged; a rule cannot be removed silently.`,
      );
      continue;
    }
    for (const s of t.dep) {
      if (!rule.dep.test(s)) {
        failures.push(
          `PREDICATE SELF-TEST — rule "${t.id}" .dep no longer matches a known banned ` +
            `package: ${JSON.stringify(s)}. Its zero means nothing until this matches again.`,
        );
      }
    }
    for (const s of t.infra) {
      if (!rule.infra.test(s)) {
        failures.push(
          `PREDICATE SELF-TEST — rule "${t.id}" .infra no longer matches known banned ` +
            `deploy config: ${JSON.stringify(s)}.`,
        );
      }
    }
  }
  // And quiet against what must never be banned.
  for (const rule of BANNED) {
    for (const s of ORDINARY_STACK) {
      if (rule.dep.test(s) || rule.infra.test(s)) {
        failures.push(
          `PREDICATE SELF-TEST — rule "${rule.id}" now matches the ORDINARY STACK entry ` +
            `${JSON.stringify(s)}. A gate that bans the sanctioned stack gets disabled within a week.`,
        );
      }
    }
    for (const s of ORDINARY_CONFIG) {
      if (rule.infra.test(s) || rule.dep.test(s)) {
        failures.push(
          `PREDICATE SELF-TEST — rule "${rule.id}" now matches ordinary deploy config ` +
            `${JSON.stringify(s)}.`,
        );
      }
    }
  }
  return failures;
}

/** REAL repo, synthetic fixture, or a broken scan. See ANCHOR_FILES. */
function scanMode() {
  const present = ANCHOR_FILES.filter((f) => existsSync(join(REPO_ROOT, f)));
  if (present.length === ANCHOR_FILES.length) return { mode: "real", present };
  if (present.length === 0) return { mode: "fixture", present };
  return { mode: "partial", present };
}

function main() {
  const violations = [];
  const hardFailures = [];

  // ── 0. Guards that must run BEFORE any count is allowed to read as clean ─
  hardFailures.push(...runSelfTest());
  if (BANNED.length < MIN_BANNED_RULES) {
    hardFailures.push(
      `VACUOUS SCAN — only ${BANNED.length} banned-primitive rule(s) (floor ${MIN_BANNED_RULES}). ` +
        `Emptying the rule table is the cheapest way to make this gate "pass"; it is not a fix.`,
    );
  }
  const { mode, present } = scanMode();
  if (mode === "partial") {
    hardFailures.push(
      `PARTIAL ANCHOR SET — found ${present.length}/${ANCHOR_FILES.length} anchor files ` +
        `(${present.join(", ")}). Missing: ` +
        `${ANCHOR_FILES.filter((f) => !present.includes(f)).join(", ")}. Either one was deleted ` +
        `or renamed without updating this gate, or the scan is no longer reaching the tree. ` +
        `Both make every "0" below meaningless.`,
    );
  }
  const isRealRepo = mode === "real";

  // ── 1. Dependencies ────────────────────────────────────────────────────
  // ALL FOUR manifest buckets, not just dependencies+devDependencies: a bucket
  // this gate does not read is a bucket a banned primitive can arrive in
  // unseen, and `npm i -O neo4j-driver` is not a harder thing to type.
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  const DEP_BUCKETS = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ];
  const bucketCounts = DEP_BUCKETS.map(
    (b) => `${b} ${Object.keys(pkg[b] ?? {}).length}`,
  ).join(", ");
  const deps = DEP_BUCKETS.flatMap((b) => Object.keys(pkg[b] ?? {}));

  // A manifest restructure is the documented way this scan goes blind, and a
  // floor only catches it when the ROOT manifest empties. Workspaces can keep a
  // full root manifest AND hold a sub-package this gate never opens, so the
  // restructure itself is the hard stop: teach the scan to walk the workspace
  // manifests, then remove this. Do not exempt it.
  if (pkg.workspaces !== undefined) {
    hardFailures.push(
      `UNSCANNED MANIFESTS — package.json declares "workspaces", and this gate reads the ROOT ` +
        `manifest only. Every dependency in a workspace package is invisible to it, so its ` +
        `"banned primitives found: 0" would be a statement about one file, not about the repo. ` +
        `Teach this scan to walk the workspace manifests before adopting workspaces.`,
    );
  }
  for (const dep of deps) {
    for (const banned of BANNED) {
      if (banned.dep.test(dep)) {
        violations.push({ id: banned.id, where: `package.json:${dep}`, rule: banned.rule });
      }
    }
  }

  // ── 2. Deploy / infra config ───────────────────────────────────────────
  const configFiles = infraConfigFiles();
  for (const rel of configFiles) {
    if (rel.endsWith("/")) {
      // A whole orchestration directory existing IS the violation.
      violations.push({
        id: "kubernetes",
        where: rel,
        rule: BANNED.find((b) => b.id === "kubernetes").rule,
      });
      continue;
    }
    const src = readFileSync(join(REPO_ROOT, rel), "utf8");
    for (const banned of BANNED) {
      if (banned.infra.test(src)) {
        violations.push({ id: banned.id, where: rel, rule: banned.rule });
      }
    }
  }

  // ── 3. Reconcile against the registered exceptions ─────────────────────
  const exceptionKeys = new Set(
    REGISTERED_EXCEPTIONS.map((e) => `${e.id}::${e.where}`),
  );
  const unregistered = violations.filter(
    (v) => !exceptionKeys.has(`${v.id}::${v.where}`),
  );
  const seen = new Set(violations.map((v) => `${v.id}::${v.where}`));
  const stale = REGISTERED_EXCEPTIONS.filter(
    (e) => !seen.has(`${e.id}::${e.where}`),
  );

  // ── 4. Population floors — a scan that stopped seeing things is not clean ─
  if (isRealRepo) {
    if (deps.length < MIN_DEPENDENCIES) {
      hardFailures.push(
        `VACUOUS SCAN — only ${deps.length} dependencies read from the root package.json ` +
          `(floor ${MIN_DEPENDENCIES}, live was 166 on 2026-08-16). ` +
          `\n      This is the collapse this floor exists for: a workspaces conversion, a pnpm ` +
          `catalog, or dependencies hoisted into a sub-package empties ` +
          `pkg.dependencies/devDependencies, and then EVERY npm-installed primitive is invisible ` +
          `while this gate prints "banned primitives found: 0" and passes.` +
          `\n      Fix the SCAN (teach it the new package layout). Do not lower this floor unless ` +
          `a real dependency-removal wave earned it — and then say which wave, in the same commit.`,
      );
    }
    if (configFiles.length < MIN_INFRA_CONFIG_FILES) {
      hardFailures.push(
        `VACUOUS SCAN — only ${configFiles.length} infra config file(s) found at the repo root ` +
          `(floor ${MIN_INFRA_CONFIG_FILES}, live was 6 on 2026-08-16). ` +
          `Deploy config moved out of the root — or the filename patterns stopped matching it — ` +
          `means the config half of this gate is scanning nothing, and infrastructure arrives ` +
          `through config at least as often as through npm.`,
      );
    }
  }

  // ── Report ─────────────────────────────────────────────────────────────
  console.log(
    `[infrastructure-restraint] scanned ${deps.length} dependencies + ` +
      `${configFiles.length} infra config file(s); ` +
      `banned primitives found: ${violations.length}; ` +
      `registered exceptions: ${REGISTERED_EXCEPTIONS.length}; ` +
      `unregistered: ${unregistered.length}; stale: ${stale.length}`,
  );
  const floorLine =
    `dependencies ${deps.length} (floor ${MIN_DEPENDENCIES}) [${bucketCounts}], ` +
    `infra config files ${configFiles.length} (floor ${MIN_INFRA_CONFIG_FILES})`;
  const alwaysLine =
    `banned rules ${BANNED.length} (floor ${MIN_BANNED_RULES}); ` +
    `predicate self-test: ${PREDICATE_SELFTEST.length} rules proved live`;
  if (mode === "real") {
    console.log(
      `[infrastructure-restraint] REAL REPO (all ${ANCHOR_FILES.length} anchors present) — ` +
        `populations vs floors: ${floorLine}; ${alwaysLine}`,
    );
  } else if (mode === "fixture") {
    console.log(
      `[infrastructure-restraint] SYNTHETIC FIXTURE (no anchor file present: ` +
        `${ANCHOR_FILES.join(", ")}) — population floors NOT applied; observed ${floorLine}; ` +
        `${alwaysLine}`,
    );
  } else {
    console.log(
      `[infrastructure-restraint] BROKEN SCAN (partial anchor set) — populations reported ` +
        `below are NOT trustworthy: ${floorLine}; ${alwaysLine}`,
    );
  }

  if (hardFailures.length > 0) {
    console.error(
      "[infrastructure-restraint] FAIL — the scan itself cannot be trusted, so its counts " +
        "above mean nothing:",
    );
    for (const f of hardFailures) console.error(`  ✗ ${f}`);
  }

  if (unregistered.length > 0) {
    console.error(
      "[infrastructure-restraint] FAIL — a non-canonical infrastructure primitive appeared without a measured need:",
    );
    for (const v of unregistered) {
      console.error(`  ✗ ${v.where}  [${v.id}]`);
      console.error(`      ${v.rule}`);
    }
    console.error(
      "\n  BI152, the New Database Test: a proposed new datastore must show a MEASURED\n" +
        "  access/scale/reliability requirement the relational system cannot meet\n" +
        "  acceptably. Conceptual novelty is not sufficient.\n" +
        "\n  If the need is real: add a REGISTERED_EXCEPTIONS entry in this file stating\n" +
        "  the measurement and the founder decision that authorised it. If it is not:\n" +
        "  remove the dependency. Do not soften this gate.",
    );
  }

  if (stale.length > 0) {
    console.error(
      "[infrastructure-restraint] FAIL — stale exception(s); the primitive is gone, so the entry must go too:",
    );
    for (const e of stale) console.error(`  ✗ ${e.id} :: ${e.where}`);
  }

  if (
    unregistered.length === 0 &&
    stale.length === 0 &&
    hardFailures.length === 0
  ) {
    console.log(
      "[infrastructure-restraint] PASS — no unearned infrastructure primitive.",
    );
    process.exit(0);
  }
  process.exit(1);
}

main();
