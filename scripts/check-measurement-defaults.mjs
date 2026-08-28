#!/usr/bin/env node
/**
 * check-measurement-defaults — a MEASUREMENT may not be replaced by a constant.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The standing rule is "no invented numbers, no fake activity, no placeholder
 * data presented as real". The gate that claimed to enforce it,
 * `lint:no-fabrication`, scans for `Math.random`. So it proves *randomness is
 * absent* and says nothing about the far more common shape:
 *
 *     marketData?.avgDaysOnMarket || 90
 *     compsMedianPricePerAcre || 1000
 *     parcel.acreage ?? 5
 *     latestMetric.marketHealthScore || 50
 *
 * A value READ FROM A DATA SOURCE, missing, replaced by a plausible constant,
 * and then rendered to a customer as a measurement. Four of these reached live
 * customer surfaces before this gate existed: a $1,000/acre baseline inside a
 * billable AVM, "Average days on market: 90" in a market intelligence report,
 * a five-acre assumption driving three dollar offer amounts, and a one-acre
 * assumption driving an offer batch.
 *
 * This is the first law applied to the no-fabrication rule: the old gate was
 * falsified against a SYMBOL (`Math.random`); this one is falsified against the
 * BEHAVIOUR (a measured field silently becoming a constant).
 *
 * ── THE DISCRIMINATOR ───────────────────────────────────────────────────────
 * Not every `?? N` is a lie. The question is where the value came from:
 *
 *     opts.days ?? 30                    a caller-supplied knob. Normal.
 *     marketData?.avgDaysOnMarket || 90  a measurement. Fabrication.
 *
 * So a hit needs ALL of:
 *   1. a property access (`a.b`, `a?.b.c`) — not a bare local;
 *   2. a NON-ZERO numeric literal on the right (0 is the honest empty, and is
 *      also the standard divide-by-zero guard);
 *   3. a leaf name in the measurement vocabulary (rate/score/price/days/…);
 *   4. a root that is NOT a caller-supplied options bag
 *      (opts/options/config/params/args/req/body/query/…).
 *
 * ── WHAT THIS GATE CANNOT SEE, STATED PLAINLY ───────────────────────────────
 * It matches PROPERTY ACCESSES. A bare local — `compsMedianPricePerAcre ||
 * 1000`, which is precisely the AVM defect — has no receiver to judge, and
 * treating every measurement-shaped identifier as a data read would fire on
 * ordinary locals throughout the codebase. Resolving a local back to the
 * property it was assigned from is dataflow, and this is a regex.
 *
 * So that class is out of scope here and is covered where it can be covered
 * behaviourally: `gbmValuationRefusal.test.ts` pins the AVM one against the
 * generated source AND the service's actual output. This limit is written down
 * rather than left for someone to discover from a false green.
 *
 * ── THE REGISTER ────────────────────────────────────────────────────────────
 * Down-only, like every ratchet here. An entry is not an endorsement — it is a
 * frozen debt. When you fix one, DELETE its line in the same commit: a
 * stale-high baseline is free headroom for the next invented number.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
/**
 * `--root DIR` scans an alternate tree, so the self-test can prove this gate
 * FIRES without writing a probe file into the real `server/services`.
 *
 * It used to do exactly that — write, run, delete — and vitest runs test files
 * in parallel, so any of the ~69 other suites that walk `server/**` could list
 * the probe and then fail to read it. That produced a RED in an unrelated test
 * with an fs stack trace. Tolerating ENOENT in the readers treats the symptom;
 * not creating and destroying files in the tree everything else is reading is
 * the fix.
 */
const rootArgIndex = process.argv.indexOf("--root");
const SCANNING_REAL_REPO = rootArgIndex === -1;
const REPO_ROOT = SCANNING_REAL_REPO
  ? resolve(__dirname, "..")
  : resolve(process.argv[rootArgIndex + 1]);
const SERVER_DIR = join(REPO_ROOT, "server");

/**
 * Matched ANYWHERE in the leaf, not anchored to its end.
 *
 * The first version anchored with `$` and missed `avgDaysOnMarket || 90` — the
 * exact expression this gate was written for — because the name ends in
 * "Market". The predicate self-test below caught it before the register was
 * frozen, which is the entire argument for a self-test that asserts both
 * directions.
 */
const MEASUREMENT_LEAF =
  /(rate|score|price|value|days|dom|percent|pct|avg|average|median|volume|velocity|growth|demand|supply|acre|acreage|yield|roi|margin|discount|rounds|probability|confidence|risk|trend|distance|population|income|equity|ltv|apr|interest|count)/i;

/** A caller-supplied bag: a default here is a documented knob, not a claim. */
const KNOB_ROOT =
  /^(opts|options|config|params|args|input|inputs|req|body|query|settings|overrides|cfg|defaults|filters|payload|ctx|data)$/i;

/** Names whose default is structurally a count/limit, never a measurement. */
const BENIGN_LEAF = /^(index|idx|len|length|size|offset|limit|page|retries|attempts|timeout|ms|port|version|id)$/i;

const EXPR =
  /([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+)\s*(\|\||\?\?)\s*(-?\d+(?:\.\d+)?)\b/g;

// ── THE REGISTER ────────────────────────────────────────────────────────────
// Key: `<file>::<expression>`. Measured 2026-08-18.
//
// Families present, so a reader can tell debt from noise:
//   • LLM-parse confidence (`parsed.confidence || 50`) — a model that stated no
//     confidence is given one. Real, but low individual consequence and the
//     largest family here.
//   • contract terms (`note.gracePeriodDays ?? 10`) — a platform default for a
//     term the note itself does not carry. `documents.ts` PRINTS it into a
//     customer PDF, which is the sharpest of these.
//   • agent/trust scores seeded at 50 — the same "neutral midpoint" pattern
//     removed from the deal feed, still present in the autopilot.
//   • market measurements (`medianHouseholdIncome ?? 50000`, `medianDomDays ??
//     180`, `pasturePerAcre || 1000`, `marketHealthScore || 50`) — the
//     highest-consequence group and the next ones to fix.
const BASELINE = new Set([
  "server/ai/validators.ts::parsed.data.confidence ?? 0.7",
  "server/jobs/landCreditScoreRecalculation.ts::f.environmental.score ?? 50",
  "server/jobs/landCreditScoreRecalculation.ts::f.legal.score ?? 50",
  "server/jobs/landCreditScoreRecalculation.ts::f.market.score ?? 50",
  "server/routes-deals.ts::offerData.closingDays ?? 30",
  "server/routes-deals.ts::offerData.offerExpirationDays ?? 10",
  "server/routes-founder-now.ts::row.urgencyScore ?? 50",
  "server/routes-micro-features.ts::a.distance ?? 99",
  "server/routes-micro-features.ts::b.distance ?? 99",
  "server/routes-scp-v2.ts::currentAgent.trustScore ?? 50",
  "server/services/achAutopay.ts::note.gracePeriodDays ?? 10",
  "server/services/acquisitionRadar.ts::parcel.market?.medianDaysOnMarket || 90",
  "server/services/agent-skills.ts::pricingOverrides?.cashPercentage ?? 25",
  "server/services/agent-skills.ts::pricingOverrides?.downPaymentPercent ?? 10",
  "server/services/agent-skills.ts::pricingOverrides?.interestRate ?? 9.9",
  "server/services/agent-skills.ts::pricingOverrides?.termsPercentage ?? 40",
  "server/services/agentDebates.ts::parsed.confidence || 50",
  "server/services/agentInitiativeV9.ts::parsed.confidence || 50",
  "server/services/aiRouter.ts::parsed.score || 8",
  "server/services/atlasMemory.ts::entry.confidence ?? 0.7",
  "server/services/autonomousDecisionExecutor.ts::item.urgencyScore ?? 50",
  "server/services/autonomyScoreV14.ts::latestSnapshot?.avgDecisionLatencyMs || 5000",
  "server/services/autopilot/economics.ts::c.valuePerSuccessUsd ?? 1",
  "server/services/autopilot/economics.ts::state.essentialReservePct ?? 0.2",
  "server/services/autopilot/narrate.ts::r.outcomeScore ?? -1",
  "server/services/bidEstimateExtractor.ts::parsed.confidence ?? 0.5",
  "server/services/cashFlowForecaster.ts::note.gracePeriodDays || 10",
  "server/services/ceoCommandBridge.ts::latest.energyScore || 50",
  "server/services/cmo/renderOrchestrator.ts::script.qualityScore ?? 70",
  "server/services/companyAgents.ts::parsed.healthScore ?? 80",
  "server/services/confidenceCascadeV14.ts::request.confidenceThreshold ?? 75",
  "server/services/core-agents.ts::parsed.confidence || 0.8",
  "server/services/core-agents.ts::parsed.score || 8",
  "server/services/dataIntelligenceEngine.ts::intel.countyRedemptionPeriodMonths ?? 12",
  "server/services/founderTodo.ts::p.escalationRate ?? 100",
  "server/services/founderTwin.ts::existing.confidence || 0.5",
  "server/services/founderWellbeing.ts::totalActions?.count || 1",
  "server/services/intent-router.ts::parsed.confidence || 0.8",
  "server/services/leadScoring.ts::profile.corporateOwnerWeight || 10",
  "server/services/leadingIndicators.ts::priorActivations?.count || 1",
  "server/services/marketPrediction.ts::latest.avgDaysOnMarket || 60",
  "server/services/negotiationOrchestrator.ts::analysis.priceFlexibility || 50",
  "server/services/negotiationOrchestrator.ts::reasoningData.acceptanceProbability || 45",
  "server/services/proactiveMonitor.ts::log.count || 1",
  "server/services/scenarioWarRoomV10.ts::parsed.accuracyScore || 50",
  "server/services/scenarioWarRoomV10.ts::parsed.confidence || 50",
  "server/services/scpGoldenSuite.ts::dbAgent.trustScore ?? 50",
  "server/services/scpLLMJudges.ts::obs.confidence ?? 0.7",
  "server/services/scpLLMJudges.ts::parsed.quality_score ?? 50",
  "server/services/scpMemorySystem.ts::ep.relevanceScore ?? 100",
  "server/services/scpMemorySystem.ts::existing.confidence ?? 50",
  "server/services/sellerIntentPredictor.ts::signals.priceFlexibility?.score || 50",
  "server/services/sellerIntentPredictor.ts::signals.urgency?.score || 50",
  "server/services/sequenceOptimizer.ts::other.replyRate || 1",
  "server/services/sequenceProcessor.ts::step.conditionDays || 3",
  "server/services/skipTracingService.ts::email.confidence || 0.7",
  "server/services/skipTracingService.ts::phone.confidence || 0.7",
  "server/services/strategicProposals.ts::p.confidence ?? 50",
  "server/services/strategicProposals.ts::s.confidence ?? 50",
  "server/services/stripeConnect.ts::invoice.attempt_count ?? 1",
  "server/services/supportBrain.ts::result.confidence || 0.5",
  "server/services/writingStyle.ts::analysis.confidenceScore || 0.5",
  "server/services/writingStyle.ts::result.confidence || 0.5",
  "server/storage/platformOpsRepo.ts::log.count || 1",
  "server/webhookHandlers.ts::invoice.attempt_count || 1",
]);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (e === "node_modules" || e === "dist") continue;
      walk(full, out);
    } else if (e.endsWith(".ts") && !e.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Blank comments without moving any line or column. */
function maskComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

const files = walk(SERVER_DIR);
const hits = [];
let expressionsConsidered = 0;

for (const file of files) {
  const rel = file.replace(REPO_ROOT + "/", "");
  let rawSrc;
  try {
    rawSrc = readFileSync(file, "utf8");
  } catch (err) {
    // This file's own self-test writes `__measurement_probe__.ts` into
    // server/services and deletes it again, and vitest runs test files in
    // parallel — so a path listed by the walk can be gone by the time it is
    // read. Crashing on ENOENT made this and its sibling gates fail
    // intermittently with an fs stack trace instead of a verdict. Skipped as
    // empty; the EXPRESSION FLOOR in the vacuity guard is what catches a walk
    // that lost enough to matter.
    if (err && err.code === "ENOENT") continue;
    throw err;
  }
  const src = maskComments(rawSrc);
  src.split("\n").forEach((line, i) => {
    EXPR.lastIndex = 0;
    let m;
    while ((m = EXPR.exec(line)) !== null) {
      const [, path, op, lit] = m;
      expressionsConsidered += 1;
      if (Number(lit) === 0) continue;
      const parts = path.split(/\??\./);
      const root = parts[0];
      const leaf = parts[parts.length - 1];
      if (BENIGN_LEAF.test(leaf)) continue;
      if (!MEASUREMENT_LEAF.test(leaf)) continue;
      if (KNOB_ROOT.test(root)) continue;
      hits.push({ key: `${rel}::${path} ${op} ${lit}`, rel, line: i + 1, path, op, lit });
    }
  });
}

const seen = new Set();
const added = [];
for (const h of hits) {
  if (BASELINE.has(h.key)) seen.add(h.key);
  else added.push(h);
}
// Under `--root` the tree is a fixture of a few files, so every baseline entry
// is trivially absent. The stale check is a claim about the REAL repository;
// running it against a fixture would report the whole register as fixed.
const stale = SCANNING_REAL_REPO ? [...BASELINE].filter((k) => !seen.has(k)) : [];

// ── VACUITY GUARD ───────────────────────────────────────────────────────────
// A scan that stops SEEING must FAIL. An expression walk that matches nothing
// reads exactly like a repo with no invented numbers in it, which is the false
// green this whole gate exists to remove.
// The floors describe the REAL repository. A `--root` fixture is a handful of
// files by design, so they are skipped there; the self-test asserts the floors
// on the real tree in its own case, which is where the claim belongs.
const vacuity = [];
if (SCANNING_REAL_REPO) {
  if (files.length < 500) vacuity.push(`only ${files.length} server files walked (expected >= 500)`);
  if (expressionsConsidered < 600)
    vacuity.push(`only ${expressionsConsidered} \`x.y ?? N\` expressions considered (expected >= 600; measured 1,635 on 2026-08-18)`);
}
if (vacuity.length > 0) {
  console.error("[measurement-defaults] FAIL (VACUITY GUARD) — this scan saw far less than it should:");
  for (const v of vacuity) console.error(`  - ${v}`);
  console.error("  A scanner that goes blind certifies everything. Do NOT lower these floors.");
  process.exit(1);
}

// ── PREDICATE SELF-TEST ─────────────────────────────────────────────────────
// The discriminator is the whole gate. If it stops separating a measurement
// from a knob, the register freezes the wrong population and the gate reads
// clean over a repo full of invented numbers. Proven both ways on every run.
const SELF_TEST = [
  { line: "const dom = marketData?.avgDaysOnMarket || 90;", expect: true },
  { line: "const income = intel.medianHouseholdIncome ?? 50000;", expect: true },
  // A bare local has no receiver to judge — see the limits note in the header.
  // Asserted as NOT firing so the boundary of this gate is itself pinned, and
  // a future change that starts matching bare locals has to face this line.
  { line: "pricePerAcreComps: compsMedianPricePerAcre || 1000,", expect: false },
  { line: "const acreage = parcel.acreage ?? 5;", expect: true },
  { line: "healthScore: latestMetric.marketHealthScore || 50,", expect: true },
  { line: "const days = opts.days ?? 30;", expect: false },        // caller knob
  { line: "const limit = req.query.limit || 50;", expect: false }, // caller knob
  { line: "const n = row.count || 0;", expect: false },            // zero is honest
  { line: "const page = state.pageSize || 25;", expect: false },   // benign leaf
];
const selfFailures = [];
for (const t of SELF_TEST) {
  EXPR.lastIndex = 0;
  let fired = false;
  let m;
  while ((m = EXPR.exec(t.line)) !== null) {
    const [, path, , lit] = m;
    if (Number(lit) === 0) continue;
    const parts = path.split(/\??\./);
    if (BENIGN_LEAF.test(parts[parts.length - 1])) continue;
    if (!MEASUREMENT_LEAF.test(parts[parts.length - 1])) continue;
    if (KNOB_ROOT.test(parts[0])) continue;
    fired = true;
  }
  if (fired !== t.expect) selfFailures.push(`${t.expect ? "MISSED" : "FALSE POSITIVE"}: ${t.line}`);
}
if (selfFailures.length > 0) {
  console.error("[measurement-defaults] FAIL (PREDICATE SELF-TEST) — the discriminator no longer separates a measurement from a caller-supplied knob:");
  for (const f of selfFailures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `[measurement-defaults] walked ${files.length} server files; ` +
    `${expressionsConsidered} \`x.y ?? N\` expressions considered; ` +
    `predicate self-test: ${SELF_TEST.length}/${SELF_TEST.length} correct`,
);
console.log(
  `[measurement-defaults] baseline ${seen.size}, new ${added.length}, stale ${stale.length} — down-only`,
);

if (added.length === 0 && stale.length === 0) {
  console.log("[measurement-defaults] PASS — no measured field newly replaced by a constant.");
  process.exit(0);
}

if (added.length > 0) {
  console.error("");
  console.error(
    "[measurement-defaults] FAIL — a value read from a data source is being " +
      "replaced by a plausible constant. Downstream cannot tell the constant " +
      "from a measurement, and neither can the customer:",
  );
  for (const h of added) console.error(`  ${h.rel}:${h.line}  ${h.path} ${h.op} ${h.lit}`);
  console.error(
    "\n  Make the absence representable — `number | null` — and let the caller " +
      "render or refuse. If the default is genuinely a documented business " +
      "term rather than a measurement, add the key to BASELINE with the reason.",
  );
}

if (stale.length > 0) {
  console.error("");
  console.error(
    "[measurement-defaults] FAIL — baseline entries that no longer match. That " +
      "is this gate working: delete the line in the same commit that fixed it. " +
      "A stale-high baseline is free headroom for the next invented number.",
  );
  for (const k of stale) console.error(`  ${k}`);
}

process.exit(1);
