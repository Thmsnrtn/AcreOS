/**
 * Ratchet: prefetchRoute (client/src/lib/queryClient.ts) is the ONLY
 * sanctioned way to warm a bare-key API cache entry.
 *
 * Why this exists: queryClient.prefetchQuery with the DEFAULT fetcher
 * caches the endpoint's raw paginated envelope (`{data, ...}`) under the
 * bare key (e.g. ["/api/leads"]). Consumers of those keys normalize to a
 * flat array via their own queryFn — but a consumer mounting while the
 * prefetched entry is still FRESH serves the cached envelope without
 * running its queryFn, and `leads.forEach is not a function` takes down
 * the page behind the 500 boundary.
 *
 * This shipped twice: first via the sidebar's handlePrefetch (fixed
 * 2026-06-10), then REINTRODUCED by PrefetchLink's independent
 * prefetchQuery call (caught by the ipad-mini nav-smoke tab walk,
 * 2026-06-11 — link focus on click fired the poison). prefetchRoute
 * normalizes array-contract keys; everything must route through it.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

describe("prefetch single-authority ratchet", () => {
  it("no prefetchQuery callsites outside lib/queryClient.ts", () => {
    let out = "";
    try {
      out = execFileSync(
        "grep",
        [
          "-rn",
          "--include=*.ts",
          "--include=*.tsx",
          "prefetchQuery",
          "client/src",
        ],
        { cwd: REPO_ROOT, encoding: "utf8" },
      );
    } catch (err) {
      // grep exits 1 on zero matches — that would also satisfy the ratchet.
      const e = err as { status?: number; stdout?: string };
      if (e.status !== 1) throw err;
      out = e.stdout ?? "";
    }
    const offenders = out
      .split("\n")
      .filter(Boolean)
      // The single authority itself.
      .filter((line) => !line.startsWith("client/src/lib/queryClient.ts:"))
      // Comment-only mentions (e.g. PrefetchLink's warning comment).
      .filter((line) => {
        const code = line.replace(/^[^:]+:\d+:/, "").trimStart();
        return !code.startsWith("//") && !code.startsWith("*");
      });
    expect(
      offenders,
      `Direct prefetchQuery callsites found — route them through prefetchRoute (lib/queryClient.ts) instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
