/**
 * Public knowledge base browse endpoints.
 *
 * Lens 25 #3 surface fix — the `knowledge_base_articles` table is written
 * to by the AI ticket-resolution agent (server/ai/supportAgent.ts) and by
 * the admin KB tool (server/routes-admin.ts), but until this file landed
 * there was no public read path. These endpoints power:
 *
 *   - `client/src/pages/help/kb.tsx` (list with search + category facets)
 *   - `client/src/pages/help/kb-article.tsx` (single article render)
 *   - the "Learn why" deep link from server/utils/errors.ts (docsSlug)
 *
 * No auth required: this is the public help surface, intentionally
 * crawlable so error toast links work even when signed out and search
 * engines can index `/help/article/<slug>`.
 */
import type { Express } from "express";
import { db } from "./storage";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { knowledgeBaseArticles } from "@shared/schema";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

export function registerKnowledgeBaseRoutes(app: Express): void {
  /**
   * GET /api/kb/articles
   * Query: ?page=1&pageSize=20&category=billing&q=refund
   * Returns paginated published articles, ordered by viewCount desc.
   */
  app.get("/api/kb/articles", async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page ?? 1));
      const pageSize = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, Number(req.query.pageSize ?? DEFAULT_PAGE_SIZE)),
      );
      const category = typeof req.query.category === "string" ? req.query.category : undefined;
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

      const filters = [eq(knowledgeBaseArticles.isPublished, true)];
      if (category) {
        filters.push(eq(knowledgeBaseArticles.category, category));
      }
      if (q) {
        // ILIKE on title + summary + content. Cheap fts is overkill for
        // the article count we have today; revisit when > a few hundred.
        const like = `%${q}%`;
        const search = or(
          ilike(knowledgeBaseArticles.title, like),
          ilike(knowledgeBaseArticles.summary, like),
          ilike(knowledgeBaseArticles.content, like),
        );
        if (search) filters.push(search);
      }

      const whereClause = filters.length === 1 ? filters[0] : and(...filters);

      const offset = (page - 1) * pageSize;

      const [rows, totalRow] = await Promise.all([
        db
          .select({
            id: knowledgeBaseArticles.id,
            title: knowledgeBaseArticles.title,
            slug: knowledgeBaseArticles.slug,
            summary: knowledgeBaseArticles.summary,
            category: knowledgeBaseArticles.category,
            tags: knowledgeBaseArticles.tags,
            viewCount: knowledgeBaseArticles.viewCount,
            updatedAt: knowledgeBaseArticles.updatedAt,
          })
          .from(knowledgeBaseArticles)
          .where(whereClause)
          .orderBy(desc(knowledgeBaseArticles.viewCount))
          .limit(pageSize)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(knowledgeBaseArticles)
          .where(whereClause),
      ]);

      const total = Number(totalRow[0]?.count ?? 0);

      // Distinct category facets across published articles (search-aware
      // would be nicer; this is the simple-but-useful version).
      const categoryRows = await db
        .selectDistinct({ category: knowledgeBaseArticles.category })
        .from(knowledgeBaseArticles)
        .where(eq(knowledgeBaseArticles.isPublished, true));
      const categories = categoryRows.map((r) => r.category).filter(Boolean);

      res.json({
        data: rows,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        categories,
      });
    } catch (error) {
      logger.error("[kb] list error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  /**
   * GET /api/kb/articles/:slug
   * Single published article. Increments view count. 404 if missing or
   * unpublished (we don't leak slug existence — same body either way).
   */
  app.get("/api/kb/articles/:slug", async (req, res) => {
    try {
      const slug = req.params.slug;
      if (!slug || typeof slug !== "string") {
        return Errors.badRequest(res, "Missing slug");
      }

      const [article] = await db
        .select()
        .from(knowledgeBaseArticles)
        .where(
          and(
            eq(knowledgeBaseArticles.slug, slug),
            eq(knowledgeBaseArticles.isPublished, true),
          ),
        );

      if (!article) {
        return Errors.notFound(res, "Article");
      }

      // Fire-and-forget view-count bump. A failure here must never
      // block the read; log and move on.
      db.update(knowledgeBaseArticles)
        .set({ viewCount: (article.viewCount ?? 0) + 1 })
        .where(eq(knowledgeBaseArticles.id, article.id))
        .catch((err) => logger.warn("[kb] view-count bump failed", { err: String(err) }));

      res.json(article);
    } catch (error) {
      logger.error("[kb] get error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });
}
