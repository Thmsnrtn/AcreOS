/**
 * T172 — Pagination Middleware
 *
 * Standardizes cursor-based and offset pagination across all list endpoints.
 *
 * Usage:
 *   import { parsePagination, paginatedResponse } from "./middleware/pagination";
 *
 *   app.get("/api/leads", isAuthenticated, async (req, res) => {
 *     const { page, limit, offset } = parsePagination(req.query);
 *     const items = await db.select().from(leads).limit(limit).offset(offset);
 *     const total = await getTotal();
 *     res.json(paginatedResponse(items, total, page, limit));
 *   });
 */

import type { Request } from "express";

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MIN_LIMIT = 1;

/**
 * parsePagination — Extract and validate pagination params from query string.
 * Supports ?page=1&limit=20 (1-indexed pages).
 */
export function parsePagination(query: Request["query"]): PaginationParams {
  const rawPage = parseInt((query.page as string) || "1", 10);
  const rawLimit = parseInt((query.limit as string) || String(DEFAULT_LIMIT), 10);

  const page = Math.max(1, isNaN(rawPage) ? 1 : rawPage);
  const limit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit));
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

/**
 * paginatedResponse — Wrap a list of items with pagination metadata.
 */
export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): PaginatedResult<T> {
  const totalPages = Math.ceil(total / limit);
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

/**
 * parseSortParams — Extract sort field and direction from query params.
 * Supports ?sort=createdAt&order=desc
 */
export function parseSortParams(
  query: Request["query"],
  allowedFields: string[],
  defaultField = "createdAt"
): { sortField: string; sortOrder: "asc" | "desc" } {
  const rawField = query.sort as string;
  const rawOrder = (query.order as string)?.toLowerCase();

  const sortField = allowedFields.includes(rawField) ? rawField : defaultField;
  const sortOrder: "asc" | "desc" = rawOrder === "asc" ? "asc" : "desc";

  return { sortField, sortOrder };
}

/**
 * parseCursorPagination — Extract cursor-based pagination params.
 * Supports ?cursor=<lastId>&limit=20 for infinite scroll.
 */
export function parseCursorPagination(query: Request["query"]): {
  cursor: number | null;
  limit: number;
} {
  const rawCursor = parseInt((query.cursor as string) || "0", 10);
  const rawLimit = parseInt((query.limit as string) || String(DEFAULT_LIMIT), 10);

  const cursor = rawCursor > 0 ? rawCursor : null;
  const limit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit));

  return { cursor, limit };
}
