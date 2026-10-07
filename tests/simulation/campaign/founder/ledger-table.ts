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
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.FOUNDER_SIM_OUT ?? fileURLToPath(new URL("../../reports/founder-sim", import.meta.url));
interface Row { scenario: string; event: string; outcome: string; founderMinutes: number; evidence: string; vacuity: string; at: string }

const rows = new Map<string, Row>();
for (const line of readFileSync(join(OUT, "autonomy-ledger.jsonl"), "utf8").split("\n").filter(Boolean)) {
  const r = JSON.parse(line) as Row;
  rows.set(`${r.scenario}::${r.event}`, r);
}

/** Smallest change → HANDLED, keyed by an event-name substring. "FOREVER" = must stay with the founder. */
const FIX: Array<[RegExp, string]> = [
  // Stage 2 (2026-10-07) readings. A row that is HANDLED needs no fix; the
  // text says what remains or why it stays with the founder.
  [/owned content through the publish gate/, "— (Writer role worker → the existing publish gate; the founder's only cost is the one-time setup)."],
  [/Empty result/, "— (taskGuards.ts: an empty answer is a failure in both runners)."],
  [/No hard-stop crossed/, "FOREVER founder-only (pricing / legal signing / spend >$500 / customer-data deletion) — held + surfaced, never delegated."],
  [/Acquire first customer/, "Founder absent with NO setup: growth stays at observe, so every growth tick is a draft-review ask that times out. The one-time setup (S1-team) is the fix; nothing else in code."],
  [/approves every ask/, "— (an approval enqueues the move; the Writer runs it)."],
  [/signup stalls/, "unblock_activation is still code work (coding agent); a Retention-style nudge to the stalled signup would turn it HANDLED."],
  [/trial ends/, "—"],
  [/Support ticket.*(refund80)/, "FOREVER founder (a refund over the $50 ceiling): one ask naming the ticket; the customer is told honestly."],
  [/Support ticket.*(bug)/, "Stays with a human until there is an engineer role: the Support worker acknowledges + escalates; a coding dispatch could investigate."],
  [/Support ticket/, "— (Support role worker; refunds ≤ $50 through apply_refund under the founder's grant)."],
  [/Failed subscription payment/, "—"],
  [/goes quiet/, "— (Retention role worker: win-back by system mail, under the founder's support grant)."],
  [/absent 14 days/, "the remaining open asks are founder-only by nature (over-ceiling refund, legal) plus draft-review asks for domains he did not trust."],
  [/outage|One page per outage/, "— (ops watch: one incident + one page per outage; recovery closes it)."],
  [/Recovery after outages/, "—"],
  [/raising prices|\$2,000 ad|deleting customer data|counterparties|\$2,000 refund|invented statistics/, "FOREVER founder-only (hard-stop: pricing / spend >$500 / data deletion / platform-sender counterparty mail); fabrication is refused at the publish gate."],
  [/Panic stop/, "—"],
  [/Resume after panic/, "FOREVER founder-only by design (he pressed the button) — now ONE confirm that restores the prior levels + switches exactly."],
  [/Queued growth dispatch executes/, "— (the Writer, not a coding agent)."],
  [/AI spend/, "—"],
  [/TCPA/, "FOREVER founder (legal) — reaches him as an urgent ask + page."],
  [/Legal notice/, "FOREVER founder (legal) — urgent ask + page."],
  [/Data-deletion/, "FOREVER founder (customer-data deletion hard-stop) — surfaced as a compliance item."],
];
const fixFor = (e: string) => FIX.find(([re]) => re.test(e))?.[1] ?? "";

const ordered = [...rows.values()].sort((a, b) => a.scenario.localeCompare(b.scenario, undefined, { numeric: true }));
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
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
// Stage 2: the founder posture measured is "one-time setup, then absent"
// (S1-team: its row already folds the setup minutes into per-week minutes).
// Without a S1-team row the original absent-without-setup S1 is used.
const hasTeam = [...rows.keys()].some((k) => k.startsWith("S1-team::"));
const MIX: Array<[string, RegExp, number]> = [
  [hasTeam ? "Solene's own ask stream (S1-team: setup once, then absent)" : "Solene's own ask stream (S1, absent founder)", hasTeam ? /S1-team Acquire first customer/ : /S1-dispatch/, 1],
  ["New signup stalls", /signup stalls/, 1],
  ["Trial ends", /trial ends/, 0.25],
  ["Support tickets", /^S3 Support ticket: (refund30|howdoi)/, 1],
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
  // Every minute a row costs the founder counts, whatever its outcome: a
  // HANDLED ask stream still has its asks (S1-team prices them per week), and
  // a HANDLED signup can still have put an inbox card in front of him.
  const e = rs.reduce((a, r) => a + (r.outcome !== "DROPPED" ? r.founderMinutes : 0), 0) * perWeek;
  const c = rs.reduce((a, r) => a + (r.outcome === "DROPPED" ? 15 : 0), 0) * perWeek;
  escalated += e;
  cover += c;
  md += `| ${name} | ${perWeek} | ${rs.length} | ${[...new Set(rs.map((r) => r.outcome))].join("/")} | ${e.toFixed(1)} | ${c.toFixed(1)} |\n`;
}
md += `| **Total** | | | | **${escalated.toFixed(0)}** | **${cover.toFixed(0)}** |\n\n`;
md += `Target: 24 min/week (1% of 40h). Escalated alone = ${escalated.toFixed(0)} min (${(escalated / 24).toFixed(1)}× target); escalated + covering what is silently dropped = ${(escalated + cover).toFixed(0)} min (${((escalated + cover) / 24).toFixed(1)}× target).\n`;
md += hasTeam
  ? "\nNote: since Stage 1 an approval enqueues the move; since Stage 2 the move runs a role worker that does the job (an article, a reply, a refund ≤ $50, a win-back email). The escalated minutes above are decisions only the founder can make, plus the one-time setup amortised over the month.\n"
  : "\nNote: the escalated minutes buy nothing today — approving an ask causes no action (see S6), so the honest cost of the ask stream is time spent for zero effect.\n";
writeFileSync(join(OUT, "autonomy-ledger.md"), md);
console.log(md);
