-- Kareem §5 + §7: change-management ledger and DR drill ledger.
--
-- deployments — every production flyctl deploy is recorded here by the
-- GitHub Actions deploy workflow (POST /api/admin/deployments). Auditor
-- evidence for SOC 2 CC8.1 (change management): every prod change traces
-- to a commit, a PR, an approver, a workflow run, and a timestamp.
--
-- dr_drills — every quarterly DR drill records its measurements here so
-- /api/jobs/health can surface "DR drill is stale" when more than ~100
-- days have elapsed. Auditor evidence for SOC 2 A1.2 (availability).

CREATE TABLE IF NOT EXISTS deployments (
  id                          serial PRIMARY KEY,
  git_sha                     text NOT NULL,
  pr_number                   integer,
  approved_by                 text,
  deployed_by                 text NOT NULL,
  workflow_run_url            text,
  fly_machine_ids             text,
  environment                 text NOT NULL DEFAULT 'production',
  status                      text NOT NULL DEFAULT 'success',
  rollback_of_deployment_id   integer REFERENCES deployments(id),
  deployed_at                 timestamp NOT NULL DEFAULT now(),
  notes                       text
);

CREATE INDEX IF NOT EXISTS deployments_git_sha_idx ON deployments (git_sha);
CREATE INDEX IF NOT EXISTS deployments_deployed_at_idx ON deployments (deployed_at);

COMMENT ON TABLE deployments IS
  'SOC 2 CC8.1 change-management ledger. Every prod deploy is recorded here by .github/workflows/deploy.yml.';

CREATE TABLE IF NOT EXISTS dr_drills (
  id                          serial PRIMARY KEY,
  ran_at                      timestamp NOT NULL DEFAULT now(),
  ran_by                      text NOT NULL,
  snapshot_age_hours          integer,
  restore_minutes             integer,
  boot_minutes                integer,
  synthetic_check_minutes     integer,
  data_verify_minutes         integer,
  total_rto_minutes           integer NOT NULL,
  passed_rto_target           boolean NOT NULL DEFAULT false,
  what_went_wrong             text,
  whats_flaky                 text,
  action_items                text,
  postmortem_ref              text
);

CREATE INDEX IF NOT EXISTS dr_drills_ran_at_idx ON dr_drills (ran_at);

COMMENT ON TABLE dr_drills IS
  'SOC 2 A1.2 availability evidence. One row per quarterly DR drill per docs/runbooks/dr-drill-quarterly.md.';
