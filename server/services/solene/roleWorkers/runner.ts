/**
 * Role-worker runner (Stage 2) — runs a business move with a business worker:
 * the Writer, Support, Retention or Ops employee, each with its own repo-loaded
 * instructions and business tools, instead of the coding agent.
 *
 * Same envelope as the coding runner (dispatchRunner.runDispatch calls this
 * after its ensemble-cap and cost-ceiling refusals): the dispatch row is
 * completed/failed here, spend is recorded, a transcript is written, and a
 * cancel (founder kill / panic stop) is honoured at every turn and tool
 * boundary. And the same task guards (taskGuards.ts): a turn budget per task,
 * a repeated identical tool call ends the task as a loop, and a task that
 * produced no work product is a FAILURE — for the Writer that means a
 * publishable <<<PUBLISH block that clears the EXISTING publish gate
 * (screenForPublish); for Support/Retention at least one real effect (a
 * drafted reply/refund/email or a founder escalation).
 *
 * The publish itself is not done here: worker.ts hands a successful growth
 * dispatch's finalText to maybePublishFromDispatch — the one publish gate.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SoleneDispatchQueueRow } from "@shared/schema/solene-dispatch";
import { logger } from "../../../utils/logger";
import { isEmptyResult, ToolLoopDetector, turnBudgetFor } from "../taskGuards";
import { ROLE_INSTRUCTIONS } from "./instructions";
import type { RoleWorker } from "./routing";
import type { RoleEffect, RoleToolResult, RoleToolSchema, Briefing } from "./tools";

export type RoleTermination =
  | "end_turn"
  | "max_turns"
  | "error"
  | "aborted"
  | "empty_result"
  | "loop_detected"
  | "no_work"
  | "no_publishable_artifact"
  | "publish_gate_blocked";

export interface RoleRunResult {
  success: boolean;
  terminationReason: RoleTermination;
  finalText: string;
  effects: RoleEffect[];
  turns: number;
  tokenInput: number;
  tokenOutput: number;
  costUsd: number;
}

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
export interface ModelTurn {
  content: Block[];
  stop_reason: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface RoleRunDeps {
  callModel: (req: { system: string; messages: Array<{ role: "user" | "assistant"; content: unknown }>; tools: RoleToolSchema[] }) => Promise<ModelTurn>;
  buildBriefing: (role: RoleWorker) => Promise<Briefing>;
  executeTool: (role: RoleWorker, name: string, input: Record<string, unknown>, ctx: { dispatchId: number }) => Promise<RoleToolResult>;
  /** The publish gate's own parse + screen (publishArtifact.ts) — never a second gate. */
  screenPublishable: (text: string) => { parsed: boolean; ok: boolean; violations: string[] };
  runOps: () => Promise<string>;
  isCancelled: (dispatchId: number) => Promise<boolean>;
  /** Price a model's tokens (USD). */
  price: (tokenIn: number, tokenOut: number) => number;
  transcript?: (event: Record<string, unknown>) => Promise<void>;
}

function textOf(blocks: Block[]): string {
  return blocks.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("");
}

/**
 * Run one role worker over one dispatch. Pure orchestration over injected
 * deps (the real ones are bound in runRoleWorkerDispatch below).
 */
export async function runRoleWorker(row: Pick<SoleneDispatchQueueRow, "id" | "promptText">, role: RoleWorker, deps: RoleRunDeps): Promise<RoleRunResult> {
  const log = deps.transcript ?? (async () => {});
  const result: RoleRunResult = { success: false, terminationReason: "error", finalText: "", effects: [], turns: 0, tokenInput: 0, tokenOutput: 0, costUsd: 0 };

  // Ops is deterministic: watch the providers, open/close incidents, page once.
  if (role === "ops") {
    result.finalText = await deps.runOps();
    result.terminationReason = "end_turn";
    result.success = true;
    result.effects = [];
    return result;
  }

  const briefing = await deps.buildBriefing(role);
  if (briefing.items === 0) {
    // Nothing to do by the time the worker ran (another run got there first).
    // Not a success and not the domain's failure: a stale dispatch.
    result.terminationReason = "no_work";
    result.finalText = `no_work: ${briefing.text}`;
    return result;
  }

  const system = ROLE_INSTRUCTIONS[role];
  const tools = role === "writer" ? [] : (await import("./tools")).roleToolSchemas(role);
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    { role: "user", content: `${row.promptText}\n\n${briefing.text}` },
  ];
  const loop = new ToolLoopDetector();
  const budget = turnBudgetFor(role);
  let revisionAsked = false;

  for (let turn = 0; turn < budget; turn++) {
    if (await deps.isCancelled(row.id)) {
      result.terminationReason = "aborted";
      await log({ event: "aborted", turn });
      return result;
    }
    result.turns = turn + 1;
    const resp = await deps.callModel({ system, messages, tools });
    result.tokenInput += resp.usage?.input_tokens ?? 0;
    result.tokenOutput += resp.usage?.output_tokens ?? 0;
    result.costUsd = deps.price(result.tokenInput, result.tokenOutput);
    const text = textOf(resp.content);
    const uses = resp.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    messages.push({ role: "assistant", content: resp.content });
    await log({ event: "turn", turn, stopReason: resp.stop_reason, tools: uses.map((u) => u.name), textChars: text.length });

    if (uses.length > 0) {
      const results: unknown[] = [];
      for (const u of uses) {
        const v = loop.record(u.name, u.input);
        if (v.looped) {
          result.terminationReason = "loop_detected";
          result.finalText = v.reason ?? "loop detected";
          await log({ event: "loop_detected", turn, reason: v.reason });
          return result;
        }
        if (await deps.isCancelled(row.id)) {
          result.terminationReason = "aborted";
          await log({ event: "aborted", turn });
          return result;
        }
        const r = await deps.executeTool(role, u.name, u.input ?? {}, { dispatchId: row.id });
        if (r.success && r.effect) result.effects.push(r.effect);
        await log({ event: "tool", turn, tool: u.name, success: r.success, effect: r.effect ?? null, output: r.output.slice(0, 500) });
        results.push({ type: "tool_result", tool_use_id: u.id, content: r.output.slice(0, 8000), is_error: !r.success });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    // The model stopped talking: judge the work product.
    result.finalText = text;
    if (role === "writer") {
      const s = deps.screenPublishable(text);
      if (s.parsed && s.ok) {
        result.terminationReason = "end_turn";
        result.success = true;
        return result;
      }
      const why = !s.parsed
        ? "Your answer contains no well-formed <<<PUBLISH block (SUBJECT: and BODY: inside <<<PUBLISH … >>>)."
        : `The publish gate refused the draft: ${s.violations.join(" | ")}`;
      if (!revisionAsked && turn + 1 < budget) {
        revisionAsked = true;
        messages.push({ role: "user", content: `${why} Revise and emit the complete article again inside the <<<PUBLISH block. Remove anything you cannot source.` });
        continue;
      }
      result.terminationReason = isEmptyResult(text) ? "empty_result" : s.parsed ? "publish_gate_blocked" : "no_publishable_artifact";
      result.finalText = `${result.terminationReason}: ${why}${text ? ` — ${text.slice(0, 500)}` : ""}`;
      return result;
    }
    // Support / Retention: work product = real effects.
    if (result.effects.length > 0 && !isEmptyResult(text)) {
      result.terminationReason = "end_turn";
      result.success = true;
      return result;
    }
    if (result.effects.length > 0) {
      // Real effects but a blank closing note: the work happened; say what it was.
      result.finalText = `Effects: ${result.effects.join(", ")}.`;
      result.terminationReason = "end_turn";
      result.success = true;
      return result;
    }
    result.terminationReason = "empty_result";
    result.finalText = `empty_result: the ${role} worker ended without acting on any of the ${briefing.items} waiting item(s)${text ? ` — "${text.slice(0, 300)}"` : ""}`;
    return result;
  }
  result.terminationReason = "max_turns";
  result.finalText = `max_turns: the ${role} worker used its ${budget}-turn budget${result.effects.length ? ` (effects so far: ${result.effects.join(", ")})` : " with no work done"}`;
  return result;
}

// ── Real bindings + queue persistence ───────────────────────────────────────

/** Role workers run on the cheaper tier unless the dispatch pins a model. */
export function roleWorkerMaxTokens(role: RoleWorker): number {
  return role === "writer" ? 4096 : 2048;
}

/**
 * Run a claimed dispatch through its role worker and persist the outcome on
 * the queue row. Called from dispatchRunner.runDispatch after the cap checks.
 */
export async function runRoleWorkerDispatch(
  row: SoleneDispatchQueueRow,
  role: RoleWorker,
  opts: { model: string; apiKey: string | null; transcriptPath: string; price: (i: number, o: number) => number },
): Promise<RoleRunResult> {
  const started = Date.now();
  const append = async (event: Record<string, unknown>) => {
    try {
      await fs.mkdir(path.dirname(opts.transcriptPath), { recursive: true });
      await fs.appendFile(opts.transcriptPath, JSON.stringify({ ts: new Date().toISOString(), worker: role, ...event }) + "\n", "utf8");
    } catch {
      /* transcript is best-effort */
    }
  };
  await append({ event: "role_worker_start", dispatchId: row.id, role, model: opts.model });

  const tools = await import("./tools");
  const { isDispatchCancelled, completeDispatch, failDispatch } = await import("../dispatchQueue");
  let client: { messages: { create: (body: unknown, o?: unknown) => Promise<ModelTurn> } } | null = null;
  const deps: RoleRunDeps = {
    callModel: async (req) => {
      if (!opts.apiKey) throw new Error("ANTHROPIC_API_KEY is not set; the role worker cannot think");
      if (!client) {
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        client = new Anthropic({ apiKey: opts.apiKey }) as unknown as typeof client;
      }
      return client!.messages.create(
        {
          model: opts.model,
          max_tokens: roleWorkerMaxTokens(role),
          system: req.system,
          messages: req.messages,
          ...(req.tools.length ? { tools: req.tools } : {}),
        },
        { timeout: 120_000, maxRetries: 1 },
      );
    },
    buildBriefing: tools.buildBriefing,
    executeTool: tools.executeRoleTool,
    screenPublishable: (text) => {
      // The EXISTING publish gate's parse + screen — the same functions
      // maybePublishFromDispatch runs; there is no second gate.
      // (Imported lazily below to keep this module's static graph light.)
      return screenPublishableSync(text);
    },
    runOps: async () => {
      const { runOpsWatch } = await import("../../autopilot/opsWatch");
      const r = await runOpsWatch();
      return `Ops watch: ${r.readings.map((x) => `${x.provider}=${x.failing === true ? "FAILING" : x.failing === false ? "ok" : "unknown"}`).join(", ")}; incidents opened=[${r.opened.join(", ")}] resolved=[${r.resolved.join(", ")}]; pages=${r.paged}.`;
    },
    isCancelled: isDispatchCancelled,
    price: opts.price,
    transcript: append,
  };
  await primePublishGate();

  let r: RoleRunResult;
  try {
    r = await runRoleWorker(row, role, deps);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[roleWorkers] ${role} dispatch ${row.id} threw: ${msg}`);
    r = { success: false, terminationReason: "error", finalText: msg, effects: [], turns: 0, tokenInput: 0, tokenOutput: 0, costUsd: 0 };
  }
  const durationMs = Date.now() - started;
  await append({ event: "complete", success: r.success, terminationReason: r.terminationReason, effects: r.effects, turns: r.turns, costUsd: r.costUsd });

  try {
    const { recordCapitalEvent } = await import("../capitalTracker");
    await recordCapitalEvent("agent_dispatch", r.costUsd, `dispatch:${row.id} role-worker=${role} source=${row.sourceType}:${row.sourceId} reason=${r.terminationReason}`);
  } catch {
    /* spend record is best-effort, like the coding runner */
  }
  try {
    if (r.success) {
      await completeDispatch(row.id, {
        costUsd: r.costUsd,
        durationMs,
        tokenInput: r.tokenInput,
        tokenOutput: r.tokenOutput,
        resultSummary: r.finalText.slice(0, 4000),
        resultFullPath: opts.transcriptPath,
        commitsReferenced: [],
        filesModified: [],
      });
    } else {
      await failDispatch(
        row.id,
        {
          errorMessage: `terminated: ${r.terminationReason} — ${r.finalText.slice(0, 1500)}`,
          costUsd: r.costUsd,
          durationMs,
          tokenInput: r.tokenInput,
          tokenOutput: r.tokenOutput,
          resultFullPath: opts.transcriptPath,
          commitsReferenced: [],
          filesModified: [],
        },
        {
          status: r.terminationReason === "aborted" || r.terminationReason === "no_work" ? "cancelled" : "failed",
          // A provider error before any effect is safe to retry; nothing else is.
          transient: r.terminationReason === "error" && r.effects.length === 0,
        },
      );
    }
  } catch (err) {
    logger.error(`[roleWorkers] persistence failed for dispatch ${row.id}`, err instanceof Error ? err : undefined);
  }
  return r;
}

// The publish gate's functions, loaded once (publishArtifact pulls DOMPurify).
let gate: { parsePublishable: (t: string) => { subject: string; htmlBody: string } | null; screenForPublish: (i: { subject: string; htmlBody: string }) => { ok: boolean; violations: Array<{ code: string; message: string }> } } | null = null;
async function primePublishGate(): Promise<void> {
  if (!gate) gate = await import("../../autopilot/publishArtifact");
}
function screenPublishableSync(text: string): { parsed: boolean; ok: boolean; violations: string[] } {
  if (!gate) return { parsed: false, ok: false, violations: ["publish gate not loaded"] };
  const p = gate.parsePublishable(text);
  if (!p) return { parsed: false, ok: false, violations: [] };
  const s = gate.screenForPublish({ subject: p.subject, htmlBody: p.htmlBody });
  return { parsed: true, ok: s.ok, violations: s.violations.map((v) => `${v.code}: ${v.message}`) };
}
