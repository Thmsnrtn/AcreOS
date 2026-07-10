// GIS + data-source data layer: county GIS endpoints (bulk seeding +
// updates), the free-data endpoint registry (data sources + stats), the
// data-source cache, live GIS discovery (discovered endpoints with the
// approve/reject flow), and parcel snapshots. Extracted from the god-class
// server/storage.ts in the storage refactor. Methods are merged into
// DatabaseStorage.prototype at construction time; `this` refers to the full
// DatabaseStorage instance.

import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
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
import type { DatabaseStorage } from "../storage";

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
  async getParcelSnapshot(this: DatabaseStorage, apn: string, state: string, county: string, maxAgeDays: number = 30): Promise<ParcelSnapshot | undefined> {
    const normalizedApn = apn.replace(/[-\s]/g, "").toLowerCase();
    const normalizedState = state.toUpperCase();
    const normalizedCounty = county.toLowerCase().replace(/ county$/i, "").trim();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    
    const [snapshot] = await db
      .select()
      .from(parcelSnapshots)
      .where(
        and(
          sql`LOWER(REPLACE(REPLACE(${parcelSnapshots.apn}, '-', ''), ' ', '')) = ${normalizedApn}`,
          eq(parcelSnapshots.state, normalizedState),
          sql`LOWER(REPLACE(${parcelSnapshots.county}, ' County', '')) = ${normalizedCounty}`,
          gte(parcelSnapshots.fetchedAt, cutoffDate)
        )
      )
      .orderBy(desc(parcelSnapshots.fetchedAt))
      .limit(1);
    
    return snapshot;
  },

  async upsertParcelSnapshot(this: DatabaseStorage, data: InsertParcelSnapshot): Promise<ParcelSnapshot> {
    const normalizedApn = data.apn.replace(/[-\s]/g, "");
    const normalizedState = data.state.toUpperCase();
    const normalizedCounty = data.county.toLowerCase().replace(/ county$/i, "").trim();
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    
    const [existing] = await db
      .select()
      .from(parcelSnapshots)
      .where(
        and(
          sql`LOWER(REPLACE(REPLACE(${parcelSnapshots.apn}, '-', ''), ' ', '')) = ${normalizedApn.toLowerCase()}`,
          eq(parcelSnapshots.state, normalizedState),
          sql`LOWER(REPLACE(${parcelSnapshots.county}, ' County', '')) = ${normalizedCounty}`
        )
      )
      .limit(1);
    
    if (existing) {
      const [updated] = await db
        .update(parcelSnapshots)
        .set({
          ...data,
          state: normalizedState,
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
          state: normalizedState,
          fetchedAt: new Date(),
          expiresAt,
        })
        .returning();
      return created;
    }
  },
};

export type GisRepo = typeof gisRepo;
