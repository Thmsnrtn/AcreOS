// acreos-ci-controller — Fly CI spike controller (zero-dependency Node).
//
// Receives GitHub `workflow_job` webhooks for Thmsnrtn/AcreOS. On a queued
// job carrying the spike label, it verifies the HMAC signature, applies the
// fork/head-repo guards, and — when it holds both credentials — mints a JIT
// runner config and spawns exactly one ephemeral Fly Machine for the job.
// On completed events it makes sure the machine is gone, and a reaper sweep
// destroys any spike machine older than MAX_MACHINE_AGE_MIN.
//
// Credential-gated by design: without GH_JIT_TOKEN / FLY_API_TOKEN the
// controller still verifies and guards every webhook and records the
// WOULD_SPAWN decision, but does not (cannot) mint configs or create
// machines. Those two tokens are the only pieces a human must provision
// (see ci-spike/README.md).
//
// Concurrency cap + cost metering (Fly CI expansion, 2026-11-27): spawns
// are capped at MAX_CONCURRENT_RUNNERS simultaneous runner machines;
// over-cap jobs defer in memory and drain as machines free (completion
// events + the reaper sweep). Every spawned machine is metered — spawn
// to destroy lifetime x the published per-second rate for its guest
// size — and reported at GET /metering: measured lifetimes, published-
// rate prices (not invoice reads). Aggregates are in-memory; the
// durable per-machine records are the "meter" log lines.

import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 8080);
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";
const GH_REPO = process.env.GH_REPO || "Thmsnrtn/AcreOS";
const SPIKE_LABEL = process.env.SPIKE_LABEL || "fly-ci-spike";
const SPIKE_WORKFLOW = process.env.SPIKE_WORKFLOW || "Fly CI Spike";
const GH_TOKEN = process.env.GH_JIT_TOKEN || "";
const FLY_TOKEN = process.env.FLY_API_TOKEN || "";
const FLY_RUNNER_APP = process.env.FLY_RUNNER_APP || "acreos-ci-runner";
const FLY_REGION = process.env.FLY_REGION || "iad";
const RUNNER_IMAGE =
  process.env.RUNNER_IMAGE || "ghcr.io/actions/actions-runner:latest";
const MAX_MACHINE_AGE_MIN = Number(process.env.MAX_MACHINE_AGE_MIN || 60);
const MAX_CONCURRENT_RUNNERS = Number(process.env.MAX_CONCURRENT_RUNNERS || 6);
// Fly published per-second rates by guest shape (performance-4x/16GB read
// from Fly's resource pricing page 2026-11-23). Unknown shapes meter as
// unrated rather than guessing a price.
const METER_RATES_PER_SEC = { "performance:4:16384": 0.00006328 };

const pending = []; // deferred over-cap jobs: {at, base, run_id, job_id}
const meterLive = new Map(); // machine_id -> {machine_name, spawned_at_ms, guest, job_id, run_id, workflow}
const meterMonths = {}; // "YYYY-MM" -> {machines, total_seconds, est_usd, unrated}

const events = []; // ring buffer of decision summaries (no secrets, no JIT configs)
function record(kind, summary) {
  const entry = { at: new Date().toISOString(), kind, ...summary };
  events.push(entry);
  if (events.length > 100) events.shift();
  console.log(JSON.stringify(entry));
}

function verifySignature(rawBody, signatureHeader) {
  if (!WEBHOOK_SECRET || !signatureHeader) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signatureHeader));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function ghApi(path) {
  const resp = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!resp.ok) throw new Error(`GitHub ${path} -> ${resp.status}`);
  return resp.json();
}

async function flyMachines(method, path, body) {
  const resp = await fetch(
    `https://api.machines.dev/v1/apps/${FLY_RUNNER_APP}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${FLY_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  if (!resp.ok)
    throw new Error(`Fly machines ${method} ${path} -> ${resp.status}`);
  return resp.status === 204 ? null : resp.json();
}

async function liveRunnerMachines() {
  const machines = (await flyMachines("GET", "/machines")) || [];
  return machines.filter((m) => m.config?.metadata?.spike === "fly-ci");
}

function rateFor(guest) {
  if (!guest) return null;
  const k = `${guest.cpu_kind}:${guest.cpus}:${guest.memory_mb}`;
  return Object.prototype.hasOwnProperty.call(METER_RATES_PER_SEC, k)
    ? METER_RATES_PER_SEC[k]
    : null;
}

function meterStart(machine, base, job) {
  meterLive.set(machine.id, {
    machine_name: machine.name,
    spawned_at_ms: Date.now(),
    guest: machine.config?.guest || { cpu_kind: "performance", cpus: 4, memory_mb: 16384 },
    job_id: job.id,
    run_id: job.run_id,
    workflow: base.workflow,
  });
}

function meterFinalize(machineId, source) {
  const m = meterLive.get(machineId);
  if (!m) return;
  meterLive.delete(machineId);
  const lifetimeS = Math.max(0, Math.round((Date.now() - m.spawned_at_ms) / 1000));
  const rate = rateFor(m.guest);
  const est = rate == null ? null : Number((lifetimeS * rate).toFixed(4));
  const month = new Date(m.spawned_at_ms).toISOString().slice(0, 7);
  const agg = (meterMonths[month] ||= { machines: 0, total_seconds: 0, est_usd: 0, unrated: 0 });
  agg.machines += 1;
  agg.total_seconds += lifetimeS;
  if (est == null) agg.unrated += 1;
  else agg.est_usd = Number((agg.est_usd + est).toFixed(4));
  record("meter", {
    machine_id: machineId, machine_name: m.machine_name, job_id: m.job_id,
    run_id: m.run_id, workflow: m.workflow, guest: m.guest,
    lifetime_s: lifetimeS, rate_per_sec: rate, est_usd: est, source,
  });
}

async function spawnForJob(base, job) {
  try {
    const runnerName = `fly-spike-${job.run_id}-${job.id}`;
    const jitConfig = await mintJitConfig(runnerName);
    const machine = await flyMachines(
      "POST",
      "/machines",
      buildRunnerMachineConfig(jitConfig, runnerName),
    );
    meterStart(machine, base, job);
    record("spawned", { ...base, machine_id: machine.id, machine_name: runnerName });
  } catch (e) {
    record("spawn_error", { ...base, reason: String(e) });
  }
}

// Drain deferred jobs while under the cap. A deferred job GitHub no
// longer shows as queued (cancelled / superseded) is dropped, never
// spawned — deferral therefore also saves the machine time a
// superseded head would have burned.
async function drainPending() {
  if (!pending.length || !GH_TOKEN || !FLY_TOKEN) return;
  let live;
  try {
    live = await liveRunnerMachines();
  } catch {
    return; // cannot count — retry on the next drain trigger
  }
  while (pending.length && live.length < MAX_CONCURRENT_RUNNERS) {
    const item = pending[0];
    try {
      const j = await ghApi(`/repos/${GH_REPO}/actions/runs/${item.run_id}/jobs?per_page=100`);
      const mine = (j.jobs || []).find((x) => x.id === item.job_id);
      if (!mine || mine.status !== "queued") {
        pending.shift();
        record("deferred_dropped", { ...item.base, job_status: mine ? mine.status : "absent" });
        continue;
      }
    } catch {
      return; // cannot verify the job is still queued — retry next trigger
    }
    pending.shift();
    await spawnForJob(item.base, { id: item.job_id, run_id: item.run_id });
    live = [...live, {}]; // account for the machine just spawned
  }
}

// The exact machine shape used for a runner. Mirrored by the operator-side
// spawn script used during the spike proof (ci-spike/spawn notes in README).
export function buildRunnerMachineConfig(jitConfig, machineName) {
  return {
    name: machineName,
    region: FLY_REGION,
    config: {
      image: RUNNER_IMAGE,
      init: {
        entrypoint: ["/bin/bash", "-c"],
        cmd: [
          'cd /home/runner && exec ./run.sh --jitconfig "$JITCONFIG"',
        ],
      },
      env: { JITCONFIG: jitConfig, RUNNER_ALLOW_RUNASROOT: "1" },      guest: { cpu_kind: "performance", cpus: 4, memory_mb: 16384 },
      auto_destroy: true,
      restart: { policy: "no" },
      metadata: { spike: "fly-ci", role: "runner" },
    },
  };
}

async function mintJitConfig(runnerName) {
  const resp = await fetch(
    `https://api.github.com/repos/${GH_REPO}/actions/runners/generate-jitconfig`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: runnerName,
        runner_group_id: 1,
        // JIT runners advertise exactly the labels in the config — the
        // system labels must be requested explicitly or no job will match.
        labels: ["self-hosted", "Linux", "X64", SPIKE_LABEL],
        work_folder: "_work",
      }),
    },
  );
  if (!resp.ok) throw new Error(`generate-jitconfig -> ${resp.status}`);
  const data = await resp.json();
  return data.encoded_jit_config;
}

async function handleWorkflowJob(payload) {
  const job = payload.workflow_job || {};
  const repoFullName = payload.repository?.full_name;
  const base = {
    action: payload.action,
    job_id: job.id,
    run_id: job.run_id,
    workflow: job.workflow_name,
    labels: job.labels,
    repo: repoFullName,
  };

  if (payload.action === "queued") {
    // Guard 1: event must be for our repo.
    if (repoFullName !== GH_REPO)
      return record("guard_reject", { ...base, reason: "repo mismatch" });
    // Guard 2: job must carry the dedicated spike label.
    if (!Array.isArray(job.labels) || !job.labels.includes(SPIKE_LABEL))
      return record("ignore", { ...base, reason: "label not present" });
    // Guard 3: only the spike workflow may spawn machines.
    if (job.workflow_name !== SPIKE_WORKFLOW)
      return record("guard_reject", { ...base, reason: "workflow mismatch" });
    // Guard 4 (fork guard): when we can read the run, its head repository
    // must be this repo itself and not a fork. workflow_dispatch runs always
    // satisfy this, but pull_request runs from forks must never spawn.
    if (GH_TOKEN) {
      try {
        const run = await ghApi(`/repos/${GH_REPO}/actions/runs/${job.run_id}`);
        const head = run.head_repository?.full_name;
        if (head !== GH_REPO || run.head_repository?.fork)
          return record("guard_reject", {
            ...base,
            reason: `head repo ${head} fork=${run.head_repository?.fork}`,
          });
      } catch (e) {
        return record("guard_reject", { ...base, reason: String(e) });
      }
    }

    if (!GH_TOKEN || !FLY_TOKEN) {
      return record("would_spawn", {
        ...base,
        reason: "guards passed; spawn credential(s) not provisioned",
        gh_token: Boolean(GH_TOKEN),
        fly_token: Boolean(FLY_TOKEN),
      });
    }

    // Concurrency cap: bound simultaneous runner machines. Over-cap
    // jobs defer and drain as machines free. If the machine list cannot
    // be read, fail OPEN with a loud record — a Fly API blip must not
    // stall all CI; the reaper still bounds orphan lifetimes.
    let live = null;
    try {
      live = await liveRunnerMachines();
    } catch (e) {
      record("cap_check_error", { ...base, reason: String(e) });
    }
    if (live && live.length >= MAX_CONCURRENT_RUNNERS) {
      pending.push({ at: new Date().toISOString(), base, run_id: job.run_id, job_id: job.id });
      return record("deferred_cap", {
        ...base, live: live.length, cap: MAX_CONCURRENT_RUNNERS, pending: pending.length,
      });
    }
    await spawnForJob(base, job);
    return;
  }

  if (payload.action === "completed") {
    record("job_completed", { ...base, conclusion: job.conclusion });
    if (FLY_TOKEN) {
      try {
        const machines = await flyMachines("GET", "/machines");
        const mine = (machines || []).find(
          (m) => m.name === `fly-spike-${job.run_id}-${job.id}`,
        );
        if (mine) {
          await flyMachines("DELETE", `/machines/${mine.id}?force=true`);
          meterFinalize(mine.id, "job_completed");
        }
      } catch (e) {
        record("cleanup_error", { ...base, reason: String(e) });
      }
    }
    await drainPending();
  }
}

// Reaper: destroy spike machines older than the hard cap (orphan safety).
async function reaper() {
  if (!FLY_TOKEN) return;
  try {
    const machines = (await flyMachines("GET", "/machines")) || [];
    const now = Date.now();
    for (const m of machines) {
      if (m.config?.metadata?.spike !== "fly-ci") continue;
      const ageMin = (now - new Date(m.created_at).getTime()) / 60000;
      if (ageMin > MAX_MACHINE_AGE_MIN) {
        await flyMachines("DELETE", `/machines/${m.id}?force=true`);
        record("reaped", { machine_id: m.id, machine_name: m.name, age_min: Math.round(ageMin) });
        meterFinalize(m.id, "reaped");
      }
    }
    // Metering reconciliation: machines that auto-destroyed without a
    // completion cleanup (the normal path) finalize from absence.
    const alive = new Set(machines.map((m) => m.id));
    for (const [id, m] of meterLive) {
      if (!alive.has(id) && now - m.spawned_at_ms > 120000)
        meterFinalize(id, "reconcile_absent");
    }
    await drainPending();
  } catch (e) {
    record("reaper_error", { reason: String(e) });
  }
}
setInterval(reaper, 5 * 60 * 1000);

const server = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        ok: true,
        service: "acreos-ci-controller",
        gh_token: Boolean(GH_TOKEN),
        fly_token: Boolean(FLY_TOKEN),
      }),
    );
  }
  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ events: events.slice(-25) }, null, 1));
  }
  if (req.method === "GET" && req.url === "/metering") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify(
        {
          cap: MAX_CONCURRENT_RUNNERS,
          pending: pending.length,
          live_metered: [...meterLive.entries()].map(([id, m]) => ({
            machine_id: id,
            machine_name: m.machine_name,
            age_s: Math.round((Date.now() - m.spawned_at_ms) / 1000),
            guest: m.guest,
            job_id: m.job_id,
            run_id: m.run_id,
          })),
          months: meterMonths,
          rates_per_sec: METER_RATES_PER_SEC,
          note: "est_usd = measured machine lifetime x Fly published per-second rate (not an invoice read). Aggregates are in-memory and reset on controller restart; durable per-machine records are the 'meter' log lines.",
        },
        null,
        1,
      ),
    );
  }
  if (req.method === "POST" && req.url === "/webhook") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const raw = Buffer.concat(chunks);
      if (!verifySignature(raw, req.headers["x-hub-signature-256"])) {
        record("bad_signature", { event: req.headers["x-github-event"] });
        res.writeHead(401);
        return res.end("bad signature");
      }
      let payload;
      try {
        payload = JSON.parse(raw.toString("utf8"));
      } catch {
        res.writeHead(400);
        return res.end("bad json");
      }
      const event = req.headers["x-github-event"];
      if (event === "ping") record("ping", { zen: payload.zen });
      if (event === "workflow_job") await handleWorkflowJob(payload);
      res.writeHead(202);
      res.end("accepted");
    });
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  record("boot", {
    port: PORT, gh_token: Boolean(GH_TOKEN), fly_token: Boolean(FLY_TOKEN),
    cap: MAX_CONCURRENT_RUNNERS, metering: true,
  });
});
