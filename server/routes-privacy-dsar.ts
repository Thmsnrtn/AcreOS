/**
 * Panel-300 #26 — GDPR DSAR endpoint with 24h SLA.
 *
 * Adversarial-stress (Mei-Lin) + security-compliance: build the response
 * cron + measurement, not just the sub-processor disclosure (FW-SAM-2
 * already shipped that). Every DSAR gets a tracking row; quarterly
 * self-DSAR audit verifies the SLA is actually met.
 *
 *   POST /api/privacy/dsar                          — file a DSAR (public, no auth)
 *   GET  /api/founder/dsar/recent                   — founder pulls recent + SLA status
 *   POST /api/founder/dsar/self-test                — fire a synthetic DSAR for audit
 *   POST /api/founder/dsar/:id/verify-identity      — record the identity check (PKG-1 §2)
 *   GET  /api/founder/dsar/:id/subject-candidates   — users/leads matching the requester email (PKG-1 §3)
 *   POST /api/founder/dsar/:id/generate-export      — gated registry export download (PKG-1 §4)
 *   POST /api/founder/dsar/:id/execute-erasure      — gated, hold-checked erasure (PKG-1 §3)
 *   POST /api/founder/dsar/:id/fulfill              — mark fulfilled (the one fulfilledAt writer)
 *
 * PKG-1 (docs/pkg1-dsar-design-2026-11.md): this file owns the record of
 * record, `dsar_requests_lifecycle`. Every export/erasure goes through
 * gateDsarAction (server/services/privacy/dsarActionGate.ts), the only
 * producer of a DsarSubject. Path names are deliberately distinct from
 * routes-dsar.ts's `/:id/verify` and `/:id/erasure` — this file is mounted
 * first and would otherwise shadow them.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import { dsarRequestsLifecycle } from "@shared/schema";
import { DSAR_CLOCK_HOURS } from "@shared/privacy/dsarClock";
import { DSAR_IDENTITY_POSTURE, DSAR_RECORD_OF_RECORD } from "@shared/privacy/dsarIdentityPosture";
import { desc, eq, and, isNull, lte } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { auditFromRequest, AuditActions } from "./utils/auditLog";
import { logger } from "./utils/logger";
import { clock } from "./utils/clock";
import { routeParam } from "./utils/routeParams";
// Static imports (design §8): a dynamic import made gdprService opaque to the
// reachability gate, hiding which exports have production callers.
import {
  gateDsarAction,
  listDsarSubjectCandidates,
  loadDsarRecord,
  type DsarSubject,
  type GateRefusal,
} from "./services/privacy/dsarActionGate";
import { buildSubjectExport } from "./services/privacy/dsarExporters";
import { eraseDsarSubject, DsarErasureRefusedError } from "./services/gdprService";
import { LegalHoldViolationError } from "./services/legalHold";

const dsarSubmitSchema = z.object({
  requestType: z.enum(["access", "erasure", "portability", "rectification"]),
  requesterEmail: z.string().email(),
  notes: z.string().max(2000).optional(),
});

/** The founder's subject pick — same union for export and erasure (§3/§4). */
const subjectSelectorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: z.string().min(1) }),
  z.object({
    kind: z.literal("lead"),
    organizationId: z.number().int().positive(),
    leadId: z.number().int().positive(),
  }),
]);

/**
 * generate-export body. The legacy `{ userId: string }` is accepted for one
 * release as `{ kind: "user", userId }`. (The old numeric parse is gone:
 * users.id is a UUID, so a numeric id never matched anyone — design C-3.)
 */
const exportBodySchema = z.union([
  z.object({ subject: subjectSelectorSchema }),
  z
    .object({ userId: z.string().min(1) })
    .transform((b) => ({ subject: { kind: "user" as const, userId: b.userId } })),
]);

const eraseBodySchema = z.object({
  subject: subjectSelectorSchema,
  confirm: z.literal("ERASE"),
});

const verifyBodySchema = z.object({
  method: z.enum(DSAR_IDENTITY_POSTURE.acceptedMethods),
  evidenceNote: z.string().min(DSAR_IDENTITY_POSTURE.minEvidenceNoteChars).max(2000),
});

/**
 * Ids only — what audit rows carry. Never the email: audit_events is global
 * and 7-year, and must not hold an erased person's address (design §3 — a
 * deliberate departure from routes-dsar.ts, which logs `email`).
 */
function subjectRef(subject: DsarSubject): Record<string, unknown> {
  return subject.kind === "user"
    ? { kind: "user", userId: subject.userId }
    : { kind: "lead", organizationId: subject.organizationId, leadId: subject.leadId };
}

/**
 * Map a gate refusal to the Errors.* contract. 422s carry the machine name
 * as `details.reason`. 404s go through Errors.notFound, which takes no
 * details (design §2 step 1 names that helper), so the entity text is the
 * distinguisher: "DSAR request" vs "DSAR subject".
 */
function sendGateRefusal(res: Response, refusal: GateRefusal): void {
  if (refusal.status === 404) {
    return Errors.notFound(res, refusal.reason === "DSAR_NOT_FOUND" ? "DSAR request" : "DSAR subject");
  }
  return Errors.unprocessable(res, refusal.message, { reason: refusal.reason, ...(refusal.details ?? {}) });
}

export function registerPrivacyDsarRoutes(app: Express): void {
  // PUBLIC — anyone can file a DSAR. 24h SLA starts at received_at.
  app.post("/api/privacy/dsar", async (req, res: Response) => {
    try {
      const parsed = dsarSubmitSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.flatten());
      }
      const slaDeadline = new Date(clock.nowMs() + DSAR_CLOCK_HOURS * 60 * 60 * 1000);
      const [row] = await db
        .insert(dsarRequestsLifecycle)
        .values({
          requestType: parsed.data.requestType,
          requesterEmail: parsed.data.requesterEmail.toLowerCase(),
          slaDeadlineAt: slaDeadline,
          auditNotes: parsed.data.notes ?? null,
        })
        .returning();

      // Audit-event fan-out: every DSAR intake writes to audit_events so the
      // 7-year recovery log shows the request lifecycle from receipt onward.
      try {
        await auditFromRequest(req, {
          action: AuditActions.DSAR_INTAKE,
          target: { type: "dsar", id: row.id },
          metadata: {
            requestType: parsed.data.requestType,
            email: parsed.data.requesterEmail.toLowerCase(),
            slaDeadlineAt: row.slaDeadlineAt,
            source: "public_intake",
          },
        });
      } catch (auditErr) {
        logger.warn("[dsar-public] audit log failed", auditErr as Error);
      }

      return res.status(201).json({
        id: row.id,
        slaDeadlineAt: row.slaDeadlineAt,
        next: "Request received and logged for operator review, tracked against a 24-hour target from receipt (see slaDeadlineAt).",
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // FOUNDER — list recent + SLA status. Highlights overdue rows.
  app.get(
    "/api/founder/dsar/recent",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const rows = await db
          .select()
          .from(dsarRequestsLifecycle)
          .orderBy(desc(dsarRequestsLifecycle.receivedAt))
          .limit(200);
        const now = clock.nowMs();
        const overdue = rows.filter(
          (r) => !r.fulfilledAt && new Date(r.slaDeadlineAt).getTime() < now,
        );
        const within = rows.filter(
          (r) => !r.fulfilledAt && new Date(r.slaDeadlineAt).getTime() >= now,
        );
        const fulfilled = rows.filter((r) => r.fulfilledAt);
        return res.json({
          rows,
          summary: {
            total: rows.length,
            overdueCount: overdue.length,
            withinSlaCount: within.length,
            fulfilledCount: fulfilled.length,
            overdue: overdue.map((r) => ({ id: r.id, receivedAt: r.receivedAt, slaDeadlineAt: r.slaDeadlineAt })),
          },
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // FOUNDER — fire a self-test DSAR. Verifies the response cron is alive.
  app.post(
    "/api/founder/dsar/self-test",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const slaDeadline = new Date(clock.nowMs() + DSAR_CLOCK_HOURS * 60 * 60 * 1000);
        const [row] = await db
          .insert(dsarRequestsLifecycle)
          .values({
            requestType: "access",
            requesterEmail: `self-test+${clock.nowMs()}@acreos.io`,
            slaDeadlineAt: slaDeadline,
            isSelfTest: true,
            auditNotes: "Quarterly DSAR self-test (panel-300 #26)",
          })
          .returning();
        return res.json({ id: row.id, slaDeadlineAt: row.slaDeadlineAt });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // FOUNDER — record the identity check on a lifecycle record (PKG-1 §2).
  // The ONLY writer of requesterIdentityVerified. Sets that flag and nothing
  // else; who/when/how/evidence go to audit_events (append-only, hash-
  // chained) — auditNotes cannot carry it because /fulfill overwrites it.
  // Idempotent: re-verifying returns { alreadyVerified: true } and still
  // audits, so a second attestation is recorded. There is no un-verify.
  app.post(
    "/api/founder/dsar/:id/verify-identity",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = routeParam(req.params.id);
        const parsed = verifyBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const record = await loadDsarRecord(id);
        if (!record) return Errors.notFound(res, "DSAR request");
        const alreadyVerified = record.verified;

        // Audit FIRST and let a failure surface: the audit row is the
        // durable evidence of the check, so the flag is never set without it.
        await auditFromRequest(req, {
          action: AuditActions.DSAR_VERIFIED,
          target: { type: "dsar", id: record.id },
          metadata: {
            table: DSAR_RECORD_OF_RECORD,
            method: parsed.data.method,
            evidenceNote: parsed.data.evidenceNote,
            posture: DSAR_IDENTITY_POSTURE.id,
            alreadyVerified,
          },
        });

        if (!alreadyVerified) {
          await db
            .update(dsarRequestsLifecycle)
            .set({ requesterIdentityVerified: true })
            .where(eq(dsarRequestsLifecycle.id, record.id));
        }

        return res.json({
          id: record.id,
          verified: true,
          alreadyVerified,
          method: parsed.data.method,
          posture: DSAR_IDENTITY_POSTURE.id,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // FOUNDER — the subjects the founder may pick for this record (PKG-1 §3):
  // users and leads whose email equals the record's requesterEmail. Ids and
  // flags only (kind / org / borrower / erased) — no emails or contact
  // fields in the response. The lead read is cross-org, founder-plane only
  // (see listDsarSubjectCandidates and DSAR_IDENTITY_POSTURE).
  app.get(
    "/api/founder/dsar/:id/subject-candidates",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = routeParam(req.params.id);
        const record = await loadDsarRecord(id);
        if (!record) return Errors.notFound(res, "DSAR request");
        const candidates = await listDsarSubjectCandidates(record.requesterEmail);
        return res.json({
          dsarId: record.id,
          requestType: record.requestType,
          verified: record.verified,
          posture: DSAR_IDENTITY_POSTURE.id,
          users: candidates.users,
          leads: candidates.leads,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Pillar D / D1 — Generate a DSAR export (PKG-1 §4) ─────────────────
  // Founder-only: gate (verified record, access/portability type, subject
  // resolved, exact email match) → the declared-registry export for that
  // subject, streamed as a JSON download. The founder forwards the file to
  // the requester by hand; AcreOS sends nothing. Does NOT set fulfilledAt —
  // the founder closes the record with /fulfill.
  app.post(
    "/api/founder/dsar/:id/generate-export",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = routeParam(req.params.id);
        const parsed = exportBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const gate = await gateDsarAction(id, parsed.data.subject, "export");
        if (!gate.ok) return sendGateRefusal(res, gate.refusal);

        const { record, subject } = gate;
        const exportData = await buildSubjectExport(subject);

        try {
          await auditFromRequest(req, {
            action: "dsar_export_generated",
            target: { type: "dsar", id: record.id },
            metadata: {
              table: DSAR_RECORD_OF_RECORD,
              requestType: record.requestType,
              subject: subjectRef(subject),
              posture: DSAR_IDENTITY_POSTURE.id,
              recordCounts: exportData.totalRecords,
            },
          });
        } catch (auditErr) {
          logger.warn("[dsar-export] audit log failed", auditErr as Error);
        }

        const subjectPart =
          subject.kind === "user"
            ? `user-${subject.userId}`
            : `lead-${subject.organizationId}-${subject.leadId}`;
        res.setHeader("Content-Type", "application/json");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="dsar-${record.id}-${subjectPart}.json"`,
        );
        return res.json(exportData);
      } catch (err) {
        logger.error("[dsar-export] generate failed", err);
        return Errors.internal(res, err);
      }
    },
  );

  // FOUNDER — execute a DSAR erasure (PKG-1 §3). Gated exactly like the
  // export (erasure-type record), then gdprService.eraseDsarSubject, which
  // checks legal holds and the S-1 borrower retention rule before its first
  // write. Every outcome writes a DSAR_ERASURE audit row with subject ids
  // only — never an email. Does NOT set fulfilledAt.
  app.post(
    "/api/founder/dsar/:id/execute-erasure",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = routeParam(req.params.id);
        const parsed = eraseBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const gate = await gateDsarAction(id, parsed.data.subject, "erasure");
        if (!gate.ok) return sendGateRefusal(res, gate.refusal);

        const { record, subject } = gate;
        const auditErasure = async (outcome: string, extra: Record<string, unknown> = {}) => {
          try {
            await auditFromRequest(req, {
              action: AuditActions.DSAR_ERASURE,
              target: { type: "dsar", id: record.id },
              metadata: {
                table: DSAR_RECORD_OF_RECORD,
                outcome,
                subject: subjectRef(subject),
                posture: DSAR_IDENTITY_POSTURE.id,
                ...extra,
              },
            });
          } catch (auditErr) {
            logger.error("[dsar-erasure] audit log failed", auditErr as Error);
          }
        };

        try {
          const result = await eraseDsarSubject(subject);
          await auditErasure("erased", { report: result.report });
          return res.json({ erased: true, ...result });
        } catch (err) {
          if (err instanceof LegalHoldViolationError) {
            await auditErasure("refused_legal_hold", {
              caseRef: err.hold.caseRef,
              holdId: err.hold.id,
            });
            return Errors.legalHoldActive(res, err.message, {
              reason: err.code,
              organizationId: err.organizationId,
              holdId: err.hold.id,
              caseRef: err.hold.caseRef,
              scope: err.hold.scope,
              resourceType: err.resourceType,
              resourceId: err.resourceId,
            });
          }
          if (err instanceof DsarErasureRefusedError) {
            await auditErasure(err.reason, { details: err.details });
            return Errors.unprocessable(res, err.message, { reason: err.reason, ...err.details });
          }
          throw err;
        }
      } catch (err) {
        logger.error("[dsar-erasure] execute failed", err);
        return Errors.internal(res, err);
      }
    },
  );

  // FOUNDER — mark a DSAR fulfilled (after the response is sent).
  app.post(
    "/api/founder/dsar/:id/fulfill",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = routeParam(req.params.id);
        const { deliveryMethod, bytesDelivered, auditNotes } = req.body ?? {};
        const [updated] = await db
          .update(dsarRequestsLifecycle)
          .set({
            fulfilledAt: clock.now(),
            deliveryMethod: deliveryMethod ?? null,
            bytesDelivered: bytesDelivered ?? null,
            auditNotes: auditNotes ?? null,
          })
          .where(eq(dsarRequestsLifecycle.id, id))
          .returning();
        if (!updated) return Errors.notFound(res, "DSAR request");

        // Audit-event: founder marked this DSAR fulfilled. Closes the
        // 24h-SLA lifecycle row in audit_events alongside the intake event.
        try {
          await auditFromRequest(req, {
            action: AuditActions.DSAR_COMPLETED,
            target: { type: "dsar", id: updated.id },
            metadata: {
              requestType: updated.requestType,
              email: updated.requesterEmail,
              deliveryMethod: updated.deliveryMethod,
              bytesDelivered: updated.bytesDelivered,
              fulfilledAt: updated.fulfilledAt,
              slaDeadlineAt: updated.slaDeadlineAt,
              metBySla:
                !!updated.fulfilledAt &&
                new Date(updated.fulfilledAt).getTime() <=
                  new Date(updated.slaDeadlineAt).getTime(),
            },
          });
        } catch (auditErr) {
          logger.warn("[dsar-fulfill] audit log failed", auditErr as Error);
        }

        return res.json(updated);
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
