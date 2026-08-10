/**
 * Wave S · S4 — the scenario library as EXECUTABLE DOCTRINE.
 *
 * Addendum C §S4: convert "every possible scenario" from prose into a
 * maintained matrix, each row = trigger → responsible charter → playbook →
 * autonomy required → founder-touch → drill cadence. The point is that the
 * matrix is CHECKABLE, not prose:
 *
 *   • every sense trigger must resolve in SENSE_INVENTORY (senses.ts), and
 *     its wired/unwired state is DERIVED, never asserted;
 *   • every event trigger names a literal that greps verbatim in a named
 *     module (tests/unit/scenarioLibrary.test.ts reads the file and checks);
 *   • triggers no machine senses (a legal letter in the mail) are declared
 *     `human` — refuse-not-fabricate applies to trigger wiring too;
 *   • every responsibleCharter must be a real charter (charters.ts);
 *   • every runbook ref must be a real docs/runbooks file (same resolution
 *     idea as scripts/check-runbook-links.mjs, enforced by the suite);
 *   • every founderTouch:"page" row must name its REAL paging path — a
 *     critical job lane (jobRegistry resolveFailureLane === "page") or a
 *     module that actually pages — or carry an explicit declared-gap note,
 *     which renders honestly as "declared, not yet wired to a pager" and is
 *     COUNTED by the suite (the count may only shrink);
 *   • lastDrilled derives from real append-only drill ledgers where a row
 *     maps to one — else null, rendered "never drilled". Never invented.
 *     (Today NO row maps to a ledger: the only populated-format ledger,
 *     dr-drill-history.md, records the DB-restore drill specifically — and
 *     it has zero blocks anyway. The F6 game-day ledger is where scenario
 *     drills will land; until then every row is honestly never-drilled.)
 *
 * WHAT THIS MODULE IS NOT: it grants nothing. `autonomyRequired` is a
 * DECLARED REQUIREMENT — the ladder level a charter would need before it
 * could run the playbook without the founder — never a grant. The module
 * imports no autonomy mutator, writes no state, and exports only read/derive
 * functions; the suite pins that with a source scan. The Trust Ledger
 * (domainAutonomy.ts) remains the only place levels change, founder-tapped.
 *
 * Drill EXECUTION (the quarterly game-day that walks rows) is F6 and
 * founder-scheduled — this slice only derives the "drills due" count. No job
 * is registered here on purpose.
 */
import fs from "node:fs";
import path from "node:path";
import { logger } from "../../utils/logger";
import { SENSE_INVENTORY, senseIsWired } from "./senses";
import { CHARTER_DEFS, getCharterDef, type CharterDomain } from "./charters";
import { DOMAIN_AUTONOMY_LEVELS, type DomainAutonomyLevel } from "./domainAutonomy";
import { JOB_ROSTER, resolveFailureLane } from "../../jobs/jobRegistry";
import { STANDING_ORDER_KINDS } from "./standingOrders";

// ── Row shape ───────────────────────────────────────────────────────────────

export type ScenarioFounderTouch = "none" | "queue" | "page";
export type ScenarioDrillCadence = "quarterly" | "annual" | "on-change";

/**
 * How a row fires. `sense` keys into SENSE_INVENTORY (wiring derived).
 * `event` names a literal that appears verbatim in a real module — the suite
 * greps it, so a retired event kind turns the build red by name. `human` is
 * the honest form for real-world triggers no machine senses.
 */
export type ScenarioTrigger =
  | { kind: "sense"; senseKey: string; description: string }
  | { kind: "event"; literal: string; module: string; description: string }
  | { kind: "human"; description: string };

/**
 * What the responsible charter runs when the row fires. `runbook` refs a real
 * docs/runbooks file; `standing-order` refs a standing-order kind lane
 * (standingOrders.ts — the concrete orders are founder-authored DB rows);
 * `builtin` refs a module + a symbol that appears verbatim in it.
 */
export type ScenarioPlaybook =
  | { kind: "runbook"; ref: string }
  | { kind: "standing-order"; ref: string }
  | { kind: "builtin"; module: string; symbol: string };

/**
 * The real paging path behind a founderTouch:"page" row. `critical-job` must
 * resolve to the "page" lane in the job roster; `module` names a real paging
 * call site; `declared-gap` is the honest state for a page rule with no wire
 * yet — rendered as such and counted by the suite.
 */
export type ScenarioPagerWiring =
  | { kind: "critical-job"; jobName: string }
  | { kind: "module"; module: string; symbol: string }
  | { kind: "declared-gap"; note: string };

/** The append-only ledgers a row's lastDrilled may derive from (O3's list). */
export const SCENARIO_DRILL_LEDGERS = [
  "docs/runbooks/dr-drill-history.md",
  "docs/runbooks/secret-rotation-history.md",
  "docs/runbooks/break-glass-log.md",
] as const;
export type ScenarioDrillLedger = (typeof SCENARIO_DRILL_LEDGERS)[number];

export interface ScenarioRow {
  /** Stable slug — test failures and drill records cite it. */
  key: string;
  title: string;
  responsibleCharter: CharterDomain;
  trigger: ScenarioTrigger;
  playbook: ScenarioPlaybook;
  /**
   * The ladder level the charter would NEED to run this playbook without the
   * founder — a declared requirement, never a grant. "founder-only" means no
   * staff autonomy at any level, ever.
   */
  autonomyRequired: DomainAutonomyLevel | "founder-only";
  founderTouch: ScenarioFounderTouch;
  /** REQUIRED iff founderTouch === "page" (validated). */
  pagerWiring?: ScenarioPagerWiring;
  drillCadence: ScenarioDrillCadence | null;
  /**
   * Which append-only ledger proves this row's drills. null = no ledger maps
   * yet, so lastDrilled is null and renders "never drilled" — the honest
   * state until the F6 game-day ledger exists.
   */
  drillLedger: ScenarioDrillLedger | null;
  notes?: string;
}

// ── The seeded matrix (Addendum C §S4's rows, verified against HEAD) ────────

export const SCENARIO_LIBRARY: readonly ScenarioRow[] = [
  {
    key: "sev-incident",
    title: "Sev incident / failed deploy",
    responsibleCharter: "deploy",
    trigger: {
      kind: "sense",
      senseKey: "open_incidents",
      description: "Flagged dispatches spike / the health check goes red after a deploy.",
    },
    playbook: { kind: "runbook", ref: "docs/runbooks/fly-machine-failover.md" },
    autonomyRequired: "execute_gated",
    founderTouch: "page",
    pagerWiring: { kind: "critical-job", jobName: "health_check_periodic" },
    drillCadence: null,
    drillLedger: null,
    notes:
      "Solene prepares fixes through the code-change gate and never merges her own patch; " +
      "deploy/rollback hands are S3 work, so today the runbook is walked by the founder.",
  },
  {
    key: "support-surge",
    title: "Support surge",
    responsibleCharter: "support",
    trigger: {
      kind: "sense",
      senseKey: "support_backlog",
      description: "Open + escalated support cases climb past the normal backlog.",
    },
    playbook: {
      kind: "builtin",
      module: "server/services/autopilot/supportPlaybook.ts",
      symbol: "supportPlayRationale",
    },
    autonomyRequired: "draft",
    founderTouch: "queue",
    drillCadence: null,
    drillLedger: null,
    notes: "Grounded replies only (refuse-not-fabricate); severity-class SLA breaches land in the founder queue.",
  },
  {
    key: "deliverability-spike",
    title: "Deliverability complaint spike",
    responsibleCharter: "ops",
    trigger: {
      kind: "sense",
      senseKey: "email_complaints",
      description: "Spam complaints / bounces spike across the mail rails.",
    },
    playbook: { kind: "runbook", ref: "docs/runbooks/05-mass-email-bounces-spike.md" },
    autonomyRequired: "execute_gated",
    founderTouch: "queue",
    drillCadence: null,
    drillLedger: null,
  },
  {
    key: "failed-payment-wave",
    title: "Failed-payment wave",
    responsibleCharter: "finance",
    trigger: {
      kind: "sense",
      senseKey: "dunning_pressure",
      description: "Failed payments awaiting recovery pile up in one window.",
    },
    playbook: { kind: "runbook", ref: "docs/runbooks/02-payment-card-failed.md" },
    autonomyRequired: "execute_gated",
    founderTouch: "queue",
    drillCadence: null,
    drillLedger: null,
    notes: "The dunning-action hand exists and is witnessed today — recovery runs on your taps until finance earns the gated rung.",
  },
  {
    key: "churn-cluster",
    title: "Churn signal cluster",
    responsibleCharter: "support",
    trigger: {
      kind: "sense",
      senseKey: "churn_signals",
      description: "Cancellations and disputes cluster inside a day.",
    },
    playbook: {
      kind: "builtin",
      module: "server/services/autopilot/lifecyclePlaybook.ts",
      symbol: "selectLifecyclePlay",
    },
    autonomyRequired: "draft",
    founderTouch: "queue",
    drillCadence: null,
    drillLedger: null,
  },
  {
    key: "trial-ending-cohort",
    title: "Trial-ending cohort",
    responsibleCharter: "growth",
    trigger: {
      kind: "sense",
      senseKey: "trials_ending",
      description: "A cohort of trials enters its closing window.",
    },
    playbook: {
      kind: "builtin",
      module: "server/services/autopilot/lifecyclePlaybook.ts",
      symbol: "selectLifecyclePlay",
    },
    autonomyRequired: "execute_gated",
    founderTouch: "none",
    drillCadence: null,
    drillLedger: null,
  },
  {
    key: "vendor-key-lapse",
    title: "Vendor key lapse (dated obligation)",
    responsibleCharter: "compliance",
    trigger: {
      kind: "event",
      literal: "imminentObligations",
      module: "server/services/datedObligations.ts",
      description: "A registered obligation (sole-source vendor key, statute re-review) enters its countdown window.",
    },
    playbook: {
      kind: "builtin",
      module: "server/services/founderBriefing.ts",
      symbol: "imminentObligations",
    },
    autonomyRequired: "founder-only",
    founderTouch: "page",
    pagerWiring: { kind: "module", module: "server/services/founderBriefing.ts", symbol: "imminentObligations" },
    drillCadence: null,
    drillLedger: null,
    notes: "Renewal is keyed-env founder work; the machine's whole playbook is the honest countdown at 14/7/2/0 days.",
  },
  {
    key: "legal-letter",
    title: "Legal letter / subpoena",
    responsibleCharter: "compliance",
    trigger: {
      kind: "human",
      description:
        "Legal process arrives out-of-band (postal mail, registered agent, counsel email) — no machine sense exists, and claiming one would be fabrication.",
    },
    playbook: { kind: "builtin", module: "server/services/autopilot/hardStops.ts", symbol: "HARD_STOPS" },
    autonomyRequired: "founder-only",
    founderTouch: "page",
    pagerWiring: {
      kind: "declared-gap",
      note:
        "No machine path detects legal mail; the always-page rule binds whoever opens it (today: the founder himself). " +
        "The row exists so the doctrine is pre-agreed, not to pretend a wire exists.",
    },
    drillCadence: null,
    drillLedger: null,
    notes:
      "Always page + counsel path. No staff autonomy EVER — legal_signing is a hard stop forever. " +
      "DSAR-shaped demands follow docs/runbooks/gdpr-dsar-fulfilment.md; everything else goes to counsel untouched.",
  },
  {
    key: "abuse-event",
    title: "Abuse event (bad-customer ladder)",
    responsibleCharter: "compliance",
    trigger: {
      kind: "event",
      literal: "abuse_report",
      module: "server/services/decisionsInbox.ts",
      description: "An abuse report lands in the decisions queue (portal report affordance, Addendum A).",
    },
    playbook: { kind: "builtin", module: "server/services/orgTrust.ts", symbol: "resolveOrgTrustTier" },
    autonomyRequired: "founder-only",
    founderTouch: "queue",
    drillCadence: null,
    drillLedger: null,
    notes: "Enforcement ladder is warn → limit → suspend, and suspension is founder-approved (Addendum A design spine).",
  },
  {
    key: "model-provider-outage",
    title: "Model-provider outage",
    responsibleCharter: "ops",
    trigger: {
      kind: "event",
      literal: "buildOperatorModelCall",
      module: "server/services/autopilot/operator.ts",
      description: "The brain's own model provider is down or unkeyed — the Operator call fails or returns nothing usable.",
    },
    playbook: { kind: "builtin", module: "server/services/autopilot/decide.ts", symbol: "rankMoves" },
    autonomyRequired: "observe",
    founderTouch: "queue",
    drillCadence: "quarterly",
    drillLedger: null,
    notes:
      "The architecture this platform uniquely survives: the deterministic floor keeps ranking " +
      "(rules, no model call) and the reflexes keep running; a malformed or absent plan falls back to the floor. " +
      "The drill is to pull the model and watch the floor hold — then say so on the trust page.",
  },
  {
    key: "data-breach",
    title: "Data breach",
    responsibleCharter: "compliance",
    trigger: {
      kind: "human",
      description:
        "Detected by human report or anomaly review — no automated breach detector exists yet, and this row says so rather than pretending.",
    },
    playbook: { kind: "runbook", ref: "docs/runbooks/data-breach-response.md" },
    autonomyRequired: "founder-only",
    founderTouch: "page",
    pagerWiring: {
      kind: "declared-gap",
      note:
        "No automated breach detector is wired; the page is the standing rule for whoever detects one. " +
        "Customer-data actions are hard-stopped, so every response step is founder-driven by construction.",
    },
    drillCadence: "annual",
    drillLedger: null,
  },
  {
    key: "growth-opportunity",
    title: "Growth opportunity (Operator net-new)",
    responsibleCharter: "growth",
    trigger: {
      kind: "event",
      literal: "isNetNew",
      module: "server/services/autopilot/operator.ts",
      description: "The Operator authors a net-new move the catalog lacks.",
    },
    playbook: { kind: "builtin", module: "server/services/autopilot/operator.ts", symbol: "planToActions" },
    autonomyRequired: "draft",
    founderTouch: "queue",
    drillCadence: null,
    drillLedger: null,
    notes: "Net-new is marked maximally novel and forced through witnessed-send — it reaches the world only via your tap.",
  },
  {
    key: "constitution-trigger",
    title: "Constitution trigger fired",
    responsibleCharter: "compliance",
    trigger: {
      kind: "event",
      literal: "gate_ripened",
      module: "server/services/autopilot/gateWatcher.ts",
      description: "A machine-encoded roadmap gate (25/50/revenue ladder) ripens.",
    },
    playbook: { kind: "builtin", module: "server/services/autopilot/gateWatcher.ts", symbol: "runGateWatch" },
    autonomyRequired: "founder-only",
    founderTouch: "queue",
    drillCadence: null,
    drillLedger: null,
    notes: "A ripened gate becomes a founder decision memo — the ladder is the founder's to climb, never the machine's.",
  },
  {
    key: "founder-shop-day",
    title: "Founder shop-day",
    responsibleCharter: "ops",
    trigger: {
      kind: "human",
      description: "The founder is at the cabinetmaker's bench for the day — declared, not detected.",
    },
    playbook: {
      kind: "builtin",
      module: "server/services/autopilot/stepAwayReadiness.ts",
      symbol: "buildStepAwayReadiness",
    },
    autonomyRequired: "observe",
    founderTouch: "none",
    drillCadence: "quarterly",
    drillLedger: null,
    notes:
      "The Shop-Day Test (Addendum C §C.3): a simulated unreachable window against randomized rows. " +
      "The S6 interrupt contract (declared shop hours) is future work; today the readiness verdict is the playbook.",
  },
  {
    key: "founder-vacation",
    title: "Founder vacation",
    responsibleCharter: "ops",
    trigger: {
      kind: "human",
      description: "A multi-day declared absence — the long form of the shop-day.",
    },
    playbook: { kind: "runbook", ref: "docs/runbooks/08-founder-out-of-office.md" },
    autonomyRequired: "observe",
    founderTouch: "none",
    drillCadence: "annual",
    drillLedger: null,
    notes: "O7's vacation test run + deputy break-glass kit are the drill; receipts land in the break-glass ledger when run.",
  },
  {
    key: "panic-stop-resume",
    title: "Panic-stop + guided resume",
    responsibleCharter: "ops",
    trigger: {
      kind: "event",
      literal: "panicStop",
      module: "server/services/autopilot/panicStop.ts",
      description: "The founder trips the atomic panic stop (or the machine is stopped and must come back honestly).",
    },
    playbook: { kind: "builtin", module: "server/services/autopilot/guidedResume.ts", symbol: "resumePreflight" },
    autonomyRequired: "founder-only",
    founderTouch: "page",
    pagerWiring: { kind: "module", module: "server/services/autopilot/panicStop.ts", symbol: "sendSolenePage" },
    drillCadence: "quarterly",
    drillLedger: null,
    notes:
      "Resume is staged (cognition → observe → dispatch) and never restores autonomy levels — the founder re-grants from the ladder.",
  },
  {
    key: "gate-tamper",
    title: "Gate-tamper page",
    responsibleCharter: "compliance",
    trigger: {
      kind: "event",
      literal: "gate_tamper_watch",
      module: "server/jobs/jobRegistry.ts",
      description: "The gate estate's pinned manifest stops matching the files on disk.",
    },
    playbook: {
      kind: "builtin",
      module: "server/services/autopilot/gateTamperWatch.ts",
      symbol: "verifyGateManifest",
    },
    autonomyRequired: "founder-only",
    founderTouch: "page",
    pagerWiring: { kind: "critical-job", jobName: "gate_tamper_watch" },
    drillCadence: "on-change",
    drillLedger: null,
    notes: "A silent gate mutation is exactly what this pages on; the watch's own absence pages too (critical roster entry).",
  },
];

// ── Derivation rules (pure — the suite feeds these bad rows by name) ────────

const AUTONOMY_VALUES: ReadonlySet<string> = new Set([...DOMAIN_AUTONOMY_LEVELS, "founder-only"]);

/**
 * Structural derivation rules for one row. Returns violations in plain words,
 * each naming what failed. File-existence and grep checks (runbook refs,
 * builtin modules/symbols, event literals, pager modules) are enforced by
 * tests/unit/scenarioLibrary.test.ts, which reads the repo — CI has the tree;
 * a deployed image may not, so the runtime keeps to registry-resolvable rules.
 */
export function validateScenarioRow(row: ScenarioRow): string[] {
  const violations: string[] = [];
  if (!row.key.trim() || !row.title.trim()) {
    violations.push(`row "${row.key}": key/title must be non-empty`);
  }
  if (!getCharterDef(row.responsibleCharter)) {
    violations.push(`row "${row.key}": responsibleCharter "${row.responsibleCharter}" is not a real charter`);
  }
  const trigger = row.trigger;
  if (trigger.kind === "sense") {
    const senseKey = trigger.senseKey;
    if (!SENSE_INVENTORY.some((s) => s.key === senseKey)) {
      violations.push(`row "${row.key}": trigger sense "${senseKey}" does not resolve in SENSE_INVENTORY`);
    }
  }
  if (trigger.kind === "human" && trigger.description.trim().length < 20) {
    violations.push(`row "${row.key}": a human trigger must say plainly why no machine sense exists`);
  }
  if (!trigger.description.trim()) {
    violations.push(`row "${row.key}": trigger description must be non-empty`);
  }
  if (row.playbook.kind === "runbook" && !row.playbook.ref.startsWith("docs/runbooks/")) {
    violations.push(`row "${row.key}": runbook ref "${row.playbook.ref}" must live under docs/runbooks/`);
  }
  if (
    row.playbook.kind === "standing-order" &&
    !(STANDING_ORDER_KINDS as readonly string[]).includes(row.playbook.ref)
  ) {
    violations.push(
      `row "${row.key}": standing-order ref "${row.playbook.ref}" is not a standing-order kind (${STANDING_ORDER_KINDS.join(", ")})`,
    );
  }
  if (!AUTONOMY_VALUES.has(row.autonomyRequired)) {
    violations.push(`row "${row.key}": autonomyRequired "${row.autonomyRequired}" is not a ladder level or "founder-only"`);
  }
  if (row.founderTouch === "page" && !row.pagerWiring) {
    violations.push(`row "${row.key}": founderTouch "page" requires pagerWiring (a real path or an explicit declared-gap)`);
  }
  if (row.founderTouch !== "page" && row.pagerWiring) {
    violations.push(`row "${row.key}": pagerWiring is only meaningful on founderTouch "page" rows`);
  }
  if (row.pagerWiring?.kind === "critical-job") {
    const jobName = row.pagerWiring.jobName;
    const rosterEntry = JOB_ROSTER.find((j) => j.name === jobName);
    if (!rosterEntry) {
      violations.push(`row "${row.key}": pager job "${jobName}" is not in the job roster`);
    } else if (resolveFailureLane(rosterEntry) !== "page") {
      violations.push(
        `row "${row.key}": pager job "${rosterEntry.name}" resolves to lane "${resolveFailureLane(rosterEntry)}", not "page"`,
      );
    }
  }
  if (row.pagerWiring?.kind === "declared-gap" && row.pagerWiring.note.trim().length < 20) {
    violations.push(`row "${row.key}": a declared-gap pager must carry an honest note`);
  }
  if (row.drillLedger && !(SCENARIO_DRILL_LEDGERS as readonly string[]).includes(row.drillLedger)) {
    violations.push(`row "${row.key}": drillLedger "${row.drillLedger}" is not a known append-only ledger`);
  }
  return violations;
}

/** Violations across the whole library, including duplicate keys. */
export function validateScenarioLibrary(rows: readonly ScenarioRow[] = SCENARIO_LIBRARY): string[] {
  const violations = rows.flatMap((r) => validateScenarioRow(r));
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.key)) violations.push(`duplicate scenario key "${r.key}"`);
    seen.add(r.key);
  }
  return violations;
}

// ── Drill derivation (pure) ─────────────────────────────────────────────────

/** Quarterly cadence + slack — same bound the DR-drill ratchet uses. */
export const QUARTERLY_DRILL_STALE_DAYS = 100;
/** Annual cadence + slack. */
export const ANNUAL_DRILL_STALE_DAYS = 380;

/**
 * Parse an append-only ledger's block dates: a block opens with a
 * line-leading YYYY-MM-DD (the ledgers' own Format headers; the literal
 * "YYYY-MM-DD" template can never match \d).
 */
export function parseLedgerDrillDates(md: string): string[] {
  return [...md.matchAll(/^(\d{4}-\d{2}-\d{2})\b/gm)].map((m) => m[1]);
}

/**
 * Is a drill due? quarterly/annual: due when never drilled or older than the
 * cadence + slack. on-change has no clock — the only derivable fact is
 * whether it has EVER been walked, so it is due exactly while never-drilled.
 * A null cadence is never due (the row has no drill doctrine yet).
 */
export function scenarioDrillDue(
  cadence: ScenarioDrillCadence | null,
  lastDrilled: string | null,
  now: Date,
): boolean {
  if (cadence === null) return false;
  if (lastDrilled === null) return true;
  if (cadence === "on-change") return false;
  const ageDays = Math.floor((now.getTime() - Date.parse(`${lastDrilled}T00:00:00Z`)) / 86_400_000);
  const bound = cadence === "quarterly" ? QUARTERLY_DRILL_STALE_DAYS : ANNUAL_DRILL_STALE_DAYS;
  return ageDays > bound;
}

// ── The assembled view (derived, honest) ────────────────────────────────────

export interface ScenarioView extends ScenarioRow {
  charterDisplayName: string;
  charterRole: string;
  /** sense → derived from SENSE_INVENTORY; event → true (literal verified in CI); human → false. */
  triggerWired: boolean;
  /**
   * WHAT the wiring claim actually rests on — the badge must not overclaim
   * (fleet-8 verifier note). "sense-consumed" is the strong form: a loader
   * exists AND the brain consumes it (senseIsWired). "event-literal" is
   * weaker: the emitting literal is verified to exist in CI, but nothing
   * here proves the emitter is enabled or reached at runtime. "human" means
   * no machine trigger exists at all.
   */
  triggerEvidence: "sense-consumed" | "event-literal" | "human";
  /** null for non-page rows; otherwise whether a real pager path is named. */
  pagerState: "wired" | "declared-not-wired" | null;
  /** Newest ledger block date for rows that map to a ledger; else null. */
  lastDrilled: string | null;
  drillDue: boolean;
}

export interface ScenarioLibraryResponse {
  generatedAt: string;
  scenarios: ScenarioView[];
  /** Rows whose drill is due (cadence declared, never/staly drilled). */
  drillsDue: number;
  /** founderTouch:"page" rows with no pager wire yet — may only shrink. */
  pagesDeclaredUnwired: number;
}

/**
 * Pure assembly of one row's derived view. `ledgerDates` injects ledger
 * parsing so this stays unit-testable without fs.
 */
export function deriveScenarioView(
  row: ScenarioRow,
  opts: { now: Date; ledgerDates: (ledger: ScenarioDrillLedger) => string[] | null },
): ScenarioView {
  const def = getCharterDef(row.responsibleCharter);
  const triggerWired =
    row.trigger.kind === "sense"
      ? senseIsWired(row.trigger.senseKey)
      : row.trigger.kind === "event";
  const triggerEvidence: ScenarioView["triggerEvidence"] =
    row.trigger.kind === "human"
      ? "human"
      : row.trigger.kind === "event"
        ? "event-literal"
        : "sense-consumed";
  let lastDrilled: string | null = null;
  if (row.drillLedger) {
    const dates = opts.ledgerDates(row.drillLedger);
    if (dates && dates.length > 0) {
      lastDrilled = dates.reduce((a, b) => (a > b ? a : b));
    }
  }
  return {
    ...row,
    charterDisplayName: def?.displayName ?? row.responsibleCharter,
    charterRole: def?.role ?? "",
    triggerWired,
    triggerEvidence,
    pagerState:
      row.founderTouch !== "page"
        ? null
        : row.pagerWiring?.kind === "declared-gap"
          ? "declared-not-wired"
          : "wired",
    lastDrilled,
    drillDue: scenarioDrillDue(row.drillCadence, lastDrilled, opts.now),
  };
}

/**
 * The founder endpoint's payload: every seeded row with its derived state.
 * Ledger reads are best-effort fs — a missing/unreadable ledger yields null
 * dates (rendered "never drilled"), never an invented date. Validation runs
 * as defense-in-depth (CI pins it to zero); violations are logged, not hidden.
 */
export async function getScenarioLibrary(now: Date = new Date()): Promise<ScenarioLibraryResponse> {
  const violations = validateScenarioLibrary();
  if (violations.length > 0) {
    logger.warn("[autopilot/scenarioLibrary] derivation violations at runtime (CI should have caught these)", {
      metadata: { violations },
    });
  }
  const ledgerCache = new Map<string, string[] | null>();
  const ledgerDates = (ledger: ScenarioDrillLedger): string[] | null => {
    if (!ledgerCache.has(ledger)) {
      try {
        const abs = path.resolve(process.cwd(), ledger);
        ledgerCache.set(ledger, parseLedgerDrillDates(fs.readFileSync(abs, "utf8")));
      } catch {
        // No source checkout on this image / file unreadable — honest null.
        ledgerCache.set(ledger, null);
      }
    }
    return ledgerCache.get(ledger) ?? null;
  };
  // Emit in staff-roster order (the charter registry's own order), stable
  // within a charter by seed order — the client groups by first-seen charter.
  const seedIndex = new Map(SCENARIO_LIBRARY.map((r, i) => [r.key, i]));
  const scenarios = SCENARIO_LIBRARY.map((row) => deriveScenarioView(row, { now, ledgerDates })).sort(
    (a, b) =>
      SCENARIO_CHARTER_ORDER.indexOf(a.responsibleCharter) - SCENARIO_CHARTER_ORDER.indexOf(b.responsibleCharter) ||
      (seedIndex.get(a.key) ?? 0) - (seedIndex.get(b.key) ?? 0),
  );
  return {
    generatedAt: now.toISOString(),
    scenarios,
    drillsDue: scenarios.filter((s) => s.drillDue).length,
    pagesDeclaredUnwired: scenarios.filter((s) => s.pagerState === "declared-not-wired").length,
  };
}

/** Charter ordering for grouped rendering — the charter registry's own order. */
export const SCENARIO_CHARTER_ORDER: readonly CharterDomain[] = CHARTER_DEFS.map((c) => c.domain);
