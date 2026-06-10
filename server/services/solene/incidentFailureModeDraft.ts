/**
 * Tier 2D — incident resolution → auto-drafted failure-mode entry (2026-06-10).
 *
 * Closes the loop between the incident ledger (Pillar D9, shared/schema.ts
 * `incidents`) and the failure-mode library (L3.12, solene_failure_modes):
 * when an incident is resolved (or its post-mortem completes) WITH
 * lessonsLearned filled in, those lessons automatically become a DRAFT
 * failure-mode row — so the institutional memory is captured at the moment
 * it exists, not whenever someone remembers to write a ledger entry.
 *
 * Draft, never auto-published — by construction:
 *   - The row is inserted with status='draft'.
 *   - The dispatch preamble (loadFailureModePreambleFor) reads ONLY the disk
 *     ledger at docs/internal/failure-modes/, so a DB draft can never reach
 *     an agent prompt.
 *   - Promotion = a human writes the reviewed entry to disk under the same
 *     slug; seedFailureModesFromDisk then flips the row to 'published'.
 *
 * Idempotent per incident: slug `incident-<uuid-prefix>` + a sourceIncidentId
 * lookup; re-saving the incident's post-mortem updates nothing (first draft
 * wins — the human edits the draft/disk entry from there).
 *
 * Fail-soft: drafting must never break the incident PATCH that triggered it.
 */

import { eq, or } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneFailureModes,
  type SoleneFailureModeSeverity,
  type SoleneFailureModeCategory,
} from "@shared/schema/solene-failure-modes";
import type { Incident } from "@shared/schema";
import { logger } from "../../utils/logger";

export interface IncidentDraftResult {
  drafted: boolean;
  /** Set when drafted=true OR when an existing row made the call a no-op. */
  slug: string | null;
  reason:
    | "drafted"
    | "no_lessons"
    | "status_not_final"
    | "already_drafted"
    | "error";
}

/** Statuses that mean the incident's learning is ready to capture. */
const DRAFTABLE_STATUSES = new Set(["resolved", "post_mortem_done"]);

const SEVERITY_MAP: Record<string, SoleneFailureModeSeverity> = {
  "SEV-1": "critical",
  "SEV-2": "high",
  "SEV-3": "medium",
  "SEV-4": "low",
};

/** incidents.rootCauseCategory → failure-mode category. */
function mapCategory(rootCauseCategory: string | null): SoleneFailureModeCategory {
  switch (rootCauseCategory) {
    case "code":
    case "db":
    case "dep":
    case "config":
    case "infra":
    case "auth":
      return "regression_class";
    default:
      return "other";
  }
}

export function incidentFailureModeSlug(incidentId: string): string {
  // uuid prefix keeps the slug short, stable, and collision-safe enough for
  // the unique index (full uuid is in sourceIncidentId + exampleIncidentRefs).
  return `incident-${incidentId.slice(0, 8)}`;
}

/**
 * Draft a failure-mode entry from a finalized incident's lessonsLearned.
 * Never throws — returns a structured result and logs on error.
 */
export async function draftFailureModeFromIncident(
  incident: Incident,
): Promise<IncidentDraftResult> {
  try {
    const lessons = (incident.lessonsLearned ?? "").trim();
    if (lessons.length === 0) {
      return { drafted: false, slug: null, reason: "no_lessons" };
    }
    if (!DRAFTABLE_STATUSES.has(incident.status)) {
      return { drafted: false, slug: null, reason: "status_not_final" };
    }

    const slug = incidentFailureModeSlug(incident.id);

    // Idempotency: skip when this incident already produced a row (slug OR
    // sourceIncidentId — sourceIncidentId also covers a human who renamed
    // the slug while promoting the draft to disk).
    const existing = await db
      .select({ id: soleneFailureModes.id, slug: soleneFailureModes.slug })
      .from(soleneFailureModes)
      .where(
        or(
          eq(soleneFailureModes.slug, slug),
          eq(soleneFailureModes.sourceIncidentId, incident.id),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return {
        drafted: false,
        slug: existing[0].slug,
        reason: "already_drafted",
      };
    }

    const descriptionParts = [
      `Auto-drafted from incident ${incident.id} (${incident.severity}: ${incident.title}).`,
      "",
      `**Summary**: ${incident.summary}`,
    ];
    if (incident.rootCauseSummary) {
      descriptionParts.push("", `**Root cause**: ${incident.rootCauseSummary}`);
    }
    descriptionParts.push("", `**Lessons learned**: ${lessons}`);

    await db.insert(soleneFailureModes).values({
      slug,
      title: incident.title,
      severity: SEVERITY_MAP[incident.severity] ?? "medium",
      category: mapCategory(incident.rootCauseCategory),
      description: descriptionParts.join("\n"),
      triggerPatterns: [],
      prevention: lessons,
      exampleIncidentRefs: [`incident:${incident.id}`],
      status: "draft",
      sourceIncidentId: incident.id,
    });

    logger.info("[incidentFailureModeDraft] drafted failure mode from incident", {
      metadata: {
        incidentId: incident.id,
        slug,
        severity: incident.severity,
        rootCauseCategory: incident.rootCauseCategory ?? null,
      },
    });
    return { drafted: true, slug, reason: "drafted" };
  } catch (err) {
    logger.error("[incidentFailureModeDraft] draft failed (non-fatal)", err, {
      metadata: { incidentId: incident.id },
    });
    return { drafted: false, slug: null, reason: "error" };
  }
}
