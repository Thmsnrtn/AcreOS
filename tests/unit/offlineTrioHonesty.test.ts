// @vitest-environment jsdom
/**
 * EL-P1 Wave 0 Batch 1 — the offline trio (A11-01/02/03).
 *
 * These tests FAIL on the pre-fix tree and PASS after the cure:
 *
 *  A11-01 — client/public/sw.js and client/src/hooks/useOfflineSync.ts
 *    both opened IndexedDB 'acreos-offline' at version 2 with disjoint
 *    stores (SW: 'pending-requests'; hook: 'cache' + 'mutations').
 *    Whichever opener ran first created only its own stores; the other
 *    side's transactions then failed forever. Cure: both sides at
 *    version 3, both upgrade paths create ALL THREE stores.
 *
 *  A11-02 — SW replay was bound to `self.addEventListener('online', …)`,
 *    an event service workers never receive. Cure: replay is triggered
 *    by a BackgroundSync 'sync' event and by a 'REPLAY_OFFLINE_QUEUE'
 *    postMessage sent from the app's window 'online' handler.
 *
 *  A11-03 — DriveMode treated the SW's 202 {offline:true, queued:true}
 *    queue receipt as a save, toasting "Lead saved" over an undefined
 *    leadId. Cure: DriveMode branches on isOfflineQueuedResponse()
 *    BEFORE constructing a SavedLead and reports the stop as queued.
 *
 * sw.js is a static asset with no module harness, so its legs are
 * source-level pins (the repo's established pattern for SW assertions,
 * cf. dayThreeSixtyFiveReliability.test.ts). The queued-response
 * classifier is a real imported unit and is exercised behaviourally.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isOfflineQueuedResponse } from "../../client/src/hooks/useOfflineSync";

const repoRoot = resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(resolve(repoRoot, rel), "utf8");

const sw = read("client/public/sw.js");
const hook = read("client/src/hooks/useOfflineSync.ts");
const driveMode = read("client/src/components/mobile/DriveMode.tsx");

function versionOf(src: string, pattern: RegExp): number {
  const m = src.match(pattern);
  if (!m) throw new Error("version constant not found");
  return Number(m[1]);
}

describe("A11-01 — one shared IndexedDB schema", () => {
  it("SW and app hook open the same DB name at the same version (>2)", () => {
    expect(sw).toMatch(/OFFLINE_DB_NAME = 'acreos-offline'/);
    expect(hook).toMatch(/DB_NAME = 'acreos-offline'/);
    const swVersion = versionOf(sw, /OFFLINE_DB_VERSION = (\d+)/);
    const hookVersion = versionOf(hook, /DB_VERSION = (\d+)/);
    expect(hookVersion).toBe(swVersion);
    // v2 was the colliding schema; the cure must move past it so
    // existing v2 databases actually run an upgrade.
    expect(swVersion).toBeGreaterThan(2);
  });

  it("the SW upgrade path creates all three stores", () => {
    for (const store of ["pending-requests", "'cache'", "'mutations'"]) {
      expect(sw).toContain(store);
    }
    expect(sw).toMatch(/createObjectStore\('cache', \{ keyPath: 'key' \}\)/);
    expect(sw).toMatch(/createObjectStore\('mutations', \{ keyPath: 'id' \}\)/);
    expect(sw).toMatch(/createObjectStore\(OFFLINE_STORE, \{ autoIncrement: true \}\)/);
  });

  it("the app hook upgrade path creates all three stores", () => {
    expect(hook).toMatch(/createObjectStore\('cache', \{ keyPath: 'key' \}\)/);
    expect(hook).toMatch(/createObjectStore\('mutations', \{ keyPath: 'id' \}\)/);
    expect(hook).toMatch(/createObjectStore\('pending-requests', \{ autoIncrement: true \}\)/);
  });

  it("use-offline-storage keeps its own separate DB (no third collision)", () => {
    const storage = read("client/src/hooks/use-offline-storage.ts");
    expect(storage).toMatch(/IDB_NAME = "acreos-storage"/);
  });
});

describe("A11-02 — replay has a trigger that can actually fire", () => {
  it("the SW does NOT listen for the dead 'online' event", () => {
    expect(sw).not.toMatch(/addEventListener\('online'/);
  });

  it("the SW replays on BackgroundSync and on the app's postMessage", () => {
    expect(sw).toMatch(/addEventListener\('sync'/);
    expect(sw).toContain("acreos-offline-replay");
    expect(sw).toContain("REPLAY_OFFLINE_QUEUE");
    expect(sw).toMatch(/REPLAY_OFFLINE_QUEUE'\) \{[\s\S]{0,300}?event\.waitUntil\(replayOfflineQueue\(\)\)/);
  });

  it("the app sends the replay trigger from its window 'online' handler", () => {
    expect(hook).toContain("REPLAY_OFFLINE_QUEUE");
    expect(hook).toMatch(/addEventListener\('online', onOnline\)|window\.addEventListener\('online'/);
    // onOnline must call the SW-replay helper, not only drain its own queue.
    const onOnlineBody = hook.slice(hook.indexOf("const onOnline"), hook.indexOf("const onOffline"));
    expect(onOnlineBody).toContain("requestServiceWorkerReplay()");
  });
});

describe("A11-03 — queued is not saved", () => {
  it("isOfflineQueuedResponse recognises only the SW queue receipt", () => {
    expect(isOfflineQueuedResponse(202, { offline: true, queued: true })).toBe(true);
    expect(isOfflineQueuedResponse(202, { leadId: 42, geocoded: true })).toBe(false);
    expect(isOfflineQueuedResponse(200, { offline: true, queued: true })).toBe(false);
    expect(isOfflineQueuedResponse(201, { leadId: 42 })).toBe(false);
    expect(isOfflineQueuedResponse(202, null)).toBe(false);
    expect(isOfflineQueuedResponse(202, "queued")).toBe(false);
  });

  it("DriveMode branches on the queued receipt before building a SavedLead", () => {
    const queuedBranch = driveMode.indexOf("isOfflineQueuedResponse(res.status, body)");
    const savedConstruction = driveMode.indexOf("const saved: SavedLead");
    expect(queuedBranch).toBeGreaterThan(-1);
    expect(savedConstruction).toBeGreaterThan(queuedBranch);
  });

  it("DriveMode's queued branch is honest copy and sets no photo target", () => {
    const branch = driveMode.slice(
      driveMode.indexOf("isOfflineQueuedResponse(res.status, body)"),
      driveMode.indexOf("const saved: SavedLead"),
    );
    expect(branch).toContain("not saved yet");
    expect(branch).not.toContain("Lead saved");
    expect(branch).not.toContain("setPendingPhotoLeadId");
    expect(branch).not.toContain("setRecent");
  });
});
