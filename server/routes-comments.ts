/**
 * Contextual Team Comments Routes
 *
 * GET    /api/comments/:entityType/:entityId  — cursor-based, 20/page
 * POST   /api/comments/:entityType/:entityId  — create comment, parse @mentions, WebSocket broadcast
 * DELETE /api/comments/:id                    — own comments only
 */

import { Router, type Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { db } from "./db";
import { entityComments, notifications, teamMembers } from "@shared/schema";
import { eq, and, lt, desc } from "drizzle-orm";
import { logger } from "./utils/logger";

const router = Router();

const VALID_ENTITY_TYPES = ["lead", "deal", "property", "note"] as const;
const PAGE_SIZE = 20;

const createCommentSchema = z.object({
  content: z.string().min(1, "content is required").max(10000, "content too long"),
});

/**
 * Parse @mentions from comment content.
 * Handles: @name, @name-with-hyphen, @name_underscore
 */
function parseMentions(content: string): string[] {
  const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
  const mentions: string[] = [];
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    const name = match[1];
    if (!mentions.includes(name)) {
      mentions.push(name);
    }
  }
  return mentions;
}

// GET /api/comments/:entityType/:entityId — cursor-based pagination
router.get("/:entityType/:entityId", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = req.organization;
    const { entityType, entityId } = req.params;
    const cursor = req.query.cursor ? parseInt(req.query.cursor as string) : undefined;

    if (!VALID_ENTITY_TYPES.includes(entityType as typeof VALID_ENTITY_TYPES[number])) {
      return Errors.badRequest(res, `invalid entity type, must be one of: ${VALID_ENTITY_TYPES.join(", ")}`);
    }

    const entityIdNum = parseInt(entityId);
    if (isNaN(entityIdNum)) return Errors.badRequest(res, "invalid entity ID");

    const conditions = [
      eq(entityComments.organizationId, org.id),
      eq(entityComments.entityType, entityType),
      eq(entityComments.entityId, entityIdNum),
    ];

    if (cursor) {
      conditions.push(lt(entityComments.id, cursor));
    }

    const comments = await db
      .select()
      .from(entityComments)
      .where(and(...conditions))
      .orderBy(desc(entityComments.id))
      .limit(PAGE_SIZE + 1); // fetch one extra to check for next page

    const hasMore = comments.length > PAGE_SIZE;
    const page = hasMore ? comments.slice(0, PAGE_SIZE) : comments;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    res.json({
      comments: page,
      nextCursor,
      hasMore,
    });
  } catch (err) {
    logger.error("failed to fetch comments", err instanceof Error ? err : undefined);
    Errors.internal(res, err);
  }
});

// POST /api/comments/:entityType/:entityId — create comment
router.post("/:entityType/:entityId", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = req.organization;
    const user = req.user;
    const userId = (user as any)?.id ?? user?.id;
    const { entityType, entityId } = req.params;

    if (!VALID_ENTITY_TYPES.includes(entityType as typeof VALID_ENTITY_TYPES[number])) {
      return Errors.badRequest(res, "invalid entity type");
    }

    const entityIdNum = parseInt(entityId);
    if (isNaN(entityIdNum)) return Errors.badRequest(res, "invalid entity ID");

    const parsed = createCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const { content } = parsed.data;

    // Parse @mentions
    const mentions = parseMentions(content);

    const [comment] = await db.insert(entityComments).values({
      organizationId: org.id,
      entityType,
      entityId: entityIdNum,
      userId: String(userId),
      content: content.trim(),
      mentions,
    }).returning();

    // Create notifications for mentioned users (non-blocking)
    if (mentions.length > 0) {
      setImmediate(async () => {
        try {
          // Resolve mention names to user IDs
          const members = await db
            .select()
            .from(teamMembers)
            .where(eq(teamMembers.organizationId, org.id));

          for (const mention of mentions) {
            const member = members.find((m) => {
              const name = `${m.firstName || ""} ${m.lastName || ""}`.toLowerCase().replace(/\s+/g, "-");
              const username = (m.email || "").split("@")[0].toLowerCase();
              return name.includes(mention.toLowerCase()) || username === mention.toLowerCase();
            });

            if (member) {
              await db.insert(notifications).values({
                organizationId: org.id,
                userId: member.userId,
                type: "mention",
                title: `You were mentioned in a ${entityType} comment`,
                message: content.length > 100 ? content.slice(0, 100) + "..." : content,
                data: { entityType, entityId: entityIdNum, commentId: comment.id },
              }).catch(() => {});
            }
          }
        } catch (err) {
          logger.error("mention notification failed", err instanceof Error ? err : undefined);
        }
      });
    }

    // Broadcast via WebSocket (non-blocking)
    try {
      const { wsServer } = await import("./websocket");
      if (wsServer) {
        wsServer.broadcast(org.id, {
          type: "entity_comment",
          payload: {
            entityType,
            entityId: entityIdNum,
            comment,
          },
        });
      }
    } catch {
      // WebSocket not available — fine, clients will poll
    }

    res.status(201).json({ comment });
  } catch (err) {
    logger.error("failed to create comment", err instanceof Error ? err : undefined);
    Errors.internal(res, err);
  }
});

// DELETE /api/comments/:id — own comments only
router.delete("/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = req.organization;
    const user = req.user;
    const userId = String((user as any)?.id ?? user?.id);
    const commentId = parseInt(req.params.id);

    if (isNaN(commentId)) return Errors.badRequest(res, "invalid comment ID");

    // Verify ownership
    const [existing] = await db
      .select()
      .from(entityComments)
      .where(and(eq(entityComments.id, commentId), eq(entityComments.organizationId, org.id)))
      .limit(1);

    if (!existing) return Errors.notFound(res, "Comment");

    if (existing.userId !== userId) {
      return Errors.forbidden(res, "can only delete your own comments");
    }

    await db.delete(entityComments).where(eq(entityComments.id, commentId));

    res.json({ success: true });
  } catch (err) {
    logger.error("failed to delete comment", err instanceof Error ? err : undefined);
    Errors.internal(res, err);
  }
});

export { parseMentions };
export default router;
