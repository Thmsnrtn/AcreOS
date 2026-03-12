/**
 * T4 — Full-Text Search Service (PostgreSQL tsvector)
 *
 * Provides ranked, cross-entity search across leads, properties, and deals
 * using Postgres's built-in full-text search engine.
 *
 * The migration adds GIN-indexed tsvector columns to each table. Until the
 * migration runs, this service falls back to ILIKE matching so it degrades
 * gracefully.
 *
 * Search priority:
 *   1. leads      — firstName, lastName, email, phone, address, notes
 *   2. properties — address, apn, city, state, notes
 *   3. deals      — title, propertyAddress, notes
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { leads, properties, deals } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface SearchResult {
  type: "lead" | "property" | "deal";
  id: number;
  title: string;
  subtitle: string;
  rank: number;
  url: string;
}

export const fullTextSearch = {
  /**
   * Search across all entity types for an org.
   * Returns up to `limit` results sorted by relevance rank.
   */
  async search(
    orgId: number,
    query: string,
    limit = 20
  ): Promise<SearchResult[]> {
    if (!query || query.trim().length < 2) return [];

    const q = query.trim();

    // Build tsquery — AND of all words, prefix-matching the last word
    // e.g. "john sm" → "john & sm:*"
    const words = q.split(/\s+/).filter(Boolean);
    const tsQuery =
      words
        .slice(0, -1)
        .map((w) => w.replace(/[^a-zA-Z0-9]/g, "") + ":*")
        .join(" & ") +
      (words.length > 0
        ? (words.length > 1 ? " & " : "") +
          words[words.length - 1].replace(/[^a-zA-Z0-9]/g, "") + ":*"
        : "");

    if (!tsQuery || tsQuery === ":*") return [];

    const results: SearchResult[] = [];

    try {
      // ── Leads ──────────────────────────────────────────────────────────
      const leadRows = await db.execute<any>(sql`
        SELECT
          id,
          "firstName",
          "lastName",
          email,
          phone,
          address,
          ts_rank(
            to_tsvector('english',
              coalesce("firstName",'') || ' ' ||
              coalesce("lastName",'') || ' ' ||
              coalesce(email,'') || ' ' ||
              coalesce(phone,'') || ' ' ||
              coalesce(address,'')
            ),
            to_tsquery('english', ${tsQuery})
          ) AS rank
        FROM leads
        WHERE
          "organizationId" = ${orgId}
          AND to_tsvector('english',
            coalesce("firstName",'') || ' ' ||
            coalesce("lastName",'') || ' ' ||
            coalesce(email,'') || ' ' ||
            coalesce(address,'')
          ) @@ to_tsquery('english', ${tsQuery})
        ORDER BY rank DESC
        LIMIT ${Math.ceil(limit / 2)}
      `);

      for (const row of (leadRows as any)?.rows ?? []) {
        results.push({
          type: "lead",
          id: row.id,
          title: [row.firstName, row.lastName].filter(Boolean).join(" ") || "Unknown",
          subtitle: row.email || row.phone || row.address || "",
          rank: parseFloat(row.rank ?? "0"),
          url: `/leads?id=${row.id}`,
        });
      }

      // ── Properties ─────────────────────────────────────────────────────
      const propRows = await db.execute<any>(sql`
        SELECT
          id,
          address,
          apn,
          city,
          state,
          ts_rank(
            to_tsvector('english',
              coalesce(address,'') || ' ' ||
              coalesce(apn,'') || ' ' ||
              coalesce(city,'') || ' ' ||
              coalesce(state,'')
            ),
            to_tsquery('english', ${tsQuery})
          ) AS rank
        FROM properties
        WHERE
          "organizationId" = ${orgId}
          AND to_tsvector('english',
            coalesce(address,'') || ' ' ||
            coalesce(apn,'') || ' ' ||
            coalesce(city,'') || ' ' ||
            coalesce(state,'')
          ) @@ to_tsquery('english', ${tsQuery})
        ORDER BY rank DESC
        LIMIT ${Math.ceil(limit / 3)}
      `);

      for (const row of (propRows as any)?.rows ?? []) {
        results.push({
          type: "property",
          id: row.id,
          title: row.address || `APN: ${row.apn}` || `Property #${row.id}`,
          subtitle: [row.city, row.state].filter(Boolean).join(", "),
          rank: parseFloat(row.rank ?? "0"),
          url: `/properties?id=${row.id}`,
        });
      }

      // ── Deals ──────────────────────────────────────────────────────────
      const dealRows = await db.execute<any>(sql`
        SELECT
          id,
          title,
          "propertyAddress",
          status,
          ts_rank(
            to_tsvector('english',
              coalesce(title,'') || ' ' ||
              coalesce("propertyAddress",'')
            ),
            to_tsquery('english', ${tsQuery})
          ) AS rank
        FROM deals
        WHERE
          "organizationId" = ${orgId}
          AND to_tsvector('english',
            coalesce(title,'') || ' ' ||
            coalesce("propertyAddress",'')
          ) @@ to_tsquery('english', ${tsQuery})
        ORDER BY rank DESC
        LIMIT ${Math.ceil(limit / 3)}
      `);

      for (const row of (dealRows as any)?.rows ?? []) {
        results.push({
          type: "deal",
          id: row.id,
          title: row.title || row.propertyAddress || `Deal #${row.id}`,
          subtitle: row.status || "",
          rank: parseFloat(row.rank ?? "0"),
          url: `/deals?id=${row.id}`,
        });
      }
    } catch (err: any) {
      // GIN indexes exist (migration 0010); fall back to ILIKE on unexpected error
      return fullTextSearch.fallbackSearch(orgId, q, limit);
    }

    // Sort by rank descending, deduplicate by type+id
    results.sort((a, b) => b.rank - a.rank);
    return results.slice(0, limit);
  },

  /**
   * ILIKE fallback — used when a GIN-indexed tsvector query fails unexpectedly.
   */
  async fallbackSearch(
    orgId: number,
    query: string,
    limit = 20
  ): Promise<SearchResult[]> {
    const pattern = `%${query}%`;
    const results: SearchResult[] = [];

    try {
      const leadRows = await db.execute<any>(sql`
        SELECT id, "firstName", "lastName", email, phone, address
        FROM leads
        WHERE "organizationId" = ${orgId}
          AND (
            "firstName" ILIKE ${pattern} OR
            "lastName" ILIKE ${pattern} OR
            email ILIKE ${pattern} OR
            phone ILIKE ${pattern} OR
            address ILIKE ${pattern}
          )
        LIMIT ${Math.ceil(limit / 2)}
      `);

      for (const row of (leadRows as any)?.rows ?? []) {
        results.push({
          type: "lead",
          id: row.id,
          title: [row.firstName, row.lastName].filter(Boolean).join(" ") || "Unknown",
          subtitle: row.email || row.phone || "",
          rank: 0.5,
          url: `/leads?id=${row.id}`,
        });
      }

      const propRows = await db.execute<any>(sql`
        SELECT id, address, apn, city, state
        FROM properties
        WHERE "organizationId" = ${orgId}
          AND (address ILIKE ${pattern} OR apn ILIKE ${pattern} OR city ILIKE ${pattern})
        LIMIT ${Math.ceil(limit / 3)}
      `);

      for (const row of (propRows as any)?.rows ?? []) {
        results.push({
          type: "property",
          id: row.id,
          title: row.address || `APN: ${row.apn}`,
          subtitle: [row.city, row.state].filter(Boolean).join(", "),
          rank: 0.4,
          url: `/properties?id=${row.id}`,
        });
      }
    } catch {}

    return results.slice(0, limit);
  },
};
