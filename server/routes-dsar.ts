/**
 * Phase 3 Week 11 — GDPR/CCPA DSAR pipeline.
 *
 * Public intake (no auth, rate-limited):
 *   POST /api/public/dsar          — accept a Data Subject Access Request
 *
 * Founder-gated operator surface:
 *   GET    /api/founder/dsar                  — list pending + recent requests
 *   GET    /api/founder/dsar/:id              — fetch one
 *   POST   /api/founder/dsar/:id/verify       — record identity verification
 *   POST   /api/founder/dsar/:id/fan-out      — run access/portability fan-out (stub)
 *   POST   /api/founder/dsar/:id/erasure      — run erasure (stub)
 *   POST   /api/founder/dsar/:id/deny         — deny w/ reason
 *
 * Fan-out + erasure handlers are intentionally STUBBED — the cross-table
 * email→row enumeration is a separate, large workstream. The operator UI
 * exists today so the workflow is visible and the audit trail accumulates.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import crypto from "crypto";
import rateLimit from "express-rate-limit";

import { db } from "./db";
import { dsarRequests, type DsarStatus } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { isFounderIdentity } from "./services/founder";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { auditFromRequest, AuditActions } from "./utils/auditLog";
import type { AuthenticatedRequest } from "./types/request";

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

// ─── Public intake rate-limit ───────────────────────────────────────────────
// 5 DSAR submissions per IP per hour. DSAR endpoints are abuse vectors
// (anonymous text storage), so we cap aggressively.
const publicDsarLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "RATE_LIMITED", message: "Too many DSAR submissions; try again in an hour." },
});

// ─── Optional Turnstile verifier ────────────────────────────────────────────
async function verifyTurnstile(token: string | undefined, remoteIp: string | null): Promise<boolean> {
  const secret = process.env.CLOUDFLARE_TURNSTILE_SECRET;
  if (!secret) {
    // Turnstile not configured — fall back to rate-limit + email loop.
    return true;
  }
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.append("remoteip", remoteIp);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    const json = (await r.json()) as { success?: boolean };
    return Boolean(json.success);
  } catch (err) {
    logger.error("[dsar] turnstile verify failed", err as Error);
    return false;
  }
}

// ─── Founder gate ───────────────────────────────────────────────────────────
function requireFounder(req: AuthenticatedRequest, res: Response): boolean {
  const user = req.user as any;
  const userId = (req as any).auth?.userId ?? user?.clerkUserId ?? null;
  const email = user?.email ?? null;
  if (!isFounderIdentity({ email, userId })) {
    Errors.notFound(res, "Resource");
    return false;
  }
  return true;
}

// ─── Stub fan-out / erasure ─────────────────────────────────────────────────
// These intentionally throw — the row-by-row enumeration across every
// org-scoped table is a separate large workstream. Stubbing keeps the
// operator UI honest about its current capability.
async function runFanOutStub(_dsarId: string): Promise<never> {
  throw new Error("Implement: data fan-out");
}

async function runErasureStub(_dsarId: string): Promise<never> {
  throw new Error("Implement: erasure (legal-hold check + soft-delete)");
}

// ─── Routes ─────────────────────────────────────────────────────────────────
export function registerDsarRoutes(app: Express): void {
  // ── POST /api/public/dsar ─────────────────────────────────────────────
  app.post("/api/public/dsar", publicDsarLimiter, async (req: Request, res: Response) => {
    const parsed = dsarIntakeSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const body = parsed.data;

    const ipHeader = req.headers["x-forwarded-for"];
    const ip =
      (typeof ipHeader === "string" ? ipHeader.split(",")[0]?.trim() : Array.isArray(ipHeader) ? ipHeader[0] : undefined) ??
      req.socket?.remoteAddress ??
      null;

    const turnstileOk = await verifyTurnstile(body.turnstileToken, ip);
    if (!turnstileOk) {
      return Errors.forbidden(res, "Captcha verification failed");
    }

    try {
      const verificationToken = crypto.randomBytes(24).toString("hex");
      const [row] = await db
        .insert(dsarRequests)
        .values({
          requestType: body.requestType,
          email: body.email.toLowerCase(),
          fullName: body.fullName,
          organization: body.organization ?? null,
          justification: body.justification ?? null,
          status: "pending",
          verificationToken,
          ip,
          userAgent: (req.headers["user-agent"] as string) ?? null,
          metadata: {},
        })
        .returning();

      await auditFromRequest(req, {
        action: AuditActions.DSAR_INTAKE,
        target: { type: "dsar", id: row.id },
        metadata: {
          requestType: body.requestType,
          email: body.email.toLowerCase(),
        },
      });

      // Customer-facing payload: never echo the verification token.
      return res.status(201).json({
        ok: true,
        id: row.id,
        status: row.status,
        message:
          "Your request was received. We will email you within 30 days; identity verification is required before any data is released.",
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
        .where(eq(dsarRequests.id, req.params.id))
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
        .where(eq(dsarRequests.id, req.params.id))
        .limit(1);
      if (!row) return Errors.notFound(res, "DSAR request");

      const [updated] = await db
        .update(dsarRequests)
        .set({
          status: "verified" as DsarStatus,
          verifiedAt: new Date(),
          updatedAt: new Date(),
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

  // ── POST /api/founder/dsar/:id/fan-out ────────────────────────────────
  // Stub — generates JSON+ZIP of every row referencing the email across
  // org databases. Throws "Implement: data fan-out" intentionally.
  app.post("/api/founder/dsar/:id/fan-out", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    try {
      const [row] = await db
        .select()
        .from(dsarRequests)
        .where(eq(dsarRequests.id, req.params.id))
        .limit(1);
      if (!row) return Errors.notFound(res, "DSAR request");
      if (row.requestType !== "access" && row.requestType !== "portability") {
        return Errors.badRequest(res, "Fan-out is only valid for access/portability requests");
      }
      if (row.status !== "verified" && row.status !== "fulfilling") {
        return Errors.badRequest(res, "Request must be verified before fan-out");
      }

      await db
        .update(dsarRequests)
        .set({ status: "fulfilling" as DsarStatus, updatedAt: new Date() })
        .where(eq(dsarRequests.id, row.id));

      await auditFromRequest(req, {
        action: AuditActions.DSAR_FULFILLING,
        target: { type: "dsar", id: row.id },
        metadata: { stage: "fan-out", email: row.email },
      });

      try {
        await runFanOutStub(row.id);
      } catch (stubErr) {
        // Stub always throws — return 501 so ops sees the gap.
        return res.status(501).json({
          error: "NOT_IMPLEMENTED",
          message: (stubErr as Error).message,
          statusCode: 501,
        });
      }
      return res.json({ ok: true });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── POST /api/founder/dsar/:id/erasure ────────────────────────────────
  // Stub — soft-deletes rows referencing the email, preserving audit trail.
  app.post("/api/founder/dsar/:id/erasure", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    try {
      const [row] = await db
        .select()
        .from(dsarRequests)
        .where(eq(dsarRequests.id, req.params.id))
        .limit(1);
      if (!row) return Errors.notFound(res, "DSAR request");
      if (row.requestType !== "erasure") {
        return Errors.badRequest(res, "Erasure is only valid for erasure requests");
      }
      if (row.status !== "verified" && row.status !== "fulfilling") {
        return Errors.badRequest(res, "Request must be verified before erasure");
      }

      await db
        .update(dsarRequests)
        .set({ status: "fulfilling" as DsarStatus, updatedAt: new Date() })
        .where(eq(dsarRequests.id, row.id));

      await auditFromRequest(req, {
        action: AuditActions.DSAR_ERASURE,
        target: { type: "dsar", id: row.id },
        metadata: { stage: "erasure", email: row.email },
      });

      try {
        await runErasureStub(row.id);
      } catch (stubErr) {
        return res.status(501).json({
          error: "NOT_IMPLEMENTED",
          message: (stubErr as Error).message,
          statusCode: 501,
        });
      }
      return res.json({ ok: true });
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
        .where(eq(dsarRequests.id, req.params.id))
        .limit(1);
      if (!row) return Errors.notFound(res, "DSAR request");

      const [updated] = await db
        .update(dsarRequests)
        .set({
          status: "denied" as DsarStatus,
          deniedReason: parsed.data.reason,
          completedAt: new Date(),
          updatedAt: new Date(),
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
