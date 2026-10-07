-- Remove the residue scripts/ci/build-schema-from-repo.sh's own DB checks
-- leave behind (steps 5-8 write a panic stop, pages, an incident, a grant,
-- pending hands, traces …). A simulated business must start from an empty
-- runtime history: the founder's Letter on day 1 must not report a test's
-- panic stop. Reference data the migrations seed (rules, flags, templates)
-- is kept. Simulation databases only.
do $$ begin
  if current_database() !~ '^acreos_simplat' then raise exception 'template clean refuses database %', current_database(); end if;
end $$;
truncate table proof_receipts, system_activity, solene_page_events, job_health_logs, autopilot_pending_actions,
  witness_grants, incidents, agent_llm_traces, solene_decision_score_events, worker_heartbeat, domain_autonomy_levels,
  solene_founder_asks, solene_dispatch_queue, solene_dispatch_results, autopilot_settings, organizations, users, team_members
  restart identity cascade;
