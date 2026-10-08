/**
 * Where the Solene team-state map lives at RUNTIME, and the one way the server
 * regenerates it.
 *
 * The running server used to regenerate docs/internal/solene-team-state.md —
 * a TRACKED repository file — every 15 minutes (runScheduledJobs →
 * scripts/regenerate-team-state.mjs, which wrote into the repo's docs/ tree).
 * Production was spared only because the job is skipped when FLY_APP_NAME is
 * set; any other host (a dev server, CI, a self-hosted deploy) mutated the
 * checkout it was serving from. The runtime copy now lives outside the repo:
 *
 *   SOLENE_TEAM_STATE_PATH (or the older SOLENE_DISPATCH_TEAM_STATE_PATH)
 *   else  <os.tmpdir()>/acreos-runtime/solene-team-state.md
 *
 * The tracked doc is only ever READ at runtime — as the seed for a first
 * regeneration (it carries the hand-maintained bottom section). The dispatcher
 * does not fall back to it: its AUTO block is stale by construction. Writing
 * it is a manual, explicit act: `node scripts/regenerate-team-state.mjs --repo-doc`.
 */
import os from "node:os";
import path from "node:path";

/** The tracked, hand-curated copy. Read-only at runtime. */
function trackedTeamStateDocPath(): string {
  return path.resolve(process.cwd(), "docs/internal/solene-team-state.md");
}

/** The runtime copy the regenerator writes and the dispatcher reads first. */
export function runtimeTeamStatePath(): string {
  return (
    process.env.SOLENE_TEAM_STATE_PATH ??
    process.env.SOLENE_DISPATCH_TEAM_STATE_PATH ??
    path.join(os.tmpdir(), "acreos-runtime", "solene-team-state.md")
  );
}

/**
 * Run scripts/regenerate-team-state.mjs against the RUNTIME path. The script
 * refuses to write inside the repository's docs/ tree unless told --repo-doc,
 * which this never passes.
 */
export async function regenerateTeamState(opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  const { spawn } = await import("node:child_process");
  const cwd = opts.cwd ?? process.cwd();
  const target = runtimeTeamStatePath();
  const scriptPath = path.resolve(cwd, "scripts/regenerate-team-state.mjs");
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd,
      env: {
        ...process.env,
        ...opts.env,
        SOLENE_TEAM_STATE_PATH: target,
        SOLENE_TEAM_STATE_SEED_PATH: trackedTeamStateDocPath(),
        // Inside the prod container we never want the regenerator to hit the
        // public health endpoint from itself — same-host curl can loop and
        // consume request slots. The daily-pulse workflow publishes health.
        SOLENE_TEAM_STATE_SKIP_HEALTHCHECK: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => rejectPromise(err));
    child.on("exit", (code) => {
      if (code === 0) return resolvePromise();
      rejectPromise(new Error(`regenerate-team-state exit ${code}: ${stderr.slice(0, 500)}`));
    });
  });
  return target;
}
