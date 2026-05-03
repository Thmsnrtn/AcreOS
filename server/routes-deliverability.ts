/**
 * Deliverability routes — Eleonora Phase 1 §10 / Week 7-8.
 *
 *   POST /api/org/email-identity/provision   (auth + org)
 *      → generate DKIM keypair, persist with private key encrypted, return
 *        DNS records (DKIM/SPF/DMARC) the founder needs to publish.
 *
 *   POST /api/org/email-identity/verify      (auth + org)
 *      → resolve published DNS records; if all three resolve, register
 *        the domain with SendGrid's domain-authentication API, mark
 *        status=verified.
 *
 *   GET  /api/org/email-identity              (auth + org)
 *      → return the current identity + status (for the org settings UI).
 *
 *   GET  /u/:token                            (public)
 *      → one-click List-Unsubscribe handler. Resolves the token, writes
 *        to email_suppressions, marks the token used, redirects to a
 *        friendly confirmation page.
 *
 *   GET  /api/founder/deliverability          (founder-only)
 *      → per-org bounce/complaint/score table for the deliverability
 *        dashboard.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { isAuthenticated, getOrCreateOrg, requireFounder } from "./auth";
import { AuthenticatedRequest, getOrganizationId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  provisionIdentity,
  verifyIdentity,
} from "./services/orgEmailIdentity";
import {
  resolveToken,
  markTokenUsed,
} from "./services/unsubscribeTokens";
import { suppress } from "./services/emailSuppressions";
import { db } from "./db";
import {
  orgEmailIdentities,
  emailReputationSnapshot,
  organizations,
  emailEvents,
  emailSuppressions,
} from "@shared/schema";
import { eq, sql, gte, and } from "drizzle-orm";

// ── Schemas ─────────────────────────────────────────────────────────────────

const provisionSchema = z.object({
  fromAddress: z.string().email(),
  dkimSelector: z.string().min(1).max(63).regex(/^[a-z0-9-]+$/i).optional(),
});

const verifySchema = z.object({
  identityId: z.number().int().positive(),
});

// ── Per-org rolling reputation calculator ──────────────────────────────────

/**
 * Compute and snapshot a single org's rolling deliverability score over
 * the last `windowDays` days. Pulled out into its own helper so the
 * founder dashboard can refresh on demand and a nightly job can call it
 * for every org.
 */
export async function computeReputation(
  organizationId: number,
  windowDays = 30,
): Promise<{
  sentCount: number;
  bounceCount: number;
  complaintCount: number;
  bounceRate: number;
  complaintRate: number;
  deliverabilityScore: number;
  healthStatus: "healthy" | "at_risk" | "critical";
}> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // We don't currently have organizationId on email_events. To approximate
  // per-org volume, we count rows in email_suppressions that were created
  // for this org and treat the email_events table as a global-volume
  // backstop. This is the right approximation until SendGrid is wired to
  // pass a custom-arg organization_id on every send.
  const sentRows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(emailEvents)
    .where(and(eq(emailEvents.event, "delivered"), gte(emailEvents.createdAt, since)));
  const bounceRows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(emailSuppressions)
    .where(
      and(
        eq(emailSuppressions.organizationId, organizationId),
        gte(emailSuppressions.suppressedAt, since),
        eq(emailSuppressions.source, "bounce"),
      ),
    );
  const complaintRows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(emailSuppressions)
    .where(
      and(
        eq(emailSuppressions.organizationId, organizationId),
        gte(emailSuppressions.suppressedAt, since),
        eq(emailSuppressions.source, "spam"),
      ),
    );

  const sentCount = sentRows[0]?.c ?? 0;
  const bounceCount = bounceRows[0]?.c ?? 0;
  const complaintCount = complaintRows[0]?.c ?? 0;
  const bounceRate = sentCount > 0 ? bounceCount / sentCount : 0;
  const complaintRate = sentCount > 0 ? complaintCount / sentCount : 0;

  // Score model: start at 100, deduct heavily for complaint rate (each
  // 0.1% costs 20 points) and moderately for bounce rate (each 1% costs
  // 10 points). M3AAWG / SendGrid-published thresholds: complaints <0.1%,
  // bounces <2% — anything beyond is "at risk".
  const score = Math.max(
    0,
    Math.round(100 - complaintRate * 20000 - bounceRate * 1000),
  );
  const healthStatus: "healthy" | "at_risk" | "critical" =
    score >= 90 ? "healthy" : score >= 70 ? "at_risk" : "critical";

  await db.insert(emailReputationSnapshot).values({
    organizationId,
    windowDays,
    sentCount,
    bounceCount,
    complaintCount,
    bounceRate: bounceRate.toFixed(4),
    complaintRate: complaintRate.toFixed(4),
    deliverabilityScore: score,
    healthStatus,
  });

  return {
    sentCount,
    bounceCount,
    complaintCount,
    bounceRate,
    complaintRate,
    deliverabilityScore: score,
    healthStatus,
  };
}

// ── Route registration ─────────────────────────────────────────────────────

export function registerDeliverabilityRoutes(app: Express): void {
  // POST /api/org/email-identity/provision
  app.post(
    "/api/org/email-identity/provision",
    isAuthenticated,
    getOrCreateOrg,
    async (req: Request, res: Response) => {
      const r = req as AuthenticatedRequest;
      const parsed = provisionSchema.safeParse(r.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.flatten());
      }
      try {
        const result = await provisionIdentity({
          organizationId: getOrganizationId(r),
          fromAddress: parsed.data.fromAddress,
          dkimSelector: parsed.data.dkimSelector,
        });
        res.json(result);
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // POST /api/org/email-identity/verify
  app.post(
    "/api/org/email-identity/verify",
    isAuthenticated,
    getOrCreateOrg,
    async (req: Request, res: Response) => {
      const r = req as AuthenticatedRequest;
      const parsed = verifySchema.safeParse(r.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.flatten());
      }
      try {
        // Confirm the identity belongs to the caller's org.
        const rows = await db
          .select({ orgId: orgEmailIdentities.organizationId })
          .from(orgEmailIdentities)
          .where(eq(orgEmailIdentities.id, parsed.data.identityId))
          .limit(1);
        if (rows.length === 0) return Errors.notFound(res, "Email identity");
        if (rows[0].orgId !== getOrganizationId(r)) return Errors.forbidden(res);
        const result = await verifyIdentity(parsed.data.identityId);
        res.json(result);
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // GET /api/org/email-identity
  app.get(
    "/api/org/email-identity",
    isAuthenticated,
    getOrCreateOrg,
    async (req: Request, res: Response) => {
      const r = req as AuthenticatedRequest;
      const rows = await db
        .select({
          id: orgEmailIdentities.id,
          fromAddress: orgEmailIdentities.fromAddress,
          dkimDomain: orgEmailIdentities.dkimDomain,
          dkimSelector: orgEmailIdentities.dkimSelector,
          spfRecord: orgEmailIdentities.spfRecord,
          dmarcRecord: orgEmailIdentities.dmarcRecord,
          dkimPublicKey: orgEmailIdentities.dkimPublicKey,
          status: orgEmailIdentities.status,
          verifiedAt: orgEmailIdentities.verifiedAt,
          verificationError: orgEmailIdentities.verificationError,
        })
        .from(orgEmailIdentities)
        .where(eq(orgEmailIdentities.organizationId, getOrganizationId(r)))
        .limit(1);
      res.json({ identity: rows[0] ?? null });
    },
  );

  // GET /u/:token  — public one-click List-Unsubscribe handler.
  // Mounted at the root because RFC 8058 expects a short URL that fits in
  // a header. No auth — the token IS the auth.
  app.get("/u/:token", async (req: Request, res: Response) => {
    const token = String(req.params.token || "");
    const resolved = await resolveToken(token);
    if (!resolved) {
      // Friendly "already unsubscribed or invalid link" page.
      return res
        .status(404)
        .type("html")
        .send(renderUnsubscribePage({
          ok: false,
          message: "This unsubscribe link is invalid or has expired.",
        }));
    }
    if (!resolved.alreadyUsed) {
      await suppress(resolved.email, "one_click_unsubscribe", "unsubscribe", {
        bounceCategory: "unsubscribe",
        organizationId: resolved.organizationId ?? undefined,
      });
      await markTokenUsed(token);
      logger.info("[deliverability] one-click unsubscribe", {
        metadata: { email: resolved.email, organizationId: resolved.organizationId },
      });
    }
    res
      .status(200)
      .type("html")
      .send(renderUnsubscribePage({
        ok: true,
        message: `${resolved.email} has been unsubscribed. You'll no longer receive marketing emails from us.`,
      }));
  });

  // POST /u/:token  — RFC 8058 one-click POST handler. Identical effect
  // to GET; mailbox providers POST to confirm the user clicked the
  // header button rather than a footer link.
  app.post("/u/:token", async (req: Request, res: Response) => {
    const token = String(req.params.token || "");
    const resolved = await resolveToken(token);
    if (!resolved) {
      return Errors.notFound(res, "Unsubscribe token");
    }
    if (!resolved.alreadyUsed) {
      await suppress(resolved.email, "one_click_unsubscribe_post", "unsubscribe", {
        bounceCategory: "unsubscribe",
        organizationId: resolved.organizationId ?? undefined,
      });
      await markTokenUsed(token);
    }
    res.status(200).json({ ok: true });
  });

  // GET /api/founder/deliverability
  app.get(
    "/api/founder/deliverability",
    isAuthenticated,
    requireFounder,
    async (_req: Request, res: Response) => {
      try {
        const orgs = await db
          .select({ id: organizations.id, name: organizations.name })
          .from(organizations);
        const rows = await Promise.all(
          orgs.map(async (o) => {
            const rep = await computeReputation(o.id, 30);
            return {
              organizationId: o.id,
              organizationName: o.name,
              ...rep,
              recommendedAction: recommendedAction(rep),
            };
          }),
        );
        res.json({ orgs: rows, computedAt: new Date().toISOString() });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}

function recommendedAction(rep: {
  healthStatus: "healthy" | "at_risk" | "critical";
  bounceRate: number;
  complaintRate: number;
}): string {
  if (rep.healthStatus === "critical") {
    if (rep.complaintRate > 0.001) {
      return "Pause all campaigns. Investigate complaint sources before resuming.";
    }
    return "Pause campaigns. Run list hygiene + reduce send volume.";
  }
  if (rep.healthStatus === "at_risk") {
    if (rep.bounceRate > 0.02) return "Run list-cleaning import; reduce send volume 50%.";
    if (rep.complaintRate > 0.0005) return "Review opt-in flow + unsubscribe friction.";
    return "Monitor — score is recoverable with normal hygiene.";
  }
  return "No action — sender reputation is healthy.";
}

function renderUnsubscribePage(opts: { ok: boolean; message: string }): string {
  const color = opts.ok ? "#16a34a" : "#dc2626";
  const icon = opts.ok ? "✓" : "!";
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; background:#fafafa; color:#18181b; margin:0; }
  .card { max-width:480px; margin:80px auto; background:#fff; border-radius:12px; padding:48px 40px; box-shadow:0 1px 3px rgba(0,0,0,0.05); text-align:center; }
  .icon { font-size:48px; color:${color}; margin-bottom:16px; }
  h1 { margin:0 0 12px; font-size:22px; }
  p { margin:0; color:#6b7280; line-height:1.6; }
</style>
</head><body>
<div class="card">
  <div class="icon">${icon}</div>
  <h1>${opts.ok ? "Unsubscribed" : "Link Invalid"}</h1>
  <p>${escapeHtml(opts.message)}</p>
</div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
