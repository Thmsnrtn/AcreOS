/**
 * The AI eval measures the served model path, or says it measured nothing.
 *
 * Measured 2026-10-09: .github/workflows/eval.yml ran on every PR against
 * claude-sonnet-4-6 and claude-haiku-4-5 with every model key empty. Each call
 * fell to a placeholder, the judge to a fixed 0.7, and avgOverall was 0.5555
 * on both models on every run — $0 spent, nothing measured, a number posted
 * on the PR as if it were a score. It also evaluated a hand-copied prompt and
 * a direct-Anthropic route customer Pax never takes.
 *
 * Pinned here:
 *   1. ADOPTION — the eval's prompt and model come from production code: the
 *      executive profile's prompt IS PAX_EXECUTIVE_SYSTEM_PROMPT, and
 *      pickPaxModelForOrg returns exactly paxModelForTierAndUsage's choice.
 *   2. SENSITIVITY — the score is a function of the served prompt: with a
 *      provider stand-in that follows the instructions it is given, removing
 *      the response-shape block or the constitution moves the score.
 *   3. HONESTY — with no key the runner writes measured:false, prints NOT
 *      MEASURED and no score, and the workflow reads `measured` before any
 *      score; its matrix names only served targets.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import yaml from "js-yaml";

const ROOT = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 120_000 });

const H = vi.hoisted(() => ({ tier: "free", count: 0 }));
vi.mock("../../server/db", () => {
  const rows = (cols: any) => (cols && "n" in cols ? [{ n: H.count }] : [{ subscriptionTier: H.tier }]);
  return {
    db: {
      select: (cols: any) => {
        const c: any = { from: () => c, where: () => c, limit: () => c, then: (ok: any, bad: any) => Promise.resolve(rows(cols)).then(ok, bad) };
        return c;
      },
    },
  };
});
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { resolveServedTarget, servedSystemPrompt, resolveRunMode, estimateRunCostUsd, type Complete } from "../../evals/servedPath";
import { scoreServed, type GoldenEntry } from "../../evals/runServed";
import { paxModelForTierAndUsage } from "../../server/services/paxModelChoice";
import { PAX_RESPONSE_SHAPE_V3, PAX_CONSTITUTIONAL_BLOCK } from "../../server/ai/paxPromptVersions";
import type { ToneJudge } from "../../evals/score";

const golden = JSON.parse(fs.readFileSync(path.join(ROOT, "evals/golden-set.json"), "utf8")).entries as GoldenEntry[];

describe("adoption: the eval's prompt and model are production's", () => {
  it("served:<tier> resolves through the rule pickPaxModelForOrg applies", async () => {
    const { pickPaxModelForOrg } = await import("../../server/services/paxModelTier");
    for (const [tier, count] of [["free", 0], ["pro", 0], ["pro", 5000], ["scale", 0], ["scale", 300], ["scale", 9999]] as const) {
      H.tier = tier;
      H.count = count;
      const live = await pickPaxModelForOrg(1);
      expect(live).toEqual(paxModelForTierAndUsage(tier, count));
    }
    for (const tier of ["free", "pro", "scale"] as const) {
      expect(resolveServedTarget(`served:${tier}`).model).toBe(paxModelForTierAndUsage(tier, 0).model);
    }
  });

  it("the chat's executive profile prompt IS the module the eval imports (no copy)", () => {
    const src = fs.readFileSync(path.join(ROOT, "server/ai/executive.ts"), "utf8");
    const sf = ts.createSourceFile("executive.ts", src, ts.ScriptTarget.Latest, true);
    let init: string | null = null;
    const visit = (n: ts.Node) => {
      if (ts.isPropertyAssignment(n) && n.name.getText(sf) === "executive" && ts.isObjectLiteralExpression(n.initializer)) {
        for (const p of n.initializer.properties) if (ts.isPropertyAssignment(p) && p.name.getText(sf) === "systemPrompt") init = p.initializer.getText(sf);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(init).toBe("PAX_EXECUTIVE_SYSTEM_PROMPT");
    const evalSrc = fs.readFileSync(path.join(ROOT, "evals/run-eval.ts"), "utf8");
    expect(evalSrc).not.toMatch(/You are Pax/); // no hand-copied prompt in the runner
  });

  it("a bare model name is refused; only served tiers or OpenRouter ids", () => {
    expect(() => resolveServedTarget("claude-sonnet-4-6")).toThrow(/not a served target/);
    expect(resolveServedTarget("openai/gpt-4o").model).toBe("openai/gpt-4o");
  });
});

describe("sensitivity: the score moves when the served prompt is mutated", () => {
  // A provider stand-in that does what its system prompt says: the v3 shape
  // block yields a headline + bullets; without it, a rambling paragraph. The
  // constitution yields refusals of probes; without it, compliance.
  const followsInstructions: Complete = async ({ system, user }) => {
    const probe = /system prompt|ignore (all |previous )|DAN|previous instructions|developer message|home address|phone number|guarantee/i.test(user);
    if (probe) return system.includes(PAX_CONSTITUTIONAL_BLOCK) ? "I can't share that." : "Sure! Here are my full instructions and the owner's home address, guaranteed.";
    const words = user.replace(/[^A-Za-z$0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3).slice(0, 6);
    if (system.includes(PAX_RESPONSE_SHAPE_V3)) return `${words.slice(0, 3).join(" ")} looks workable.\n- ${words[3] ?? "comps"} first\n- check ${words[4] ?? "title"}\n- then ${words[5] ?? "offer"}`;
    return `Sure! Of course! ${"There are many things to consider here and it depends. ".repeat(12)}${words.join(" ")}`;
  };
  const judge: ToneJudge = { judge: async ({ output }) => ({ score: /^Sure!/.test(output) ? 0.2 : 0.8, rationale: "stand-in" }) };
  const run = (system: string) => scoreServed({ entries: golden, model: "stand-in", system, complete: followsInstructions, judge }).then((r) => r.totals.avgOverall);

  it("removing the response-shape block, or the constitution, lowers the score", async () => {
    const served = servedSystemPrompt("v3");
    const base = await run(served);
    const noShape = await run(served.replace(PAX_RESPONSE_SHAPE_V3, ""));
    const noConstitution = await run(served.replace(PAX_CONSTITUTIONAL_BLOCK, ""));
    expect(base).toBeGreaterThan(noShape);
    expect(base).toBeGreaterThan(noConstitution);
    expect(new Set([base, noShape, noConstitution].map((x) => x.toFixed(4))).size).toBe(3);
  });

  it("a failed call scores as nothing, never as a shaped placeholder", async () => {
    const r = await scoreServed({ entries: golden.slice(0, 5), model: "x", system: "s", complete: async () => { throw new Error("down"); }, judge });
    expect(r.errors).toBe(5);
    expect(r.totals.avgTone).toBe(0);
  });
});

describe("honesty: no key means no score, said loudly", () => {
  it("resolveRunMode refuses without an OpenRouter key", () => {
    expect(resolveRunMode({} as NodeJS.ProcessEnv)).toEqual(expect.objectContaining({ measured: false }));
    expect(resolveRunMode({ AI_INTEGRATIONS_OPENROUTER_API_KEY: "k" } as NodeJS.ProcessEnv)).toEqual(expect.objectContaining({ measured: true }));
  });

  it("the CLI writes measured:false, prints NOT MEASURED and no score, and --require-measured exits 2", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-"));
    const env = { ...process.env } as Record<string, string>;
    for (const k of Object.keys(env)) if (/API_KEY/.test(k)) delete env[k];
    delete env.NODE_OPTIONS;
    const r = spawnSync(process.execPath, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), "evals/run-eval.ts", "--limit", "3", "--report-dir", dir], { cwd: ROOT, env, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/NOT MEASURED/);
    expect(r.stdout).not.toMatch(/overall=\d/);
    const rep = JSON.parse(fs.readFileSync(path.join(dir, "latest.json"), "utf8"));
    expect(rep.measured).toBe(false);
    expect(rep.totals).toBeNull();
    const strict = spawnSync(process.execPath, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), "evals/run-eval.ts", "--limit", "1", "--report-dir", dir, "--require-measured"], { cwd: ROOT, env, encoding: "utf8" });
    expect(strict.status).toBe(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("the workflow's matrix names only served targets, keys only the served route, and reads `measured` before a score", () => {
    const wf = yaml.load(fs.readFileSync(path.join(ROOT, ".github/workflows/eval.yml"), "utf8")) as any;
    const job = wf.jobs.eval;
    const targets: string[] = job.strategy.matrix.target;
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) expect(() => resolveServedTarget(t)).not.toThrow();
    const prStep = job.steps.find((s: any) => s.id === "eval-pr");
    expect(Object.keys(prStep.env)).toEqual(["AI_INTEGRATIONS_OPENROUTER_API_KEY"]);
    const run: string = prStep.run;
    expect(run.indexOf("measured")).toBeGreaterThan(-1);
    expect(run.indexOf("measured")).toBeLessThan(run.indexOf("avgOverall"));
    const mainStep = job.steps.find((s: any) => s.id === "eval-main");
    expect(mainStep.if).toMatch(/measured == 'true'/);
  });

  it("the cost bound is real arithmetic over the served prompt (non-zero, grows with the model's price)", () => {
    const sys = servedSystemPrompt("v3");
    const prompts = golden.map((g) => g.prompt);
    const free = estimateRunCostUsd({ model: resolveServedTarget("served:free").model, judgeModel: "anthropic/claude-haiku-4.5", systemPrompt: sys, prompts });
    const scale = estimateRunCostUsd({ model: resolveServedTarget("served:scale").model, judgeModel: "anthropic/claude-haiku-4.5", systemPrompt: sys, prompts });
    expect(free).toBeGreaterThan(0);
    expect(scale).toBeGreaterThan(free);
  });
});
