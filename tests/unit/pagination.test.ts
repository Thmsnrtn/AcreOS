/**
 * T177 — Pagination Middleware Tests
 * Tests offset pagination, cursor pagination, and sort params.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pagination logic ───────────────────────────────────────────────

interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

interface PaginatedResult<T> {
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

function parsePagination(query: Record<string, string | undefined>): PaginationParams {
  const rawPage = parseInt(query.page || "1", 10);
  const rawLimit = parseInt(query.limit || String(DEFAULT_LIMIT), 10);

  const page = Math.max(1, isNaN(rawPage) ? 1 : rawPage);
  const limit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit));
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

function paginatedResponse<T>(data: T[], total: number, page: number, limit: number): PaginatedResult<T> {
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

function parseSortParams(
  query: Record<string, string | undefined>,
  allowedFields: string[],
  defaultField = "createdAt"
): { sortField: string; sortOrder: "asc" | "desc" } {
  const rawField = query.sort;
  const rawOrder = query.order?.toLowerCase();
  const sortField = rawField && allowedFields.includes(rawField) ? rawField : defaultField;
  const sortOrder: "asc" | "desc" = rawOrder === "asc" ? "asc" : "desc";
  return { sortField, sortOrder };
}

function parseCursorPagination(query: Record<string, string | undefined>): {
  cursor: number | null;
  limit: number;
} {
  const rawCursor = parseInt(query.cursor || "0", 10);
  const rawLimit = parseInt(query.limit || String(DEFAULT_LIMIT), 10);
  const cursor = rawCursor > 0 ? rawCursor : null;
  const limit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit));
  return { cursor, limit };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("parsePagination", () => {
  it("returns defaults when no params", () => {
    const result = parsePagination({});
    expect(result).toEqual({ page: 1, limit: 20, offset: 0 });
  });

  it("parses page and limit correctly", () => {
    const result = parsePagination({ page: "3", limit: "10" });
    expect(result).toEqual({ page: 3, limit: 10, offset: 20 });
  });

  it("calculates offset as (page-1)*limit", () => {
    expect(parsePagination({ page: "1", limit: "25" }).offset).toBe(0);
    expect(parsePagination({ page: "2", limit: "25" }).offset).toBe(25);
    expect(parsePagination({ page: "5", limit: "10" }).offset).toBe(40);
  });

  it("clamps page to minimum 1", () => {
    expect(parsePagination({ page: "0" }).page).toBe(1);
    expect(parsePagination({ page: "-5" }).page).toBe(1);
  });

  it("clamps limit to minimum 1", () => {
    expect(parsePagination({ limit: "0" }).limit).toBe(1);
    expect(parsePagination({ limit: "-10" }).limit).toBe(1);
  });

  it("clamps limit to maximum 100", () => {
    expect(parsePagination({ limit: "500" }).limit).toBe(100);
    expect(parsePagination({ limit: "200" }).limit).toBe(100);
  });

  it("handles NaN inputs gracefully", () => {
    const result = parsePagination({ page: "abc", limit: "xyz" });
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });
});

describe("paginatedResponse", () => {
  const items = [1, 2, 3, 4, 5];

  it("wraps data with pagination metadata", () => {
    const result = paginatedResponse(items, 50, 1, 5);
    expect(result.data).toEqual(items);
    expect(result.pagination.total).toBe(50);
    expect(result.pagination.totalPages).toBe(10);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(5);
  });

  it("hasNext is true when more pages exist", () => {
    const result = paginatedResponse(items, 50, 1, 5);
    expect(result.pagination.hasNext).toBe(true);
  });

  it("hasNext is false on last page", () => {
    const result = paginatedResponse(items, 50, 10, 5);
    expect(result.pagination.hasNext).toBe(false);
  });

  it("hasPrev is false on first page", () => {
    const result = paginatedResponse(items, 50, 1, 5);
    expect(result.pagination.hasPrev).toBe(false);
  });

  it("hasPrev is true on page > 1", () => {
    const result = paginatedResponse(items, 50, 3, 5);
    expect(result.pagination.hasPrev).toBe(true);
  });

  it("totalPages rounds up for partial last page", () => {
    expect(paginatedResponse([], 21, 1, 10).pagination.totalPages).toBe(3);
    expect(paginatedResponse([], 20, 1, 10).pagination.totalPages).toBe(2);
    expect(paginatedResponse([], 1, 1, 10).pagination.totalPages).toBe(1);
  });

  it("handles empty result sets", () => {
    const result = paginatedResponse([], 0, 1, 20);
    expect(result.data).toEqual([]);
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.totalPages).toBe(0);
    expect(result.pagination.hasNext).toBe(false);
    expect(result.pagination.hasPrev).toBe(false);
  });
});

describe("parseSortParams", () => {
  const allowed = ["createdAt", "name", "score", "amount"];

  it("returns default field when sort param absent", () => {
    const result = parseSortParams({}, allowed);
    expect(result.sortField).toBe("createdAt");
    expect(result.sortOrder).toBe("desc");
  });

  it("accepts valid sort field", () => {
    const result = parseSortParams({ sort: "name" }, allowed);
    expect(result.sortField).toBe("name");
  });

  it("rejects invalid sort field and falls back to default", () => {
    const result = parseSortParams({ sort: "password" }, allowed);
    expect(result.sortField).toBe("createdAt");
  });

  it("parses asc order", () => {
    const result = parseSortParams({ order: "asc" }, allowed);
    expect(result.sortOrder).toBe("asc");
  });

  it("defaults to desc for unrecognized order", () => {
    const result = parseSortParams({ order: "random" }, allowed);
    expect(result.sortOrder).toBe("desc");
  });

  it("uses custom default field", () => {
    const result = parseSortParams({}, allowed, "score");
    expect(result.sortField).toBe("score");
  });
});

describe("parseCursorPagination", () => {
  it("returns null cursor when not provided", () => {
    const result = parseCursorPagination({});
    expect(result.cursor).toBeNull();
    expect(result.limit).toBe(DEFAULT_LIMIT);
  });

  it("parses cursor as number", () => {
    const result = parseCursorPagination({ cursor: "42" });
    expect(result.cursor).toBe(42);
  });

  it("returns null for cursor=0", () => {
    expect(parseCursorPagination({ cursor: "0" }).cursor).toBeNull();
  });

  it("returns null for negative cursor", () => {
    expect(parseCursorPagination({ cursor: "-5" }).cursor).toBeNull();
  });

  it("clamps limit to max 100", () => {
    expect(parseCursorPagination({ limit: "500" }).limit).toBe(100);
  });

  it("clamps limit to min 1", () => {
    expect(parseCursorPagination({ limit: "0" }).limit).toBe(1);
  });
});
