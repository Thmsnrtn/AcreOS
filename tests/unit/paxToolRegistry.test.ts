/**
 * WAVE-1 1.6 (audit P-3) — Pax tool-registry hygiene + per-context capability
 * scoping.
 *
 * The audit found the 61-tool registry contained LIVE duplicate verbs
 * (`schedule_followup` AND `schedule_follow_up`, `run_comps` AND
 * `run_comps_analysis`, `draft_offer` AND `generate_offer` +
 * `generate_offer_letter`) — overlapping tools the model must guess between,
 * degrading selection and bloating every prompt — and NO per-surface scoping
 * (rail chat, scheduled runs, and sub-agents all mounted the same list for a
 * given role).
 *
 * This suite pins the hygiene DERIVED from the real registry, so it cannot go
 * stale:
 *
 *   1. Zero duplicate tool names — in toolDefinitions and in the App Intent
 *      registry the Pax loop actually consumes.
 *   2. No two tools share a normalized verb+object signature UNLESS the pair
 *      is on the explicit, dated duplicate allowlist. The allowlist is
 *      seeded honestly with today's REAL remaining duplicates and their
 *      consolidation targets — it blesses nothing silently, and it ratchets:
 *      an entry whose duplicate is later consolidated must be removed in the
 *      same commit (the exact-match assertion fails otherwise).
 *   3. Consolidated aliases (removed names) stay call-compatible: the alias
 *      is no longer OFFERED to the model, but its executor case arm survives
 *      verbatim for history replay / persisted tool_calls.
 *   4. Per-context capability scoping: every tool declares its surface mounts
 *      (PAX_TOOL_SURFACES, default-deny for undeclared new tools), the
 *      surface filter mechanism provably filters, and the executive's
 *      buildPaxToolList — the list the model actually receives — equals the
 *      mapping derived from the registry + surface mounts.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  toolDefinitions,
  CONSOLIDATED_TOOL_ALIASES,
  PAX_SURFACES,
  PAX_TOOL_SURFACES,
  toolAllowedOnSurface,
  type PaxSurface,
} from "../../server/ai/tools";
import { getToolsForRoleFromRegistry, intentNames } from "../../server/services/appIntents";
import { buildPaxToolList } from "../../server/ai/executive";
import { isLandKnowledgeEnabled } from "../../server/services/pax/landKnowledge/corpus";

const ROOT = path.join(__dirname, "../..");
const toolsSource = fs.readFileSync(path.join(ROOT, "server/ai/tools.ts"), "utf-8");

const toolNames = Object.keys(toolDefinitions);

// ─── Normalized verb+object signatures ───────────────────────────────────────
//
// signature = folded verb + object tokens joined without separators, with
// generic trailing tokens stripped. Deliberately minimal folding — just enough
// to catch the duplicate classes the audit named without flagging genuinely
// distinct tools (get_leads vs get_lead_details, create_property vs
// create_properties_batch, send_email vs send_gmail stay distinct):
//   - draft/compose fold into generate      (draft_offer ≈ generate_offer)
//   - joined object tokens                  (follow_up ≈ followup)
//   - trailing "analysis"/"letter" stripped (run_comps ≈ run_comps_analysis,
//                                            generate_offer ≈ generate_offer_letter)
const VERB_SYNONYMS: Record<string, string> = {
  draft: "generate",
  compose: "generate",
};
const GENERIC_TRAILING_TOKENS = new Set(["analysis", "letter"]);

function verbObjectSignature(name: string): string {
  const tokens = name.split("_");
  const verb = VERB_SYNONYMS[tokens[0]] ?? tokens[0];
  const objectTokens = tokens.slice(1);
  while (
    objectTokens.length > 1 &&
    GENERIC_TRAILING_TOKENS.has(objectTokens[objectTokens.length - 1])
  ) {
    objectTokens.pop();
  }
  return `${verb}:${objectTokens.join("")}`;
}

/**
 * The DUPLICATE ALLOWLIST — every signature collision that still exists in
 * toolDefinitions, each dated and carrying its consolidation target. These are
 * NOT blessed as fine; they are recorded honestly as remaining work. Removing
 * a duplicate (the P-3 end state) requires deleting its entry here in the same
 * commit — the exact-match assertions below fail in both directions.
 *
 * Already consolidated (2026-08-10): schedule_follow_up → schedule_followup
 * (definition removed, executor arm retained — see CONSOLIDATED_TOOL_ALIASES).
 * It therefore no longer appears below.
 */
const DUPLICATE_ALLOWLIST: Array<{
  signature: string;
  tools: string[]; // sorted
  since: string;
  target: string;
  reason: string;
}> = [
  {
    signature: "run:comps",
    tools: ["run_comps", "run_comps_analysis"],
    since: "2026-08-10",
    target: "run_comps_analysis",
    reason:
      "Same verb+object but DIFFERENT data planes: run_comps median-prices the org's " +
      "OWN inventory in the same county/state; run_comps_analysis calls the external " +
      "comps service by lat/lng radius. Silent consolidation would change result " +
      "shape and data source for live callers. Consolidation target: fold the " +
      "internal-inventory path into run_comps_analysis as a source/fallback " +
      "parameter, then delete run_comps and alias it (CONSOLIDATED_TOOL_ALIASES).",
  },
  {
    signature: "generate:offer",
    tools: ["draft_offer", "generate_offer", "generate_offer_letter"],
    since: "2026-08-10",
    target: "generate_offer_letter",
    reason:
      "Overlapping offer verbs the audit named. Not silently consolidatable: " +
      "generate_offer returns pricing SUGGESTIONS (no letter); generate_offer_letter " +
      "takes property+buyer, writes the letter AND upserts the pipeline deal " +
      "(emits deal.created); draft_offer takes a dealId, drafts via aiRouter and " +
      "stores to paxMemory. Consolidation target: one letter tool " +
      "(generate_offer_letter) accepting property_id OR deal_id, with draft_offer " +
      "aliased; generate_offer likely renames to suggest_offer_price so its verb " +
      "stops colliding. Needs a product decision on the pipeline-upsert side effect.",
  },
];

// ─── 1. Zero duplicate tool names ────────────────────────────────────────────

describe("Pax tool registry — zero duplicate names", () => {
  it("every toolDefinitions entry's name matches its key, and names are unique", () => {
    const seen = new Set<string>();
    for (const [key, def] of Object.entries(toolDefinitions)) {
      expect((def as { name: string }).name, `toolDefinitions["${key}"].name`).toBe(key);
      expect(seen.has(key), `duplicate tool name "${key}"`).toBe(false);
      seen.add(key);
    }
  });

  it("the App Intent registry (what the Pax loop consumes) is duplicate-free and mirrors toolDefinitions", () => {
    const names = intentNames();
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual([...toolNames].sort());
  });
});

// ─── 2. Normalized verb+object collisions require dated allowlisting ─────────

describe("Pax tool registry — duplicate-verb signatures", () => {
  const groups = new Map<string, string[]>();
  for (const name of toolNames) {
    const sig = verbObjectSignature(name);
    groups.set(sig, [...(groups.get(sig) ?? []), name]);
  }
  const collisions = [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([signature, members]) => ({ signature, tools: [...members].sort() }))
    .sort((a, b) => a.signature.localeCompare(b.signature));

  it("every signature collision is covered by an explicit dated allowlist entry (no silent duplicates)", () => {
    const allowlisted = DUPLICATE_ALLOWLIST
      .map(({ signature, tools }) => ({ signature, tools: [...tools].sort() }))
      .sort((a, b) => a.signature.localeCompare(b.signature));
    // EXACT match, both directions: a new duplicate fails (not allowlisted); a
    // consolidated duplicate fails until its stale allowlist entry is removed.
    expect(collisions).toEqual(allowlisted);
  });

  it("every allowlist entry is dated and names a consolidation target that is one of its own tools", () => {
    for (const entry of DUPLICATE_ALLOWLIST) {
      expect(entry.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.tools).toContain(entry.target);
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });
});

// ─── 3. Consolidated aliases stay call-compatible ────────────────────────────

describe("Pax tool registry — consolidated aliases", () => {
  it("each alias is no longer offered (absent from toolDefinitions and every role list), and its target exists", () => {
    const offeredToExecutive = new Set(
      getToolsForRoleFromRegistry("executive").map((t) => t.function.name),
    );
    for (const [alias, target] of Object.entries(CONSOLIDATED_TOOL_ALIASES)) {
      expect(alias in toolDefinitions, `alias "${alias}" must be removed from toolDefinitions`).toBe(false);
      expect(target in toolDefinitions, `target "${target}" must exist in toolDefinitions`).toBe(true);
      expect(offeredToExecutive.has(alias), `alias "${alias}" must not be offered to the model`).toBe(false);
      expect(offeredToExecutive.has(target), `target "${target}" must be offered to the model`).toBe(true);
    }
  });

  it("each alias keeps its executor case arm (persisted tool_calls / history replay stay executable)", () => {
    for (const alias of Object.keys(CONSOLIDATED_TOOL_ALIASES)) {
      expect(
        toolsSource.includes(`case "${alias}": {`),
        `executeTool must retain a case arm for consolidated alias "${alias}"`,
      ).toBe(true);
    }
  });
});

// ─── 4. Per-context capability scoping ───────────────────────────────────────

describe("Pax capability scoping — surface mounts", () => {
  it("PAX_TOOL_SURFACES is total over toolDefinitions (default-deny: a new tool MUST declare its surfaces here)", () => {
    expect([...Object.keys(PAX_TOOL_SURFACES)].sort()).toEqual([...toolNames].sort());
    for (const [name, surfaces] of Object.entries(PAX_TOOL_SURFACES)) {
      expect(surfaces.length, `"${name}" must be mounted on at least one surface`).toBeGreaterThan(0);
      for (const s of surfaces) {
        expect(PAX_SURFACES).toContain(s);
      }
    }
  });

  it("toolAllowedOnSurface actually filters (mechanism check with an injected map)", () => {
    const syntheticMap = {
      read_thing: ["pax_inbox", "scheduler"] as const,
      send_thing: ["pax_inbox"] as const,
    };
    expect(toolAllowedOnSurface("read_thing", "scheduler", syntheticMap)).toBe(true);
    expect(toolAllowedOnSurface("send_thing", "scheduler", syntheticMap)).toBe(false);
    expect(toolAllowedOnSurface("send_thing", "pax_inbox", syntheticMap)).toBe(true);
    // DEFAULT-DENY: an undeclared tool is mounted nowhere.
    expect(toolAllowedOnSurface("undeclared_tool", "pax_inbox", syntheticMap)).toBe(false);
  });

  it("buildPaxToolList (the list the model receives) equals the registry filtered by surface mounts, per surface", () => {
    const landKnowledgeOn = isLandKnowledgeEnabled();
    for (const surface of PAX_SURFACES) {
      const expected = getToolsForRoleFromRegistry("executive")
        .map((t) => t.function.name)
        .filter((name) => toolAllowedOnSurface(name, surface))
        .filter((name) => landKnowledgeOn || name !== "retrieve_land_knowledge")
        .sort();
      const actual = buildPaxToolList("executive", surface)
        .map((t) => t.function.name)
        .sort();
      expect(actual, `surface "${surface}"`).toEqual(expected);
    }
  });

  it("today's truth: the rail (pax_inbox) mounts the full catalog — narrowing it must be a deliberate edit here", () => {
    for (const name of toolNames) {
      expect(toolAllowedOnSurface(name, "pax_inbox"), `"${name}" on pax_inbox`).toBe(true);
    }
  });

  it("spawn_subagent builds its child tool list on the pax_subagent surface (wired, not just declared)", () => {
    // Derived from source next to the spawn_subagent processChat call — the
    // surface option must be passed where the recursion actually happens.
    const spawnArm = toolsSource.slice(toolsSource.indexOf('case "spawn_subagent"'));
    const callStart = spawnArm.indexOf("await processChat(");
    expect(callStart, "spawn_subagent must recurse through processChat").toBeGreaterThan(-1);
    // The options object of that call (everything up to its closing `});`).
    const callBlock = spawnArm.slice(callStart, spawnArm.indexOf("});", callStart) + 3);
    expect(callBlock).toContain('surface: "pax_subagent"');
  });
});
