/**
 * Wholesale W8 — support drill set, part 2 of 3: drills 2c/2d (the stuck
 * moment, contract chain + blast identity) and the drill 3 capability pin
 * (WS-DEF-1). Part 1 (wholesaleSupportDrills.test.ts) holds drill 1 and
 * drills 2a/2b; part 3 (wholesaleSupportDrillsData.test.ts) holds drill 4.
 * The full record: docs/evidence/2026-11-24/wholesale-support-drills.md.
 *
 * These legs run the real pure resolveStateContractTemplate, pin the
 * blast identity preflight on the real route source (the preflight itself
 * is proven by buyerBlastIdentityPreflight.test.ts and
 * counterpartyIdentityPreflight.test.ts), and pin the support resolver's
 * tool subset against the chat path's registry. Fixtures are synthetic.
 * Nothing in this file can send anything.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "../helpers/stripComments";
import { resolveStateContractTemplate } from "../../server/services/contracts/contractAssembly";

const root = resolve(__dirname, "../..");
const read = (p: string) => stripComments(readFileSync(resolve(root, p), "utf8"));

// ── Drill 2c — the contract chain refuses an unreviewed state ─────────────

describe("W8 drill 2c — the contract chain refuses an unreviewed state with STATE_NOT_CONFIGURED", () => {
  it("IL has no reviewed assignment template: the refusal names the state and the code", () => {
    const r = resolveStateContractTemplate("IL", "assignment_of_contract");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.code).toBe("STATE_NOT_CONFIGURED");
      expect(r.refusal.state).toBe("IL");
      expect(r.refusal.message).toMatch(/Illinois|IL/);
    }
  });

  it("TX, a reviewed state, resolves — the refusal is about coverage, not a blanket block", () => {
    const r = resolveStateContractTemplate("TX", "assignment_of_contract");
    expect(r.ok).toBe(true);
  });
});

// ── Drill 2d — a blast starves without the org's OWN email identity ───────

describe("W8 drill 2d — a blast starves without the org's OWN email identity (W-DEF-1 preflight)", () => {
  const src = read("server/routes-buyer-blasts.ts");

  it("the send path refuses before any blast row exists: reason named, sent 0", () => {
    expect(src).toContain('reason: "no_counterparty_email_identity"');
    expect(src).toContain("sent: 0");
    expect(src.indexOf("no_counterparty_email_identity")).toBeLessThan(src.indexOf(".insert(buyerBlasts)"));
  });

  it("the warning words a support answer quotes say whose identity it must be — verbatim", () => {
    expect(src).toContain("buyer blasts go out under your own sending identity");
    expect(src).toContain("AcreOS does not email your buyers from its own address");
    // The preview surfaces the same warning where the operator composes.
    expect(src).toContain("sendingIdentityWarning: identityWarning");
  });
});

// ── Drill 3 — "Pax told me X": the support resolver has no wholesale read ──

describe("W8 drill 3 — capability pin: the wholesale tools exist on the chat path but NOT in the support resolver's subset (WS-DEF-1)", () => {
  const WHOLESALE_TOOLS = [
    "get_wholesale_buy_box",
    "get_wholesale_triage",
    "get_wholesale_buyers",
    "get_wholesale_buyer_matches",
    "get_wholesale_assignments",
    "get_wholesale_decision",
    "get_wholesale_disposition_packet",
    "get_wholesale_blasts",
    "record_buyer_blast_response",
  ];

  it("the chat path registers all nine wholesale tools (proven in paxWholesaleTools.test.ts)", () => {
    const toolsSrc = read("server/ai/tools.ts");
    for (const t of WHOLESALE_TOOLS) expect(toolsSrc, `chat path is missing ${t}`).toContain(t);
  });

  it("the support resolver's subset contains none of them — a wholesale ticket cannot be grounded on the support path today", () => {
    const resolverSrc = read("server/ai/paxSupportResolver.ts");
    const block = resolverSrc.match(/RESOLVER_TOOL_NAMES\s*=\s*\[([\s\S]*?)\]/);
    expect(block, "RESOLVER_TOOL_NAMES block not found — the pin must be re-pointed, not deleted").not.toBeNull();
    for (const t of WHOLESALE_TOOLS) expect(block![1], `resolver unexpectedly gained ${t} — close WS-DEF-1 and re-drill`).not.toContain(t);
  });
});
