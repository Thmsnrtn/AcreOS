import * as k from "./simkit";
async function main() {
  await k.resetWorld(); await k.bootSeed(); k.resetSimClock();
  k.setEgressRules(k.PROVIDERS_UP);
  k.setStandinRules({ default: "script" });
  await k.setSwitch("dispatchEnabled", true);
  const jobs = await k.defaultJobs();
  const m = k.marks();
  const t0 = Date.now();
  const log = await k.advance(24, jobs);
  console.log("wall s", (Date.now() - t0) / 1000);
  console.log(JSON.stringify(k.jobSummary(log), null, 1));
  const s = m.since();
  console.log("model calls", s.modelCalls.length, "egress", JSON.stringify(s.egress.map((e: any) => `${e.role}:${e.host}${e.path ?? ""}:${e.outcome}`)));
  console.log("asks", JSON.stringify(await k.q("select id, status, urgency, question_summary from solene_founder_asks order by id")));
  console.log("dispatch", JSON.stringify(await k.q("select id, status, agent_role, source_id from solene_dispatch_queue")));
  console.log("jhl", JSON.stringify(await k.q("select job_name, status, count(*) from job_health_logs group by 1,2 order by 1")));
  console.log("ticks", JSON.stringify(log.filter((l) => l.name === "solene_continuous_tick").map((l: any) => l.result?.actOutcomeStatus + "/" + (l.result?.plannedTopMove ?? "")).slice(0, 48)));
  await k.shutdown();
}
main().catch((e) => { console.error(e); process.exit(1); });
