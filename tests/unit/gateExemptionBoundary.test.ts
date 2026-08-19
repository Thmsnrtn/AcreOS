/**
 * An exemption may not widen its own reach.
 *
 * THE DEFECT
 * ──────────
 * `subscriptionPauseGate`, `dunningAccessGate` and `viewerReadOnlyGate` each
 * decided exemption with its own copy of `path.startsWith(prefix)`. That reads
 * an entry as a TEXTUAL prefix rather than a PATH prefix, so an entry reaches
 * every sibling that merely shares its spelling: `"/api/health"` exempted
 * `/api/healthz` and `/api/health-anything`, and `"/api/audit/export"` exempted
 * `/api/audit/export-everything`. Nothing refused such an entry, nothing made
 * the three gates agree, and the viewer gate is a security guarantee — the org
 * owner's own configuration of who may write.
 *
 * No live route exploited it (the one mutating `/api/health/*` route,
 * `uptime-probe`, is token-gated and never traverses these gates), so this is
 * a foreclosure, not an incident. It is the AcreOS instance of Foundry's
 * `development_authority_guard` rule — a grant may not widen its own reach,
 * and containment is checked at an explicit boundary. Ledger entry 23.
 *
 * WHY THE ASSERTIONS ARE SHAPED THIS WAY
 * ──────────────────────────────────────
 * The hostile paths are DERIVED from each gate's real exemption list rather
 * than hardcoded, so a new entry is covered the day it is added, and the test
 * cannot go stale against a list it no longer describes.
 *
 * Each case drives the REAL middleware and asserts a refusal — not
 * `pathIsExempt` in isolation. That is the load-bearing choice: a gate that
 * re-inlined `startsWith` tomorrow would still pass a test of the helper, and
 * would fail this one. The mutation this file is falsified against is
 * therefore "an equivalent representation of the old containment rule", not
 * "the helper stopped being imported".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/utils/permissions", () => ({
  getUserPermissionContext: vi.fn(async () => ({ role: "viewer" })),
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/orgOperating", () => ({
  orgActRefusal: vi.fn(() => "subscription_paused"),
}));

const { viewerReadOnlyGate, VIEWER_WRITE_EXEMPT_PREFIXES } = await import(
  "../../server/middleware/viewerReadOnlyGate"
);
const { subscriptionPauseGate, PAUSE_GATE_EXEMPT_PREFIXES } = await import(
  "../../server/middleware/subscriptionPauseGate"
);
const { dunningAccessGate, DUNNING_GATE_EXEMPT_PREFIXES } = await import(
  "../../server/middleware/dunningAccessGate"
);

/**
 * The three gates, each paired with the org state that makes it REFUSE.
 *
 * A gate whose org state did not trip would call `next()` for every path and
 * agree with any containment rule at all — the vacuity block below proves each
 * one of these really does refuse before any boundary case is read into.
 */
const GATES = [
  {
    name: "viewerReadOnlyGate",
    prefixes: VIEWER_WRITE_EXEMPT_PREFIXES as readonly string[],
    org: { id: 7 },
    run: viewerReadOnlyGate,
  },
  {
    name: "subscriptionPauseGate",
    prefixes: PAUSE_GATE_EXEMPT_PREFIXES as readonly string[],
    org: { id: 7, subscriptionPauseEndsAt: "2026-12-01" },
    run: subscriptionPauseGate,
  },
  {
    name: "dunningAccessGate",
    prefixes: DUNNING_GATE_EXEMPT_PREFIXES as readonly string[],
    org: { id: 7, dunningStage: "restricted" },
    run: dunningAccessGate,
  },
] as const;

async function drive(gate: (typeof GATES)[number], path: string) {
  const req = { method: "POST", path, user: { id: "u1" }, organization: gate.org };
  const status = { code: 0 };
  const res = {
    status(c: number) { status.code = c; return this; },
    json() { return this; },
  };
  const next = vi.fn();
  await gate.run(req as never, res as never, next as never);
  return { allowed: next.mock.calls.length > 0, code: status.code };
}

/**
 * Sibling paths that share an entry's SPELLING but not its path scope.
 *
 * Only entries without a trailing slash can produce one: `"/api/auth/"` is
 * already segment-bounded, so there is no sibling for `startsWith` to leak to
 * and nothing to discriminate. Generating them anyway would pad the population
 * with cases that pass under both the old rule and the new one, which is how a
 * gate ends up looking stronger than it is.
 */
function siblingsOf(prefix: string): string[] {
  if (prefix.endsWith("/")) return [];
  return [`${prefix}z/leak`, `${prefix}-leak`];
}

describe("gate exemptions are bounded at a path segment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("vacuity: every gate has entries, refuses by default, and yields sibling cases", async () => {
    for (const gate of GATES) {
      expect(gate.prefixes.length, `${gate.name} has no exemptions`).toBeGreaterThan(0);
      // The org state must actually trip the gate, or nothing below means anything.
      const control = await drive(gate, "/api/leads/1");
      expect(control.allowed, `${gate.name} did not refuse a plain CRM write`).toBe(false);
      expect(control.code, `${gate.name} refusal status`).toBeGreaterThanOrEqual(400);
    }
    const total = GATES.flatMap((g) => g.prefixes.flatMap(siblingsOf));
    expect(total.length, "no discriminating sibling cases were generated").toBeGreaterThan(0);
  });

  it("a path that merely shares an exemption's spelling is NOT exempt", async () => {
    const leaked: string[] = [];
    for (const gate of GATES) {
      for (const prefix of gate.prefixes) {
        for (const sibling of siblingsOf(prefix)) {
          const r = await drive(gate, sibling);
          if (r.allowed) leaked.push(`${gate.name}: "${prefix}" exempted ${sibling}`);
        }
      }
    }
    expect(leaked).toEqual([]);
  });

  it("a trailing-slash entry does not exempt a differently-named sibling directory", async () => {
    const leaked: string[] = [];
    for (const gate of GATES) {
      for (const prefix of gate.prefixes) {
        if (!prefix.endsWith("/")) continue;
        const sibling = `${prefix.slice(0, -1)}-other/thing`;
        const r = await drive(gate, sibling);
        if (r.allowed) leaked.push(`${gate.name}: "${prefix}" exempted ${sibling}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it("the real exempt paths still pass — this tightens, it must not break", async () => {
    // The other direction. A rule that refused everything would satisfy the
    // three assertions above and silently brick billing, support and logout
    // for exactly the customers who most need them reachable.
    const blocked: string[] = [];
    for (const gate of GATES) {
      for (const prefix of gate.prefixes) {
        const inside = prefix.endsWith("/") ? `${prefix}thing` : `${prefix}/thing`;
        const r = await drive(gate, inside);
        if (!r.allowed) blocked.push(`${gate.name}: "${prefix}" no longer exempts ${inside}`);
        // A non-slash entry must also exempt itself exactly.
        if (!prefix.endsWith("/")) {
          const exact = await drive(gate, prefix);
          if (!exact.allowed) blocked.push(`${gate.name}: "${prefix}" no longer exempts itself`);
        }
      }
    }
    expect(blocked).toEqual([]);
  });

  it("the three gates agree on containment", async () => {
    // They shared a bug because they shared a copied loop. They should now
    // share an answer wherever their lists overlap — a divergence here means
    // one of them has drifted back to its own rule.
    const shared = PAUSE_GATE_EXEMPT_PREFIXES.filter((p) =>
      DUNNING_GATE_EXEMPT_PREFIXES.includes(p),
    );
    expect(shared.length, "the two billing gates no longer share any entry").toBeGreaterThan(0);
    for (const prefix of shared) {
      for (const candidate of [...siblingsOf(prefix), `${prefix}${prefix.endsWith("/") ? "" : "/"}x`]) {
        const a = await drive(GATES[1], candidate);
        const b = await drive(GATES[2], candidate);
        expect(a.allowed, `pause vs dunning disagree on ${candidate}`).toBe(b.allowed);
      }
    }
  });
});
