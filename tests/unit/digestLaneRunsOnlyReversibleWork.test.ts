/**
 * Founder decision 2026-10-10: routine, reversible autopilot moves (ops,
 * deploy, retention) run and appear in the weekly digest with an undo instead
 * of asking one by one; irreversible moves and every hard stop still ask first.
 *
 * Ops and deploy are seeded at execute_gated, so the gate stack PASSES their
 * moves. Whether a passing move then runs unasked is decided by planAndAct's
 * digest-lane check. These tests route the forbidden shapes INTO that path
 * (a gate stubbed to pass) and require an ask and no dispatch:
 *   - an irreversible move tagged ops (the role-worker growth move, which can't be undone);
 *   - an unknown kind in ops (the fail-closed binding: irreversible and customer-facing);
 *   - each of the four hard-stop classes, worded as a routine ops move.
 * Plus the seeding: support, ops and deploy start at execute_gated, growth and
 * finance at observe.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { planAndAct, digestLaneRefusal, bindingFor, isKnownMoveKind, type ActDeps } from "../../server/services/autopilot/act";

/** The digest-lane domains (act.ts DIGEST_LANE_DOMAINS), per the 2026-10-10 decision. */
const DIGEST_LANE_DOMAINS = new Set(["ops", "deploy"]);
import { markServerAuthored, type RankedMove } from "../../server/services/autopilot/decide";
import { hardStopForMove } from "../../server/services/autopilot/hardStopMoves";
import { classifyEscalation } from "../../server/services/autopilot/escalation";
import { DEFAULT_DOMAIN_LEVEL, gateResultForLevel } from "../../server/services/autopilot/domainAutonomy";
import { stripComments } from "../helpers/stripComments";

const mv = (over: Partial<RankedMove>): RankedMove => markServerAuthored({ priority: 3, domain: "ops", kind: "optimize", rationale: "Nothing urgent — improve.", ...over } as RankedMove);

function deps(): ActDeps & { enqueue: ReturnType<typeof vi.fn>; ask: ReturnType<typeof vi.fn> } {
  return {
    runGate: vi.fn(async () => ({ decision: "pass" as const, results: [] })),
    classify: classifyEscalation,
    enqueue: vi.fn(async () => 101),
    ask: vi.fn(async () => ({ askId: 202 })),
  } as any;
}

/** Every move kind in MOVE_BINDINGS, read from the source (parsed, comments stripped). */
function boundKinds(): string[] {
  const src = stripComments(fs.readFileSync(path.resolve(__dirname, "../../server/services/autopilot/act.ts"), "utf8"));
  const start = src.indexOf("const MOVE_BINDINGS");
  const block = src.slice(start, src.indexOf("};", start));
  return [...block.matchAll(/^\s+(\w+):\s*\{\s*domain:/gm)].map((m) => m[1]);
}

describe("the digest lane runs only reversible, internal work", () => {
  it("population: every bound move kind is read, and each digest-domain kind is reversible and internal", () => {
    const kinds = boundKinds();
    expect(kinds.length).toBeGreaterThanOrEqual(12);
    for (const k of kinds) expect(isKnownMoveKind(k), k).toBe(true);
    const lane = kinds.filter((k) => DIGEST_LANE_DOMAINS.has(bindingFor(k).domain));
    expect(lane.length).toBeGreaterThanOrEqual(5);
    for (const k of lane) expect(digestLaneRefusal(mv({ kind: k, domain: bindingFor(k).domain })), k).toBeNull();
  });

  it("a routine reversible ops move with a passing gate runs (it is digested, not asked)", async () => {
    const d = deps();
    const r = await planAndAct(mv({ kind: "optimize" }), { envelopeStatus: "green", maxCostUsd: 5 }, d);
    expect(r.status).toBe("acted");
    expect(d.enqueue).toHaveBeenCalledTimes(1);
    expect(d.ask).not.toHaveBeenCalled();
  });

  it("an irreversible move routed into ops asks first, though every gate passed", async () => {
    const m = mv({ kind: "grow_owned_channels", domain: "ops", rationale: "Advance owned growth." });
    expect(bindingFor(m.kind).reversible).toBe(false);
    expect(digestLaneRefusal(m)).toMatch(/can't be undone/);
    const d = deps();
    const r = await planAndAct(m, { envelopeStatus: "green", maxCostUsd: 5 }, d);
    expect(r.status).toBe("escalated");
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  it("an unknown kind in ops (irreversible, customer-facing by default) asks first", async () => {
    const m = mv({ kind: "drop_stale_tables", domain: "ops" });
    const d = deps();
    const r = await planAndAct(m, { envelopeStatus: "green", maxCostUsd: 5 }, d);
    expect(r.status).toBe("escalated");
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  const HARD_STOPS: Array<[string, Partial<RankedMove>]> = [
    ["pricing_changes", { kind: "optimize", rationale: "Lower the Pro price to $39 a month to lift conversion." }],
    ["legal_signing", { kind: "optimize", rationale: "Sign the reseller agreement on our behalf." }],
    ["spend_over_500_usd", { kind: "resolve_incident", domain: "deploy", rationale: "Spend $900 on a larger database instance." }],
    ["customer_data_deletion", { kind: "optimize", rationale: "Delete customer data for the churned organizations." }],
  ];
  it.each(HARD_STOPS)("hard stop %s never enters the digest lane", async (cls, over) => {
    const m = mv(over);
    expect(hardStopForMove(m), "fixture must be a real hard stop").not.toBeNull();
    expect(digestLaneRefusal(m)).toMatch(/hard stop/);
    const d = deps();
    const r = await planAndAct(m, { envelopeStatus: "green", maxCostUsd: 5 }, d);
    expect(r.status).toBe("escalated");
    expect(d.enqueue).not.toHaveBeenCalled();
    void cls;
  });
});

describe("the seeded levels (founder decisions 2026-10-09 and 2026-10-10)", () => {
  it("support, ops and deploy start at execute_gated; growth and finance at observe", () => {
    expect(DEFAULT_DOMAIN_LEVEL).toEqual({ growth: "observe", support: "execute_gated", deploy: "execute_gated", ops: "execute_gated", finance: "observe" });
    expect(gateResultForLevel(DEFAULT_DOMAIN_LEVEL.support).status).toBe("pass");
    expect(gateResultForLevel(DEFAULT_DOMAIN_LEVEL.growth).status).toBe("block");
  });

  it("the seed writes DEFAULT_DOMAIN_LEVEL, not a literal", () => {
    const src = stripComments(fs.readFileSync(path.resolve(__dirname, "../../server/services/autopilot/domainAutonomy.ts"), "utf8"));
    const seed = src.slice(src.indexOf("export async function ensureDomainsSeeded"), src.indexOf("export async function getDomainLevel"));
    expect(seed).toMatch(/level:\s*DEFAULT_DOMAIN_LEVEL\[domain\]/);
  });
});

describe("the weekly digest is reachable behind the Decisions door, and its undo is honest", () => {
  it("undo cancels unfinished work; finished work makes the domain ask first; an undone item has no button", async () => {
    const { undoKindFor } = await import("../../server/services/autopilot/weeklyAutopilotDigest");
    expect(undoKindFor("queued", false)).toBe("cancel");
    expect(undoKindFor("in_progress", false)).toBe("cancel");
    expect(undoKindFor("completed", false)).toBe("ask_first");
    expect(undoKindFor(null, false)).toBe("ask_first");
    expect(undoKindFor("queued", true)).toBeNull();
  });

  it("the Decisions page renders the digest section, and the routes are registered for the founder only", () => {
    const root = path.resolve(__dirname, "../..");
    const page = stripComments(fs.readFileSync(path.join(root, "client/src/pages/founder-decisions.tsx"), "utf8"));
    const body = page.slice(page.indexOf("export default function FounderDecisionsPage"));
    expect(body).toMatch(/<WeeklyDigestSection \/>/);
    const routes = stripComments(fs.readFileSync(path.join(root, "server/routes-autopilot.ts"), "utf8"));
    for (const p of ["/api/founder/autopilot/weekly-digest\"", "/api/founder/autopilot/weekly-digest/:experienceId/undo\""]) {
      const at = routes.indexOf(p);
      expect(at, p).toBeGreaterThan(-1);
      expect(routes.slice(at, at + 200)).toMatch(/isAuthenticated,\s*requireFounder,/);
    }
  });
});
