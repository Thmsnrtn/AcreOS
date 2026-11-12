/**
 * Per-capability rails (PX-2, register P-1) — population + composition.
 *
 * WHAT IS PROVED
 * ──────────────
 *  1. POPULATION. The case labels of BOTH dispatch switches (derived from
 *     server/ai/tools.ts and server/ai/supportAgent.ts the way
 *     paxControlsOffered.test.ts derives them) are each checked PER MEMBER:
 *     a group; for changes_records a domain (and only those); for the sends
 *     group a rail capped at ask; and a DEFINED reader decision for every
 *     (stance × rail × pause) combination — no undefined fall-through.
 *     A per-member vacuity floor fails if either switch stops being read.
 *  2. COMPOSITION. The rail may only NARROW the stance: default rails
 *     reproduce today's outcome for every tool; a rail narrows one domain and
 *     touches no other; no rail widens ask_before_everything or an
 *     ALWAYS_ASK_SUPPORT_TOOLS tool; Watch refuses in plain words; the sends
 *     rail clamps a hand-edited act_and_report to ask; pause and a failed
 *     read still refuse.
 *  3. STORAGE. A row written before PX-2 (no `rails` key) and a NULL column
 *     both read as the defaults; a hand-edited sends level is clamped; an
 *     unknown domain or level fails the whole row CLOSED.
 *  4. WIRING. Both dispatch switches call the reader (comment-stripped
 *     source, so a mention in a comment cannot satisfy it).
 *
 * The probe that must turn this red: in server/services/paxRails.ts make the
 * cap `act_and_report` for ask_before_everything (a rail then widens the
 * stance) — "cannot widen" and the per-member loop both fail.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

type Rows = Array<Record<string, unknown>>;

const mocks = vi.hoisted(() => {
  let selectQueue: Array<Rows | Error> = [];
  const select = vi.fn((_shape?: unknown) => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      then: (onFulfilled: (rows: unknown) => unknown, onRejected?: (err: unknown) => unknown) => {
        const next = selectQueue.shift();
        const p = next instanceof Error ? Promise.reject(next) : Promise.resolve(next ?? []);
        return p.then(onFulfilled, onRejected);
      },
    };
    return chain;
  });
  return {
    db: { select },
    setSelectQueue(q: Array<Rows | Error>) {
      selectQueue = [...q];
    },
  };
});

vi.mock("../../server/db", () => ({ db: mocks.db }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/paxPause", () => ({
  getPaxPauseState: vi.fn(async () => ({ paused: false, pausedUntil: null, checkFailed: false })),
}));

import { getPaxControls, type PaxControlsState } from "../../server/services/paxControls";
import { decidePaxCall } from "../../server/services/paxRails";
import {
  ALWAYS_ASK_SUPPORT_TOOLS,
  OFFERED_STANCES,
  PAX_CONTROLS_DEFAULTS,
  PAX_RAIL_LEVELS,
  PAX_RECORD_DOMAINS,
  PAX_SENDS_RAIL_CEILING,
  PAX_SENDS_RAIL_LEVELS,
  PAX_TOOL_DOMAINS,
  PAX_TOOL_GROUPS,
  defaultPaxRails,
  dispatchForTool,
  domainForTool,
  groupForTool,
  type PaxRailLevel,
  type PaxRails,
  type PaxRecordDomain,
  type PaxStance,
} from "../../shared/pax-controls";
import { PAX_RAIL_COPY } from "../../shared/pax-glossary";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ── The population: both switches ───────────────────────────────────────────

const TOOL_SWITCHES = [
  { file: "server/ai/tools.ts", fn: "executeTool", floor: 40 },
  { file: "server/ai/supportAgent.ts", fn: "executeSupportTool", floor: 40 },
] as const;

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

const LABELS = new Map(TOOL_SWITCHES.map((s) => [s.fn, caseLabels(s.file, s.fn)]));
/** Every name the reader can be asked about: both switches + the two that never reach one. */
const ALL_TOOLS = [
  ...new Set([...(LABELS.get("executeTool") ?? []), ...(LABELS.get("executeSupportTool") ?? []), "batch_leads_skip_trace", "send_borrower_reminder"]),
].sort();

// ── Fixtures ────────────────────────────────────────────────────────────────

function state(over: Partial<PaxControlsState> & { rails?: PaxRails } = {}): PaxControlsState {
  return {
    stance: "ask_before_sending",
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    rails: defaultPaxRails(),
    paused: false,
    pausedUntil: null,
    pausedBy: null,
    checkFailed: false,
    timezone: "America/Chicago",
    ...over,
  };
}

function withRecordRail(domain: PaxRecordDomain, level: PaxRailLevel, over: Partial<PaxControlsState> = {}) {
  const rails = defaultPaxRails();
  rails.records[domain] = level;
  return state({ ...over, rails });
}

const toolsIn = (group: string) => ALL_TOOLS.filter((t) => groupForTool(t) === group);
const KINDS = new Set(["run", "ask", "draft", "refuse"]);

// ── 1. Population ───────────────────────────────────────────────────────────

describe("the population is both dispatch switches (per-member vacuity)", () => {
  it("reads each switch", () => {
    for (const s of TOOL_SWITCHES) {
      const n = (LABELS.get(s.fn) ?? []).length;
      expect(n, `${s.file}:${s.fn} yielded ${n} case labels`).toBeGreaterThanOrEqual(s.floor);
    }
    expect(ALL_TOOLS.length).toBeGreaterThan(100);
  });

  it("every member has a group; every changes_records member has exactly one real domain; no other group has one", () => {
    const bad: string[] = [];
    let changes = 0;
    for (const tool of ALL_TOOLS) {
      const group = groupForTool(tool);
      if (group === null) {
        bad.push(`${tool}: no group`);
        continue;
      }
      const domain = domainForTool(tool);
      if (group === "changes_records") {
        changes += 1;
        if (domain === null || !(PAX_RECORD_DOMAINS as readonly string[]).includes(domain)) bad.push(`${tool}: changes_records without a domain`);
        if (PAX_TOOL_DOMAINS[tool] !== domain) bad.push(`${tool}: PAX_TOOL_DOMAINS disagrees with domainForTool`);
      } else if (domain !== null || tool in PAX_TOOL_DOMAINS) {
        bad.push(`${tool}: ${group} must not carry a domain`);
      }
    }
    expect(bad).toEqual([]);
    expect(changes, "changes_records population is suspiciously small").toBeGreaterThanOrEqual(20);
  });

  it("every domain has at least one tool (a rail with no tool is decoration)", () => {
    for (const d of PAX_RECORD_DOMAINS) {
      expect(Object.values(PAX_TOOL_DOMAINS).includes(d), `domain ${d} has no tool`).toBe(true);
    }
  });

  it("every PAX_TOOL_DOMAINS entry is a classified changes_records tool", () => {
    for (const [tool, domain] of Object.entries(PAX_TOOL_DOMAINS)) {
      expect(groupForTool(tool), tool).toBe("changes_records");
      expect(PAX_RECORD_DOMAINS as readonly string[]).toContain(domain);
    }
    expect(Object.keys(PAX_TOOL_DOMAINS).length).toBe(toolsIn("changes_records").length);
  });

  it("the rail levels run weakest → strongest, and sends cannot name the strongest", () => {
    expect([...PAX_RAIL_LEVELS]).toEqual(["watch", "draft", "ask", "act_and_report"]);
    expect([...PAX_SENDS_RAIL_LEVELS]).toEqual(["watch", "draft", "ask"]);
    expect(PAX_SENDS_RAIL_CEILING).toBe("ask");
  });

  it("the reader's decision is defined for every member under every stance × pause × rail level", () => {
    const undefinedOnes: string[] = [];
    for (const tool of ALL_TOOLS) {
      for (const stance of OFFERED_STANCES) {
        for (const paused of [false, true]) {
          for (const level of PAX_RAIL_LEVELS) {
            const rails = defaultPaxRails();
            for (const d of PAX_RECORD_DOMAINS) rails.records[d] = level;
            rails.sends = level as never; // hand-edited jsonb: act_and_report must still be defined (and clamped)
            const d = decidePaxCall(state({ stance, paused, rails }), tool);
            if (!d || !KINDS.has(d.kind) || typeof d.why !== "string") undefinedOnes.push(`${tool}/${stance}/${paused}/${level}`);
          }
        }
      }
    }
    expect(undefinedOnes).toEqual([]);
  });

  it("the sends group resolves to a rail capped at ask — never run — whatever is stored", () => {
    const sends = toolsIn("sends");
    expect(sends.length).toBeGreaterThanOrEqual(8);
    const ran: string[] = [];
    for (const tool of sends) {
      for (const stance of OFFERED_STANCES) {
        for (const level of PAX_RAIL_LEVELS) {
          const rails = defaultPaxRails();
          rails.sends = level as never;
          const d = decidePaxCall(state({ stance, rails }), tool);
          if (d.kind === "run") ran.push(`${tool}/${stance}/${level}`);
        }
      }
    }
    expect(ran, "a send ran without a tap").toEqual([]);
  });
});

// ── 2. Composition ──────────────────────────────────────────────────────────

describe("defaults equal today's outcome", () => {
  it("record changes run, sends ask, looks & drafts run — under the default stance", () => {
    for (const tool of ALL_TOOLS) {
      const group = groupForTool(tool);
      const d = decidePaxCall(state(), tool);
      if (group === "changes_records") {
        // ALWAYS_ASK support fixes were asks before PX-2 too (the switch keeps that floor).
        expect(d.kind, tool).toBe(ALWAYS_ASK_SUPPORT_TOOLS.has(tool) ? "ask" : "run");
      } else if (group === "sends") expect(d.kind, tool).toBe("ask");
      else expect(d.kind, tool).toBe("run");
    }
  });

  it("under ask_before_everything every non-looks tool asks", () => {
    for (const tool of ALL_TOOLS) {
      if (groupForTool(tool) === "looks_and_drafts") continue;
      expect(decidePaxCall(state({ stance: "ask_before_everything" }), tool).kind, tool).toBe("ask");
    }
  });

  it("PAX_CONTROLS_DEFAULTS carries the same rails", () => {
    expect(PAX_CONTROLS_DEFAULTS.rails).toEqual(defaultPaxRails());
  });

  it("a state with no rails (a pre-PX-2 hand-built object) decides as the defaults", () => {
    const legacy = { ...state() } as Partial<PaxControlsState>;
    delete legacy.rails;
    for (const tool of ALL_TOOLS) {
      expect(decidePaxCall(legacy as PaxControlsState, tool).kind, tool).toBe(decidePaxCall(state(), tool).kind);
    }
  });
});

describe("a rail narrows exactly its own domain", () => {
  it("per domain × level: that domain's tools narrow as specified and every other tool is untouched", () => {
    const wrong: string[] = [];
    for (const domain of PAX_RECORD_DOMAINS) {
      const mine = ALL_TOOLS.filter((t) => domainForTool(t) === domain);
      expect(mine.length, `${domain} has no tools`).toBeGreaterThan(0);
      const baseline = new Map(ALL_TOOLS.map((t) => [t, decidePaxCall(state(), t)] as const));
      const expectKind: Record<string, ReturnType<typeof decidePaxCall>["kind"]> = { watch: "refuse", draft: "draft", ask: "ask" };
      for (const level of ["watch", "draft", "ask"] as const) {
        const s = withRecordRail(domain, level);
        for (const tool of ALL_TOOLS) {
          const d = decidePaxCall(s, tool);
          if (mine.includes(tool)) {
            if (d.kind !== expectKind[level]) wrong.push(`${domain}=${level}: ${tool} → ${d.kind}`);
            if (level === "watch" && (d.why !== "rail_watch" || !d.message)) wrong.push(`${domain}=watch: ${tool} has no plain-words refusal`);
          } else if (d.kind !== baseline.get(tool)!.kind) {
            wrong.push(`${domain}=${level} leaked into ${tool}: ${baseline.get(tool)!.kind} → ${d.kind}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("Watch refuses in plain words that name the area and where to change it", () => {
    const d = decidePaxCall(withRecordRail("leads", "watch"), "update_lead_status");
    expect(d.kind).toBe("refuse");
    expect(d.message).toBe(PAX_RAIL_COPY.watchRefusal("Leads"));
    expect(d.message).toMatch(/Watch/);
    expect(d.message).toMatch(/leads/);
    expect(d.message).toMatch(/Settings → Pax\b/);
    expect(d.message).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("the narrowing is attributed to the rail", () => {
    expect(decidePaxCall(withRecordRail("tasks", "ask"), "create_task")).toEqual({ kind: "ask", why: "rail" });
    expect(decidePaxCall(withRecordRail("tasks", "draft"), "create_task")).toEqual({ kind: "draft", why: "rail" });
  });
});

describe("a rail never widens", () => {
  it("ask_before_everything: no domain rail, at any level, runs anything", () => {
    const ran: string[] = [];
    for (const domain of PAX_RECORD_DOMAINS) {
      for (const level of PAX_RAIL_LEVELS) {
        const s = withRecordRail(domain, level, { stance: "ask_before_everything" });
        for (const tool of ALL_TOOLS.filter((t) => domainForTool(t) === domain)) {
          if (decidePaxCall(s, tool).kind === "run") ran.push(`${domain}=${level}: ${tool}`);
        }
      }
    }
    expect(ran).toEqual([]);
  });

  it("ask_before_everything + Watch still refuses (narrower than the stance, allowed)", () => {
    expect(decidePaxCall(withRecordRail("deals", "watch", { stance: "ask_before_everything" }), "create_deal").kind).toBe("refuse");
  });

  it("an ALWAYS_ASK support tool asks even when its domain rail is act_and_report", () => {
    expect(ALWAYS_ASK_SUPPORT_TOOLS.size).toBeGreaterThanOrEqual(5);
    for (const tool of ALWAYS_ASK_SUPPORT_TOOLS) {
      const rails = defaultPaxRails();
      for (const d of PAX_RECORD_DOMAINS) rails.records[d] = "act_and_report";
      rails.sends = "ask";
      expect(decidePaxCall(state({ rails }), tool).kind, tool).toBe("ask");
    }
  });

  it("sends: a stored act_and_report is clamped to ask; draft and watch narrow; none runs", () => {
    const rails = defaultPaxRails();
    rails.sends = "act_and_report" as never;
    expect(decidePaxCall(state({ rails }), "send_email")).toEqual({ kind: "ask", why: "stance" });
    rails.sends = "draft";
    expect(decidePaxCall(state({ rails }), "send_email").kind).toBe("draft");
    rails.sends = "watch";
    const w = decidePaxCall(state({ rails }), "send_email");
    expect(w.kind).toBe("refuse");
    expect(w.message).toBe(PAX_RAIL_COPY.watchRefusal(PAX_RAIL_COPY.sendsLabel));
  });
});

describe("pause and a failed read still win", () => {
  it("paused: act_and_report refuses (paused); asks keep accumulating", () => {
    const paused = state({ paused: true });
    expect(decidePaxCall(paused, "update_lead_status")).toEqual({ kind: "refuse", why: "paused" });
    expect(decidePaxCall(paused, "send_email").kind).toBe("ask");
    expect(decidePaxCall(withRecordRail("leads", "ask", { paused: true }), "update_lead_status").kind).toBe("ask");
    expect(decidePaxCall(paused, "get_leads").kind).toBe("run");
  });

  it("a failed read refuses every gated tool, whatever the stored rails say", () => {
    for (const tool of ALL_TOOLS) {
      if (groupForTool(tool) === "looks_and_drafts") continue;
      expect(decidePaxCall(state({ checkFailed: true, paused: true }), tool), tool).toEqual({ kind: "refuse", why: "check_failed" });
    }
  });
});

describe("names the rails do not govern take the pre-PX-2 rule", () => {
  it("an unknown tool: stance decides, pause refuses, a rail changes nothing", () => {
    const rails = defaultPaxRails();
    for (const d of PAX_RECORD_DOMAINS) rails.records[d] = "watch";
    expect(decidePaxCall(state({ rails }), "not_a_real_tool").kind).toBe("run");
    expect(decidePaxCall(state({ rails, stance: "ask_before_everything" }), "not_a_real_tool").kind).toBe("ask");
    expect(decidePaxCall(state({ rails, paused: true }), "not_a_real_tool").kind).toBe("refuse");
  });

  it("the never group keeps its own refusal downstream; the reader only applies the stance", () => {
    expect(groupForTool("batch_leads_skip_trace")).toBe("never");
    expect(dispatchForTool("batch_leads_skip_trace")).toBe("refused");
    expect(decidePaxCall(state({ stance: "ask_before_everything" }), "batch_leads_skip_trace").kind).toBe("ask");
  });
});

// ── 3. Storage ──────────────────────────────────────────────────────────────

const orgRow = (paxControls: unknown) => [{ paxControls, timezone: "America/Chicago" }];
const oldShape = (stance = "ask_before_sending") => ({ stance, leadScoring: true, borrowerReminders: true, inboxDrafts: true });

beforeEach(() => {
  mocks.setSelectQueue([]);
});

describe("stored rows", () => {
  it("a pre-PX-2 row (no rails key) parses and fills today's defaults", async () => {
    mocks.setSelectQueue([orgRow(oldShape())]);
    const s = await getPaxControls(1);
    expect(s.checkFailed).toBe(false);
    expect(s.rails).toEqual(defaultPaxRails());
  });

  it("a NULL column reads as the defaults, rails included", async () => {
    mocks.setSelectQueue([orgRow(null)]);
    const s = await getPaxControls(1);
    expect(s.checkFailed).toBe(false);
    expect(s.rails).toEqual(defaultPaxRails());
  });

  it("a partial rails object keeps what it names and defaults the rest", async () => {
    mocks.setSelectQueue([orgRow({ ...oldShape(), rails: { records: { leads: "ask" } } })]);
    const s = await getPaxControls(1);
    expect(s.checkFailed).toBe(false);
    expect(s.rails.records.leads).toBe("ask");
    expect(s.rails.records.deals).toBe("act_and_report");
    expect(s.rails.sends).toBe("ask");
  });

  it("a hand-edited sends level above ask is clamped to ask, not a parse failure", async () => {
    mocks.setSelectQueue([orgRow({ ...oldShape(), rails: { sends: "act_and_report" } })]);
    const s = await getPaxControls(1);
    expect(s.checkFailed).toBe(false);
    expect(s.rails.sends).toBe("ask");
  });

  it("an unknown domain, an unknown level, or a stray rails key fails the row CLOSED", async () => {
    const hostile: unknown[] = [
      { ...oldShape(), rails: { records: { invoices: "ask" } } },
      { ...oldShape(), rails: { records: { leads: "autonomous" } } },
      { ...oldShape(), rails: { sends: "send_freely" } },
      { ...oldShape(), rails: { levels: {} } },
      { ...oldShape(), rails: "ask" },
    ];
    for (const stored of hostile) {
      mocks.setSelectQueue([orgRow(stored)]);
      const s = await getPaxControls(1);
      expect(s.checkFailed, JSON.stringify(stored)).toBe(true);
      expect(s.stance).toBe("ask_before_everything" satisfies PaxStance);
      for (const d of PAX_RECORD_DOMAINS) expect(s.rails.records[d], `${d} after ${JSON.stringify(stored)}`).toBe("watch");
      expect(s.rails.sends).toBe("watch");
    }
  });

  it("a stored rail reaches the decision end to end", async () => {
    mocks.setSelectQueue([orgRow({ ...oldShape(), rails: { records: { properties: "watch" } } })]);
    const s = await getPaxControls(1);
    expect(decidePaxCall(s, "create_property").kind).toBe("refuse");
    expect(decidePaxCall(s, "create_lead").kind).toBe("run");
  });
});

// ── 4. Wiring ───────────────────────────────────────────────────────────────

describe("both dispatch switches consult the one reader", () => {
  for (const s of TOOL_SWITCHES) {
    it(`${s.file} imports and calls decidePaxCall, and acts on a Watch refusal`, () => {
      const src = stripComments(read(s.file));
      expect(src).toMatch(/import \{ decidePaxCall, paxRailWatchRefusalMessage \} from "\.\.\/services\/paxRails"/);
      expect(src).toContain("error: paxRailWatchRefusalMessage(toolName)");
      expect(src).toMatch(/decidePaxCall\(controls, toolName\)/);
      expect(src).toContain('railDecision.why === "rail_watch"');
      expect(src).toMatch(/railDecision\?\.kind === "ask"/);
      expect(src).toMatch(/railDecision\?\.kind === "draft"/);
    });
  }
});

describe("the sends rail's type excludes act_and_report", () => {
  it("the source declares PaxSendsRailLevel as a narrowing of PaxRailLevel", () => {
    const src = stripComments(read("shared/pax-controls.ts"));
    expect(src).toMatch(/export type PaxSendsRailLevel = Exclude<PaxRailLevel, "act_and_report">/);
    expect(src).toMatch(/sends: PaxSendsRailLevel;/);
  });
});
