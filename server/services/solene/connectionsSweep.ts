/**
 * SOLENE — weekly connections sweep (Horizon A5).
 *
 * A READ-ONLY, once-a-week dispatch that looks for the connections a busy
 * machine forgets to make. Exactly three finding types:
 *
 *   1. CONTRADICTIONS — pending decisions/dispatches whose direction
 *      conflicts with a stored founder ruling (founder_precedent) or a
 *      doctrine doc (doctrine namespace).
 *   2. FORGOTTEN PRECEDENTS — recent founder-escalated cascade rows whose
 *      trigger near-matches an EXISTING precedent: evidence the retrieval
 *      threshold needs tuning (the machine asked a question it already had
 *      an answer to).
 *   3. STALE DOCTRINE — doctrine docs contradicting the machine's actual
 *      state (immutables version, autopilot switches, domain autonomy
 *      levels).
 *
 * NEVER AN INTERRUPT (2.2 taxonomy: silent-log tier). Findings are persisted
 * as a platform_settings blob ('connections_sweep.latest') and surfaced as
 * one paragraph in The Letter + at most one sentence in the morning pulse.
 * No inbox cards, no pages, no notifications — by construction: nothing in
 * this module or its completion hook touches those surfaces.
 *
 * STRUCTURALLY READ-ONLY. The dispatch rides sourceType='self_audit_drift',
 * which is in READ_ONLY_DISPATCH_SOURCE_TYPES: the worker strips every
 * mutating tool from its toolset and the executor rejects mutating calls
 * fail-closed (see shared/schema/solene-dispatch.ts + dispatchToolExecutor).
 *
 * HONESTY: no findings = 'FINDINGS: none' rendered as "no contradictions
 * found" — never padded. An unparseable FINDINGS block is recorded as
 * parseOk=false ("sweep completed, findings unparseable"), never silently
 * dropped and never counted as findings.
 */

import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import { logger } from "../../utils/logger";
import {
  soleneDispatchQueue,
  type DispatchSuccessCriteria,
} from "@shared/schema/solene-dispatch";
import {
  decisionsInboxItems,
  cascadeResolutions,
  platformSettings,
} from "@shared/schema";
import { enqueueDispatch } from "./dispatchQueue";

// ============================================================================
// Constants + types
// ============================================================================

export const CONNECTIONS_SWEEP_SOURCE_TYPE = "self_audit_drift" as const;

/** platform_settings key holding the latest sweep's findings blob. */
export const CONNECTIONS_SWEEP_SETTING_KEY = "connections_sweep.latest";

/** Trailing window for the forgotten-precedent scan (founder escalations). */
export const SWEEP_ESCALATION_WINDOW_DAYS = 14;

/** Max items quoted per brief section — anchors, not an exhaustive dump. */
const SWEEP_BRIEF_ITEM_CAP = 5;

/** Findings contract caps. */
export const SWEEP_MAX_FINDINGS = 5;
export const SWEEP_FINDING_SUMMARY_MAX_CHARS = 200;

export const SWEEP_FINDING_TYPES = [
  "contradiction",
  "forgotten_precedent",
  "stale_doctrine",
] as const;
export type SweepFindingType = (typeof SWEEP_FINDING_TYPES)[number];

export interface SweepFinding {
  type: SweepFindingType;
  /** ≤ 200 chars, evidence-cited. */
  summary: string;
  /** sourceRefs / row ids the finding cites. */
  refs: string[];
}

export interface ConnectionsSweepBlob {
  /** From the dispatch row's completedAt (codebase convention: the queue row
   *  carries the terminal timestamp; never Date.now at read time). */
  atIso: string;
  findings: SweepFinding[];
  dispatchId: number;
  /** false = sweep completed but the FINDINGS block was unparseable. */
  parseOk: boolean;
}

// ============================================================================
// ISO week — idempotency granularity (one sweep per ISO week).
// ============================================================================

/** ISO-8601 week key, e.g. '2026-W29'. Pure. */
export function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7; // Mon=1 … Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum); // Thursday of this ISO week
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

// ============================================================================
// buildSweepBrief — the READ-ONLY brief, pre-anchored with retrieval.
// ============================================================================

function clip(s: string | null | undefined, max: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max) + "…";
}

/**
 * Assemble the sweep brief. Every input read is fail-soft: an unreadable
 * source is NAMED as unreadable in the brief rather than silently omitted,
 * so the agent (and the audit trail) knows what it could not see.
 */
export async function buildSweepBrief(now: Date = new Date()): Promise<string> {
  const lines: string[] = [];
  lines.push(
    "You are the weekly CONNECTIONS SWEEP — a READ-ONLY audit dispatch. You",
    "observe and report; you never modify files, never commit, never create",
    "inbox cards or notifications. Your toolset is read-only by construction.",
    "",
    "Check EXACTLY three finding types. Cite evidence (sourceRefs / row ids)",
    "for every finding; no speculation — a hunch without evidence is not a",
    "finding. If a section below says a source was unreadable this run, you",
    "may note that as a coverage gap but NOT invent findings from it.",
    "",
  );

  // ── 1. CONTRADICTIONS ──────────────────────────────────────────────────
  lines.push(
    "## 1. CONTRADICTIONS",
    "Pending decisions or queued dispatches whose direction conflicts with a",
    "stored founder ruling (founder_precedent) or a doctrine doc (doctrine",
    "namespace). Compare the pending items below against the retrieved",
    "precedent/doctrine anchors; read the full docs with file_read where a",
    "sourceRef is a repo path.",
    "",
  );

  const pendingTexts: string[] = [];
  try {
    const pending = await db
      .select({
        id: decisionsInboxItems.id,
        itemType: decisionsInboxItems.itemType,
        recommendedActionLabel: decisionsInboxItems.recommendedActionLabel,
        sophieAnalysis: decisionsInboxItems.sophieAnalysis,
      })
      .from(decisionsInboxItems)
      .where(eq(decisionsInboxItems.status, "pending"))
      .orderBy(desc(decisionsInboxItems.id))
      .limit(SWEEP_BRIEF_ITEM_CAP);
    if (pending.length === 0) {
      lines.push("Pending decision-inbox items: none.");
    } else {
      lines.push("Pending decision-inbox items:");
      for (const p of pending) {
        lines.push(
          `- decisions_inbox_items:${p.id} [${p.itemType}] "${clip(p.recommendedActionLabel, 120)}" — ${clip(p.sophieAnalysis, 200)}`,
        );
        pendingTexts.push(`${p.recommendedActionLabel} ${p.sophieAnalysis}`);
      }
    }
  } catch (err) {
    lines.push("Pending decision-inbox items: (unreadable this run)");
    logger.warn("connectionsSweep.brief.pending_decisions_unreadable", {
      metadata: { err: err instanceof Error ? err.message : String(err) },
    });
  }

  try {
    const inFlight = await db
      .select({
        id: soleneDispatchQueue.id,
        sourceType: soleneDispatchQueue.sourceType,
        promptText: soleneDispatchQueue.promptText,
      })
      .from(soleneDispatchQueue)
      .where(inArray(soleneDispatchQueue.status, ["queued", "in_progress"]))
      .orderBy(desc(soleneDispatchQueue.queuedAt))
      .limit(SWEEP_BRIEF_ITEM_CAP);
    if (inFlight.length === 0) {
      lines.push("Queued / in-progress dispatches: none.");
    } else {
      lines.push("Queued / in-progress dispatches:");
      for (const d of inFlight) {
        lines.push(
          `- solene_dispatch_queue:${d.id} [${d.sourceType}] ${clip(d.promptText, 200)}`,
        );
        pendingTexts.push(d.promptText.slice(0, 400));
      }
    }
  } catch (err) {
    lines.push("Queued / in-progress dispatches: (unreadable this run)");
    logger.warn("connectionsSweep.brief.inflight_dispatches_unreadable", {
      metadata: { err: err instanceof Error ? err.message : String(err) },
    });
  }

  // Retrieval anchors — the top-similarity precedent + doctrine texts for
  // the pending items, so the agent starts anchored instead of cold.
  lines.push("", "Retrieved precedent/doctrine anchors (top similarity vs the pending items):");
  if (pendingTexts.length === 0) {
    lines.push("- (nothing pending to anchor against)");
  } else {
    try {
      const { retrieveCrossNamespaceMemories } = await import("./memoryRetrieval");
      const anchors = await retrieveCrossNamespaceMemories({
        queryText: pendingTexts.join("\n").slice(0, 4000),
        namespaces: ["founder_precedent", "doctrine"],
        topKPerNamespace: 3,
        globalTopK: 6,
        queryingAgentRole: "system",
      });
      if (anchors.retrieved.length === 0) {
        lines.push("- (no precedent/doctrine matches above the similarity floor)");
      } else {
        for (const a of anchors.retrieved) {
          lines.push(
            `- [${a.namespace}] ${a.sourceRef} (sim ${(a.similarityScore * 100).toFixed(1)}%): ${clip(a.contentSnippet, 200)}`,
          );
        }
      }
    } catch (err) {
      lines.push("- (retrieval unreadable this run)");
      logger.warn("connectionsSweep.brief.anchor_retrieval_failed", {
        metadata: { err: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  // ── 2. FORGOTTEN PRECEDENTS ────────────────────────────────────────────
  lines.push(
    "",
    "## 2. FORGOTTEN PRECEDENTS",
    `Founder-escalated cascade resolutions from the trailing ${SWEEP_ESCALATION_WINDOW_DAYS} days whose`,
    "trigger near-matches an EXISTING founder_precedent — evidence the",
    "retrieval threshold needs tuning (the machine escalated a question a",
    "stored ruling already answers). Compare the escalations below against",
    "the precedent anchors; a near-match IS the finding.",
    "",
  );
  const escalationTexts: string[] = [];
  try {
    const cutoff = new Date(now.getTime() - SWEEP_ESCALATION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const escalated = await db
      .select({
        id: cascadeResolutions.id,
        triggerType: cascadeResolutions.triggerType,
        founderResolution: cascadeResolutions.founderResolution,
        createdAt: cascadeResolutions.createdAt,
      })
      .from(cascadeResolutions)
      .where(
        and(
          eq(cascadeResolutions.founderEscalated, true),
          gte(cascadeResolutions.createdAt, cutoff),
        ),
      )
      .orderBy(desc(cascadeResolutions.createdAt))
      .limit(SWEEP_BRIEF_ITEM_CAP);
    if (escalated.length === 0) {
      lines.push("Recent founder escalations: none in the window.");
    } else {
      lines.push("Recent founder escalations:");
      for (const e of escalated) {
        lines.push(
          `- cascade_resolutions:${e.id} trigger=${e.triggerType} resolved="${clip(e.founderResolution, 150)}" at=${e.createdAt?.toISOString?.() ?? "?"}`,
        );
        escalationTexts.push(`${e.triggerType} ${e.founderResolution ?? ""}`);
      }
    }
  } catch (err) {
    lines.push("Recent founder escalations: (unreadable this run)");
    logger.warn("connectionsSweep.brief.escalations_unreadable", {
      metadata: { err: err instanceof Error ? err.message : String(err) },
    });
  }

  lines.push("", "Retrieved precedent anchors (top similarity vs the escalations):");
  if (escalationTexts.length === 0) {
    lines.push("- (no escalations to anchor against)");
  } else {
    try {
      const { retrieveCrossNamespaceMemories } = await import("./memoryRetrieval");
      const anchors = await retrieveCrossNamespaceMemories({
        queryText: escalationTexts.join("\n").slice(0, 4000),
        namespaces: ["founder_precedent"],
        topKPerNamespace: 5,
        globalTopK: 5,
        queryingAgentRole: "system",
      });
      if (anchors.retrieved.length === 0) {
        lines.push("- (no precedent matches above the similarity floor)");
      } else {
        for (const a of anchors.retrieved) {
          lines.push(
            `- [${a.namespace}] ${a.sourceRef} (sim ${(a.similarityScore * 100).toFixed(1)}%): ${clip(a.contentSnippet, 200)}`,
          );
        }
      }
    } catch (err) {
      lines.push("- (retrieval unreadable this run)");
      logger.warn("connectionsSweep.brief.precedent_retrieval_failed", {
        metadata: { err: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  // ── 3. STALE DOCTRINE ──────────────────────────────────────────────────
  lines.push(
    "",
    "## 3. STALE DOCTRINE",
    "Doctrine docs that contradict the machine's ACTUAL state below. Read the",
    "docs (file_read on docs/company, docs/internal, docs/adr,",
    "docs/architecture, docs/policies, docs/strategy, sovereign-protocol) and",
    "flag statements the current machine state falsifies.",
    "",
    "Current machine state:",
  );
  try {
    const { RAW_IMMUTABLES, CURRENT_PHASE } = await import("@sovereign/immutables");
    lines.push(
      `- sovereign-protocol/immutables.json version=${(RAW_IMMUTABLES as { version?: string }).version ?? "unknown"} phase=${CURRENT_PHASE}`,
    );
  } catch (err) {
    lines.push("- immutables: (unreadable this run)");
    logger.warn("connectionsSweep.brief.immutables_unreadable", {
      metadata: { err: err instanceof Error ? err.message : String(err) },
    });
  }
  try {
    const { getEffectiveSettings } = await import("../autopilot/settings");
    const eff = await getEffectiveSettings(now.getTime());
    lines.push(
      `- autopilot_settings: dispatchEnabled=${eff.dispatchEnabled} cognitionEnabled=${eff.cognitionEnabled}`,
    );
  } catch (err) {
    lines.push("- autopilot_settings: (unreadable this run)");
    logger.warn("connectionsSweep.brief.autopilot_settings_unreadable", {
      metadata: { err: err instanceof Error ? err.message : String(err) },
    });
  }
  try {
    const { getTrustLedger } = await import("../autopilot/domainAutonomy");
    const ledger = await getTrustLedger();
    if (ledger.length === 0) {
      lines.push("- domain_autonomy_levels: (no rows)");
    } else {
      lines.push(
        `- domain_autonomy_levels: ${ledger
          .map((l) => `${l.domain}=${l.level} (clean=${l.cleanCycleCount}/${l.threshold})`)
          .join("; ")}`,
      );
    }
  } catch (err) {
    lines.push("- domain_autonomy_levels: (unreadable this run)");
    logger.warn("connectionsSweep.brief.domain_levels_unreadable", {
      metadata: { err: err instanceof Error ? err.message : String(err) },
    });
  }

  // ── Output contract ────────────────────────────────────────────────────
  lines.push(
    "",
    "## OUTPUT CONTRACT",
    "End your FINAL message with a FINDINGS block — nothing after it:",
    "",
    "  FINDINGS: none",
    "",
    "when you found nothing (say so plainly — never pad), OR a JSON array of",
    `at most ${SWEEP_MAX_FINDINGS} findings, evidence-cited only:`,
    "",
    '  FINDINGS: [{"type": "contradiction" | "forgotten_precedent" | "stale_doctrine",',
    `              "summary": "<= ${SWEEP_FINDING_SUMMARY_MAX_CHARS} chars",`,
    '              "refs": ["<sourceRef or table:id>", "..."]}]',
    "",
    "Findings without evidence refs will be discarded. Do NOT create inbox",
    "cards, pages, or notifications — the FINDINGS block is your only output.",
  );

  return lines.join("\n");
}

// ============================================================================
// enqueueWeeklySweep
// ============================================================================

export interface EnqueueSweepResult {
  dispatchId: number | null;
  skipped: boolean;
  reason?: string;
}

/**
 * Enqueue this ISO week's sweep. Idempotent per ISO week via
 * idempotencyKey 'connections-sweep:<ISO week>' (a duplicate tick returns
 * the existing row's id — the dispatch queue's exactly-once machinery).
 * Never throws. Stands down when the dispatch switch is OFF, like every
 * other autonomous enqueue path.
 */
export async function enqueueWeeklySweep(now: Date = new Date()): Promise<EnqueueSweepResult> {
  try {
    const { isDispatchEnabled } = await import("../autopilot/settings");
    if (!(await isDispatchEnabled())) {
      logger.info("[connectionsSweep] skip — dispatch disabled");
      return { dispatchId: null, skipped: true, reason: "dispatch_disabled" };
    }

    const week = isoWeekKey(now);
    const key = `connections-sweep:${week}`;
    const promptText = await buildSweepBrief(now);

    const successCriteria: DispatchSuccessCriteria = {
      criteria: [
        {
          id: `${key}:findings-contract`,
          description:
            "Final message ends with a FINDINGS block: 'FINDINGS: none' or a JSON array " +
            `of at most ${SWEEP_MAX_FINDINGS} evidence-cited findings ` +
            "[{type: contradiction|forgotten_precedent|stale_doctrine, " +
            `summary (<=${SWEEP_FINDING_SUMMARY_MAX_CHARS} chars), refs: [sourceRefs/ids]}]. ` +
            "No findings = say none, never pad. Read-only: no files written, no commits, " +
            "no inbox cards, no notifications.",
        },
      ],
    };

    const dispatchId = await enqueueDispatch({
      sourceType: CONNECTIONS_SWEEP_SOURCE_TYPE,
      sourceId: key,
      agentRole: "general-purpose",
      promptText,
      // maxCostUsd omitted → DISPATCH_DEFAULT_COST_USD.
      idempotencyKey: key,
      enqueuedBy: "connectionsSweep:weekly",
      successCriteria,
    });
    logger.info(`[connectionsSweep] enqueued week=${week} dispatchId=${dispatchId}`);
    return { dispatchId, skipped: false };
  } catch (err) {
    logger.warn("[connectionsSweep] enqueue failed", err instanceof Error ? err : undefined);
    return {
      dispatchId: null,
      skipped: true,
      reason: `enqueue_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ============================================================================
// parseSweepFindings — tolerant parse of the FINDINGS block.
// ============================================================================

/**
 * Parse the FINDINGS block from a completed sweep's result text. Mirrors
 * parseReviewVerdict's stance: the LAST occurrence wins (the model may quote
 * the contract earlier in its transcript). Returns:
 *   - []              for 'FINDINGS: none'
 *   - SweepFinding[]  for a valid JSON array (invalid entries dropped,
 *                     capped at SWEEP_MAX_FINDINGS, summaries clipped)
 *   - null            when no FINDINGS block parses — recorded honestly as
 *                     'sweep completed, findings unparseable', never counted
 *                     as zero findings.
 * Pure; exported for tests.
 */
export function parseSweepFindings(text: string): SweepFinding[] | null {
  if (!text) return null;
  const matches = [...text.matchAll(/FINDINGS:/gi)];
  const last = matches[matches.length - 1];
  if (!last || last.index == null) return null;
  const tail = text.slice(last.index + last[0].length).trim();

  if (/^none\b/i.test(tail)) return [];

  const start = tail.indexOf("[");
  const end = tail.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(tail.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const typeSet = new Set<string>(SWEEP_FINDING_TYPES);
  const findings: SweepFinding[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const type = typeof e.type === "string" ? e.type.trim() : "";
    const summary = typeof e.summary === "string" ? e.summary.trim() : "";
    if (!typeSet.has(type) || summary.length === 0) continue;
    const refs = Array.isArray(e.refs)
      ? (e.refs as unknown[]).filter((r): r is string => typeof r === "string" && r.length > 0)
      : [];
    findings.push({
      type: type as SweepFindingType,
      summary: summary.slice(0, SWEEP_FINDING_SUMMARY_MAX_CHARS),
      refs,
    });
    if (findings.length >= SWEEP_MAX_FINDINGS) break;
  }
  // A non-empty array in which NOTHING validated is an unparseable block,
  // not an honest zero.
  if (findings.length === 0 && parsed.length > 0) return null;
  return findings;
}

// ============================================================================
// Blob persistence — platform_settings, silent-log tier. NO new tables.
// ============================================================================

/**
 * Upsert the blob at (scope='global', scope_ref IS NULL,
 * key='connections_sweep.latest'). Select-then-update-or-insert because the
 * unique index includes the nullable scope_ref (NULLs are distinct, so
 * ON CONFLICT can't serve this key) — same reasoning as founderPrecedent's
 * upsert.
 */
export async function persistSweepBlob(blob: ConnectionsSweepBlob): Promise<void> {
  const existing = await db
    .select({ id: platformSettings.id })
    .from(platformSettings)
    .where(
      and(
        eq(platformSettings.key, CONNECTIONS_SWEEP_SETTING_KEY),
        eq(platformSettings.scope, "global"),
        isNull(platformSettings.scopeRef),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(platformSettings)
      .set({
        value: blob,
        lastChangedBy: "connections-sweep",
        lastChangedAt: new Date(),
        lastChangedNote: `sweep dispatch #${blob.dispatchId} (parseOk=${blob.parseOk})`,
      })
      .where(eq(platformSettings.id, existing[0].id));
  } else {
    await db.insert(platformSettings).values({
      key: CONNECTIONS_SWEEP_SETTING_KEY,
      scope: "global",
      scopeRef: null,
      value: blob,
      // jsonb NOT NULL column; there is no meaningful default for a
      // machine-written blob, so an empty object marks "no sweep yet".
      defaultValue: {},
      validRange: null,
      category: "observability",
      description:
        "Latest weekly connections-sweep findings (Horizon A5). Machine-written " +
        "blob {atIso, findings, dispatchId, parseOk}; read by The Letter's " +
        "connections paragraph + the morning pulse. Silent-log tier — never an interrupt.",
      lastChangedBy: "connections-sweep",
      lastChangedAt: new Date(),
      lastChangedNote: `sweep dispatch #${blob.dispatchId} (parseOk=${blob.parseOk})`,
    });
  }
}

/** Read the latest sweep blob; null when no sweep has completed yet. */
export async function readLatestSweepBlob(): Promise<ConnectionsSweepBlob | null> {
  const [row] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(
      and(
        eq(platformSettings.key, CONNECTIONS_SWEEP_SETTING_KEY),
        eq(platformSettings.scope, "global"),
        isNull(platformSettings.scopeRef),
      ),
    )
    .limit(1);
  if (!row) return null;
  const v = row.value as Partial<ConnectionsSweepBlob> | null;
  if (!v || typeof v !== "object" || typeof v.atIso !== "string") return null;
  return {
    atIso: v.atIso,
    findings: Array.isArray(v.findings) ? (v.findings as SweepFinding[]) : [],
    dispatchId: typeof v.dispatchId === "number" ? v.dispatchId : -1,
    parseOk: v.parseOk === true,
  };
}

/**
 * Completion hook body — called (fire-and-forget) from
 * dispatchQueue.completeDispatch when a sourceType='self_audit_drift'
 * dispatch completes. Parses the FINDINGS block from the UNSLICED result
 * summary and persists the blob. atIso comes from the dispatch row's own
 * completedAt timestamp (the codebase convention — the queue row is the
 * source of truth for terminal timestamps), falling back to queuedAt only
 * when the row read degrades. Never throws.
 */
export async function handleSweepCompletion(
  dispatchId: number,
  resultSummary: string,
): Promise<void> {
  try {
    let atIso: string | null = null;
    try {
      const [row] = await db
        .select({
          completedAt: soleneDispatchQueue.completedAt,
          queuedAt: soleneDispatchQueue.queuedAt,
        })
        .from(soleneDispatchQueue)
        .where(eq(soleneDispatchQueue.id, dispatchId))
        .limit(1);
      const at = row?.completedAt ?? row?.queuedAt ?? null;
      atIso = at ? new Date(at).toISOString() : null;
    } catch {
      atIso = null;
    }

    const parsed = parseSweepFindings(resultSummary);
    const blob: ConnectionsSweepBlob = {
      atIso: atIso ?? new Date().toISOString(),
      findings: parsed ?? [],
      dispatchId,
      parseOk: parsed !== null,
    };
    await persistSweepBlob(blob);
    if (parsed === null) {
      logger.warn(
        `[connectionsSweep] dispatch id=${dispatchId} completed — sweep completed, findings unparseable (recorded as parseOk=false, never counted as zero findings)`,
      );
    } else {
      logger.info(
        `[connectionsSweep] dispatch id=${dispatchId} completed — ${parsed.length} finding(s) persisted to ${CONNECTIONS_SWEEP_SETTING_KEY}`,
      );
    }
  } catch (err) {
    logger.warn(
      `[connectionsSweep] completion handling failed for dispatch id=${dispatchId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
