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
--     database has them; re-running is a no-op) -- but WARNS if that name is
--     not a unique constraint/index on exactly the declared column;
--   - sets lock_timeout = 5s BEFORE reading the table, so neither the
--     duplicate count nor the ALTER can wait indefinitely on a held lock
--     (statement_timeout is not set here: inside a DO block it does not
--     apply to the block's own statements, measured on PostgreSQL 16);
--   - counts duplicate NON-NULL key groups; if there are any it changes no
--     row and does not fail: it RAISEs a WARNING naming the table, the
--     constraint and the count, and skips (repeated on every deploy until the
--     duplicates are resolved by hand);
--   - otherwise adds the constraint.
--   Any error in the count or the ALTER (lock timeout, a racing duplicate, a
--   cancelled statement, insufficient privilege, deadlock, ...) is caught and
--   becomes the same WARNING + skip. This runs as the release command, so
--   nothing here may block a deploy.
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
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
       WHERE x.indrelid = to_regclass('"agent_spawn_proposals"') AND i.relname = 'agent_spawn_proposals_proposal_id_unique'
         AND x.indisunique AND x.indnkeyatts = 1 AND a.attname = 'proposal_id'
         AND (x.indpred IS NULL OR pg_get_expr(x.indpred, x.indrelid) = '(proposal_id IS NOT NULL)')
    ) THEN
      RAISE WARNING '[uniq-0281] agent_spawn_proposals: a relation named agent_spawn_proposals_proposal_id_unique exists but is not a unique constraint/index on (proposal_id); uniqueness is NOT enforced. Resolve by hand.';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"agent_spawn_proposals"') AND attname = 'proposal_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] agent_spawn_proposals: column proposal_id absent, agent_spawn_proposals_proposal_id_unique skipped';
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  BEGIN
    SELECT count(*) INTO dupes
      FROM (SELECT "proposal_id" FROM "agent_spawn_proposals" WHERE "proposal_id" IS NOT NULL GROUP BY "proposal_id" HAVING count(*) > 1) d;
    IF dupes > 0 THEN
      RAISE WARNING '[uniq-0281] agent_spawn_proposals: % duplicate non-null key group(s) on proposal_id; constraint agent_spawn_proposals_proposal_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    ELSE
      ALTER TABLE "agent_spawn_proposals" ADD CONSTRAINT "agent_spawn_proposals_proposal_id_unique" UNIQUE ("proposal_id");
    END IF;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING '[uniq-0281] agent_spawn_proposals: constraint agent_spawn_proposals_proposal_id_unique NOT created (% %), no rows changed. It is retried on the next deploy.', SQLSTATE, SQLERRM;
  END;
  PERFORM set_config('lock_timeout', prior_lock_timeout, true);
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
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
       WHERE x.indrelid = to_regclass('"board_decisions"') AND i.relname = 'board_decisions_decision_id_unique'
         AND x.indisunique AND x.indnkeyatts = 1 AND a.attname = 'decision_id'
         AND (x.indpred IS NULL OR pg_get_expr(x.indpred, x.indrelid) = '(decision_id IS NOT NULL)')
    ) THEN
      RAISE WARNING '[uniq-0281] board_decisions: a relation named board_decisions_decision_id_unique exists but is not a unique constraint/index on (decision_id); uniqueness is NOT enforced. Resolve by hand.';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"board_decisions"') AND attname = 'decision_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] board_decisions: column decision_id absent, board_decisions_decision_id_unique skipped';
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  BEGIN
    SELECT count(*) INTO dupes
      FROM (SELECT "decision_id" FROM "board_decisions" WHERE "decision_id" IS NOT NULL GROUP BY "decision_id" HAVING count(*) > 1) d;
    IF dupes > 0 THEN
      RAISE WARNING '[uniq-0281] board_decisions: % duplicate non-null key group(s) on decision_id; constraint board_decisions_decision_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    ELSE
      ALTER TABLE "board_decisions" ADD CONSTRAINT "board_decisions_decision_id_unique" UNIQUE ("decision_id");
    END IF;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING '[uniq-0281] board_decisions: constraint board_decisions_decision_id_unique NOT created (% %), no rows changed. It is retried on the next deploy.', SQLSTATE, SQLERRM;
  END;
  PERFORM set_config('lock_timeout', prior_lock_timeout, true);
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
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
       WHERE x.indrelid = to_regclass('"board_meetings"') AND i.relname = 'board_meetings_meeting_id_unique'
         AND x.indisunique AND x.indnkeyatts = 1 AND a.attname = 'meeting_id'
         AND (x.indpred IS NULL OR pg_get_expr(x.indpred, x.indrelid) = '(meeting_id IS NOT NULL)')
    ) THEN
      RAISE WARNING '[uniq-0281] board_meetings: a relation named board_meetings_meeting_id_unique exists but is not a unique constraint/index on (meeting_id); uniqueness is NOT enforced. Resolve by hand.';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"board_meetings"') AND attname = 'meeting_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] board_meetings: column meeting_id absent, board_meetings_meeting_id_unique skipped';
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  BEGIN
    SELECT count(*) INTO dupes
      FROM (SELECT "meeting_id" FROM "board_meetings" WHERE "meeting_id" IS NOT NULL GROUP BY "meeting_id" HAVING count(*) > 1) d;
    IF dupes > 0 THEN
      RAISE WARNING '[uniq-0281] board_meetings: % duplicate non-null key group(s) on meeting_id; constraint board_meetings_meeting_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    ELSE
      ALTER TABLE "board_meetings" ADD CONSTRAINT "board_meetings_meeting_id_unique" UNIQUE ("meeting_id");
    END IF;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING '[uniq-0281] board_meetings: constraint board_meetings_meeting_id_unique NOT created (% %), no rows changed. It is retried on the next deploy.', SQLSTATE, SQLERRM;
  END;
  PERFORM set_config('lock_timeout', prior_lock_timeout, true);
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
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
       WHERE x.indrelid = to_regclass('"cascade_resolutions"') AND i.relname = 'cascade_resolutions_resolution_id_unique'
         AND x.indisunique AND x.indnkeyatts = 1 AND a.attname = 'resolution_id'
         AND (x.indpred IS NULL OR pg_get_expr(x.indpred, x.indrelid) = '(resolution_id IS NOT NULL)')
    ) THEN
      RAISE WARNING '[uniq-0281] cascade_resolutions: a relation named cascade_resolutions_resolution_id_unique exists but is not a unique constraint/index on (resolution_id); uniqueness is NOT enforced. Resolve by hand.';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"cascade_resolutions"') AND attname = 'resolution_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] cascade_resolutions: column resolution_id absent, cascade_resolutions_resolution_id_unique skipped';
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  BEGIN
    SELECT count(*) INTO dupes
      FROM (SELECT "resolution_id" FROM "cascade_resolutions" WHERE "resolution_id" IS NOT NULL GROUP BY "resolution_id" HAVING count(*) > 1) d;
    IF dupes > 0 THEN
      RAISE WARNING '[uniq-0281] cascade_resolutions: % duplicate non-null key group(s) on resolution_id; constraint cascade_resolutions_resolution_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    ELSE
      ALTER TABLE "cascade_resolutions" ADD CONSTRAINT "cascade_resolutions_resolution_id_unique" UNIQUE ("resolution_id");
    END IF;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING '[uniq-0281] cascade_resolutions: constraint cascade_resolutions_resolution_id_unique NOT created (% %), no rows changed. It is retried on the next deploy.', SQLSTATE, SQLERRM;
  END;
  PERFORM set_config('lock_timeout', prior_lock_timeout, true);
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
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
       WHERE x.indrelid = to_regclass('"company_agents"') AND i.relname = 'company_agents_codename_unique'
         AND x.indisunique AND x.indnkeyatts = 1 AND a.attname = 'codename'
         AND (x.indpred IS NULL OR pg_get_expr(x.indpred, x.indrelid) = '(codename IS NOT NULL)')
    ) THEN
      RAISE WARNING '[uniq-0281] company_agents: a relation named company_agents_codename_unique exists but is not a unique constraint/index on (codename); uniqueness is NOT enforced. Resolve by hand.';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"company_agents"') AND attname = 'codename' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] company_agents: column codename absent, company_agents_codename_unique skipped';
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  BEGIN
    SELECT count(*) INTO dupes
      FROM (SELECT "codename" FROM "company_agents" WHERE "codename" IS NOT NULL GROUP BY "codename" HAVING count(*) > 1) d;
    IF dupes > 0 THEN
      RAISE WARNING '[uniq-0281] company_agents: % duplicate non-null key group(s) on codename; constraint company_agents_codename_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    ELSE
      ALTER TABLE "company_agents" ADD CONSTRAINT "company_agents_codename_unique" UNIQUE ("codename");
    END IF;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING '[uniq-0281] company_agents: constraint company_agents_codename_unique NOT created (% %), no rows changed. It is retried on the next deploy.', SQLSTATE, SQLERRM;
  END;
  PERFORM set_config('lock_timeout', prior_lock_timeout, true);
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
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
       WHERE x.indrelid = to_regclass('"constitutional_principles"') AND i.relname = 'constitutional_principles_principle_id_unique'
         AND x.indisunique AND x.indnkeyatts = 1 AND a.attname = 'principle_id'
         AND (x.indpred IS NULL OR pg_get_expr(x.indpred, x.indrelid) = '(principle_id IS NOT NULL)')
    ) THEN
      RAISE WARNING '[uniq-0281] constitutional_principles: a relation named constitutional_principles_principle_id_unique exists but is not a unique constraint/index on (principle_id); uniqueness is NOT enforced. Resolve by hand.';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"constitutional_principles"') AND attname = 'principle_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] constitutional_principles: column principle_id absent, constitutional_principles_principle_id_unique skipped';
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  BEGIN
    SELECT count(*) INTO dupes
      FROM (SELECT "principle_id" FROM "constitutional_principles" WHERE "principle_id" IS NOT NULL GROUP BY "principle_id" HAVING count(*) > 1) d;
    IF dupes > 0 THEN
      RAISE WARNING '[uniq-0281] constitutional_principles: % duplicate non-null key group(s) on principle_id; constraint constitutional_principles_principle_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    ELSE
      ALTER TABLE "constitutional_principles" ADD CONSTRAINT "constitutional_principles_principle_id_unique" UNIQUE ("principle_id");
    END IF;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING '[uniq-0281] constitutional_principles: constraint constitutional_principles_principle_id_unique NOT created (% %), no rows changed. It is retried on the next deploy.', SQLSTATE, SQLERRM;
  END;
  PERFORM set_config('lock_timeout', prior_lock_timeout, true);
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
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
       WHERE x.indrelid = to_regclass('"contract_templates"') AND i.relname = 'contract_templates_template_id_unique'
         AND x.indisunique AND x.indnkeyatts = 1 AND a.attname = 'template_id'
         AND (x.indpred IS NULL OR pg_get_expr(x.indpred, x.indrelid) = '(template_id IS NOT NULL)')
    ) THEN
      RAISE WARNING '[uniq-0281] contract_templates: a relation named contract_templates_template_id_unique exists but is not a unique constraint/index on (template_id); uniqueness is NOT enforced. Resolve by hand.';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"contract_templates"') AND attname = 'template_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] contract_templates: column template_id absent, contract_templates_template_id_unique skipped';
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  BEGIN
    SELECT count(*) INTO dupes
      FROM (SELECT "template_id" FROM "contract_templates" WHERE "template_id" IS NOT NULL GROUP BY "template_id" HAVING count(*) > 1) d;
    IF dupes > 0 THEN
      RAISE WARNING '[uniq-0281] contract_templates: % duplicate non-null key group(s) on template_id; constraint contract_templates_template_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    ELSE
      ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_template_id_unique" UNIQUE ("template_id");
    END IF;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING '[uniq-0281] contract_templates: constraint contract_templates_template_id_unique NOT created (% %), no rows changed. It is retried on the next deploy.', SQLSTATE, SQLERRM;
  END;
  PERFORM set_config('lock_timeout', prior_lock_timeout, true);
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
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
       WHERE x.indrelid = to_regclass('"feedback_learnings"') AND i.relname = 'feedback_learnings_learning_id_unique'
         AND x.indisunique AND x.indnkeyatts = 1 AND a.attname = 'learning_id'
         AND (x.indpred IS NULL OR pg_get_expr(x.indpred, x.indrelid) = '(learning_id IS NOT NULL)')
    ) THEN
      RAISE WARNING '[uniq-0281] feedback_learnings: a relation named feedback_learnings_learning_id_unique exists but is not a unique constraint/index on (learning_id); uniqueness is NOT enforced. Resolve by hand.';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"feedback_learnings"') AND attname = 'learning_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] feedback_learnings: column learning_id absent, feedback_learnings_learning_id_unique skipped';
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  BEGIN
    SELECT count(*) INTO dupes
      FROM (SELECT "learning_id" FROM "feedback_learnings" WHERE "learning_id" IS NOT NULL GROUP BY "learning_id" HAVING count(*) > 1) d;
    IF dupes > 0 THEN
      RAISE WARNING '[uniq-0281] feedback_learnings: % duplicate non-null key group(s) on learning_id; constraint feedback_learnings_learning_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    ELSE
      ALTER TABLE "feedback_learnings" ADD CONSTRAINT "feedback_learnings_learning_id_unique" UNIQUE ("learning_id");
    END IF;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING '[uniq-0281] feedback_learnings: constraint feedback_learnings_learning_id_unique NOT created (% %), no rows changed. It is retried on the next deploy.', SQLSTATE, SQLERRM;
  END;
  PERFORM set_config('lock_timeout', prior_lock_timeout, true);
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
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
       WHERE x.indrelid = to_regclass('"financial_approvals"') AND i.relname = 'financial_approvals_request_id_unique'
         AND x.indisunique AND x.indnkeyatts = 1 AND a.attname = 'request_id'
         AND (x.indpred IS NULL OR pg_get_expr(x.indpred, x.indrelid) = '(request_id IS NOT NULL)')
    ) THEN
      RAISE WARNING '[uniq-0281] financial_approvals: a relation named financial_approvals_request_id_unique exists but is not a unique constraint/index on (request_id); uniqueness is NOT enforced. Resolve by hand.';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"financial_approvals"') AND attname = 'request_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] financial_approvals: column request_id absent, financial_approvals_request_id_unique skipped';
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  BEGIN
    SELECT count(*) INTO dupes
      FROM (SELECT "request_id" FROM "financial_approvals" WHERE "request_id" IS NOT NULL GROUP BY "request_id" HAVING count(*) > 1) d;
    IF dupes > 0 THEN
      RAISE WARNING '[uniq-0281] financial_approvals: % duplicate non-null key group(s) on request_id; constraint financial_approvals_request_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    ELSE
      ALTER TABLE "financial_approvals" ADD CONSTRAINT "financial_approvals_request_id_unique" UNIQUE ("request_id");
    END IF;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING '[uniq-0281] financial_approvals: constraint financial_approvals_request_id_unique NOT created (% %), no rows changed. It is retried on the next deploy.', SQLSTATE, SQLERRM;
  END;
  PERFORM set_config('lock_timeout', prior_lock_timeout, true);
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
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
       WHERE x.indrelid = to_regclass('"founder_dependency_events"') AND i.relname = 'founder_dependency_events_event_id_unique'
         AND x.indisunique AND x.indnkeyatts = 1 AND a.attname = 'event_id'
         AND (x.indpred IS NULL OR pg_get_expr(x.indpred, x.indrelid) = '(event_id IS NOT NULL)')
    ) THEN
      RAISE WARNING '[uniq-0281] founder_dependency_events: a relation named founder_dependency_events_event_id_unique exists but is not a unique constraint/index on (event_id); uniqueness is NOT enforced. Resolve by hand.';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"founder_dependency_events"') AND attname = 'event_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] founder_dependency_events: column event_id absent, founder_dependency_events_event_id_unique skipped';
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  BEGIN
    SELECT count(*) INTO dupes
      FROM (SELECT "event_id" FROM "founder_dependency_events" WHERE "event_id" IS NOT NULL GROUP BY "event_id" HAVING count(*) > 1) d;
    IF dupes > 0 THEN
      RAISE WARNING '[uniq-0281] founder_dependency_events: % duplicate non-null key group(s) on event_id; constraint founder_dependency_events_event_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    ELSE
      ALTER TABLE "founder_dependency_events" ADD CONSTRAINT "founder_dependency_events_event_id_unique" UNIQUE ("event_id");
    END IF;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING '[uniq-0281] founder_dependency_events: constraint founder_dependency_events_event_id_unique NOT created (% %), no rows changed. It is retried on the next deploy.', SQLSTATE, SQLERRM;
  END;
  PERFORM set_config('lock_timeout', prior_lock_timeout, true);
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
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
       WHERE x.indrelid = to_regclass('"founder_overrides"') AND i.relname = 'founder_overrides_override_id_unique'
         AND x.indisunique AND x.indnkeyatts = 1 AND a.attname = 'override_id'
         AND (x.indpred IS NULL OR pg_get_expr(x.indpred, x.indrelid) = '(override_id IS NOT NULL)')
    ) THEN
      RAISE WARNING '[uniq-0281] founder_overrides: a relation named founder_overrides_override_id_unique exists but is not a unique constraint/index on (override_id); uniqueness is NOT enforced. Resolve by hand.';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"founder_overrides"') AND attname = 'override_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] founder_overrides: column override_id absent, founder_overrides_override_id_unique skipped';
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  BEGIN
    SELECT count(*) INTO dupes
      FROM (SELECT "override_id" FROM "founder_overrides" WHERE "override_id" IS NOT NULL GROUP BY "override_id" HAVING count(*) > 1) d;
    IF dupes > 0 THEN
      RAISE WARNING '[uniq-0281] founder_overrides: % duplicate non-null key group(s) on override_id; constraint founder_overrides_override_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    ELSE
      ALTER TABLE "founder_overrides" ADD CONSTRAINT "founder_overrides_override_id_unique" UNIQUE ("override_id");
    END IF;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING '[uniq-0281] founder_overrides: constraint founder_overrides_override_id_unique NOT created (% %), no rows changed. It is retried on the next deploy.', SQLSTATE, SQLERRM;
  END;
  PERFORM set_config('lock_timeout', prior_lock_timeout, true);
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
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
       WHERE x.indrelid = to_regclass('"legal_actions"') AND i.relname = 'legal_actions_action_id_unique'
         AND x.indisunique AND x.indnkeyatts = 1 AND a.attname = 'action_id'
         AND (x.indpred IS NULL OR pg_get_expr(x.indpred, x.indrelid) = '(action_id IS NOT NULL)')
    ) THEN
      RAISE WARNING '[uniq-0281] legal_actions: a relation named legal_actions_action_id_unique exists but is not a unique constraint/index on (action_id); uniqueness is NOT enforced. Resolve by hand.';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"legal_actions"') AND attname = 'action_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] legal_actions: column action_id absent, legal_actions_action_id_unique skipped';
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  BEGIN
    SELECT count(*) INTO dupes
      FROM (SELECT "action_id" FROM "legal_actions" WHERE "action_id" IS NOT NULL GROUP BY "action_id" HAVING count(*) > 1) d;
    IF dupes > 0 THEN
      RAISE WARNING '[uniq-0281] legal_actions: % duplicate non-null key group(s) on action_id; constraint legal_actions_action_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    ELSE
      ALTER TABLE "legal_actions" ADD CONSTRAINT "legal_actions_action_id_unique" UNIQUE ("action_id");
    END IF;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING '[uniq-0281] legal_actions: constraint legal_actions_action_id_unique NOT created (% %), no rows changed. It is retried on the next deploy.', SQLSTATE, SQLERRM;
  END;
  PERFORM set_config('lock_timeout', prior_lock_timeout, true);
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
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
       WHERE x.indrelid = to_regclass('"meta_learning_insights"') AND i.relname = 'meta_learning_insights_insight_id_unique'
         AND x.indisunique AND x.indnkeyatts = 1 AND a.attname = 'insight_id'
         AND (x.indpred IS NULL OR pg_get_expr(x.indpred, x.indrelid) = '(insight_id IS NOT NULL)')
    ) THEN
      RAISE WARNING '[uniq-0281] meta_learning_insights: a relation named meta_learning_insights_insight_id_unique exists but is not a unique constraint/index on (insight_id); uniqueness is NOT enforced. Resolve by hand.';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"meta_learning_insights"') AND attname = 'insight_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] meta_learning_insights: column insight_id absent, meta_learning_insights_insight_id_unique skipped';
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  BEGIN
    SELECT count(*) INTO dupes
      FROM (SELECT "insight_id" FROM "meta_learning_insights" WHERE "insight_id" IS NOT NULL GROUP BY "insight_id" HAVING count(*) > 1) d;
    IF dupes > 0 THEN
      RAISE WARNING '[uniq-0281] meta_learning_insights: % duplicate non-null key group(s) on insight_id; constraint meta_learning_insights_insight_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    ELSE
      ALTER TABLE "meta_learning_insights" ADD CONSTRAINT "meta_learning_insights_insight_id_unique" UNIQUE ("insight_id");
    END IF;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING '[uniq-0281] meta_learning_insights: constraint meta_learning_insights_insight_id_unique NOT created (% %), no rows changed. It is retried on the next deploy.', SQLSTATE, SQLERRM;
  END;
  PERFORM set_config('lock_timeout', prior_lock_timeout, true);
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
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
       WHERE x.indrelid = to_regclass('"openrouter_model_catalog"') AND i.relname = 'openrouter_model_catalog_model_id_unique'
         AND x.indisunique AND x.indnkeyatts = 1 AND a.attname = 'model_id'
         AND (x.indpred IS NULL OR pg_get_expr(x.indpred, x.indrelid) = '(model_id IS NOT NULL)')
    ) THEN
      RAISE WARNING '[uniq-0281] openrouter_model_catalog: a relation named openrouter_model_catalog_model_id_unique exists but is not a unique constraint/index on (model_id); uniqueness is NOT enforced. Resolve by hand.';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"openrouter_model_catalog"') AND attname = 'model_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] openrouter_model_catalog: column model_id absent, openrouter_model_catalog_model_id_unique skipped';
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  BEGIN
    SELECT count(*) INTO dupes
      FROM (SELECT "model_id" FROM "openrouter_model_catalog" WHERE "model_id" IS NOT NULL GROUP BY "model_id" HAVING count(*) > 1) d;
    IF dupes > 0 THEN
      RAISE WARNING '[uniq-0281] openrouter_model_catalog: % duplicate non-null key group(s) on model_id; constraint openrouter_model_catalog_model_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    ELSE
      ALTER TABLE "openrouter_model_catalog" ADD CONSTRAINT "openrouter_model_catalog_model_id_unique" UNIQUE ("model_id");
    END IF;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING '[uniq-0281] openrouter_model_catalog: constraint openrouter_model_catalog_model_id_unique NOT created (% %), no rows changed. It is retried on the next deploy.', SQLSTATE, SQLERRM;
  END;
  PERFORM set_config('lock_timeout', prior_lock_timeout, true);
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
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
       WHERE x.indrelid = to_regclass('"reaction_chain_runs"') AND i.relname = 'reaction_chain_runs_run_id_unique'
         AND x.indisunique AND x.indnkeyatts = 1 AND a.attname = 'run_id'
         AND (x.indpred IS NULL OR pg_get_expr(x.indpred, x.indrelid) = '(run_id IS NOT NULL)')
    ) THEN
      RAISE WARNING '[uniq-0281] reaction_chain_runs: a relation named reaction_chain_runs_run_id_unique exists but is not a unique constraint/index on (run_id); uniqueness is NOT enforced. Resolve by hand.';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"reaction_chain_runs"') AND attname = 'run_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] reaction_chain_runs: column run_id absent, reaction_chain_runs_run_id_unique skipped';
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  BEGIN
    SELECT count(*) INTO dupes
      FROM (SELECT "run_id" FROM "reaction_chain_runs" WHERE "run_id" IS NOT NULL GROUP BY "run_id" HAVING count(*) > 1) d;
    IF dupes > 0 THEN
      RAISE WARNING '[uniq-0281] reaction_chain_runs: % duplicate non-null key group(s) on run_id; constraint reaction_chain_runs_run_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    ELSE
      ALTER TABLE "reaction_chain_runs" ADD CONSTRAINT "reaction_chain_runs_run_id_unique" UNIQUE ("run_id");
    END IF;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING '[uniq-0281] reaction_chain_runs: constraint reaction_chain_runs_run_id_unique NOT created (% %), no rows changed. It is retried on the next deploy.', SQLSTATE, SQLERRM;
  END;
  PERFORM set_config('lock_timeout', prior_lock_timeout, true);
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
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
       WHERE x.indrelid = to_regclass('"shared_deal_links"') AND i.relname = 'shared_deal_links_token_unique'
         AND x.indisunique AND x.indnkeyatts = 1 AND a.attname = 'token'
         AND (x.indpred IS NULL OR pg_get_expr(x.indpred, x.indrelid) = '(token IS NOT NULL)')
    ) THEN
      RAISE WARNING '[uniq-0281] shared_deal_links: a relation named shared_deal_links_token_unique exists but is not a unique constraint/index on (token); uniqueness is NOT enforced. Resolve by hand.';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"shared_deal_links"') AND attname = 'token' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] shared_deal_links: column token absent, shared_deal_links_token_unique skipped';
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  BEGIN
    SELECT count(*) INTO dupes
      FROM (SELECT "token" FROM "shared_deal_links" WHERE "token" IS NOT NULL GROUP BY "token" HAVING count(*) > 1) d;
    IF dupes > 0 THEN
      RAISE WARNING '[uniq-0281] shared_deal_links: % duplicate non-null key group(s) on token; constraint shared_deal_links_token_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    ELSE
      ALTER TABLE "shared_deal_links" ADD CONSTRAINT "shared_deal_links_token_unique" UNIQUE ("token");
    END IF;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING '[uniq-0281] shared_deal_links: constraint shared_deal_links_token_unique NOT created (% %), no rows changed. It is retried on the next deploy.', SQLSTATE, SQLERRM;
  END;
  PERFORM set_config('lock_timeout', prior_lock_timeout, true);
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
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
       WHERE x.indrelid = to_regclass('"strategic_plans"') AND i.relname = 'strategic_plans_plan_id_unique'
         AND x.indisunique AND x.indnkeyatts = 1 AND a.attname = 'plan_id'
         AND (x.indpred IS NULL OR pg_get_expr(x.indpred, x.indrelid) = '(plan_id IS NOT NULL)')
    ) THEN
      RAISE WARNING '[uniq-0281] strategic_plans: a relation named strategic_plans_plan_id_unique exists but is not a unique constraint/index on (plan_id); uniqueness is NOT enforced. Resolve by hand.';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"strategic_plans"') AND attname = 'plan_id' AND attnum > 0 AND NOT attisdropped) THEN
    RAISE NOTICE '[uniq-0281] strategic_plans: column plan_id absent, strategic_plans_plan_id_unique skipped';
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  BEGIN
    SELECT count(*) INTO dupes
      FROM (SELECT "plan_id" FROM "strategic_plans" WHERE "plan_id" IS NOT NULL GROUP BY "plan_id" HAVING count(*) > 1) d;
    IF dupes > 0 THEN
      RAISE WARNING '[uniq-0281] strategic_plans: % duplicate non-null key group(s) on plan_id; constraint strategic_plans_plan_id_unique NOT created, no rows changed. Resolve by hand, then redeploy.', dupes;
    ELSE
      ALTER TABLE "strategic_plans" ADD CONSTRAINT "strategic_plans_plan_id_unique" UNIQUE ("plan_id");
    END IF;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    RAISE WARNING '[uniq-0281] strategic_plans: constraint strategic_plans_plan_id_unique NOT created (% %), no rows changed. It is retried on the next deploy.', SQLSTATE, SQLERRM;
  END;
  PERFORM set_config('lock_timeout', prior_lock_timeout, true);
END
$mig0281$;
