/**
 * IMPROVEMENT — event-driven team-improvement opportunity detector.
 *
 * Per feedback_continuous_improvement_cadence.md (Tom 2026-06-02 correction):
 *
 *   "We shouldn't let time pass if a team member can be improved it should
 *    happen seamlessly across time."
 *
 * Primary driver. Runs every 30 minutes (server/jobs/runScheduledJobs.ts →
 * startTeamImprovementDetectorJob). Scans the last 14 days of recorded
 * state across SEVEN signal patterns; when a pattern fires above threshold,
 * persists a team_improvement_opportunities row, then hands the row to
 * server/services/improvement/autoDispatch.ts → evaluateForAutoDispatch
 * which decides whether the guardrails permit auto-dispatch.
 *
 * The calendar-cron team-member reviews remain as a SAFETY NET — they
 * catch what the detectors miss. The detectors are the primary forcing
 * function.
 *
 * Seven detectors (each takes the 14-day window + returns matching
 * opportunities, deduplicated at the DB layer via UNIQUE):
 *
 *   1. detectRecurringGap(member)
 *      Query solene_audit_findings within window; group by excerpt-hash
 *      restricted to findings tied to that member's domain; when ≥2 hits
 *      surface, fire severity=opportunity, confidence=0.9.
 *
 *   2. detectPatternTransfer()
 *      Cross-reference capabilities each member has (heuristic on
 *      server/services/<member>/ directory existence) vs the per-member
 *      baseline gaps from feedback_team_development_arc.md (encoded as
 *      MEMBER_BASELINE_GAPS below). When member A has capability X and
 *      member B's baseline lists "no capability X equivalent," fire
 *      severity=opportunity, confidence=0.8.
 *
 *   3. detectExternalEvent()
 *      Scan beatrice_reg_events (table built by the parallel-agent's
 *      regwatch — best-effort, the detector skips gracefully if the
 *      table doesn't yet exist). Keyword-match new events to a member's
 *      surface; fire severity=urgent when title contains
 *      'breach'|'enforcement'|'fine', else opportunity.
 *
 *   4. detectRecurringDispatchFlag()
 *      The "this would be cleaner if Y existed" pattern. We don't yet
 *      have a structured dispatched-agent-report ledger, so this proxies
 *      via solene_decisions.rationale — scanning for phrases like
 *      "infrastructure gap" / "would be cleaner if" / "needs a primitive
 *      for". ≥3 mentions in 14 days fires severity=opportunity,
 *      confidence=0.85.
 *
 *   5. detectSuccessfulPattern()
 *      When a member has shipped a discipline-formalizing pattern (audit
 *      framework, continuous monitor, ADR system, contract test, etc.)
 *      and another member's baseline lists the parallel as missing,
 *      fire severity=opportunity, confidence=0.75. Built on the same
 *      capability heuristic as detector #2 but oriented toward
 *      "replicate the win," not "fill the void."
 *
 *   6. detectVolumeThreshold()
 *      Count commits per member per domain (heuristic on commit-message
 *      prefixes — "iris:", "soren:", "beatrice:", "krieger:", "solene:"
 *      and the surface-tagged variants). At 50 commits → "formalize the
 *      role." At 200 → "split into sub-roles." Fire severity=info,
 *      confidence=0.7.
 *
 *   7. detectCapitalConcentration()
 *      Query solene_capital_events in the 14d window, group by
 *      member-attribution (best-effort via contextSummary keyword
 *      matching since events don't carry a member field). When one
 *      member consumes >50% of capital AND that member hasn't shipped
 *      net-new infrastructure recently (proxy: their service dir has
 *      no commits in the same window with member-tagged messages),
 *      fire severity=opportunity, confidence=0.8.
 *
 * All detectors return opportunities via the same upsert path — duplicate
 * (member × pattern × description) inserts are no-ops at the DB layer.
 *
 * Persistence is best-effort: a failed insert never throws out of
 * runImprovementDetectors. The next cron tick will re-fire and the
 * dedupe key keeps the ledger clean.
 */

import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { db } from "../../db";
import {
  teamImprovementOpportunities,
  type InsertTeamImprovementOpportunity,
  type TeamImprovementEvidence,
  type TeamImprovementMember,
  type TeamImprovementSignalPattern,
  type TeamImprovementSeverity,
} from "@shared/schema/team-improvement";
import {
  soleneAuditFindings,
  soleneDecisions,
} from "@shared/schema/solene-audit";
import { soleneCapitalEvents } from "@shared/schema/solene-capital";
import { logger } from "../../utils/logger";

// ============================================================================
// CONSTANTS
// ============================================================================

export const DETECTOR_WINDOW_DAYS = 14;
const DETECTOR_WINDOW_MS = DETECTOR_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const DESCRIPTION_MAX = 500;

// ── Per-member baseline gaps (from feedback_team_development_arc.md) ────────
// Each entry encodes the named-capability gap and the member-attribution
// keywords detectors #2 / #5 use to recognise "this is X's domain."
//
// Capability slug must match (loosely) a service directory or known
// primitive — slug "audit_framework" = "I have a self-audit framework
// shipped" (beatrice has pax/continuousAudit + pax-audit schema; iris has
// perfMonitor + iris-perf; solene has selfAudit; soren is still empty).

export interface MemberCapability {
  slug: string;
  /** Service path that — if it exists — implies the capability is shipped. */
  servicePath: string;
  /** Schema path equivalent. Either path existing implies "capability shipped." */
  schemaPath: string;
  /** Human-readable label for the opportunity description. */
  label: string;
}

export const CAPABILITY_REGISTRY: MemberCapability[] = [
  {
    slug: "audit_framework",
    servicePath: "server/services/pax/continuousAudit.ts",
    schemaPath: "shared/schema/pax-audit.ts",
    label: "continuous-audit framework",
  },
  {
    slug: "perf_monitor",
    servicePath: "server/services/iris/perfMonitor.ts",
    schemaPath: "shared/schema/iris-perf.ts",
    label: "continuous performance baseline + regression detector",
  },
  {
    slug: "self_audit",
    servicePath: "server/services/solene/selfAudit.ts",
    schemaPath: "shared/schema/solene-audit.ts",
    label: "self-audit framework",
  },
  {
    slug: "capital_tracker",
    servicePath: "server/services/solene/capitalTracker.ts",
    schemaPath: "shared/schema/solene-capital.ts",
    label: "capital-spend tracker",
  },
  {
    slug: "seo_ranking_tracker",
    servicePath: "server/services/soren/",
    schemaPath: "shared/schema/soren-seo.ts",
    label: "SEO ranking tracker",
  },
];

// ── Baseline gaps per member (compressed from
//    feedback_team_development_arc.md). Each gap maps to one or more
//    capability slugs that — if PRESENT for another member — make the
//    "transfer the pattern" recommendation viable.
export interface BaselineGap {
  /** Human-readable gap label. */
  label: string;
  /** Capability slugs whose presence elsewhere would close this gap. */
  closesIfMemberHas: string[];
}

export const MEMBER_BASELINE_GAPS: Record<TeamImprovementMember, BaselineGap[]> = {
  iris: [
    {
      label: "no tech-debt ledger",
      closesIfMemberHas: ["audit_framework"],
    },
    {
      label: "no code-review on dispatched sub-agents",
      closesIfMemberHas: ["self_audit"],
    },
  ],
  soren: [
    {
      label: "no voice-drift detector for shipped content",
      closesIfMemberHas: ["audit_framework"],
    },
    {
      label: "content production is open-loop (no attribution)",
      closesIfMemberHas: ["perf_monitor"],
    },
    {
      label: "no A/B testing framework",
      closesIfMemberHas: ["perf_monitor"],
    },
  ],
  beatrice: [
    {
      label: "no PII-scan continuous monitor",
      closesIfMemberHas: ["audit_framework"],
    },
    {
      label: "no 50-state matrix continuous monitoring",
      closesIfMemberHas: ["perf_monitor"],
    },
  ],
  krieger: [
    {
      label: "no continuous mobile-feel CI gate",
      closesIfMemberHas: ["perf_monitor", "audit_framework"],
    },
    {
      label: "no automated mobile-accessibility scan",
      closesIfMemberHas: ["audit_framework"],
    },
  ],
  solene: [
    {
      label: "no after-action review loop on her own dispatches",
      closesIfMemberHas: ["perf_monitor"],
    },
  ],
};

// ── Member-attribution keywords (for capital-concentration + recurring-gap)
const MEMBER_KEYWORDS: Record<TeamImprovementMember, RegExp[]> = {
  iris: [/\biris\b/i, /\bperf[-_ ]?monitor\b/i, /\bp95\b/i, /\bADR\b/, /\btech[-_ ]?debt\b/i],
  soren: [/\bsoren\b/i, /\bSEO\b/i, /\b\/learn\b/i, /\blanding\b/i, /\bcontent\b/i],
  beatrice: [/\bbeatrice\b/i, /\bpax[-_ ]?audit\b/i, /\bcompliance\b/i, /\breg(ulatory|watch)\b/i, /\bPII\b/],
  krieger: [/\bkrieger\b/i, /\bmobile[-_ ]?feel\b/i, /\bhaptic\b/i, /\btouch[-_ ]?target\b/i],
  solene: [/\bsolene\b/i, /\bCOO\b/, /\bself[-_ ]?audit\b/i, /\bcapital[-_ ]?tracker\b/i],
};

// ── Recurring-dispatch-flag phrases (detector #4)
const DISPATCH_FLAG_PHRASES: RegExp[] = [
  /\binfrastructure\s+gap\b/i,
  /\bwould\s+be\s+cleaner\s+if\b/i,
  /\bneeds?\s+a\s+primitive\s+for\b/i,
  /\bmissing\s+primitive\b/i,
  /\bif\s+\w+\s+existed\b/i,
  /\bshould\s+be\s+typed\b/i,
  /\bno\s+structured\s+\w+\s+(yet|here)\b/i,
];

// ── Volume thresholds (detector #6)
export const VOLUME_TIERS = [
  { count: 50, label: "formalize the role" },
  { count: 200, label: "split into sub-roles" },
] as const;

// ── Capital-concentration threshold (detector #7)
export const CAPITAL_CONCENTRATION_THRESHOLD_PERCENT = 50;

// ============================================================================
// ENTRYPOINT
// ============================================================================

export interface RunImprovementDetectorsResult {
  detectedAt: Date;
  byDetector: Record<TeamImprovementSignalPattern, number>;
  persistedCount: number;
  opportunities: PendingOpportunity[];
  skipReasons: string[];
}

/**
 * Run all 7 detectors against the last 14 days of state. Persist new
 * opportunities (idempotent via UNIQUE), return what was found. Never
 * throws — individual detector failures are logged + counted in
 * skipReasons.
 */
export async function runImprovementDetectors(opts: {
  windowDays?: number;
} = {}): Promise<RunImprovementDetectorsResult> {
  const windowDays = opts.windowDays ?? DETECTOR_WINDOW_DAYS;
  const detectedAt = new Date();
  const since = new Date(detectedAt.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const byDetector: Record<TeamImprovementSignalPattern, number> = {
    recurring_gap: 0,
    pattern_transfer: 0,
    external_event: 0,
    recurring_dispatch_flag: 0,
    successful_pattern: 0,
    volume_threshold: 0,
    capital_concentration: 0,
  };
  const skipReasons: string[] = [];
  const all: PendingOpportunity[] = [];

  const members: TeamImprovementMember[] = [
    "iris",
    "soren",
    "beatrice",
    "krieger",
    "solene",
  ];

  for (const m of members) {
    const r = await safeRun(`recurring_gap[${m}]`, () =>
      detectRecurringGap(m, since),
    );
    if (Array.isArray(r)) {
      all.push(...r);
      byDetector.recurring_gap += r.length;
    } else skipReasons.push(r);
  }

  const transfer = await safeRun("pattern_transfer", () =>
    detectPatternTransfer(),
  );
  if (Array.isArray(transfer)) {
    all.push(...transfer);
    byDetector.pattern_transfer += transfer.length;
  } else skipReasons.push(transfer);

  const external = await safeRun("external_event", () =>
    detectExternalEvent(since),
  );
  if (Array.isArray(external)) {
    all.push(...external);
    byDetector.external_event += external.length;
  } else skipReasons.push(external);

  for (const m of members) {
    const r = await safeRun(`recurring_dispatch_flag[${m}]`, () =>
      detectRecurringDispatchFlag(m, since),
    );
    if (Array.isArray(r)) {
      all.push(...r);
      byDetector.recurring_dispatch_flag += r.length;
    } else skipReasons.push(r);
  }

  const successful = await safeRun("successful_pattern", () =>
    detectSuccessfulPattern(),
  );
  if (Array.isArray(successful)) {
    all.push(...successful);
    byDetector.successful_pattern += successful.length;
  } else skipReasons.push(successful);

  for (const m of members) {
    const r = await safeRun(`volume_threshold[${m}]`, () =>
      detectVolumeThreshold(m, since),
    );
    if (Array.isArray(r)) {
      all.push(...r);
      byDetector.volume_threshold += r.length;
    } else skipReasons.push(r);
  }

  const capital = await safeRun("capital_concentration", () =>
    detectCapitalConcentration(since),
  );
  if (Array.isArray(capital)) {
    all.push(...capital);
    byDetector.capital_concentration += capital.length;
  } else skipReasons.push(capital);

  // Persist (idempotent)
  let persistedCount = 0;
  for (const o of all) {
    const ok = await persistOpportunity(o);
    if (ok) persistedCount += 1;
  }

  logger.info(
    `[improvementDetector] tick: detector_counts=${JSON.stringify(byDetector)} persisted=${persistedCount} skipped=${skipReasons.length}`,
  );

  return { detectedAt, byDetector, persistedCount, opportunities: all, skipReasons };
}

async function safeRun<T>(
  label: string,
  fn: () => Promise<T[]>,
): Promise<T[] | string> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[improvementDetector] ${label} failed: ${msg}`);
    return `${label}: ${msg}`;
  }
}

// ============================================================================
// PERSISTENCE
// ============================================================================

export interface PendingOpportunity {
  teamMember: TeamImprovementMember;
  signalPattern: TeamImprovementSignalPattern;
  description: string;
  evidence: TeamImprovementEvidence;
  confidence: number;
  estimatedCostUsd: number | null;
  severity: TeamImprovementSeverity;
}

async function persistOpportunity(o: PendingOpportunity): Promise<boolean> {
  try {
    const row: InsertTeamImprovementOpportunity = {
      teamMember: o.teamMember,
      signalPattern: o.signalPattern,
      description: truncate(o.description, DESCRIPTION_MAX),
      evidence: o.evidence,
      confidence: o.confidence.toFixed(3),
      estimatedCostUsd:
        o.estimatedCostUsd !== null ? o.estimatedCostUsd.toFixed(2) : null,
      severity: o.severity,
    };
    const inserted = await db
      .insert(teamImprovementOpportunities)
      .values(row)
      .onConflictDoNothing({
        target: [
          teamImprovementOpportunities.teamMember,
          teamImprovementOpportunities.signalPattern,
          teamImprovementOpportunities.description,
        ],
      })
      .returning({ id: teamImprovementOpportunities.id });
    return inserted.length > 0;
  } catch (err) {
    logger.warn(
      "[improvementDetector] persistOpportunity swallow",
      err instanceof Error ? err : undefined,
    );
    return false;
  }
}

// ============================================================================
// DETECTOR 1 — recurring_gap
// ============================================================================
// Query solene_audit_findings within window. Group by pattern. When the
// same audit pattern fires ≥2 times AND the excerpt text contains
// member-attribution keywords, surface as a recurring-gap opportunity for
// that member.

export async function detectRecurringGap(
  member: TeamImprovementMember,
  since: Date,
): Promise<PendingOpportunity[]> {
  const rows = await db
    .select({
      pattern: soleneAuditFindings.pattern,
      excerpt: soleneAuditFindings.excerpt,
      severity: soleneAuditFindings.severity,
      firedAt: soleneAuditFindings.firedAt,
      id: soleneAuditFindings.id,
    })
    .from(soleneAuditFindings)
    .where(gte(soleneAuditFindings.firedAt, since))
    .orderBy(desc(soleneAuditFindings.firedAt));

  const keywords = MEMBER_KEYWORDS[member];
  // Group by pattern AND by normalized excerpt-prefix (first 80 chars) so
  // "same gap text" really is the same gap, not just same detector class.
  const buckets = new Map<
    string,
    { ids: number[]; sample: string; pattern: string }
  >();
  for (const r of rows) {
    const text = `${r.excerpt} ${r.pattern}`;
    if (!keywords.some((re) => re.test(text))) continue;
    const key = `${r.pattern}::${normalizeExcerpt(r.excerpt).slice(0, 80)}`;
    const b = buckets.get(key) ?? { ids: [], sample: r.excerpt, pattern: r.pattern };
    b.ids.push(r.id);
    buckets.set(key, b);
  }

  const out: PendingOpportunity[] = [];
  for (const [, b] of buckets) {
    if (b.ids.length < 2) continue;
    out.push({
      teamMember: member,
      signalPattern: "recurring_gap",
      description: `Recurring "${b.pattern}" gap for ${member} (${b.ids.length} matches in ${DETECTOR_WINDOW_DAYS}d): ${normalizeExcerpt(b.sample).slice(0, 200)}`,
      evidence: {
        sourceRefs: b.ids.map((id) => ({
          kind: "solene_audit_finding",
          id,
        })),
        counts: { matches: b.ids.length },
      },
      confidence: 0.9,
      estimatedCostUsd: 25,
      severity: "opportunity",
    });
  }
  return out;
}

function normalizeExcerpt(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// ============================================================================
// DETECTOR 2 — pattern_transfer
// ============================================================================
// For each member, look at their baseline gaps. For each gap, check whether
// any OTHER member has shipped a capability whose slug closes that gap. If
// yes, surface as an opportunity for the gap-having member.

export async function detectPatternTransfer(): Promise<PendingOpportunity[]> {
  const shippedCapabilities = computeShippedCapabilities();
  const capabilityOwner: Record<string, TeamImprovementMember> = {};
  for (const [slug, owners] of Object.entries(shippedCapabilities)) {
    // First owner wins (registry order is deterministic).
    if (owners.length > 0) {
      capabilityOwner[slug] = owners[0];
    }
  }

  const out: PendingOpportunity[] = [];
  for (const [memberKey, gaps] of Object.entries(MEMBER_BASELINE_GAPS) as Array<
    [TeamImprovementMember, BaselineGap[]]
  >) {
    for (const gap of gaps) {
      for (const slug of gap.closesIfMemberHas) {
        const owner = capabilityOwner[slug];
        if (!owner || owner === memberKey) continue;
        const cap = CAPABILITY_REGISTRY.find((c) => c.slug === slug);
        if (!cap) continue;
        out.push({
          teamMember: memberKey,
          signalPattern: "pattern_transfer",
          description: `${memberKey}: ${gap.label}; ${owner} ships ${cap.label} (slug=${slug}) — transfer the pattern`,
          evidence: {
            sourceRefs: [
              {
                kind: "service_path",
                summary: cap.servicePath,
              },
              {
                kind: "team_member_baseline",
                id: memberKey,
                summary: gap.label,
              },
            ],
            notes: `Capability ${slug} present for ${owner}, gap-listed for ${memberKey}.`,
          },
          confidence: 0.8,
          estimatedCostUsd: 40,
          severity: "opportunity",
        });
      }
    }
  }
  return out;
}

function computeShippedCapabilities(): Record<string, TeamImprovementMember[]> {
  // Heuristic owner-of-capability mapping. Each capability slug → owner
  // member (the one whose service surface IS that capability). Only flags
  // the capability "shipped" if the file exists on disk.
  const ownership: Record<string, TeamImprovementMember> = {
    audit_framework: "beatrice", // pax/continuousAudit
    perf_monitor: "iris", // iris/perfMonitor
    self_audit: "solene", // solene/selfAudit
    capital_tracker: "solene", // solene/capitalTracker
    seo_ranking_tracker: "soren", // soren/
  };
  const out: Record<string, TeamImprovementMember[]> = {};
  const repoRoot = process.env.IMPROVEMENT_REPO_ROOT ?? process.cwd();
  for (const cap of CAPABILITY_REGISTRY) {
    const shipped =
      existsSync(join(repoRoot, cap.servicePath)) ||
      existsSync(join(repoRoot, cap.schemaPath));
    if (shipped) {
      const owner = ownership[cap.slug];
      if (owner) {
        out[cap.slug] = out[cap.slug] ?? [];
        out[cap.slug].push(owner);
      }
    }
  }
  return out;
}

// ============================================================================
// DETECTOR 3 — external_event
// ============================================================================
// Scan beatrice_reg_events (built by the parallel regwatch agent — table
// may not exist yet; we skip gracefully). Title containing
// breach|enforcement|fine → urgent; otherwise opportunity.

interface RegEventRow {
  id: number;
  title: string;
  surface: string | null;
  publishedAt: Date | null;
}

export async function detectExternalEvent(
  since: Date,
): Promise<PendingOpportunity[]> {
  let rows: RegEventRow[] = [];
  try {
    // Use raw SQL so a missing table is the explicit catch path. drizzle's
    // typed table is intentionally not imported — the schema lives in the
    // parallel agent's tranche and may not have landed yet.
    const result = await db.execute(
      sql`SELECT id, title, surface, published_at AS "publishedAt"
          FROM beatrice_reg_events
          WHERE published_at >= ${since}
          ORDER BY published_at DESC
          LIMIT 200`,
    );
    rows = ((result.rows as unknown) as RegEventRow[]) ?? [];
  } catch (err) {
    logger.info(
      `[improvementDetector] beatrice_reg_events not available yet — external-event detector skipping (${err instanceof Error ? err.message : String(err)})`,
    );
    return [];
  }

  const out: PendingOpportunity[] = [];
  for (const r of rows) {
    const member = attributeRegEvent(r.surface ?? "", r.title);
    if (!member) continue;
    const urgent = /\b(breach|enforcement|fine|recall|injunction)\b/i.test(
      r.title,
    );
    out.push({
      teamMember: member,
      signalPattern: "external_event",
      description: `${urgent ? "URGENT" : "External"} reg event affecting ${member}: ${r.title.slice(0, 200)}`,
      evidence: {
        sourceRefs: [{ kind: "beatrice_reg_event", id: r.id, summary: r.title }],
      },
      confidence: urgent ? 0.95 : 0.8,
      estimatedCostUsd: urgent ? 0 : 30, // urgent items go straight to founder, no auto-spend baseline
      severity: urgent ? "urgent" : "opportunity",
    });
  }
  return out;
}

function attributeRegEvent(
  surface: string,
  title: string,
): TeamImprovementMember | null {
  const blob = `${surface} ${title}`;
  for (const [m, keys] of Object.entries(MEMBER_KEYWORDS) as Array<
    [TeamImprovementMember, RegExp[]]
  >) {
    if (keys.some((re) => re.test(blob))) return m;
  }
  // Regulatory events default to Beatrice (CRO) when no member-specific
  // keyword matches.
  return "beatrice";
}

// ============================================================================
// DETECTOR 4 — recurring_dispatch_flag
// ============================================================================
// Scan solene_decisions.rationale for "infrastructure gap" / "would be
// cleaner if Y existed" patterns. ≥3 mentions in 14d → opportunity.
// Honest constraint: no first-class dispatched-agent-report ledger exists
// yet; rationale is the proxy. Phase 2 of this work will swap to the real
// ledger once it lands.

export async function detectRecurringDispatchFlag(
  member: TeamImprovementMember,
  since: Date,
): Promise<PendingOpportunity[]> {
  const decisions = await db
    .select({
      id: soleneDecisions.id,
      rationale: soleneDecisions.rationale,
      contextSummary: soleneDecisions.contextSummary,
      decidedAt: soleneDecisions.decidedAt,
    })
    .from(soleneDecisions)
    .where(gte(soleneDecisions.decidedAt, since))
    .orderBy(desc(soleneDecisions.decidedAt));

  const memberRegex = MEMBER_KEYWORDS[member];
  const buckets = new Map<string, { ids: number[]; sample: string }>();
  for (const d of decisions) {
    const text = `${d.rationale ?? ""}\n${d.contextSummary ?? ""}`;
    if (!memberRegex.some((re) => re.test(text))) continue;
    for (const re of DISPATCH_FLAG_PHRASES) {
      const m = text.match(re);
      if (!m) continue;
      const key = m[0].toLowerCase();
      const b = buckets.get(key) ?? { ids: [], sample: text.slice(0, 200) };
      b.ids.push(d.id);
      buckets.set(key, b);
    }
  }

  const out: PendingOpportunity[] = [];
  for (const [phrase, b] of buckets) {
    if (b.ids.length < 3) continue;
    out.push({
      teamMember: member,
      signalPattern: "recurring_dispatch_flag",
      description: `${member}: dispatch rationales repeatedly flag "${phrase}" (${b.ids.length} in ${DETECTOR_WINDOW_DAYS}d) — likely infrastructure gap`,
      evidence: {
        sourceRefs: b.ids.map((id) => ({ kind: "solene_decision", id })),
        counts: { mentions: b.ids.length },
        notes: `Sample: ${b.sample}`,
      },
      confidence: 0.85,
      estimatedCostUsd: 40,
      severity: "opportunity",
    });
  }
  return out;
}

// ============================================================================
// DETECTOR 5 — successful_pattern
// ============================================================================
// Mirror of detector #2 but framed positively: when a discipline-
// formalizing capability is shipped for one member and missing for another
// who needs it, surface a "replicate the win" opportunity. We deliberately
// emit slightly different description text so the UNIQUE constraint allows
// both detector #2 and #5 to fire without collision (they're different
// signals; the founder might want to see both phrasings).

export async function detectSuccessfulPattern(): Promise<PendingOpportunity[]> {
  const shipped = computeShippedCapabilities();
  const out: PendingOpportunity[] = [];
  for (const [memberKey, gaps] of Object.entries(MEMBER_BASELINE_GAPS) as Array<
    [TeamImprovementMember, BaselineGap[]]
  >) {
    for (const gap of gaps) {
      for (const slug of gap.closesIfMemberHas) {
        const owners = shipped[slug] ?? [];
        const owner = owners.find((o) => o !== memberKey);
        if (!owner) continue;
        const cap = CAPABILITY_REGISTRY.find((c) => c.slug === slug);
        if (!cap) continue;
        out.push({
          teamMember: memberKey,
          signalPattern: "successful_pattern",
          description: `Replicate ${owner}'s ${cap.label} for ${memberKey} — pattern worked once, port it`,
          evidence: {
            sourceRefs: [
              { kind: "service_path", summary: cap.servicePath },
              { kind: "team_member_baseline", id: memberKey, summary: gap.label },
            ],
            notes: `${owner}'s ${cap.label} is the proven template.`,
          },
          confidence: 0.75,
          estimatedCostUsd: 35,
          severity: "opportunity",
        });
      }
    }
  }
  return out;
}

// ============================================================================
// DETECTOR 6 — volume_threshold
// ============================================================================
// Count commits per member per domain within the window via git log.
// Crossing 50 → "formalize," 200 → "split into sub-roles." Heuristic on
// commit-message prefix matches against MEMBER_KEYWORDS.

export async function detectVolumeThreshold(
  member: TeamImprovementMember,
  since: Date,
  opts: { getCommitCount?: (m: TeamImprovementMember, since: Date) => number } = {},
): Promise<PendingOpportunity[]> {
  const get = opts.getCommitCount ?? defaultGitCommitCount;
  let count = 0;
  try {
    count = get(member, since);
  } catch (err) {
    logger.info(
      `[improvementDetector] git commit count failed for ${member}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }

  const out: PendingOpportunity[] = [];
  for (const tier of VOLUME_TIERS) {
    if (count < tier.count) continue;
    out.push({
      teamMember: member,
      signalPattern: "volume_threshold",
      description: `${member} has crossed ${tier.count}-commit tier (${count} in ${DETECTOR_WINDOW_DAYS}d) — ${tier.label}`,
      evidence: {
        counts: { commits: count, tier: tier.count },
        notes: `Heuristic: commit-message keyword match.`,
      },
      confidence: 0.7,
      estimatedCostUsd: 0, // info-level; no auto-spend
      severity: "info",
    });
  }
  return out;
}

function defaultGitCommitCount(
  member: TeamImprovementMember,
  since: Date,
): number {
  const repoRoot = process.env.IMPROVEMENT_REPO_ROOT ?? process.cwd();
  const sinceIso = since.toISOString();
  // Grep on the commit subject only. Multiple keywords joined with \|.
  const pattern = MEMBER_KEYWORDS[member]
    .map((re) => re.source.replace(/\\b/g, ""))
    .join("\\|");
  try {
    const out = execSync(
      `git -C ${shellQuote(repoRoot)} log --since=${shellQuote(sinceIso)} --pretty=%s | grep -ic '${pattern.replace(/'/g, "")}' || true`,
      { encoding: "utf-8", timeout: 5000 },
    );
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// ============================================================================
// DETECTOR 7 — capital_concentration
// ============================================================================
// Group solene_capital_events in window by member-attribution (best-effort
// keyword match against contextSummary). When one member >50% of total
// spend AND their recent commit count is ≤ minimal-threshold (meaning
// burn without shipped infra), fire.

export async function detectCapitalConcentration(
  since: Date,
  opts: { getCommitCount?: (m: TeamImprovementMember, since: Date) => number } = {},
): Promise<PendingOpportunity[]> {
  const events = await db
    .select({
      id: soleneCapitalEvents.id,
      eventType: soleneCapitalEvents.eventType,
      costUsd: soleneCapitalEvents.costUsd,
      contextSummary: soleneCapitalEvents.contextSummary,
      occurredAt: soleneCapitalEvents.occurredAt,
    })
    .from(soleneCapitalEvents)
    .where(gte(soleneCapitalEvents.occurredAt, since));

  if (events.length === 0) return [];

  const totals: Record<TeamImprovementMember, number> = {
    iris: 0,
    soren: 0,
    beatrice: 0,
    krieger: 0,
    solene: 0,
  };
  const idsByMember: Record<TeamImprovementMember, number[]> = {
    iris: [],
    soren: [],
    beatrice: [],
    krieger: [],
    solene: [],
  };
  let grandTotal = 0;
  for (const e of events) {
    const cost = Number(e.costUsd);
    if (!Number.isFinite(cost) || cost <= 0) continue;
    grandTotal += cost;
    const member = attributeCapitalEvent(e.contextSummary ?? "");
    if (!member) continue;
    totals[member] += cost;
    idsByMember[member].push(e.id);
  }
  if (grandTotal <= 0) return [];

  const getCommits = opts.getCommitCount ?? defaultGitCommitCount;
  const out: PendingOpportunity[] = [];
  for (const [m, total] of Object.entries(totals) as Array<
    [TeamImprovementMember, number]
  >) {
    const pct = (total / grandTotal) * 100;
    if (pct <= CAPITAL_CONCENTRATION_THRESHOLD_PERCENT) continue;
    // Movement proxy: did this member ship anything in the same window?
    let commits = 0;
    try {
      commits = getCommits(m, since);
    } catch {}
    if (commits >= 5) {
      // Heavy spend but ALSO heavy shipping — not concentration without
      // movement; skip.
      continue;
    }
    out.push({
      teamMember: m,
      signalPattern: "capital_concentration",
      description: `${m} consumed ${pct.toFixed(0)}% of capital ($${total.toFixed(2)}/$${grandTotal.toFixed(2)} in ${DETECTOR_WINDOW_DAYS}d) with only ${commits} attributed commits — efficiency review`,
      evidence: {
        sourceRefs: idsByMember[m].map((id) => ({
          kind: "solene_capital_event",
          id,
        })),
        counts: { totalUsdCents: Math.round(total * 100), commits },
      },
      confidence: 0.8,
      estimatedCostUsd: 0, // analysis dispatch; no infra cost
      severity: "opportunity",
    });
  }
  return out;
}

function attributeCapitalEvent(contextSummary: string): TeamImprovementMember | null {
  for (const [m, keys] of Object.entries(MEMBER_KEYWORDS) as Array<
    [TeamImprovementMember, RegExp[]]
  >) {
    if (keys.some((re) => re.test(contextSummary))) return m;
  }
  return null;
}

// ============================================================================
// HELPERS
// ============================================================================

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

// Silence unused warnings on imports that aid readability.
void and;
void eq;
void inArray;
void isNotNull;
