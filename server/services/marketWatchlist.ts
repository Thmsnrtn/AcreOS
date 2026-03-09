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
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

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
  id: string;
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

// In-memory store
const watchlistEntries = new Map<string, WatchlistEntry>();
const marketAlerts: MarketAlert[] = [];
let nextAlertId = 1;

function makeEntryId(orgId: number, state: string, county: string) {
  return `${orgId}:${state}:${county}`.toLowerCase();
}

export const marketWatchlistService = {
  /**
   * Get all watchlist entries for an org.
   */
  getWatchlist(orgId: number): WatchlistEntry[] {
    return Array.from(watchlistEntries.values()).filter(e => e.orgId === orgId);
  },

  /**
   * Add a county to the watchlist.
   */
  addToWatchlist(
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
  ): WatchlistEntry {
    const id = makeEntryId(orgId, data.state, data.county);
    const entry: WatchlistEntry = {
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
    };
    watchlistEntries.set(id, entry);
    return entry;
  },

  /**
   * Update a watchlist entry.
   */
  updateEntry(orgId: number, entryId: string, updates: Partial<WatchlistEntry>): WatchlistEntry | null {
    const entry = watchlistEntries.get(entryId);
    if (!entry || entry.orgId !== orgId) return null;
    const updated = { ...entry, ...updates };
    watchlistEntries.set(entryId, updated);
    return updated;
  },

  /**
   * Remove a county from the watchlist.
   */
  removeFromWatchlist(orgId: number, entryId: string): boolean {
    const entry = watchlistEntries.get(entryId);
    if (!entry || entry.orgId !== orgId) return false;
    watchlistEntries.delete(entryId);
    return true;
  },

  /**
   * Get recent market alerts for an org's watchlist.
   */
  getAlerts(orgId: number, limit = 50): MarketAlert[] {
    const entryIds = new Set(
      Array.from(watchlistEntries.values())
        .filter(e => e.orgId === orgId)
        .map(e => e.id)
    );
    return marketAlerts
      .filter(a => entryIds.has(a.watchlistEntryId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  },

  /**
   * Mark alerts as read.
   */
  markAlertsRead(orgId: number, alertIds: string[]): void {
    const entryIds = new Set(
      Array.from(watchlistEntries.values())
        .filter(e => e.orgId === orgId)
        .map(e => e.id)
    );
    for (const alert of marketAlerts) {
      if (alertIds.includes(alert.id) && entryIds.has(alert.watchlistEntryId)) {
        alert.read = true;
      }
    }
  },

  /**
   * Fire a test alert for a watchlist entry.
   */
  testAlert(orgId: number, entryId: string): MarketAlert | null {
    const entry = watchlistEntries.get(entryId);
    if (!entry || entry.orgId !== orgId) return null;

    const alert: MarketAlert = {
      id: `alert-${nextAlertId++}`,
      watchlistEntryId: entryId,
      state: entry.state,
      county: entry.county,
      type: "opportunity",
      title: `Test Alert: ${entry.county}, ${entry.state}`,
      summary: `This is a test alert for your ${entry.county} County, ${entry.state} watchlist. Real alerts will appear here when market conditions match your thresholds.`,
      severity: "low",
      createdAt: new Date(),
      read: false,
    };
    marketAlerts.push(alert);
    entry.lastAlertAt = new Date();
    watchlistEntries.set(entryId, entry);
    return alert;
  },

  /**
   * Trigger an alert programmatically (called by market prediction engine).
   */
  triggerAlert(
    entryId: string,
    type: MarketAlert["type"],
    title: string,
    summary: string,
    severity: MarketAlert["severity"],
    data?: Record<string, any>
  ): MarketAlert | null {
    const entry = watchlistEntries.get(entryId);
    if (!entry || !entry.active) return null;

    const alert: MarketAlert = {
      id: `alert-${nextAlertId++}`,
      watchlistEntryId: entryId,
      state: entry.state,
      county: entry.county,
      type,
      title,
      summary,
      severity,
      data,
      createdAt: new Date(),
      read: false,
    };
    marketAlerts.push(alert);
    entry.lastAlertAt = new Date();
    watchlistEntries.set(entryId, entry);
    return alert;
  },

  /**
   * Get unread alert count for an org.
   */
  getUnreadCount(orgId: number): number {
    const entryIds = new Set(
      Array.from(watchlistEntries.values())
        .filter(e => e.orgId === orgId)
        .map(e => e.id)
    );
    return marketAlerts.filter(a => entryIds.has(a.watchlistEntryId) && !a.read).length;
  },
};
