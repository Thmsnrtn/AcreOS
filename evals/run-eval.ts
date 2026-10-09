/**
 * evals/run-eval.ts — the Pax eval, on the SERVED model path.
 *
 * Run:
 *   npm run eval -- --model served:free --report-dir evals/reports/pr
 *   npm run eval -- --model openai/gpt-4o
 *   npm run eval -- --estimate-cost          # the bound, no calls
 *
 * What it measures (evals/servedPath.ts): the system prompt Pax's chat
 * composes (composePaxSystemPrompt over the executive profile prompt), sent
 * to the model production's tier rule picks ("served:<tier>") or to an
 * explicit OpenRouter id, over OpenRouter — the route customer Pax takes.
 *
 * With no OpenRouter key it DOES NOT SCORE. Until 2026-10-09 this runner
 * stubbed every model call with a placeholder and the judge with a fixed 0.7,
 * and CI printed avgOverall 0.5555 on every PR as if it were a measurement.
 * Now the report says `measured: false` with the reason, the console says
 * NOT MEASURED in capitals, and there is no number to mistake for one.
 * `--require-measured` turns that into exit 2 for jobs that must measure.
 *
 * Exits 0 on a measured or an unmeasured run (the workflow decides what an
 * unmeasured run means); exits 1 on a crash.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PaxPromptVersion } from "../server/ai/paxPromptVersions";
import {
  estimateRunCostUsd,
  openRouterComplete,
  openRouterJudge,
  resolveRunMode,
  resolveServedTarget,
  servedSystemPrompt,
} from "./servedPath";
import { scoreServed, type GoldenEntry } from "./runServed";

interface CliArgs {
  prompts: string;
  model: string;
  paxPrompt: PaxPromptVersion;
  judge: string;
  reportDir: string;
  limit?: number;
  estimateOnly: boolean;
  requireMeasured: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const here = dirname(fileURLToPath(import.meta.url));
  const a: CliArgs = {
    prompts: join(here, "golden-set.json"),
    model: "served:free",
    paxPrompt: "v3",
    judge: "anthropic/claude-haiku-4.5",
    reportDir: join(here, "reports"),
    estimateOnly: false,
    requireMeasured: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case "--prompts": a.prompts = next(); break;
      case "--model": a.model = next(); break;
      case "--pax-prompt": a.paxPrompt = next() === "v2" ? "v2" : "v3"; break;
      case "--judge": a.judge = next(); break;
      case "--report-dir": a.reportDir = next(); break;
      case "--limit": a.limit = Number(next()); break;
      case "--estimate-cost": a.estimateOnly = true; break;
      case "--require-measured": a.requireMeasured = true; break;
    }
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv);
  const set = JSON.parse(readFileSync(args.prompts, "utf8")) as { entries: GoldenEntry[] };
  const entries = args.limit ? set.entries.slice(0, args.limit) : set.entries;
  const target = resolveServedTarget(args.model);
  const system = servedSystemPrompt(args.paxPrompt);
  const estimatedCostUsd = estimateRunCostUsd({ model: target.model, judgeModel: args.judge, systemPrompt: system, prompts: entries.map((e) => e.prompt) });
  const mode = resolveRunMode();
  const startedAt = new Date().toISOString();
  const base = {
    startedAt,
    target,
    paxPromptVersion: args.paxPrompt,
    systemPromptChars: system.length,
    judge: args.judge,
    prompts: entries.length,
    estimatedCostUsdUpperBound: Number(estimatedCostUsd.toFixed(4)),
  };

  console.log(`[eval] ${entries.length} prompts • target=${target.spec} → ${target.model} (${target.via}) • paxPrompt=${args.paxPrompt} • judge=${args.judge}`);
  console.log(`[eval] cost bound for one measured run: $${estimatedCostUsd.toFixed(4)} (repo rate table; replies at max_tokens)`);
  if (args.estimateOnly) return;

  if (!existsSync(args.reportDir)) mkdirSync(args.reportDir, { recursive: true });
  const write = (report: object) => {
    writeFileSync(join(args.reportDir, `${startedAt.replace(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2));
    writeFileSync(join(args.reportDir, "latest.json"), JSON.stringify(report, null, 2));
  };

  if (!mode.measured) {
    write({ ...base, measured: false, reason: mode.reason, totals: null });
    console.log("");
    console.log("[eval] ================================================================");
    console.log("[eval] NOT MEASURED — no score was produced.");
    console.log(`[eval] ${mode.reason}.`);
    console.log("[eval] ================================================================");
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=AI eval NOT MEASURED::${mode.reason}`);
    if (args.requireMeasured) process.exit(2);
    return;
  }

  const { scores, totals, errors } = await scoreServed({
    entries,
    model: target.model,
    system,
    complete: openRouterComplete(mode),
    judge: openRouterJudge(mode, args.judge),
    onEntry: (s) => process.stdout.write(`  ${s.id}  shape=${s.shape.score.toFixed(2)} topics=${s.topics.score.toFixed(2)} tone=${s.tone.score.toFixed(2)} -> ${s.overall.toFixed(2)}\n`),
  });
  write({ ...base, measured: true, finishedAt: new Date().toISOString(), callErrors: errors, totals, entries: scores });
  console.log(`\n[eval] MEASURED overall=${totals.avgOverall.toFixed(4)} shape=${totals.avgShape.toFixed(3)} topics=${totals.avgTopics.toFixed(3)} tone=${totals.avgTone.toFixed(3)} callErrors=${errors}`);
  for (const [cat, c] of Object.entries(totals.byCategory)) console.log(`    ${cat.padEnd(24)} n=${c.count}  overall=${c.avgOverall.toFixed(3)}`);
}

main().catch((err) => {
  console.error("[eval] fatal:", err);
  process.exit(1);
});
