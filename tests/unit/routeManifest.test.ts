/**
 * Route manifest / orphan-detection test (T3-3E Phase 2).
 *
 * The server mounts ~270 server/routes-*.ts files via three conventions in
 * server/routes.ts (default-export routers, registerXRoutes(app) functions,
 * dynamic-import routers). There is no structural guarantee every routes-*.ts
 * is actually mounted — an orphan route file can sit on disk doing nothing.
 *
 * server/routeManifest.ts is the descriptive mirror of mounting reality. This
 * test pins the two halves together:
 *   - every on-disk routes-*.ts is either in ROUTE_MANIFEST or KNOWN_NON_MOUNTED
 *     (FAIL on an orphan — mount it or delete it);
 *   - every ROUTE_MANIFEST entry's file actually exists on disk
 *     (FAIL on a stale entry — a file deleted in a census without manifest
 *     cleanup);
 *   - a sorted snapshot of manifest file paths so additions/removals surface
 *     in diffs.
 *
 * Purely structural: reads the filesystem + the manifest. No DB, no mounting.
 */

import { describe, it, expect, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { ROUTE_MANIFEST, KNOWN_NON_MOUNTED } from "../../server/routeManifest";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const SERVER_DIR = resolve(__dirname, "../../server");

/** Every server/routes-*.ts on disk, excluding test files, sorted. */
function listRouteFiles(): string[] {
  return readdirSync(SERVER_DIR)
    .filter(
      (f) =>
        f.startsWith("routes-") &&
        f.endsWith(".ts") &&
        !f.endsWith(".test.ts"),
    )
    .sort();
}

describe("route manifest", () => {
  const onDisk = listRouteFiles();
  const manifestFiles = ROUTE_MANIFEST.map((e) => e.file);
  const manifestSet = new Set(manifestFiles);
  const allowlistSet = new Set(Object.keys(KNOWN_NON_MOUNTED));

  it("has no duplicate file entries in the manifest", () => {
    expect(manifestFiles.length).toBe(manifestSet.size);
  });

  it("orphan check: every routes-*.ts on disk is mounted (manifest) or explicitly allowlisted", () => {
    const orphans = onDisk.filter(
      (f) => !manifestSet.has(f) && !allowlistSet.has(f),
    );
    // A failure here means a route file exists but is neither mounted nor
    // explicitly declared non-mounted. Fix by mounting it in server/routes.ts
    // and adding it to ROUTE_MANIFEST, or by deleting the dead file.
    expect(orphans).toEqual([]);
  });

  it("stale check: every manifest entry's file exists on disk", () => {
    const onDiskSet = new Set(onDisk);
    const stale = manifestFiles.filter((f) => !onDiskSet.has(f));
    // A failure here means the manifest references a file that was deleted
    // (e.g. by a route census) without manifest cleanup. Remove the entry.
    expect(stale).toEqual([]);
  });

  it("allowlist is shrink-only and references real, genuinely-unmounted files", () => {
    const onDiskSet = new Set(onDisk);
    for (const file of allowlistSet) {
      // Allowlisted files must exist on disk...
      expect(onDiskSet.has(file)).toBe(true);
      // ...and must NOT also be claimed as mounted in the manifest.
      expect(manifestSet.has(file)).toBe(false);
      // ...and must carry a documented reason.
      expect(KNOWN_NON_MOUNTED[file]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("manifest + allowlist exactly partition the on-disk route files", () => {
    // Every file is accounted for exactly once across the two sets, and the
    // two sets are disjoint. This is the load-bearing invariant: it makes a
    // newly-added route file impossible to forget.
    const accounted = new Set<string>([...manifestSet, ...allowlistSet]);
    expect([...onDisk].sort()).toEqual([...accounted].sort());
    // Disjoint:
    for (const f of allowlistSet) expect(manifestSet.has(f)).toBe(false);
  });

  it("every manifest entry is well-formed", () => {
    for (const e of ROUTE_MANIFEST) {
      expect(e.file).toMatch(/^routes-[a-z0-9-]+\.ts$/);
      expect(["router", "register", "default"]).toContain(e.kind);
      expect(typeof e.export).toBe("string");
      expect(e.export.length).toBeGreaterThan(0);
      // Router entries reference a default export; register entries name a fn.
      if (e.kind === "register") {
        expect(e.export).toMatch(/^register/);
      }
      // mountPath is a literal "/..." string or null.
      if (e.mountPath !== null) {
        expect(e.mountPath.startsWith("/")).toBe(true);
      }
    }
  });

  it("snapshot: sorted manifest file paths (additions/removals must be intentional)", () => {
    expect([...manifestFiles].sort()).toMatchSnapshot();
  });

  it("snapshot: sorted KNOWN_NON_MOUNTED allowlist", () => {
    expect([...allowlistSet].sort()).toMatchSnapshot();
  });
});

/**
 * Wave B ("Wire the engine", 2026-07-29) introduced a SECOND route location:
 * `server/routes/` (lob-webhooks.ts, public-qr-redirect.ts), mounted from
 * inside `registerOutreachMailRoutes` rather than from server/routes.ts. The
 * orphan check above only walks `server/routes-*.ts`, so a file dropped into
 * that new directory was covered by nothing — exactly the "built but unwired"
 * hole the manifest exists to close, reopened one directory over.
 *
 * This closes it structurally rather than by hand-maintained list: every
 * module under server/routes/ must export at least one `registerXRoutes`
 * function AND be imported by some other file under server/. An import is not
 * proof the handler runs, but a missing import IS proof it cannot.
 */
describe("server/routes/ sub-directory is not an orphan blind spot", () => {
  const SUBDIR = resolve(SERVER_DIR, "routes");

  const subFiles = existsSync(SUBDIR)
    ? readdirSync(SUBDIR)
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
        .sort()
    : [];

  /** Every non-test .ts under server/, excluding the file being checked. */
  function serverSources(exclude: string): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules") continue;
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        if (entry.name.endsWith(".test.ts")) continue;
        if (full === exclude) continue;
        out.push(full);
      }
    };
    walk(SERVER_DIR);
    return out;
  }

  it("finds the sub-directory at all (guards the guard)", () => {
    expect(subFiles.length).toBeGreaterThan(0);
  });

  for (const file of subFiles) {
    it(`server/routes/${file} exports a register fn and is imported by server code`, () => {
      const full = resolve(SUBDIR, file);
      const src = readFileSync(full, "utf-8");
      const exported = [...src.matchAll(/export function (register\w+)\s*\(/g)].map(
        (m) => m[1],
      );
      expect(
        exported.length,
        `server/routes/${file} exports no registerXRoutes() — nothing can mount it`,
      ).toBeGreaterThan(0);

      const importers = serverSources(full).filter((p) => {
        const code = readFileSync(p, "utf-8");
        return exported.some((fn) => code.includes(fn));
      });
      expect(
        importers.length,
        `server/routes/${file} exports ${exported.join(", ")} but NOTHING in ` +
          `server/ references it — the route file is an orphan. Mount it (or ` +
          `delete it).`,
      ).toBeGreaterThan(0);
    });
  }
});
