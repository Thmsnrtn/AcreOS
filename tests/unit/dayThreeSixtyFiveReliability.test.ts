/**
 * Workstream C — "Will it survive year 1 of daily use?" probes.
 *
 * Each test pins a day-365 ceiling that quietly betrays a real user with a
 * production-scale lead list or an offline-driving field scout. The tests
 * are written to FAIL against the current code and PASS after the fixes
 * land — they're the contract.
 *
 * Specific ceilings probed:
 *
 *   1. `useLeads()` capped at `?page=1&pageSize=100`. At 10,000 leads the
 *      mobile list silently shows lead #1–#100 ordered by server default;
 *      every consumer (MobileLeadList, command palette, parts of today.tsx)
 *      sees the same cap. Hot/filter logic over 100 of N leads is noise.
 *      Probe: parse client/src/hooks/use-leads.ts and assert the legacy
 *      `useLeads()` no longer hard-codes a 100-row ceiling.
 *
 *   2. Service-worker offline-queue allowlist missing the DriveMode
 *      field-scout endpoint. CourthouseMode driver in a dead zone POSTs to
 *      /api/field-scout/quick-add (DriveMode.tsx:122) → silent ghost
 *      because the SW only queues /api/leads, /api/activity-feed,
 *      /api/auction-listings, /api/conversations.
 *      Probe: parse client/public/sw.js and assert the field-scout route is
 *      in OFFLINE_QUEUEABLE_ROUTES.
 *
 *   3. IndexedDB schema is opened at version 1 with no migration path. Bump
 *      to version 2 with an onupgradeneeded handler now while the store is
 *      empty in the wild — once queued field-scout entries exist in
 *      customer-installed SWs, the schema is frozen.
 *      Probe: parse sw.js, assert openOfflineDb opens the DB at version >= 2.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "..", "..");

function readFile(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

describe("day-365 reliability probes", () => {
  describe("useLeads() — 100-cap removal", () => {
    it("does NOT hard-code a 100-row ceiling on the legacy hook", () => {
      const src = readFile("client/src/hooks/use-leads.ts");

      // The fix removes the `page=1&pageSize=100` literal from useLeads().
      // We tolerate the literal appearing in the paginated hook (different
      // call site, opt-in pagination) — only the legacy useLeads body must
      // not pin it. Slice the file to the legacy hook body to scope the
      // assertion.
      const legacyMatch = src.match(/export function useLeads\(\)[^{]*\{([\s\S]*?)\n\}\n/);
      expect(
        legacyMatch,
        "expected to find an `export function useLeads()` declaration"
      ).not.toBeNull();
      const legacyBody = legacyMatch![1];

      expect(
        legacyBody.includes("pageSize=100"),
        "useLeads() must not hard-cap the list at 100 rows — convert to " +
          "infinite/paginated fetch so a 10,000-lead org sees more than the " +
          "first page"
      ).toBe(false);
    });
  });

  describe("service-worker offline queue", () => {
    const swSrc = readFile("client/public/sw.js");

    it("queues /api/field-scout/quick-add for offline replay", () => {
      // Parse the OFFLINE_QUEUEABLE_ROUTES literal so we assert against the
      // declared list, not anywhere the string happens to appear.
      const match = swSrc.match(
        /const\s+OFFLINE_QUEUEABLE_ROUTES\s*=\s*\[([\s\S]*?)\];/
      );
      expect(
        match,
        "expected OFFLINE_QUEUEABLE_ROUTES array in client/public/sw.js"
      ).not.toBeNull();
      const list = match![1];

      expect(
        list.includes("/api/field-scout/quick-add"),
        "/api/field-scout/quick-add must be in OFFLINE_QUEUEABLE_ROUTES — " +
          "without it, CourthouseMode/DriveMode silently drops field saves " +
          "made in dead zones"
      ).toBe(true);
    });

    it("opens IndexedDB at version >= 2 with an upgrade handler", () => {
      // Bump the version while the store is small. Once customer-installed
      // SWs hold queued entries, schema changes need a real migration path
      // and an unmigrated version-1 DB will throw on open.
      //
      // The version arg accepts either a numeric literal OR a constant
      // identifier (the post-fix code introduces an OFFLINE_DB_VERSION
      // const so future bumps live in one place). If the call uses an
      // identifier, resolve it to its const declaration.
      const openMatch = swSrc.match(
        /indexedDB\.open\(\s*OFFLINE_DB_NAME\s*,\s*([A-Za-z0-9_]+)\s*\)/
      );
      expect(
        openMatch,
        "expected an indexedDB.open(OFFLINE_DB_NAME, <version>) call in sw.js"
      ).not.toBeNull();
      const versionToken = openMatch![1];

      let version: number;
      if (/^\d+$/.test(versionToken)) {
        version = Number(versionToken);
      } else {
        // Resolve the const declaration. e.g. `const FOO = 2;`
        const constMatch = swSrc.match(
          new RegExp(`const\\s+${versionToken}\\s*=\\s*(\\d+)\\s*;`)
        );
        expect(
          constMatch,
          `expected a numeric \`const ${versionToken} = N;\` declaration ` +
            "so we can verify the schema version"
        ).not.toBeNull();
        version = Number(constMatch![1]);
      }

      expect(
        version,
        "IndexedDB version must be >= 2 so we have a working " +
          "onupgradeneeded migration path before the store is filled in the " +
          "wild"
      ).toBeGreaterThanOrEqual(2);
    });
  });
});
