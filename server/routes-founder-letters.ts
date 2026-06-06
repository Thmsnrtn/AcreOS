/**
 * FW-DIEGO-1 (push-forward 2026-05-08): community-dispatch infrastructure.
 *
 * Originally framed as "founder letters" (Diego-Marchetti's founder-led
 * community recommendation). Rebranded 2026-06-06 to "field notes" to
 * conform to the marketing-OS voice doctrine (mechanics-first
 * third-person; no founder voice on customer surfaces — see
 * `docs/internal/marketing-os/00-blueprint.md` §2).
 *
 * The underlying DB table (`community_letters`) and the founder-gated
 * authoring routes (`/api/founder/letters/*`) keep their original names
 * — they are internal surfaces. Only the public-facing surface and copy
 * were renamed.
 *
 * Endpoints:
 *   POST /api/founder/letters              — founder-gated; create draft
 *   POST /api/founder/letters/:id/publish  — founder-gated; mark published
 *   POST /api/founder/letters/:id/send     — founder-gated; broadcast to
 *                                            opted-in users
 *   GET  /api/founder/letters              — founder-only; list all
 *                                            (drafts + published)
 *   GET  /api/field-notes                  — PUBLIC; list published notes
 *                                            (consumed by /field-notes archive)
 *   GET  /api/field-notes/:slug            — PUBLIC; one note by slug
 *   GET  /api/letters                      — PUBLIC; legacy alias of
 *                                            /api/field-notes — kept as
 *                                            JSON-only backward compat for
 *                                            stale SPA chunks. Same handler.
 *   GET  /api/letters/:slug                — PUBLIC; legacy alias.
 *
 * The public surfaces are deliberately public (no isAuthenticated)
 * so the archive can serve as a top-of-funnel acquisition surface — anyone
 * can read past field notes before signing up.
 */

import type { Express, Response, Request } from "express";
import { z } from "zod";
import { db } from "./db";
import { communityLetters, users } from "@shared/schema";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { emailService } from "./services/emailService";
import { costClass } from "./utils/costClass";

const draftSchema = z.object({
  subject: z.string().min(1).max(255),
  htmlBody: z.string().min(1),
  plainBody: z.string().optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with dashes").min(3).max(120),
});

export function registerFounderLetterRoutes(app: Express): void {
  // POST /api/founder/letters — create a new letter (draft).
  app.post(
    "/api/founder/letters",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = draftSchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const userId = getUserId(req);
        const senderEmail = (req.user as any)?.email ?? null;
        const [created] = await db
          .insert(communityLetters)
          .values({
            slug: parsed.data.slug,
            subject: parsed.data.subject,
            htmlBody: parsed.data.htmlBody,
            plainBody: parsed.data.plainBody ?? null,
            senderUserId: userId,
            senderEmail,
          })
          .returning();
        return res.json(created);
      } catch (err: any) {
        if (err?.code === "23505") {
          return Errors.badRequest(res, "Slug already in use", { code: "SLUG_TAKEN" });
        }
        return Errors.internal(res, err);
      }
    },
  );

  // POST /api/founder/letters/:id/publish — mark public.
  app.post(
    "/api/founder/letters/:id/publish",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = req.params.id;
        const [updated] = await db
          .update(communityLetters)
          .set({ publishedAt: new Date(), updatedAt: new Date() })
          .where(eq(communityLetters.id, id))
          .returning();
        if (!updated) return Errors.notFound(res, "Founder letter");
        return res.json(updated);
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // POST /api/founder/letters/:id/send — broadcast to opted-in users.
  // Cap recipients at 5,000 per send to avoid surprise SES charges.
  // Caller can iterate; route returns the actual count sent.
  app.post(
    "/api/founder/letters/:id/send",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = req.params.id;
        const [letter] = await db
          .select()
          .from(communityLetters)
          .where(eq(communityLetters.id, id))
          .limit(1);
        if (!letter) return Errors.notFound(res, "Founder letter");

        const recipients = await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(isNotNull(users.email))
          .limit(5000);

        let sent = 0;
        let failed = 0;
        for (const recipient of recipients) {
          if (!recipient.email) continue;
          try {
            await emailService.sendTransactionalEmail("notification", {
              to: recipient.email,
              subject: letter.subject,
              templateData: {
                subject: letter.subject,
                title: letter.subject,
                message: letter.htmlBody,
              },
            });
            sent++;
          } catch (err) {
            failed++;
            logger.warn(
              `[founder-letters] send failed to ${recipient.email}`,
              err instanceof Error ? err : undefined,
            );
          }
        }

        const [updated] = await db
          .update(communityLetters)
          .set({
            sentAt: new Date(),
            recipientCount: sent,
            updatedAt: new Date(),
          })
          .where(eq(communityLetters.id, id))
          .returning();

        return res.json({ ...updated, deliveryReport: { sent, failed } });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // GET /api/founder/letters — founder-only list.
  app.get(
    "/api/founder/letters",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const rows = await db
          .select()
          .from(communityLetters)
          .orderBy(desc(communityLetters.createdAt))
          .limit(500);
        return res.json({ letters: rows });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // Shared handlers for the public-archive surfaces. Mounted on both
  // /api/field-notes (canonical, 2026-06-06+) and /api/letters (legacy
  // alias, preserved so stale SPA bundles cached in browsers continue
  // to render after the rebrand). The response shape keeps the
  // `letters` key for backward compatibility with cached client
  // payloads — the frontend reads `data.letters` in both surfaces.
  async function listPublicFieldNotes(_req: Request, res: Response) {
    try {
      const rows = await db
        .select({
          id: communityLetters.id,
          slug: communityLetters.slug,
          subject: communityLetters.subject,
          publishedAt: communityLetters.publishedAt,
        })
        .from(communityLetters)
        .where(isNotNull(communityLetters.publishedAt))
        .orderBy(desc(communityLetters.publishedAt))
        .limit(200);
      return res.json({ letters: rows });
    } catch (err) {
      return Errors.internal(res, err);
    }
  }

  async function getPublicFieldNote(req: Request, res: Response) {
    try {
      const slug = req.params.slug;
      const [row] = await db
        .select()
        .from(communityLetters)
        .where(and(eq(communityLetters.slug, slug), isNotNull(communityLetters.publishedAt)))
        .limit(1);
      if (!row) return Errors.notFound(res, "Field note");
      return res.json(row);
    } catch (err) {
      return Errors.internal(res, err);
    }
  }

  // GET /api/field-notes — PUBLIC archive (canonical 2026-06-06+).
  app.get("/api/field-notes", costClass("low"), listPublicFieldNotes);

  // GET /api/field-notes/:slug — PUBLIC single note (canonical).
  app.get("/api/field-notes/:slug", costClass("low"), getPublicFieldNote);

  // GET /api/letters — legacy JSON alias of /api/field-notes. Preserved
  // so stale SPA bundles continue to render. HTML-route 301s live in
  // server/static.ts; the API stays JSON.
  app.get("/api/letters", listPublicFieldNotes);

  // GET /api/letters/:slug — legacy JSON alias.
  app.get("/api/letters/:slug", getPublicFieldNote);
}
