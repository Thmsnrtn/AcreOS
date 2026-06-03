/**
 * SOLENE — agent claims service (Layer 1 capability #2).
 *
 * Cross-agent coordination primitive: each dispatched agent registers the
 * file-surface globs it is authorized to touch BEFORE work begins. The
 * pre-commit hook then queries active claims and blocks a commit whose
 * staged files fall under another agent's claim. Solene queries
 * predictDispatchConflicts() at dispatch time to either queue a new
 * dispatch behind a conflicting one or escalate to Tom.
 *
 * Five entrypoints:
 *
 *   claimSurfaces(opts)
 *     INSERT a row in status='active'. ttl defaults to 60min, max 12h.
 *     Validates patterns are non-empty + agentRole is a known value.
 *     Returns the new claim id.
 *
 *   releaseClaim(claimId)
 *     UPDATE released_at = now(), claim_status = 'released'. Idempotent.
 *
 *   expireStaleClaims()
 *     Cron-callable. Walks active rows whose claimed_at + ttl < now() and
 *     flips them to 'expired'. Returns the number of rows touched.
 *
 *   findConflictingClaims(patterns)
 *     Returns active claims whose patterns overlap with the proposed
 *     patterns (minimatch-based). Excludes 'released' + 'expired'.
 *
 *   isFileUnderClaim(filePath, excludeClaimId?)
 *     Returns the conflicting claim (if any). Used by the pre-commit
 *     hook's CLI helper to enforce.
 *
 *   predictDispatchConflicts(patterns)
 *     Alias around findConflictingClaims with the same semantics, named
 *     so Solene's dispatch-prep code reads correctly at the call site.
 *
 * GLOB OVERLAP SEMANTICS
 * ----------------------
 * Two pattern sets "overlap" if any one pattern from set A would match a
 * file the other pattern set would also match. Computing the full set
 * intersection is intractable in general, so we approximate with two
 * cheap-but-sound checks:
 *   1. Direct overlap — for each pattern in A, generate a small sample of
 *      candidate file paths (the literal-prefix part before the first
 *      glob char + a trailing `/x`) and minimatch them against every
 *      pattern in B.
 *   2. Pattern-string subset — two patterns that share a common
 *      literal-prefix are flagged as overlapping (fast path; covers the
 *      common cases of `server/services/iris/*` vs `server/services/iris/*.ts`).
 *
 * The two checks together are intentionally permissive — false positives
 * are safe (block + force agent coordination), false negatives are the
 * dangerous direction. The pre-commit hook is the last line; the
 * dispatch-time predictor is the first.
 */

import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { minimatch } from "minimatch";
import { db } from "../../db";
import {
  soleneAgentClaims,
  CLAIM_AGENT_ROLES,
  DEFAULT_CLAIM_TTL_MINUTES,
  MAX_CLAIM_TTL_MINUTES,
  type SoleneAgentClaim,
  type SoleneAgentClaimRole,
} from "@shared/schema/solene-agent-claims";
import { logger } from "../../utils/logger";

// ============================================
// Types
// ============================================

export interface ClaimSurfacesOpts {
  dispatchId?: number | null;
  agentRole: SoleneAgentClaimRole;
  patterns: string[];
  ttlMinutes?: number;
  note?: string;
}

export interface ConflictResult {
  claimId: number;
  dispatchId: number | null;
  agentRole: string;
  claimedAt: Date;
  matchingPatterns: string[]; // patterns from the existing claim that conflict
  overlappingProposed: string[]; // patterns from the proposed set that triggered the match
}

// ============================================
// claimSurfaces
// ============================================

export async function claimSurfaces(opts: ClaimSurfacesOpts): Promise<number> {
  validateAgentRole(opts.agentRole);
  validatePatterns(opts.patterns);
  const ttlMinutes = opts.ttlMinutes ?? DEFAULT_CLAIM_TTL_MINUTES;
  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) {
    throw new Error(
      `claimSurfaces: invalid ttlMinutes=${ttlMinutes} (must be > 0)`,
    );
  }
  if (ttlMinutes > MAX_CLAIM_TTL_MINUTES) {
    throw new Error(
      `claimSurfaces: ttlMinutes=${ttlMinutes} exceeds ceiling ${MAX_CLAIM_TTL_MINUTES}`,
    );
  }

  const [inserted] = await db
    .insert(soleneAgentClaims)
    .values({
      dispatchId: opts.dispatchId ?? null,
      agentRole: opts.agentRole,
      ttlMinutes,
      fileSurfacePatterns: opts.patterns,
      claimStatus: "active",
      note: opts.note ?? null,
    })
    .returning({ id: soleneAgentClaims.id });

  if (!inserted) {
    throw new Error("claimSurfaces: insert returned no id");
  }

  logger.info("[agentClaims] claimed surfaces", {
    claimId: inserted.id,
    agentRole: opts.agentRole,
    dispatchId: opts.dispatchId ?? null,
    patternCount: opts.patterns.length,
    ttlMinutes,
  });

  return inserted.id;
}

// ============================================
// releaseClaim
// ============================================

export async function releaseClaim(claimId: number): Promise<void> {
  const now = new Date();
  const updated = await db
    .update(soleneAgentClaims)
    .set({ releasedAt: now, claimStatus: "released" })
    .where(
      and(
        eq(soleneAgentClaims.id, claimId),
        eq(soleneAgentClaims.claimStatus, "active"),
      ),
    )
    .returning({ id: soleneAgentClaims.id });

  if (updated.length === 0) {
    // Idempotent: silent no-op when already released/expired/missing.
    logger.debug("[agentClaims] releaseClaim no-op (already non-active)", {
      claimId,
    });
    return;
  }

  logger.info("[agentClaims] released claim", { claimId });
}

// ============================================
// expireStaleClaims
// ============================================

export async function expireStaleClaims(): Promise<number> {
  // Postgres: WHERE claim_status='active' AND claimed_at + (ttl_minutes||'minutes')::interval < now()
  // Drizzle doesn't ergonomically express interval arithmetic, so use a
  // raw SQL fragment for the predicate.
  const result = await db
    .update(soleneAgentClaims)
    .set({ claimStatus: "expired", releasedAt: new Date() })
    .where(
      sql`${soleneAgentClaims.claimStatus} = 'active' AND (${soleneAgentClaims.claimedAt} + (${soleneAgentClaims.ttlMinutes} || ' minutes')::interval) < now()`,
    )
    .returning({ id: soleneAgentClaims.id });

  if (result.length > 0) {
    logger.info("[agentClaims] expired stale claims", { count: result.length });
  }
  return result.length;
}

// ============================================
// findConflictingClaims
// ============================================

export async function findConflictingClaims(
  patterns: string[],
  opts: { excludeClaimId?: number } = {},
): Promise<ConflictResult[]> {
  if (!patterns || patterns.length === 0) return [];

  const active = await db
    .select()
    .from(soleneAgentClaims)
    .where(
      opts.excludeClaimId !== undefined
        ? and(
            eq(soleneAgentClaims.claimStatus, "active"),
            ne(soleneAgentClaims.id, opts.excludeClaimId),
          )
        : eq(soleneAgentClaims.claimStatus, "active"),
    );

  const conflicts: ConflictResult[] = [];
  for (const claim of active) {
    const existing = claim.fileSurfacePatterns ?? [];
    if (existing.length === 0) continue;
    const overlap = computePatternOverlap(patterns, existing);
    if (overlap.matchingExisting.length > 0) {
      conflicts.push({
        claimId: claim.id,
        dispatchId: claim.dispatchId,
        agentRole: claim.agentRole,
        claimedAt: claim.claimedAt,
        matchingPatterns: overlap.matchingExisting,
        overlappingProposed: overlap.matchingProposed,
      });
    }
  }
  return conflicts;
}

// ============================================
// predictDispatchConflicts — alias for dispatch-prep code.
// ============================================

export const predictDispatchConflicts = findConflictingClaims;

// ============================================
// isFileUnderClaim — used by pre-commit hook helper.
// ============================================

export async function isFileUnderClaim(
  filePath: string,
  opts: { excludeClaimId?: number } = {},
): Promise<ConflictResult | null> {
  if (!filePath) return null;

  const active = await db
    .select()
    .from(soleneAgentClaims)
    .where(
      opts.excludeClaimId !== undefined
        ? and(
            eq(soleneAgentClaims.claimStatus, "active"),
            ne(soleneAgentClaims.id, opts.excludeClaimId),
          )
        : eq(soleneAgentClaims.claimStatus, "active"),
    );

  for (const claim of active) {
    const existing = claim.fileSurfacePatterns ?? [];
    for (const pattern of existing) {
      if (matchesGlob(filePath, pattern)) {
        return {
          claimId: claim.id,
          dispatchId: claim.dispatchId,
          agentRole: claim.agentRole,
          claimedAt: claim.claimedAt,
          matchingPatterns: [pattern],
          overlappingProposed: [filePath],
        };
      }
    }
  }
  return null;
}

// ============================================
// listActiveClaims — founder visibility.
// ============================================

export async function listActiveClaims(): Promise<SoleneAgentClaim[]> {
  return db
    .select()
    .from(soleneAgentClaims)
    .where(eq(soleneAgentClaims.claimStatus, "active"));
}

// ============================================================================
// Internal helpers
// ============================================================================

function validateAgentRole(role: string): void {
  if (!(CLAIM_AGENT_ROLES as readonly string[]).includes(role)) {
    throw new Error(
      `agentClaims: unknown agentRole=${role} (expected one of ${CLAIM_AGENT_ROLES.join("|")})`,
    );
  }
}

function validatePatterns(patterns: string[]): void {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error("agentClaims: patterns must be a non-empty array");
  }
  for (const p of patterns) {
    if (typeof p !== "string" || p.trim().length === 0) {
      throw new Error(
        `agentClaims: every pattern must be a non-empty string; got ${JSON.stringify(p)}`,
      );
    }
    // Reject absolute paths + parent-dir escapes — claims are repo-relative.
    if (p.startsWith("/") || p.includes("..")) {
      throw new Error(
        `agentClaims: pattern must be repo-relative, no leading / or ..; got ${p}`,
      );
    }
  }
}

/**
 * minimatch wrapper with the dotfile flag enabled so `.githooks/*` matches.
 */
export function matchesGlob(filePath: string, pattern: string): boolean {
  try {
    return minimatch(filePath, pattern, { dot: true, matchBase: false });
  } catch {
    return false;
  }
}

/**
 * Compute the overlap between two pattern sets. Returns the existing-set
 * patterns that match anything in the proposed set + the proposed-set
 * patterns that triggered the match.
 *
 * Strategy (described in the file header):
 *   1. For every proposed pattern, generate sample paths from its
 *      literal-prefix and minimatch them against every existing pattern.
 *   2. For every (proposed, existing) pair, also check literal-prefix
 *      subset — covers cases where neither pattern has any glob char.
 */
export function computePatternOverlap(
  proposed: string[],
  existing: string[],
): { matchingProposed: string[]; matchingExisting: string[] } {
  const matchingProposed = new Set<string>();
  const matchingExisting = new Set<string>();

  for (const p of proposed) {
    const samples = samplePathsForPattern(p);
    for (const e of existing) {
      // 1. Sample-based match
      let matched = false;
      for (const sample of samples) {
        if (matchesGlob(sample, e)) {
          matched = true;
          break;
        }
      }
      // 2. Reverse direction — existing samples vs proposed pattern.
      if (!matched) {
        const eSamples = samplePathsForPattern(e);
        for (const sample of eSamples) {
          if (matchesGlob(sample, p)) {
            matched = true;
            break;
          }
        }
      }
      // 3. Literal-prefix subset fast path.
      if (!matched && sharesLiteralPrefix(p, e)) {
        matched = true;
      }
      if (matched) {
        matchingProposed.add(p);
        matchingExisting.add(e);
      }
    }
  }

  return {
    matchingProposed: Array.from(matchingProposed),
    matchingExisting: Array.from(matchingExisting),
  };
}

/**
 * Extract the literal-prefix part of a glob (everything before the first
 * `*`, `?`, `[`, or `{`) and synthesize a small sample of candidate paths.
 *
 * Examples:
 *   server/services/iris/*       → ["server/services/iris/", "server/services/iris/x.ts"]
 *   shared/schema/iris-*.ts      → ["shared/schema/iris-", "shared/schema/iris-x.ts"]
 *   tests/e2e/**\/auth.spec.ts   → ["tests/e2e/", "tests/e2e/x/auth.spec.ts"]
 *   docs/notes.md                → ["docs/notes.md"]
 */
function samplePathsForPattern(pattern: string): string[] {
  const literalEnd = firstGlobCharIndex(pattern);
  if (literalEnd === -1) {
    // No glob chars — the pattern is literal.
    return [pattern];
  }
  const literal = pattern.slice(0, literalEnd);
  const tail = pattern.slice(literalEnd);
  const samples = new Set<string>();
  samples.add(literal);
  // Heuristic fillers — try common extensions + a directory-style sample.
  samples.add(literal + "x.ts");
  samples.add(literal + "x.tsx");
  samples.add(literal + "x");
  samples.add(literal + "x/y.ts");
  // Also try replacing `**` → "x" and `*` → "x" naively for a single
  // concrete sample that the original pattern can match against itself
  // (helpful when both patterns have the same shape).
  const concrete = pattern
    .replace(/\*\*/g, "x")
    .replace(/\*/g, "x")
    .replace(/\?/g, "x")
    .replace(/\[[^\]]*\]/g, "x")
    .replace(/\{[^}]*\}/g, "x");
  samples.add(concrete);
  void tail;
  return Array.from(samples);
}

function firstGlobCharIndex(pattern: string): number {
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" || c === "?" || c === "[" || c === "{") return i;
  }
  return -1;
}

/**
 * Two patterns share a "literal prefix" iff the literal-prefix of one is
 * a prefix of the literal-prefix of the other (and both end at a path
 * boundary or run to the end of the literal).
 */
function sharesLiteralPrefix(a: string, b: string): boolean {
  const aEnd = firstGlobCharIndex(a);
  const bEnd = firstGlobCharIndex(b);
  const aLit = aEnd === -1 ? a : a.slice(0, aEnd);
  const bLit = bEnd === -1 ? b : b.slice(0, bEnd);
  if (aLit.length === 0 || bLit.length === 0) return false;
  const shorter = aLit.length <= bLit.length ? aLit : bLit;
  const longer = aLit.length <= bLit.length ? bLit : aLit;
  if (!longer.startsWith(shorter)) return false;
  // Must end at a path boundary OR the longer must equal the shorter.
  if (longer.length === shorter.length) return true;
  const nextChar = longer[shorter.length];
  return nextChar === "/" || shorter.endsWith("/");
}

// Drizzle import touched to keep tree-shaker happy in case lte/gte
// are needed by downstream callers.
void lte;
void gte;
