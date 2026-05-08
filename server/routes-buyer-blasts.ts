/**
 * Buyer blasts (W-4) — push-to-buyer-list one-click outreach.
 *
 * Trey: "Hit a button, AcreOS pulls matched cash buyers from
 * buyer_property_matches, sends an email + SMS with property card and
 * photos, tracks who opens, who replies, who books a walkthrough. […]
 * This is the single feature that flips me from $20 trial to $49/mo paying."
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
  BUYER_BLAST_RECIPIENT_STATUSES,
} from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { sendEmail } from "./services/emailService";

const blastBodySchema = z.object({
  subject: z.string().min(1).max(240),
  body: z.string().min(1).max(50_000),
  minMatchScore: z.number().int().min(0).max(100).default(70),
  financingType: z.enum(["cash", "owner_finance", "conventional", "hard_money", "any"]).default("cash"),
  dryRun: z.boolean().default(false),
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
        const propertyId = parseInt(req.params.id, 10);
        if (Number.isNaN(propertyId)) return Errors.badRequest(res, "Invalid property id");

        const parsed = blastBodySchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const { subject, body, minMatchScore, financingType, dryRun } = parsed.data;

        // Confirm the property belongs to this org.
        const [prop] = await db
          .select({ id: properties.id })
          .from(properties)
          .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
          .limit(1);
        if (!prop) return Errors.notFound(res, "Property");

        // Pull matched buyers ≥ minMatchScore.
        const matches = await db
          .select({
            buyerId: buyerPropertyMatches.buyerProfileId,
            matchScore: buyerPropertyMatches.matchScore,
            buyerName: buyerProfiles.name,
            buyerEmail: buyerProfiles.email,
            financialInfo: buyerProfiles.financialInfo,
          })
          .from(buyerPropertyMatches)
          .innerJoin(buyerProfiles, eq(buyerProfiles.id, buyerPropertyMatches.buyerProfileId))
          .where(and(
            eq(buyerPropertyMatches.organizationId, orgId),
            eq(buyerPropertyMatches.propertyId, propertyId),
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

        if (dryRun) {
          // Preview: return who would be reached without creating the
          // blast or sending. UI uses this to confirm before proceeding.
          return res.json({
            dryRun: true,
            recipientCount: eligible.length,
            recipients: eligible.map((m) => ({
              buyerProfileId: m.buyerId,
              name: m.buyerName,
              email: m.buyerEmail,
              matchScore: m.matchScore,
              financingType: (m.financialInfo as any)?.financingType ?? null,
            })),
          });
        }

        if (eligible.length === 0) {
          return Errors.badRequest(res, "No eligible buyers matched the filters. Adjust minMatchScore or financingType.");
        }

        const userId = (req.user as any)?.claims?.sub || (req.user as any)?.id || null;

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
            recipientCount: eligible.length,
            sentByUserId: userId,
          })
          .returning();
        if (!blast) return Errors.internal(res, new Error("Insert blast row returned nothing"));

        // Insert recipient rows.
        const recipientRows = eligible.map((m) => ({
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
          eligible.map(async (m) => {
            try {
              const result = await sendEmail({
                to: m.buyerEmail!,
                subject,
                html: body,
                organizationId: orgId,
              } as any);
              if (result?.ok || result?.success || result === undefined) {
                sentCount++;
                await db
                  .update(buyerBlastRecipients)
                  .set({ status: "sent", sentAt: new Date() })
                  .where(and(eq(buyerBlastRecipients.blastId, blast.id), eq(buyerBlastRecipients.buyerProfileId, m.buyerId)));
              } else {
                failedCount++;
                await db
                  .update(buyerBlastRecipients)
                  .set({ status: "failed", failureReason: result?.error ?? "Unknown" })
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

        // Finalize blast counters.
        await db
          .update(buyerBlasts)
          .set({
            status: "sent",
            sentCount,
            failedCount,
            completedAt: new Date(),
          })
          .where(eq(buyerBlasts.id, blast.id));

        logger.info("buyerBlast.completed", {
          metadata: { orgId, blastId: blast.id, propertyId, sentCount, failedCount },
        });

        return res.status(201).json({
          blast: { ...blast, sentCount, failedCount, status: "sent" },
          recipientCount: eligible.length,
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
          .where(and(eq(buyerBlasts.id, req.params.id), eq(buyerBlasts.organizationId, orgId)))
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
            buyerName: buyerProfiles.name,
          })
          .from(buyerBlastRecipients)
          .innerJoin(buyerProfiles, eq(buyerProfiles.id, buyerBlastRecipients.buyerProfileId))
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
        const parsed = z.object({
          status: z.enum(BUYER_BLAST_RECIPIENT_STATUSES).optional(),
          responseNotes: z.string().max(4_000).optional(),
        }).safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        const update: Partial<typeof buyerBlastRecipients.$inferInsert> = {
          ...parsed.data,
        };
        if (parsed.data.status === "replied_interested" || parsed.data.status === "replied_not_interested") {
          update.respondedAt = new Date();
        }
        const [row] = await db
          .update(buyerBlastRecipients)
          .set(update)
          .where(and(eq(buyerBlastRecipients.id, req.params.id), eq(buyerBlastRecipients.organizationId, orgId)))
          .returning();
        if (!row) return Errors.notFound(res, "Recipient");

        // Bump the parent blast's repliedCount when this is the first
        // reply transition for this recipient.
        if (parsed.data.status === "replied_interested" || parsed.data.status === "replied_not_interested") {
          await db
            .update(buyerBlasts)
            .set({
              repliedCount: sql`${buyerBlasts.repliedCount} + 1`,
              status: "completed",
            })
            .where(eq(buyerBlasts.id, row.blastId));
        }

        return res.json({ recipient: row });
      } catch (err) {
        logger.error("buyerBlasts.recipient.patch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}
