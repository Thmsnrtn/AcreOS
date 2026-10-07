/**
 * Scenario 1 (+13): zero customers, $0 revenue, budget-constrained growth —
 * the owner's real situation — for 30 simulated days, founder ABSENT (he
 * answers nothing). Scenario 13 ("ask growth") is read off the same run:
 * 1,440 ticks with nothing answered.
 *
 * Variants (argv[2]):
 *   dispatch   — the founder does exactly what the Letter tells him on day 0:
 *                "nothing executes until you enable Dispatch in Controls" → he
 *                flips Dispatch ON. (default)
 *   all-on     — the founder flips EVERY master switch in Controls on (dispatch,
 *                publish, cognition), the layperson "turn it all on" reading.
 *   fixed-digest — `dispatch`, but with organizations.monthly_price_cents added
 *                to the sim DB so the daily founder_digest job stops failing
 *                (isolates how much of the outcome that one defect causes).
 *
 * Vacuity: ≥1,400 continuous ticks ran; every tick routed a move (actOutcome
 * non-null once dispatch is on); the founder surfaces answered 200.
 */
import * as k from "./simkit";

const variant = process.argv[2] ?? "dispatch";
const DAYS = Number(process.argv[3] ?? 30);

async function main() {
  console.log(`S1 zero-customers variant=${variant} days=${DAYS}`);
  await k.resetWorld();
  await k.bootSeed();
  k.resetSimClock();
  k.setEgressRules(k.PROVIDERS_UP);
  k.setStandinRules({ default: "script" });
  if (variant === "fixed-digest") {
    await k.q("alter table organizations add column if not exists monthly_price_cents integer");
  } else {
    await k.q("alter table organizations drop column if exists monthly_price_cents");
  }

  const day0 = await k.founderView();
  await k.setSwitch("dispatchEnabled", true);
  if (variant === "all-on") {
    await k.setSwitch("publishEnabled", true);
    await k.setSwitch("cognitionEnabled", true);
  }

  const jobs = await k.defaultJobs();
  const m = k.marks();
  const weekly: any[] = [];
  const allLogs: k.JobRunLog[] = [];
  const t0 = Date.now();
  for (let d = 0; d < DAYS; d++) {
    const log = await k.advance(24, jobs);
    allLogs.push(...log);
    if ((d + 1) % 7 === 0 || d === DAYS - 1) {
      const v = await k.founderView();
      const a = await k.askStats();
      const contact = k.classifyEgress(m.since().egress);
      weekly.push({
        day: d + 1,
        asks: { created: a.created, open: a.open, byStatus: a.byStatus, distinct: a.distinctSummaries, openMinutes: a.openMinutes },
        needsYou: v.needsYou,
        briefNeeded: v.brief?.neededLine,
        briefWord: v.brief?.theWord,
        pendingActions: v.pendingActions.length,
        dispatches: await k.q("select status, count(*)::int n from solene_dispatch_queue group by 1"),
        published: await k.q("select count(*)::int n from marketing_artifacts"),
        pages: contact.pages.length,
        emails: contact.emails.length,
        ledger: v.control?.ledger?.map((l: any) => `${l.domain}:${l.level}:${l.cleanCycleCount}`),
      });
      console.log(`  day ${d + 1}: asks created=${a.created} open=${a.open} pages=${contact.pages.length} emails=${contact.emails.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
  }
  const s = m.since();
  const contact = k.classifyEgress(s.egress);
  const ticks = allLogs.filter((l) => l.name === "solene_continuous_tick");
  const tickOutcomes = ticks.reduce((acc: Record<string, number>, l: any) => {
    const key = `${l.result?.actOutcomeStatus ?? "null"}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const exp = await k.q(`select move_kind, outcome, count(*)::int n from autopilot_experiences group by 1,2 order by 3 desc`);
  const a = await k.askStats();
  const final = await k.founderView();
  const customerReach = contact.emails.filter((e) => !/founder-e2e@acreos\.test/i.test(e.to));

  const vac = [
    k.vacuity(ticks.length >= DAYS * 48 - 2, `${ticks.length} continuous ticks ran (expected ${DAYS * 48})`),
    k.vacuity(ticks.filter((t: any) => t.result?.actOutcomeStatus).length > 0, "ticks routed moves through planAndAct (dispatch on)"),
    k.vacuity(Object.values(final.status).every((s) => s === 200), "all founder surfaces answered 200"),
  ].join("; ");

  const result = {
    variant, days: DAYS, wallSeconds: (Date.now() - t0) / 1000,
    day0Brief: { neededLine: day0.brief?.neededLine, theWord: day0.brief?.theWord, focusLine: day0.brief?.focusLine, quietDay: day0.brief?.quietDay },
    jobSummary: k.jobSummary(allLogs),
    tickOutcomes,
    experiencesByMoveOutcome: exp,
    asks: { created: a.created, open: a.open, byStatus: a.byStatus, byUrgency: a.byUrgency, distinctSummaries: a.distinctSummaries, openDistinct: a.openDistinctSummaries, openDupes: a.openSameSummaryDuplicates, summaries: a.summaries, openMinutes: a.openMinutes },
    dispatchQueue: await k.q("select status, agent_role, source_id, count(*)::int n from solene_dispatch_queue group by 1,2,3"),
    marketingArtifacts: await k.q("select count(*)::int n from marketing_artifacts"),
    communityLetters: await k.q("select count(*)::int n from community_letters"),
    modelCalls: s.modelCalls.length,
    modelCallers: Object.entries(s.modelCalls.reduce((acc: Record<string, number>, c: any) => ((acc[(c.caller ?? "").slice(0, 70)] = (acc[(c.caller ?? "").slice(0, 70)] ?? 0) + 1), acc), {})).sort((x: any, y: any) => y[1] - x[1]).slice(0, 15),
    world: { pages: contact.pages.length, pageTitles: [...new Set(contact.pages.map((p) => p.title))].slice(0, 20), emails: contact.emails, customerReach: customerReach.length, refusedHosts: [...new Set(contact.refused.map((r) => r.host))] },
    weekly,
    finalBrief: { neededLine: final.brief?.neededLine, theWord: final.brief?.theWord, focusLine: final.brief?.focusLine },
    finalNeedsYou: final.needsYou,
    finalLedger: final.control?.ledger,
    vacuity: vac,
  };
  k.saveJson(`s01-${variant}.json`, result);

  const weeks = DAYS / 7;
  const asksPerWeek = a.created / weeks;
  const minutesPerWeek = a.rows.reduce((acc: number, r: any) => acc + k.priceAsk({ answerFormat: r.answer_format, questionBody: r.question_body }), 0) / weeks;
  k.recordEvent({
    scenario: `S1-${variant}`,
    event: "Acquire first customer with $0 (content/SEO/outreach/ads)",
    outcome: customerReach.length > 0 || Number(result.marketingArtifacts[0]?.n ?? 0) > 0 ? "HANDLED" : "ESCALATED",
    founderMinutes: Math.round(minutesPerWeek),
    evidence: `${DAYS}d: ${a.created} asks (${asksPerWeek.toFixed(1)}/wk, ${a.distinctSummaries} distinct summaries), dispatches=${JSON.stringify(result.dispatchQueue)}, marketing_artifacts=${result.marketingArtifacts[0]?.n}, customer-addressed emails=${customerReach.length}, pages=${contact.pages.length}, tick outcomes=${JSON.stringify(tickOutcomes)}`,
    vacuity: vac,
  });
  console.log(JSON.stringify({ asks: result.asks.byStatus, tickOutcomes, pages: contact.pages.length, emails: contact.emails.length, customerReach: customerReach.length }));
  await k.shutdown();
}
main().catch(async (e) => { console.error(e); process.exit(1); });
