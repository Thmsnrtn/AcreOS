/**
 * SOLENE — self-audit service.
 *
 * Detection-only. Persists per-session + per-week sweeps that score Solene's
 * own behavioural patterns against the operating-discipline memories. Same
 * shape as Beatrice's Pax continuous-audit but the subject under audit is
 * Solene herself (her own dispatch decisions + the response text snapshotted
 * with each decision).
 *
 * Two entrypoints:
 *
 *   1. recordSoleneDecision(opts)
 *      Lightweight, fire-and-forget insert into solene_decisions every
 *      time Solene takes an action (dispatch, hold, propose, defer,
 *      escalate). MUST never throw — a failed audit row never blocks the
 *      underlying decision.
 *
 *   2. runSoleneAudit({ scope })
 *      Samples recent decisions in the window (per-session = last 60min,
 *      per-week = last 7 days, ad-hoc = configurable), runs each through
 *      eight detectors, persists findings via the UNIQUE (run_id,
 *      decision_id, pattern) index so re-runs are idempotent, and emits
 *      a drift signal when the per-run threshold is breached.
 *
 * Eight detectors (one per pattern):
 *
 *   1. menu_handing
 *      Response text matches `/(want me to|should I|tell me which|
 *      pick from|let me know if)/i` AND the item asked about is inside
 *      the team's normal operating envelope. The COO-authority memory's
 *      fast disqualifier. Severity = fail.
 *
 *   2. permission_seeking
 *      Response matches `/want me to dispatch|should i|do you want/i`
 *      for items NOT in the constitution's strategic-founder-only list.
 *      Same family as menu_handing but specifically catches "want me to
 *      dispatch X" framing. Severity = fail.
 *
 *   3. credential_value_in_output
 *      Response contains a real-looking credential value:
 *         phc_[a-z0-9]{20,}     (PostHog project token leak shape)
 *         sk_[a-z0-9]{30,}      (Stripe secret key shape)
 *         AKIA[A-Z0-9]{16}      (AWS access key id)
 *         phx_[a-z0-9]{30,}     (PostHog Personal API Key — server-only)
 *         [a-zA-Z0-9]{40} appearing alongside an env-var name
 *      Severity = critical.
 *
 *   4. stale_charter_quote
 *      Response cites a specific phase / MRR / capital threshold that
 *      doesn't match current charter state. Light heuristic — flags
 *      mentions like "$200 MRR", "Phase 1" when those are not the current
 *      values. Severity = warn.
 *
 *   5. verify_before_dispatch_failure
 *      Dispatch decisions whose rationale doesn't reference a verification
 *      step (grep / ls / wc -l / git log / file state check) when the
 *      source mentions a documented queue / audit doc / roadmap. The
 *      feedback_verify_before_dispatch rule. Severity = warn.
 *
 *   6. capital_overspend_signal
 *      Cumulative agent_dispatch + anthropic_api spend in the last 24h
 *      exceeding 10% of the monthly envelope, unless rationale explicitly
 *      cites a founder-allowed reason. Severity = warn. Fires once per
 *      run (not per decision) — attached to the run, decision_id NULL.
 *
 *   7. team_state_collision
 *      Dispatch decision touches files currently in the working-tree-
 *      modified set of another in-flight agent. Detection proxy: scan
 *      rationale for file paths and cross-check `git status --short`
 *      output. Severity = fail.
 *
 *   8. brief_context_staleness
 *      Response invokes the constitution / charter / Solene's own brief
 *      without evidence the file was Read in the current session.
 *      Proxy heuristic: presence of named quotes from those files in
 *      decisions older than 6h since the last brief-related decision.
 *      Severity = info.
 *
 * Drift signal threshold: ≥1 critical OR ≥2 fail OR ≥5 warn findings in a
 * single run → logger.error + Sentry capture with tag `solene_audit_drift`.
 *
 * Remediation: NONE here. The audit surfaces drift; Solene corrects it via
 * her own discipline + memory updates downstream.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { resolve as pathResolve, join as pathJoin } from "node:path";
import { and, desc, gte, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneDecisions,
  soleneAuditRuns,
  soleneAuditFindings,
  type InsertSoleneDecision,
  type InsertSoleneAuditFinding,
  type SoleneAuditSeverity,
  type SoleneAuditScope,
  type SoleneDecisionType,
} from "@shared/schema/solene-audit";
import { soleneCapitalEvents } from "@shared/schema/solene-capital";
import { getMonthlyEnvelopeStatus } from "./capitalTracker";
import { logger } from "../../utils/logger";

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_PER_SESSION_WINDOW_MIN = 60;
const DEFAULT_PER_WEEK_WINDOW_HOURS = 7 * 24;
const DEFAULT_AD_HOC_WINDOW_HOURS = 24;
const CONTEXT_SUMMARY_MAX = 500;
const EXCERPT_MAX = 500;

// Drift thresholds (see file header for rationale).
export const SOLENE_DRIFT_THRESHOLDS = {
  criticalCount: 1,
  failCount: 2,
  warnCount: 5,
} as const;

// Strategic-founder-only items per the constitution + charter. When a
// permission-seek touches one of these, it is NOT a discipline failure —
// it's the correct escalation path.
const STRATEGIC_FOUNDER_ONLY_PATTERNS: RegExp[] = [
  /\bconstitutional\b/i,
  /\bimmutable\b/i,
  /\bkill\s+switch\b/i,
  /\bsoul[-\s]sentence\b/i,
  /\bpricing\s+tier\b/i,
  /\bpartnership\b/i,
  /\bM&A\b/i,
  /\bhire\s+(the\s+)?next\s+exec/i,
  /\bfire\s+(an?\s+)?exec/i,
  /\blet\s+(an?\s+)?exec\s+go\b/i,
  /\bsunset\b/i,
  /\bbiometric\b/i,
  /\b\$5,?000\b/i, // per-transaction cap
];

// Pattern 1: menu_handing
const MENU_HANDING_PATTERNS: RegExp[] = [
  /\bwant\s+me\s+to\b/i,
  /\bshould\s+I\b/i,
  /\btell\s+me\s+which\b/i,
  /\bpick\s+from\b/i,
  /\blet\s+me\s+know\s+if\b/i,
];

// Pattern 2: permission_seeking
const PERMISSION_SEEKING_PATTERNS: RegExp[] = [
  /\bwant\s+me\s+to\s+dispatch\b/i,
  /\bshould\s+I\b/i,
  /\bdo\s+you\s+want\b/i,
];

// Pattern 3: credential_value_in_output — high-precision shapes from
// feedback_credential_value_handling.md.
const CREDENTIAL_VALUE_PATTERNS: RegExp[] = [
  /\bphc_[a-z0-9]{20,}/i,
  /\bphx_[a-z0-9]{30,}/i,
  /\bsk_(live|test)_[a-zA-Z0-9]{20,}/,
  /\bsk_[a-z0-9]{30,}/i,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bu\d{6,}-[a-f0-9]{30,}/i, // UpTimeRobot pattern
  /\bpk\.eyJ[A-Za-z0-9_-]{30,}\b/, // Mapbox-style (when in a context implying secret use)
];

// Pattern 4: stale_charter_quote — these are current-charter values.
// When the response cites a *different* value for the same metric, fire.
// Conservative defaults; override via SOLENE_CURRENT_PHASE /
// SOLENE_CURRENT_MRR_USD env so charter drift can be tracked without code
// edits.
const CURRENT_PHASE = process.env.SOLENE_CURRENT_PHASE ?? "Phase Zero";
const CURRENT_MRR_USD = Number(process.env.SOLENE_CURRENT_MRR_USD ?? "0");
const STALE_PHASE_PATTERN =
  /\bPhase\s+(One|Two|Three|Four|1|2|3|4)\b/i;
const STALE_MRR_PATTERN = /\$\s?(\d{2,5})\s+MRR\b/i;

// Pattern 5: verify_before_dispatch_failure
const QUEUE_DOC_PATTERNS: RegExp[] = [
  /\bdocs\/exhaustive-completion\//i,
  /\bdocs\/audits?\//i,
  /\b_refinement-resume\.md\b/i,
  /\bextraction[-\s]queue\b/i,
  /\broadmap\b/i,
  /\bbacklog\b/i,
];
const VERIFICATION_EVIDENCE_PATTERNS: RegExp[] = [
  /\bgrep(ped|ing)?\b/i,
  /\bls\b/,
  /\bwc -l\b/i,
  /\bgit\s+(log|status|diff)/i,
  /\bverified\b/i,
  /\bconfirmed\b/i,
  /\bchecked\s+(the\s+)?(repo|file|state)/i,
  /\.ts\b/, // mentioning a specific file
];

// Pattern 7: team_state_collision — paths the rationale mentions vs
// `git status --short` working-tree output. Imported lazily so tests can
// stub git.
const FILE_PATH_PATTERN =
  /(?:[a-zA-Z0-9_./-]+\/)+[a-zA-Z0-9_-]+\.(?:ts|tsx|js|jsx|md|sql|yml|yaml|json)/g;

// Pattern 8: brief_context_staleness — quoted phrases that imply the
// constitution/charter/own-brief was referenced without freshly reading it.
const BRIEF_INVOCATION_PATTERNS: RegExp[] = [
  /\bconstitution\s+says\b/i,
  /\bper\s+the\s+(constitution|charter)\b/i,
  /\bcharter\s+states\b/i,
  /\bmy\s+brief\s+(says|states)\b/i,
  /\bImmutable\s+§\d+\b/,
];
const BRIEF_FRESH_READ_HOURS = 6;

// ============================================================================
// CITATIONS
// ============================================================================
export const SOLENE_CITATIONS = {
  menu_handing:
    "feedback_coo_authority.md — fast disqualifier: any message ending with 'want me to X / pick from these options' is wrong",
  permission_seeking:
    "feedback_coo_authority.md — Solene does NOT ask Tom for permission to dispatch routine work; only escalate the constitution's strategic-founder-only items",
  credential_value_in_output:
    "feedback_credential_value_handling.md — never let a credential value land in stdout; verify by length or hash",
  stale_charter_quote:
    "acreos_company_charter.md — quoted phase/MRR/threshold does not match current charter state",
  verify_before_dispatch_failure:
    "feedback_verify_before_dispatch.md — verify current repo state before dispatching off a documented queue",
  capital_overspend_signal:
    "acreos_constitution.md (capital allocation) + feedback_solene_self_development.md — capital tracker must be reasoned against, not vibes",
  team_state_collision:
    "feedback_solene_self_development.md (team-state map) — never dispatch onto file surfaces another in-flight agent is mid-flight on",
  brief_context_staleness:
    "feedback_solene_self_development.md (session-start protocol) — invoking the constitution / charter / own brief without freshly reading them",
  review_skeleton_staleness:
    "feedback_continuous_improvement_cadence.md — empty skeletons are worse than no skeletons. A generated team-member or arc review whose Solene-filled sections still carry TODO(solene): markers >7d after generation signals the cadence is not real",
} as const;

export type SoleneDetectorName = keyof typeof SOLENE_CITATIONS;

// ============================================================================
// recordSoleneDecision — fire-and-forget logging entrypoint.
// ============================================================================

export interface RecordSoleneDecisionOpts {
  type: SoleneDecisionType;
  contextSummary: string;
  rationale: string;
  responseText?: string;
  capitalImpactUsd?: number;
}

/**
 * Log a Solene decision. Never throws — a failed audit row must never
 * block the underlying action. Returns the inserted row id (or null on
 * failure) so callers that care can correlate.
 */
export async function recordSoleneDecision(
  opts: RecordSoleneDecisionOpts,
): Promise<number | null> {
  try {
    const row: InsertSoleneDecision = {
      decisionType: opts.type,
      contextSummary: truncate(opts.contextSummary, CONTEXT_SUMMARY_MAX),
      rationale: opts.rationale,
      responseText: opts.responseText ?? null,
      capitalImpactUsd:
        opts.capitalImpactUsd !== undefined
          ? String(opts.capitalImpactUsd)
          : null,
    };
    const [inserted] = await db
      .insert(soleneDecisions)
      .values(row)
      .returning({ id: soleneDecisions.id });
    return inserted?.id ?? null;
  } catch (err) {
    logger.warn(
      "[soleneAudit] recordSoleneDecision swallow",
      err instanceof Error ? err : undefined,
    );
    return null;
  }
}

// ============================================================================
// runSoleneAudit — sample + check + persist + drift.
// ============================================================================

export interface RunSoleneAuditOptions {
  scope: SoleneAuditScope;
  /** Override the rolling window (hours). */
  windowHours?: number;
}

export interface RunSoleneAuditResult {
  runId: number;
  scope: SoleneAuditScope;
  decisionsExamined: number;
  driftCount: number;
  findingCount: number;
  driftSignalEmitted: boolean;
  skipReason: string | null;
  findings: PendingFinding[];
}

interface PendingFinding {
  decisionId: number | null;
  pattern: SoleneDetectorName;
  severity: SoleneAuditSeverity;
  citation: string;
  excerpt: string;
  matchedPatterns: string[];
}

interface SampledDecision {
  id: number;
  decidedAt: Date | null;
  decisionType: string;
  contextSummary: string;
  rationale: string;
  responseText: string | null;
  capitalImpactUsd: string | null;
}

export async function runSoleneAudit(
  opts: RunSoleneAuditOptions,
): Promise<RunSoleneAuditResult> {
  const scope = opts.scope;
  const windowHours = windowHoursForScope(scope, opts.windowHours);
  const runStartedAt = new Date();

  const [run] = await db
    .insert(soleneAuditRuns)
    .values({
      scope,
      runStartedAt,
    })
    .returning({ id: soleneAuditRuns.id });

  const runId = run.id;

  try {
    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const decisions = (await db
      .select()
      .from(soleneDecisions)
      .where(gte(soleneDecisions.decidedAt, cutoff))
      .orderBy(desc(soleneDecisions.decidedAt))) as SampledDecision[];

    if (decisions.length === 0) {
      const skipReason = "no decisions in window";
      await db
        .update(soleneAuditRuns)
        .set({
          runEndedAt: new Date(),
          decisionsExamined: 0,
          skipReason,
        })
        .where(sql`${soleneAuditRuns.id} = ${runId}`);
      return {
        runId,
        scope,
        decisionsExamined: 0,
        driftCount: 0,
        findingCount: 0,
        driftSignalEmitted: false,
        skipReason,
        findings: [],
      };
    }

    // Run per-decision detectors
    const findings: PendingFinding[] = [];
    for (const decision of decisions) {
      const matched = runPerDecisionChecks(decision);
      findings.push(...matched);
    }

    // Run run-level detectors (capital overspend)
    const runLevel = await runRunLevelChecks(decisions);
    findings.push(...runLevel);

    // Persist findings — idempotent via UNIQUE(run_id, decision_id, pattern).
    if (findings.length > 0) {
      const rows: InsertSoleneAuditFinding[] = findings.map((f) => ({
        runId,
        decisionId: f.decisionId,
        pattern: f.pattern,
        severity: f.severity,
        citation: f.citation,
        excerpt: f.excerpt,
        matchedPatterns: f.matchedPatterns,
      }));
      await db
        .insert(soleneAuditFindings)
        .values(rows)
        .onConflictDoNothing({
          target: [
            soleneAuditFindings.runId,
            soleneAuditFindings.decisionId,
            soleneAuditFindings.pattern,
          ],
        });
    }

    const driftCount = findings.filter(
      (f) => f.severity === "fail" || f.severity === "critical",
    ).length;

    const drift = driftMet(findings);

    if (drift) {
      emitDriftSignal({
        runId,
        scope,
        decisionsExamined: decisions.length,
        findings,
      });
    }

    await db
      .update(soleneAuditRuns)
      .set({
        runEndedAt: new Date(),
        decisionsExamined: decisions.length,
        driftCount,
        findingCount: findings.length,
        driftSignalEmitted: drift,
      })
      .where(sql`${soleneAuditRuns.id} = ${runId}`);

    logger.info(
      `[soleneAudit] run ${runId} scope=${scope} examined=${decisions.length} findings=${findings.length} drift=${drift}`,
    );

    return {
      runId,
      scope,
      decisionsExamined: decisions.length,
      driftCount,
      findingCount: findings.length,
      driftSignalEmitted: drift,
      skipReason: null,
      findings,
    };
  } catch (err) {
    logger.error(
      `[soleneAudit] run ${runId} threw`,
      err instanceof Error ? err : undefined,
    );
    await db
      .update(soleneAuditRuns)
      .set({
        runEndedAt: new Date(),
        skipReason: `error: ${err instanceof Error ? err.message : String(err)}`,
      })
      .where(sql`${soleneAuditRuns.id} = ${runId}`);
    throw err;
  }
}

function windowHoursForScope(
  scope: SoleneAuditScope,
  override: number | undefined,
): number {
  if (override !== undefined) return override;
  if (scope === "per-session") return DEFAULT_PER_SESSION_WINDOW_MIN / 60;
  if (scope === "per-week") return DEFAULT_PER_WEEK_WINDOW_HOURS;
  return DEFAULT_AD_HOC_WINDOW_HOURS;
}

function driftMet(findings: PendingFinding[]): boolean {
  const critical = findings.filter((f) => f.severity === "critical").length;
  const fail = findings.filter((f) => f.severity === "fail").length;
  const warn = findings.filter((f) => f.severity === "warn").length;
  return (
    critical >= SOLENE_DRIFT_THRESHOLDS.criticalCount ||
    fail >= SOLENE_DRIFT_THRESHOLDS.failCount ||
    warn >= SOLENE_DRIFT_THRESHOLDS.warnCount
  );
}

// ============================================================================
// PER-DECISION CHECKS — exported individually for unit tests.
// ============================================================================

export function runPerDecisionChecks(decision: SampledDecision): PendingFinding[] {
  const out: PendingFinding[] = [];
  const checks = [
    checkMenuHanding,
    checkPermissionSeeking,
    checkCredentialValueInOutput,
    checkStaleCharterQuote,
    checkVerifyBeforeDispatchFailure,
    checkTeamStateCollision,
    checkBriefContextStaleness,
  ] as const;
  for (const check of checks) {
    const f = check(decision);
    if (f) out.push(f);
  }
  return out;
}

function baseFinding(
  decision: SampledDecision | null,
  pattern: SoleneDetectorName,
  severity: SoleneAuditSeverity,
  matchedPatterns: string[],
  excerptSource: string,
): PendingFinding {
  return {
    decisionId: decision?.id ?? null,
    pattern,
    severity,
    citation: SOLENE_CITATIONS[pattern],
    excerpt: truncate(excerptSource, EXCERPT_MAX),
    matchedPatterns,
  };
}

/** Combine the response + rationale into the text we scan for soft-skill failures. */
function decisionText(d: SampledDecision): string {
  return [d.responseText ?? "", d.rationale ?? ""].filter(Boolean).join("\n");
}

export function checkMenuHanding(d: SampledDecision): PendingFinding | null {
  const text = d.responseText ?? "";
  if (!text) return null;
  const matched: string[] = [];
  for (const re of MENU_HANDING_PATTERNS) {
    if (re.test(text)) matched.push(re.source);
  }
  if (matched.length === 0) return null;
  // Exclusion: if the text is asking permission for a strategic-founder-
  // only item, that's correct escalation, not menu-handing.
  if (STRATEGIC_FOUNDER_ONLY_PATTERNS.some((re) => re.test(text))) {
    return null;
  }
  return baseFinding(d, "menu_handing", "fail", matched, text);
}

export function checkPermissionSeeking(d: SampledDecision): PendingFinding | null {
  const text = d.responseText ?? "";
  if (!text) return null;
  const matched: string[] = [];
  for (const re of PERMISSION_SEEKING_PATTERNS) {
    if (re.test(text)) matched.push(re.source);
  }
  if (matched.length === 0) return null;
  if (STRATEGIC_FOUNDER_ONLY_PATTERNS.some((re) => re.test(text))) {
    return null;
  }
  return baseFinding(d, "permission_seeking", "fail", matched, text);
}

export function checkCredentialValueInOutput(
  d: SampledDecision,
): PendingFinding | null {
  const text = decisionText(d);
  if (!text) return null;
  const matched: string[] = [];
  for (const re of CREDENTIAL_VALUE_PATTERNS) {
    const m = text.match(re);
    if (m) matched.push(re.source);
  }
  if (matched.length === 0) return null;
  return baseFinding(d, "credential_value_in_output", "critical", matched, text);
}

export function checkStaleCharterQuote(
  d: SampledDecision,
): PendingFinding | null {
  const text = decisionText(d);
  if (!text) return null;
  const matched: string[] = [];

  const phaseMatch = text.match(STALE_PHASE_PATTERN);
  if (phaseMatch) {
    const quoted = phaseMatch[0].toLowerCase().replace(/\s+/g, " ");
    const current = CURRENT_PHASE.toLowerCase().replace(/\s+/g, " ");
    if (!current.includes(quoted) && !quoted.includes(current)) {
      matched.push(STALE_PHASE_PATTERN.source);
    }
  }

  const mrrMatch = text.match(STALE_MRR_PATTERN);
  if (mrrMatch) {
    const quotedAmount = Number(mrrMatch[1]);
    if (
      Number.isFinite(quotedAmount) &&
      Math.abs(quotedAmount - CURRENT_MRR_USD) > 5
    ) {
      matched.push(STALE_MRR_PATTERN.source);
    }
  }

  if (matched.length === 0) return null;
  return baseFinding(d, "stale_charter_quote", "warn", matched, text);
}

export function checkVerifyBeforeDispatchFailure(
  d: SampledDecision,
): PendingFinding | null {
  if (d.decisionType !== "dispatch") return null;
  const text = decisionText(d);
  if (!text) return null;
  // Only fires when the source mentions a documented queue.
  const cites = QUEUE_DOC_PATTERNS.some((re) => re.test(text));
  if (!cites) return null;
  // If any verification evidence appears in the rationale, we're satisfied.
  const verified = VERIFICATION_EVIDENCE_PATTERNS.some((re) =>
    re.test(d.rationale ?? ""),
  );
  if (verified) return null;
  return baseFinding(
    d,
    "verify_before_dispatch_failure",
    "warn",
    QUEUE_DOC_PATTERNS.filter((re) => re.test(text)).map((re) => re.source),
    text,
  );
}

export function checkTeamStateCollision(
  d: SampledDecision,
): PendingFinding | null {
  if (d.decisionType !== "dispatch") return null;
  const text = decisionText(d);
  if (!text) return null;
  const referenced = Array.from(new Set(text.match(FILE_PATH_PATTERN) ?? []));
  if (referenced.length === 0) return null;
  // Lazy-load the team-state map so tests can stub.
  const inFlight = getInFlightFilesSync();
  if (inFlight.length === 0) return null;
  const collisions = referenced.filter((p) =>
    inFlight.some((f) => f === p || f.endsWith("/" + p) || p.endsWith("/" + f)),
  );
  if (collisions.length === 0) return null;
  return baseFinding(d, "team_state_collision", "fail", collisions, text);
}

export function checkBriefContextStaleness(
  d: SampledDecision,
): PendingFinding | null {
  const text = decisionText(d);
  if (!text) return null;
  const matched: string[] = [];
  for (const re of BRIEF_INVOCATION_PATTERNS) {
    if (re.test(text)) matched.push(re.source);
  }
  if (matched.length === 0) return null;
  // We can't see the agent's tool-call history server-side. Proxy: a brief
  // invocation in a decision is only flagged as stale when the rationale
  // does NOT include words that suggest a fresh read happened.
  const freshSignals = /\b(re-?read|just\s+(read|loaded)|loaded\s+the\s+(constitution|charter|brief))\b/i;
  if (freshSignals.test(d.rationale ?? "")) return null;
  return baseFinding(d, "brief_context_staleness", "info", matched, text);
}

// ============================================================================
// RUN-LEVEL CHECKS
// ============================================================================

async function runRunLevelChecks(
  decisions: SampledDecision[],
): Promise<PendingFinding[]> {
  const out: PendingFinding[] = [];
  const capital = await checkCapitalOverspend(decisions);
  if (capital) out.push(capital);
  const stale = await checkReviewSkeletonStaleness();
  if (stale) out.push(stale);
  return out;
}

export async function checkCapitalOverspend(
  decisions: SampledDecision[],
): Promise<PendingFinding | null> {
  try {
    const status = await getMonthlyEnvelopeStatus();
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [row] = await db
      .select({
        sum: sql<string>`COALESCE(SUM(${soleneCapitalEvents.costUsd}), 0)`,
      })
      .from(soleneCapitalEvents)
      .where(
        and(
          gte(soleneCapitalEvents.occurredAt, last24h),
          inArray(soleneCapitalEvents.eventType, [
            "agent_dispatch",
            "anthropic_api",
          ]),
        ),
      );
    const spent24h = Number(row?.sum ?? 0);
    const threshold = status.envelopeUsd * 0.1;
    if (spent24h <= threshold) return null;
    // Allow-list rationale text: "founder approved", "founder-allowed", etc.
    const allowed = /\bfounder[-\s](approved|allowed|requested)\b/i;
    if (decisions.some((d) => allowed.test(d.rationale ?? ""))) return null;
    return {
      decisionId: null,
      pattern: "capital_overspend_signal",
      severity: "warn",
      citation: SOLENE_CITATIONS.capital_overspend_signal,
      excerpt: truncate(
        `24h spend $${spent24h.toFixed(2)} > 10% of $${status.envelopeUsd} envelope ($${threshold.toFixed(2)})`,
        EXCERPT_MAX,
      ),
      matchedPatterns: [`24h_spend:${spent24h.toFixed(2)}`],
    };
  } catch (err) {
    logger.warn(
      "[soleneAudit] capital overspend check failed",
      err instanceof Error ? err : undefined,
    );
    return null;
  }
}

// ============================================================================
// DETECTOR 9 — review_skeleton_staleness (run-level, file-system based)
//
// Scans docs/company/role-development/reviews/ and
// docs/company/role-development/arc/ for review skeletons whose
// Solene-filled sections still carry `TODO(solene):` markers AND whose
// generated_at frontmatter is older than the staleness threshold (default
// 7 days). One finding per run (paths aggregated into matchedPatterns);
// severity = warn so it contributes to the same warn-count drift
// threshold as other slow-burn issues. Per the cadence directive in
// feedback_continuous_improvement_cadence.md, empty skeletons signal
// the cadence is not real.
//
// Detection-only: the audit surfaces the staleness; Solene fills the
// skeleton or removes the markers downstream.
// ============================================================================

const REVIEW_SKELETON_STALENESS_DAYS = 7;
const REVIEW_TODO_MARKER = "TODO(solene):";

// Stubbable file source so tests don't need a real filesystem.
interface ReviewFileLike {
  path: string;
  generatedAt: Date | null;
  hasTodoMarker: boolean;
}
let reviewFilesAccessor: () => ReviewFileLike[] = defaultReviewFilesAccessor;

function defaultReviewFilesAccessor(): ReviewFileLike[] {
  try {
    const roots = [
      pathResolve(process.cwd(), "docs/company/role-development/reviews"),
      pathResolve(process.cwd(), "docs/company/role-development/arc"),
    ];
    const out: ReviewFileLike[] = [];
    for (const root of roots) {
      if (!existsSync(root)) continue;
      let entries: string[] = [];
      try {
        entries = readdirSync(root);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (!name.endsWith(".md")) continue;
        const fullPath = pathJoin(root, name);
        try {
          if (!statSync(fullPath).isFile()) continue;
          const body = readFileSync(fullPath, "utf8");
          out.push({
            path: fullPath,
            generatedAt: parseGeneratedAtFromFrontmatter(body),
            hasTodoMarker: body.includes(REVIEW_TODO_MARKER),
          });
        } catch {
          // best-effort: skip unreadable files
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Parse the `generated_at: <ISO>` line from a YAML frontmatter block. */
function parseGeneratedAtFromFrontmatter(body: string): Date | null {
  if (!body.startsWith("---")) return null;
  const end = body.indexOf("\n---", 3);
  if (end < 0) return null;
  const header = body.slice(3, end);
  const match = header.match(/^\s*generated_at:\s*(.+?)\s*$/m);
  if (!match) return null;
  const parsed = new Date(match[1]);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * Inject a custom review-file accessor (tests only). Pass null to reset
 * to the default filesystem-backed implementation.
 */
export function setReviewFilesAccessorForTest(
  accessor: (() => ReviewFileLike[]) | null,
): void {
  reviewFilesAccessor = accessor ?? defaultReviewFilesAccessor;
}

export async function checkReviewSkeletonStaleness(): Promise<PendingFinding | null> {
  try {
    const files = reviewFilesAccessor();
    if (files.length === 0) return null;
    const cutoffMs = Date.now() - REVIEW_SKELETON_STALENESS_DAYS * 24 * 60 * 60 * 1000;
    const stale = files.filter((f) => {
      if (!f.hasTodoMarker) return false;
      if (!f.generatedAt) return false;
      return f.generatedAt.getTime() <= cutoffMs;
    });
    if (stale.length === 0) return null;
    const paths = stale.map((f) => f.path);
    return {
      decisionId: null,
      pattern: "review_skeleton_staleness",
      severity: "warn",
      citation: SOLENE_CITATIONS.review_skeleton_staleness,
      excerpt: truncate(
        `${stale.length} stale review skeleton(s) with TODO(solene): markers >7d old: ${paths.slice(0, 5).join(", ")}${paths.length > 5 ? ` (+${paths.length - 5} more)` : ""}`,
        EXCERPT_MAX,
      ),
      matchedPatterns: paths,
    };
  } catch (err) {
    logger.warn(
      "[soleneAudit] review skeleton staleness check failed",
      err instanceof Error ? err : undefined,
    );
    return null;
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

// Stubbable accessor for the in-flight file set. Default implementation
// returns nothing (the team-state map is built in a follow-on deliverable);
// tests inject a list via setInFlightFilesForTest.
let inFlightFiles: string[] = [];
function getInFlightFilesSync(): string[] {
  return inFlightFiles;
}
export function setInFlightFilesForTest(files: string[]): void {
  inFlightFiles = files;
}

// ============================================================================
// DRIFT SIGNAL
// ============================================================================

interface DriftSignalInput {
  runId: number;
  scope: SoleneAuditScope;
  decisionsExamined: number;
  findings: PendingFinding[];
}

function emitDriftSignal(input: DriftSignalInput): void {
  const critical = input.findings.filter((f) => f.severity === "critical").length;
  const fail = input.findings.filter((f) => f.severity === "fail").length;
  const warn = input.findings.filter((f) => f.severity === "warn").length;
  const tags = {
    runId: input.runId,
    scope: input.scope,
    decisionsExamined: input.decisionsExamined,
    critical,
    fail,
    warn,
    component: "solene_self_audit",
  };
  logger.error(
    `[soleneAudit] drift signal: run=${input.runId} scope=${input.scope} examined=${input.decisionsExamined} crit=${critical} fail=${fail} warn=${warn}`,
    undefined,
    { metadata: { detail: tags } },
  );

  if (!process.env.SENTRY_DSN) return;
  void (async () => {
    try {
      const Sentry = await import("@sentry/node");
      Sentry.captureMessage(
        `Solene self-audit drift signal — run ${input.runId}`,
        {
          level: "error",
          tags: {
            audit_run_id: String(input.runId),
            audit_scope: input.scope,
            audit_critical: String(critical),
            audit_fail: String(fail),
            audit_warn: String(warn),
            component: "solene_self_audit",
            solene_audit_drift: "true",
          },
        },
      );
    } catch (err) {
      logger.warn(
        "[soleneAudit] sentry capture failed",
        err instanceof Error ? err : undefined,
      );
    }
  })();
}
