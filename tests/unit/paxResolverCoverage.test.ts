/**
 * PF-11 — the resolver-disposition gate.
 *
 * Invariant (design memo pf11-resolver-gate-design-2026-11.md §1):
 * every tool on the chat path has exactly one recorded resolver
 * disposition, and the build fails by name until it does.
 *
 * Populations are DERIVED from source, never listed:
 *   C  — top-level case labels of executeTool (server/ai/tools.ts),
 *        cross-checked against the executeTool rows of CAPABILITY_ROWS
 *        (shared/pax-capabilities.ts); the two derivations must agree
 *        as sets or the gate fails loudly, never vacuously.
 *   S  — top-level case labels of executeSupportTool
 *        (server/ai/supportAgent.ts), cross-checked the same way.
 *   R  — the RESOLVER_TOOL_NAMES literal (server/ai/paxSupportResolver.ts).
 *   PS — the PAUSE_SAFE_SUPPORT_TOOLS literal (server/ai/supportAgent.ts).
 *
 * The register (scripts/resolver-dispositions.json) records the
 * JUDGMENTS: one entry per chat tool — variant / write-pinned-absent /
 * excluded-with-reason / founder-gated — plus the supportNative list
 * accounting for resolver names with no chat twin (reverse direction,
 * memo §3 assertion 6; Slice 2 folded into this PR per memo §5).
 *
 * Slice 1b split (coordinator decision, recorded in the PR body): the
 * 45 pre-existing read-class chat tools with no variant and no truthful
 * exclusion reason are NOT silently dispositioned. They are named in
 * SLICE_1B_NAMED_LIST below, pinned at exactly 45, under shrink-only
 * semantics: a listed tool must be in C, must be read-class, must have
 * NO register entry, and must have no variant at any registration
 * point. Removing a name without adding its register entry in the
 * same PR fails (the name becomes unaccounted). Slice 1b dispositions
 * the 45 and shrinks the list to 0. (Composition cure, 2026-11-27
 * round: three further read-class tools with no variant and no
 * truthful exclusion reason — get_rehab_projects, get_rehab_detail,
 * get_flip_analysis — landed after this gate was authored and are
 * parked here on the same terms; the pin is 48 until Slice 1b
 * dispositions all 48 and shrinks the list to 0.)
 *
 * This gate reads purposeLedgerCensus files NEVER. The founder-gated
 * entry for get_notes records the pendency of Founder Decision #1 in
 * THIS register only; it creates no census DEBT entry and implies none.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const REGISTER_FILE = "scripts/resolver-dispositions.json";

/** Exact-count pins (the census DEBT_BASELINE pattern): a count changes
 *  only in the same PR that adds/removes an entry of that kind. */
const EXCLUDED_BASELINE = 1;
const FOUNDER_GATED_BASELINE = 1;
const NAMED_LIST_BASELINE = 48;

/** Vacuity floors, seeded at 75% of the live counts at the target base
 *  (C 95 · S 95 · R 34 · PS 91), asserted BEFORE any equality check so a
 *  broken parse fails loudly instead of passing on an empty population. */
const FLOORS = { C: 71, R: 25, S: 71, PS: 68 } as const;

/** The Slice 1b named list: the exact 45 read-class chat tools with no
 *  variant and no exclusion reason at the Slice 1 base, transcribed
 *  verbatim from the coordinator's mechanical derivation, plus the 3
 *  read-class tools parked by the 2026-11-27 composition cure on the
 *  same terms (48 total). Shrink-only. */
const SLICE_1B_NAMED_LIST = [
  "get_leads",
  "get_lead_details",
  "get_properties",
  "get_property_details",
  "calculate_amortization",
  "get_cashflow_summary",
  "get_dashboard_stats",
  "get_pipeline_summary",
  "get_system_context",
  "get_credits",
  "quote_outbound_cost",
  "get_campaigns",
  "get_inbox_replies",
  "get_team_activity",
  "get_finance_summary",
  "get_plan_limits",
  "get_sending_identity_status",
  "get_product_facts",
  "escalate_to_support",
  "get_deals",
  "get_tasks",
  "extract_properties_from_text",
  "generate_offer",
  "run_comps_analysis",
  "calculate_roi",
  "calculate_payment_schedule",
  "research_property",
  "get_property_enrichment",
  "browse_web",
  "browse_search",
  "run_comps",
  "get_stale_leads",
  "draft_outreach_message",
  "remember_fact",
  "recall_facts",
  "spawn_subagent",
  "retrieve_land_knowledge",
  "search_gmail",
  "get_stripe_customer",
  "list_stripe_payments",
  "search_drive",
  "get_drive_file",
  "list_calendar_events",
  "search_mls_listings",
  "get_mls_comps",
  "get_rehab_projects",
  "get_rehab_detail",
  "get_flip_analysis",
] as const;

// ── Derivations (mechanical, from source) ─────────────────────────────

type CapabilityRowLite = { dispatch: string; group: string; pauseSafe: boolean; family?: string };

interface Derived {
  C: Set<string>;
  S: Set<string>;
  R: Set<string>;
  PS: Set<string>;
  rows: Record<string, CapabilityRowLite>;
  chatRows: Set<string>;
  supRows: Set<string>;
}

/** Top-level `case "name":` labels inside one exported async function —
 *  the inventory test's exact discipline: comments stripped with the
 *  shared stripComments lexer, body bounded by the function's close. */
function caseLabels(rel: string, fn: string): string[] {
  const src = stripComments(read(rel));
  const start = src.indexOf(`export async function ${fn}(`);
  if (start < 0) throw new Error(`${rel}: ${fn} not found`);
  const end = src.indexOf("\n}\n", start);
  const body = src.slice(start, end < 0 ? src.length : end);
  const out: string[] = [];
  for (const m of body.matchAll(/^ {6}case "([a-z_0-9]+)":/gm)) out.push(m[1]);
  return out;
}

/** CAPABILITY_ROWS rows. At this ref the rows are SINGLE-LINE JSON-style
 *  entries (`  "name": { "dispatch": ..., ... },`) — parse the format
 *  that exists, line by line, over the comment-stripped source. */
function parseCapabilityRows(): Record<string, CapabilityRowLite> {
  const src = stripComments(read("shared/pax-capabilities.ts"));
  const rows: Record<string, CapabilityRowLite> = {};
  for (const line of src.split("\n")) {
    const mm = /^ {2}"([a-z_0-9]+)": \{(.+)\},?$/.exec(line);
    if (!mm) continue;
    const body = mm[2];
    const disp = /"dispatch":\s*"(executeTool|executeSupportTool)"/.exec(body);
    if (!disp) continue;
    const grp = /"group":\s*"([^"]+)"/.exec(body);
    const ps = /"pauseSafe":\s*(true|false)/.exec(body);
    const fam = /"family":\s*"([^"]+)"/.exec(body);
    rows[mm[1]] = {
      dispatch: disp[1],
      group: grp?.[1] ?? "",
      pauseSafe: ps ? ps[1] === "true" : false,
      family: fam?.[1],
    };
  }
  return rows;
}

/** A flat `as const` / Set string-array literal, delimited-block parse. */
function parseNameLiteral(rel: string, anchor: string, terminator: string): string[] {
  const src = stripComments(read(rel));
  const start = src.indexOf(anchor);
  if (start < 0) throw new Error(`${rel}: ${anchor} not found`);
  const end = src.indexOf(terminator, start);
  if (end < 0) throw new Error(`${rel}: ${anchor} block not terminated`);
  return [...src.slice(start, end).matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]);
}

function derivePopulations(): Derived {
  const C = new Set(caseLabels("server/ai/tools.ts", "executeTool"));
  const S = new Set(caseLabels("server/ai/supportAgent.ts", "executeSupportTool"));
  const R = new Set(parseNameLiteral("server/ai/paxSupportResolver.ts", "const RESOLVER_TOOL_NAMES", "];"));
  const PS = new Set(parseNameLiteral("server/ai/supportAgent.ts", "export const PAUSE_SAFE_SUPPORT_TOOLS", "]);"));
  const rows = parseCapabilityRows();
  const chatRows = new Set(Object.keys(rows).filter((k) => rows[k].dispatch === "executeTool"));
  const supRows = new Set(Object.keys(rows).filter((k) => rows[k].dispatch === "executeSupportTool"));
  return { C, S, R, PS, rows, chatRows, supRows };
}

// ── The register ──────────────────────────────────────────────────────

interface RegisterEntry {
  tool: string;
  disposition: string;
  variant?: string;
  reason?: string;
  revocation?: string;
}

interface SupportNativeEntry {
  name: string;
  reason?: string;
}

interface Register {
  entries: RegisterEntry[];
  supportNative: SupportNativeEntry[];
}

function loadRegister(): Register {
  return JSON.parse(read(REGISTER_FILE)) as Register;
}

// ── The gate logic (injectable inputs, so falsification legs can feed
//    it synthetic mutations of the register and the derived sets) ─────

const isWriteClass = (d: Derived, tool: string) => {
  const row = d.rows[tool];
  return !!row && (row.group !== "looks_and_drafts" || row.pauseSafe === false);
};

const REMEDIES = [
  `  Add exactly one entry to ${REGISTER_FILE}:`,
  `    - build a read-only support variant and record { "disposition": "variant", "variant": "<support name>" }, or`,
  `    - if it writes or sends, record { "disposition": "write-pinned-absent" } (writes never get a support variant), or`,
  `    - if a pause-safe variant would bypass a permission-ladder fence, record`,
  `      { "disposition": "excluded-with-reason", "reason": "<the fence>", "revocation": "<the condition that removes this entry>" }`,
  `      and raise EXCLUDED_BASELINE in tests/unit/paxResolverCoverage.test.ts in the same PR.`,
  `  A disposition that parks the decision on a founder ruling is recorded by the fleet coordinator as`,
  `  "founder-gated" — a build lane never self-assigns it.`,
].join("\n");

function findViolations(reg: Register, d: Derived, namedList: readonly string[]): string[] {
  const out: string[] = [];
  const entries = reg.entries ?? [];
  const natives = reg.supportNative ?? [];

  // Entry uniqueness + staleness.
  const byTool = new Map<string, RegisterEntry>();
  for (const e of entries) {
    if (byTool.has(e.tool)) out.push(`paxResolverCoverage: chat tool "${e.tool}" has MORE THAN ONE resolver disposition in ${REGISTER_FILE}. Keep exactly one entry for it.`);
    byTool.set(e.tool, e);
    if (!d.C.has(e.tool)) out.push(`paxResolverCoverage: register entry "${e.tool}" in ${REGISTER_FILE} names no chat tool (not a case label of executeTool in server/ai/tools.ts) — the entry is STALE. Delete it, or restore the tool.`);
  }

  // Named-list hygiene: pinned size, unique, all real chat tools.
  if (namedList.length !== NAMED_LIST_BASELINE) out.push(`paxResolverCoverage: SLICE_1B_NAMED_LIST holds ${namedList.length} names but NAMED_LIST_BASELINE pins ${NAMED_LIST_BASELINE}. The list is shrink-only: a name leaves only when its register entry is added in the same PR, and the pin drops with it.`);
  const namedSet = new Set<string>();
  for (const name of namedList) {
    if (namedSet.has(name)) out.push(`paxResolverCoverage: Slice 1b named list contains "${name}" twice. Keep exactly one line per tool.`);
    namedSet.add(name);
    if (!d.C.has(name)) out.push(`paxResolverCoverage: Slice 1b named-list tool "${name}" is not a chat tool (not a case label of executeTool in server/ai/tools.ts) — the list entry is STALE. Remove it from SLICE_1B_NAMED_LIST in tests/unit/paxResolverCoverage.test.ts and drop NAMED_LIST_BASELINE with it.`);
  }

  const variantClaims = new Map<string, string>(); // variant name -> claiming chat tool

  // Forward direction: every chat tool accounted for exactly once.
  for (const tool of d.C) {
    const entry = byTool.get(tool);
    const listed = namedSet.has(tool);
    if (entry && listed) {
      out.push(`paxResolverCoverage: chat tool "${tool}" is BOTH in ${REGISTER_FILE} and on the Slice 1b named list — it must be exactly one. If the register entry is its disposition, remove "${tool}" from SLICE_1B_NAMED_LIST in tests/unit/paxResolverCoverage.test.ts and drop NAMED_LIST_BASELINE in the same PR.`);
      continue;
    }
    if (!entry && !listed) {
      out.push(`paxResolverCoverage: chat tool "${tool}" has NO resolver disposition.\n${REMEDIES}`);
      continue;
    }
    if (!entry) {
      // Named-list semantics: read-class, and no variant anywhere.
      if (isWriteClass(d, tool)) out.push(`paxResolverCoverage: Slice 1b named-list tool "${tool}" is WRITE-class (its CAPABILITY_ROWS row in shared/pax-capabilities.ts has group != "looks_and_drafts" or pauseSafe === false) — the named list holds read-class tools only. Record { "disposition": "write-pinned-absent" } for it in ${REGISTER_FILE}, remove it from SLICE_1B_NAMED_LIST, and drop NAMED_LIST_BASELINE in the same PR.`);
      const claimedAsVariant = [...variantClaims.values()].includes(tool) || entries.some((e) => e.variant === tool);
      if (d.S.has(tool) || d.R.has(tool) || d.PS.has(tool) || d.supRows.has(tool) || claimedAsVariant) {
        out.push(`paxResolverCoverage: Slice 1b named-list tool "${tool}" now HAS a variant at a registration point (executeSupportTool case / RESOLVER_TOOL_NAMES / PAUSE_SAFE_SUPPORT_TOOLS / executeSupportTool capability row / a register variant claim) — its list entry is STALE. Remove "${tool}" from SLICE_1B_NAMED_LIST, add its { "disposition": "variant", "variant": "${tool}" } entry to ${REGISTER_FILE}, and drop NAMED_LIST_BASELINE in the same PR.`);
      }
      continue;
    }

    // Exactly one entry: check it against its disposition's rules.
    switch (entry.disposition) {
      case "variant": {
        if (isWriteClass(d, tool)) out.push(`paxResolverCoverage: chat tool "${tool}" is WRITE-class but carries a "variant" disposition in ${REGISTER_FILE} — writes never get a support variant (FD5). Change the entry to { "disposition": "write-pinned-absent" }.`);
        const v = entry.variant;
        if (!v) {
          out.push(`paxResolverCoverage: chat tool "${tool}" has a "variant" disposition in ${REGISTER_FILE} but names no variant. Record the support variant's name as "variant".`);
          break;
        }
        if (variantClaims.has(v)) out.push(`paxResolverCoverage: support variant "${v}" is claimed by BOTH "${variantClaims.get(v)}" and "${tool}" in ${REGISTER_FILE} — variant names are unique across entries. Give each chat tool its own variant.`);
        variantClaims.set(v, tool);
        if (!d.S.has(v)) out.push(`paxResolverCoverage: variant "${v}" recorded for chat tool "${tool}" in ${REGISTER_FILE} is NOT a case label of executeSupportTool in server/ai/supportAgent.ts. Build the variant, or correct the recorded name.`);
        if (!d.R.has(v)) out.push(`paxResolverCoverage: variant "${v}" recorded for chat tool "${tool}" in ${REGISTER_FILE} is NOT in RESOLVER_TOOL_NAMES in server/ai/paxSupportResolver.ts. Add it to the resolver subset, or correct the recorded name.`);
        if (!d.PS.has(v)) out.push(`paxResolverCoverage: variant "${v}" recorded for chat tool "${tool}" in ${REGISTER_FILE} is NOT in PAUSE_SAFE_SUPPORT_TOOLS in server/ai/supportAgent.ts. Add it, or correct the recorded name.`);
        if (!d.supRows.has(v)) out.push(`paxResolverCoverage: variant "${v}" recorded for chat tool "${tool}" in ${REGISTER_FILE} has NO executeSupportTool CAPABILITY_ROWS row in shared/pax-capabilities.ts. Add the row, or correct the recorded name.`);
        break;
      }
      case "write-pinned-absent": {
        if (!isWriteClass(d, tool)) out.push(`paxResolverCoverage: chat tool "${tool}" is READ-class (group "looks_and_drafts", pauseSafe true in shared/pax-capabilities.ts) but is dispositioned "write-pinned-absent" in ${REGISTER_FILE} — that silent skip is exactly the PF-11 defect family. Build its read-only support variant and record { "disposition": "variant" }, or record an "excluded-with-reason" entry naming the permission-ladder fence it preserves.`);
        if (entry.variant) out.push(`paxResolverCoverage: chat tool "${tool}" is dispositioned "write-pinned-absent" in ${REGISTER_FILE} but also names variant "${entry.variant}" — a write-pinned tool has no variant. Remove the "variant" field.`);
        break;
      }
      case "excluded-with-reason": {
        if (isWriteClass(d, tool)) out.push(`paxResolverCoverage: chat tool "${tool}" is WRITE-class but carries an "excluded-with-reason" disposition in ${REGISTER_FILE} — only a read may be excluded. Change the entry to { "disposition": "write-pinned-absent" }.`);
        if (!entry.reason?.trim()) out.push(`paxResolverCoverage: chat tool "${tool}" has an "excluded-with-reason" entry in ${REGISTER_FILE} with no "reason". Name the permission-ladder fence the exclusion preserves.`);
        if (!entry.revocation?.trim()) out.push(`paxResolverCoverage: chat tool "${tool}" has an "excluded-with-reason" entry in ${REGISTER_FILE} with no "revocation". Name the condition under which the entry must be removed and replaced by a variant.`);
        break;
      }
      case "founder-gated": {
        if (!entry.variant) out.push(`paxResolverCoverage: chat tool "${tool}" has a "founder-gated" entry in ${REGISTER_FILE} but names no variant. Record the built-but-unlanded variant's name.`);
        if (!entry.reason?.trim()) out.push(`paxResolverCoverage: chat tool "${tool}" has a "founder-gated" entry in ${REGISTER_FILE} with no "reason". Name the founder ruling the decision is parked on.`);
        if (!entry.revocation?.trim()) out.push(`paxResolverCoverage: chat tool "${tool}" has a "founder-gated" entry in ${REGISTER_FILE} with no "revocation". Name what happens on each ruling outcome.`);
        const v = entry.variant;
        if (v && (d.S.has(v) || d.R.has(v) || d.PS.has(v) || d.supRows.has(v))) {
          out.push(`paxResolverCoverage: founder-gated variant "${v}" for chat tool "${tool}" HAS LANDED (it now exists at a registration point: executeSupportTool case / RESOLVER_TOOL_NAMES / PAUSE_SAFE_SUPPORT_TOOLS / executeSupportTool capability row) — the "founder-gated" entry in ${REGISTER_FILE} is STALE. Flip it to { "disposition": "variant", "variant": "${v}" } and drop FOUNDER_GATED_BASELINE in tests/unit/paxResolverCoverage.test.ts in the same PR.`);
        }
        break;
      }
      default:
        out.push(`paxResolverCoverage: chat tool "${tool}" has unknown disposition "${entry.disposition}" in ${REGISTER_FILE}. Valid dispositions: variant, write-pinned-absent, excluded-with-reason, founder-gated.`);
    }
  }

  // Exact-count pins.
  const excludedCount = entries.filter((e) => e.disposition === "excluded-with-reason").length;
  if (excludedCount !== EXCLUDED_BASELINE) out.push(`paxResolverCoverage: the register holds ${excludedCount} "excluded-with-reason" entries but EXCLUDED_BASELINE pins ${EXCLUDED_BASELINE} in tests/unit/paxResolverCoverage.test.ts. Adding or removing an exclusion raises/drops the pin in the same PR — that raise is the visible, auditable act.`);
  const founderCount = entries.filter((e) => e.disposition === "founder-gated").length;
  if (founderCount !== FOUNDER_GATED_BASELINE) out.push(`paxResolverCoverage: the register holds ${founderCount} "founder-gated" entries but FOUNDER_GATED_BASELINE pins ${FOUNDER_GATED_BASELINE} in tests/unit/paxResolverCoverage.test.ts. A founder-gated entry is recorded by the fleet coordinator, never self-assigned by a build lane.`);

  // Reverse direction: every resolver name accounted for exactly once.
  const nativeNames = new Set<string>();
  for (const n of natives) {
    if (nativeNames.has(n.name)) out.push(`paxResolverCoverage: supportNative list in ${REGISTER_FILE} contains "${n.name}" twice. Keep exactly one line per support-native tool.`);
    nativeNames.add(n.name);
    if (!n.reason?.trim()) out.push(`paxResolverCoverage: supportNative entry "${n.name}" in ${REGISTER_FILE} has no "reason". Record why this resolver tool has no chat twin.`);
    if (variantClaims.has(n.name)) out.push(`paxResolverCoverage: supportNative entry "${n.name}" in ${REGISTER_FILE} is STALE — "${n.name}" is recorded as the variant of chat tool "${variantClaims.get(n.name)}". Remove the supportNative line.`);
    if (!d.R.has(n.name)) out.push(`paxResolverCoverage: supportNative entry "${n.name}" in ${REGISTER_FILE} is STALE — "${n.name}" is not in RESOLVER_TOOL_NAMES in server/ai/paxSupportResolver.ts. Remove the supportNative line.`);
  }
  for (const name of d.R) {
    const asVariant = variantClaims.has(name);
    const asNative = nativeNames.has(name);
    if (asVariant && asNative) out.push(`paxResolverCoverage: resolver tool "${name}" is accounted for TWICE — as the variant of "${variantClaims.get(name)}" and as a supportNative entry in ${REGISTER_FILE}. Keep exactly one accounting.`);
    if (!asVariant && !asNative) out.push(`paxResolverCoverage: resolver tool "${name}" (in RESOLVER_TOOL_NAMES in server/ai/paxSupportResolver.ts) is UNACCOUNTED in ${REGISTER_FILE} — it is no chat tool's recorded variant and has no supportNative entry. Record it: as the "variant" of its chat tool, or in "supportNative" with a reason if it has no chat twin.`);
  }

  return out;
}

// ── The live gate ─────────────────────────────────────────────────────

const derived = derivePopulations();
const register = loadRegister();

describe("derivations are whole (vacuity floors before equality)", () => {
  it("each population clears its floor", () => {
    expect(derived.C.size, `executeTool case labels yielded ${derived.C.size}`).toBeGreaterThanOrEqual(FLOORS.C);
    expect(derived.R.size, `RESOLVER_TOOL_NAMES yielded ${derived.R.size}`).toBeGreaterThanOrEqual(FLOORS.R);
    expect(derived.S.size, `executeSupportTool case labels yielded ${derived.S.size}`).toBeGreaterThanOrEqual(FLOORS.S);
    expect(derived.PS.size, `PAUSE_SAFE_SUPPORT_TOOLS yielded ${derived.PS.size}`).toBeGreaterThanOrEqual(FLOORS.PS);
  });

  it("the CAPABILITY_ROWS parse yields 202 rows (104 executeTool / 98 executeSupportTool) on this tree", () => {
    expect(Object.keys(derived.rows).length).toBe(202);
    expect(derived.chatRows.size).toBe(104);
    expect(derived.supRows.size).toBe(98);
  });

  it("the two independent derivations of C agree as sets", () => {
    expect([...derived.chatRows].filter((n) => !derived.C.has(n)), "executeTool rows with no executeTool case label").toEqual([]);
    expect([...derived.C].filter((n) => !derived.chatRows.has(n)), "executeTool case labels with no executeTool row").toEqual([]);
  });

  it("the two independent derivations of S agree as sets", () => {
    expect([...derived.supRows].filter((n) => !derived.S.has(n)), "executeSupportTool rows with no executeSupportTool case label").toEqual([]);
    expect([...derived.S].filter((n) => !derived.supRows.has(n)), "executeSupportTool case labels with no executeSupportTool row").toEqual([]);
  });
});

describe("the resolver-disposition invariant holds on this tree", () => {
  it("every chat tool has exactly one disposition or a Slice 1b named-list line, and every resolver name is accounted for", () => {
    expect(findViolations(register, derived, SLICE_1B_NAMED_LIST)).toEqual([]);
  });

  it("the exact-count pins match the register and the named list", () => {
    expect(register.entries.filter((e) => e.disposition === "excluded-with-reason").length).toBe(EXCLUDED_BASELINE);
    expect(register.entries.filter((e) => e.disposition === "founder-gated").length).toBe(FOUNDER_GATED_BASELINE);
    expect(SLICE_1B_NAMED_LIST.length).toBe(NAMED_LIST_BASELINE);
    expect(new Set(SLICE_1B_NAMED_LIST).size).toBe(SLICE_1B_NAMED_LIST.length);
  });
});

describe("falsification: the gate can fail, by name", () => {
  const cloneRegister = (): Register => JSON.parse(JSON.stringify(register)) as Register;
  const cloneDerived = (patch: Partial<Record<"C" | "S" | "R" | "PS", string>>): Derived => ({
    ...derived,
    C: patch.C ? new Set([...derived.C, patch.C]) : derived.C,
    S: patch.S ? new Set([...derived.S, patch.S]) : derived.S,
    R: patch.R ? new Set([...derived.R, patch.R]) : derived.R,
    PS: patch.PS ? new Set([...derived.PS, patch.PS]) : derived.PS,
    supRows: patch.S ? new Set([...derived.supRows, patch.S]) : derived.supRows,
  });

  it("(a) a register with one entry dropped fails naming that tool", () => {
    const victim = register.entries.find((e) => e.disposition === "variant")!;
    const mutated = cloneRegister();
    mutated.entries = mutated.entries.filter((e) => e.tool !== victim.tool);
    const hits = findViolations(mutated, derived, SLICE_1B_NAMED_LIST);
    expect(hits.some((h) => h.includes(`"${victim.tool}"`) && h.includes("NO resolver disposition")), `dropping ${victim.tool} was not caught: ${hits}`).toBe(true);
  });

  it("(b) a variant entry claiming a nonexistent variant name fails naming it", () => {
    const mutated = cloneRegister();
    const entry = mutated.entries.find((e) => e.disposition === "variant")!;
    entry.variant = "nonexistent_variant_xyz";
    const hits = findViolations(mutated, derived, SLICE_1B_NAMED_LIST);
    expect(hits.some((h) => h.includes('"nonexistent_variant_xyz"')), `a nonexistent variant claim was not caught: ${hits}`).toBe(true);
  });

  it("(c) a read-class tool re-dispositioned write-pinned-absent is caught", () => {
    const mutated = cloneRegister();
    const entry = mutated.entries.find((e) => e.disposition === "variant")!;
    const victim = entry.tool;
    entry.disposition = "write-pinned-absent";
    delete entry.variant;
    const hits = findViolations(mutated, derived, SLICE_1B_NAMED_LIST);
    expect(hits.some((h) => h.includes(`"${victim}"`) && h.includes("READ-class")), `read-class ${victim} as write-pinned-absent was not caught: ${hits}`).toBe(true);
  });

  it("(d) a founder-gated entry whose variant has appeared fails as stale", () => {
    const gated = register.entries.find((e) => e.disposition === "founder-gated")!;
    const landed = cloneDerived({ S: gated.variant!, R: gated.variant!, PS: gated.variant! });
    const hits = findViolations(register, landed, SLICE_1B_NAMED_LIST);
    expect(hits.some((h) => h.includes(`"${gated.variant}"`) && h.includes("STALE")), `landed founder-gated variant ${gated.variant} was not caught as stale: ${hits}`).toBe(true);
  });

  it("(e) a named-list tool given a register entry while still listed fails (both/neither rule)", () => {
    const listed = SLICE_1B_NAMED_LIST[0];
    const mutated = cloneRegister();
    mutated.entries.push({ tool: listed, disposition: "write-pinned-absent" });
    const hits = findViolations(mutated, derived, SLICE_1B_NAMED_LIST);
    expect(hits.some((h) => h.includes(`"${listed}"`) && h.includes("BOTH")), `named-list tool ${listed} with a register entry was not caught: ${hits}`).toBe(true);
  });

  it("(f) an unrecorded name injected into RESOLVER_TOOL_NAMES fails the reverse direction by name", () => {
    const injected = cloneDerived({ R: "unrecorded_resolver_tool" });
    const hits = findViolations(register, injected, SLICE_1B_NAMED_LIST);
    expect(hits.some((h) => h.includes('"unrecorded_resolver_tool"') && h.includes("UNACCOUNTED")), `unrecorded resolver name was not caught: ${hits}`).toBe(true);
  });
});
