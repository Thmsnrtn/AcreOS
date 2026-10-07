/**
 * Judge the banks and write evals.json for the scorecard.
 *
 *   npx tsx tests/simulation/evals/run.ts --out <evals.json> [--app <pax-answers.jsonl …>]
 *
 * --app judges the answers the RUNNING APP gave to bank questions during a
 * simulated year (year.ts records them) — real product plumbing and guards,
 * with the scripted brain behind them, so a low score there says the brain is
 * scripted, not that Pax is bad. Real-model judging needs --real and
 * SIMPLAT_REAL_JUDGE + a ceiling (realJudge.ts); this file never calls a model
 * without them.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { generatePaxBank } from "./paxBank";
import { judgeBank } from "./judges";
import { referenceAnswer, corruptedAnswer, capableAnswer } from "./answerers";
import { generateSoleneBank, referenceSolene, corruptedSolene, judgeSolene } from "./soleneBank";

const argv = process.argv.slice(2);
const out = argv[argv.indexOf("--out") + 1] ?? "evals.json";
const apps: string[] = [];
if (argv.includes("--app")) for (let i = argv.indexOf("--app") + 1; i < argv.length && !argv[i].startsWith("--"); i++) apps.push(argv[i]);
if (argv.includes("--real")) throw new Error("real-model judging: set SIMPLAT_REAL_JUDGE=1 and SIMPLAT_JUDGE_CEILING_USD and use realJudge.ts — not run in this task");

const pax = generatePaxBank();
const byId = new Map(pax.map((q) => [q.id, q]));
const ref = judgeBank(pax, (q) => referenceAnswer(byId.get(q.id)!));
const bad = judgeBank(pax, (q) => corruptedAnswer(byId.get(q.id)!));
const brain = judgeBank(pax, (q) => capableAnswer(byId.get(q.id)!));
let app: ReturnType<typeof judgeBank> | null = null;
const answers = new Map<string, string>();
for (const f of apps) if (existsSync(f)) for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) { try { const r = JSON.parse(l); if (r.id && typeof r.answer === "string") answers.set(r.id, r.answer); } catch { /* skip */ } }
if (answers.size) app = judgeBank(pax.filter((q) => answers.has(q.id)), (q) => answers.get(q.id)!);
const sol = generateSoleneBank();
const sRef = judgeSolene(sol, referenceSolene);
const sBad = judgeSolene(sol, corruptedSolene);

const result = {
  pax: {
    total: pax.length, heldOut: pax.filter((q) => q.heldOut).length,
    byCategory: pax.reduce((a: Record<string, number>, q) => ((a[q.category] = (a[q.category] ?? 0) + 1), a), {}),
    reference: { passRate: ref.passRate, agreement: ref.agreement },
    corrupted: { passRate: bad.passRate, agreement: bad.agreement },
    scriptedBrain: { passRate: brain.passRate, heldOutPassRate: brain.heldOutPassRate, agreement: brain.agreement, byCategory: brain.byCategory },
    app: app ? { answered: app.total, passRate: app.passRate, heldOutPassRate: app.heldOutPassRate, agreement: app.agreement, disagreements: app.disagreements.slice(0, 10) } : null,
    // the headline numbers the scorecard prints: the scripted brain's
    agreement: brain.agreement, disagreements: brain.disagreements.length, heldOutPassRate: brain.heldOutPassRate, sampleDisagreements: brain.disagreements.slice(0, 8),
  },
  solene: { total: sol.length, heldOut: sol.filter((s) => s.heldOut).length, reference: sRef, corrupted: { passRate: sBad.passRate, agreement: sBad.agreement }, agreement: sRef.agreement, heldOutPassRate: sRef.heldOutPassRate },
  realModel: "not run (no paid model calls in this task); realJudge.ts refuses to start without SIMPLAT_REAL_JUDGE and a ceiling",
};
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ pax: { total: result.pax.total, heldOut: result.pax.heldOut, brain: result.pax.scriptedBrain.passRate, app: result.pax.app?.passRate ?? null }, solene: { total: result.solene.total } }));
