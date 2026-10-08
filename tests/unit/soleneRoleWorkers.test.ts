/**
 * Stage 2 task 1 — business moves run ROLE WORKERS, not the coding agent.
 *
 * Proves, against the real modules (deps injected only where a model or the
 * DB would be):
 *   - the MOVE KIND decides the worker (writer / support / retention / ops),
 *     and code work keeps the coding agent;
 *   - the Writer succeeds ONLY with a <<<PUBLISH block that clears the
 *     EXISTING publish gate (screenForPublish), revises once on a refusal,
 *     and fails (never "completed") on an empty answer or a fabricated draft;
 *   - Support / Retention succeed only with a real effect; an answer with no
 *     effect is empty_result; a repeated identical call is loop_detected;
 *   - the instructions ship in the repo (no $HOME read).
 */
import { describe, it, expect } from "vitest";
import { roleWorkerForDispatch } from "../../server/services/solene/roleWorkers/routing";
import { ROLE_INSTRUCTIONS } from "../../server/services/solene/roleWorkers/instructions";
import { runRoleWorker, type RoleRunDeps, type ModelTurn } from "../../server/services/solene/roleWorkers/runner";
import { parsePublishable, screenForPublish } from "../../server/services/autopilot/publishArtifact";

const GOOD_ARTICLE = [
  "Here is the piece.",
  "<<<PUBLISH",
  "SUBJECT: How to read a county parcel record before you buy",
  "BODY:",
  "<p>A parcel record is the county's file on a piece of land. The county assessor's records list the owner of record, the parcel number and the assessed value as of the last assessment.</p>",
  "<h2>What to check</h2><ul><li>The owner name matches the seller.</li><li>The legal description matches the listing.</li><li>Whether taxes are current, per the county treasurer.</li></ul>",
  "<p>For informational purposes only — not legal, financial, or investment advice. Verify independently.</p>",
  ">>>",
].join("\n");

const FABRICATED_ARTICLE = GOOD_ARTICLE.replace(
  "<h2>What to check</h2>",
  "<p>87% of land buyers skip this step.</p><blockquote>\"AcreOS saved me $4,000 on my first deal\" — Mike R., Texas</blockquote><h2>What to check</h2>",
);

function screen(text: string) {
  const p = parsePublishable(text);
  if (!p) return { parsed: false, ok: false, violations: [] as string[] };
  const s = screenForPublish({ subject: p.subject, htmlBody: p.htmlBody });
  return { parsed: true, ok: s.ok, violations: s.violations.map((v) => `${v.code}: ${v.message}`) };
}

const text = (t: string): ModelTurn => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 } });
const call = (name: string, input: Record<string, unknown>): ModelTurn => ({
  content: [{ type: "tool_use", id: `tu_${Math.random().toString(36).slice(2)}`, name, input }],
  stop_reason: "tool_use",
  usage: { input_tokens: 100, output_tokens: 20 },
});

function deps(script: ModelTurn[], over: Partial<RoleRunDeps> = {}) {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const seen: Array<{ system: string; tools: string[] }> = [];
  const d: RoleRunDeps = {
    callModel: async (req) => {
      seen.push({ system: req.system, tools: req.tools.map((t) => t.name) });
      return script.shift() ?? text("");
    },
    buildBriefing: async () => ({ text: "## Waiting tickets (1)\n### Ticket #4", items: 1 }),
    executeTool: async (_role, name, input) => {
      calls.push({ name, input });
      if (name === "reply_to_ticket") return { success: true, output: "drafted", effect: "drafted_reply" };
      if (name === "escalate_to_founder") return { success: true, output: "asked", effect: "escalated" };
      return { success: true, output: "[]" };
    },
    screenPublishable: screen,
    runOps: async () => "Ops watch: model_provider=ok",
    isCancelled: async () => false,
    price: (i, o) => (i * 3 + o * 15) / 1e6,
    ...over,
  };
  return { d, calls, seen };
}
const row = { id: 11, promptText: "Autopilot task — grow_owned_channels (growth)." };

describe("routing — the move kind decides the worker", () => {
  it("business moves go to role workers; code work and non-autopilot dispatches do not", () => {
    expect(roleWorkerForDispatch({ sourceType: "auto_dispatch", sourceId: "autopilot:grow_owned_channels" })).toBe("writer");
    expect(roleWorkerForDispatch({ sourceType: "auto_dispatch", sourceId: "autopilot:clear_support_backlog" })).toBe("support");
    expect(roleWorkerForDispatch({ sourceType: "auto_dispatch", sourceId: "autopilot:recover_payments" })).toBe("retention");
    expect(roleWorkerForDispatch({ sourceType: "auto_dispatch", sourceId: "autopilot:stabilize_reflexes" })).toBe("ops");
    expect(roleWorkerForDispatch({ sourceType: "auto_dispatch", sourceId: "autopilot:resolve_incident" })).toBeNull();
    expect(roleWorkerForDispatch({ sourceType: "founder_manual", sourceId: "autopilot:grow_owned_channels" })).toBeNull();
  });

  it("POPULATION: every role has instructions from the repo, opening with its marker", () => {
    const roles = ["writer", "support", "retention", "ops"] as const;
    expect(Object.keys(ROLE_INSTRUCTIONS).sort()).toEqual([...roles].sort());
    for (const r of roles) {
      expect(ROLE_INSTRUCTIONS[r].length).toBeGreaterThan(50);
      expect(ROLE_INSTRUCTIONS[r].split("\n")[0]).toMatch(new RegExp(`^AcreOS role worker — ${r[0].toUpperCase()}${r.slice(1)}$`));
      expect(ROLE_INSTRUCTIONS[r]).not.toMatch(/\.claude\/projects|team_\w+\.md/);
    }
    // every business move kind routes to a role with instructions
    for (const kind of ["grow_owned_channels", "clear_support_backlog", "retain_at_risk", "recover_payments", "convert_trials", "stabilize_reflexes"]) {
      const role = roleWorkerForDispatch({ sourceType: "auto_dispatch", sourceId: `autopilot:${kind}` });
      expect(role && ROLE_INSTRUCTIONS[role]).toBeTruthy();
    }
  });
});

describe("Writer — the publish gate decides success", () => {
  it("a clean <<<PUBLISH block succeeds, with no tools and the Writer's own instructions", async () => {
    const { d, seen } = deps([text(GOOD_ARTICLE)]);
    const r = await runRoleWorker(row, "writer", d);
    expect(r.success).toBe(true);
    expect(r.terminationReason).toBe("end_turn");
    expect(parsePublishable(r.finalText)?.subject).toMatch(/county parcel record/);
    expect(seen[0].tools).toEqual([]);
    expect(seen[0].system.startsWith("AcreOS role worker — Writer")).toBe(true);
    expect(seen[0].system).not.toMatch(/git_commit|file_read|npm run check/);
  });

  it("'Nothing further to add.' is a FAILURE (after one revision request), never a success", async () => {
    const { d } = deps([text("Nothing further to add."), text("Nothing further to add.")]);
    const r = await runRoleWorker(row, "writer", d);
    expect(r.success).toBe(false);
    expect(r.terminationReason).toBe("empty_result");
  });

  it("a fabricated draft is refused by the EXISTING publish gate; a sourced revision then succeeds", async () => {
    const { d } = deps([text(FABRICATED_ARTICLE), text(GOOD_ARTICLE)]);
    const r = await runRoleWorker(row, "writer", d);
    expect(r.success).toBe(true);
    expect(r.turns).toBe(2);
  });

  it("a fabricated draft that is never fixed ends publish_gate_blocked", async () => {
    const { d } = deps([text(FABRICATED_ARTICLE), text(FABRICATED_ARTICLE)]);
    const r = await runRoleWorker(row, "writer", d);
    expect(r.success).toBe(false);
    expect(r.terminationReason).toBe("publish_gate_blocked");
    expect(r.finalText).toMatch(/testimonial|unsourced_statistic|social_proof/);
  });
});

describe("Support / Retention — a real effect is the work product", () => {
  it("a reply + escalation with a summary succeeds and records the effects", async () => {
    const { d, calls } = deps([
      call("escalate_to_founder", { ticket_id: 2, summary: "$80 refund", why: "over $50" }),
      call("reply_to_ticket", { ticket_id: 2, message: "The founder is reviewing your $80 refund request.", resolve: false }),
      text("Escalated #2 ($80 is over the limit) and told the customer."),
    ]);
    const r = await runRoleWorker({ ...row, promptText: "support" }, "support", d);
    expect(r.success).toBe(true);
    expect(r.effects).toEqual(["escalated", "drafted_reply"]);
    expect(calls.map((c) => c.name)).toEqual(["escalate_to_founder", "reply_to_ticket"]);
  });

  it("talking without acting is empty_result, not success", async () => {
    const { d } = deps([text("I looked at the tickets. They seem fine.")]);
    const r = await runRoleWorker({ ...row, promptText: "support" }, "support", d);
    expect(r.success).toBe(false);
    expect(r.terminationReason).toBe("empty_result");
  });

  it("the same call three times is loop_detected and the third never executes", async () => {
    const same = () => call("list_recent_purchases", { ticket_id: 1 });
    const { d, calls } = deps([same(), same(), same(), text("done")]);
    const r = await runRoleWorker({ ...row, promptText: "support" }, "support", d);
    expect(r.terminationReason).toBe("loop_detected");
    expect(calls).toHaveLength(2);
  });

  it("nothing waiting is no_work (not a success, not the domain's failure) and calls no model", async () => {
    const { d, seen } = deps([text("x")], { buildBriefing: async () => ({ text: "No tickets are waiting.", items: 0 }) });
    const r = await runRoleWorker({ ...row, promptText: "support" }, "support", d);
    expect(r.terminationReason).toBe("no_work");
    expect(seen).toHaveLength(0);
  });

  it("a cancel (panic stop) aborts before the next tool", async () => {
    let n = 0;
    const { d, calls } = deps([call("reply_to_ticket", { ticket_id: 1, message: "hi", resolve: true }), text("done")], {
      isCancelled: async () => ++n > 1,
    });
    const r = await runRoleWorker({ ...row, promptText: "support" }, "support", d);
    expect(r.terminationReason).toBe("aborted");
    expect(calls).toHaveLength(0);
  });

  it("Ops runs the deterministic watch, no model", async () => {
    const { d, seen } = deps([]);
    const r = await runRoleWorker(row, "ops", d);
    expect(r.success).toBe(true);
    expect(r.finalText).toMatch(/Ops watch/);
    expect(seen).toHaveLength(0);
  });
});

// M2 — one ticket, one org, per Support run: the briefing binds the run to the
// ticket it names, and the tools refuse every other ticket id.
describe("Support runs are bound to one ticket (one org per model context)", () => {
  it("the runner hands the briefing's ticket scope to every tool call", async () => {
    const ctxs: Array<Record<string, unknown>> = [];
    const { d } = deps([call("reply_to_ticket", { ticket_id: 4, message: "Go to Deals → Import.", resolve: true }), text("Done.")], {
      buildBriefing: async () => ({ text: "## The ticket you are working\n### Ticket #4", items: 1, scope: { ticketId: 4, organizationId: 9 } }),
      executeTool: async (_r, _n, _i, ctx) => {
        ctxs.push(ctx as Record<string, unknown>);
        return { success: true, output: "drafted", effect: "drafted_reply" };
      },
    });
    await runRoleWorker(row, "support", d);
    expect(ctxs[0]).toMatchObject({ ticketId: 4, organizationId: 9 });
  });

  it("a tool call naming another ticket — or a run with no briefed ticket — is refused before any read", async () => {
    const { executeRoleTool } = await import("../../server/services/solene/roleWorkers/tools");
    const other = await executeRoleTool("support", "reply_to_ticket", { ticket_id: 5, message: "hi", resolve: false }, { dispatchId: 1, ticketId: 4, organizationId: 9 });
    expect(other.success).toBe(false);
    expect(other.output).toMatch(/ticket #4 only/);
    const unbound = await executeRoleTool("support", "list_recent_purchases", { ticket_id: 4 }, { dispatchId: 1 });
    expect(unbound.success).toBe(false);
    expect(unbound.output).toMatch(/not briefed on a ticket/);
  });
});
