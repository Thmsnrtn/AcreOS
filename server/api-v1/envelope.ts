/**
 * Public API v0 — response envelope + cursor pagination.
 *
 * Every successful response from /api/v1/* uses:
 *
 *   {
 *     "data": <T | T[]>,
 *     "meta": {
 *       "request_id": "uuid",
 *       "rate_limit": { "limit": 1000, "remaining": 998, "reset": 1716840000 },
 *       "pagination"?: { "next_cursor": "...", "prev_cursor": "...", "has_more": true }
 *     }
 *   }
 *
 * Errors stay on the `Errors.*` helper envelope — same shape as the
 * internal API ({ error, message, details?, statusCode }) so SDK
 * consumers get one error type to discriminate on.
 */

import type { Request, Response } from "express";
import { Buffer } from "node:buffer";

interface RateLimitMeta {
  limit: number;
  remaining: number;
  reset: number;
}

interface PaginationMeta {
  next_cursor: string | null;
  prev_cursor: string | null;
  has_more: boolean;
}

interface Meta {
  request_id: string;
  rate_limit: RateLimitMeta;
  pagination?: PaginationMeta;
}

function readRateLimitFromHeaders(res: Response): RateLimitMeta {
  return {
    limit: Number(res.getHeader("X-RateLimit-Limit") ?? 0),
    remaining: Number(res.getHeader("X-RateLimit-Remaining") ?? 0),
    reset: Number(res.getHeader("X-RateLimit-Reset") ?? 0),
  };
}

export function sendEnvelope<T>(
  req: Request,
  res: Response,
  data: T,
  pagination?: PaginationMeta,
  status = 200,
): void {
  const meta: Meta = {
    request_id: (res.getHeader("X-Request-Id") as string) || "",
    rate_limit: readRateLimitFromHeaders(res),
    ...(pagination ? { pagination } : {}),
  };
  res.status(status).json({ data, meta });
}

// ─── Cursor pagination ──────────────────────────────────────────────────────
//
// Opaque base64url-encoded JSON. The shape is intentionally hidden from
// customers so we can evolve it (add a sort-direction tiebreaker, switch
// from id to created_at, etc.) without a breaking change.
//
// v0 cursor: { i: <last_id>, d: "f" | "b" } — forward/backward.

export interface DecodedCursor {
  id: number;
  direction: "f" | "b";
}

export function encodeCursor(c: DecodedCursor): string {
  return Buffer.from(JSON.stringify({ i: c.id, d: c.direction })).toString(
    "base64url",
  );
}

export function decodeCursor(raw: unknown): DecodedCursor | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof json === "object" &&
      json !== null &&
      typeof json.i === "number" &&
      (json.d === "f" || json.d === "b")
    ) {
      return { id: json.i, direction: json.d };
    }
  } catch {
    /* fall through */
  }
  return null;
}

export interface ParsedListQuery {
  limit: number;
  cursor: DecodedCursor | null;
}

/**
 * Standard list-query parser for v1 collection endpoints. Clamps `limit`
 * to [1, 100] (default 50) and decodes the cursor. Returns null on bad
 * input so the handler can surface a 400 via Errors.badRequest.
 */
export function parseListQuery(req: Request): ParsedListQuery | { error: string } {
  const limitRaw = req.query.limit;
  let limit = 50;
  if (typeof limitRaw === "string" && limitRaw.length > 0) {
    const n = Number.parseInt(limitRaw, 10);
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      return { error: "limit must be an integer between 1 and 100" };
    }
    limit = n;
  }

  const cursorRaw = req.query.cursor;
  let cursor: DecodedCursor | null = null;
  if (typeof cursorRaw === "string" && cursorRaw.length > 0) {
    cursor = decodeCursor(cursorRaw);
    if (!cursor) return { error: "Invalid cursor" };
  }

  return { limit, cursor };
}

/**
 * Given the (limit+1)-fetched rows, slice down to `limit` and build the
 * pagination meta. Caller passes its own id-extractor since row types
 * vary across resources.
 */
export function buildPaginationMeta<T>(
  rows: T[],
  limit: number,
  getId: (row: T) => number,
): { rows: T[]; pagination: PaginationMeta } {
  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;
  const last = trimmed[trimmed.length - 1];
  const first = trimmed[0];
  return {
    rows: trimmed,
    pagination: {
      next_cursor:
        hasMore && last ? encodeCursor({ id: getId(last), direction: "f" }) : null,
      prev_cursor: first
        ? encodeCursor({ id: getId(first), direction: "b" })
        : null,
      has_more: hasMore,
    },
  };
}
