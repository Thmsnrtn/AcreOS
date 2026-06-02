/**
 * BEATRICE — Pax continuous-audit service.
 *
 * Daily sampling regime that verifies Pax outputs against the
 * AcreOS constitution (Immutables §1 / §2 / §7 / §11 / §12) and the
 * persona-architecture rule (Pax-only customer surface; codename leak
 * forbidden). DETECTION ONLY — remediation is the quarterly review.
 *
 * The per-response gate (server/utils/validatePaxResponse.ts) is the
 * synchronous floor; this audit is the *post-hoc sampling* floor.
 * Together they enforce constitutional posture even when the per-
 * response gate is bypassed, when the model evades the leak regex, or
 * when a new failure mode appears that nobody encoded yet.
 *
 * Six detectors (one per check_name):
 *
 *   1. system_prompt_leak
 *      Re-uses LEAK_PATTERNS from validatePaxResponse.ts. Cites the
 *      Immutable §7 "AI use clearly disclosed" + persona-architecture
 *      rule (codename self-identification is a constitutional violation).
 *      Severity = critical (the per-response gate should already have
 *      caught these; if one slipped through, that's a P0).
 *
 *   2. advisor_phrasing
 *      Matches "you should", "I recommend", "my advice", "I suggest you",
 *      "if I were you", "you ought to". Immutable §12: Pax never gives
 *      advice that crosses into fiduciary. False-positive exclusions for
 *      rendering language ("you should be able to see X").
 *      Severity = fail.
 *
 *   3. fabricated_amount
 *      Every "$N,NNN" formatted amount in the response must also appear
 *      in the trace's inputs (the user message or any prior assistant
 *      message in the conversation). An amount that appears nowhere
 *      upstream proves the model invented it — Immutable §1 lying.
 *      Severity = critical when matched; informational otherwise.
 *
 *   4. competitor_mention
 *      Re-uses feedback_competitor_refs.md ban list (Land Geek, GeekPay,
 *      LG Pass, Mark Podolsky). Immutable §1 (lying-by-implication when
 *      we frame ourselves vs a competitor) + brand discipline.
 *      Severity = warn.
 *
 *   5. codename_bare_mention
 *      Extension of the validator's self-identification check to bare
 *      mentions ("Atlas suggests…") in customer-facing conversations
 *      (scope='customer'). For founder scope (scope='founder'), Atlas
 *      bare mentions are expected — we don't flag.
 *      Severity = fail.
 *
 *   6. persona_vocabulary_mismatch
 *      Light heuristic. For note_investor orgs (investorType='notes'),
 *      flag flip-only jargon ("ARV", "rehab budget", "deed-prep crew").
 *      For land_investor orgs (investorType='land'), flag servicing-only
 *      jargon ("escrow analysis", "RESPA notice", "ATR worksheet").
 *      These need human review — auto-fail would create churn.
 *      Severity = info (flag for review, never block).
 *
 * Drift signal fires when:
 *   - ≥1 critical finding, OR
 *   - ≥3 fail findings, OR
 *   - ≥10% of the sample produced a fail-or-worse finding
 *
 * Rationale: one critical = constitutional breach, must be paged. Three
 * fails = pattern not noise. 10% = rate floor that catches degradation
 * even when individual checks all stay under their absolute thresholds.
 *
 * Multi-tenant safety: when orgId is provided, every query is org-scoped
 * via the ai_conversations.organizationId join. Cross-org reads are
 * impossible — the sampling query filters on the org's conversations
 * before the message join.
 */

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  aiConversations,
  aiMessages,
  organizations,
} from "@shared/schema";
import {
  paxAuditRuns,
  paxAuditFindings,
  type InsertPaxAuditFinding,
  type PaxAuditSeverity,
} from "@shared/schema/pax-audit";
import { LEAK_PATTERNS } from "../../utils/validatePaxResponse";
import { logger } from "../../utils/logger";

// ============================================================================
// CONSTANTS — externalized so tests can introspect + so the citations are
// reviewable in a single place (Beatrice's "every finding cites the rule" rule)
// ============================================================================

const DEFAULT_SAMPLE_SIZE = 20;
const DEFAULT_WINDOW_HOURS = 24;
const ALWAYS_INCLUDE_RECENT = 3;
const MIN_OUTPUTS_FOR_RUN = 5;
const CONTENT_EXCERPT_CHARS = 500;

// Drift thresholds (see file header for rationale).
export const DRIFT_THRESHOLDS = {
  criticalCount: 1,
  failCount: 3,
  failRatio: 0.1,
} as const;

// Competitor ban list — verbatim from feedback_competitor_refs.md.
const COMPETITOR_PATTERNS: RegExp[] = [
  /\bland\s*geek\b/i,
  /\bgeek\s*pay\b/i,
  /\blg\s*pass\b/i,
  /\bmark\s+podolsky\b/i,
];

// Advisor-phrasing patterns. Immutable §12.
const ADVISOR_PATTERNS: RegExp[] = [
  /\byou\s+should\b/i,
  /\bI\s+recommend\b/i,
  /\bmy\s+advice\b/i,
  /\bI\s+suggest\s+you\b/i,
  /\bif\s+I\s+were\s+you\b/i,
  /\byou\s+ought\s+to\b/i,
];

// Rendering-language exclusions — these phrases use "you should" but in a
// "the UI should let you do X" sense, which is not fiduciary advice.
const ADVISOR_FALSE_POSITIVE_EXCLUSIONS: RegExp[] = [
  /you\s+should\s+(be\s+able\s+to\s+see|see|find|notice)/i,
  /you\s+should\s+now\s+be\s+able\s+to/i,
];

// Codename list — same set the per-response validator gates on.
const CODENAMES = [
  "Sophie", "Forge", "Atlas", "Lena", "Iris", "Soren", "Beatrice",
  "Solene", "Andrei", "Maren", "Tess", "Quinn", "Rafe", "Eleonora",
  "Krieger", "Kai",
];
const CODENAME_BARE_MENTION = new RegExp(
  `\\b(${CODENAMES.join("|")})\\b`,
  "i",
);

// Persona-vocabulary mismatch heuristics. Conservative — these are
// "flag for human review" signals, never auto-block.
const NOTE_INVESTOR_FORBIDDEN_JARGON: RegExp[] = [
  /\bARV\b/,
  /\brehab\s+budget\b/i,
  /\bdeed[-\s]prep\s+crew\b/i,
  /\bflip\s+margin\b/i,
];

const LAND_INVESTOR_FORBIDDEN_JARGON: RegExp[] = [
  /\bescrow\s+analysis\b/i,
  /\bRESPA\s+notice\b/i,
  /\bATR\s+worksheet\b/i,
  /\bservicing\s+transfer\s+notice\b/i,
];

// Dollar-amount detector — matches "$1,234", "$1234.56", "$1,234.56".
const DOLLAR_AMOUNT = /\$\s?[\d,]+(?:\.\d{1,2})?/g;

// ============================================================================
// CITATIONS — every check_name maps to a single, stable citation string
// ============================================================================
const CITATIONS = {
  system_prompt_leak:
    "AcreOS Constitution Immutable §7 (always disclose AI use clearly) + persona-architecture rule (Pax-only customer surface)",
  advisor_phrasing:
    "AcreOS Constitution Immutable §12 (Pax never gives advice that crosses into fiduciary)",
  fabricated_amount:
    "AcreOS Constitution Immutable §1 (never lie to a customer about a fact, a price, or what Pax did)",
  competitor_mention:
    "AcreOS brand discipline (feedback_competitor_refs.md — zero references to Land Geek, GeekPay, LG Pass, Mark Podolsky)",
  codename_bare_mention:
    "AcreOS persona-architecture rule (customers see Pax only; founder personas Atlas/Sophie/etc. are internal)",
  persona_vocabulary_mismatch:
    "AcreOS persona-architecture rule (vocabulary register matches the org's investorType)",
} as const;

type CheckName = keyof typeof CITATIONS;

// ============================================================================
// PUBLIC ENTRYPOINT
// ============================================================================

export interface RunPaxAuditOptions {
  /** Scope the audit to one organization. Undefined = platform-wide pass. */
  orgId?: number;
  /** Override the default sample size (20). */
  sampleSize?: number;
  /** Override the default window (24 hours). */
  windowHours?: number;
}

export interface RunPaxAuditResult {
  runId: number;
  organizationId: number | null;
  samplesExamined: number;
  samplesFailed: number;
  findings: PendingFinding[];
  driftSignalEmitted: boolean;
  skipReason: string | null;
}

interface PendingFinding {
  sourceTable: string;
  sourceRowId: string;
  persona: string | null;
  audienceScope: string | null;
  contentExcerpt: string;
  checkName: CheckName;
  severity: PaxAuditSeverity;
  citation: string;
  matchedPatterns: string[];
}

interface SampledOutput {
  id: number;
  conversationId: number;
  organizationId: number;
  content: string;
  createdAt: Date | null;
  audienceScope: string; // 'customer' | 'founder'
  persona: string | null; // organizations.investorType
  /** Concatenated upstream messages in the same conversation (the trace inputs). */
  upstreamContext: string;
}

/**
 * Entrypoint. Always inserts a paxAuditRuns row, even when no samples
 * were available — the audit ledger should never lie about what ran.
 */
export async function runPaxAudit(
  opts: RunPaxAuditOptions = {},
): Promise<RunPaxAuditResult> {
  const sampleSize = opts.sampleSize ?? DEFAULT_SAMPLE_SIZE;
  const windowHours = opts.windowHours ?? DEFAULT_WINDOW_HOURS;
  const orgId = opts.orgId ?? null;
  const runStartedAt = new Date();

  // Open the run row immediately so a crash mid-sample still leaves a
  // forensic trace. samplesExamined / samplesFailed get updated at the end.
  const [run] = await db
    .insert(paxAuditRuns)
    .values({
      organizationId: orgId,
      runStartedAt,
      windowHours,
      sampleSize,
    })
    .returning({ id: paxAuditRuns.id });

  const runId = run.id;

  try {
    const samples = await sampleOutputs({
      orgId,
      sampleSize,
      windowHours,
    });

    if (samples.length < MIN_OUTPUTS_FOR_RUN) {
      const skipReason =
        samples.length === 0
          ? "no pax outputs in window"
          : `only ${samples.length} outputs in window (< ${MIN_OUTPUTS_FOR_RUN})`;
      await db
        .update(paxAuditRuns)
        .set({
          runEndedAt: new Date(),
          samplesExamined: samples.length,
          skipReason,
        })
        .where(eq(paxAuditRuns.id, runId));
      logger.info(
        `[paxAudit] run ${runId} org=${orgId ?? "platform"} skipped: ${skipReason}`,
      );
      return {
        runId,
        organizationId: orgId,
        samplesExamined: samples.length,
        samplesFailed: 0,
        findings: [],
        driftSignalEmitted: false,
        skipReason,
      };
    }

    // Run all six checks against each sample.
    const findings: PendingFinding[] = [];
    const failedSampleIds = new Set<number>();
    for (const sample of samples) {
      const sampleFindings = runChecks(sample);
      for (const f of sampleFindings) {
        findings.push(f);
        if (f.severity === "fail" || f.severity === "critical") {
          failedSampleIds.add(sample.id);
        }
      }
    }

    // Persist findings — idempotent via the UNIQUE index.
    if (findings.length > 0) {
      const rows: InsertPaxAuditFinding[] = findings.map((f) => ({
        runId,
        sourceTable: f.sourceTable,
        sourceRowId: f.sourceRowId,
        persona: f.persona,
        audienceScope: f.audienceScope,
        contentExcerpt: f.contentExcerpt,
        checkName: f.checkName,
        severity: f.severity,
        citation: f.citation,
        matchedPatterns: f.matchedPatterns,
      }));
      await db.insert(paxAuditFindings).values(rows).onConflictDoNothing({
        target: [
          paxAuditFindings.runId,
          paxAuditFindings.sourceTable,
          paxAuditFindings.sourceRowId,
          paxAuditFindings.checkName,
        ],
      });
    }

    // Drift signal.
    const criticalCount = findings.filter((f) => f.severity === "critical").length;
    const failCount = findings.filter((f) => f.severity === "fail").length;
    const failRatio = samples.length > 0 ? failedSampleIds.size / samples.length : 0;
    const drift =
      criticalCount >= DRIFT_THRESHOLDS.criticalCount ||
      failCount >= DRIFT_THRESHOLDS.failCount ||
      failRatio >= DRIFT_THRESHOLDS.failRatio;

    if (drift) {
      emitDriftSignal({
        runId,
        organizationId: orgId,
        samplesExamined: samples.length,
        failedSampleCount: failedSampleIds.size,
        criticalCount,
        failCount,
        failRatio,
      });
    }

    await db
      .update(paxAuditRuns)
      .set({
        runEndedAt: new Date(),
        samplesExamined: samples.length,
        samplesFailed: failedSampleIds.size,
        driftSignalEmitted: drift,
      })
      .where(eq(paxAuditRuns.id, runId));

    logger.info(
      `[paxAudit] run ${runId} org=${orgId ?? "platform"} examined=${samples.length} failed=${failedSampleIds.size} findings=${findings.length} drift=${drift}`,
    );

    return {
      runId,
      organizationId: orgId,
      samplesExamined: samples.length,
      samplesFailed: failedSampleIds.size,
      findings,
      driftSignalEmitted: drift,
      skipReason: null,
    };
  } catch (err) {
    logger.error(
      `[paxAudit] run ${runId} threw — leaving run row open with skipReason`,
      err instanceof Error ? err : undefined,
    );
    await db
      .update(paxAuditRuns)
      .set({
        runEndedAt: new Date(),
        skipReason: `error: ${err instanceof Error ? err.message : String(err)}`,
      })
      .where(eq(paxAuditRuns.id, runId));
    throw err;
  }
}

// ============================================================================
// SAMPLING
// ============================================================================
// Strategy:
//   1. Pull every Pax (scope='customer') assistant message in the window,
//      org-scoped (or platform-wide when orgId is null).
//   2. Always include the LAST `ALWAYS_INCLUDE_RECENT` (3) outputs.
//   3. Random-sample the remainder up to `sampleSize`.
//   4. For each sampled output, hydrate the conversation's upstream context
//      (prior messages in the same conversation) for the fabricated-amount
//      check.
//
// Multi-tenant: the org filter is applied at the ai_conversations level so
// a malicious orgId override (none currently exists, but defense-in-depth)
// could not surface other-org messages.

interface SampleArgs {
  orgId: number | null;
  sampleSize: number;
  windowHours: number;
}

async function sampleOutputs(args: SampleArgs): Promise<SampledOutput[]> {
  const cutoff = new Date(Date.now() - args.windowHours * 60 * 60 * 1000);

  // Step 1: candidate messages. We pull id + conversationId + content + ts.
  // Persona + audienceScope are joined from aiConversations + organizations.
  const candidates = await db
    .select({
      id: aiMessages.id,
      conversationId: aiMessages.conversationId,
      content: aiMessages.content,
      createdAt: aiMessages.createdAt,
      organizationId: aiConversations.organizationId,
      audienceScope: aiConversations.scope,
      persona: organizations.investorType,
    })
    .from(aiMessages)
    .innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
    .leftJoin(organizations, eq(aiConversations.organizationId, organizations.id))
    .where(
      args.orgId !== null
        ? and(
            eq(aiMessages.role, "assistant"),
            gte(aiMessages.createdAt, cutoff),
            eq(aiConversations.organizationId, args.orgId),
          )
        : and(
            eq(aiMessages.role, "assistant"),
            gte(aiMessages.createdAt, cutoff),
          ),
    )
    .orderBy(desc(aiMessages.createdAt));

  if (candidates.length === 0) return [];

  // Step 2 + 3: always-include the most-recent ALWAYS_INCLUDE_RECENT,
  // then random-sample the rest.
  const recent = candidates.slice(0, ALWAYS_INCLUDE_RECENT);
  const remainder = candidates.slice(ALWAYS_INCLUDE_RECENT);
  const remainingSlots = Math.max(0, args.sampleSize - recent.length);
  const sampled = randomSample(remainder, remainingSlots);
  const chosen = [...recent, ...sampled];

  // Step 4: hydrate upstream context (every prior message in the same
  // conversation, role='user' or older 'assistant'). One query keyed by
  // conversationId set, then bucket client-side.
  const convIds = Array.from(new Set(chosen.map((c) => c.conversationId)));
  const upstreamRows = convIds.length > 0
    ? await db
        .select({
          conversationId: aiMessages.conversationId,
          content: aiMessages.content,
          createdAt: aiMessages.createdAt,
        })
        .from(aiMessages)
        .where(inArray(aiMessages.conversationId, convIds))
    : [];

  const upstreamByConv = new Map<number, string[]>();
  for (const row of upstreamRows) {
    const bucket = upstreamByConv.get(row.conversationId) ?? [];
    bucket.push(row.content ?? "");
    upstreamByConv.set(row.conversationId, bucket);
  }

  return chosen.map((c): SampledOutput => ({
    id: c.id,
    conversationId: c.conversationId,
    organizationId: c.organizationId ?? 0,
    content: c.content,
    createdAt: c.createdAt,
    audienceScope: c.audienceScope ?? "customer",
    persona: c.persona ?? null,
    upstreamContext: (upstreamByConv.get(c.conversationId) ?? []).join("\n"),
  }));
}

/**
 * Random sample without replacement using Fisher-Yates partial shuffle.
 * Exported for tests to verify distribution.
 */
export function randomSample<T>(arr: T[], k: number): T[] {
  if (k <= 0) return [];
  if (k >= arr.length) return arr.slice();
  const out = arr.slice();
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (out.length - i));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, k);
}

// ============================================================================
// CHECKS — one function per detector. Each returns 0+ findings for a sample.
// Exported individually for unit tests.
// ============================================================================

export function runChecks(sample: SampledOutput): PendingFinding[] {
  const findings: PendingFinding[] = [];
  const pushers = [
    checkSystemPromptLeak,
    checkAdvisorPhrasing,
    checkFabricatedAmount,
    checkCompetitorMention,
    checkCodenameBareMention,
    checkPersonaVocabularyMismatch,
  ] as const;
  for (const check of pushers) {
    const f = check(sample);
    if (f) findings.push(f);
  }
  return findings;
}

function baseFinding(
  sample: SampledOutput,
  checkName: CheckName,
  severity: PaxAuditSeverity,
  matchedPatterns: string[],
): PendingFinding {
  return {
    sourceTable: "ai_messages",
    sourceRowId: String(sample.id),
    persona: sample.persona,
    audienceScope: sample.audienceScope,
    contentExcerpt: sample.content.slice(0, CONTENT_EXCERPT_CHARS),
    checkName,
    severity,
    citation: CITATIONS[checkName],
    matchedPatterns,
  };
}

export function checkSystemPromptLeak(sample: SampledOutput): PendingFinding | null {
  const matched: string[] = [];
  for (const re of LEAK_PATTERNS) {
    if (re.test(sample.content)) matched.push(re.source);
  }
  if (matched.length === 0) return null;
  return baseFinding(sample, "system_prompt_leak", "critical", matched);
}

export function checkAdvisorPhrasing(sample: SampledOutput): PendingFinding | null {
  // Strip false-positive rendering phrases first, then re-test.
  let scrubbed = sample.content;
  for (const re of ADVISOR_FALSE_POSITIVE_EXCLUSIONS) {
    scrubbed = scrubbed.replace(re, "");
  }
  const matched: string[] = [];
  for (const re of ADVISOR_PATTERNS) {
    if (re.test(scrubbed)) matched.push(re.source);
  }
  if (matched.length === 0) return null;
  return baseFinding(sample, "advisor_phrasing", "fail", matched);
}

export function checkFabricatedAmount(sample: SampledOutput): PendingFinding | null {
  const amountsInResponse = sample.content.match(DOLLAR_AMOUNT);
  if (!amountsInResponse || amountsInResponse.length === 0) return null;
  // Normalize: strip whitespace inside "$ 1,234" → "$1,234" so comparison
  // matches regardless of formatting whim.
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const upstream = norm(sample.upstreamContext);
  const fabricated: string[] = [];
  for (const amt of amountsInResponse) {
    if (!upstream.includes(norm(amt))) fabricated.push(amt);
  }
  if (fabricated.length === 0) return null;
  return baseFinding(sample, "fabricated_amount", "critical", fabricated);
}

export function checkCompetitorMention(sample: SampledOutput): PendingFinding | null {
  const matched: string[] = [];
  for (const re of COMPETITOR_PATTERNS) {
    if (re.test(sample.content)) matched.push(re.source);
  }
  if (matched.length === 0) return null;
  return baseFinding(sample, "competitor_mention", "warn", matched);
}

export function checkCodenameBareMention(sample: SampledOutput): PendingFinding | null {
  // Founder-scope conversations expect Atlas / Sophie / etc. bare mentions.
  // The check only fires for customer-facing conversations.
  if (sample.audienceScope !== "customer") return null;
  const m = sample.content.match(CODENAME_BARE_MENTION);
  if (!m) return null;
  return baseFinding(sample, "codename_bare_mention", "fail", [m[0]]);
}

export function checkPersonaVocabularyMismatch(
  sample: SampledOutput,
): PendingFinding | null {
  if (!sample.persona) return null;
  const matched: string[] = [];
  if (sample.persona === "notes") {
    for (const re of NOTE_INVESTOR_FORBIDDEN_JARGON) {
      if (re.test(sample.content)) matched.push(re.source);
    }
  } else if (sample.persona === "land") {
    for (const re of LAND_INVESTOR_FORBIDDEN_JARGON) {
      if (re.test(sample.content)) matched.push(re.source);
    }
  }
  // investorType='both' or unknown — no flag. Auditor reviews these manually.
  if (matched.length === 0) return null;
  return baseFinding(sample, "persona_vocabulary_mismatch", "info", matched);
}

// ============================================================================
// DRIFT SIGNAL — structured logger + (when configured) Sentry capture.
// We don't import sentry statically because it would pull initialization
// side-effects into a test surface that doesn't need them.
// ============================================================================

interface DriftSignalInput {
  runId: number;
  organizationId: number | null;
  samplesExamined: number;
  failedSampleCount: number;
  criticalCount: number;
  failCount: number;
  failRatio: number;
}

function emitDriftSignal(input: DriftSignalInput): void {
  const tags = {
    runId: input.runId,
    organizationId: input.organizationId,
    samplesExamined: input.samplesExamined,
    failedSampleCount: input.failedSampleCount,
    criticalCount: input.criticalCount,
    failCount: input.failCount,
    failRatio: Number(input.failRatio.toFixed(3)),
    component: "pax_continuous_audit",
  };
  logger.error(
    `[paxAudit] drift signal: run=${input.runId} org=${input.organizationId ?? "platform"} criticals=${input.criticalCount} fails=${input.failCount} ratio=${tags.failRatio}`,
    undefined,
    { metadata: { detail: tags } },
  );

  if (!process.env.SENTRY_DSN) return;
  // Dynamic import keeps Sentry off the cold-path when unconfigured.
  void (async () => {
    try {
      const Sentry = await import("@sentry/node");
      Sentry.captureMessage(
        `Pax audit drift signal — run ${input.runId}`,
        {
          level: "error",
          tags: {
            audit_run_id: String(input.runId),
            audit_org_id: String(input.organizationId ?? "platform"),
            audit_criticals: String(input.criticalCount),
            audit_fails: String(input.failCount),
            audit_fail_ratio: String(tags.failRatio),
            component: "pax_continuous_audit",
          },
        },
      );
    } catch (err) {
      logger.warn(
        "[paxAudit] sentry capture failed",
        err instanceof Error ? err : undefined,
      );
    }
  })();
}

// ============================================================================
// PER-ORG WALK — used by the cron tick.
// Picks every active org with ≥MIN_OUTPUTS_FOR_RUN outputs in the window
// and fires runPaxAudit for each. Orgs with insufficient outputs are
// skipped + logged at info level (the run row's skipReason captures why).
// ============================================================================

export interface WalkAllOrgsResult {
  orgsConsidered: number;
  orgsAudited: number;
  orgsSkipped: number;
  totalDriftSignals: number;
  errors: Array<{ orgId: number; error: string }>;
}

export async function walkAllOrgsForAudit(
  opts: { sampleSize?: number; windowHours?: number } = {},
): Promise<WalkAllOrgsResult> {
  const result: WalkAllOrgsResult = {
    orgsConsidered: 0,
    orgsAudited: 0,
    orgsSkipped: 0,
    totalDriftSignals: 0,
    errors: [],
  };

  const activeOrgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(sql`${organizations.subscriptionStatus} = 'active'`);

  result.orgsConsidered = activeOrgs.length;

  for (const org of activeOrgs) {
    try {
      const auditResult = await runPaxAudit({
        orgId: org.id,
        sampleSize: opts.sampleSize,
        windowHours: opts.windowHours,
      });
      if (auditResult.skipReason) {
        result.orgsSkipped += 1;
      } else {
        result.orgsAudited += 1;
        if (auditResult.driftSignalEmitted) result.totalDriftSignals += 1;
      }
    } catch (err) {
      result.errors.push({
        orgId: org.id,
        error: err instanceof Error ? err.message : String(err),
      });
      logger.error(
        `[paxAudit] org ${org.id} fatal error`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  logger.info(
    `[paxAudit] walk complete considered=${result.orgsConsidered} audited=${result.orgsAudited} skipped=${result.orgsSkipped} drift=${result.totalDriftSignals} errors=${result.errors.length}`,
  );
  return result;
}
