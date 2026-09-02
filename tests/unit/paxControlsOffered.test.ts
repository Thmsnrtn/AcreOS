/**
 * Two stances, and the registries the page and the ratchets share
 * (AUTONOMY_SPEC.md §2, §4.2, §4.4, §4.5, §7).
 *
 * OFFERED_STANCES + STANCE_RULINGS is the ONE lever for "Pax-written
 * messages ever unattended?" (founder question 1, answered NO on
 * 2026-09-02). Widening it requires a dated founder ruling on disk that
 * names the stance. The probe that must turn this red: append a stance to
 * OFFERED_STANCES without a ruling — or with a ruling that does not mention
 * it, or that breaks the "every stance asks" posture.
 *
 * The other registries are held to the same standard — POPULATION
 * ENUMERATED, each pointer resolved:
 *   - PAX_TOOL_GROUPS covers every top-level case of BOTH dispatch switches
 *     (TOOL_SWITCHES below), and agrees with PAUSE_SAFE_* and
 *     APPROVAL_REQUIRED_TOOLS as written in their source files
 *   - UNATTENDED_PATHS: every file:function exists
 *   - PARKED_STATES: names a real table and status
 *   - PAX_NEVER_LIST: every gate is a test file on disk
 *
 * The PATCH-route half of this test (`{stance:"on_its_own"}` → 422,
 * `{pax:{level:2}}` → 422) lands with routes-pax-controls.ts in wave 1 C.
 * What wave 0 pins is the type-level half: the stored shape has no such
 * fields to accept.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ALWAYS_ASK_SUPPORT_TOOLS,
  OFFERED_STANCES,
  PARKED_STATES,
  PAX_ASK_ORIGINS,
  PAX_CONTROLS_DEFAULTS,
  PAX_TOOL_GROUPS,
  STANCE_LABELS,
  STANCE_RULINGS,
  UNATTENDED_PATHS,
  dispatchForTool,
  groupForTool,
} from "../../shared/pax-controls";
import { PAX_NEVER_LIST, PAX_STANCE_COPY } from "../../shared/pax-glossary";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

// ── Stances ─────────────────────────────────────────────────────────────────

describe("the offered stances", () => {
  it("are exactly the two the founder adopted, in page order", () => {
    expect([...OFFERED_STANCES]).toEqual(["ask_before_sending", "ask_before_everything"]);
  });

  it("default to today's behaviour", () => {
    expect(PAX_CONTROLS_DEFAULTS.stance).toBe("ask_before_sending");
    expect(OFFERED_STANCES).toContain(PAX_CONTROLS_DEFAULTS.stance);
  });

  it("every offered stance ASKS — the posture is not a stance a customer can leave", () => {
    // "Every message Pax writes waits for a tap at every stance." A stance
    // whose name does not begin with ask_before_ has no place in this list
    // without the founder rescinding the posture in a dated ruling.
    for (const stance of OFFERED_STANCES) {
      expect(stance, `${stance} is not an asking stance`).toMatch(/^ask_before_/);
    }
  });

  it("every offered stance has a dated founder ruling on disk that names it", () => {
    expect(Object.keys(STANCE_RULINGS).sort()).toEqual([...OFFERED_STANCES].sort());
    for (const stance of OFFERED_STANCES) {
      const ruling = STANCE_RULINGS[stance];
      expect(ruling, `${stance} has no ruling`).toMatch(/^docs\/company\/founder-decision-\d{4}-\d{2}-\d{2}-[\w-]+\.md$/);
      expect(exists(ruling), `${stance}: ruling ${ruling} does not exist`).toBe(true);
      const text = read(ruling);
      expect(text, `${ruling} does not rule on OFFERED_STANCES`).toContain("OFFERED_STANCES");
      expect(text, `${ruling} does not name the stance "${PAX_STANCE_COPY[stance].label}"`).toContain(
        PAX_STANCE_COPY[stance].label,
      );
    }
  });

  it("has glossary copy and a derived label for every offered stance, and nothing else", () => {
    expect(Object.keys(PAX_STANCE_COPY).sort()).toEqual([...OFFERED_STANCES].sort());
    expect(Object.keys(STANCE_LABELS).sort()).toEqual([...OFFERED_STANCES].sort());
    for (const stance of OFFERED_STANCES) {
      expect(STANCE_LABELS[stance]).toBe(PAX_STANCE_COPY[stance].label);
      expect(PAX_STANCE_COPY[stance].sentence.length).toBeGreaterThan(20);
      expect(PAX_STANCE_COPY[stance].toast.length).toBeGreaterThan(20);
    }
  });

  it("the stored user preference no longer has a level, a matrix, or thresholds to accept", () => {
    // `{ pax: { level: 2 } }` anywhere → 422 starts here: a zod schema built
    // from this type cannot admit the fields.
    const src = read("shared/models/auth.ts");
    const at = src.indexOf("export interface AutonomyPreferences");
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf("}", at));
    for (const dead of ["level", "perAction", "thresholdsCents", "timeGuards", "atlas", "sophie"]) {
      expect(body, `AutonomyPreferences still declares ${dead}`).not.toContain(dead);
    }
    expect(src).toMatch(/pausedUntil\?: string/);
  });
});

// ── Tool groups: the population is both switches ────────────────────────────

/**
 * Every place a tool name is dispatched. Adding a third switch without
 * listing it here is the thing that must fail — see CLAUDE.md, third law.
 */
const TOOL_SWITCHES = [
  { file: "server/ai/tools.ts", fn: "executeTool", dispatch: "executeTool", floor: 40 },
  { file: "server/ai/supportAgent.ts", fn: "executeSupportTool", dispatch: "executeSupportTool", floor: 40 },
] as const;

/** Top-level `case "name":` labels inside one exported async function. */
function caseLabels(rel: string, fn: string): string[] {
  const src = read(rel);
  const start = src.indexOf(`export async function ${fn}(`);
  if (start < 0) throw new Error(`${rel}: ${fn} not found`);
  const end = src.indexOf("\n}\n", start);
  const body = src.slice(start, end < 0 ? src.length : end);
  const out: string[] = [];
  for (const m of body.matchAll(/^ {6}case "([a-z_]+)":/gm)) out.push(m[1]);
  return out;
}

/** The string members of a `new Set([...])` literal assigned to `name`. */
function setLiteral(rel: string, name: string): string[] {
  const src = read(rel);
  const start = src.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`${rel}: ${name} not found`);
  const end = src.indexOf("]);", start);
  const stripped = src.slice(start, end).replace(/\/\/[^\n]*/g, "");
  return [...stripped.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("PAX_TOOL_GROUPS covers every dispatch switch", () => {
  const labelsBySwitch = new Map(TOOL_SWITCHES.map((s) => [s.dispatch, caseLabels(s.file, s.fn)]));

  it("finds each switch (per-member vacuity)", () => {
    for (const s of TOOL_SWITCHES) {
      const labels = labelsBySwitch.get(s.dispatch) ?? [];
      expect(labels.length, `${s.file}:${s.fn} yielded ${labels.length} case labels`).toBeGreaterThanOrEqual(s.floor);
      expect(new Set(labels).size, `${s.fn} has duplicate case labels`).toBe(labels.length);
    }
  });

  it("every case label of every switch has a group and the right dispatch", () => {
    const missing: string[] = [];
    for (const s of TOOL_SWITCHES) {
      for (const label of labelsBySwitch.get(s.dispatch) ?? []) {
        if (!(label in PAX_TOOL_GROUPS)) missing.push(`${s.fn}: ${label}`);
        else if (dispatchForTool(label) !== s.dispatch) missing.push(`${s.fn}: ${label} → ${dispatchForTool(label)}`);
      }
    }
    expect(missing, "unclassified or mis-routed tool names").toEqual([]);
  });

  it("every registered switch tool is a real case label (the registry cannot invent tools)", () => {
    const stray: string[] = [];
    for (const name of Object.keys(PAX_TOOL_GROUPS)) {
      const dispatch = dispatchForTool(name);
      if (dispatch === "executeTool" || dispatch === "executeSupportTool") {
        if (!labelsBySwitch.get(dispatch)?.includes(name)) stray.push(`${name} (${dispatch})`);
      }
    }
    expect(stray).toEqual([]);
  });

  it("the names that never reach a switch are the two the spec names", () => {
    const virtual = Object.keys(PAX_TOOL_GROUPS).filter((n) => {
      const d = dispatchForTool(n);
      return d === "finance_ladder" || d === "refused";
    });
    expect(virtual.sort()).toEqual(["batch_leads_skip_trace", "send_borrower_reminder"]);
    expect(groupForTool("batch_leads_skip_trace")).toBe("never");
    expect(read("server/ai/tools.ts")).toContain('"batch_leads_skip_trace"');
    expect(groupForTool("send_borrower_reminder")).toBe("sends");
  });

  it("Looks & drafts is PAUSE_SAFE_TOOLS minus draft_offer, exactly", () => {
    const pauseSafe = new Set(setLiteral("server/ai/tools.ts", "PAUSE_SAFE_TOOLS"));
    expect(pauseSafe.size).toBeGreaterThan(20);
    // draft_offer mutates the deal; the spec moves it off the allowlist in
    // wave 1 A. Its group is already the truth.
    expect(groupForTool("draft_offer")).toBe("changes_records");
    const looks = Object.keys(PAX_TOOL_GROUPS).filter(
      (n) => dispatchForTool(n) === "executeTool" && groupForTool(n) === "looks_and_drafts",
    );
    const expected = [...pauseSafe].filter((n) => n !== "draft_offer").sort();
    expect(looks.sort()).toEqual(expected);
  });

  it("support Looks & drafts is PAUSE_SAFE_SUPPORT_TOOLS' top-level labels, exactly", () => {
    const pauseSafe = new Set(setLiteral("server/ai/supportAgent.ts", "PAUSE_SAFE_SUPPORT_TOOLS"));
    const labels = new Set(labelsBySwitch.get("executeSupportTool"));
    const expected = [...pauseSafe].filter((n) => labels.has(n)).sort();
    expect(expected.length).toBeGreaterThan(20);
    const looks = Object.keys(PAX_TOOL_GROUPS).filter(
      (n) => dispatchForTool(n) === "executeSupportTool" && groupForTool(n) === "looks_and_drafts",
    );
    expect(looks.sort()).toEqual(expected);
  });

  it("every APPROVAL_REQUIRED_TOOL is a send", () => {
    const required = setLiteral("server/services/approvalKernel.ts", "APPROVAL_REQUIRED_TOOLS");
    expect(required.length).toBeGreaterThanOrEqual(5);
    for (const name of required) expect(groupForTool(name), name).toBe("sends");
  });

  it("ALWAYS_ASK_SUPPORT_TOOLS are real support tools that are never 'looks & drafts'", () => {
    expect(ALWAYS_ASK_SUPPORT_TOOLS.size).toBeGreaterThanOrEqual(5);
    const labels = new Set(labelsBySwitch.get("executeSupportTool"));
    for (const name of ALWAYS_ASK_SUPPORT_TOOLS) {
      expect(labels.has(name), `${name} is not a support case label`).toBe(true);
      expect(["sends", "changes_records"]).toContain(groupForTool(name));
    }
    // apply_credit is the founder's pricing hard-stop, not a customer ask.
    expect(ALWAYS_ASK_SUPPORT_TOOLS.has("apply_credit")).toBe(false);
  });
});

// ── Unattended paths, parked states, the Never list ─────────────────────────

describe("UNATTENDED_PATHS resolves", () => {
  it("has enough members, unique ids, and a real file:function for each", () => {
    expect(UNATTENDED_PATHS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(UNATTENDED_PATHS.map((p) => p.id)).size).toBe(UNATTENDED_PATHS.length);
    for (const p of UNATTENDED_PATHS) {
      expect(exists(p.file), `${p.id}: ${p.file} is gone`).toBe(true);
      expect(read(p.file), `${p.id}: ${p.file} no longer contains ${p.fn}`).toContain(p.fn);
      expect(p.label.length).toBeGreaterThan(3);
      expect(p.whilePaused.length).toBeGreaterThan(3);
    }
  });

  it("what Pause stops is a non-empty customer-visible list, and sends never appear on it", () => {
    const stops = UNATTENDED_PATHS.filter((p) => p.pauseStops && p.customerVisible);
    expect(stops.length).toBeGreaterThanOrEqual(6);
    // A send is not "stopped" by Pause — it was never going to leave without
    // a tap. Listing it would claim Pause does something the kernel already did.
    for (const id of ["chat_sends", "borrower_dispatch"]) {
      const row = UNATTENDED_PATHS.find((p) => p.id === id);
      expect(row?.pauseStops, id).toBe(false);
    }
  });

  it("every switch points at a real path", () => {
    for (const p of UNATTENDED_PATHS) {
      if (!p.switch) continue;
      expect(p.switch.href).toMatch(/^\/[a-z/-]+$/);
      expect(p.switch.label.length).toBeGreaterThan(2);
    }
  });
});

describe("PARKED_STATES names a real store", () => {
  it("is non-empty and each member is table:status of a schema table", () => {
    expect(PARKED_STATES.length).toBeGreaterThan(0);
    const schema = read("shared/schema.ts");
    for (const member of PARKED_STATES) {
      const [table, status] = member.split(":");
      expect(schema, `${table} is not a pgTable`).toContain(`pgTable("${table}"`);
      expect(status).toMatch(/^[a-z_]+$/);
    }
  });
});

describe("the Never list is facts with gates", () => {
  it("every line names a test that exists", () => {
    expect(PAX_NEVER_LIST.length).toBeGreaterThanOrEqual(4);
    expect(new Set(PAX_NEVER_LIST.map((n) => n.id)).size).toBe(PAX_NEVER_LIST.length);
    for (const line of PAX_NEVER_LIST) {
      expect(line.gate).toMatch(/^tests\/unit\/[\w.-]+\.test\.ts$/);
      expect(exists(line.gate), `${line.id}: gate ${line.gate} does not exist`).toBe(true);
    }
  });
});

describe("ask origins", () => {
  it("include every ExecuteToolOptions lane the kernel will pass", () => {
    for (const lane of ["chat", "scheduled", "inbound_signal", "support", "approval_replay"]) {
      expect(PAX_ASK_ORIGINS).toContain(lane);
    }
  });
});
