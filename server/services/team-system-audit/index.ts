/**
 * SOLENE v3 — TEAM-SYSTEM audit service.
 *
 * Detection-only. Persists continuous + weekly sweeps that score the team
 * AS A SYSTEM against six overarching elite-bar dimensions, distinct from
 * any per-member audit:
 *
 *   1. cross_team_handoff      — Iris commits touching money-touching code
 *                                must see a Beatrice audit fire within 24h;
 *                                Soren commits with $ figures must see a
 *                                truth-engine pass. Heuristic via commit
 *                                prefix + file-path domain attribution.
 *   2. coordination_quality    — ≥2 agents modifying the same file in the
 *                                same hour, accidental sweeps of another
 *                                member's untracked files (e.g. `git add
 *                                -A` from a different domain). One finding
 *                                per occurrence, severity = warn.
 *   3. anti_fragmentation      — recent commit's `+` lines contain text
 *                                matching `-` lines from a different file's
 *                                prior commit in the last 30 days. Imperfect
 *                                heuristic, flagged for Solene review.
 *   4. outside_in_benchmark    — quarterly RSS pull of Stripe Engineering,
 *                                Linear blog, etc. Surfaces ≤5 practices
 *                                that keyword-match AcreOS-relevant patterns.
 *                                Honest constraint: keyword-match, not deep
 *                                analysis.
 *   5. team_synergy            — week-over-week cross-functional commit
 *                                count (commits touching files from ≥2
 *                                members' domains). Warn if score drops
 *                                >30% w/w.
 *   6. elite_bar_trajectory    — per-member, read elite-bars/<member>.md;
 *                                the "Closed this period" section must
 *                                have had entries in the last 90 days.
 *                                Plateau (no entries 90d) = warn per
 *                                member.
 *
 * Two entrypoints:
 *
 *   1. runTeamSystemAudit({ scope })
 *      `continuous` runs scanners 1/2/3/5/6 (60-min cadence). `weekly` runs
 *      scanner 4 (outside-in benchmark). `full` runs all six (manual).
 *      Persists findings via UNIQUE(run_id, dimension, description) so re-
 *      runs over the same window are no-ops at the DB layer.
 *
 *   2. Individual `scanX()` exports for unit-test isolation.
 *
 * Drift signal threshold: ≥1 critical OR ≥3 fail OR ≥6 warn findings in
 * a single run → logger.error + Sentry capture with tag
 * `team_system_audit_drift`.
 *
 * Remediation: NONE here. The audit surfaces drift; Solene addresses it
 * via memory updates, dispatches, and the morning brief downstream.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join as pathJoin, resolve as pathResolve } from "node:path";
import { execSync } from "node:child_process";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import {
  teamSystemAuditRuns,
  teamSystemAuditFindings,
  type InsertTeamSystemAuditFinding,
  type TeamSystemAuditDimension,
  type TeamSystemAuditSeverity,
} from "@shared/schema/team-system-audit";
import { logger } from "../../utils/logger";

// ============================================================================
// CONSTANTS
// ============================================================================

const DESCRIPTION_MAX = 500;

export const TEAM_SYSTEM_DRIFT_THRESHOLDS = {
  criticalCount: 1,
  failCount: 3,
  warnCount: 6,
} as const;

export type TeamMember = "iris" | "soren" | "beatrice" | "krieger" | "solene";

// File-path patterns attributing each path to a member's domain. Conservative
// — when a path matches multiple members, we attribute to all of them.
export const MEMBER_DOMAIN_PATTERNS: Record<TeamMember, RegExp[]> = {
  iris: [
    /\bserver\/services\/iris\//i,
    /\bserver\/services\/(?:performance|perf)\//i,
    /\bshared\/schema\/iris-perf\.ts/i,
    /\bserver\/db\.ts/i,
    /\bscripts\/migrate\.mjs/i,
    /\bserver\/middleware\//i,
  ],
  soren: [
    /\bclient\/src\/pages\/learn\//i,
    /\bclient\/src\/pages\/landing/i,
    /\bserver\/services\/soren\//i,
    /\bshared\/schema\/soren-/i,
    /\bdocs\/marketing\//i,
  ],
  beatrice: [
    /\bserver\/services\/pax\//i,
    /\bserver\/services\/beatrice\//i,
    /\bserver\/utils\/validatePaxResponse\.ts/i,
    /\bshared\/schema\/pax-audit\.ts/i,
    /\bshared\/schema\/compliance\.ts/i,
    /\bshared\/schema\/reg-z\.ts/i,
    /\bserver\/routes-admin-compliance\.ts/i,
  ],
  krieger: [
    /\bclient\/src\/components\/.*mobile/i,
    /\bclient\/src\/hooks\/use-mobile/i,
    /\btests\/mobile\//i,
    /\bclient\/src\/components\/layout-mobile/i,
  ],
  solene: [
    /\bserver\/services\/solene\//i,
    /\bshared\/schema\/solene-/i,
    /\bshared\/schema\/team-system-audit\.ts/i,
    /\bserver\/services\/team-system-audit\//i,
    /\bserver\/routes-solene-/i,
    /\bdocs\/internal\/solene-/i,
  ],
};

// Commit message prefix → domain attribution.
const PREFIX_TO_MEMBER: Record<string, TeamMember> = {
  iris: "iris",
  soren: "soren",
  beatrice: "beatrice",
  krieger: "krieger",
  solene: "solene",
};

// Money-touching file patterns — if Iris commits these, Beatrice must
// audit within 24h.
const MONEY_TOUCHING_PATTERNS: RegExp[] = [
  /\bserver\/services\/(stripe|billing|payments)\//i,
  /\bserver\/services\/finance\//i,
  /\bemail.*[sS]ervice\.ts/, // emailService.ts pattern from directive
  /\bshared\/schema\/finance\.ts/,
  /\bserver\/services\/accounting\//,
];

// Customer-visible numeric-claim patterns — landing copy with $X figures.
const NUMERIC_CLAIM_PATTERNS: RegExp[] = [
  /\$\s?\d{2,}/, // $50, $1,000, etc.
  /\b\d{2,}%\b/, // 50%, 99%
];

// Codename leak in customer surface (per persona architecture).
const CODENAME_LEAK_PATTERNS: RegExp[] = [
  /\b(Atlas|Sophie|Forge|Solene|Iris|Soren|Beatrice|Krieger)\b/,
];
const CUSTOMER_SURFACE_PATTERNS: RegExp[] = [
  /\bclient\/src\/pages\/learn\//i,
  /\bclient\/src\/pages\/landing/i,
  /\bclient\/src\/components\/pax\//i,
];

// ============================================================================
// CITATIONS
// ============================================================================

export const TEAM_SYSTEM_CITATIONS: Record<TeamSystemAuditDimension, string> = {
  cross_team_handoff:
    "feedback_implicit_trust_and_overarching_perspective.md — cross-team handoff quality: money-touching commits must see Beatrice review; numeric claims must see truth-engine fire",
  coordination_quality:
    "feedback_implicit_trust_and_overarching_perspective.md — coordination quality: collisions on adjacent surfaces are a system-level elite drift (cf. aff4c273 Krieger sweep of Soren's untracked /learn files)",
  anti_fragmentation:
    "feedback_implicit_trust_and_overarching_perspective.md — anti-fragmentation: member B shipping ¬X after member A shipped X is a Solene-level arbitration failure",
  outside_in_benchmark:
    "feedback_implicit_trust_and_overarching_perspective.md — outside-in elite benchmarking: quarterly scan of comparable orgs' published practices for patterns AcreOS should import",
  team_synergy:
    "feedback_implicit_trust_and_overarching_perspective.md — team-level synergy: cross-functional commit volume + collaborative dispatches as a leading indicator",
  elite_bar_trajectory:
    "feedback_implicit_trust_and_overarching_perspective.md — each member's elite bar should be moving up; 90-day plateau = drift",
};

// ============================================================================
// TYPES
// ============================================================================

export interface PendingTeamSystemFinding {
  dimension: TeamSystemAuditDimension;
  severity: TeamSystemAuditSeverity;
  description: string;
  evidence: Record<string, unknown>;
}

export type RunScope = "continuous" | "weekly" | "full";

export interface RunTeamSystemAuditOptions {
  scope: RunScope;
  /** Override the rolling window for continuous scanners (hours). */
  windowHours?: number;
}

export interface RunTeamSystemAuditResult {
  runId: number;
  scope: RunScope;
  dimensionsScanned: TeamSystemAuditDimension[];
  findingCount: number;
  driftSignalEmitted: boolean;
  findings: PendingTeamSystemFinding[];
}

// ============================================================================
// DATA SOURCES — stubbable for tests.
// ============================================================================

export interface CommitInfo {
  sha: string;
  timestamp: Date;
  authorMessage: string; // commit message
  files: string[]; // changed file paths
  /** Optional diff text for anti-fragmentation scanner. */
  diff?: string;
}

export interface AuditFiringSummary {
  /** ISO timestamp of last paxAuditRuns row (Beatrice). */
  beatriceLastRunAt: Date | null;
  /** ISO timestamp of last soleneAuditRuns row. */
  soleneLastRunAt: Date | null;
}

let commitSource: (sinceHours: number) => CommitInfo[] = defaultCommitSource;
let auditFiringSource: () => Promise<AuditFiringSummary> =
  defaultAuditFiringSource;
let eliteBarSource: () => EliteBarFile[] = defaultEliteBarSource;
let benchmarkFeedSource: () => Promise<BenchmarkItem[]> =
  defaultBenchmarkFeedSource;

/** Test injectors. Pass `null` to reset to the default implementation. */
export function setCommitSourceForTest(
  src: ((sinceHours: number) => CommitInfo[]) | null,
): void {
  commitSource = src ?? defaultCommitSource;
}
export function setAuditFiringSourceForTest(
  src: (() => Promise<AuditFiringSummary>) | null,
): void {
  auditFiringSource = src ?? defaultAuditFiringSource;
}
export function setEliteBarSourceForTest(
  src: (() => EliteBarFile[]) | null,
): void {
  eliteBarSource = src ?? defaultEliteBarSource;
}
export function setBenchmarkFeedSourceForTest(
  src: (() => Promise<BenchmarkItem[]>) | null,
): void {
  benchmarkFeedSource = src ?? defaultBenchmarkFeedSource;
}

function defaultCommitSource(sinceHours: number): CommitInfo[] {
  try {
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000)
      .toISOString();
    const raw = execSync(
      `git log --since="${since}" --name-only --pretty=format:__COMMIT__%n%H%n%ct%n%s`,
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    return parseGitLog(raw);
  } catch (err) {
    logger.warn(
      "[teamSystemAudit] defaultCommitSource failed",
      err instanceof Error ? err : undefined,
    );
    return [];
  }
}

/** Exported for tests. */
export function parseGitLog(raw: string): CommitInfo[] {
  const out: CommitInfo[] = [];
  const blocks = raw.split("__COMMIT__\n").filter((b) => b.trim().length > 0);
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 3) continue;
    const sha = lines[0]?.trim() ?? "";
    const ts = Number(lines[1]?.trim() ?? "0");
    const message = lines[2] ?? "";
    const files = lines.slice(3).map((l) => l.trim()).filter(Boolean);
    if (!sha) continue;
    out.push({
      sha,
      timestamp: new Date(ts * 1000),
      authorMessage: message,
      files,
    });
  }
  return out;
}

async function defaultAuditFiringSource(): Promise<AuditFiringSummary> {
  try {
    const { paxAuditRuns } = await import("@shared/schema/pax-audit");
    const { soleneAuditRuns } = await import("@shared/schema/solene-audit");
    const [pax] = await db
      .select({ ts: paxAuditRuns.runStartedAt })
      .from(paxAuditRuns)
      .orderBy(sql`${paxAuditRuns.runStartedAt} DESC`)
      .limit(1);
    const [sol] = await db
      .select({ ts: soleneAuditRuns.runStartedAt })
      .from(soleneAuditRuns)
      .orderBy(sql`${soleneAuditRuns.runStartedAt} DESC`)
      .limit(1);
    return {
      beatriceLastRunAt: pax?.ts ?? null,
      soleneLastRunAt: sol?.ts ?? null,
    };
  } catch (err) {
    logger.warn(
      "[teamSystemAudit] defaultAuditFiringSource failed",
      err instanceof Error ? err : undefined,
    );
    return { beatriceLastRunAt: null, soleneLastRunAt: null };
  }
}

export interface EliteBarFile {
  member: TeamMember;
  path: string;
  /** Date of the most-recent entry under "Closed this period", null if none. */
  lastClosedAt: Date | null;
}

function defaultEliteBarSource(): EliteBarFile[] {
  const out: EliteBarFile[] = [];
  const root = pathResolve(
    process.cwd(),
    "docs/company/role-development/elite-bars",
  );
  if (!existsSync(root)) return out;
  let names: string[] = [];
  try {
    names = readdirSync(root);
  } catch {
    return out;
  }
  const memberFromName = (n: string): TeamMember | null => {
    const stem = n.replace(/\.md$/, "").toLowerCase();
    if (stem === "iris" || stem === "soren" || stem === "beatrice" ||
        stem === "krieger" || stem === "solene") return stem;
    return null;
  };
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const member = memberFromName(name);
    if (!member) continue;
    const full = pathJoin(root, name);
    try {
      if (!statSync(full).isFile()) continue;
      const body = readFileSync(full, "utf8");
      out.push({
        member,
        path: full,
        lastClosedAt: parseLastClosedDate(body),
      });
    } catch {
      // skip unreadable
    }
  }
  return out;
}

/** Parse the most-recent date in the "Closed this period" section. */
export function parseLastClosedDate(body: string): Date | null {
  // Section bounded by "## Closed this period" → next "## "
  const startIdx = body.search(/^##\s+Closed this period\b/m);
  if (startIdx < 0) return null;
  const tail = body.slice(startIdx);
  const endRel = tail.slice(2).search(/^##\s+/m);
  const section = endRel < 0 ? tail : tail.slice(0, endRel + 2);
  // Find every ISO-ish YYYY-MM-DD inside the section.
  const matches = section.match(/\b(\d{4}-\d{2}-\d{2})\b/g);
  if (!matches || matches.length === 0) return null;
  let latest: Date | null = null;
  for (const m of matches) {
    const d = new Date(m);
    if (!Number.isFinite(d.getTime())) continue;
    if (!latest || d.getTime() > latest.getTime()) latest = d;
  }
  return latest;
}

export interface BenchmarkItem {
  source: string;
  url: string;
  title: string;
  publishedAt: Date | null;
}

const BENCHMARK_FEEDS = [
  { source: "stripe-engineering", url: "https://stripe.com/blog/engineering/feed.atom" },
  { source: "linear-blog", url: "https://linear.app/blog/rss.xml" },
];

const BENCHMARK_KEYWORD_PATTERNS: RegExp[] = [
  /\bidempot/i,
  /\bobservab/i,
  /\bdeploy/i,
  /\bincident/i,
  /\baudit/i,
  /\bdesign\s+system/i,
  /\bpostmortem/i,
  /\bcaching/i,
  /\bpostgres/i,
  /\bmigration/i,
];

async function defaultBenchmarkFeedSource(): Promise<BenchmarkItem[]> {
  // Honest constraint: we don't ship an XML parser dep just for this.
  // Default returns []; tests inject. In production a follow-on Iris job
  // (or a node-fetch + minimal regex) populates this.
  return [];
}

// ============================================================================
// runTeamSystemAudit
// ============================================================================

export async function runTeamSystemAudit(
  opts: RunTeamSystemAuditOptions,
): Promise<RunTeamSystemAuditResult> {
  const scope = opts.scope;
  const dimensions = dimensionsForScope(scope);
  const runStartedAt = new Date();

  const [run] = await db
    .insert(teamSystemAuditRuns)
    .values({
      runStartedAt,
      dimensionsScanned: dimensions,
    })
    .returning({ id: teamSystemAuditRuns.id });
  const runId = run.id;

  const findings: PendingTeamSystemFinding[] = [];
  try {
    const windowHours = opts.windowHours ?? 24;

    if (dimensions.includes("cross_team_handoff")) {
      const commits = commitSource(windowHours);
      const audits = await auditFiringSource();
      findings.push(...scanCrossTeamHandoffs(commits, audits));
    }
    if (dimensions.includes("coordination_quality")) {
      const commits = commitSource(windowHours);
      findings.push(...scanCoordinationQuality(commits));
    }
    if (dimensions.includes("anti_fragmentation")) {
      // Anti-fragmentation looks at the longer rolling window.
      const commits = commitSource(30 * 24);
      findings.push(...scanAntiFragmentation(commits));
    }
    if (dimensions.includes("team_synergy")) {
      const commits = commitSource(14 * 24);
      findings.push(...scanTeamSynergy(commits));
    }
    if (dimensions.includes("elite_bar_trajectory")) {
      const bars = eliteBarSource();
      findings.push(...scanEliteBarTrajectory(bars));
    }
    if (dimensions.includes("outside_in_benchmark")) {
      const items = await benchmarkFeedSource();
      findings.push(...scanOutsideInBenchmark(items));
    }

    if (findings.length > 0) {
      const rows: InsertTeamSystemAuditFinding[] = findings.map((f) => ({
        runId,
        dimension: f.dimension,
        severity: f.severity,
        description: truncate(f.description, DESCRIPTION_MAX),
        evidence: f.evidence,
      }));
      await db
        .insert(teamSystemAuditFindings)
        .values(rows)
        .onConflictDoNothing({
          target: [
            teamSystemAuditFindings.runId,
            teamSystemAuditFindings.dimension,
            teamSystemAuditFindings.description,
          ],
        });
    }

    const drift = driftMet(findings);
    if (drift) {
      emitDriftSignal({
        runId,
        scope,
        findings,
      });
    }

    await db
      .update(teamSystemAuditRuns)
      .set({
        runEndedAt: new Date(),
        findingCount: findings.length,
        driftSignalEmitted: drift,
      })
      .where(sql`${teamSystemAuditRuns.id} = ${runId}`);

    logger.info(
      `[teamSystemAudit] run ${runId} scope=${scope} dims=${dimensions.length} findings=${findings.length} drift=${drift}`,
    );

    return {
      runId,
      scope,
      dimensionsScanned: dimensions,
      findingCount: findings.length,
      driftSignalEmitted: drift,
      findings,
    };
  } catch (err) {
    logger.error(
      `[teamSystemAudit] run ${runId} threw`,
      err instanceof Error ? err : undefined,
    );
    await db
      .update(teamSystemAuditRuns)
      .set({
        runEndedAt: new Date(),
        skipReason: `error: ${err instanceof Error ? err.message : String(err)}`,
      })
      .where(sql`${teamSystemAuditRuns.id} = ${runId}`);
    throw err;
  }
}

function dimensionsForScope(scope: RunScope): TeamSystemAuditDimension[] {
  if (scope === "continuous") {
    return [
      "cross_team_handoff",
      "coordination_quality",
      "anti_fragmentation",
      "team_synergy",
      "elite_bar_trajectory",
    ];
  }
  if (scope === "weekly") return ["outside_in_benchmark"];
  // full
  return [
    "cross_team_handoff",
    "coordination_quality",
    "anti_fragmentation",
    "outside_in_benchmark",
    "team_synergy",
    "elite_bar_trajectory",
  ];
}

function driftMet(findings: PendingTeamSystemFinding[]): boolean {
  const critical = findings.filter((f) => f.severity === "critical").length;
  const fail = findings.filter((f) => f.severity === "fail").length;
  const warn = findings.filter((f) => f.severity === "warn").length;
  return (
    critical >= TEAM_SYSTEM_DRIFT_THRESHOLDS.criticalCount ||
    fail >= TEAM_SYSTEM_DRIFT_THRESHOLDS.failCount ||
    warn >= TEAM_SYSTEM_DRIFT_THRESHOLDS.warnCount
  );
}

// ============================================================================
// SCANNER 1 — cross_team_handoff
// ============================================================================

/**
 * Attribute a commit to a team member via prefix + file-path heuristic.
 * Returns the set of members the commit touches (a commit can hit multiple
 * domains, e.g. a Solene change that touches Iris's perf service).
 */
export function attributeCommitToMembers(commit: CommitInfo): TeamMember[] {
  const out = new Set<TeamMember>();
  for (const m of authorMembersFromPrefix(commit)) out.add(m);
  for (const file of commit.files) {
    for (const member of Object.keys(MEMBER_DOMAIN_PATTERNS) as TeamMember[]) {
      if (MEMBER_DOMAIN_PATTERNS[member].some((re) => re.test(file))) {
        out.add(member);
      }
    }
  }
  return Array.from(out);
}

/**
 * Members derivable from the commit message prefix alone (e.g., "iris: foo").
 * Conservative: returns [] when no recognized prefix is present.
 */
export function authorMembersFromPrefix(commit: CommitInfo): TeamMember[] {
  const out: TeamMember[] = [];
  const lower = commit.authorMessage.toLowerCase();
  for (const [prefix, member] of Object.entries(PREFIX_TO_MEMBER)) {
    if (lower.startsWith(`${prefix}:`) || lower.startsWith(`${prefix} :`)) {
      out.push(member);
    }
  }
  return out;
}

export function scanCrossTeamHandoffs(
  commits: CommitInfo[],
  audits: AuditFiringSummary,
): PendingTeamSystemFinding[] {
  const out: PendingTeamSystemFinding[] = [];
  const now = Date.now();
  const WINDOW_MS = 24 * 60 * 60 * 1000;

  for (const commit of commits) {
    const ageMs = now - commit.timestamp.getTime();
    if (ageMs < 0) continue;

    const touchesMoney = commit.files.some((f) =>
      MONEY_TOUCHING_PATTERNS.some((re) => re.test(f)),
    );
    if (touchesMoney) {
      const beatriceFiredAfter =
        audits.beatriceLastRunAt &&
        audits.beatriceLastRunAt.getTime() >= commit.timestamp.getTime();
      if (!beatriceFiredAfter && ageMs <= WINDOW_MS) {
        out.push({
          dimension: "cross_team_handoff",
          severity: "fail",
          description: `Money-touching commit ${commit.sha.slice(0, 8)} had no Beatrice audit fire within 24h`,
          evidence: {
            sha: commit.sha,
            files: commit.files.filter((f) =>
              MONEY_TOUCHING_PATTERNS.some((re) => re.test(f)),
            ),
            beatriceLastRunAt: audits.beatriceLastRunAt,
            commitTimestamp: commit.timestamp,
          },
        });
      }
    }

    const customerVisible = commit.files.some((f) =>
      CUSTOMER_SURFACE_PATTERNS.some((re) => re.test(f)),
    );
    const hasNumericClaim = NUMERIC_CLAIM_PATTERNS.some((re) =>
      re.test(commit.authorMessage),
    );
    if (
      customerVisible &&
      hasNumericClaim &&
      ageMs <= WINDOW_MS
    ) {
      // Truth-engine signal: a Solene audit fire (post-commit) is the best
      // proxy we have for "truth-engine pass on the claim."
      const soleneFiredAfter =
        audits.soleneLastRunAt &&
        audits.soleneLastRunAt.getTime() >= commit.timestamp.getTime();
      if (!soleneFiredAfter) {
        out.push({
          dimension: "cross_team_handoff",
          severity: "warn",
          description: `Customer-visible commit ${commit.sha.slice(0, 8)} with numeric claim had no truth-engine fire within 24h`,
          evidence: {
            sha: commit.sha,
            message: commit.authorMessage,
            customerFiles: commit.files.filter((f) =>
              CUSTOMER_SURFACE_PATTERNS.some((re) => re.test(f)),
            ),
            soleneLastRunAt: audits.soleneLastRunAt,
          },
        });
      }
    }
  }
  return out;
}

// ============================================================================
// SCANNER 2 — coordination_quality
// ============================================================================

export function scanCoordinationQuality(
  commits: CommitInfo[],
): PendingTeamSystemFinding[] {
  const out: PendingTeamSystemFinding[] = [];

  // (a) Same file modified by ≥2 commits within 60 minutes.
  // Bucket commits per file → check pairwise timestamp gaps.
  const fileToCommits = new Map<string, CommitInfo[]>();
  for (const c of commits) {
    for (const f of c.files) {
      const bucket = fileToCommits.get(f) ?? [];
      bucket.push(c);
      fileToCommits.set(f, bucket);
    }
  }
  for (const [file, cs] of fileToCommits.entries()) {
    if (cs.length < 2) continue;
    const sorted = [...cs].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
    for (let i = 1; i < sorted.length; i++) {
      const gapMs = sorted[i].timestamp.getTime() - sorted[i - 1].timestamp.getTime();
      if (gapMs > 60 * 60 * 1000) continue;
      const a = sorted[i - 1];
      const b = sorted[i];
      const aMembers = attributeCommitToMembers(a);
      const bMembers = attributeCommitToMembers(b);
      // Only flag if the two commits are attributed to DIFFERENT members.
      const distinct = aMembers.some((m) => !bMembers.includes(m)) ||
        bMembers.some((m) => !aMembers.includes(m));
      if (!distinct) continue;
      out.push({
        dimension: "coordination_quality",
        severity: "warn",
        description: `Coordination collision on ${file}: ${a.sha.slice(0, 8)} (${aMembers.join("+") || "unknown"}) and ${b.sha.slice(0, 8)} (${bMembers.join("+") || "unknown"}) within 60 minutes`,
        evidence: {
          file,
          commitA: { sha: a.sha, members: aMembers, ts: a.timestamp },
          commitB: { sha: b.sha, members: bMembers, ts: b.timestamp },
          gapMinutes: Math.round(gapMs / 60000),
        },
      });
    }
  }

  // (b) Accidental file-sweep: when a commit's AUTHOR (commit-message
  // prefix) is member X but the commit touches ≥4 files in member Y's
  // domain. We use the prefix-only authorship attribution here so that
  // file-domain matches surface as the sweep (otherwise the file-domain
  // adds Y to members and the sweep is invisible).
  for (const c of commits) {
    const authors = authorMembersFromPrefix(c);
    if (authors.length === 0) continue;
    const fileByMember = new Map<TeamMember, string[]>();
    for (const f of c.files) {
      for (const m of Object.keys(MEMBER_DOMAIN_PATTERNS) as TeamMember[]) {
        if (MEMBER_DOMAIN_PATTERNS[m].some((re) => re.test(f))) {
          const bucket = fileByMember.get(m) ?? [];
          bucket.push(f);
          fileByMember.set(m, bucket);
        }
      }
    }
    for (const [otherMember, swept] of fileByMember.entries()) {
      if (authors.includes(otherMember)) continue;
      if (swept.length < 4) continue;
      out.push({
        dimension: "coordination_quality",
        severity: "warn",
        description: `Accidental file-sweep in ${c.sha.slice(0, 8)} (${authors.join("+")}): swept ${swept.length} files in ${otherMember}'s domain`,
        evidence: {
          sha: c.sha,
          authoredBy: authors,
          sweptDomain: otherMember,
          sweptFiles: swept.slice(0, 10),
        },
      });
    }
  }

  return out;
}

// ============================================================================
// SCANNER 3 — anti_fragmentation
// ============================================================================

export function scanAntiFragmentation(
  commits: CommitInfo[],
): PendingTeamSystemFinding[] {
  const out: PendingTeamSystemFinding[] = [];
  // Heuristic: for each commit pair (recent → older) within 30 days, when
  // the recent commit's message contradicts a prior commit's message
  // (e.g., one sets paxOnly=true, another contains paxOnly=false or
  // removes paxOnly entirely). We restrict to message-level cues because
  // a full diff scan would balloon the runtime.
  if (commits.length === 0) return out;
  // Sort newest → oldest.
  const sorted = [...commits].sort(
    (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
  );

  // Light heuristic: detect codename leak in customer surface (codename
  // mention added to a file under client/src/pages/learn after a prior
  // commit removed it).
  for (const recent of sorted.slice(0, 20)) {
    if (!recent.diff) continue;
    const added = (recent.diff.match(/^\+\s*(.+)$/gm) ?? []).map((l) =>
      l.replace(/^\+\s*/, ""),
    );
    const addedHasCodename = added.some((line) =>
      CODENAME_LEAK_PATTERNS.some((re) => re.test(line)),
    );
    const touchesCustomer = recent.files.some((f) =>
      CUSTOMER_SURFACE_PATTERNS.some((re) => re.test(f)),
    );
    if (addedHasCodename && touchesCustomer) {
      out.push({
        dimension: "anti_fragmentation",
        severity: "fail",
        description: `Commit ${recent.sha.slice(0, 8)} added a codename mention on a customer surface — contradicts persona-architecture rule`,
        evidence: {
          sha: recent.sha,
          message: recent.authorMessage,
          customerFiles: recent.files.filter((f) =>
            CUSTOMER_SURFACE_PATTERNS.some((re) => re.test(f)),
          ),
        },
      });
    }
  }

  // Light heuristic for diff contradictions: for each recent commit's
  // added lines, see if those exact lines were REMOVED by another commit
  // in the prior 30 days in a different file. Caps at first N matches.
  const MAX_CONTRADICTIONS = 5;
  let contraCount = 0;
  for (let i = 0; i < sorted.length && contraCount < MAX_CONTRADICTIONS; i++) {
    const recent = sorted[i];
    if (!recent.diff) continue;
    const added = (recent.diff.match(/^\+\s*([^\n]+)$/gm) ?? [])
      .map((l) => l.replace(/^\+\s*/, "").trim())
      .filter((l) => l.length >= 20 && !l.startsWith("//") && !l.startsWith("*"));
    if (added.length === 0) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const older = sorted[j];
      if (!older.diff) continue;
      // Different file requirement: at least one file in older must NOT be
      // in recent's file list.
      const olderHasNewFile = older.files.some(
        (f) => !recent.files.includes(f),
      );
      if (!olderHasNewFile) continue;
      const removed = (older.diff.match(/^-\s*([^\n]+)$/gm) ?? [])
        .map((l) => l.replace(/^-\s*/, "").trim());
      const match = added.find((a) => removed.includes(a));
      if (!match) continue;
      out.push({
        dimension: "anti_fragmentation",
        severity: "warn",
        description: `Commit ${recent.sha.slice(0, 8)} re-adds a line that ${older.sha.slice(0, 8)} previously removed — possible contradiction (flag for Solene review)`,
        evidence: {
          recentSha: recent.sha,
          olderSha: older.sha,
          excerpt: match.slice(0, 200),
        },
      });
      contraCount += 1;
      break;
    }
  }
  return out;
}

// ============================================================================
// SCANNER 4 — outside_in_benchmark
// ============================================================================

export function scanOutsideInBenchmark(
  items: BenchmarkItem[],
): PendingTeamSystemFinding[] {
  const out: PendingTeamSystemFinding[] = [];
  if (items.length === 0) return out;
  // Surface ≤5 keyword-matching practices.
  const matches: Array<{ item: BenchmarkItem; keywords: string[] }> = [];
  for (const item of items) {
    const hits: string[] = [];
    for (const re of BENCHMARK_KEYWORD_PATTERNS) {
      if (re.test(item.title)) hits.push(re.source);
    }
    if (hits.length > 0) matches.push({ item, keywords: hits });
  }
  matches.sort((a, b) => {
    const ta = a.item.publishedAt?.getTime() ?? 0;
    const tb = b.item.publishedAt?.getTime() ?? 0;
    return tb - ta;
  });
  for (const m of matches.slice(0, 5)) {
    out.push({
      dimension: "outside_in_benchmark",
      severity: "info",
      description: `Benchmark candidate: ${m.item.source} — "${m.item.title.slice(0, 200)}"`,
      evidence: {
        source: m.item.source,
        url: m.item.url,
        title: m.item.title,
        publishedAt: m.item.publishedAt,
        keywords: m.keywords,
        note: "honest-constraint: keyword-match only, not deep analysis",
      },
    });
  }
  return out;
}

// Exported for tests/runtime so a future Iris job can populate the feed.
export const TEAM_SYSTEM_BENCHMARK_FEEDS = BENCHMARK_FEEDS;

// ============================================================================
// SCANNER 5 — team_synergy
// ============================================================================

export function scanTeamSynergy(
  commits: CommitInfo[],
): PendingTeamSystemFinding[] {
  const out: PendingTeamSystemFinding[] = [];
  if (commits.length === 0) return out;
  // Score cross-functional commits in two windows: this-week vs prior-week.
  const now = Date.now();
  const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
  const thisWeek = commits.filter(
    (c) => now - c.timestamp.getTime() <= ONE_WEEK,
  );
  const priorWeek = commits.filter(
    (c) =>
      now - c.timestamp.getTime() > ONE_WEEK &&
      now - c.timestamp.getTime() <= 2 * ONE_WEEK,
  );

  const crossFunctional = (cs: CommitInfo[]): number =>
    cs.filter((c) => attributeCommitToMembers(c).length >= 2).length;

  const thisScore = crossFunctional(thisWeek);
  const priorScore = crossFunctional(priorWeek);

  if (priorScore >= 3 && thisScore < priorScore * 0.7) {
    out.push({
      dimension: "team_synergy",
      severity: "warn",
      description: `Cross-functional commit count dropped >30% w/w (prior=${priorScore}, this=${thisScore})`,
      evidence: {
        thisWeek: thisScore,
        priorWeek: priorScore,
        thisWeekCommits: thisWeek.length,
        priorWeekCommits: priorWeek.length,
        droppedPct: Math.round(
          ((priorScore - thisScore) / Math.max(1, priorScore)) * 100,
        ),
      },
    });
  }
  return out;
}

// ============================================================================
// SCANNER 6 — elite_bar_trajectory
// ============================================================================

export function scanEliteBarTrajectory(
  bars: EliteBarFile[],
): PendingTeamSystemFinding[] {
  const out: PendingTeamSystemFinding[] = [];
  const PLATEAU_MS = 90 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const bar of bars) {
    if (!bar.lastClosedAt) {
      out.push({
        dimension: "elite_bar_trajectory",
        severity: "warn",
        description: `${bar.member}: elite-bar file has no entries under "Closed this period" — bar is not visibly moving`,
        evidence: {
          member: bar.member,
          path: bar.path,
          lastClosedAt: null,
        },
      });
      continue;
    }
    const ageMs = now - bar.lastClosedAt.getTime();
    if (ageMs >= PLATEAU_MS) {
      const daysOld = Math.round(ageMs / (24 * 60 * 60 * 1000));
      out.push({
        dimension: "elite_bar_trajectory",
        severity: "warn",
        description: `${bar.member}: elite-bar last closed ${daysOld}d ago (>90d plateau)`,
        evidence: {
          member: bar.member,
          path: bar.path,
          lastClosedAt: bar.lastClosedAt,
          daysSinceLastClose: daysOld,
        },
      });
    }
  }
  return out;
}

// ============================================================================
// DRIFT SIGNAL
// ============================================================================

interface DriftSignalInput {
  runId: number;
  scope: RunScope;
  findings: PendingTeamSystemFinding[];
}

function emitDriftSignal(input: DriftSignalInput): void {
  const critical = input.findings.filter((f) => f.severity === "critical").length;
  const fail = input.findings.filter((f) => f.severity === "fail").length;
  const warn = input.findings.filter((f) => f.severity === "warn").length;
  const tags = {
    runId: input.runId,
    scope: input.scope,
    critical,
    fail,
    warn,
    component: "team_system_audit",
  };
  logger.error(
    `[teamSystemAudit] drift signal: run=${input.runId} scope=${input.scope} crit=${critical} fail=${fail} warn=${warn}`,
    undefined,
    { metadata: { detail: tags } },
  );

  if (!process.env.SENTRY_DSN) return;
  void (async () => {
    try {
      const Sentry = await import("@sentry/node");
      Sentry.captureMessage(
        `Team-system audit drift signal — run ${input.runId}`,
        {
          level: "error",
          tags: {
            audit_run_id: String(input.runId),
            audit_scope: input.scope,
            audit_critical: String(critical),
            audit_fail: String(fail),
            audit_warn: String(warn),
            component: "team_system_audit",
            team_system_audit_drift: "true",
          },
        },
      );
    } catch (err) {
      logger.warn(
        "[teamSystemAudit] sentry capture failed",
        err instanceof Error ? err : undefined,
      );
    }
  })();
}

// ============================================================================
// HELPERS
// ============================================================================

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}
