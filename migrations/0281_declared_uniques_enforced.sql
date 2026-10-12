-- 0281 — the unique constraints shared/schema declares that no DDL in this
-- repository ever created (column-level `.unique()`, Drizzle's default
-- `<table>_<column>_unique` name: a UNIQUE CONSTRAINT, NULLs distinct).
-- scripts/check-constraint-names.ts listed these 17 as MISSING in
-- scripts/constraint-names.allowlist.json: a database built from this repo
-- enforced none of them, and an ON CONFLICT (model_id) on
-- openrouter_model_catalog had no arbiter at all.
--
-- One block per constraint. Each one:
--   - does nothing if the table or column is absent, or if a relation or
--     constraint with the declared name already exists (a drizzle-push
--     database has them; re-running is a no-op);
--   - counts duplicate NON-NULL key groups; if there are any it changes no
--     row and does not fail: it RAISEs a WARNING naming the table, the
--     constraint and the count, and skips (repeated on every deploy until the
--     duplicates are resolved by hand). This runs as the release command, so
--     a data problem must never block a deploy;
--   - otherwise adds the constraint, waiting at most 5s for the table lock; a
--     lock timeout or a racing duplicate is a WARNING and a skip, not a failure.
--
-- Mirrors the matching block in scripts/migrate.mjs (text identical, pinned by
-- tests/unit/declaredUniquesMigration.test.ts). Idempotent.
DO $mig0281$
DECLARE
  dupes bigint;
  prior_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF to_regclass('"agent_spawn_proposals"') IS NULL THEN
    RAISE NOTICE '[uniq-0281] agent_spawn_proposals: table absent, agent_spawn_proposals_proposal_id_unique skipped';
    RETURN;
  END IF;
  IF to_regclass('"agent_spawn_proposals_proposal_id_unique"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('"agent_spawn_proposals"') AND conname = 'agent_spawn_proposals_proposal_id_unique') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"agent_spawn_proposals"') AND attname = 'proposal_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] agent_spawn_proposals: column proposal_id absent, agent_spawn_proposals_proposal_id_unique skipped';
    RETURN;
  END IF;
  SELECT count(*) INTO dupes
    FROM (SELECT "proposal_id" FROM "agent_spawn_proposals" WHERE "proposal_id" IS NOT NULL GROUP BY "proposal_id" HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE WARNING '[uniq-0281] agent_spawn_proposals: % duplicate non-null key group(s) on proposal_id; constraint agent_spawn_proposals_proposal_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    ALTER TABLE "agent_spawn_proposals" ADD CONSTRAINT "agent_spawn_proposals_proposal_id_unique" UNIQUE ("proposal_id");
    PERFORM set_config('lock_timeout', prior_lock_timeout, true);
  EXCEPTION WHEN unique_violation OR lock_not_available THEN
    RAISE WARNING '[uniq-0281] agent_spawn_proposals: constraint agent_spawn_proposals_proposal_id_unique NOT created (%), no rows changed. It is retried on the next deploy.', SQLERRM;
  END;
END
$mig0281$;

DO $mig0281$
DECLARE
  dupes bigint;
  prior_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF to_regclass('"board_decisions"') IS NULL THEN
    RAISE NOTICE '[uniq-0281] board_decisions: table absent, board_decisions_decision_id_unique skipped';
    RETURN;
  END IF;
  IF to_regclass('"board_decisions_decision_id_unique"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('"board_decisions"') AND conname = 'board_decisions_decision_id_unique') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"board_decisions"') AND attname = 'decision_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] board_decisions: column decision_id absent, board_decisions_decision_id_unique skipped';
    RETURN;
  END IF;
  SELECT count(*) INTO dupes
    FROM (SELECT "decision_id" FROM "board_decisions" WHERE "decision_id" IS NOT NULL GROUP BY "decision_id" HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE WARNING '[uniq-0281] board_decisions: % duplicate non-null key group(s) on decision_id; constraint board_decisions_decision_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    ALTER TABLE "board_decisions" ADD CONSTRAINT "board_decisions_decision_id_unique" UNIQUE ("decision_id");
    PERFORM set_config('lock_timeout', prior_lock_timeout, true);
  EXCEPTION WHEN unique_violation OR lock_not_available THEN
    RAISE WARNING '[uniq-0281] board_decisions: constraint board_decisions_decision_id_unique NOT created (%), no rows changed. It is retried on the next deploy.', SQLERRM;
  END;
END
$mig0281$;

DO $mig0281$
DECLARE
  dupes bigint;
  prior_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF to_regclass('"board_meetings"') IS NULL THEN
    RAISE NOTICE '[uniq-0281] board_meetings: table absent, board_meetings_meeting_id_unique skipped';
    RETURN;
  END IF;
  IF to_regclass('"board_meetings_meeting_id_unique"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('"board_meetings"') AND conname = 'board_meetings_meeting_id_unique') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"board_meetings"') AND attname = 'meeting_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] board_meetings: column meeting_id absent, board_meetings_meeting_id_unique skipped';
    RETURN;
  END IF;
  SELECT count(*) INTO dupes
    FROM (SELECT "meeting_id" FROM "board_meetings" WHERE "meeting_id" IS NOT NULL GROUP BY "meeting_id" HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE WARNING '[uniq-0281] board_meetings: % duplicate non-null key group(s) on meeting_id; constraint board_meetings_meeting_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    ALTER TABLE "board_meetings" ADD CONSTRAINT "board_meetings_meeting_id_unique" UNIQUE ("meeting_id");
    PERFORM set_config('lock_timeout', prior_lock_timeout, true);
  EXCEPTION WHEN unique_violation OR lock_not_available THEN
    RAISE WARNING '[uniq-0281] board_meetings: constraint board_meetings_meeting_id_unique NOT created (%), no rows changed. It is retried on the next deploy.', SQLERRM;
  END;
END
$mig0281$;

DO $mig0281$
DECLARE
  dupes bigint;
  prior_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF to_regclass('"cascade_resolutions"') IS NULL THEN
    RAISE NOTICE '[uniq-0281] cascade_resolutions: table absent, cascade_resolutions_resolution_id_unique skipped';
    RETURN;
  END IF;
  IF to_regclass('"cascade_resolutions_resolution_id_unique"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('"cascade_resolutions"') AND conname = 'cascade_resolutions_resolution_id_unique') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"cascade_resolutions"') AND attname = 'resolution_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] cascade_resolutions: column resolution_id absent, cascade_resolutions_resolution_id_unique skipped';
    RETURN;
  END IF;
  SELECT count(*) INTO dupes
    FROM (SELECT "resolution_id" FROM "cascade_resolutions" WHERE "resolution_id" IS NOT NULL GROUP BY "resolution_id" HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE WARNING '[uniq-0281] cascade_resolutions: % duplicate non-null key group(s) on resolution_id; constraint cascade_resolutions_resolution_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    ALTER TABLE "cascade_resolutions" ADD CONSTRAINT "cascade_resolutions_resolution_id_unique" UNIQUE ("resolution_id");
    PERFORM set_config('lock_timeout', prior_lock_timeout, true);
  EXCEPTION WHEN unique_violation OR lock_not_available THEN
    RAISE WARNING '[uniq-0281] cascade_resolutions: constraint cascade_resolutions_resolution_id_unique NOT created (%), no rows changed. It is retried on the next deploy.', SQLERRM;
  END;
END
$mig0281$;

DO $mig0281$
DECLARE
  dupes bigint;
  prior_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF to_regclass('"company_agents"') IS NULL THEN
    RAISE NOTICE '[uniq-0281] company_agents: table absent, company_agents_codename_unique skipped';
    RETURN;
  END IF;
  IF to_regclass('"company_agents_codename_unique"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('"company_agents"') AND conname = 'company_agents_codename_unique') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"company_agents"') AND attname = 'codename' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] company_agents: column codename absent, company_agents_codename_unique skipped';
    RETURN;
  END IF;
  SELECT count(*) INTO dupes
    FROM (SELECT "codename" FROM "company_agents" WHERE "codename" IS NOT NULL GROUP BY "codename" HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE WARNING '[uniq-0281] company_agents: % duplicate non-null key group(s) on codename; constraint company_agents_codename_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    ALTER TABLE "company_agents" ADD CONSTRAINT "company_agents_codename_unique" UNIQUE ("codename");
    PERFORM set_config('lock_timeout', prior_lock_timeout, true);
  EXCEPTION WHEN unique_violation OR lock_not_available THEN
    RAISE WARNING '[uniq-0281] company_agents: constraint company_agents_codename_unique NOT created (%), no rows changed. It is retried on the next deploy.', SQLERRM;
  END;
END
$mig0281$;

DO $mig0281$
DECLARE
  dupes bigint;
  prior_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF to_regclass('"constitutional_principles"') IS NULL THEN
    RAISE NOTICE '[uniq-0281] constitutional_principles: table absent, constitutional_principles_principle_id_unique skipped';
    RETURN;
  END IF;
  IF to_regclass('"constitutional_principles_principle_id_unique"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('"constitutional_principles"') AND conname = 'constitutional_principles_principle_id_unique') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"constitutional_principles"') AND attname = 'principle_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] constitutional_principles: column principle_id absent, constitutional_principles_principle_id_unique skipped';
    RETURN;
  END IF;
  SELECT count(*) INTO dupes
    FROM (SELECT "principle_id" FROM "constitutional_principles" WHERE "principle_id" IS NOT NULL GROUP BY "principle_id" HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE WARNING '[uniq-0281] constitutional_principles: % duplicate non-null key group(s) on principle_id; constraint constitutional_principles_principle_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    ALTER TABLE "constitutional_principles" ADD CONSTRAINT "constitutional_principles_principle_id_unique" UNIQUE ("principle_id");
    PERFORM set_config('lock_timeout', prior_lock_timeout, true);
  EXCEPTION WHEN unique_violation OR lock_not_available THEN
    RAISE WARNING '[uniq-0281] constitutional_principles: constraint constitutional_principles_principle_id_unique NOT created (%), no rows changed. It is retried on the next deploy.', SQLERRM;
  END;
END
$mig0281$;

DO $mig0281$
DECLARE
  dupes bigint;
  prior_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF to_regclass('"contract_templates"') IS NULL THEN
    RAISE NOTICE '[uniq-0281] contract_templates: table absent, contract_templates_template_id_unique skipped';
    RETURN;
  END IF;
  IF to_regclass('"contract_templates_template_id_unique"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('"contract_templates"') AND conname = 'contract_templates_template_id_unique') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"contract_templates"') AND attname = 'template_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] contract_templates: column template_id absent, contract_templates_template_id_unique skipped';
    RETURN;
  END IF;
  SELECT count(*) INTO dupes
    FROM (SELECT "template_id" FROM "contract_templates" WHERE "template_id" IS NOT NULL GROUP BY "template_id" HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE WARNING '[uniq-0281] contract_templates: % duplicate non-null key group(s) on template_id; constraint contract_templates_template_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_template_id_unique" UNIQUE ("template_id");
    PERFORM set_config('lock_timeout', prior_lock_timeout, true);
  EXCEPTION WHEN unique_violation OR lock_not_available THEN
    RAISE WARNING '[uniq-0281] contract_templates: constraint contract_templates_template_id_unique NOT created (%), no rows changed. It is retried on the next deploy.', SQLERRM;
  END;
END
$mig0281$;

DO $mig0281$
DECLARE
  dupes bigint;
  prior_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF to_regclass('"feedback_learnings"') IS NULL THEN
    RAISE NOTICE '[uniq-0281] feedback_learnings: table absent, feedback_learnings_learning_id_unique skipped';
    RETURN;
  END IF;
  IF to_regclass('"feedback_learnings_learning_id_unique"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('"feedback_learnings"') AND conname = 'feedback_learnings_learning_id_unique') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"feedback_learnings"') AND attname = 'learning_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] feedback_learnings: column learning_id absent, feedback_learnings_learning_id_unique skipped';
    RETURN;
  END IF;
  SELECT count(*) INTO dupes
    FROM (SELECT "learning_id" FROM "feedback_learnings" WHERE "learning_id" IS NOT NULL GROUP BY "learning_id" HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE WARNING '[uniq-0281] feedback_learnings: % duplicate non-null key group(s) on learning_id; constraint feedback_learnings_learning_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    ALTER TABLE "feedback_learnings" ADD CONSTRAINT "feedback_learnings_learning_id_unique" UNIQUE ("learning_id");
    PERFORM set_config('lock_timeout', prior_lock_timeout, true);
  EXCEPTION WHEN unique_violation OR lock_not_available THEN
    RAISE WARNING '[uniq-0281] feedback_learnings: constraint feedback_learnings_learning_id_unique NOT created (%), no rows changed. It is retried on the next deploy.', SQLERRM;
  END;
END
$mig0281$;

DO $mig0281$
DECLARE
  dupes bigint;
  prior_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF to_regclass('"financial_approvals"') IS NULL THEN
    RAISE NOTICE '[uniq-0281] financial_approvals: table absent, financial_approvals_request_id_unique skipped';
    RETURN;
  END IF;
  IF to_regclass('"financial_approvals_request_id_unique"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('"financial_approvals"') AND conname = 'financial_approvals_request_id_unique') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"financial_approvals"') AND attname = 'request_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] financial_approvals: column request_id absent, financial_approvals_request_id_unique skipped';
    RETURN;
  END IF;
  SELECT count(*) INTO dupes
    FROM (SELECT "request_id" FROM "financial_approvals" WHERE "request_id" IS NOT NULL GROUP BY "request_id" HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE WARNING '[uniq-0281] financial_approvals: % duplicate non-null key group(s) on request_id; constraint financial_approvals_request_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    ALTER TABLE "financial_approvals" ADD CONSTRAINT "financial_approvals_request_id_unique" UNIQUE ("request_id");
    PERFORM set_config('lock_timeout', prior_lock_timeout, true);
  EXCEPTION WHEN unique_violation OR lock_not_available THEN
    RAISE WARNING '[uniq-0281] financial_approvals: constraint financial_approvals_request_id_unique NOT created (%), no rows changed. It is retried on the next deploy.', SQLERRM;
  END;
END
$mig0281$;

DO $mig0281$
DECLARE
  dupes bigint;
  prior_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF to_regclass('"founder_dependency_events"') IS NULL THEN
    RAISE NOTICE '[uniq-0281] founder_dependency_events: table absent, founder_dependency_events_event_id_unique skipped';
    RETURN;
  END IF;
  IF to_regclass('"founder_dependency_events_event_id_unique"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('"founder_dependency_events"') AND conname = 'founder_dependency_events_event_id_unique') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"founder_dependency_events"') AND attname = 'event_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] founder_dependency_events: column event_id absent, founder_dependency_events_event_id_unique skipped';
    RETURN;
  END IF;
  SELECT count(*) INTO dupes
    FROM (SELECT "event_id" FROM "founder_dependency_events" WHERE "event_id" IS NOT NULL GROUP BY "event_id" HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE WARNING '[uniq-0281] founder_dependency_events: % duplicate non-null key group(s) on event_id; constraint founder_dependency_events_event_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    ALTER TABLE "founder_dependency_events" ADD CONSTRAINT "founder_dependency_events_event_id_unique" UNIQUE ("event_id");
    PERFORM set_config('lock_timeout', prior_lock_timeout, true);
  EXCEPTION WHEN unique_violation OR lock_not_available THEN
    RAISE WARNING '[uniq-0281] founder_dependency_events: constraint founder_dependency_events_event_id_unique NOT created (%), no rows changed. It is retried on the next deploy.', SQLERRM;
  END;
END
$mig0281$;

DO $mig0281$
DECLARE
  dupes bigint;
  prior_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF to_regclass('"founder_overrides"') IS NULL THEN
    RAISE NOTICE '[uniq-0281] founder_overrides: table absent, founder_overrides_override_id_unique skipped';
    RETURN;
  END IF;
  IF to_regclass('"founder_overrides_override_id_unique"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('"founder_overrides"') AND conname = 'founder_overrides_override_id_unique') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"founder_overrides"') AND attname = 'override_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] founder_overrides: column override_id absent, founder_overrides_override_id_unique skipped';
    RETURN;
  END IF;
  SELECT count(*) INTO dupes
    FROM (SELECT "override_id" FROM "founder_overrides" WHERE "override_id" IS NOT NULL GROUP BY "override_id" HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE WARNING '[uniq-0281] founder_overrides: % duplicate non-null key group(s) on override_id; constraint founder_overrides_override_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    ALTER TABLE "founder_overrides" ADD CONSTRAINT "founder_overrides_override_id_unique" UNIQUE ("override_id");
    PERFORM set_config('lock_timeout', prior_lock_timeout, true);
  EXCEPTION WHEN unique_violation OR lock_not_available THEN
    RAISE WARNING '[uniq-0281] founder_overrides: constraint founder_overrides_override_id_unique NOT created (%), no rows changed. It is retried on the next deploy.', SQLERRM;
  END;
END
$mig0281$;

DO $mig0281$
DECLARE
  dupes bigint;
  prior_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF to_regclass('"legal_actions"') IS NULL THEN
    RAISE NOTICE '[uniq-0281] legal_actions: table absent, legal_actions_action_id_unique skipped';
    RETURN;
  END IF;
  IF to_regclass('"legal_actions_action_id_unique"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('"legal_actions"') AND conname = 'legal_actions_action_id_unique') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"legal_actions"') AND attname = 'action_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] legal_actions: column action_id absent, legal_actions_action_id_unique skipped';
    RETURN;
  END IF;
  SELECT count(*) INTO dupes
    FROM (SELECT "action_id" FROM "legal_actions" WHERE "action_id" IS NOT NULL GROUP BY "action_id" HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE WARNING '[uniq-0281] legal_actions: % duplicate non-null key group(s) on action_id; constraint legal_actions_action_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    ALTER TABLE "legal_actions" ADD CONSTRAINT "legal_actions_action_id_unique" UNIQUE ("action_id");
    PERFORM set_config('lock_timeout', prior_lock_timeout, true);
  EXCEPTION WHEN unique_violation OR lock_not_available THEN
    RAISE WARNING '[uniq-0281] legal_actions: constraint legal_actions_action_id_unique NOT created (%), no rows changed. It is retried on the next deploy.', SQLERRM;
  END;
END
$mig0281$;

DO $mig0281$
DECLARE
  dupes bigint;
  prior_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF to_regclass('"meta_learning_insights"') IS NULL THEN
    RAISE NOTICE '[uniq-0281] meta_learning_insights: table absent, meta_learning_insights_insight_id_unique skipped';
    RETURN;
  END IF;
  IF to_regclass('"meta_learning_insights_insight_id_unique"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('"meta_learning_insights"') AND conname = 'meta_learning_insights_insight_id_unique') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"meta_learning_insights"') AND attname = 'insight_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] meta_learning_insights: column insight_id absent, meta_learning_insights_insight_id_unique skipped';
    RETURN;
  END IF;
  SELECT count(*) INTO dupes
    FROM (SELECT "insight_id" FROM "meta_learning_insights" WHERE "insight_id" IS NOT NULL GROUP BY "insight_id" HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE WARNING '[uniq-0281] meta_learning_insights: % duplicate non-null key group(s) on insight_id; constraint meta_learning_insights_insight_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    ALTER TABLE "meta_learning_insights" ADD CONSTRAINT "meta_learning_insights_insight_id_unique" UNIQUE ("insight_id");
    PERFORM set_config('lock_timeout', prior_lock_timeout, true);
  EXCEPTION WHEN unique_violation OR lock_not_available THEN
    RAISE WARNING '[uniq-0281] meta_learning_insights: constraint meta_learning_insights_insight_id_unique NOT created (%), no rows changed. It is retried on the next deploy.', SQLERRM;
  END;
END
$mig0281$;

DO $mig0281$
DECLARE
  dupes bigint;
  prior_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF to_regclass('"openrouter_model_catalog"') IS NULL THEN
    RAISE NOTICE '[uniq-0281] openrouter_model_catalog: table absent, openrouter_model_catalog_model_id_unique skipped';
    RETURN;
  END IF;
  IF to_regclass('"openrouter_model_catalog_model_id_unique"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('"openrouter_model_catalog"') AND conname = 'openrouter_model_catalog_model_id_unique') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"openrouter_model_catalog"') AND attname = 'model_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] openrouter_model_catalog: column model_id absent, openrouter_model_catalog_model_id_unique skipped';
    RETURN;
  END IF;
  SELECT count(*) INTO dupes
    FROM (SELECT "model_id" FROM "openrouter_model_catalog" WHERE "model_id" IS NOT NULL GROUP BY "model_id" HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE WARNING '[uniq-0281] openrouter_model_catalog: % duplicate non-null key group(s) on model_id; constraint openrouter_model_catalog_model_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    ALTER TABLE "openrouter_model_catalog" ADD CONSTRAINT "openrouter_model_catalog_model_id_unique" UNIQUE ("model_id");
    PERFORM set_config('lock_timeout', prior_lock_timeout, true);
  EXCEPTION WHEN unique_violation OR lock_not_available THEN
    RAISE WARNING '[uniq-0281] openrouter_model_catalog: constraint openrouter_model_catalog_model_id_unique NOT created (%), no rows changed. It is retried on the next deploy.', SQLERRM;
  END;
END
$mig0281$;

DO $mig0281$
DECLARE
  dupes bigint;
  prior_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF to_regclass('"reaction_chain_runs"') IS NULL THEN
    RAISE NOTICE '[uniq-0281] reaction_chain_runs: table absent, reaction_chain_runs_run_id_unique skipped';
    RETURN;
  END IF;
  IF to_regclass('"reaction_chain_runs_run_id_unique"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('"reaction_chain_runs"') AND conname = 'reaction_chain_runs_run_id_unique') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"reaction_chain_runs"') AND attname = 'run_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] reaction_chain_runs: column run_id absent, reaction_chain_runs_run_id_unique skipped';
    RETURN;
  END IF;
  SELECT count(*) INTO dupes
    FROM (SELECT "run_id" FROM "reaction_chain_runs" WHERE "run_id" IS NOT NULL GROUP BY "run_id" HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE WARNING '[uniq-0281] reaction_chain_runs: % duplicate non-null key group(s) on run_id; constraint reaction_chain_runs_run_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    ALTER TABLE "reaction_chain_runs" ADD CONSTRAINT "reaction_chain_runs_run_id_unique" UNIQUE ("run_id");
    PERFORM set_config('lock_timeout', prior_lock_timeout, true);
  EXCEPTION WHEN unique_violation OR lock_not_available THEN
    RAISE WARNING '[uniq-0281] reaction_chain_runs: constraint reaction_chain_runs_run_id_unique NOT created (%), no rows changed. It is retried on the next deploy.', SQLERRM;
  END;
END
$mig0281$;

DO $mig0281$
DECLARE
  dupes bigint;
  prior_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF to_regclass('"shared_deal_links"') IS NULL THEN
    RAISE NOTICE '[uniq-0281] shared_deal_links: table absent, shared_deal_links_token_unique skipped';
    RETURN;
  END IF;
  IF to_regclass('"shared_deal_links_token_unique"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('"shared_deal_links"') AND conname = 'shared_deal_links_token_unique') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"shared_deal_links"') AND attname = 'token' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] shared_deal_links: column token absent, shared_deal_links_token_unique skipped';
    RETURN;
  END IF;
  SELECT count(*) INTO dupes
    FROM (SELECT "token" FROM "shared_deal_links" WHERE "token" IS NOT NULL GROUP BY "token" HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE WARNING '[uniq-0281] shared_deal_links: % duplicate non-null key group(s) on token; constraint shared_deal_links_token_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    ALTER TABLE "shared_deal_links" ADD CONSTRAINT "shared_deal_links_token_unique" UNIQUE ("token");
    PERFORM set_config('lock_timeout', prior_lock_timeout, true);
  EXCEPTION WHEN unique_violation OR lock_not_available THEN
    RAISE WARNING '[uniq-0281] shared_deal_links: constraint shared_deal_links_token_unique NOT created (%), no rows changed. It is retried on the next deploy.', SQLERRM;
  END;
END
$mig0281$;

DO $mig0281$
DECLARE
  dupes bigint;
  prior_lock_timeout text := current_setting('lock_timeout');
BEGIN
  IF to_regclass('"strategic_plans"') IS NULL THEN
    RAISE NOTICE '[uniq-0281] strategic_plans: table absent, strategic_plans_plan_id_unique skipped';
    RETURN;
  END IF;
  IF to_regclass('"strategic_plans_plan_id_unique"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('"strategic_plans"') AND conname = 'strategic_plans_plan_id_unique') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"strategic_plans"') AND attname = 'plan_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] strategic_plans: column plan_id absent, strategic_plans_plan_id_unique skipped';
    RETURN;
  END IF;
  SELECT count(*) INTO dupes
    FROM (SELECT "plan_id" FROM "strategic_plans" WHERE "plan_id" IS NOT NULL GROUP BY "plan_id" HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE WARNING '[uniq-0281] strategic_plans: % duplicate non-null key group(s) on plan_id; constraint strategic_plans_plan_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    ALTER TABLE "strategic_plans" ADD CONSTRAINT "strategic_plans_plan_id_unique" UNIQUE ("plan_id");
    PERFORM set_config('lock_timeout', prior_lock_timeout, true);
  EXCEPTION WHEN unique_violation OR lock_not_available THEN
    RAISE WARNING '[uniq-0281] strategic_plans: constraint strategic_plans_plan_id_unique NOT created (%), no rows changed. It is retried on the next deploy.', SQLERRM;
  END;
END
$mig0281$;
