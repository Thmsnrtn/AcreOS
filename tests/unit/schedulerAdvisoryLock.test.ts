/**
 * Lens 13 / Kareem §3 — scheduler advisory-lock tests.
 *
 * Validates:
 *   - fnv1a64Signed produces a deterministic int64 in Postgres' range
 *   - identical inputs hash identically across calls (collision check on
 *     a handful of known job names)
 *   - distinct inputs produce distinct hashes (no trivial collisions)
 */

import { describe, expect, it } from "vitest";
import { fnv1a64Signed } from "../../server/jobs/scheduler";

describe("fnv1a64Signed", () => {
  it("is deterministic", () => {
    expect(fnv1a64Signed("dunning-sweeper")).toBe(fnv1a64Signed("dunning-sweeper"));
    expect(fnv1a64Signed("audit-log-purge")).toBe(fnv1a64Signed("audit-log-purge"));
  });

  it("fits inside a signed int64 (Postgres bigint range)", () => {
    const MIN = -(2n ** 63n);
    const MAX = 2n ** 63n - 1n;
    for (const name of ["a", "dunning-sweeper", "outbox-flusher", "🚀"]) {
      const h = fnv1a64Signed(name);
      expect(h).toBeGreaterThanOrEqual(MIN);
      expect(h).toBeLessThanOrEqual(MAX);
    }
  });

  it("produces different hashes for different inputs", () => {
    const seen = new Set<string>();
    const names = [
      "dunning-sweeper",
      "outbox-flusher",
      "audit-log-purge",
      "skip-trace-refresher",
      "drip-campaign-runner",
      "stripe-webhook-replayer",
      "campaign-retry-sweep",
      "session-vacuum",
    ];
    for (const n of names) {
      const h = fnv1a64Signed(n).toString();
      expect(seen.has(h)).toBe(false);
      seen.add(h);
    }
  });

  it("matches the canonical FNV-1a 64-bit seed for empty input", () => {
    // FNV offset basis, viewed as signed (top bit set → negative).
    // 0xcbf29ce484222325 = 14695981039346656037 unsigned
    // → signed: 14695981039346656037 - 2^64 = -3750763034362895579
    expect(fnv1a64Signed("")).toBe(-3750763034362895579n);
  });
});
