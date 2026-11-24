/**
 * PP-1 — the Pax capability inventory is complete, current, and honest.
 *
 * shared/pax-capabilities.ts holds one row per top-level case label of
 * BOTH dispatch switches. The row is not a second authority: every field
 * an existing registry already holds is ASSERTED against that registry —
 *   group / domain / dispatch → TOOL_REGISTRY (shared/pax-controls.ts)
 *   scope (chat)               → INTENT_META (appIntents/intentScopes.ts)
 *   scope (support)            → SUPPORT_TOOL_SCOPES (ai/supportToolScopes.ts)
 *   approvalRequired           → APPROVAL_REQUIRED_TOOLS (approvalKernel.ts)
 *   pauseSafe                  → PAUSE_SAFE_TOOLS / PAUSE_SAFE_SUPPORT_TOOLS
 *   roles                      → BOTH bundle maps: legacy getToolsForRole
 *                                (ai/tools.ts) AND roleAllowList via
 *                                getToolsForRoleFromRegistry
 *                                (services/appIntents/index.ts — the map
 *                                the Pax loop actually consumes; the #692
 *                                blind spot was asserting only the first)
 * The row carries only what no registry holds: receipt mode, the
 * coverage contract, family, objects, the RW memo row, and `since`.
 *
 * Receipt mode is derived, not declared-and-trusted: approval-required →
 * "witnessed" (the kernel's replay receipt); pause-safe → "none"; else
 * the case body itself is scanned (comments stripped with the shared
 * stripComments lexer — never a hand-rolled strip) for its own
 * recordPaxEffect( → "own", otherwise the post-switch generic hook →
 * "generic_hook".
 *
 * The generated doc (docs/compliance/pax-capability-inventory.md) is
 * asserted byte-current against the rows. NOTE: the purpose-ledger
 * census doc this pattern was modelled on is NOT test-pinned (only
 * header comments name it) — this inventory pins its own doc directly.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CAPABILITY_ROWS, type CapabilityRow } from "../../shared/pax-capabilities";
import { PAX_TOOL_DOMAINS, PAX_TOOL_GROUPS, dispatchForTool } from "../../shared/pax-controls";
import { INTENT_META } from "../../server/services/appIntents/intentScopes";
import { SUPPORT_TOOL_SCOPES } from "../../server/ai/supportToolScopes";
import { APPROVAL_REQUIRED_TOOLS, PAUSE_SAFE_TOOLS, getToolsForRole } from "../../server/ai/tools";
import { PAUSE_SAFE_SUPPORT_TOOLS } from "../../server/ai/supportAgent";
import { getToolsForRoleFromRegistry } from "../../server/services/appIntents";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const TOOL_SWITCHES = [
  { file: "server/ai/tools.ts", fn: "executeTool", dispatch: "executeTool", floor: 40 },
  { file: "server/ai/supportAgent.ts", fn: "executeSupportTool", dispatch: "executeSupportTool", floor: 40 },
] as const;

/** Top-level `case "name":` labels inside one exported async function.
 *  Copied from paxControlsOffered.test.ts (its helper is not exported);
 *  the source is comment-stripped with the shared lexer first. */
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

/** One case's body: from its label to the next case (or the default arm),
 *  so the post-switch receipt hook never bleeds into the last case. */
function caseBody(rel: string, fn: string, name: string): string {
  const src = stripComments(read(rel));
  const start = src.indexOf(`export async function ${fn}(`);
  const end = src.indexOf("\n}\n", start);
  const body = src.slice(start, end < 0 ? src.length : end);
  const at = body.indexOf(`case "${name}":`);
  if (at < 0) throw new Error(`${rel}: case ${name} not found in ${fn}`);
  const rest = body.slice(at);
  const nextCase = rest.slice(1).search(/^ {6}case "/m);
  const nextDefault = rest.indexOf("\n      default:");
  const cuts = [nextCase >= 0 ? nextCase + 1 : -1, nextDefault].filter((n) => n >= 0);
  return rest.slice(0, cuts.length ? Math.min(...cuts) : rest.length);
}

const labelsBySwitch = new Map(TOOL_SWITCHES.map((s) => [s.dispatch, caseLabels(s.file, s.fn)]));
const allLabels = TOOL_SWITCHES.flatMap((s) => (labelsBySwitch.get(s.dispatch) ?? []).map((name) => ({ name, dispatch: s.dispatch })));

const ROLES = ["executive", "assistant", "acquisitions", "underwriting", "marketing", "research", "documents"] as const;

/** Role → tool names, from EACH bundle map separately. */
const legacyByRole = new Map(ROLES.map((r) => [r, getToolsForRole(r).map((t) => t.function.name)] as const));
const registryByRole = new Map(ROLES.map((r) => [r, getToolsForRoleFromRegistry(r).map((t) => t.function.name)] as const));

function expectedRoles(name: string): string[] {
  return ROLES.filter((r) => legacyByRole.get(r)?.includes(name) && registryByRole.get(r)?.includes(name));
}

function expectedReceipt(name: string, dispatch: string): CapabilityRow["receipt"] {
  if (APPROVAL_REQUIRED_TOOLS.has(name)) return "witnessed";
  const pauseSafe = dispatch === "executeTool" ? PAUSE_SAFE_TOOLS.has(name) : PAUSE_SAFE_SUPPORT_TOOLS.has(name);
  if (pauseSafe) return "none";
  const sw = TOOL_SWITCHES.find((s) => s.dispatch === dispatch)!;
  return caseBody(sw.file, sw.fn, name).includes("recordPaxEffect(") ? "own" : "generic_hook";
}

/** The disagreement finder every assertion below goes through — the
 *  falsification block feeds it a synthetic wrong row and expects a hit. */
function findDisagreements(rows: Record<string, CapabilityRow>): string[] {
  const out: string[] = [];
  for (const { name, dispatch } of allLabels) {
    const row = rows[name];
    if (!row) {
      out.push(`${name}: no inventory row`);
      continue;
    }
    if (row.dispatch !== dispatch) out.push(`${name}: dispatch ${row.dispatch} != switch ${dispatch}`);
    if (dispatchForTool(name) !== dispatch) out.push(`${name}: TOOL_REGISTRY dispatch disagrees with its switch`);
    if (row.group !== PAX_TOOL_GROUPS[name]) out.push(`${name}: group ${row.group} != TOOL_REGISTRY ${PAX_TOOL_GROUPS[name]}`);
    const domain = PAX_TOOL_DOMAINS[name] ?? undefined;
    if (row.domain !== domain) out.push(`${name}: domain ${row.domain} != TOOL_REGISTRY ${domain}`);
    const scope = dispatch === "executeTool" ? (INTENT_META[name]?.scope ?? null) : (SUPPORT_TOOL_SCOPES[name] ?? null);
    if (row.scope !== scope) out.push(`${name}: scope ${row.scope} != registry ${scope}`);
    if (row.approvalRequired !== APPROVAL_REQUIRED_TOOLS.has(name)) out.push(`${name}: approvalRequired disagrees with APPROVAL_REQUIRED_TOOLS`);
    const pauseSafe = dispatch === "executeTool" ? PAUSE_SAFE_TOOLS.has(name) : PAUSE_SAFE_SUPPORT_TOOLS.has(name);
    if (row.pauseSafe !== pauseSafe) out.push(`${name}: pauseSafe disagrees with the pause-safe list`);
    const receipt = expectedReceipt(name, dispatch);
    if (row.receipt !== receipt) out.push(`${name}: receipt ${row.receipt} != derived ${receipt}`);
    const roles = dispatch === "executeTool" ? expectedRoles(name) : [];
    if (JSON.stringify(row.roles) !== JSON.stringify(roles)) out.push(`${name}: roles [${row.roles}] != both bundle maps [${roles}]`);
  }
  return out;
}

/** The generated doc's exact rendering — scripts/pax-capability-inventory.mjs
 *  implements the same rendering; this assertion keeps the doc current. */
export function renderInventoryDoc(rows: Record<string, CapabilityRow>): string {
  const names = Object.keys(rows).sort((a, b) => {
    const d = rows[a].dispatch.localeCompare(rows[b].dispatch);
    return d !== 0 ? d : a.localeCompare(b);
  });
  const counts = TOOL_SWITCHES.map((s) => `${names.filter((n) => rows[n].dispatch === s.dispatch).length} ${s.dispatch}`).join(", ");
  const lines = [
    "# Pax capability inventory",
    "",
    "Generated by `scripts/pax-capability-inventory.mjs` from `shared/pax-capabilities.ts` — do not edit by hand.",
    "",
    `${names.length} capabilities: ${counts}.`,
    "",
    "| Tool | Dispatch | Group | Domain | Scope | Approval | Pause-safe | Receipt | Coverage | Not covered | Family | Objects | RW row | Roles | Since |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...names.map((name) => {
      const r = rows[name];
      const cell = (v: string | undefined | null) => (v === undefined || v === null || v === "" ? "-" : v);
      return `| \`${name}\` | ${r.dispatch} | ${r.group} | ${cell(r.domain)} | ${cell(r.scope)} | ${r.approvalRequired} | ${r.pauseSafe} | ${r.receipt} | ${r.coverage} | ${cell(r.notCovered)} | ${r.family} | ${r.objects.join(", ")} | ${cell(r.rwRow)} | ${cell(r.roles.join(", "))} | ${r.since} |`;
    }),
    "",
  ];
  return lines.join("\n");
}

describe("the inventory population is both switches, whole", () => {
  it("finds each switch (per-switch vacuity floor)", () => {
    for (const s of TOOL_SWITCHES) {
      const labels = labelsBySwitch.get(s.dispatch) ?? [];
      expect(labels.length, `${s.fn} yielded ${labels.length} labels`).toBeGreaterThanOrEqual(s.floor);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it("every case label has a row, and every row has a case label (no stale rows)", () => {
    const missing = allLabels.filter(({ name }) => !(name in CAPABILITY_ROWS)).map(({ name }) => name);
    expect(missing, "case labels with no inventory row").toEqual([]);
    const labelSet = new Set(allLabels.map(({ name }) => name));
    const stale = Object.keys(CAPABILITY_ROWS).filter((name) => !labelSet.has(name));
    expect(stale, "inventory rows naming no case label").toEqual([]);
  });
});

describe("every row agrees with the registry that owns each field", () => {
  it("has no disagreements with any source registry (incl. BOTH bundle maps)", () => {
    expect(findDisagreements(CAPABILITY_ROWS)).toEqual([]);
  });

  it("the two bundle maps agree with each other, role by role (the #692 pin, restated for this population)", () => {
    for (const role of ROLES) {
      const legacy = [...(legacyByRole.get(role) ?? [])].sort();
      const registry = [...(registryByRole.get(role) ?? [])].sort();
      expect(registry, `role ${role}: roleAllowList map != legacy getToolsForRole`).toEqual(legacy);
    }
  });

  it("no support tool appears in any chat bundle, in either map", () => {
    for (const name of labelsBySwitch.get("executeSupportTool") ?? []) {
      for (const role of ROLES) {
        expect(legacyByRole.get(role), `${name} in legacy bundle ${role}`).not.toContain(name);
        expect(registryByRole.get(role), `${name} in roleAllowList bundle ${role}`).not.toContain(name);
      }
    }
  });

  it("falsification: a synthetic row with a wrong group is caught by name", () => {
    const victim = allLabels[0].name;
    const mutated: Record<string, CapabilityRow> = {
      ...CAPABILITY_ROWS,
      [victim]: { ...CAPABILITY_ROWS[victim], group: CAPABILITY_ROWS[victim].group === "sends" ? "never" : "sends" },
    };
    const hits = findDisagreements(mutated);
    expect(hits.some((h) => h.startsWith(`${victim}: group`)), `wrong group for ${victim} was not caught: ${hits}`).toBe(true);
  });

  it("falsification: dropping a row is caught by name", () => {
    const victim = allLabels[allLabels.length - 1].name;
    const mutated = { ...CAPABILITY_ROWS };
    delete mutated[victim];
    expect(findDisagreements(mutated)).toContain(`${victim}: no inventory row`);
  });
});

describe("the judgment fields are real", () => {
  it("every row names a family, at least one object, and an ISO since date", () => {
    for (const [name, row] of Object.entries(CAPABILITY_ROWS)) {
      expect(row.family.length, `${name} family`).toBeGreaterThan(2);
      expect(row.objects.length, `${name} objects`).toBeGreaterThanOrEqual(1);
      expect(row.since, `${name} since`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("every coverage-bearing read carries its NOT-covered sentence", () => {
    for (const [name, row] of Object.entries(CAPABILITY_ROWS)) {
      if (row.coverage !== "n/a") {
        expect(row.notCovered, `${name} has coverage ${row.coverage} but no notCovered sentence`).toBeTruthy();
        expect((row.notCovered ?? "").length).toBeGreaterThan(20);
      }
    }
    // The two-book reads and the T7 single-slice reads are really there.
    expect(CAPABILITY_ROWS["get_notes"]?.coverage).toBe("two_book");
    expect(CAPABILITY_ROWS["get_cashflow_summary"]?.coverage).toBe("two_book");
    for (const taxRead of ["get_tax_certificates", "get_tax_certificate", "get_tax_certificate_clock", "get_tax_certificate_ledger"] as const) {
      expect(CAPABILITY_ROWS[taxRead]?.coverage, taxRead).toBe("single_slice");
    }
  });

  it("every receipt mode has at least one member (vacuity)", () => {
    const modes = new Set(Object.values(CAPABILITY_ROWS).map((r) => r.receipt));
    for (const mode of ["none", "generic_hook", "own", "witnessed"] as const) {
      expect(modes.has(mode), `no member with receipt mode ${mode}`).toBe(true);
    }
    // The two own-receipt members known on this base, by name.
    expect(CAPABILITY_ROWS["update_lead_status"]?.receipt).toBe("own");
    expect(CAPABILITY_ROWS["record_tax_ledger_entry"]?.receipt).toBe("own");
  });

  it("T7's five tax tools are inventoried with T7's date", () => {
    for (const name of ["get_tax_certificates", "get_tax_certificate", "get_tax_certificate_clock", "get_tax_certificate_ledger", "record_tax_ledger_entry"] as const) {
      expect(CAPABILITY_ROWS[name], name).toBeDefined();
      expect(CAPABILITY_ROWS[name].family).toBe("tax_lien_deed");
      expect(CAPABILITY_ROWS[name].since).toBe("2026-11-23");
    }
  });
});

describe("the generated doc is current", () => {
  it("docs/compliance/pax-capability-inventory.md matches the rows byte for byte", () => {
    const docPath = path.join(ROOT, "docs/compliance/pax-capability-inventory.md");
    const doc = fs.existsSync(docPath) ? fs.readFileSync(docPath, "utf8") : "";
    expect(doc).toBe(renderInventoryDoc(CAPABILITY_ROWS));
  });
});
