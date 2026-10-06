/**
 * Infrastructure chaos — what a real deployment does to you at 3am.
 *
 *   1. Redis disappears (rate limiter / cache / queues) and comes back
 *   2. Postgres restarts under the app (pool must recover without a process restart)
 *   3. SIGTERM mid-request: does the in-flight request finish, does the port close?
 *
 * Requires: local Redis + Postgres 16 cluster `main`, the app started from
 * dist/index.cjs with the env in $SIM_ENV_FILE. Restarts the app at the end.
 *
 *   SIM_ENV_FILE=... SIM_BASE_URL=http://localhost:5000 npx tsx tests/simulation/campaign/infrastructure-chaos.ts
 */
import { execSync, spawn } from "node:child_process";
import { openSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { SimClient, concurrently, percentile } from "./client";
import { outDir, recordFinding, recordMetric, recordSkip } from "./ledger";

const SIM = "infra-chaos";
const c = new SimClient("land-operator-desktop");
const ENV_FILE = process.env.SIM_ENV_FILE ?? "";
const PROBES = ["/api/health", "/api/auth/user", "/api/leads", "/api/deals", "/api/dashboard/today", "/api/inbox"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function probe(label: string, rounds = 3) {
  const out: Record<string, { statuses: number[]; p50: number; max: number }> = {};
  for (const p of PROBES) {
    const rs = await concurrently(rounds, () => c.get(p));
    out[p] = { statuses: rs.map((r) => r.status), p50: Math.round(percentile(rs.map((r) => r.ms), 50)), max: Math.round(Math.max(...rs.map((r) => r.ms))) };
  }
  recordMetric(SIM, label, out);
  return out;
}

function sh(cmd: string) {
  try { return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim(); } catch (e: any) { return `ERR ${e.stderr?.toString().slice(0, 200)}`; }
}

async function main() {
  const baseline = await probe("baseline");
  const health0 = await c.get("/api/health");
  recordMetric(SIM, "health baseline", health0.body);

  // ── 1. Redis gone ────────────────────────────────────────────────────────
  // Prove the app actually uses this Redis before claiming it survives losing it.
  const appRedis = sh(`for p in $(pgrep -f '[n]ode dist/index.cjs'); do tr '\\0' '\\n' < /proc/$p/environ 2>/dev/null | grep '^REDIS_URL='; done | head -1`);
  recordMetric(SIM, "app REDIS_URL", appRedis || "(none)");
  if (!appRedis.includes("localhost:6379") && !appRedis.includes("127.0.0.1:6379")) {
    recordSkip({ sim: SIM, step: "redis-down", reason: `the app is not configured for the local Redis (${appRedis || "no REDIS_URL"}); stopping it would prove nothing` });
  } else if (sh("redis-cli ping") !== "PONG") {
    recordSkip({ sim: SIM, step: "redis-down", reason: "redis not reachable locally before the test" });
  } else {
    sh("redis-cli shutdown nosave");
    await sleep(1500);
    const down = await probe("redis-down");
    const healthDown = await c.get("/api/health");
    recordMetric(SIM, "health redis-down", { status: healthDown.status, body: healthDown.body });
    for (const [p, r] of Object.entries(down)) {
      if (r.statuses.some((s) => s >= 500 || s === 0)) {
        recordFinding({ sim: SIM, id: `A-CHAOS-1-${p}`, product: "AcreOS", sev: "P1", area: "resilience",
          title: `${p} fails (${r.statuses.join(",")}) while Redis is down — Redis is a hard dependency for a read path`,
          evidence: `baseline ${baseline[p].statuses.join(",")} → redis-down ${r.statuses.join(",")}; p50 ${r.p50}ms max ${r.max}ms` });
      } else if (r.max > Math.max(2000, baseline[p].max * 5)) {
        recordFinding({ sim: SIM, id: `A-CHAOS-1s-${p}`, product: "AcreOS", sev: "P2", area: "resilience",
          title: `${p} slows ${Math.round(r.max / Math.max(1, baseline[p].max))}× while Redis is down (connection timeouts on the request path)`,
          evidence: `baseline max ${baseline[p].max}ms → ${r.max}ms` });
      }
    }
    if (healthDown.status === 200 && JSON.stringify(healthDown.body).indexOf("redis") === -1) {
      recordFinding({ sim: SIM, id: "A-CHAOS-1-health", product: "AcreOS", sev: "P2", area: "operability",
        title: "/api/health does not name Redis as the degraded component while Redis is down",
        evidence: JSON.stringify(healthDown.body).slice(0, 200) });
    }
    sh("redis-server --daemonize yes --port 6379");
    await sleep(2000);
    const back = await probe("redis-back");
    for (const [p, r] of Object.entries(back)) {
      if (r.statuses.some((s) => s >= 500 || s === 0)) {
        recordFinding({ sim: SIM, id: `A-CHAOS-1r-${p}`, product: "AcreOS", sev: "P1", area: "resilience",
          title: `${p} still failing after Redis returned — the client does not reconnect`, evidence: r.statuses.join(",") });
      }
    }
  }

  // ── 2. Postgres restart under the app ───────────────────────────────────
  {
    // Prove the restart happened: compare the postmaster start time before and
    // after. sh() returns "ERR …" instead of throwing, so without this a failed
    // pg_ctlcluster would read as an instant, flawless recovery.
    const startedBefore = sh(`su postgres -c "psql -tAc 'select pg_postmaster_start_time()'"`);
    const t0 = Date.now();
    const r = sh("pg_ctlcluster 16 main restart");
    const startedAfter = sh(`su postgres -c "psql -tAc 'select pg_postmaster_start_time()'"`);
    recordMetric(SIM, "pg restart proof", { startedBefore, startedAfter });
    if (r.startsWith("ERR") || startedBefore === startedAfter || startedAfter.startsWith("ERR")) {
      throw new Error(`Postgres restart not proven (cmd: ${r}; start time ${startedBefore} -> ${startedAfter}); the recovery measurement would be vacuous`);
    }
    recordMetric(SIM, "pg restart", r || "ok");
    let recoveredAt: number | null = null;
    const timeline: Array<{ t: number; statuses: number[] }> = [];
    for (let i = 0; i < 30; i++) {
      const rs = await concurrently(3, () => c.get("/api/leads"));
      const st = rs.map((x) => x.status);
      timeline.push({ t: Date.now() - t0, statuses: st });
      if (st.every((s) => s === 200)) { recoveredAt = Date.now() - t0; break; }
      await sleep(1000);
    }
    recordMetric(SIM, "pg restart timeline", timeline);
    if (recoveredAt === null) {
      recordFinding({ sim: SIM, id: "A-CHAOS-2", product: "AcreOS", sev: "P0", area: "resilience",
        title: "After a Postgres restart the app never recovers without a process restart (30s of 5xx on GET /api/leads)",
        evidence: JSON.stringify(timeline.slice(-5)) });
    } else {
      recordMetric(SIM, "pg recovery ms", recoveredAt);
      if (recoveredAt > 10_000) {
        recordFinding({ sim: SIM, id: "A-CHAOS-2s", product: "AcreOS", sev: "P2", area: "resilience",
          title: `App took ${Math.round(recoveredAt / 1000)}s to recover after a Postgres restart`, evidence: JSON.stringify(timeline) });
      }
    }
    const health = await c.get("/api/health");
    recordMetric(SIM, "health after pg restart", health.body);
  }

  // ── 3. SIGTERM mid-request ──────────────────────────────────────────────
  if (!ENV_FILE) {
    recordSkip({ sim: SIM, step: "sigterm", reason: "SIM_ENV_FILE not set; cannot restart the app afterwards" });
  } else {
    // Find the process LISTENING on the target port — several app instances may
    // run side by side (the campaign server and a suite-owned one), and a
    // name match would pick whichever started first.
    const port = new URL(process.env.SIM_BASE_URL ?? "http://localhost:5000").port || "80";
    const pid = sh(`for p in $(pgrep -f '[n]ode dist/index.cjs'); do tr '\\0' '\\n' < /proc/$p/environ 2>/dev/null | grep -qx 'PORT=${port}' && echo $p; done | head -1`);
    if (!/^\d+$/.test(pid)) {
      recordSkip({ sim: SIM, step: "sigterm", reason: `could not find app pid (${pid})` });
    } else {
      // Fire a burst of requests, send SIGTERM while they are in flight.
      const burst = concurrently(40, () => c.get("/api/leads"));
      await sleep(50);
      const t0 = Date.now();
      sh(`kill -TERM ${pid}`);
      const results = await burst;
      const statuses = results.map((r) => r.status);
      let closedAt: number | null = null;
      for (let i = 0; i < 60; i++) {
        if (sh(`kill -0 ${pid} 2>/dev/null && echo alive || echo dead`) === "dead") { closedAt = Date.now() - t0; break; }
        await sleep(250);
      }
      recordMetric(SIM, "sigterm in-flight statuses", statuses);
      recordMetric(SIM, "sigterm exit ms", closedAt);
      const dropped = statuses.filter((s) => s === 0).length;
      if (dropped > 0) {
        recordFinding({ sim: SIM, id: "A-CHAOS-3", product: "AcreOS", sev: "P2", area: "resilience",
          title: `SIGTERM dropped ${dropped}/40 in-flight requests (connection reset instead of a drained response)`,
          evidence: JSON.stringify(statuses) });
      }
      if (closedAt === null) {
        recordFinding({ sim: SIM, id: "A-CHAOS-3h", product: "AcreOS", sev: "P2", area: "resilience",
          title: "Process did not exit within 15s of SIGTERM (deploys will be force-killed)", evidence: "kill -0 still alive after 15s" });
        sh(`kill -KILL ${pid}`);
      }
      // Restart the app for the sims that follow.
      // The restart log lives in this campaign's own output directory, never a
      // predictable path in the shared temp dir (CodeQL js/insecure-temporary-file).
      const log = openSync(join(outDir(), "server-restart.log"), "a");
      // The operator-supplied paths are checked to be existing regular files and
      // passed as ARGUMENTS, never spliced into a shell string
      // (CodeQL js/indirect-command-line-injection).
      const startScript = process.env.SIM_START_SCRIPT;
      const assertFile = (p: string) => {
        if (!isAbsolute(p) || !statSync(p, { throwIfNoEntry: false })?.isFile()) throw new Error(`not an absolute path to a regular file: ${p}`);
        return p;
      };
      const startArgs = startScript
        ? [assertFile(startScript)]
        // The env file may name a different PORT than the instance under test;
        // the port comes from SIM_BASE_URL, validated as digits, passed as an argument.
        : ["-c", 'source "$1" && PORT="$2" exec node dist/index.cjs', "bash", assertFile(ENV_FILE), /^\d{2,5}$/.test(port) ? port : "5000"];
      const child = spawn("bash", startArgs, { detached: true, stdio: ["ignore", log, log] });
      child.unref();
      let up = false;
      for (let i = 0; i < 60; i++) {
        await sleep(1000);
        const h = await c.get("/api/health");
        if (h.status === 200) { up = true; recordMetric(SIM, "restart boot ms", (i + 1) * 1000); break; }
      }
      if (!up) recordFinding({ sim: SIM, id: "A-CHAOS-3b", product: "AcreOS", sev: "P1", area: "operability", title: "App did not come back within 60s after restart", evidence: "health never 200" });
    }
  }
  console.log(`[${SIM}] done`);
}

main().catch((e) => { console.error(e); process.exit(1); });
