/**
 * recourseDrafter — RAFE (the Recourse Loop)
 * ==========================================
 *
 * Every NEGATIVE customer signal becomes a DRAFTED, personal, same-hour human
 * reply. This service is the two halves of the loop's brain:
 *
 *   1. aggregateRecourseSignals() — read the inbound negative signals
 *      (detractor NPS alerts from system_alerts, low support ratings ≤2/5 from
 *      support_cases, cancellations from cancellation_surveys), de-dupe them
 *      into the recourse_drafts ledger, each row carrying the customer's
 *      VERBATIM words + their org + recent account context.
 *
 *   2. generateDraftReply() — seed a personal draft per signal from the
 *      verbatim + context using a CHEAP model, routed through the existing
 *      OpenRouter wrapper (aiRouter.routeAITask). Never a template; always the
 *      customer's situation, in the AcreOS voice (plainspoken, owns the
 *      failure, a concrete "here's the fix" line).
 *
 * Model: the cheap drafter is Claude Haiku 4.5 (MODEL_MODERATE in aiRouter).
 * We DO NOT instantiate a new SDK client — every model call goes through the
 * existing aiRouter wrapper, which handles OpenRouter transport, cost
 * accounting, and circuit breaking.
 *
 * Best-effort by construction: a model failure leaves a row with a null
 * draft_body (the founder can still write the reply by hand or regenerate);
 * an aggregation failure on one signal never blocks the others.
 */

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  systemAlerts,
  supportCases,
  cancellationSurveys,
  recourseDrafts,
  type RecourseSignalType,
} from "@shared/schema";
import { users } from "@shared/models/auth";
import { routeAITask, MODEL_MODERATE, TaskComplexity } from "./aiRouter";
import { logger } from "../utils/logger";

// How far back the sweep looks for fresh negative signals. The detractor-alert
// + cancellation flows already page the founder in real time; this is the
// closing-the-loop layer, so a generous window is fine — re-running is a no-op
// thanks to the (signal_ref_type, signal_ref_id) dedupe unique index.
const LOOKBACK_DAYS = 30;

export interface RecourseSignal {
  signalType: RecourseSignalType;
  signalRefType: string;
  signalRefId: number;
  organizationId: number;
  /** The customer's actual words — the seed of the draft. */
  customerVerbatim: string | null;
}

// ---------------------------------------------------------------------------
// 1. Aggregate the inbound negative signals.
// ---------------------------------------------------------------------------

/**
 * Read the three negative-signal sources and return a normalized list. Pure
 * read — no writes. Exported for testing the aggregation independently of the
 * upsert/draft side effects.
 */
export async function collectRecourseSignals(
  sinceDays: number = LOOKBACK_DAYS,
): Promise<RecourseSignal[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const signals: RecourseSignal[] = [];

  // --- Detractor NPS — system_alerts rows minted by notifyFounderOfDetractor.
  // The verbatim comment is on metadata.comment; org is organizationId.
  try {
    const detractorAlerts = await db
      .select({
        id: systemAlerts.id,
        organizationId: systemAlerts.organizationId,
        metadata: systemAlerts.metadata,
        message: systemAlerts.message,
      })
      .from(systemAlerts)
      .where(
        and(
          eq(systemAlerts.type, "nps_detractor"),
          gte(systemAlerts.createdAt, since),
        ),
      )
      .orderBy(desc(systemAlerts.createdAt))
      .limit(200);

    for (const a of detractorAlerts) {
      if (a.organizationId == null) continue;
      const comment =
        (a.metadata && typeof a.metadata.comment === "string"
          ? a.metadata.comment
          : null) ?? null;
      const score =
        a.metadata && typeof a.metadata.score === "number"
          ? a.metadata.score
          : null;
      const verbatim =
        comment ??
        (score != null
          ? `Scored us ${score}/10 with no written comment.`
          : null);
      signals.push({
        signalType: "detractor_nps",
        signalRefType: "system_alert",
        signalRefId: a.id,
        organizationId: a.organizationId,
        customerVerbatim: verbatim,
      });
    }
  } catch (err) {
    logger.warn("[recourse] failed to read detractor alerts", {
      metadata: { error: (err as Error).message },
    });
  }

  // --- Low support ratings — support_cases with userSatisfaction ≤2 (out of 5).
  try {
    const lowRated = await db
      .select({
        id: supportCases.id,
        organizationId: supportCases.organizationId,
        subject: supportCases.subject,
        rating: supportCases.userSatisfaction,
        resolutionSummary: supportCases.resolutionSummary,
      })
      .from(supportCases)
      .where(
        and(
          inArray(supportCases.userSatisfaction, [1, 2]),
          gte(supportCases.updatedAt, since),
        ),
      )
      .orderBy(desc(supportCases.updatedAt))
      .limit(200);

    for (const c of lowRated) {
      const verbatim = `Rated their support experience ${c.rating}/5 on case "${c.subject}".${
        c.resolutionSummary ? ` We had said: ${c.resolutionSummary}` : ""
      }`;
      signals.push({
        signalType: "low_support_rating",
        signalRefType: "support_case",
        signalRefId: c.id,
        organizationId: c.organizationId,
        customerVerbatim: verbatim,
      });
    }
  } catch (err) {
    logger.warn("[recourse] failed to read low support ratings", {
      metadata: { error: (err as Error).message },
    });
  }

  // --- Cancellations — cancellation_surveys. A row that ACCEPTED a pause is a
  // save (no actual cancellation), so exclude those — we only close the loop
  // on a real churn.
  try {
    const cancels = await db
      .select({
        id: cancellationSurveys.id,
        organizationId: cancellationSurveys.organizationId,
        reason: cancellationSurveys.reason,
        feedback: cancellationSurveys.feedback,
        previousTier: cancellationSurveys.previousTier,
        acceptedPause: cancellationSurveys.acceptedPause,
      })
      .from(cancellationSurveys)
      .where(gte(cancellationSurveys.createdAt, since))
      .orderBy(desc(cancellationSurveys.createdAt))
      .limit(200);

    for (const s of cancels) {
      if (s.acceptedPause) continue; // a save, not a churn — skip.
      const verbatim = `Cancelled (${s.previousTier ?? "unknown"} plan). Stated reason: ${s.reason}.${
        s.feedback ? ` In their words: "${s.feedback}"` : ""
      }`;
      signals.push({
        signalType: "cancellation",
        signalRefType: "cancellation_survey",
        signalRefId: s.id,
        organizationId: s.organizationId,
        customerVerbatim: verbatim,
      });
    }
  } catch (err) {
    logger.warn("[recourse] failed to read cancellations", {
      metadata: { error: (err as Error).message },
    });
  }

  return signals;
}

interface OrgContext {
  orgName: string | null;
  ownerEmail: string | null;
  ownerFirstName: string | null;
  ownerUserId: string | null;
  recentCaseSubjects: string[];
}

/** Pull the account context that personalizes the draft + addresses the reply. */
async function loadOrgContext(organizationId: number): Promise<OrgContext> {
  const [org] = await db
    .select({ name: organizations.name, ownerId: organizations.ownerId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  let ownerEmail: string | null = null;
  let ownerFirstName: string | null = null;
  const ownerUserId = org?.ownerId ?? null;
  if (ownerUserId) {
    const [owner] = await db
      .select({ email: users.email, firstName: users.firstName })
      .from(users)
      .where(eq(users.id, ownerUserId))
      .limit(1);
    ownerEmail = owner?.email ?? null;
    ownerFirstName = owner?.firstName ?? null;
  }

  let recentCaseSubjects: string[] = [];
  try {
    const cases = await db
      .select({ subject: supportCases.subject })
      .from(supportCases)
      .where(eq(supportCases.organizationId, organizationId))
      .orderBy(desc(supportCases.createdAt))
      .limit(3);
    recentCaseSubjects = cases.map((c) => c.subject).filter(Boolean);
  } catch {
    recentCaseSubjects = [];
  }

  return {
    orgName: org?.name ?? null,
    ownerEmail,
    ownerFirstName,
    ownerUserId,
    recentCaseSubjects,
  };
}

/**
 * Aggregate the negative signals into the recourse_drafts ledger. De-dupes via
 * the (signal_ref_type, signal_ref_id) unique index — re-running is safe and
 * never double-drafts. Returns the count of newly-inserted rows.
 *
 * Does NOT generate the draft body here (that's a model call) — it persists
 * the row with verbatim + context so the surface can show the queue instantly,
 * then `generateDraftReply` fills the body. This keeps aggregation fast + the
 * model spend lazy (drafts generated on demand / by a follow-up sweep).
 */
export async function aggregateRecourseSignals(
  sinceDays: number = LOOKBACK_DAYS,
): Promise<{ inserted: number; scanned: number }> {
  const signals = await collectRecourseSignals(sinceDays);
  let inserted = 0;

  // Cache org context per org so a burst of signals from one org is one lookup.
  const ctxCache = new Map<number, OrgContext>();

  for (const sig of signals) {
    try {
      let ctx = ctxCache.get(sig.organizationId);
      if (!ctx) {
        ctx = await loadOrgContext(sig.organizationId);
        ctxCache.set(sig.organizationId, ctx);
      }

      const contextSummary = [
        ctx.orgName ? `Org: ${ctx.orgName}.` : null,
        ctx.recentCaseSubjects.length
          ? `Recent support topics: ${ctx.recentCaseSubjects.join("; ")}.`
          : null,
      ]
        .filter(Boolean)
        .join(" ");

      const result = await db
        .insert(recourseDrafts)
        .values({
          organizationId: sig.organizationId,
          signalType: sig.signalType,
          signalRefType: sig.signalRefType,
          signalRefId: sig.signalRefId,
          recipientUserId: ctx.ownerUserId,
          recipientEmail: ctx.ownerEmail,
          customerVerbatim: sig.customerVerbatim,
          contextSummary: contextSummary || null,
          status: "draft",
        })
        .onConflictDoNothing({
          target: [recourseDrafts.signalRefType, recourseDrafts.signalRefId],
        })
        .returning({ id: recourseDrafts.id });

      if (result.length > 0) inserted += 1;
    } catch (err) {
      logger.warn("[recourse] failed to persist a recourse signal", {
        metadata: {
          signalRefType: sig.signalRefType,
          signalRefId: sig.signalRefId,
          error: (err as Error).message,
        },
      });
    }
  }

  logger.info("[recourse] aggregation sweep complete", {
    metadata: { scanned: signals.length, inserted },
  });
  return { inserted, scanned: signals.length };
}

// ---------------------------------------------------------------------------
// 2. Draft a personal reply for one signal.
// ---------------------------------------------------------------------------

const DRAFT_SYSTEM_PROMPT = `You are drafting a SHORT, personal email reply on behalf of the founder of AcreOS — software built for Land Investors — to a customer who just gave us a NEGATIVE signal (a low score, a bad support experience, or a cancellation).

Write in the AcreOS voice: plainspoken, warm, direct, and honest. You OWN the failure — no corporate hedging, no "we apologize for any inconvenience." Name the customer's actual situation in their own words. Include exactly one concrete "here's what I'm doing about it" line — a specific next step, not a vague promise. Never sound like a template.

Rules:
- 60–110 words. One short paragraph, maybe two.
- Open by acknowledging what THEY specifically said or did.
- No emojis. No marketing. No upsell. No links unless one is genuinely the fix.
- Sign off as the founder, first-person ("I"), e.g. "— Tom, AcreOS".
- If they cancelled, make it clear leaving was easy and the door stays open — never guilt them.
- Output ONLY the email body. No subject line, no preamble, no notes.`;

export function buildDraftUserPrompt(
  signalType: RecourseSignalType,
  customerVerbatim: string | null,
  contextSummary: string | null,
  recipientFirstName: string | null,
): string {
  const signalLabel =
    signalType === "detractor_nps"
      ? "Detractor NPS score (≤6 out of 10)"
      : signalType === "low_support_rating"
        ? "Low support-experience rating (≤2 out of 5)"
        : "Cancellation";
  return [
    `Signal: ${signalLabel}.`,
    recipientFirstName ? `Customer first name: ${recipientFirstName}.` : null,
    contextSummary ? `Account context: ${contextSummary}` : null,
    `The customer's signal, verbatim: ${
      customerVerbatim ?? "(no written comment was left)"
    }`,
    `Write the founder's personal reply now.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Generate (or regenerate) the draft body for a single recourse_drafts row.
 * Routes through the existing OpenRouter wrapper with the cheap model pinned.
 * Persists draft_body + draft_model on success. Best-effort: on model failure
 * it logs and leaves draft_body null (the founder can write by hand / retry).
 *
 * Returns the generated body, or null on failure.
 */
export async function generateDraftReply(draftId: number): Promise<string | null> {
  const [row] = await db
    .select()
    .from(recourseDrafts)
    .where(eq(recourseDrafts.id, draftId))
    .limit(1);

  if (!row) {
    logger.warn("[recourse] generateDraftReply: draft not found", {
      metadata: { draftId },
    });
    return null;
  }
  // Only draft for open rows — never overwrite a sent reply.
  if (row.status !== "draft") {
    return row.draftBody ?? null;
  }

  let recipientFirstName: string | null = null;
  if (row.recipientUserId) {
    try {
      const [u] = await db
        .select({ firstName: users.firstName })
        .from(users)
        .where(eq(users.id, row.recipientUserId))
        .limit(1);
      recipientFirstName = u?.firstName ?? null;
    } catch {
      recipientFirstName = null;
    }
  }

  const userPrompt = buildDraftUserPrompt(
    row.signalType as RecourseSignalType,
    row.customerVerbatim,
    row.contextSummary,
    recipientFirstName,
  );

  try {
    const resp = await routeAITask(
      {
        taskType: "draft_email",
        complexity: TaskComplexity.SIMPLE,
        messages: [
          { role: "system", content: DRAFT_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      },
      {
        // Cheap model per the claude-api skill (Haiku 4.5), pinned through the
        // existing OpenRouter wrapper — no new SDK client.
        forceModel: MODEL_MODERATE,
        // Founder-internal best-effort; never silently refuse on budget.
        skipBudget: true,
        skipQuota: true,
      },
    );

    const body = resp.content?.trim();
    if (!body) {
      logger.warn("[recourse] drafter returned empty body", {
        metadata: { draftId },
      });
      return null;
    }

    await db
      .update(recourseDrafts)
      .set({ draftBody: body, draftModel: resp.model, updatedAt: new Date() })
      .where(
        and(eq(recourseDrafts.id, draftId), eq(recourseDrafts.status, "draft")),
      );

    return body;
  } catch (err) {
    logger.warn("[recourse] draft generation failed", {
      metadata: { draftId, error: (err as Error).message },
    });
    return null;
  }
}

/**
 * Convenience for the sweep: aggregate signals, then generate drafts for any
 * open rows that don't yet have a body. Bounded so one tick never fans out an
 * unbounded number of model calls.
 */
export async function aggregateAndDraft(
  opts: { maxDrafts?: number; sinceDays?: number } = {},
): Promise<{ inserted: number; scanned: number; drafted: number }> {
  const { maxDrafts = 25, sinceDays = LOOKBACK_DAYS } = opts;
  const agg = await aggregateRecourseSignals(sinceDays);

  const pending = await db
    .select({ id: recourseDrafts.id })
    .from(recourseDrafts)
    .where(
      and(
        eq(recourseDrafts.status, "draft"),
        sql`${recourseDrafts.draftBody} IS NULL`,
      ),
    )
    .orderBy(desc(recourseDrafts.createdAt))
    .limit(maxDrafts);

  let drafted = 0;
  for (const p of pending) {
    const body = await generateDraftReply(p.id);
    if (body) drafted += 1;
  }

  return { ...agg, drafted };
}
