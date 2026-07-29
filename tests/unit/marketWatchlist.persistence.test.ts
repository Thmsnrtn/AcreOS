/**
 * Market Watchlist — persistence tests (Wave A "Nothing lies", ruling #12(c)).
 *
 * The service used to keep entries in a module-level Map, alerts in a
 * module-level array, and alert ids in a per-process `nextAlertId` counter —
 * so entries split across machines, ids collided, and everything reset on
 * deploy. These tests pin the replacement: state lives in the storage seam,
 * a FRESH service instance (stand-in for a restart / second machine) sees
 * everything the previous one wrote, and alert ids come from the table's
 * serial rather than a counter that restarts at 1.
 *
 * No DATABASE_URL here: the seam is exercised with an in-memory fake that
 * mimics the Postgres tables.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  MarketWatchlistService,
  type MarketWatchlistStorage,
  type WatchlistEntry,
  type MarketAlert,
} from "../../server/services/marketWatchlist";

// ── In-memory stand-in for market_watchlist_entries / _alerts ────────────────
// Deliberately OUTSIDE any service instance — it is the "database".

function makeFakeStorage() {
  const entries = new Map<string, WatchlistEntry>();
  const alerts: MarketAlert[] = [];
  const alertOrg = new Map<number, number>(); // alert id → organization_id
  let serial = 0; // the table's SERIAL, not a per-process counter

  const storage: MarketWatchlistStorage = {
    async listEntries(orgId) {
      return Array.from(entries.values())
        .filter((e) => e.orgId === orgId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((e) => ({ ...e }));
    },
    async getEntry(entryId) {
      const e = entries.get(entryId);
      return e ? { ...e } : undefined;
    },
    async upsertEntry(entry) {
      const existing = entries.get(entry.id);
      const merged: WatchlistEntry = {
        ...entry,
        // ON CONFLICT DO UPDATE leaves created_at / last_alert_at alone.
        createdAt: existing?.createdAt ?? entry.createdAt,
        ...(existing?.lastAlertAt ? { lastAlertAt: existing.lastAlertAt } : {}),
      };
      entries.set(entry.id, merged);
      return { ...merged };
    },
    async updateEntry(entryId, updates) {
      const existing = entries.get(entryId);
      if (!existing) return undefined;
      const updated = { ...existing, ...updates };
      entries.set(entryId, updated);
      return { ...updated };
    },
    async deleteEntry(entryId) {
      entries.delete(entryId);
      // ON DELETE CASCADE
      for (let i = alerts.length - 1; i >= 0; i--) {
        if (alerts[i].watchlistEntryId === entryId) {
          alertOrg.delete(alerts[i].id);
          alerts.splice(i, 1);
        }
      }
    },
    async insertAlert(alert) {
      const row: MarketAlert = {
        id: ++serial,
        watchlistEntryId: alert.watchlistEntryId,
        state: alert.state,
        county: alert.county,
        type: alert.type,
        title: alert.title,
        summary: alert.summary,
        severity: alert.severity,
        ...(alert.data !== undefined ? { data: alert.data } : {}),
        createdAt: new Date(),
        read: alert.read,
      };
      alerts.push(row);
      alertOrg.set(row.id, alert.orgId);
      return { ...row };
    },
    async listAlerts(orgId, limit) {
      return alerts
        .filter((a) => alertOrg.get(a.id) === orgId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
        .slice(0, limit)
        .map((a) => ({ ...a }));
    },
    async markAlertsRead(orgId, alertIds) {
      for (const a of alerts) {
        if (alertOrg.get(a.id) === orgId && alertIds.includes(a.id)) a.read = true;
      }
    },
    async countUnreadAlerts(orgId) {
      return alerts.filter((a) => alertOrg.get(a.id) === orgId && !a.read).length;
    },
  };

  return { storage, allAlertIds: () => alerts.map((a) => a.id) };
}

const ADD = { state: "tx", county: "Brewster" };

describe("MarketWatchlistService — state survives re-instantiation", () => {
  let fake: ReturnType<typeof makeFakeStorage>;

  beforeEach(() => {
    fake = makeFakeStorage();
  });

  it("a fresh service sees entries added by a previous one", async () => {
    const first = new MarketWatchlistService(fake.storage);
    const created = await first.addToWatchlist(7, "user-1", ADD);

    // Simulate a restart / second machine.
    const second = new MarketWatchlistService(fake.storage);
    const list = await second.getWatchlist(7);

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
    expect(list[0].state).toBe("TX");
    expect(list[0].county).toBe("Brewster");
    expect(list[0].active).toBe(true);
  });

  it("keeps the historical natural-key entry id so client-held ids still resolve", async () => {
    const svc = new MarketWatchlistService(fake.storage);
    const entry = await svc.addToWatchlist(42, "user-1", ADD);
    expect(entry.id).toBe("42:tx:brewster");

    // A different instance can look it up by that same id.
    expect(await new MarketWatchlistService(fake.storage).updateEntry(42, "42:tx:brewster", { active: false })).not.toBeNull();
  });

  it("re-adding the same county is an upsert, not a duplicate", async () => {
    const svc = new MarketWatchlistService(fake.storage);
    await svc.addToWatchlist(7, "user-1", { ...ADD, priceDropThresholdPct: 10 });
    await new MarketWatchlistService(fake.storage).addToWatchlist(7, "user-1", { ...ADD, priceDropThresholdPct: 25 });

    const list = await new MarketWatchlistService(fake.storage).getWatchlist(7);
    expect(list).toHaveLength(1);
    expect(list[0].priceDropThresholdPct).toBe(25);
  });

  it("alerts fired by one instance are visible to the next", async () => {
    const machineA = new MarketWatchlistService(fake.storage);
    const entry = await machineA.addToWatchlist(7, "user-1", ADD);
    const alert = await machineA.testAlert(7, entry.id);
    expect(alert).not.toBeNull();

    const machineB = new MarketWatchlistService(fake.storage);
    const alerts = await machineB.getAlerts(7);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe(alert!.id);
    expect(alerts[0].read).toBe(false);
    expect(await machineB.getUnreadCount(7)).toBe(1);
  });

  it("alert ids come from the table serial — a restart does NOT restart the counter", async () => {
    const entry = await new MarketWatchlistService(fake.storage).addToWatchlist(7, "user-1", ADD);

    // Three different "processes", each firing one alert.
    await new MarketWatchlistService(fake.storage).testAlert(7, entry.id);
    await new MarketWatchlistService(fake.storage).testAlert(7, entry.id);
    await new MarketWatchlistService(fake.storage).testAlert(7, entry.id);

    const ids = fake.allAlertIds();
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3); // no collisions
    expect(ids).toEqual([...ids].sort((a, b) => a - b)); // monotonic
  });

  it("firing an alert stamps lastAlertAt on the entry, durably", async () => {
    const svc = new MarketWatchlistService(fake.storage);
    const entry = await svc.addToWatchlist(7, "user-1", ADD);
    expect(entry.lastAlertAt).toBeUndefined();

    await svc.testAlert(7, entry.id);

    const [reloaded] = await new MarketWatchlistService(fake.storage).getWatchlist(7);
    expect(reloaded.lastAlertAt).toBeInstanceOf(Date);
  });

  it("marks alerts read across instances, and only for the owning org", async () => {
    const svc = new MarketWatchlistService(fake.storage);
    const mine = await svc.addToWatchlist(7, "user-1", ADD);
    const theirs = await svc.addToWatchlist(9, "user-2", { state: "nm", county: "Catron" });
    const myAlert = (await svc.testAlert(7, mine.id))!;
    const theirAlert = (await svc.testAlert(9, theirs.id))!;

    // Org 9 tries to mark org 7's alert read — must be a no-op.
    await new MarketWatchlistService(fake.storage).markAlertsRead(9, [myAlert.id]);
    expect(await new MarketWatchlistService(fake.storage).getUnreadCount(7)).toBe(1);

    await new MarketWatchlistService(fake.storage).markAlertsRead(7, [myAlert.id]);
    expect(await new MarketWatchlistService(fake.storage).getUnreadCount(7)).toBe(0);
    expect(await new MarketWatchlistService(fake.storage).getUnreadCount(9)).toBe(1);
    expect(theirAlert.read).toBe(false);
  });

  it("accepts string alert ids from untyped route bodies", async () => {
    const svc = new MarketWatchlistService(fake.storage);
    const entry = await svc.addToWatchlist(7, "user-1", ADD);
    const alert = (await svc.testAlert(7, entry.id))!;

    await new MarketWatchlistService(fake.storage).markAlertsRead(7, [String(alert.id), "not-a-number"]);
    expect(await svc.getUnreadCount(7)).toBe(0);
  });
});

describe("MarketWatchlistService — org scoping", () => {
  let fake: ReturnType<typeof makeFakeStorage>;

  beforeEach(() => {
    fake = makeFakeStorage();
  });

  it("never returns, updates, or removes another org's entry", async () => {
    const svc = new MarketWatchlistService(fake.storage);
    const theirs = await svc.addToWatchlist(9, "user-2", ADD);

    expect(await svc.getWatchlist(7)).toEqual([]);
    expect(await svc.updateEntry(7, theirs.id, { active: false })).toBeNull();
    expect(await svc.removeFromWatchlist(7, theirs.id)).toBe(false);
    expect(await svc.testAlert(7, theirs.id)).toBeNull();

    // Still intact and untouched for its real owner.
    const [still] = await new MarketWatchlistService(fake.storage).getWatchlist(9);
    expect(still.active).toBe(true);
  });

  it("removal is durable and cascades to the entry's alerts", async () => {
    const svc = new MarketWatchlistService(fake.storage);
    const entry = await svc.addToWatchlist(7, "user-1", ADD);
    await svc.testAlert(7, entry.id);

    expect(await new MarketWatchlistService(fake.storage).removeFromWatchlist(7, entry.id)).toBe(true);

    const after = new MarketWatchlistService(fake.storage);
    expect(await after.getWatchlist(7)).toEqual([]);
    expect(await after.getAlerts(7)).toEqual([]);
    expect(await after.getUnreadCount(7)).toBe(0);
  });
});

describe("MarketWatchlistService — triggerAlert (prediction-engine entry point)", () => {
  it("writes a durable alert for an active entry and refuses an inactive one", async () => {
    const fake = makeFakeStorage();
    const svc = new MarketWatchlistService(fake.storage);
    const entry = await svc.addToWatchlist(7, "user-1", ADD);

    const alert = await svc.triggerAlert(
      entry.id,
      "tax_delinquent",
      "12 new delinquent parcels",
      "Brewster County posted 12 new tax-delinquent parcels.",
      "high",
      { parcelCount: 12 },
    );
    expect(alert).not.toBeNull();
    expect(alert!.type).toBe("tax_delinquent");
    expect(alert!.data).toEqual({ parcelCount: 12 });

    // Visible to a fresh instance.
    expect(await new MarketWatchlistService(fake.storage).getAlerts(7)).toHaveLength(1);

    await svc.updateEntry(7, entry.id, { active: false });
    expect(await svc.triggerAlert(entry.id, "price_drop", "t", "s", "low")).toBeNull();
    expect(await new MarketWatchlistService(fake.storage).getAlerts(7)).toHaveLength(1);
  });

  it("returns null for an unknown entry rather than inventing one", async () => {
    const fake = makeFakeStorage();
    const svc = new MarketWatchlistService(fake.storage);
    expect(await svc.triggerAlert("nope", "price_drop", "t", "s", "low")).toBeNull();
  });
});
