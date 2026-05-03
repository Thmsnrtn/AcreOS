-- 0061_vm_resource_usage.sql
-- Cost rightsizing — Fly.io VM resource utilisation tracker.
--
-- Captures a 5-minute sample of memory + CPU utilisation per Fly machine so
-- the founder can review 7+ days of data and decide whether to drop the
-- current 2× performance VMs (2 CPU / 4GB) down to 2GB / 1 CPU or move to
-- shared CPUs. Auto-flipping the VM size is intentionally NOT done here —
-- that's a manual operator decision once the data is in.
--
-- Rows are append-only. A retention sweeper trims to ~30 days separately.

CREATE TABLE IF NOT EXISTS "vm_resource_usage" (
    "id"                   bigserial PRIMARY KEY,
    "machine_id"           text        NOT NULL,            -- $FLY_MACHINE_ID
    "region"               text,                            -- $FLY_REGION
    "process_group"        text,                            -- 'app' | 'worker'
    "captured_at"          timestamptz NOT NULL DEFAULT now(),

    -- Memory (bytes). rss is the operator-relevant gauge; heap_used + heap_total
    -- give a Node-vs-OS picture so we can tell if RSS pressure is V8 heap
    -- versus native buffers (sharp, pdf-lib, ffmpeg).
    "rss_bytes"            bigint      NOT NULL,
    "heap_used_bytes"      bigint      NOT NULL,
    "heap_total_bytes"     bigint      NOT NULL,
    "external_bytes"       bigint      NOT NULL,
    "array_buffers_bytes"  bigint      NOT NULL,

    -- CPU. We sample process.cpuUsage() deltas across the interval and
    -- normalise against wall-clock × cpu_count to derive a 0..1 utilisation
    -- ratio. Reported as percent (0..100) for readability.
    "cpu_user_us"          bigint      NOT NULL,
    "cpu_system_us"        bigint      NOT NULL,
    "cpu_percent"          numeric(5,2) NOT NULL,           -- normalised 0..100
    "cpu_count"            integer     NOT NULL,
    "load_avg_1m"          numeric(6,2),

    -- Event-loop lag (ms). Useful to correlate with cost decisions — if lag
    -- is fine even at peak, the box is over-provisioned.
    "event_loop_lag_ms"    numeric(8,2),

    -- Total system memory the VM sees (Fly reports the configured size).
    "total_memory_bytes"   bigint,

    "uptime_seconds"       integer     NOT NULL,
    "node_version"         text,
    "app_version"          text                              -- VITE_GIT_SHA-equivalent
);

-- Operator queries: "show me the last 7 days for this machine"
CREATE INDEX IF NOT EXISTS "vm_resource_usage_machine_time_idx"
    ON "vm_resource_usage" ("machine_id", "captured_at" DESC);

-- Operator queries: "show me peak utilisation across the fleet by hour"
CREATE INDEX IF NOT EXISTS "vm_resource_usage_time_idx"
    ON "vm_resource_usage" ("captured_at" DESC);

CREATE INDEX IF NOT EXISTS "vm_resource_usage_process_group_idx"
    ON "vm_resource_usage" ("process_group", "captured_at" DESC);
