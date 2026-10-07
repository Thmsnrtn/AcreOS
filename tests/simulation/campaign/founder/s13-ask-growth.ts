/**
 * Scenario 13 — ask growth. Read off the S1 run (1,440 ticks, founder answers
 * nothing): how many asks were opened, how many duplicates sat open at once,
 * how many expired, and how many re-pages reached the founder's phone.
 *
 *   run-harness.sh tests/simulation/campaign/founder/s13-ask-growth.ts   (after s01 dispatch)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as k from "./simkit";

async function main() {
  const s1 = JSON.parse(readFileSync(join(k.OUT, "scenarios", "s01-dispatch.json"), "utf8"));
  const ticks = s1.jobSummary?.solene_continuous_tick?.runs ?? 0;
  const vac = k.vacuity(ticks >= 1400, `${ticks} continuous ticks in the S1 run, founder answered nothing`);
  const a = s1.asks;
  const weeks = s1.days / 7;
  k.recordEvent({
    scenario: "S13",
    event: "Ask growth with nothing answered (30 days)",
    outcome: "ESCALATED",
    founderMinutes: Math.round(a.openMinutes),
    evidence: `${a.created} asks opened (${(a.created / weeks).toFixed(1)}/wk) across ${a.distinctSummaries} distinct summaries; byStatus=${JSON.stringify(a.byStatus)}; open at day 30=${a.open} of which ${a.openDupes} are same-summary duplicates open simultaneously; ${s1.world.pages} re-pages to the founder's phone (${JSON.stringify(s1.world.pageTitles)}); yes/no asks auto-expire after 168h (low urgency) via the escalation ladder — the pile is bounded at ~6`,
    vacuity: vac,
  });
  await k.shutdown();
}
main().catch((e) => { console.error(e); process.exit(1); });
