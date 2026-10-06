/**
 * Part C — the autonomy ledger.
 *
 * Reads $FOUNDER_SIM_OUT/autonomy-ledger.jsonl (one row per business event,
 * written by the scenario scripts through simkit.recordEvent), keeps the LAST
 * row per (scenario, event) — a re-run supersedes an earlier one — and writes
 * $FOUNDER_SIM_OUT/autonomy-ledger.md: every event × outcome × founder minutes,
 * plus the smallest change that would turn each ESCALATED/DROPPED row into
 * HANDLED (or why it must stay escalated forever), and a weekly founder-minute
 * estimate for a stated early-business week mix against the 24-minute target.
 *
 *   FOUNDER_SIM_OUT=<dir> npx tsx tests/simulation/campaign/founder/ledger-table.ts
 *
 * The fixes below are the authors' reading of the code at the cited lines; the
 * outcomes and minutes come only from the ledger rows.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.FOUNDER_SIM_OUT ?? "/tmp/founder-sim-out";
interface Row { scenario: string; event: string; outcome: string; founderMinutes: number; evidence: string; vacuity: string; at: string }

const rows = new Map<string, Row>();
for (const line of readFileSync(join(OUT, "autonomy-ledger.jsonl"), "utf8").split("\n").filter(Boolean)) {
  const r = JSON.parse(line) as Row;
  rows.set(`${r.scenario}::${r.event}`, r);
}

/** Smallest change → HANDLED, keyed by an event-name substring. "FOREVER" = must stay with the founder. */
const FIX: Array<[RegExp, string]> = [
  [/Acquire first customer/, "server/services/solene/founderCollab.ts:279 answerFounderAsk — on a 'yes' to an autopilot ask, enqueue the drafted move (deps.enqueue in act.ts:300) instead of only recording the verdict; until then every growth tick is an ask that does nothing."],
  [/approves every ask/, "same as above (founderCollab.ts:279); and experienceLog.ts:49 must not score an approval of an action that never ran as 'success' (it is what lifted growth to autonomous_gated and printed '100% hit-rate')."],
  [/signup stalls/, "server/services/solene/continuousLoop.ts:600 sensesFromPulse — supply activationStalled (decide.ts:132 already ranks unblock_activation) from orgs with onboarding_completed=false > 48h; also start the onboarding journey on real sign-up (middleware/getOrCreateOrg.ts:214 never calls startJourney)."],
  [/trial ends/, "server/services/trialEngine.ts:124 — also match in-app trials (getOrCreateOrg.ts:219 creates them as subscription_status='active', tier 'free'), so ending_soon/expired emails ever fire."],
  [/Support ticket/, "server/services/autopilot/senses.ts:29 — count support_tickets with resolution_type='escalated' (what the customer chat writes) instead of support_cases (always 0 here); then clear_support_backlog ranks and the ask names the ticket."],
  [/Failed subscription payment/, "server/services/dunning.ts:111 — owner lookup compares users.clerk_user_id to organizations.owner_id (a users.id UUID), so every dunning email is skipped ('No billing email found'); match users.id."],
  [/goes quiet/, "server/services/churnEngine.ts:37-38 — a paying customer silent 16 days scores 50 (< 80 alert / 85 rescue) and nothing writes autopilot_senses churn_signal (only a Stripe cancel does, webhookHandlers.ts:300); record a churn_signal at a reachable threshold."],
  [/absent 14 days/, "fold support/dunning/legal into the ask stream (fixes above); the yes/no auto-timeout (escalationLadder) already keeps the pile bounded."],
  [/outage: model/, "server/services/solene/continuousLoop.ts (tick) — page the founder once when model calls fail N ticks in a row; and give the operator/support OpenAI clients a short timeout (operator.ts:206 builds the client with SDK defaults)."],
  [/outage: ses/, "emailService send failure should raise a reflex failure the tick already ranks (stabilize_reflexes) and page once."],
  [/outage: stripe/, "billing reads already degrade honestly ('Can't verify'); page once when Stripe is unreachable for a whole day."],
  [/Recovery after outages/, "—"],
  [/raising prices|\$2,000 ad|deleting customer data|counterparties|\$2,000 refund/, "FOREVER founder-only (hard-stop: pricing / spend >$500 / data deletion / platform-sender counterparty mail)."],
  [/Panic stop/, "server/services/autopilot/panicStop.ts — also cancel in-flight dispatches (abort the runner) rather than only flipping switches."],
  [/Resume after panic/, "FOREVER founder-only by design (guided resume); keep, but restore prior domain levels as one confirm instead of re-granting each."],
  [/Queued growth dispatch executes/, "server/services/solene/dispatchRunner.ts — a content dispatch should not need git/a developer checkout; route growth moves to a non-coding writer that returns the <<<PUBLISH block."],
  [/AI spend/, "—"],
  [/TCPA/, "FOREVER founder (legal) — but it must REACH him: classify legal keywords on ticket intake (routes-support / supportAgent) into askFounder(urgency='urgent'); today it only lands in the off-door /api/founder/intelligence/todo."],
  [/Legal notice/, "FOREVER founder (legal) — same intake classifier → urgent ask + page."],
  [/Data-deletion/, "FOREVER founder (customer-data deletion hard-stop) — but surface it: compliance sense (continuousLoop.ts:1617) reads only beatrice_reg_events; count open dsar_requests / dsar_requests_lifecycle too."],
];
const fixFor = (e: string) => FIX.find(([re]) => re.test(e))?.[1] ?? "";

const ordered = [...rows.values()].sort((a, b) => a.scenario.localeCompare(b.scenario, undefined, { numeric: true }));
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
let md = "# Founder-side autonomy ledger\n\n";
md += `Generated ${new Date().toISOString()} from ${rows.size} events (last row per scenario × event).\n\n`;
md += "| Scenario | Business event | Outcome | Founder min | Evidence (abridged) | Smallest change → HANDLED / stays with founder |\n|---|---|---|---|---|---|\n";
for (const r of ordered) md += `| ${r.scenario} | ${esc(r.event)} | **${r.outcome}** | ${r.founderMinutes} | ${esc(r.evidence.slice(0, 260))} | ${esc(fixFor(r.event))} |\n`;

// ── weekly mix ──────────────────────────────────────────────────────────────
// An early-business week (0–5 customers): the background ask stream (S1), one
// new signup that stalls, two support tickets (one a refund), a quarter of a
// failed payment, a quarter of a quiet paying customer, a quarter of a trial
// ending, one provider blip a month (¼/wk), and one legal/compliance item a
// quarter (~0.08/wk each). "Escalated" = what Solene puts in front of him.
// "Cover" = what a responsible founder must spend finding what was DROPPED
// (15 min investigation each, the brief's rubric).
const find = (re: RegExp) => ordered.filter((r) => re.test(`${r.scenario} ${r.event}`));
const MIX: Array<[string, RegExp, number]> = [
  ["Solene's own ask stream (S1, absent founder)", /S1-dispatch/, 1],
  ["New signup stalls", /signup stalls/, 1],
  ["Trial ends", /trial ends/, 0.25],
  ["Support tickets", /Support ticket: (refund30|howdoi)/, 1],
  ["Failed payment", /Failed subscription payment/, 0.25],
  ["Quiet paying customer", /goes quiet/, 0.25],
  ["Provider outage", /outage: model-500/, 0.25],
  ["TCPA / legal / DSAR", /TCPA|Legal notice|Data-deletion/, 0.08],
];
let escalated = 0;
let cover = 0;
md += "\n## Founder minutes per simulated week (early-business mix)\n\n| Event | per week | rows used | outcome(s) | escalated min/wk | cover-the-drops min/wk |\n|---|---|---|---|---|---|\n";
for (const [name, re, perWeek] of MIX) {
  const rs = find(re);
  if (rs.length === 0) { md += `| ${name} | ${perWeek} | 0 | NOT RUN | — | — |\n`; continue; }
  // S1's row is already per-week minutes; other rows are per event.
  const e = rs.reduce((a, r) => a + (r.outcome === "ESCALATED" || r.outcome === "REFUSED-CORRECTLY" ? r.founderMinutes : 0), 0) * perWeek;
  const c = rs.reduce((a, r) => a + (r.outcome === "DROPPED" ? 15 : 0), 0) * perWeek;
  escalated += e;
  cover += c;
  md += `| ${name} | ${perWeek} | ${rs.length} | ${[...new Set(rs.map((r) => r.outcome))].join("/")} | ${e.toFixed(1)} | ${c.toFixed(1)} |\n`;
}
md += `| **Total** | | | | **${escalated.toFixed(0)}** | **${cover.toFixed(0)}** |\n\n`;
md += `Target: 24 min/week (1% of 40h). Escalated alone = ${escalated.toFixed(0)} min (${(escalated / 24).toFixed(1)}× target); escalated + covering what is silently dropped = ${(escalated + cover).toFixed(0)} min (${((escalated + cover) / 24).toFixed(1)}× target).\n`;
md += "\nNote: the escalated minutes buy nothing today — approving an ask causes no action (see S6), so the honest cost of the ask stream is time spent for zero effect.\n";
writeFileSync(join(OUT, "autonomy-ledger.md"), md);
console.log(md);
