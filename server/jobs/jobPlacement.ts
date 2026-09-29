/**
 * Where the scheduler runs (founder ruling 2026-09-29 #5: worker only).
 *
 * Production runs two Fly process groups, `app` (customer HTTP) and `worker`
 * (outbox + scheduler). Both booted `runScheduledJobs()` unless
 * DISABLE_BACKGROUND_JOBS=1 was set on the app, and nothing set it — so every
 * job ran on the customer-facing process too, contending for its small DB
 * pool (DEFECT-0049). The per-job Postgres locks kept that correct; it was
 * still wasted load where latency matters.
 *
 * Fly sets FLY_PROCESS_GROUP on every machine, so the app process now stands
 * down by itself in production. Outside Fly (local dev, tests, a single-
 * process deploy) there is no worker, so the app keeps running the scheduler.
 * APP_RUN_BACKGROUND_JOBS=1 is the explicit override back.
 */
export function appProcessRunsScheduledJobs(env: NodeJS.ProcessEnv = process.env): {
  run: boolean;
  reason: string;
} {
  if (env.APP_RUN_BACKGROUND_JOBS === "1") return { run: true, reason: "APP_RUN_BACKGROUND_JOBS=1 override" };
  if (env.DISABLE_BACKGROUND_JOBS === "1") return { run: false, reason: "DISABLE_BACKGROUND_JOBS=1" };
  if (env.FLY_PROCESS_GROUP === "app") return { run: false, reason: "Fly app process group — the worker runs the scheduler" };
  return { run: true, reason: "no worker process group (single-process run)" };
}
