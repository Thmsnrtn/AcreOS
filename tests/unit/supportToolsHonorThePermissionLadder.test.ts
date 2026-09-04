/**
 * The permission ladder must hold on BOTH dispatch switches, not one.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `server/ai/tools.ts` gates every intent on the scope it declares
 * (`scopeForIntent` → `userHasScope`). Its own comment states the reason: the
 * REST door for an operation could require `tenant_pii_write` while the Pax
 * door for the SAME operation required nothing at all, and a member could
 * reach it by typing a sentence.
 *
 * That gate was installed on ONE file. `executeSupportTool` in
 * `server/ai/supportAgent.ts` is a second dispatch switch — 91 case labels,
 * driven by a model — and it had no scope check of any kind: a grep for
 * `userHasScope|scopeForIntent|permissionContext|requirePermission` across
 * that file returned zero. It is not internal-only either. `POST
 * /api/support/tickets/:id/pax-resolve` sits behind `isAuthenticated,
 * getOrCreateOrg`, so ANY authenticated org member could run the ticket
 * through `paxSupportResolver`, which calls the switch directly — reaching
 * billing repairs, bulk fixes, preference resets and job-queue surgery that
 * the REST doors gate.
 *
 * This is CLAUDE.md's third law exactly: "a gate proves its property only over
 * the population it actually reads." `paxToolsReportRealEffects` has the
 * identical story about the identical switch, which is why the population
 * below is DERIVED from the source rather than typed by hand.
 *
 * ── WHO THE CALLER IS ───────────────────────────────────────────────────────
 * Pax resolving a ticket acts on behalf of the person who filed it, so the
 * ladder is checked against THAT person — `support_tickets.userId` is NOT NULL
 * and the resolver passes it. Pax may never do more for someone than they
 * could do themselves. `userHasScope` returns false for an unidentified
 * caller, so a path that forgets to pass a user refuses rather than sailing
 * through: fail-closed in the direction that costs a support action, not a
 * permission.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 *   1. The gate exists, runs before dispatch, and is skipped only for
 *      read-only tools.
 *   2. The registry is COMPLETE over the side-effecting population, derived
 *      from the switch's own case labels minus the pause-safe set — so adding
 *      a 22nd mutating case without classifying it fails HERE.
 *   3. An undeclared side-effecting tool is refused at runtime, not allowed.
 *   4. The resolver identifies its caller.
 *   5. No scope is invented: every declared scope is a real member of the
 *      ladder's own union.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SUPPORT_TOOL_SCOPES, supportScopeFor } from "../../server/ai/supportToolScopes";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** Strip comments so prose naming a symbol never reads as a use of it. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const SUPPORT = "server/ai/supportAgent.ts";
const RESOLVER = "server/ai/paxSupportResolver.ts";
const LADDER = "server/middleware/roleScope.ts";

/** Every `case "x":` label in executeSupportTool's switch. */
function caseLabels(): string[] {
  const src = code(SUPPORT);
  return [...new Set([...src.matchAll(/^\s*case "([a-z_0-9]+)":/gm)].map((m) => m[1]))];
}

/** The read-only allowlist the pause gate already maintains. */
function pauseSafe(): Set<string> {
  const src = code(SUPPORT);
  const m = /PAUSE_SAFE_SUPPORT_TOOLS[^=]*=\s*new Set\(\[(.*?)\]\)/s.exec(src);
  if (!m) throw new Error("PAUSE_SAFE_SUPPORT_TOOLS not found — the derivation is broken");
  return new Set([...m[1].matchAll(/"([a-z_0-9]+)"/g)].map((x) => x[1]));
}

/**
 * The scopes the ladder itself defines.
 *
 * Comments are stripped FIRST. The union's own `deal_read` line carries
 * "// pipeline visibility — wide; default-deny for family-co-owner", and that
 * semicolon truncated a non-greedy match at five of eleven scopes — a
 * derivation that silently under-reads is the vacuity failure this file's
 * guards exist to catch, and it caught itself.
 */
function ladderScopes(): Set<string> {
  const src = code(LADDER);
  const m = /export type Scope =([\s\S]*?);/.exec(src);
  if (!m) throw new Error("Scope union not found");
  return new Set([...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
}

const LABELS = caseLabels();
const SAFE = pauseSafe();
const SIDE_EFFECTING = LABELS.filter((l) => !SAFE.has(l));

describe("the derivation is real (vacuity guards)", () => {
  it("reads a switch with a substantial number of cases", () => {
    // 91 at the time of writing. A regex that stops matching reads exactly
    // like a switch that lost its cases.
    expect(LABELS.length).toBeGreaterThan(60);
  });

  it("splits into a read-only majority and a side-effecting minority", () => {
    expect(SAFE.size).toBeGreaterThan(40);
    expect(SIDE_EFFECTING.length).toBeGreaterThan(10);
    // Known members on each side, so an inverted or empty split fails.
    expect(SAFE.has("search_knowledge_base")).toBe(true);
    expect(SIDE_EFFECTING).toContain("apply_bulk_fix");
  });

  it("reads the ladder's real scope union", () => {
    const scopes = ladderScopes();
    expect(scopes.size).toBeGreaterThan(6);
    expect(scopes.has("settings_write")).toBe(true);
  });
});

describe("the registry is complete over the side-effecting population", () => {
  it("every side-effecting support tool declares a scope", () => {
    const undeclared = SIDE_EFFECTING.filter((t) => !supportScopeFor(t));
    expect(
      undeclared,
      "These support tools change something and name no permission. Declare each in " +
        "server/ai/supportToolScopes.ts — an unclassified side-effecting capability is how " +
        "this switch came to have no ladder at all.",
    ).toEqual([]);
  });

  it("declares nothing that is not a side-effecting tool (no stale entries)", () => {
    const stale = Object.keys(SUPPORT_TOOL_SCOPES).filter((t) => !SIDE_EFFECTING.includes(t));
    expect(
      stale,
      "these declarations name a tool that is read-only or no longer exists — remove them",
    ).toEqual([]);
  });

  it("every declared scope is a real member of the ladder's union", () => {
    const scopes = ladderScopes();
    const invented = Object.entries(SUPPORT_TOOL_SCOPES)
      .filter(([, s]) => !scopes.has(s))
      .map(([t, s]) => `${t} → ${s}`);
    expect(invented, "a scope that is not in roleScope.ts's union gates nothing").toEqual([]);
  });

  it("money and org-configuration tools sit at the bar their REST doors use", () => {
    // Spot-checks with teeth: these are the consequential ones, and a silent
    // demotion to a weaker scope is the change this test exists to catch.
    expect(supportScopeFor("apply_billing_fix")).toBe("financial_write");
    expect(supportScopeFor("cancel_pending_invoice")).toBe("financial_write");
    expect(supportScopeFor("apply_credit")).toBe("financial_write");
    expect(supportScopeFor("apply_bulk_fix")).toBe("settings_write");
    expect(supportScopeFor("fix_data_integrity_issue")).toBe("settings_write");
    expect(supportScopeFor("reset_user_preferences")).toBe("settings_write");
    expect(supportScopeFor("send_proactive_warning")).toBe("comms_write");
  });
});

describe("the gate runs, before dispatch, and fails closed", () => {
  const src = code(SUPPORT);

  it("executeSupportTool checks the ladder", () => {
    expect(src).toContain("userHasScope(");
    expect(src).toContain("supportScopeFor(toolName)");
  });

  it("the check precedes the switch — a gate after dispatch has already run the tool", () => {
    const gateAt = src.indexOf("supportScopeFor(toolName)");
    const switchAt = src.indexOf("switch (toolName) {", gateAt);
    expect(gateAt).toBeGreaterThan(-1);
    expect(switchAt).toBeGreaterThan(gateAt);
  });

  it("an undeclared side-effecting tool is refused rather than allowed", () => {
    const gateAt = src.indexOf("supportScopeFor(toolName)");
    const block = src.slice(gateAt, gateAt + 1200);
    expect(block).toContain("undeclaredSupportScopeMessage(toolName)");
    // The refusal must return, not merely log.
    expect(block).toMatch(/return \{ success: false, error: undeclaredSupportScopeMessage/);
  });

  it("only read-only tools skip the gate", () => {
    const gateAt = src.indexOf("supportScopeFor(toolName)");
    const guardAt = src.lastIndexOf("if (!pauseSafe)", gateAt);
    expect(guardAt, "the gate is not guarded by the pause-safe check").toBeGreaterThan(-1);
    expect(gateAt - guardAt).toBeLessThan(400);
  });
});

describe("the caller is identified", () => {
  it("the resolver passes the ticket's own user, so the ladder has someone to check", () => {
    const src = code(RESOLVER);
    const callAt = src.indexOf("executeSupportTool(name, args, org, ticketId");
    expect(callAt).toBeGreaterThan(-1);
    expect(src.slice(callAt, callAt + 300)).toContain("userId: ticket.userId");
  });

  it("an unidentified caller cannot pass the ladder", () => {
    // userHasScope's own contract: no user, no scope. This is what makes a
    // path that forgets to pass a caller fail closed.
    expect(code(LADDER)).toMatch(/if \(!userId\) return false;/);
  });
});
