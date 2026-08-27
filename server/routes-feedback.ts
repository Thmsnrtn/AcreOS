/**
 * Public feedback / support / question submissions.
 *
 * Replaces the dead `thomas@acreos.io` mailto links across landing
 * surfaces with a structured form that lands in /founder/feedback.
 *
 * Routes:
 *   POST   /api/feedback                — PUBLIC; rate-limited per IP
 *   GET    /api/founder/feedback        — founder-only; paginated list
 *   PATCH  /api/founder/feedback/:id    — founder-only; update status
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { feedbackSubmissions } from "@shared/schema";
import { isAuthenticated, requireFounder } from "./auth";
import { createRateLimiter } from "./middleware/rateLimit";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

// The FULL set the schema declares (shared/schema.ts feedbackSubmissions
// comment). Until 2026-08-27 this enum held only the last three — but the
// in-app feedback button (feedback-button.tsx) sends bug/feature_request/
// confusion/other, written against a DEAD twin of this route: every
// submission from that button was 400ing in production.
const CATEGORIES = ["support", "feedback", "question", "bug", "feature_request", "confusion", "other"] as const;
const STATUSES = ["new", "read", "replied", "archived"] as const;

const submitSchema = z.object({
  category: z.enum(CATEGORIES),
  name: z.string().trim().max(120).optional(),
  email: z
    .string()
    .trim()
    .email("Invalid email")
    .max(254)
    .optional()
    .or(z.literal("")),
  message: z.string().trim().min(1, "Message is required").max(5000),
  source: z.string().trim().max(80).optional(),
  allowFollowUp: z.boolean().optional(),
});

const updateSchema = z.object({
  status: z.enum(STATUSES),
});

// Per-IP rate limiter: 5 submissions / hour.
// IP-based (no auth) so we use createRateLimiter directly.
const feedbackSubmitLimiter = createRateLimiter(
  { maxRequests: 5, windowMs: 60 * 60 * 1000 },
  (req: Request) => `feedback:${req.ip || req.socket.remoteAddress || "unknown"}`,
);

export function registerFeedbackRoutes(app: Express): void {
  // ── PUBLIC: POST /api/feedback ──────────────────────────────────────────
  app.post(
    "/api/feedback",
    feedbackSubmitLimiter,
    async (req: Request, res: Response) => {
      try {
        const parsed = submitSchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const { category, name, email, message, source, allowFollowUp } = parsed.data;

        // Identity captured WHEN PRESENT, never required — this route is public
        // by design (landing surfaces; see the file header) and the limiter is
        // the abuse control. Never trust a body-supplied identity here.
        const authedUser = (req as AuthenticatedRequest).user;
        const userId = authedUser?.id ?? null;
        const userEmail = authedUser?.email ?? null;
        const pageUrl = (req.headers.referer as string | undefined)?.slice(0, 500) ?? null;

        const ipAddress =
          (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
          req.ip ||
          req.socket.remoteAddress ||
          null;
        const userAgent =
          (req.headers["user-agent"] as string | undefined)?.slice(0, 500) ??
          null;

        const [row] = await db
          .insert(feedbackSubmissions)
          .values({
            category,
            name: name || null,
            email: email ? email : null,
            message,
            source: source || null,
            userId,
            userEmail,
            pageUrl,
            ...(allowFollowUp === undefined ? {} : { allowFollowUp }),
            ipAddress,
            userAgent,
          })
          .returning({ id: feedbackSubmissions.id });

        // Founder notification, ported 2026-08-27 from the retired routes.ts twin.
        // Non-blocking: a mail failure must never fail the submission.
        const founderEmail = process.env.FOUNDER_EMAIL;
        if (founderEmail) {
          try {
            const { emailService } = await import("./services/emailService");
            const categoryLabel = category.replace("_", " ");
            const from = userEmail ?? email ?? name ?? "an anonymous visitor";
            await emailService.sendEmail({
              to: founderEmail,
              subject: `[AcreOS Feedback] New ${categoryLabel} from ${from}`,
              html: `
                <h2>New Feedback Submission</h2>
                <p><strong>Category:</strong> ${categoryLabel}</p>
                <p><strong>From:</strong> ${from}</p>
                <p><strong>Page:</strong> ${pageUrl || "N/A"}</p>
                <p><strong>Follow-up OK:</strong> ${allowFollowUp !== false ? "Yes" : "No"}</p>
                <hr />
                <p>${message.replace(/\n/g, "<br />")}</p>
              `,
            });
          } catch (emailErr) {
            logger.warn("[feedback] founder notification failed", emailErr instanceof Error ? emailErr : undefined);
          }
        }

        logger.info("[feedback] new submission", {
          metadata: { id: row.id, category, source, hasEmail: Boolean(email ?? userEmail) },
        });

        return res.json({ id: row.id, success: true });
      } catch (err: any) {
        logger.error("[feedback] POST /api/feedback failed", err);
        return Errors.internal(res, err);
      }
    },
  );

  // ── FOUNDER: GET /api/founder/feedback ─────────────────────────────────
  app.get(
    "/api/founder/feedback",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
        const limit = Math.min(
          100,
          Math.max(1, parseInt((req.query.limit as string) || "50", 10)),
        );
        const offset = (page - 1) * limit;

        const status = req.query.status as string | undefined;
        const category = req.query.category as string | undefined;

        const filters = [] as any[];
        if (status && (STATUSES as readonly string[]).includes(status)) {
          filters.push(eq(feedbackSubmissions.status, status));
        }
        if (category && (CATEGORIES as readonly string[]).includes(category)) {
          filters.push(eq(feedbackSubmissions.category, category));
        }
        const where = filters.length ? and(...filters) : undefined;

        const rows = await db
          .select()
          .from(feedbackSubmissions)
          .where(where as any)
          .orderBy(desc(feedbackSubmissions.createdAt))
          .limit(limit)
          .offset(offset);

        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(feedbackSubmissions)
          .where(where as any);

        return res.json({ submissions: rows, total: count, page, limit });
      } catch (err: any) {
        logger.error("[feedback] GET /api/founder/feedback failed", err);
        return Errors.internal(res, err);
      }
    },
  );

  // ── FOUNDER: PATCH /api/founder/feedback/:id ───────────────────────────
  app.patch(
    "/api/founder/feedback/:id",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");

        const parsed = updateSchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const { status } = parsed.data;
        const now = new Date();

        const update: Record<string, unknown> = { status };
        if (status === "read") update.readAt = now;
        if (status === "replied") {
          update.repliedAt = now;
          // Mark read if not already.
          update.readAt = now;
        }

        const [row] = await db
          .update(feedbackSubmissions)
          .set(update as any)
          .where(eq(feedbackSubmissions.id, id))
          .returning();

        if (!row) return Errors.notFound(res, "Feedback");
        return res.json(row);
      } catch (err: any) {
        logger.error("[feedback] PATCH /api/founder/feedback/:id failed", err);
        return Errors.internal(res, err);
      }
    },
  );
}
