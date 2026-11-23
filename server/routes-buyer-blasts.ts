/**
 * Buyer blasts (W-4) — push-to-buyer-list one-click outreach.
 *
 * Trey: "Hit a button, AcreOS pulls matched cash buyers from
 * buyer_property_matches, sends an email + SMS with property card and
 * photos, tracks who opens, who replies, who books a walkthrough. […]
 * This is the single feature that flips me from $20 trial to $49/mo paying."
 *
 * What it actually does (2026-10-20): EMAIL ONLY, on the org's own sending
 * identity. There is no SMS lane and no open tracking; recipient statuses
 * are logged by hand (PATCH below).
 *
 * Endpoints:
 *   POST /api/properties/:id/blast-buyers
 *     Body: { subject, body, minMatchScore?, financingType?, dryRun? }
 *     Pulls eligible buyers (default: financingType='cash' OR no filter,
 *     matchScore ≥ minMatchScore), creates blast row + recipient rows,
 *     fires emailService.sendEmail per recipient, updates counters.
 *
 *   GET  /api/buyer-blasts                 — list, optional ?propertyId=
 *   GET  /api/buyer-blasts/:id             — detail with recipients
 *   PATCH /api/buyer-blasts/recipients/:id — mark response
 */

import { offerabilityRefusal } from "./services/listability";
import { leadNotOptedOutSql } from "./services/leadContactability";
import type { Express, Response } from "express";
import { z } from "zod";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import {
  buyerBlasts,
  buyerBlastRecipients,
  buyerProfiles,
  buyerPropertyMatches,
  properties,
  leads,
} from "@shared/schema";
import { inArray } from "drizzle-orm";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import { Errors } from "./utils/errors";
import { hasWritableValues } from "./utils/patch";
import { logger } from "./utils/logger";
import { sendEmail, counterpartyEmailIdentityStatus } from "./services/emailService";
import { clock } from "./utils/clock";
import { routeParam } from "./utils/routeParams";
import { refuseRedeemableDeedSpend } from "./services/tax/landExit";
import { offerComplianceGate, sendComplianceRefusal } from "./services/wholesale/offerCompliance";
import { recipientResponseSchema, recordBlastRecipientResponse } from "./services/wholesale/buyerResponse";

const blastBodySchema = z.object({
  subject: z.string().min(1).max(240),
  body: z.string().min(1).max(50_000),
  minMatchScore: z.number().int().min(0).max(100).default(70),
  financingType: z.enum(["cash", "owner_finance", "conventional", "hard_money", "any"]).default("cash"),
  dryRun: z.boolean().default(false),
  // A state-rule WARN for a property under an assignable contract needs the
  // operator's recorded acknowledgement before a real send (Leg 3).
  ackComplianceWarning: z.boolean().default(false),
});

export function registerBuyerBlastRoutes(app: Express): void {
  const ownerOrAdmin = requireRole(["owner", "admin"]);

  // ── POST /api/properties/:id/blast-buyers ────────────────────────────────
  app.post(
    "/api/properties/:id/blast-buyers",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const propertyId = parseInt(routeParam(req.params.id), 10);
        if (Number.isNaN(propertyId)) return Errors.badRequest(res, "Invalid property id");

        const parsed = blastBodySchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const { subject, body, minMatchScore, financingType, dryRun, ackComplianceWarning } = parsed.data;

        // Confirm the property belongs to this org.
        const [prop] = await db
          .select({ id: properties.id, status: properties.status, state: properties.state })
          .from(properties)
          .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
          .limit(1);
        if (!prop) return Errors.notFound(res, "Property");
        // A blast offers the property to buyers: it must be held, and a sold
        // parcel must not be re-offered from stale matches (DEFECT-0174).
        const notOfferable = offerabilityRefusal(prop.status);
        if (notOfferable) return Errors.badRequest(res, notOfferable);
        // V-Tax-1 T4b: nor a parcel still held by a tax position (not yet marketable in AcreOS).
        if (!(await refuseRedeemableDeedSpend(res, orgId, propertyId, "A buyer blast"))) return;

        // Pull matched buyers ≥ minMatchScore.
        const matches = await db
          .select({
            buyerId: buyerPropertyMatches.buyerProfileId,
            matchScore: buyerPropertyMatches.matchScore,
            buyerFirstName: leads.firstName,
            buyerLastName: leads.lastName,
            buyerEmail: leads.email,
            financialInfo: buyerProfiles.financialInfo,
          })
          .from(buyerPropertyMatches)
          .innerJoin(buyerProfiles, and(eq(buyerProfiles.id, buyerPropertyMatches.buyerProfileId), eq(buyerProfiles.organizationId, orgId)))
          // A profile's leadId is caller-supplied: join only the org's own
          // lead, or another tenant's buyer is named and emailed (DEFECT-0179).
          .innerJoin(leads, and(eq(leads.id, buyerProfiles.leadId), eq(leads.organizationId, orgId)))
          .where(and(
            eq(buyerPropertyMatches.organizationId, orgId),
            eq(buyerPropertyMatches.propertyId, propertyId),
            // An inactive buyer profile is not an audience (DEFECT-0174).
            eq(buyerProfiles.isActive, true),
            // A buyer who said stop (STOP reply, revocation, operator
            // do-not-contact) is not an audience on any channel.
            leadNotOptedOutSql(),
            sql`${buyerPropertyMatches.matchScore} >= ${minMatchScore}`,
          ))
          .orderBy(desc(buyerPropertyMatches.matchScore))
          .limit(500);

        const eligible = matches.filter((m) => {
          if (!m.buyerEmail) return false;
          if (financingType === "any") return true;
          const ft = (m.financialInfo as any)?.financingType;
          return ft === financingType;
        });

        // ── Trey 2026-05-27: cadence guardrails ────────────────────────────
        // If a buyer received >2 blasts in the last 7 days, suppress them
        // from this one. Trey's framing: "Buyers go inactive when over-
        // blasted. Two blasts in a week is the ceiling — past that, you're
        // training them to filter your emails into trash."
        const MAX_BLASTS_PER_7_DAYS = 2;
        const sevenDaysAgo = new Date(clock.nowMs() - 7 * 24 * 60 * 60 * 1000);
        const buyerIds = eligible.map((m) => m.buyerId);
        const recentCounts = buyerIds.length === 0
          ? []
          : await db
              .select({
                buyerProfileId: buyerBlastRecipients.buyerProfileId,
                cnt: sql<number>`count(*)::int`,
              })
              .from(buyerBlastRecipients)
              .where(and(
                eq(buyerBlastRecipients.organizationId, orgId),
                inArray(buyerBlastRecipients.buyerProfileId, buyerIds),
                sql`${buyerBlastRecipients.sentAt} >= ${sevenDaysAgo.toISOString()}`,
                inArray(buyerBlastRecipients.status, [
                  "sent",
                  "delivered",
                  "opened",
                  "replied_interested",
                  "replied_not_interested",
                ]),
              ))
              .groupBy(buyerBlastRecipients.buyerProfileId);
        const cadenceMap = new Map<number, number>(
          recentCounts.map((r) => [r.buyerProfileId, Number(r.cnt) || 0]),
        );
        const suppressed = eligible.filter(
          (m) => (cadenceMap.get(m.buyerId) ?? 0) >= MAX_BLASTS_PER_7_DAYS,
        );
        const sendable = eligible.filter(
          (m) => (cadenceMap.get(m.buyerId) ?? 0) < MAX_BLASTS_PER_7_DAYS,
        );

        // Assignment compliance (Leg 3): offering a property held only under an
        // assignable contract is what a state's advertising restriction governs.
        // A block refuses even the preview; a warn is shown on the preview and
        // needs a recorded acknowledgement before a real send.
        const compliance = await offerComplianceGate({
          organizationId: orgId,
          userId: req.user?.id ?? null,
          property: { id: prop.id, status: prop.status, state: prop.state },
          surface: "buyer_blast",
          acknowledged: ackComplianceWarning,
          previewOnly: dryRun,
        });
        if (!compliance.ok) return sendComplianceRefusal(res, compliance.status, compliance.body);

        // Sending-identity preflight (W-DEF-1): a blast is counterparty
        // mail — it goes out under the org's OWN identity or not at all
        // (founder decision 2026-07-17, enforced per-message by the
        // transport). Ask the SAME resolver the transport asks, before any
        // blast row exists, so an org with no identity is told up front —
        // on the preview, where they compose — instead of learning it from
        // a per-recipient failure after the blast finalized as "sent" with
        // zero delivered. Mirrors the campaign send's pre-flight
        // (routes-campaigns.ts, same reason code).
        const identity = await counterpartyEmailIdentityStatus(orgId);
        const identityWarning = identity.canSend
          ? null
          : "Nothing can be sent yet: buyer blasts go out under your own sending identity, " +
            "and this organization has no connected email account or verified sending domain yet. " +
            "Connect your email account or verify your sending domain (Settings → Connections), " +
            "then send again — AcreOS does not email your buyers from its own address.";

        if (dryRun) {
          // Preview: return who would be reached without creating the
          // blast or sending. UI uses this to confirm before proceeding.
          // Trey 2026-05-27: also report suppressed (over-blasted) buyers
          // so the operator sees the cadence-guardrail effect before send.
          return res.json({
            dryRun: true,
            compliance: compliance.applies ? compliance.warning : null,
            sendingIdentityWarning: identityWarning,
            recipientCount: sendable.length,
            suppressedCount: suppressed.length,
            suppressionReason: suppressed.length > 0
              ? `${suppressed.length} buyer${suppressed.length === 1 ? "" : "s"} received ≥${MAX_BLASTS_PER_7_DAYS} blasts in the last 7 days and were suppressed to avoid blast fatigue.`
              : null,
            recipients: sendable.map((m) => ({
              buyerProfileId: m.buyerId,
              name: `${m.buyerFirstName} ${m.buyerLastName}`.trim(),
              email: m.buyerEmail,
              matchScore: m.matchScore,
              financingType: (m.financialInfo as any)?.financingType ?? null,
            })),
            suppressed: suppressed.map((m) => ({
              buyerProfileId: m.buyerId,
              name: `${m.buyerFirstName} ${m.buyerLastName}`.trim(),
              email: m.buyerEmail,
              recentBlastCount: cadenceMap.get(m.buyerId) ?? 0,
            })),
          });
        }

        if (!identity.canSend) {
          return Errors.badRequest(res, identityWarning!, {
            reason: "no_counterparty_email_identity",
            sent: 0,
          });
        }

        if (sendable.length === 0) {
          if (eligible.length > 0 && suppressed.length === eligible.length) {
            return Errors.badRequest(
              res,
              `All ${eligible.length} matched buyers were suppressed: each received ≥${MAX_BLASTS_PER_7_DAYS} blasts in the last 7 days. Wait for the cadence window to roll off, broaden the filter, or grow the buyer list.`,
            );
          }
          return Errors.badRequest(res, "No eligible buyers matched the filters. Adjust minMatchScore or financingType.");
        }

        const userId = req.user?.id || req.user?.id || null;

        // Insert the blast row.
        const [blast] = await db
          .insert(buyerBlasts)
          .values({
            organizationId: orgId,
            propertyId,
            subject,
            bodySnapshot: body,
            channel: "email",
            status: "queued",
            recipientCount: sendable.length,
            sentByUserId: userId,
          })
          .returning();
        if (!blast) return Errors.internal(res, new Error("Insert blast row returned nothing"));

        // Insert recipient rows.
        const recipientRows = sendable.map((m) => ({
          organizationId: orgId,
          blastId: blast.id,
          buyerProfileId: m.buyerId,
          matchScore: m.matchScore ?? null,
          email: m.buyerEmail,
          status: "queued" as const,
        }));
        await db.insert(buyerBlastRecipients).values(recipientRows);

        // Fire sends in parallel. Each emailService.sendEmail is best-
        // effort — we capture per-recipient outcome on the row and
        // summarize on the blast.
        let sentCount = 0;
        let failedCount = 0;
        await Promise.all(
          sendable.map(async (m) => {
            try {
              const result = await sendEmail({
                to: m.buyerEmail!,
                subject,
                html: body,
                organizationId: orgId,
                // Deal mail: blast to the customer's buyer list — org
                // identity required.
                purpose: 'counterparty',
              } as any);
              // Only the transport's own `success: true` is a send. A result
              // of `undefined` was counted sent, stamped `sent` on the
              // recipient row, and counted toward that buyer's cadence cap.
              if (result?.success === true) {
                sentCount++;
                await db
                  .update(buyerBlastRecipients)
                  .set({ status: "sent", sentAt: clock.now() })
                  .where(and(eq(buyerBlastRecipients.blastId, blast.id), eq(buyerBlastRecipients.buyerProfileId, m.buyerId)));
              } else {
                failedCount++;
                await db
                  .update(buyerBlastRecipients)
                  .set({ status: "failed", failureReason: result?.error ?? "The email service returned no send result" })
                  .where(and(eq(buyerBlastRecipients.blastId, blast.id), eq(buyerBlastRecipients.buyerProfileId, m.buyerId)));
              }
            } catch (sendErr: any) {
              failedCount++;
              await db
                .update(buyerBlastRecipients)
                .set({ status: "failed", failureReason: sendErr?.message ?? "Send threw" })
                .where(and(eq(buyerBlastRecipients.blastId, blast.id), eq(buyerBlastRecipients.buyerProfileId, m.buyerId)));
            }
          }),
        );

        // Finalize blast counters. The status must tell the truth about
        // the outcome (W-DEF-1): a blast where every send failed and zero
        // mail went out is "failed", never "sent" — the walk found a blast
        // finalized "sent" at sentCount 0 / failedCount 1, and the honest
        // numbers lived only one level down on the recipient rows. A
        // partial blast (some sent, some failed) stays "sent": mail did go
        // out, and failedCount carries the rest of the truth.
        const finalStatus = sentCount === 0 && failedCount > 0 ? "failed" : "sent";
        await db
          .update(buyerBlasts)
          .set({
            status: finalStatus,
            sentCount,
            failedCount,
            completedAt: clock.now(),
          })
          .where(eq(buyerBlasts.id, blast.id));

        logger.info("buyerBlast.completed", {
          metadata: {
            orgId,
            blastId: blast.id,
            propertyId,
            status: finalStatus,
            sentCount,
            failedCount,
            suppressedCount: suppressed.length,
          },
        });

        return res.status(201).json({
          blast: { ...blast, sentCount, failedCount, status: finalStatus },
          recipientCount: sendable.length,
          suppressedCount: suppressed.length,
          suppressionReason: suppressed.length > 0
            ? `${suppressed.length} buyer${suppressed.length === 1 ? "" : "s"} suppressed by cadence guardrail (>${MAX_BLASTS_PER_7_DAYS - 1} blasts in 7 days).`
            : null,
        });
      } catch (err) {
        logger.error("buyerBlast.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── GET /api/buyer-blasts ────────────────────────────────────────────────
  app.get(
    "/api/buyer-blasts",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const propertyId = req.query.propertyId
          ? parseInt(req.query.propertyId as string, 10)
          : undefined;
        const conds = [eq(buyerBlasts.organizationId, orgId)];
        if (propertyId && !Number.isNaN(propertyId)) {
          conds.push(eq(buyerBlasts.propertyId, propertyId));
        }
        const rows = await db
          .select()
          .from(buyerBlasts)
          .where(and(...conds))
          .orderBy(desc(buyerBlasts.createdAt))
          .limit(200);
        return res.json({ blasts: rows });
      } catch (err) {
        logger.error("buyerBlasts.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── GET /api/buyer-blasts/:id ────────────────────────────────────────────
  app.get(
    "/api/buyer-blasts/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const [blast] = await db
          .select()
          .from(buyerBlasts)
          .where(and(eq(buyerBlasts.id, routeParam(req.params.id)), eq(buyerBlasts.organizationId, orgId)))
          .limit(1);
        if (!blast) return Errors.notFound(res, "Blast");

        const recipients = await db
          .select({
            id: buyerBlastRecipients.id,
            buyerProfileId: buyerBlastRecipients.buyerProfileId,
            email: buyerBlastRecipients.email,
            matchScore: buyerBlastRecipients.matchScore,
            status: buyerBlastRecipients.status,
            sentAt: buyerBlastRecipients.sentAt,
            respondedAt: buyerBlastRecipients.respondedAt,
            responseNotes: buyerBlastRecipients.responseNotes,
            failureReason: buyerBlastRecipients.failureReason,
            buyerFirstName: leads.firstName,
            buyerLastName: leads.lastName,
          })
          .from(buyerBlastRecipients)
          .innerJoin(buyerProfiles, and(eq(buyerProfiles.id, buyerBlastRecipients.buyerProfileId), eq(buyerProfiles.organizationId, orgId)))
          .innerJoin(leads, and(eq(leads.id, buyerProfiles.leadId), eq(leads.organizationId, orgId)))
          .where(eq(buyerBlastRecipients.blastId, blast.id))
          .orderBy(asc(buyerBlastRecipients.sentAt));

        return res.json({ blast, recipients });
      } catch (err) {
        logger.error("buyerBlasts.detail failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── PATCH /api/buyer-blasts/recipients/:id ──────────────────────────────
  // Mark recipient's response. Wholesaler logs "interested" / "not interested"
  // when a buyer replies via reply-to email or a phone call.
  app.patch(
    "/api/buyer-blasts/recipients/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = recipientResponseSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        // Both schema fields are optional, so `{}` parses clean and reaches
        // here with nothing to set. Unlike its sibling routes this patch has
        // no unconditional `updatedAt`, so Drizzle would render
        // `set  where …` — a Postgres syntax error answered as a 500 about
        // SQL grammar. An empty PATCH body is the client's mistake; say so.
        if (!hasWritableValues({ ...parsed.data })) {
          return Errors.badRequest(res, "No fields to update");
        }
        // The write (and the parent blast's repliedCount bump) is the shared
        // service — the Pax record_buyer_blast_response tool calls the same one.
        const row = await recordBlastRecipientResponse(orgId, routeParam(req.params.id), parsed.data);
        if (!row) return Errors.notFound(res, "Recipient");

        return res.json({ recipient: row });
      } catch (err) {
        logger.error("buyerBlasts.recipient.patch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}
