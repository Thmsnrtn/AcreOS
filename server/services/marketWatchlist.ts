/**
 * T117 — Market Watchlist Service
 *
 * Users can "watch" specific counties and get alerts when:
 *   - New delinquent tax parcels appear
 *   - Land prices drop by a threshold %
 *   - Demand score increases (opportunity detected)
 *   - New foreclosure filings appear
 *
 * Integrates with the market prediction engine and deal hunter.
 *
 * Exposed via:
 *   GET  /api/market/watchlist               — get user's watchlist
 *   POST /api/market/watchlist               — add county to watchlist
 *   DELETE /api/market/watchlist/:id         — remove from watchlist
 *   GET  /api/market/watchlist/alerts        — recent alerts for watched markets
 *   POST /api/market/watchlist/:id/test      — test alert for a watched county
 *
 * DB-BACKED (Wave A "Nothing lies", founder ruling #12(c), 2026-07-29):
 * entries and alerts lived in module-level Maps/arrays with a per-process
 * `nextAlertId` — entries split across machines, alert ids collided, and
 * everything reset on deploy (deletion-ledger pin "Module-state residue",
 * audit 2026-07-07). Entries now live in `market_watchlist_entries`, alerts
 * in `market_watchlist_alerts`, and the alert id is the table's serial —
 * so it is `number`, not the old `alert-<n>` string.
 *
 * Storage is injectable so tests can prove state survives service
 * re-instantiation without a database; the default storage is Drizzle.
 */

import { db } from "../db";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { marketWatchlistEntries, marketWatchlistAlerts } from "@shared/schema";
import { logger } from "../utils/logger";

export interface WatchlistEntry {
  id: string;
  orgId: number;
  userId: string;
  state: string;
  county: string;
  // Alert thresholds
  alertOnTaxDelinquent: boolean;
  alertOnPriceDrop: boolean;
  priceDropThresholdPct: number; // e.g. 10 = alert when prices drop 10%
  alertOnDemandIncrease: boolean;
  demandScoreThreshold: number; // e.g. 70 = alert when demand >= 70
  alertOnForeclosure: boolean;
  // Notification channels
  emailAlert: boolean;
  pushAlert: boolean;
  // Status
  active: boolean;
  createdAt: Date;
  lastAlertAt?: Date;
}

export interface MarketAlert {
  /** Serial PK from `market_watchlist_alerts` (replaces the old colliding counter). */
  id: number;
  watchlistEntryId: string;
  state: string;
  county: string;
  type: "tax_delinquent" | "price_drop" | "demand_increase" | "foreclosure" | "opportunity";
  title: string;
  summary: string;
  severity: "low" | "medium" | "high";
  data?: Record<string, any>;
  createdAt: Date;
  read: boolean;
}

/** Fields a caller may change on an existing entry. */
export type WatchlistEntryUpdates = Partial<
  Pick<
    WatchlistEntry,
    | "userId"
    | "state"
    | "county"
    | "alertOnTaxDelinquent"
    | "alertOnPriceDrop"
    | "priceDropThresholdPct"
    | "alertOnDemandIncrease"
    | "demandScoreThreshold"
    | "alertOnForeclosure"
    | "emailAlert"
    | "pushAlert"
    | "active"
    | "lastAlertAt"
  >
>;

/**
 * Persistence seam. The DB is the source of truth — no watchlist entry or
 * alert may live only in process memory.
 */
export interface MarketWatchlistStorage {
  listEntries(orgId: number): Promise<WatchlistEntry[]>;
  getEntry(entryId: string): Promise<WatchlistEntry | undefined>;
  /** Add-is-upsert: re-adding the same county overwrites its thresholds. */
  upsertEntry(entry: Omit<WatchlistEntry, "lastAlertAt">): Promise<WatchlistEntry>;
  updateEntry(entryId: string, updates: WatchlistEntryUpdates): Promise<WatchlistEntry | undefined>;
  deleteEntry(entryId: string): Promise<void>;
  insertAlert(alert: Omit<MarketAlert, "id" | "createdAt"> & { orgId: number }): Promise<MarketAlert>;
  listAlerts(orgId: number, limit: number): Promise<MarketAlert[]>;
  markAlertsRead(orgId: number, alertIds: number[]): Promise<void>;
  countUnreadAlerts(orgId: number): Promise<number>;
}

// ─── Default Drizzle-backed storage ───────────────────────────────────────────

type EntryRow = typeof marketWatchlistEntries.$inferSelect;
type AlertRow = typeof marketWatchlistAlerts.$inferSelect;

function rowToEntry(row: EntryRow): WatchlistEntry {
  return {
    id: row.id,
    orgId: row.organizationId,
    userId: row.userId,
    state: row.state,
    county: row.county,
    alertOnTaxDelinquent: row.alertOnTaxDelinquent,
    alertOnPriceDrop: row.alertOnPriceDrop,
    priceDropThresholdPct: row.priceDropThresholdPct,
    alertOnDemandIncrease: row.alertOnDemandIncrease,
    demandScoreThreshold: row.demandScoreThreshold,
    alertOnForeclosure: row.alertOnForeclosure,
    emailAlert: row.emailAlert,
    pushAlert: row.pushAlert,
    active: row.active,
    createdAt: row.createdAt,
    ...(row.lastAlertAt ? { lastAlertAt: row.lastAlertAt } : {}),
  };
}

function rowToAlert(row: AlertRow): MarketAlert {
  return {
    id: row.id,
    watchlistEntryId: row.entryId,
    state: row.state,
    county: row.county,
    type: row.type as MarketAlert["type"],
    title: row.title,
    summary: row.summary,
    severity: row.severity as MarketAlert["severity"],
    ...(row.data ? { data: row.data } : {}),
    createdAt: row.createdAt,
    read: row.read,
  };
}

export const drizzleMarketWatchlistStorage: MarketWatchlistStorage = {
  async listEntries(orgId) {
    const rows = await db
      .select()
      .from(marketWatchlistEntries)
      .where(eq(marketWatchlistEntries.organizationId, orgId))
      .orderBy(desc(marketWatchlistEntries.createdAt));
    return rows.map(rowToEntry);
  },

  async getEntry(entryId) {
    const [row] = await db
      .select()
      .from(marketWatchlistEntries)
      .where(eq(marketWatchlistEntries.id, entryId))
      .limit(1);
    return row ? rowToEntry(row) : undefined;
  },

  async upsertEntry(entry) {
    const values = {
      id: entry.id,
      organizationId: entry.orgId,
      userId: entry.userId,
      state: entry.state,
      county: entry.county,
      alertOnTaxDelinquent: entry.alertOnTaxDelinquent,
      alertOnPriceDrop: entry.alertOnPriceDrop,
      priceDropThresholdPct: entry.priceDropThresholdPct,
      alertOnDemandIncrease: entry.alertOnDemandIncrease,
      demandScoreThreshold: entry.demandScoreThreshold,
      alertOnForeclosure: entry.alertOnForeclosure,
      emailAlert: entry.emailAlert,
      pushAlert: entry.pushAlert,
      active: entry.active,
      createdAt: entry.createdAt,
    };
    const [row] = await db
      .insert(marketWatchlistEntries)
      .values(values)
      .onConflictDoUpdate({
        target: marketWatchlistEntries.id,
        set: {
          userId: values.userId,
          state: values.state,
          county: values.county,
          alertOnTaxDelinquent: values.alertOnTaxDelinquent,
          alertOnPriceDrop: values.alertOnPriceDrop,
          priceDropThresholdPct: values.priceDropThresholdPct,
          alertOnDemandIncrease: values.alertOnDemandIncrease,
          demandScoreThreshold: values.demandScoreThreshold,
          alertOnForeclosure: values.alertOnForeclosure,
          emailAlert: values.emailAlert,
          pushAlert: values.pushAlert,
          active: values.active,
        },
      })
      .returning();
    return rowToEntry(row);
  },

  async updateEntry(entryId, updates) {
    const set: Record<string, unknown> = {};
    if (updates.userId !== undefined) set.userId = updates.userId;
    if (updates.state !== undefined) set.state = updates.state;
    if (updates.county !== undefined) set.county = updates.county;
    if (updates.alertOnTaxDelinquent !== undefined) set.alertOnTaxDelinquent = updates.alertOnTaxDelinquent;
    if (updates.alertOnPriceDrop !== undefined) set.alertOnPriceDrop = updates.alertOnPriceDrop;
    if (updates.priceDropThresholdPct !== undefined) set.priceDropThresholdPct = updates.priceDropThresholdPct;
    if (updates.alertOnDemandIncrease !== undefined) set.alertOnDemandIncrease = updates.alertOnDemandIncrease;
    if (updates.demandScoreThreshold !== undefined) set.demandScoreThreshold = updates.demandScoreThreshold;
    if (updates.alertOnForeclosure !== undefined) set.alertOnForeclosure = updates.alertOnForeclosure;
    if (updates.emailAlert !== undefined) set.emailAlert = updates.emailAlert;
    if (updates.pushAlert !== undefined) set.pushAlert = updates.pushAlert;
    if (updates.active !== undefined) set.active = updates.active;
    if (updates.lastAlertAt !== undefined) set.lastAlertAt = updates.lastAlertAt;

    if (Object.keys(set).length === 0) {
      return this.getEntry(entryId);
    }

    const [row] = await db
      .update(marketWatchlistEntries)
      .set(set)
      .where(eq(marketWatchlistEntries.id, entryId))
      .returning();
    return row ? rowToEntry(row) : undefined;
  },

  async deleteEntry(entryId) {
    await db.delete(marketWatchlistEntries).where(eq(marketWatchlistEntries.id, entryId));
  },

  async insertAlert(alert) {
    const [row] = await db
      .insert(marketWatchlistAlerts)
      .values({
        entryId: alert.watchlistEntryId,
        organizationId: alert.orgId,
        state: alert.state,
        county: alert.county,
        type: alert.type,
        title: alert.title,
        summary: alert.summary,
        severity: alert.severity,
        data: alert.data ?? null,
        read: alert.read,
      })
      .returning();
    return rowToAlert(row);
  },

  async listAlerts(orgId, limit) {
    const rows = await db
      .select()
      .from(marketWatchlistAlerts)
      .where(eq(marketWatchlistAlerts.organizationId, orgId))
      .orderBy(desc(marketWatchlistAlerts.createdAt))
      .limit(limit);
    return rows.map(rowToAlert);
  },

  async markAlertsRead(orgId, alertIds) {
    if (alertIds.length === 0) return;
    await db
      .update(marketWatchlistAlerts)
      .set({ read: true })
      .where(
        and(
          eq(marketWatchlistAlerts.organizationId, orgId),
          inArray(marketWatchlistAlerts.id, alertIds),
        ),
      );
  },

  async countUnreadAlerts(orgId) {
    const [row] = await db
      .select({ n: count() })
      .from(marketWatchlistAlerts)
      .where(
        and(
          eq(marketWatchlistAlerts.organizationId, orgId),
          eq(marketWatchlistAlerts.read, false),
        ),
      );
    return Number(row?.n ?? 0);
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntryId(orgId: number, state: string, county: string) {
  return `${orgId}:${state}:${county}`.toLowerCase();
}

/** Route bodies are untyped JSON — coerce alert ids to the serial's number. */
function toAlertIds(raw: Array<number | string>): number[] {
  const ids: number[] = [];
  for (const value of raw) {
    const n = typeof value === "number" ? value : parseInt(String(value), 10);
    if (Number.isInteger(n)) ids.push(n);
  }
  return ids;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class MarketWatchlistService {
  private readonly storage: MarketWatchlistStorage;

  constructor(storage: MarketWatchlistStorage = drizzleMarketWatchlistStorage) {
    this.storage = storage;
  }

  /**
   * Get all watchlist entries for an org.
   */
  async getWatchlist(orgId: number): Promise<WatchlistEntry[]> {
    return this.storage.listEntries(orgId);
  }

  /**
   * Add a county to the watchlist. Re-adding the same county updates it.
   */
  async addToWatchlist(
    orgId: number,
    userId: string,
    data: {
      state: string;
      county: string;
      alertOnTaxDelinquent?: boolean;
      alertOnPriceDrop?: boolean;
      priceDropThresholdPct?: number;
      alertOnDemandIncrease?: boolean;
      demandScoreThreshold?: number;
      alertOnForeclosure?: boolean;
      emailAlert?: boolean;
      pushAlert?: boolean;
    }
  ): Promise<WatchlistEntry> {
    const id = makeEntryId(orgId, data.state, data.county);
    return this.storage.upsertEntry({
      id,
      orgId,
      userId,
      state: data.state.toUpperCase(),
      county: data.county,
      alertOnTaxDelinquent: data.alertOnTaxDelinquent ?? true,
      alertOnPriceDrop: data.alertOnPriceDrop ?? true,
      priceDropThresholdPct: data.priceDropThresholdPct ?? 10,
      alertOnDemandIncrease: data.alertOnDemandIncrease ?? true,
      demandScoreThreshold: data.demandScoreThreshold ?? 70,
      alertOnForeclosure: data.alertOnForeclosure ?? true,
      emailAlert: data.emailAlert ?? true,
      pushAlert: data.pushAlert ?? true,
      active: true,
      createdAt: new Date(),
    });
  }

  /**
   * Update a watchlist entry. Org-scoped — a foreign entry reads as missing.
   */
  async updateEntry(
    orgId: number,
    entryId: string,
    updates: WatchlistEntryUpdates
  ): Promise<WatchlistEntry | null> {
    const entry = await this.storage.getEntry(entryId);
    if (!entry || entry.orgId !== orgId) return null;
    const updated = await this.storage.updateEntry(entryId, updates);
    return updated ?? null;
  }

  /**
   * Remove a county from the watchlist.
   */
  async removeFromWatchlist(orgId: number, entryId: string): Promise<boolean> {
    const entry = await this.storage.getEntry(entryId);
    if (!entry || entry.orgId !== orgId) return false;
    await this.storage.deleteEntry(entryId);
    return true;
  }

  /**
   * Get recent market alerts for an org's watchlist.
   */
  async getAlerts(orgId: number, limit = 50): Promise<MarketAlert[]> {
    return this.storage.listAlerts(orgId, limit);
  }

  /**
   * Mark alerts as read. Only the org's own alerts are touched.
   */
  async markAlertsRead(orgId: number, alertIds: Array<number | string>): Promise<void> {
    await this.storage.markAlertsRead(orgId, toAlertIds(alertIds));
  }

  /**
   * Fire a test alert for a watchlist entry.
   */
  async testAlert(orgId: number, entryId: string): Promise<MarketAlert | null> {
    const entry = await this.storage.getEntry(entryId);
    if (!entry || entry.orgId !== orgId) return null;

    return this.emitAlert(entry, {
      type: "opportunity",
      title: `Test Alert: ${entry.county}, ${entry.state}`,
      summary: `This is a test alert for your ${entry.county} County, ${entry.state} watchlist. Real alerts will appear here when market conditions match your thresholds.`,
      severity: "low",
    });
  }

  /**
   * Trigger an alert programmatically (called by market prediction engine).
   */
  async triggerAlert(
    entryId: string,
    type: MarketAlert["type"],
    title: string,
    summary: string,
    severity: MarketAlert["severity"],
    data?: Record<string, any>
  ): Promise<MarketAlert | null> {
    const entry = await this.storage.getEntry(entryId);
    if (!entry || !entry.active) return null;
    return this.emitAlert(entry, { type, title, summary, severity, data });
  }

  /**
   * Get unread alert count for an org.
   */
  async getUnreadCount(orgId: number): Promise<number> {
    return this.storage.countUnreadAlerts(orgId);
  }

  private async emitAlert(
    entry: WatchlistEntry,
    fields: {
      type: MarketAlert["type"];
      title: string;
      summary: string;
      severity: MarketAlert["severity"];
      data?: Record<string, any>;
    }
  ): Promise<MarketAlert> {
    const alert = await this.storage.insertAlert({
      orgId: entry.orgId,
      watchlistEntryId: entry.id,
      state: entry.state,
      county: entry.county,
      type: fields.type,
      title: fields.title,
      summary: fields.summary,
      severity: fields.severity,
      ...(fields.data !== undefined ? { data: fields.data } : {}),
      read: false,
    });
    await this.storage.updateEntry(entry.id, { lastAlertAt: alert.createdAt });
    logger.info("market_watchlist.alert_fired", {
      alertId: alert.id,
      entryId: entry.id,
      orgId: entry.orgId,
      type: alert.type,
      severity: alert.severity,
    });
    return alert;
  }
}

/** Default service — Drizzle-backed. */
export const marketWatchlistService = new MarketWatchlistService();
