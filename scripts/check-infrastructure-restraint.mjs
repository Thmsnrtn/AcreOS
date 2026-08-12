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
// repo PASSES today (165 dependencies, zero non-canonical infrastructure), and
// this exists so the first line of a `npm install neo4j-driver` conversation is
// a failing build rather than a merged PR.
//
// WHAT IT CHECKS
// ──────────────
//   1. package.json dependencies + devDependencies against the banned list.
//   2. Deploy/infra config (fly*.toml, docker-compose*.yml, k8s manifests) for
//      the same primitives.
//
// Anything matched must appear in REGISTERED_EXCEPTIONS with a written measured
// need. The exception list ratchets DOWN: a stale entry (the dependency is gone)
// FAILS, so the allowlist cannot rot the way an unmaintained one always does.
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
// Exit codes: 0 = clean; 1 = an unregistered primitive, or a stale exception.
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
// Currently EMPTY, and that is the honest state: 165 dependencies, zero banned
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

function main() {
  const violations = [];

  // ── 1. Dependencies ────────────────────────────────────────────────────
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  const deps = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ];
  for (const dep of deps) {
    for (const banned of BANNED) {
      if (banned.dep.test(dep)) {
        violations.push({ id: banned.id, where: `package.json:${dep}`, rule: banned.rule });
      }
    }
  }

  // ── 2. Deploy / infra config ───────────────────────────────────────────
  for (const rel of infraConfigFiles()) {
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

  // ── Report ─────────────────────────────────────────────────────────────
  console.log(
    `[infrastructure-restraint] scanned ${deps.length} dependencies + ` +
      `${infraConfigFiles().length} infra config file(s); ` +
      `banned primitives found: ${violations.length}; ` +
      `registered exceptions: ${REGISTERED_EXCEPTIONS.length}; ` +
      `unregistered: ${unregistered.length}; stale: ${stale.length}`,
  );

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

  if (unregistered.length === 0 && stale.length === 0) {
    console.log(
      "[infrastructure-restraint] PASS — no unearned infrastructure primitive.",
    );
    process.exit(0);
  }
  process.exit(1);
}

main();
