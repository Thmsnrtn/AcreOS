// GIS + data-source data layer: county GIS endpoints (bulk seeding +
// updates), the free-data endpoint registry (data sources + stats), the
// data-source cache, live GIS discovery (discovered endpoints with the
// approve/reject flow), and parcel snapshots. Extracted from the god-class
// server/storage.ts in the storage refactor. Methods are merged into
// DatabaseStorage.prototype at construction time; `this` refers to the full
// DatabaseStorage instance.

import { and, asc, desc, eq, gte, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  countyGisEndpoints,
  dataSources,
  dataSourceCache,
  discoveredEndpoints,
  parcelSnapshots,
  type DataSource,
  type DataSourceCache,
  type InsertDataSourceCache,
  type DiscoveredEndpoint,
  type ParcelSnapshot,
  type InsertParcelSnapshot,
  type InsertDataSource,
  type InsertDiscoveredEndpoint,
} from "@shared/schema";
import { normalizeParcelRef } from "@shared/parcel/parcelRef";
import { logger } from "../utils/logger";
import type { DatabaseStorage } from "../storage";

/**
 * Match a stored county against a parcelRef-normalised county name.
 *
 * TOLERANT ON READ, CANONICAL ON WRITE. `upsertParcelSnapshot` used to store
 * `...data` verbatim, so existing rows carry whatever the caller passed —
 * "Travis", "travis" or "Travis County". Matching only the canonical form would
 * turn every one of those into a permanent cache miss.
 *
 * The old SQL tried to do this with `REPLACE(county, ' County', '')`, which is
 * CASE-SENSITIVE in Postgres and therefore could not strip the suffix from a
 * row this same file had lower-cased on the way in. Comparing against both
 * accepted spellings is exact, needs no regex, and cannot silently half-work.
 */
const countyMatches = (normalizedCounty: string) =>
  sql`LOWER(${parcelSnapshots.county}) IN (${normalizedCounty}, ${`${normalizedCounty} county`})`;

export const gisRepo = {
  // County GIS Endpoints
  async getCountyGisEndpoint(this: DatabaseStorage, id: number): Promise<any> {
    const { countyGisEndpoints } = await import('@shared/schema');
    const [endpoint] = await db.select().from(countyGisEndpoints).where(eq(countyGisEndpoints.id, id));
    return endpoint;
  },

  async updateCountyGisEndpoint(this: DatabaseStorage, id: number, updates: { isVerified?: boolean; errorCount?: number; lastVerified?: Date; isActive?: boolean; lastError?: string | null }): Promise<any> {
    const { countyGisEndpoints } = await import('@shared/schema');
    const [updated] = await db.update(countyGisEndpoints)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(countyGisEndpoints.id, id))
      .returning();
    return updated;
  },

  async bulkCreateCountyGisEndpoints(this: DatabaseStorage, endpoints: Array<{ state: string; county: string; baseUrl: string; endpointType: string; fipsCode?: string | null; confidenceScore?: number }>): Promise<{ added: number; skipped: number }> {
    const { countyGisEndpoints } = await import('@shared/schema');
    // SSRF guard (Beatrice item 5): these baseUrls are auto-contributed by the
    // discovery scan and fetched server-side. Skip private/loopback/non-https.
    const { checkOperatorUrl } = await import('../services/providers/ssrf-guard');
    let added = 0;
    let skipped = 0;

    const existing = await db.select({ state: countyGisEndpoints.state, county: countyGisEndpoints.county, baseUrl: countyGisEndpoints.baseUrl }).from(countyGisEndpoints);
    const existingSet = new Set(existing.map(e => `${e.state.toUpperCase()}|${e.county.toLowerCase()}|${e.baseUrl.toLowerCase()}`));

    for (const ep of endpoints) {
      const key = `${ep.state.toUpperCase()}|${ep.county.toLowerCase()}|${ep.baseUrl.toLowerCase()}`;
      if (existingSet.has(key)) {
        skipped++;
        continue;
      }

      if (!checkOperatorUrl(ep.baseUrl).ok) {
        skipped++;
        continue;
      }

      try {
        await db.insert(countyGisEndpoints).values({
          state: ep.state.toUpperCase(),
          county: ep.county,
          baseUrl: ep.baseUrl,
          endpointType: ep.endpointType || "arcgis_rest",
          fipsCode: ep.fipsCode || null,
          isActive: true,
          isVerified: false,
          contributedBy: "scan",
          notes: ep.confidenceScore ? `Confidence: ${ep.confidenceScore}%` : undefined,
        });
        added++;
        existingSet.add(key);
      } catch (err: any) {
        if (err.code === '23505') {
          skipped++;
        } else {
          throw err;
        }
      }
    }

    return { added, skipped };
  },

  // Data Sources (Free Data Endpoint Registry)
  async getDataSources(this: DatabaseStorage, filters?: { category?: string; isEnabled?: boolean }): Promise<DataSource[]> {
    let query = db.select().from(dataSources);
    const conditions: any[] = [];
    
    if (filters?.category) {
      conditions.push(eq(dataSources.category, filters.category));
    }
    if (filters?.isEnabled !== undefined) {
      conditions.push(eq(dataSources.isEnabled, filters.isEnabled));
    }
    
    if (conditions.length > 0) {
      return await query.where(and(...conditions)).orderBy(dataSources.priority, dataSources.title);
    }
    return await query.orderBy(dataSources.priority, dataSources.title);
  },

  async getDataSource(this: DatabaseStorage, id: number): Promise<DataSource | undefined> {
    const [source] = await db.select().from(dataSources).where(eq(dataSources.id, id));
    return source;
  },

  async getDataSourceByKey(this: DatabaseStorage, key: string): Promise<DataSource | undefined> {
    const [source] = await db.select().from(dataSources).where(eq(dataSources.key, key));
    return source;
  },

  async createDataSource(this: DatabaseStorage, data: InsertDataSource): Promise<DataSource> {
    const [created] = await db.insert(dataSources).values(data).returning();
    return created;
  },

  async updateDataSource(this: DatabaseStorage, id: number, updates: Partial<InsertDataSource>): Promise<DataSource> {
    const [updated] = await db.update(dataSources)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(dataSources.id, id))
      .returning();
    return updated;
  },

  async deleteDataSource(this: DatabaseStorage, id: number): Promise<void> {
    await db.delete(dataSources).where(eq(dataSources.id, id));
  },

  async getDataSourceStats(this: DatabaseStorage): Promise<{ total: number; enabled: number; verified: number; byCategory: Record<string, number> }> {
    const sources = await db.select().from(dataSources);
    const byCategory: Record<string, number> = {};
    let enabled = 0;
    let verified = 0;
    
    for (const source of sources) {
      byCategory[source.category] = (byCategory[source.category] || 0) + 1;
      if (source.isEnabled) enabled++;
      if (source.isVerified) verified++;
    }
    
    return { total: sources.length, enabled, verified, byCategory };
  },

  // Data Source Cache
  async getDataSourceCacheEntry(this: DatabaseStorage, lookupKey: string, dataSourceId?: number): Promise<DataSourceCache | undefined> {
    const conditions = [eq(dataSourceCache.lookupKey, lookupKey)];
    if (dataSourceId !== undefined) {
      conditions.push(eq(dataSourceCache.dataSourceId, dataSourceId));
    }
    
    const [entry] = await db.select()
      .from(dataSourceCache)
      .where(and(...conditions))
      .orderBy(desc(dataSourceCache.fetchedAt));
    return entry;
  },

  async createDataSourceCacheEntry(this: DatabaseStorage, data: InsertDataSourceCache): Promise<DataSourceCache> {
    const [created] = await db.insert(dataSourceCache).values(data).returning();
    return created;
  },

  async invalidateDataSourceCache(this: DatabaseStorage, dataSourceId: number): Promise<void> {
    await db.delete(dataSourceCache).where(eq(dataSourceCache.dataSourceId, dataSourceId));
  },
  // DISCOVERED ENDPOINTS (Live GIS Discovery)
  // ============================================

  async createDiscoveredEndpoint(this: DatabaseStorage, data: InsertDiscoveredEndpoint): Promise<DiscoveredEndpoint> {
    const [created] = await db.insert(discoveredEndpoints).values(data).returning();
    return created;
  },

  async getDiscoveredEndpoints(this: DatabaseStorage, filters?: { status?: string; state?: string }): Promise<DiscoveredEndpoint[]> {
    const conditions: any[] = [];
    
    if (filters?.status) {
      conditions.push(eq(discoveredEndpoints.status, filters.status));
    }
    if (filters?.state) {
      conditions.push(eq(discoveredEndpoints.state, filters.state.toUpperCase()));
    }
    
    if (conditions.length > 0) {
      return await db.select()
        .from(discoveredEndpoints)
        .where(and(...conditions))
        .orderBy(desc(discoveredEndpoints.discoveryDate));
    }
    return await db.select()
      .from(discoveredEndpoints)
      .orderBy(desc(discoveredEndpoints.discoveryDate));
  },

  async getDiscoveredEndpoint(this: DatabaseStorage, id: number): Promise<DiscoveredEndpoint | undefined> {
    const [endpoint] = await db.select().from(discoveredEndpoints).where(eq(discoveredEndpoints.id, id));
    return endpoint;
  },

  async updateDiscoveredEndpoint(this: DatabaseStorage, id: number, updates: Partial<InsertDiscoveredEndpoint>): Promise<DiscoveredEndpoint> {
    const [updated] = await db.update(discoveredEndpoints)
      .set(updates)
      .where(eq(discoveredEndpoints.id, id))
      .returning();
    return updated;
  },

  async bulkCreateDiscoveredEndpoints(this: DatabaseStorage, endpoints: Array<InsertDiscoveredEndpoint>): Promise<{ added: number; skipped: number }> {
    let added = 0;
    let skipped = 0;

    const existing = await db.select({ 
      state: discoveredEndpoints.state, 
      county: discoveredEndpoints.county, 
      baseUrl: discoveredEndpoints.baseUrl 
    }).from(discoveredEndpoints);
    const existingSet = new Set(existing.map(e => `${e.state.toUpperCase()}|${e.county.toLowerCase()}|${e.baseUrl.toLowerCase()}`));

    const { countyGisEndpoints } = await import('@shared/schema');
    const existingGis = await db.select({ 
      state: countyGisEndpoints.state, 
      county: countyGisEndpoints.county, 
      baseUrl: countyGisEndpoints.baseUrl 
    }).from(countyGisEndpoints);
    const gisSet = new Set(existingGis.map(e => `${e.state.toUpperCase()}|${e.county.toLowerCase()}|${e.baseUrl.toLowerCase()}`));

    for (const ep of endpoints) {
      const key = `${ep.state.toUpperCase()}|${ep.county.toLowerCase()}|${ep.baseUrl.toLowerCase()}`;
      if (existingSet.has(key) || gisSet.has(key)) {
        skipped++;
        continue;
      }

      try {
        await db.insert(discoveredEndpoints).values({
          ...ep,
          state: ep.state.toUpperCase(),
        });
        added++;
        existingSet.add(key);
      } catch (err: any) {
        if (err.code === '23505') {
          skipped++;
        } else {
          throw err;
        }
      }
    }

    return { added, skipped };
  },

  async approveDiscoveredEndpoint(this: DatabaseStorage, id: number): Promise<{ success: boolean; message: string }> {
    const endpoint = await this.getDiscoveredEndpoint(id);
    if (!endpoint) {
      return { success: false, message: "Endpoint not found" };
    }

    if (endpoint.status === "added") {
      return { success: false, message: "Endpoint already added" };
    }

    const { countyGisEndpoints } = await import('@shared/schema');
    
    const [existingGis] = await db.select()
      .from(countyGisEndpoints)
      .where(and(
        eq(countyGisEndpoints.state, endpoint.state),
        sql`LOWER(${countyGisEndpoints.county}) = LOWER(${endpoint.county})`,
        sql`LOWER(${countyGisEndpoints.baseUrl}) = LOWER(${endpoint.baseUrl})`
      ));

    if (existingGis) {
      await this.updateDiscoveredEndpoint(id, { status: "added" });
      return { success: false, message: "Endpoint already exists in GIS registry" };
    }

    await db.insert(countyGisEndpoints).values({
      state: endpoint.state,
      county: endpoint.county,
      baseUrl: endpoint.baseUrl,
      endpointType: endpoint.endpointType,
      isActive: true,
      isVerified: endpoint.healthCheckPassed || false,
      contributedBy: "discovery",
      notes: endpoint.serviceName ? `Service: ${endpoint.serviceName}` : undefined,
    });

    await this.updateDiscoveredEndpoint(id, { status: "added" });
    return { success: true, message: "Endpoint added to GIS registry" };
  },

  async rejectDiscoveredEndpoint(this: DatabaseStorage, id: number): Promise<DiscoveredEndpoint> {
    return await this.updateDiscoveredEndpoint(id, { status: "rejected" });
  },

  // Parcel Snapshots (Cache)
  //
  // ONE definition of "the same parcel" — shared/parcel/parcelRef.ts. Both
  // functions below used to carry a FOURTH competing normalisation (APN
  // stripped of "-" and whitespace then lower-cased), and `parcel_snapshots` is
  // the SAME TABLE `services/dueDiligence.ts` reads with the STRICT rule. The
  // two disagreed about live rows:
  //
  //   · APN punctuation — this file collapsed "12-345" and "12345" into one
  //     parcel; dueDiligence keeps them distinct. In a county where the
  //     separator is significant that is a WRONG MERGE, and a wrong merge in a
  //     data cache serves one parcel's acreage, zoning and owner for another.
  //   · The county suffix — this file stripped " County", dueDiligence did not,
  //     so a row written by one was invisible to the other.
  //   · This file disagreed WITH ITSELF: the JS normalisation used
  //     `/ county$/i` (case-insensitive) while the SQL used a case-SENSITIVE
  //     `REPLACE(county, ' County', '')`, so a row whose county was stored
  //     lower-case could not be found by the query that wrote it.
  //
  // The suffix rule now lives in parcelRef (it was open-coded at four sites),
  // so this reads exactly what dueDiligence reads.
  //
  // THE SQL STAYS SUFFIX-TOLERANT on purpose. Rows already in the table were
  // written un-normalised — the upsert below used to store `...data` verbatim,
  // so a county may be "Travis", "travis" or "Travis County". Matching only the
  // canonical form would orphan them into permanent cache misses. New writes
  // are normalised, so this tolerance is transitional, not the rule.
  async getParcelSnapshot(this: DatabaseStorage, apn: string, state: string, county: string, maxAgeDays: number = 30): Promise<ParcelSnapshot | undefined> {
    const ref = normalizeParcelRef({ state, county, apn });
    if (!ref.ok) {
      // A cache MISS, not an error: the caller re-fetches upstream and the
      // refusal costs one lookup. Guessing an identity would cost the wrong
      // parcel's data being served as this one's.
      logger.warn("[gisRepo] parcel snapshot lookup refused — unusable natural key", {
        metadata: { problems: ref.problems, __pii_safe: true },
      });
      return undefined;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

    const [snapshot] = await db
      .select()
      .from(parcelSnapshots)
      .where(
        and(
          // UPPER, punctuation PRESERVED — identical to dueDiligence.ts.
          sql`UPPER(${parcelSnapshots.apn}) = ${ref.ref.apn}`,
          eq(parcelSnapshots.state, ref.ref.state),
          countyMatches(ref.ref.county),
          gte(parcelSnapshots.fetchedAt, cutoffDate)
        )
      )
      .orderBy(desc(parcelSnapshots.fetchedAt))
      .limit(1);

    return snapshot;
  },

  async upsertParcelSnapshot(this: DatabaseStorage, data: InsertParcelSnapshot): Promise<ParcelSnapshot> {
    const ref = normalizeParcelRef({ state: data.state, county: data.county, apn: data.apn });
    if (!ref.ok) {
      // REFUSES rather than storing a row under a key nothing can find again.
      // The old code normalised for the LOOKUP but wrote `...data` verbatim, so
      // the stored key and the search key were different strings — which is how
      // one parcel accumulated several snapshots and each read saw a different
      // freshness.
      throw new Error(
        `upsertParcelSnapshot: unusable parcel natural key (${ref.problems.join(", ")})`,
      );
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const [existing] = await db
      .select()
      .from(parcelSnapshots)
      .where(
        and(
          sql`UPPER(${parcelSnapshots.apn}) = ${ref.ref.apn}`,
          eq(parcelSnapshots.state, ref.ref.state),
          countyMatches(ref.ref.county)
        )
      )
      .limit(1);

    // The NORMALISED triple is what gets stored, so the next lookup searches for
    // the string that is actually there. Spread first so these win over `data`.
    const normalized = {
      state: ref.ref.state,
      county: ref.ref.county,
      apn: ref.ref.apn,
    };

    if (existing) {
      const [updated] = await db
        .update(parcelSnapshots)
        .set({
          ...data,
          ...normalized,
          fetchedAt: new Date(),
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(parcelSnapshots.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(parcelSnapshots)
        .values({
          ...data,
          ...normalized,
          fetchedAt: new Date(),
          expiresAt,
        })
        .returning();
      return created;
    }
  },
};

export type GisRepo = typeof gisRepo;

/**
 * Which `parcel_snapshots` rows an organization may see.
 *
 * `organizationId` is nullable on this table and means "global/shared cache"
 * when null — so a correct read is "MY org's row OR the shared one", never
 * "whatever row matches this APN".
 *
 * ── WHY THIS IS A FUNCTION AND NOT A CONVENTION ─────────────────────────────
 * `dueDiligence.ts` already wrote that predicate by hand and got it right.
 * `propertyReportPdf.ts` (a customer-facing PDF) and `ltvMonitor.ts` (which
 * reads `assessedValue` to compute a loan's LTV) matched on
 * `apn + state + county` alone and took the most recent row, whoever owned it.
 *
 * No writer sets a non-null `organizationId` today, so nothing leaks yet — but
 * `dueDiligence`'s read is the codebase stating that tenant-owned rows are
 * intended, and the first one written would have been visible to every other
 * org through those two readers, silently. A hand-copied predicate that only
 * two of three sites copied is the same defect the operating predicate fixed in
 * `orgOperating.ts`.
 *
 * The tenancy linter cannot see this: `check-org-scoped-fetch` treats a
 * function as org-scoped when the string `organizationId` appears ANYWHERE in
 * its body, and both readers mention it for an unrelated query.
 */
export function parcelSnapshotVisibleTo(organizationId: number): SQL {
  return or(
    eq(parcelSnapshots.organizationId, organizationId),
    isNull(parcelSnapshots.organizationId),
  ) as SQL;
}
