/**
 * Agent Codename Alias Service — Phase 6 of the AcreOS-Solene migration.
 *
 * Resolves a codename (legacy OR canonical) to its canonical destination
 * before dispatch. Canonical inputs pass through unchanged; legacy inputs
 * are routed via the LEGACY_TO_CANONICAL_ALIAS map (with optional
 * action-aware overrides from LEGACY_ACTION_AWARE_ALIAS).
 *
 * This is the GitHub-style harmonious merge: legacy + modern both work,
 * legacy use is tracked, and natural file-touch migration retires the
 * legacy codenames over the next 60-90 days.
 *
 * Emits a one-time `info` log on first observation of a legacy codename
 * per-process (deduped via a Set); subsequent observations are debug-level.
 * The deprecation-watch surface is `getAliasUsageStats()`.
 */

import {
  CANONICAL_AGENT_CODENAMES,
  LEGACY_AGENT_CODENAMES,
  LEGACY_TO_CANONICAL_ALIAS,
  LEGACY_ACTION_AWARE_ALIAS,
  type CanonicalAgentCodename,
  type LegacyAgentCodename,
} from "@shared/schema/agent-codenames";
import { logger } from "../utils/logger";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ResolveCodenameInput {
  /** The codename the caller wants to dispatch to — may be canonical OR legacy. */
  requestedCodename: string;
  /** Optional action name — for action-aware overrides on forge etc. */
  actionName?: string;
}

export interface ResolveCodenameResult {
  canonical: CanonicalAgentCodename;
  wasAlias: boolean;
  legacyCodename?: LegacyAgentCodename;
  rationale: string;
}

// ─── Type Guards ────────────────────────────────────────────────────────────

const CANONICAL_SET: ReadonlySet<string> = new Set(CANONICAL_AGENT_CODENAMES);
const LEGACY_SET: ReadonlySet<string> = new Set(LEGACY_AGENT_CODENAMES);

export function isCanonicalCodename(s: string): s is CanonicalAgentCodename {
  return CANONICAL_SET.has(s);
}

export function isLegacyCodename(s: string): s is LegacyAgentCodename {
  return LEGACY_SET.has(s);
}

// ─── Stats / Deprecation Watch ──────────────────────────────────────────────

interface AliasUsageStats {
  totalResolutions: number;
  byLegacyCodename: Record<string, number>;
  byActionOverride: Record<string, number>;
  firstSeenAt: Date | null;
}

let stats: AliasUsageStats = {
  totalResolutions: 0,
  byLegacyCodename: {},
  byActionOverride: {},
  firstSeenAt: null,
};

const seenLegacyOnce = new Set<string>();

export function getAliasUsageStats(): AliasUsageStats {
  // Return a defensive copy so callers can't mutate the internal counters.
  return {
    totalResolutions: stats.totalResolutions,
    byLegacyCodename: { ...stats.byLegacyCodename },
    byActionOverride: { ...stats.byActionOverride },
    firstSeenAt: stats.firstSeenAt,
  };
}

export function resetAliasUsageStats(): void {
  stats = {
    totalResolutions: 0,
    byLegacyCodename: {},
    byActionOverride: {},
    firstSeenAt: null,
  };
  seenLegacyOnce.clear();
}

// ─── Core Resolver ──────────────────────────────────────────────────────────

/**
 * Resolve a codename (legacy or canonical) to its canonical form.
 *
 *  - Canonical input → return as-is, wasAlias=false.
 *  - Legacy input:
 *      - LEGACY_ACTION_AWARE_ALIAS override (if action provided + matches) →
 *        canonical override, wasAlias=true, rationale='action_override'.
 *      - Otherwise LEGACY_TO_CANONICAL_ALIAS default → wasAlias=true,
 *        rationale='default_alias'.
 *  - Unknown input → warn + fallback to 'iris' (most-general competent
 *    default), wasAlias=true, rationale='unknown_codename_fallback'.
 *
 * Increments deprecation-watch counters on every legacy resolution.
 */
export function resolveCodename(
  input: ResolveCodenameInput,
): ResolveCodenameResult {
  const { requestedCodename, actionName } = input;

  // Canonical pass-through — the common case for new code.
  if (isCanonicalCodename(requestedCodename)) {
    return {
      canonical: requestedCodename,
      wasAlias: false,
      rationale: "canonical_passthrough",
    };
  }

  // Legacy resolution path.
  if (isLegacyCodename(requestedCodename)) {
    const actionOverride =
      actionName !== undefined
        ? LEGACY_ACTION_AWARE_ALIAS[requestedCodename]?.[actionName]
        : undefined;

    const canonical: CanonicalAgentCodename =
      actionOverride ?? LEGACY_TO_CANONICAL_ALIAS[requestedCodename];

    const rationale = actionOverride ? "action_override" : "default_alias";

    // Update stats.
    stats.totalResolutions += 1;
    stats.byLegacyCodename[requestedCodename] =
      (stats.byLegacyCodename[requestedCodename] ?? 0) + 1;
    if (actionOverride && actionName !== undefined) {
      const key = `${requestedCodename}:${actionName}`;
      stats.byActionOverride[key] = (stats.byActionOverride[key] ?? 0) + 1;
    }
    if (stats.firstSeenAt === null) {
      stats.firstSeenAt = new Date();
    }

    // First-seen-per-process info log; thereafter debug.
    const dedupeKey = `${requestedCodename}:${actionName ?? ""}`;
    if (!seenLegacyOnce.has(dedupeKey)) {
      seenLegacyOnce.add(dedupeKey);
      logger.info("[agentCodenameAlias] legacy codename resolved", {
        legacy: requestedCodename,
        action: actionName,
        canonical,
        rationale,
      });
    } else {
      logger.debug("[agentCodenameAlias] legacy codename resolved (repeat)", {
        legacy: requestedCodename,
        action: actionName,
        canonical,
        rationale,
      });
    }

    return {
      canonical,
      wasAlias: true,
      legacyCodename: requestedCodename,
      rationale,
    };
  }

  // Unknown codename — warn + iris fallback.
  logger.warn("[agentCodenameAlias] unknown codename, falling back to iris", {
    requested: requestedCodename,
    action: actionName,
  });
  return {
    canonical: "iris",
    wasAlias: true,
    rationale: "unknown_codename_fallback",
  };
}
