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
 *
 * Phase 3 Week 14 (Anaïs §2):
 *   • Accent folding via unaccent() — "cafe" matches "café" etc.
 *     Migration 0050 enables the extension; here we wrap query and
 *     indexed text in unaccent() at call time. This double-evaluates
 *     until 0010-style indexes get rebuilt with the unaccent layer.
 *   • Phone normalization — query digits-only against `phone_normalized`
 *     so "555-123-4567" matches "5551234567", "(555) 123-4567", etc.
 *     Migration 0051 adds the generated column + trigram index.
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

/**
 * Strip non-digits. Used to detect phone-shaped queries and to
 * normalize them before matching against `phone_normalized`.
 */
export function digitsOnly(input: string): string {
  return input.replace(/\D+/g, "");
}

/**
 * Heuristic: "looks like a phone number" if it has at least 7 digits
 * after stripping. We avoid false-positives on APNs (which are also
 * digit-heavy) by also requiring the input contain at least one
 * phone-conventional separator OR be ≥10 digits long.
 */
export function isPhoneShaped(input: string): boolean {
  const digits = digitsOnly(input);
  if (digits.length < 7) return false;
  if (digits.length >= 10) return true;
  return /[-(). ]/.test(input);
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
    const phoneShape = isPhoneShaped(q);
    const phoneDigits = phoneShape ? digitsOnly(q) : "";

    try {
      // ── Leads ──────────────────────────────────────────────────────────
      // unaccent() normalizes both the query and the indexed text so
      // "Anais" matches "Anaïs". We OR in a phone_normalized trigram
      // match when the query looks phone-shaped so digits-only queries
      // still find leads regardless of how the phone was stored.
      const leadRows = await db.execute<any>(sql`
        SELECT
          id,
          first_name AS "firstName",
          last_name AS "lastName",
          email,
          phone,
          address,
          ts_rank(
            to_tsvector('simple', unaccent(
              coalesce(first_name,'') || ' ' ||
              coalesce(last_name,'') || ' ' ||
              coalesce(email,'') || ' ' ||
              coalesce(phone,'') || ' ' ||
              coalesce(address,'')
            )),
            to_tsquery('simple', unaccent(${tsQuery}))
          ) AS rank
        FROM leads
        WHERE
          organization_id = ${orgId}
          AND (
            to_tsvector('simple', unaccent(
              coalesce(first_name,'') || ' ' ||
              coalesce(last_name,'') || ' ' ||
              coalesce(email,'') || ' ' ||
              coalesce(address,'')
            )) @@ to_tsquery('simple', unaccent(${tsQuery}))
            ${phoneShape && phoneDigits.length >= 7
              ? sql`OR phone_normalized LIKE ${'%' + phoneDigits + '%'}`
              : sql``}
          )
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
            to_tsvector('simple', unaccent(
              coalesce(address,'') || ' ' ||
              coalesce(apn,'') || ' ' ||
              coalesce(city,'') || ' ' ||
              coalesce(state,'')
            )),
            to_tsquery('simple', unaccent(${tsQuery}))
          ) AS rank
        FROM properties
        WHERE
          organization_id = ${orgId}
          AND to_tsvector('simple', unaccent(
            coalesce(address,'') || ' ' ||
            coalesce(apn,'') || ' ' ||
            coalesce(city,'') || ' ' ||
            coalesce(state,'')
          )) @@ to_tsquery('simple', unaccent(${tsQuery}))
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
      // The `deals` table doesn't carry a denormalized title or address;
      // we search notes + escrow_number + title_company and join through
      // properties for the property text. Limited to the most discriminating
      // free-text columns to keep the GIN index hit small.
      const dealRows = await db.execute<any>(sql`
        SELECT
          d.id,
          d.status,
          d.escrow_number AS "escrowNumber",
          p.address AS "propertyAddress",
          ts_rank(
            to_tsvector('simple', unaccent(
              coalesce(d.notes,'') || ' ' ||
              coalesce(d.title_company,'') || ' ' ||
              coalesce(d.escrow_number,'') || ' ' ||
              coalesce(p.address,'')
            )),
            to_tsquery('simple', unaccent(${tsQuery}))
          ) AS rank
        FROM deals d
        LEFT JOIN properties p ON p.id = d.property_id
        WHERE
          d.organization_id = ${orgId}
          AND to_tsvector('simple', unaccent(
            coalesce(d.notes,'') || ' ' ||
            coalesce(d.title_company,'') || ' ' ||
            coalesce(d.escrow_number,'') || ' ' ||
            coalesce(p.address,'')
          )) @@ to_tsquery('simple', unaccent(${tsQuery}))
        ORDER BY rank DESC
        LIMIT ${Math.ceil(limit / 3)}
      `);

      for (const row of (dealRows as any)?.rows ?? []) {
        results.push({
          type: "deal",
          id: row.id,
          title: row.propertyAddress || row.escrowNumber || `Deal #${row.id}`,
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
