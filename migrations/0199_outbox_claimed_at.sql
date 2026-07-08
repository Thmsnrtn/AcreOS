-- WS5 worker-kill drill (2026-07-08): a kill -9 mid-batch left claimed rows
-- in status='running' forever — the claim query only takes pending/retry and
-- no reaper existed. Recovery needs to know WHEN a row was claimed (created_at
-- is enqueue time; a backlog claimed after downtime would look instantly
-- stale). Add the claim timestamp + a partial index for the reaper's scan.
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS outbox_running_claimed_idx
  ON outbox (claimed_at)
  WHERE status = 'running';
