/**
 * Every toolName proposePendingAction is ever called with resolves to
 * exactly one executor (AUTONOMY_SPEC.md §4.3, §7).
 *
 * An ask that no rail can replay is a row the customer taps and nothing
 * runs — "Approve" would lie. So this derives the population from the
 * CALL SITES, not from a list someone typed:
 *
 *   1. Every production file under server/ that calls `proposePendingAction(`
 *      is found by walking the tree. Each call is classified:
 *        - a literal `toolName: "x"` — one name;
 *        - `toolName,` / `toolName: toolName` — the dispatch variable of one
 *          of the two model-driven switches enumerated in PROPOSERS, whose
 *          reachable names are DERIVED (case labels minus the pause-safe
 *          allowlist, plus the always-ask set);
 *        - anything else — an unenumerated proposer, which fails by file.
 *   2. Each derived name must resolve to exactly one rail in
 *      paxAskExecutors' dispatch (`dispatchForTool`), the rail its file
 *      implies, and — behaviourally — executeApprovedAsk must touch that
 *      one backend and only that one.
 *
 * Per-member vacuity: at least two call sites are found (the two switches);
 * each proposer's derived set is non-empty and contains its known members.
 *
 * Probe that must turn this red: propose a name with no executor (add
 * `proposePendingAction({ toolName: "made_up_tool", … })` anywhere under
 * server/).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import fs from "node:fs";
import path from "node:path";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";

const mocks = vi.hoisted(() => ({
  executeTool: vi.fn(async () => ({ success: true, data: { ok: true } })),
  executeSupportTool: vi.fn(async () => ({ success: true, data: { ok: true } })),
  sendManualReminder: vi.fn(async () => ({ success: true, reminderId: 5, status: "sent" })),
  getPaxControls: vi.fn(async () => ({
    stance: "ask_before_sending",
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    paused: false,
    pausedUntil: null,
    pausedBy: null,
    checkFailed: false,
    timezone: "America/Chicago",
  })),
  recordPaxEffect: vi.fn(async () => ({ written: true })),
}));

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/websocket", () => ({ wsServer: { broadcastToOrg: vi.fn() } }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/ai/tools", () => ({ executeTool: mocks.executeTool }));
vi.mock("../../server/ai/supportAgent", () => ({ executeSupportTool: mocks.executeSupportTool }));
vi.mock("../../server/services/financeAgent", () => ({
  financeAgentService: { sendManualReminder: mocks.sendManualReminder },
}));
vi.mock("../../server/services/paxControls", () => ({ getPaxControls: mocks.getPaxControls }));
vi.mock("../../server/services/paxReceipts", () => ({ recordPaxEffect: mocks.recordPaxEffect }));

import type { Organization } from "../../shared/schema";
import { executeApprovedAsk } from "../../server/services/paxAskExecutors";
import { ALWAYS_ASK_SUPPORT_TOOLS, dispatchForTool, type PaxToolDispatch } from "../../shared/pax-controls";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => stripCommentsPreservingLines(fs.readFileSync(path.join(ROOT, rel), "utf8"));

/** The kernel's own set, read from source so this file loads no DB graph. */
function approvalRequiredTools(): Set<string> {
  const src = read("server/services/approvalKernel.ts");
  const m = src.match(/export const APPROVAL_REQUIRED_TOOLS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\);/);
  expect(m, "APPROVAL_REQUIRED_TOOLS literal not found").toBeTruthy();
  return new Set([...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
}

function allowlist(src: string, name: string): Set<string> {
  const m = src.match(new RegExp(`export const ${name}: ReadonlySet<string> = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  expect(m, `${name} literal not found`).toBeTruthy();
  return new Set([...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
}

/** Top-level case labels inside one exported async function. */
function caseLabels(src: string, fn: string): string[] {
  const start = src.indexOf(`export async function ${fn}(`);
  expect(start, `${fn} not found`).toBeGreaterThan(-1);
  const end = src.indexOf("\n}\n", start);
  return [...src.slice(start, end).matchAll(/^ {6}case "([a-z_0-9]+)": \{/gm)].map((m) => m[1]);
}

interface Proposer {
  file: string;
  fn: string;
  rail: PaxToolDispatch;
  /** Every name whose call can reach this file's proposePendingAction. */
  reachable: () => Set<string>;
  /** Names that must be in the derived set (vacuity). */
  known: string[];
}

/**
 * The dispatch switches that propose with a RUNTIME tool name. Any other
 * file that proposes with a non-literal name is unenumerated and fails.
 */
const PROPOSERS: Proposer[] = [
  {
    file: "server/ai/tools.ts",
    fn: "executeTool",
    rail: "executeTool",
    reachable: () => {
      const src = read("server/ai/tools.ts");
      const safe = allowlist(src, "PAUSE_SAFE_TOOLS");
      const out = new Set(caseLabels(src, "executeTool").filter((n) => !safe.has(n)));
      for (const n of approvalRequiredTools()) out.add(n);
      return out;
    },
    known: ["send_email", "send_sms", "update_lead_status", "create_task", "draft_offer"],
  },
  {
    file: "server/ai/supportAgent.ts",
    fn: "executeSupportTool",
    rail: "executeSupportTool",
    reachable: () => {
      const src = read("server/ai/supportAgent.ts");
      const safe = allowlist(src, "PAUSE_SAFE_SUPPORT_TOOLS");
      const out = new Set(caseLabels(src, "executeSupportTool").filter((n) => !safe.has(n)));
      for (const n of ALWAYS_ASK_SUPPORT_TOOLS) out.add(n);
      return out;
    },
    known: ["apply_billing_fix", "resync_stripe", "resolve_alert", "create_followup_task"],
  },
];

function* walkTs(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      yield* walkTs(full);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      yield full;
    }
  }
}

interface CallSite {
  file: string;
  /** A literal name, or the proposer's dispatch variable. */
  name: string | "<toolName>";
}

/** Every proposePendingAction( call under server/, with the name it passes. */
function callSites(): CallSite[] {
  const out: CallSite[] = [];
  for (const full of walkTs(path.join(ROOT, "server"))) {
    const rel = path.relative(ROOT, full).split(path.sep).join("/");
    if (rel === "server/services/approvalKernel.ts") continue; // the definition
    const code = read(rel);
    const re = /proposePendingAction\(\s*\{([\s\S]*?)\}\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const body = m[1];
      const literal = /toolName:\s*"([a-z_0-9]+)"/.exec(body);
      if (literal) {
        out.push({ file: rel, name: literal[1] });
        continue;
      }
      if (/(^|[,{\s])toolName\s*[,}]|toolName:\s*toolName\b/.test(body)) {
        out.push({ file: rel, name: "<toolName>" });
        continue;
      }
      throw new Error(`${rel}: proposePendingAction call with an unrecognised toolName shape:\n${body}`);
    }
  }
  return out;
}

/** name → the rail(s) implied by where it is proposed. */
function derivedPopulation(): Map<string, { rails: Set<PaxToolDispatch>; files: Set<string> }> {
  const pop = new Map<string, { rails: Set<PaxToolDispatch>; files: Set<string> }>();
  const add = (name: string, rail: PaxToolDispatch, file: string) => {
    const e = pop.get(name) ?? { rails: new Set(), files: new Set() };
    e.rails.add(rail);
    e.files.add(file);
    pop.set(name, e);
  };
  const unenumerated: string[] = [];
  for (const site of callSites()) {
    if (site.name !== "<toolName>") {
      // A literal: the rail is whatever the registry says; the registry must say something.
      const rail = dispatchForTool(site.name);
      add(site.name, (rail ?? "refused") as PaxToolDispatch, site.file);
      continue;
    }
    const proposer = PROPOSERS.find((p) => p.file === site.file);
    if (!proposer) {
      unenumerated.push(site.file);
      continue;
    }
    for (const name of proposer.reachable()) add(name, proposer.rail, site.file);
  }
  expect(
    unenumerated,
    "a file proposes asks with a runtime tool name but is not enumerated in PROPOSERS — add it with a derivation of the names that can reach its call",
  ).toEqual([]);
  return pop;
}

const org = { id: 7, ownerId: "u-owner" } as unknown as Organization;
const ctx = { org, userId: "u-1", pendingActionId: 99 };

beforeEach(() => vi.clearAllMocks());

describe("the population is derived from every call site", () => {
  it("vacuity: the walk finds both dispatch switches, and each proposer's derived set is real", () => {
    const sites = callSites();
    expect(sites.length).toBeGreaterThanOrEqual(2);
    for (const p of PROPOSERS) {
      expect(sites.some((s) => s.file === p.file && s.name === "<toolName>"), `${p.file} no longer proposes with its dispatch variable`).toBe(true);
      const reachable = p.reachable();
      expect(reachable.size, `${p.fn}: derived set is empty`).toBeGreaterThan(5);
      for (const k of p.known) expect(reachable.has(k), `${p.fn}: ${k} should be reachable`).toBe(true);
    }
  });

  it("every literal call site names a tool the registry can replay", () => {
    for (const site of callSites()) {
      if (site.name === "<toolName>") continue;
      const rail = dispatchForTool(site.name);
      expect(rail, `${site.file} proposes "${site.name}", which no rail claims`).not.toBeNull();
      expect(rail, `${site.file} proposes "${site.name}", which is registered as refused`).not.toBe("refused");
    }
  });
});

describe("each proposed name resolves to exactly one executor", () => {
  const pop = derivedPopulation();
  const names = [...pop.keys()].sort();

  it("vacuity: the population is the size of both switches' side-effecting halves", () => {
    expect(names.length).toBeGreaterThan(25);
  });

  it.each(names)("%s", async (name) => {
    const entry = pop.get(name)!;
    const expected = dispatchForTool(name);
    // Registry: one rail, matching the file that proposes it.
    expect(expected, `${name} is proposed from ${[...entry.files].join(", ")} but no rail claims it`).not.toBeNull();
    expect(expected).not.toBe("refused");
    expect(entry.rails.size, `${name} is proposed from files implying different rails`).toBe(1);
    expect([...entry.rails][0]).toBe(expected);

    // Behaviour: the replay touches exactly that backend.
    vi.clearAllMocks();
    const args = name === "send_borrower_reminder" ? { reminderId: 5, noteId: 3, type: "due" } : { lead_id: 1 };
    const result = await executeApprovedAsk(name, args, ctx);
    const touched = Object.entries({
      executeTool: mocks.executeTool.mock.calls.length,
      executeSupportTool: mocks.executeSupportTool.mock.calls.length,
      finance_ladder: mocks.sendManualReminder.mock.calls.length,
    })
      .filter(([, c]) => c > 0)
      .map(([k]) => k);
    expect(touched, `${name} touched ${touched.join(",") || "nothing"}`).toEqual([expected]);
    expect(result.executor).toBe(expected);
    expect(result.success).toBe(true);
  });
});

describe("the rule is falsifiable", () => {
  it("a name no rail claims is refused by the executor and would fail the resolution above", async () => {
    expect(dispatchForTool("made_up_tool")).toBeNull();
    const result = await executeApprovedAsk("made_up_tool", {}, ctx);
    expect(result.success).toBe(false);
    expect(result.executor).toBeNull();
  });
});
