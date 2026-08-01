/**
 * T193 — Skip Tracing Routes
 *
 * POST /api/skip-tracing/trace/:leadId — trace a single lead, persist the
 *      trace record, and write found contacts back onto the lead
 * POST /api/skip-tracing/batch         — trace the next page of genuinely
 *      UNTRACED leads (leads with no finished skip_traces row)
 * GET  /api/skip-tracing/stats         — stats derived from real trace rows
 *
 * Honesty contract (Wave A "Nothing lies"):
 * - Stats report only what the server can truthfully derive from the
 *   `skip_traces` table + the org's leads. No invented metrics.
 * - "Traced" means: the lead has a skip_traces row whose status is in
 *   FINISHED_TRACE_STATUSES ("completed" | "no_results"). A "failed" row
 *   does NOT mark a lead as traced — failed lookups are retryable.
 * - Batch only touches untraced leads, so each run naturally advances to
 *   the next page: the leads it finishes gain a trace row and drop out of
 *   the next selection.
 * - Every finished trace is persisted via storage.createSkipTrace and its
 *   primary phone/email are written back onto the lead record (only into
 *   EMPTY lead.phone / lead.email — we never overwrite operator-entered
 *   contact info).
 *
 * FCRA §1681b permissible-purpose gate (2026-08-01, closing the FW-WYNNE-1
 * bypass): both POST endpoints here perform the SAME consumer lookup as the
 * FCRA-gated POST /api/skip-traces in routes-leads.ts, so they carry the
 * SAME gate — required `purposeOfUse` (skip-trace purpose enum) + required
 * `justification` (≥10 chars) + a current annual FCRA attestation, refused
 * with the same named codes (SKIP_TRACE_PURPOSE_REQUIRED /
 * FCRA_ATTESTATION_REQUIRED) BEFORE any debit, provider call, or persisted
 * row. The batch endpoint gates ONCE per request and stamps that one
 * purpose + justification + attesting user onto EVERY persisted trace row —
 * one attestation never silently covers N lookups under a different purpose.
 * This is a deliberate breaking change to the request contract: the prior
 * contract (no purpose field at all) was the §1681b violation.
 */

import { Router, type Response } from "express";
import { skipTracingService, type SkipTraceResult } from "./services/skipTracingService";
import { storage } from "./storage";
import { poolDebit, refundPoolDebit, poolRefusalDetails } from "./services/creditPool";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { createRateLimiter } from "./middleware/rateLimit";
import type { Lead, SkipTrace } from "@shared/schema";

const router = Router();

// Displayed unit cost per traced record. The canonical ledger debit is
// posted inside skipTracingService — this constant is only used for the
// costCents column on the persisted trace row (same convention as the
// FCRA-gated POST /api/skip-traces route in routes-leads.ts).
const SKIP_TRACE_CREDIT_CENTS = Number(process.env.SKIP_TRACE_CREDIT_CENTS ?? 20);

// 2026-07 security sweep: skip tracing hits a PAID upstream provider per
// call. Cost was bounded by the credit debit but there was no per-request
// throttle — a user with credits could hammer BatchData. Same posture as
// the AI routes: request-rate limit BEFORE the spend gate. Keyed per org.
const skipTraceLimiter = createRateLimiter(
  { maxRequests: 30, windowMs: 60 * 1000 },
  (req) => `skiptrace:${(req as AuthenticatedRequest).organizationId ?? "anon"}`,
);

// ── Pure, unit-testable helpers ─────────────────────────────────────────────

/** Trace statuses that mark a lead as "traced" (attempt finished). */
export const FINISHED_TRACE_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "no_results",
]);

type TraceMarkerRow = Pick<SkipTrace, "leadId" | "status">;

/** Lead IDs that have at least one finished trace row. */
export function finishedTraceLeadIds(traces: TraceMarkerRow[]): Set<number> {
  const ids = new Set<number>();
  for (const t of traces) {
    if (t.leadId != null && FINISHED_TRACE_STATUSES.has(t.status)) ids.add(t.leadId);
  }
  return ids;
}

/**
 * Select the next batch of genuinely untraced leads. Because finished
 * traces persist a skip_traces row, consecutive calls advance through the
 * lead list instead of re-tracing the same first page.
 */
export function selectUntracedLeads<L extends { id: number }>(
  leads: L[],
  traces: TraceMarkerRow[],
  cap: number,
): { batch: L[]; untracedTotal: number } {
  const traced = finishedTraceLeadIds(traces);
  const untraced = leads.filter((l) => !traced.has(l.id));
  return { batch: untraced.slice(0, cap), untracedTotal: untraced.length };
}

/**
 * Stats contract — every field is derived from real rows:
 * - totalLeads      — org's (non-deleted) leads
 * - tracedCount     — leads with a finished trace row
 * - untracedCount   — totalLeads - tracedCount
 * - foundCount      — leads with a "completed" trace (contacts were found)
 * - foundRate       — round(100 * foundCount / tracedCount), null when no
 *                     lead has finished a trace (never a fabricated 0%)
 * There is deliberately NO avgConfidence — we do not persist a per-trace
 * confidence, so there is nothing truthful to aggregate.
 */
export interface SkipTraceStatsResponse {
  configured: boolean;
  totalLeads: number;
  tracedCount: number;
  untracedCount: number;
  foundCount: number;
  foundRate: number | null;
}

export function deriveSkipTraceStats(
  leads: Array<{ id: number }>,
  traces: TraceMarkerRow[],
  configured: boolean,
): SkipTraceStatsResponse {
  const traced = finishedTraceLeadIds(traces);
  const found = new Set<number>();
  for (const t of traces) {
    if (t.leadId != null && t.status === "completed") found.add(t.leadId);
  }
  let tracedCount = 0;
  let foundCount = 0;
  for (const l of leads) {
    if (traced.has(l.id)) tracedCount++;
    if (found.has(l.id)) foundCount++;
  }
  return {
    configured,
    totalLeads: leads.length,
    tracedCount,
    untracedCount: leads.length - tracedCount,
    foundCount,
    foundRate: tracedCount > 0 ? Math.round((foundCount / tracedCount) * 100) : null,
  };
}

/**
 * Write-back policy: the primary phone/email land on the lead record
 * (lead.phone / lead.email — the fields the rest of the app reads) ONLY
 * when the lead's field is currently empty. Operator-entered contact info
 * is never overwritten by a provider lookup.
 */
export function buildLeadWriteBack(
  lead: Pick<Lead, "phone" | "email">,
  trace: SkipTraceResult,
): { phone?: string; email?: string } {
  const updates: { phone?: string; email?: string } = {};
  const phones = trace.contacts.filter((c) => c.type === "phone" && c.value);
  const emails = trace.contacts.filter((c) => c.type === "email" && c.value);
  const primaryPhone = phones.find((c) => c.isPrimary) ?? phones[0];
  const primaryEmail = emails.find((c) => c.isPrimary) ?? emails[0];
  if (!lead.phone && primaryPhone) updates.phone = primaryPhone.value;
  if (!lead.email && primaryEmail) updates.email = primaryEmail.value;
  return updates;
}

/**
 * Map a provider result into the stored `skip_traces.results` shape.
 * Truth-immutable (same invariant as mapSkipTraceResults in
 * routes-leads.ts): NEVER mints `verified: true` — providers return a
 * confidence score, not a source-asserted verification.
 */
export function toStoredResults(trace: SkipTraceResult): {
  results: NonNullable<SkipTrace["results"]>;
  hasAny: boolean;
} {
  const phones = trace.contacts
    .filter((c) => c.type === "phone")
    .map((c) => ({ number: c.value, type: c.lineType ?? "unknown", verified: false }));
  const emails = trace.contacts
    .filter((c) => c.type === "email")
    .map((c) => ({ email: c.value, verified: false }));
  const relatives = trace.contacts
    .filter((c) => c.type === "relative")
    .map((c) => ({ name: c.value }));

  const hasAny =
    phones.length > 0 || emails.length > 0 || relatives.length > 0 || !!trace.owner;

  return {
    hasAny,
    results: {
      phones,
      emails,
      relatives,
      ...(trace.owner?.address
        ? { addresses: [{ address: trace.owner.address, type: "current", current: true }] }
        : {}),
      ...(trace.owner?.age != null ? { ageRange: String(trace.owner.age) } : {}),
    },
  };
}

// ── FCRA §1681b permissible-purpose gate ────────────────────────────────────

/**
 * Audit fields the gate yields on success — persisted onto EVERY
 * skip_traces row this router writes (class-action defense trail, same
 * columns POST /api/skip-traces in routes-leads.ts persists).
 */
interface SkipTraceGateResult {
  purposeOfUse: string;
  justification: string;
  attestingUserId: string;
  attestationVersion: string;
}

/**
 * FW-WYNNE-1 permissible-purpose gate, applied to this router's consumer
 * lookups (2026-08-01 — these endpoints previously performed the same
 * lookup as the gated POST /api/skip-traces with NO gate at all).
 *
 * Reads `purposeOfUse` + `justification` from the request body (REQUIRED —
 * their absence was the prior contract, and the prior contract was the
 * violation), asserts purpose ∈ skip-trace purposes, justification ≥10
 * chars, and a current annual FCRA attestation for this org + user.
 *
 * On refusal, writes the SAME shapes routes-leads.ts uses and returns null:
 *   - SkipTracePurposeRequiredError → 400 Errors.badRequest with
 *     details.code SKIP_TRACE_PURPOSE_REQUIRED (message cites §1681b);
 *   - FcraAttestationStaleError → 403 { error: "FCRA_ATTESTATION_REQUIRED" }
 *     with the /account/fcra-attestation remedy.
 * MUST run before any credit debit, provider call, or persisted row.
 */
async function gateSkipTracePermitted(
  req: AuthenticatedRequest,
  res: Response,
): Promise<SkipTraceGateResult | null> {
  const body = (req.body ?? {}) as { purposeOfUse?: unknown; justification?: unknown };
  const purposeOfUse = typeof body.purposeOfUse === "string" ? body.purposeOfUse : undefined;
  const justification = typeof body.justification === "string" ? body.justification : undefined;

  // Same dynamic import as routes-leads.ts — the gate service pulls in the
  // db module, which route unit tests keep out of the load graph.
  const { assertSkipTracePermitted, respondFcraRefusal } =
    await import("./services/fcraAttestation");

  const attestingUserId = getUserId(req);
  try {
    const { attestationVersion } = await assertSkipTracePermitted({
      organizationId: getOrganizationId(req),
      userId: attestingUserId,
      purposeOfUse,
      justification,
    });
    // The gate only returns when both fields validated as non-empty strings.
    return {
      purposeOfUse: purposeOfUse as string,
      justification: justification as string,
      attestingUserId,
      attestationVersion,
    };
  } catch (err) {
    // Shared mapping — routes-leads.ts emits the identical refusal shapes, and
    // duplicating them here is how the res-status-raw ratchet caught this file
    // the day the gate landed. One mapping, one place.
    if (respondFcraRefusal(res, err)) return null;
    throw err;
  }
}

// ── Shared persistence path ─────────────────────────────────────────────────

interface PersistedTrace {
  status: "completed" | "no_results";
  leadUpdated: { phone: boolean; email: boolean };
}

/**
 * Persist a successful provider result: create the skip_traces row (the
 * "traced" marker the batch filter and stats read) and write the primary
 * contacts back onto the lead through the existing storage layer. The
 * caller's §1681b audit fields land on the row — a trace row without a
 * recorded purpose can no longer be written from this router.
 */
async function persistTraceResult(
  orgId: number,
  lead: Lead,
  trace: SkipTraceResult,
  audit: SkipTraceGateResult,
): Promise<PersistedTrace> {
  const { results, hasAny } = toStoredResults(trace);
  const status: PersistedTrace["status"] = hasAny ? "completed" : "no_results";
  const now = new Date();

  await storage.createSkipTrace({
    organizationId: orgId,
    leadId: lead.id,
    inputData: {
      name: `${lead.firstName} ${lead.lastName}`.trim(),
      address: lead.address ?? "",
    },
    status,
    provider: trace.source,
    // Real displayed cost only — the canonical ledger debit already
    // happened inside skipTracingService (never a second charge here).
    costCents: hasAny ? (trace.creditsUsed ?? 1) * SKIP_TRACE_CREDIT_CENTS : 0,
    results,
    requestedAt: now,
    completedAt: now,
    // FCRA §1681b audit trail — same columns the routes-leads path persists.
    purposeOfUse: audit.purposeOfUse,
    justification: audit.justification,
    attestingUserId: audit.attestingUserId,
    attestationVersion: audit.attestationVersion,
  });

  const updates = buildLeadWriteBack(lead, trace);
  const leadUpdated = { phone: !!updates.phone, email: !!updates.email };
  if (leadUpdated.phone || leadUpdated.email) {
    await storage.updateLead(lead.id, updates, orgId);
  }
  return { status, leadUpdated };
}

function toTraceResponse(lead: Lead, trace: SkipTraceResult, persisted: PersistedTrace) {
  return {
    leadId: lead.id,
    status: persisted.status,
    source: trace.source,
    phones: trace.contacts
      .filter((c) => c.type === "phone")
      .map((c) => ({
        number: c.value,
        lineType: c.lineType ?? null,
        confidence: c.confidence,
        doNotCall: c.doNotCall ?? false,
      })),
    emails: trace.contacts
      .filter((c) => c.type === "email")
      .map((c) => ({ address: c.value, confidence: c.confidence })),
    ownerAddress: trace.owner?.address ?? null,
    leadUpdated: persisted.leadUpdated,
    tracedAt: new Date().toISOString(),
  };
}

// ── Routes ──────────────────────────────────────────────────────────────────

// POST /api/skip-tracing/trace/:leadId — trace a single lead
router.post("/trace/:leadId", skipTraceLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return Errors.badRequest(res, "Invalid lead ID");

    // FCRA §1681b gate FIRST — before the debit, before the provider, before
    // the row. A refusal costs nothing and leaks nothing.
    const audit = await gateSkipTracePermitted(req, res);
    if (!audit) return;

    // Load the lead BEFORE debiting — a missing lead should never cost a
    // credit (previously we debited, then refunded on not-found).
    const lead = await storage.getLead(orgId, leadId);
    if (!lead) return Errors.notFound(res, "Lead");

    // Lens 3 (Pricing Coherence) — debit ONE skip-trace credit before the
    // BatchData call. cache hits inside skipTracingService still pay (we
    // charge the customer for the lookup, even when our cache absorbed the
    // provider hit — that's how the BatchData unit-economics math works).
    const traceKey = `skip:trace:${orgId}:${leadId}:${Date.now()}`;
    const traceDebit = await poolDebit({
      organizationId: orgId,
      action: "skip_trace",
      units: 1,
      externalEventId: traceKey,
      notes: `Skip trace lead ${leadId}`,
      isFounder: req.isFounder,
    });

    // Tier 1I — pool refusals are surfaced, never swallowed.
    if (!traceDebit.allowed) {
      return Errors.limitExceeded(res, poolRefusalDetails("skip_trace", traceDebit));
    }

    const refundTrace = async (reason: string) => {
      if (traceDebit.debitedCents > 0) {
        await refundPoolDebit({
          organizationId: orgId,
          originalEventId: traceKey,
          amountCents: traceDebit.debitedCents,
          reason,
        });
      }
    };

    let result: SkipTraceResult;
    try {
      result = await skipTracingService.trace({
        firstName: lead.firstName,
        lastName: lead.lastName,
        address: lead.address ?? undefined,
        city: lead.city ?? undefined,
        state: lead.state ?? undefined,
        zip: lead.zip ?? undefined,
      }, orgId);
    } catch (err) {
      await refundTrace("Skip trace lookup failed");
      throw err;
    }

    // Provider unavailable / lookup failed — the customer got nothing, so
    // the credit goes back and the response says so honestly (503, not a
    // fabricated empty result).
    if (!result.success) {
      await refundTrace("Skip trace lookup failed (no provider result)");
      return Errors.serviceUnavailable(
        res,
        result.error ?? "Skip tracing is temporarily unavailable — no provider returned a result.",
      );
    }

    const persisted = await persistTraceResult(orgId, lead, result, audit);

    res.json({
      ...toTraceResponse(lead, result, persisted),
      creditPool: {
        debitedCents: traceDebit.debitedCents,
        remaining: traceDebit.remaining,
        poolMonthly: traceDebit.poolMonthly,
      },
    });
  } catch (err: any) {
    logger.error("Skip trace error", err);
    Errors.internal(res, err);
  }
});

// POST /api/skip-tracing/batch — trace the next page of untraced leads
router.post("/batch", skipTraceLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);

    const rawLimit = req.body?.limit ?? 50;
    const limit = Number(rawLimit);
    if (!Number.isFinite(limit) || limit < 1) {
      return Errors.badRequest(res, "limit must be a positive number");
    }
    const capped = Math.min(Math.floor(limit), 100);

    // FCRA §1681b gate — ONCE for the whole batch, before selection, debit,
    // or any provider call. The single claimed purpose + justification is
    // stamped onto EVERY row persisted below: one attestation never quietly
    // covers N lookups made for some other purpose.
    const audit = await gateSkipTracePermitted(req, res);
    if (!audit) return;

    // Untraced = leads with NO finished skip_traces row. Finished traces
    // created below drop those leads out of the next selection, so each
    // batch run advances instead of re-tracing (and re-charging) the same
    // first page.
    const [leads, traces] = await Promise.all([
      storage.getLeads(orgId),
      storage.getSkipTraces(orgId),
    ]);
    const { batch, untracedTotal } = selectUntracedLeads(leads, traces, capped);

    if (batch.length === 0) {
      // Honest zero — nothing to trace, nothing debited.
      return res.json({
        requested: 0,
        traced: 0,
        found: 0,
        failed: 0,
        untracedRemaining: 0,
        message: "Every lead already has a finished skip trace — nothing to run.",
      });
    }

    // Debit exactly the number of leads this run will attempt. Failed
    // lookups are refunded proportionally below.
    const batchKey = `skip:batch:${orgId}:${Date.now()}`;
    const batchDebit = await poolDebit({
      organizationId: orgId,
      action: "skip_trace",
      units: batch.length,
      externalEventId: batchKey,
      notes: `Skip trace batch (${batch.length} untraced leads)`,
      isFounder: req.isFounder,
    });

    // Tier 1I — pool refusals are surfaced, never swallowed.
    if (!batchDebit.allowed) {
      return Errors.limitExceeded(res, poolRefusalDetails("skip_trace", batchDebit));
    }

    let traced = 0;
    let found = 0;
    let failed = 0;

    // Sequential on purpose: each trace is a paid provider call and the
    // upstream has its own rate limits — fanning out 100 parallel lookups
    // is how batch providers start dropping requests.
    for (const lead of batch) {
      try {
        const result = await skipTracingService.trace({
          firstName: lead.firstName,
          lastName: lead.lastName,
          address: lead.address ?? undefined,
          city: lead.city ?? undefined,
          state: lead.state ?? undefined,
          zip: lead.zip ?? undefined,
        }, orgId);

        if (!result.success) {
          failed++;
          continue;
        }

        const persisted = await persistTraceResult(orgId, lead, result, audit);
        traced++;
        if (persisted.status === "completed") found++;
      } catch (err) {
        failed++;
        logger.warn(
          `Skip trace batch: lead ${lead.id} failed — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Refund the units for lookups that returned nothing billable.
    if (failed > 0 && batchDebit.debitedCents > 0) {
      const refundCents = Math.round((batchDebit.debitedCents * failed) / batch.length);
      if (refundCents > 0) {
        await refundPoolDebit({
          organizationId: orgId,
          originalEventId: batchKey,
          amountCents: refundCents,
          reason: `Skip trace batch: ${failed}/${batch.length} lookups failed`,
        });
      }
    }

    res.json({
      requested: batch.length,
      traced,
      found,
      failed,
      untracedRemaining: untracedTotal - traced,
      message: `Traced ${traced} of ${batch.length} untraced leads (${found} with contact info).`,
      creditPool: {
        debitedCents: batchDebit.debitedCents,
        remaining: batchDebit.remaining,
        poolMonthly: batchDebit.poolMonthly,
      },
    });
  } catch (err: any) {
    logger.error("Skip trace batch error", err);
    Errors.internal(res, err);
  }
});

// GET /api/skip-tracing/stats — stats derived from real trace records
router.get("/stats", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    const [leads, traces] = await Promise.all([
      storage.getLeads(orgId),
      storage.getSkipTraces(orgId),
    ]);
    res.json(deriveSkipTraceStats(leads, traces, skipTracingService.isConfigured()));
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

export default router;
