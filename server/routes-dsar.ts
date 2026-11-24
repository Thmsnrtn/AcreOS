/**
 * Phase 3 Week 11 — GDPR/CCPA DSAR pipeline (legacy surface).
 *
 * Public intake (no auth, rate-limited):
 *   POST /api/public/dsar          — legacy alias of the canonical intake
 *
 * Founder-gated operator surface (legacy `dsar_requests` rows only):
 *   GET    /api/founder/dsar                  — list pending + recent requests
 *   GET    /api/founder/dsar/:id              — fetch one
 *   POST   /api/founder/dsar/:id/verify       — record identity verification
 *   POST   /api/founder/dsar/:id/deny         — deny w/ reason
 *
 * Autopilot B-3 (2026-11-18): there is ONE DSAR intake path. This file's
 * public route used to write the legacy `dsar_requests` table and promise
 * requesters a response "within 30 days" against the ratified strict 24h
 * internal clock (Tap #4), and its founder fan-out/erasure handlers were
 * execution stubs that always threw. Now:
 *   - POST /api/public/dsar inserts the canonical lifecycle record
 *     (`dsar_requests_lifecycle`, server/routes-privacy-dsar.ts) with a
 *     DSAR_CLOCK_HOURS deadline and 24h-posture copy — the same record,
 *     clock, audit event, and abuse controls (per-IP rate limit +
 *     Turnstile when configured, server/services/privacy/dsarIntakeGuards.ts)
 *     as POST /api/privacy/dsar;
 *   - the fan-out/erasure stub endpoints are retired. Fulfilment runs on
 *     the lifecycle record: POST /api/founder/dsar/:id/generate-export or
 *     /execute-erasure (see docs/pkg1-dsar-design-2026-11.md), where the
 *     S-1 borrower-erasure refusal (Tap #5) is enforced by gdprService.
 * The remaining founder handlers serve only pre-B-3 `dsar_requests` rows
 * (list / verify / deny); no new rows are written to that table.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";

import { db } from "./db";
import { dsarRequests, dsarRequestsLifecycle, type DsarStatus } from "@shared/schema";
import { DSAR_CLOCK_HOURS } from "@shared/privacy/dsarClock";
import { isAuthenticated } from "./auth";
import { isFounderIdentity } from "./services/founder";
import { Errors } from "./utils/errors";
import { auditFromRequest, AuditActions } from "./utils/auditLog";
import { getClerkAuth, type AuthenticatedRequest } from "./types/request";
import { clock } from "./utils/clock";
import { routeParam } from "./utils/routeParams";
import { dsarIntakeLimiter, verifyDsarTurnstile } from "./services/privacy/dsarIntakeGuards";
import { getClientIp } from "./utils/clientIp";

// ─── Validation schemas ─────────────────────────────────────────────────────
const dsarIntakeSchema = z.object({
  requestType: z.enum(["access", "erasure", "portability", "rectification"]),
  email: z.string().email().max(320),
  fullName: z.string().min(2).max(200),
  organization: z.string().max(200).optional(),
  justification: z.string().max(2000).optional(),
  // Optional Cloudflare Turnstile token. Verified server-side only when
  // CLOUDFLARE_TURNSTILE_SECRET is set; otherwise we fall back to rate-limit.
  turnstileToken: z.string().max(5000).optional(),
});

const denySchema = z.object({
  reason: z.string().min(5).max(2000),
});

// ─── Founder gate ───────────────────────────────────────────────────────────
function requireFounder(req: AuthenticatedRequest, res: Response): boolean {
  const user = req.user;
  const userId = getClerkAuth(req)?.userId ?? user?.clerkUserId ?? null;
  const email = user?.email ?? null;
  if (!isFounderIdentity({ email, userId })) {
    Errors.notFound(res, "Resource");
    return false;
  }
  return true;
}

// ─── Routes ─────────────────────────────────────────────────────────────────
export function registerDsarRoutes(app: Express): void {
  // ── POST /api/public/dsar ─────────────────────────────────────────────
  // Legacy alias of POST /api/privacy/dsar: writes the canonical lifecycle
  // record with the shared 24h clock. The lifecycle table has no name/org
  // columns, so the requester's name, organization, and justification ride
  // in auditNotes — the same field the canonical intake's `notes` uses —
  // where the founder sees them at identity-verification time.
  app.post("/api/public/dsar", dsarIntakeLimiter, async (req: Request, res: Response) => {
    const parsed = dsarIntakeSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const body = parsed.data;

    const turnstileOk = await verifyDsarTurnstile(body.turnstileToken, getClientIp(req));
    if (!turnstileOk) {
      return Errors.forbidden(res, "Captcha verification failed");
    }

    try {
      const noteParts = [`Filed via /api/public/dsar by ${body.fullName}`];
      if (body.organization) noteParts.push(`Organization: ${body.organization}`);
      if (body.justification) noteParts.push(body.justification);

      const slaDeadline = new Date(clock.nowMs() + DSAR_CLOCK_HOURS * 60 * 60 * 1000);
      const [row] = await db
        .insert(dsarRequestsLifecycle)
        .values({
          requestType: body.requestType,
          requesterEmail: body.email.toLowerCase(),
          slaDeadlineAt: slaDeadline,
          auditNotes: noteParts.join(" — "),
        })
        .returning();

      await auditFromRequest(req, {
        action: AuditActions.DSAR_INTAKE,
        target: { type: "dsar", id: row.id },
        metadata: {
          requestType: body.requestType,
          email: body.email.toLowerCase(),
          slaDeadlineAt: row.slaDeadlineAt,
          source: "public_intake_legacy_alias",
        },
      });

      return res.status(201).json({
        ok: true,
        id: row.id,
        slaDeadlineAt: row.slaDeadlineAt,
        next: "Request received and logged for operator review, tracked against a 24-hour target from receipt (see slaDeadlineAt). Identity verification is required before any data is released.",
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── GET /api/founder/dsar ─────────────────────────────────────────────
  app.get("/api/founder/dsar", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    try {
      const rows = await db
        .select()
        .from(dsarRequests)
        .orderBy(desc(dsarRequests.createdAt))
        .limit(500);
      return res.json({ requests: rows });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── GET /api/founder/dsar/:id ─────────────────────────────────────────
  app.get("/api/founder/dsar/:id", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    try {
      const [row] = await db
        .select()
        .from(dsarRequests)
        .where(eq(dsarRequests.id, routeParam(req.params.id)))
        .limit(1);
      if (!row) return Errors.notFound(res, "DSAR request");
      return res.json({ request: row });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── POST /api/founder/dsar/:id/verify ─────────────────────────────────
  // Marks the request as verified after the founder confirms identity
  // (e.g. completed email-loop, notarised ID). The actual email-loop send
  // is a separate concern; this endpoint records the operator's decision.
  app.post("/api/founder/dsar/:id/verify", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    try {
      const [row] = await db
        .select()
        .from(dsarRequests)
        .where(eq(dsarRequests.id, routeParam(req.params.id)))
        .limit(1);
      if (!row) return Errors.notFound(res, "DSAR request");

      const [updated] = await db
        .update(dsarRequests)
        .set({
          status: "verified" as DsarStatus,
          verifiedAt: clock.now(),
          updatedAt: clock.now(),
        })
        .where(eq(dsarRequests.id, row.id))
        .returning();

      await auditFromRequest(req, {
        action: AuditActions.DSAR_VERIFIED,
        target: { type: "dsar", id: row.id },
        metadata: { email: row.email, requestType: row.requestType },
      });

      return res.json({ request: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── POST /api/founder/dsar/:id/deny ───────────────────────────────────
  app.post("/api/founder/dsar/:id/deny", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    const parsed = denySchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

    try {
      const [row] = await db
        .select()
        .from(dsarRequests)
        .where(eq(dsarRequests.id, routeParam(req.params.id)))
        .limit(1);
      if (!row) return Errors.notFound(res, "DSAR request");

      const [updated] = await db
        .update(dsarRequests)
        .set({
          status: "denied" as DsarStatus,
          deniedReason: parsed.data.reason,
          completedAt: clock.now(),
          updatedAt: clock.now(),
        })
        .where(eq(dsarRequests.id, row.id))
        .returning();

      await auditFromRequest(req, {
        action: AuditActions.DSAR_DENIED,
        target: { type: "dsar", id: row.id },
        justification: parsed.data.reason,
        metadata: { email: row.email },
      });

      return res.json({ request: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
