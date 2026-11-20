/**
 * Journey-proof harness — the runner.
 *
 * `runWalk` executes a validated spec against a driver, one step at a time,
 * and returns a report. It writes NOTHING to the repo: the CI rehearsal
 * asserts the report, and the staging CLI writes the record from the same
 * report via `renderWalkRecord` + `writeWalkRecord`. A record therefore
 * always describes a run that actually happened, with the same per-step
 * observed results in both places.
 *
 * FAILURE SEMANTICS: a step that throws, or whose `check` fails, is
 * recorded as `fail` with the error message, and the walk STOPS — a later
 * step must never run on a state an earlier step did not establish. A
 * `blocked` Pax leg does not stop the walk (it is the honest record of
 * missing tools), but the report's `passed` is false while any step is
 * blocked: a walk with a blocked Pax leg is a partial walk, never a PASS.
 * `manual` steps on staging are recorded as NOT RUN and also keep `passed`
 * false until an operator completes them and the record is amended by a
 * re-run — the runner never invents an operator's observation.
 */
import type {
  DriverName,
  StepObservation,
  StepStatus,
  WalkContext,
  WalkSpec,
  WalkStep,
} from "./walk-spec";
import { validateWalkSpec } from "./walk-spec";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface WalkDriver {
  name: DriverName;
  /** Human-readable environment label, e.g. "CI realdb (Postgres built from this repo)". */
  label: string;
  setupOrg: (spec: WalkSpec, tag: string) => Promise<{ orgId: number | string }>;
  api: WalkContext["api"];
  sql: WalkContext["sql"];
  sentCount: () => number | null;
  version: () => Promise<{ sha: string }>;
  cleanup: (spec: WalkSpec, orgId: number | string) => Promise<void>;
  /**
   * Collect values a manual step declares (operator-produced ids). Absent
   * means the driver cannot collect: the runner fails the step loudly.
   */
  collectManualInput?: (step: WalkStep) => Promise<Record<string, string>>;
}

export interface StepResult {
  id: string;
  title: string;
  kind: WalkStep["kind"];
  status: StepStatus;
  observed: Record<string, unknown>;
  notes: string[];
  durationMs: number;
  error?: string;
}

export interface WalkReport {
  specId: string;
  vertical: string;
  specVersion: number;
  runId: string;
  driver: DriverName;
  environment: string;
  orgId: number | string;
  tag: string;
  startedAtIso: string;
  finishedAtIso: string;
  /** ET timestamp, rendered for the record. */
  startedAtEt: string;
  deployedSha: string;
  steps: StepResult[];
  /** Messages sent during the walk. Null where unobservable (staging). */
  sentCount: number | null;
  /** True only when every step passed AND nothing was sent. */
  passed: boolean;
  verdict: string;
}

export function formatEt(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function etDateStamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function runTag(specId: string, date: Date): string {
  // Crypto randomness, not Math.random: the tag becomes the realdb org
  // slug/name and the `${tag}-user` / `${tag}-owner` identities, and the
  // staging persona slug — a security context (CodeQL js/insecure-randomness).
  const rand = randomBytes(4).toString("hex");
  return `walk-${specId}-${etDateStamp(date)}-${rand}`;
}

export class WalkCheckFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalkCheckFailed";
  }
}

export async function runWalk(
  spec: WalkSpec,
  driver: WalkDriver,
  opts?: { runId?: string; startedAt?: Date },
): Promise<WalkReport> {
  const errors = validateWalkSpec(spec);
  if (errors.length) {
    throw new Error(`walk spec ${spec.id} is invalid:\n- ${errors.join("\n- ")}`);
  }
  const startedAt = opts?.startedAt ?? new Date();
  const runId = opts?.runId ?? runTag(spec.id, startedAt);
  const tag = runId;
  const { orgId } = await driver.setupOrg(spec, tag);

  const memory = new Map<string, unknown>();
  const steps: StepResult[] = [];
  let stopped = false;
  let walkError: string | undefined;

  try {
    for (const step of spec.steps) {
      const stepStarted = Date.now();
      const notes: string[] = [];
      const ctx: WalkContext = {
        orgId,
        driver: driver.name,
        tag,
        api: driver.api,
        sql: driver.sql,
        check: (condition, message) => {
          if (!condition) throw new WalkCheckFailed(message);
        },
        store: (key, value) => {
          memory.set(key, value);
        },
        get: <T = unknown>(key: string): T => {
          if (!memory.has(key)) throw new WalkCheckFailed(`walk memory has no key ${JSON.stringify(key)}`);
          return memory.get(key) as T;
        },
        note: (text) => {
          notes.push(text);
        },
        // Wrapped, not extracted: a driver's sentCount may read its own
        // instance state, which an unbound extraction would lose.
        sentCount: () => driver.sentCount(),
      };

      // The Pax leg with no tools yet: record the block, do not execute a
      // leg that would have to pretend. The walk continues; `passed`
      // stays false (see below).
      if (step.kind === "pax" && step.paxState === "blocked") {
        steps.push({
          id: step.id,
          title: step.title,
          kind: step.kind,
          status: "blocked",
          observed: { blockedReason: step.paxBlockedReason ?? "Pax tools for this vertical do not exist yet" },
          notes,
          durationMs: Date.now() - stepStarted,
        });
        continue;
      }

      // Manual steps are operator acts: the runner records them as NOT RUN
      // rather than executing or inventing them. On staging, any step whose
      // staging mode is "manual" is manual too (e.g. a sql leg whose
      // staging equivalent is a UI act). Values the step collects (ids of
      // records the operator created) are gathered first and stored for
      // later steps; a missing value fails the walk loudly instead of
      // proceeding on an invented id. The walk continues past a manual
      // step — the next step fails honestly if the act did not happen —
      // but `passed` stays false while any step is manual.
      const isManualStep =
        step.kind === "manual" || (driver.name === "staging" && step.staging?.mode === "manual");
      if (isManualStep) {
        const inputs: Record<string, string> = {};
        if (step.collects?.length) {
          if (!driver.collectManualInput) {
            steps.push({
              id: step.id,
              title: step.title,
              kind: step.kind,
              status: "fail",
              observed: {},
              notes,
              durationMs: Date.now() - stepStarted,
              error: `step ${step.id} collects operator values (${step.collects.map((c) => c.key).join(", ")}) but this driver cannot collect them`,
            });
            stopped = true;
            walkError = `step ${step.id} failed: driver cannot collect manual inputs`;
            break;
          }
          try {
            Object.assign(inputs, await driver.collectManualInput(step));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            steps.push({
              id: step.id,
              title: step.title,
              kind: step.kind,
              status: "fail",
              observed: {},
              notes,
              durationMs: Date.now() - stepStarted,
              error: message,
            });
            stopped = true;
            walkError = `step ${step.id} failed: ${message}`;
            break;
          }
          for (const c of step.collects) {
            if (inputs[c.key] === undefined || inputs[c.key] === "") {
              steps.push({
                id: step.id,
                title: step.title,
                kind: step.kind,
                status: "fail",
                observed: { collected: inputs },
                notes,
                durationMs: Date.now() - stepStarted,
                error: `step ${step.id}: missing manual input ${c.key} (${c.prompt})`,
              });
              stopped = true;
              walkError = `step ${step.id} failed: missing manual input ${c.key}`;
              break;
            }
            memory.set(c.key, inputs[c.key]);
          }
          if (stopped) break;
        }
        steps.push({
          id: step.id,
          title: step.title,
          kind: step.kind,
          status: "manual",
          observed: { operatorAct: step.staging?.note ?? step.how, ...(Object.keys(inputs).length ? { collected: inputs } : {}) },
          notes,
          durationMs: Date.now() - stepStarted,
        });
        continue;
      }

      const leg = driver.name === "staging" && step.stagingRun ? step.stagingRun : step.run;
      try {
        const observation: StepObservation = await leg(ctx);
        steps.push({
          id: step.id,
          title: step.title,
          kind: step.kind,
          status: "pass",
          observed: observation.observed,
          notes: [...notes, ...(observation.notes ?? [])],
          durationMs: Date.now() - stepStarted,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        steps.push({
          id: step.id,
          title: step.title,
          kind: step.kind,
          status: "fail",
          observed: {},
          notes,
          durationMs: Date.now() - stepStarted,
          error: message,
        });
        stopped = true;
        walkError = `step ${step.id} failed: ${message}`;
        break;
      }
    }
  } finally {
    await driver.cleanup(spec, orgId);
  }

  const finishedAt = new Date();
  const sent = driver.sentCount();
  const allPassed = !stopped && steps.every((s) => s.status === "pass");
  const sentOk = sent === null || sent === 0;
  const passed = allPassed && sentOk;
  const blocked = steps.filter((s) => s.status === "blocked").map((s) => s.id);
  const manual = steps.filter((s) => s.status === "manual").map((s) => s.id);
  const verdict = passed
    ? "PASS"
    : stopped
      ? `FAIL — ${walkError ?? "walk stopped"}`
      : blocked.length
        ? `PARTIAL — Pax leg blocked (${blocked.join(", ")}); walk did not prove Pax wiring`
        : manual.length
          ? `PARTIAL — manual steps not run by this runner (${manual.join(", ")})`
          : sentOk
            ? "FAIL — a step did not pass"
            : `FAIL — ${String(sent)} message(s) sent during a no-send walk`;

  let deployedSha = "unknown";
  try {
    deployedSha = (await driver.version()).sha || "unknown";
  } catch {
    deployedSha = "unknown";
  }

  return {
    specId: spec.id,
    vertical: spec.vertical,
    specVersion: spec.version,
    runId,
    driver: driver.name,
    environment: driver.label,
    orgId,
    tag,
    startedAtIso: startedAt.toISOString(),
    finishedAtIso: finishedAt.toISOString(),
    startedAtEt: formatEt(startedAt),
    deployedSha,
    steps,
    sentCount: sent,
    passed,
    verdict,
  };
}

/**
 * Render the in-repo evidence record from a real run report. The deployed
 * SHA is the driver's own reading: on staging it is GET /api/version's
 * answer, verbatim — today that endpoint returns {"sha":"unknown"}, and the
 * record says so rather than carrying a SHA from anywhere else. A SHA from
 * any other source would be a fabrication; the record names the source.
 */
export function renderWalkRecord(
  report: WalkReport,
  opts?: { bundle?: { totalKb: number; ceilingKb: number; source: string } },
): string {
  const lines: string[] = [];
  lines.push(`# ${report.vertical} journey walk — ${report.verdict}`);
  lines.push("");
  lines.push(`**Spec:** \`${report.specId}\` v${report.specVersion} (journey-proof harness, declarative spec + machine-run).`);
  lines.push(`**Run id:** \`${report.runId}\``);
  lines.push(`**Started (ET):** ${report.startedAtEt}`);
  lines.push(`**Environment:** ${report.environment}`);
  const shaNote =
    report.driver === "realdb"
      ? " — rehearsal against a local checkout; no deployed image."
      : report.deployedSha === "unknown"
        ? " — staging's `/api/version` returns `{\"sha\":\"unknown\"}`; the SHA is recorded as unknown rather than taken from any other source."
        : " — read from staging's `/api/version`.";
  lines.push(`**Deployed image SHA:** \`${report.deployedSha}\`${shaNote}`);
  lines.push(`**Walk org:** id \`${String(report.orgId)}\` (fresh dedicated org, tag \`${report.tag}\`; no sample data).`);
  lines.push(`**Messages sent during the walk:** ${report.sentCount === null ? "not observable from outside staging — the fence is dry-run steps + the recipient-count assertions below" : String(report.sentCount)} (fence: no-send).`);
  lines.push("");
  const simulated = report.steps.filter((s) => s.status === "pass" && s.observed.simulated === true);
  if (simulated.length) {
    lines.push("## Simulation footnotes");
    lines.push("");
    lines.push("The following legs ran in simulation: the provider call was deliberately not made, so the simulation does not prove the real provider accepting the real call.");
    lines.push("");
    for (const s of simulated) {
      lines.push(`- **${s.id}**: ${String(s.observed.simulationNote ?? "simulated — see step")}`);
    }
    lines.push("");
  }
  lines.push("| # | Step | Result | Observed |");
  lines.push("|---|---|---|---|");
  report.steps.forEach((s, i) => {
    const observed = Object.entries(s.observed)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join("; ");
    const extra = s.error ? ` — ${s.error}` : "";
    lines.push(`| ${i + 1} | ${s.title} (\`${s.id}\`) | ${s.status.toUpperCase()} | ${observed || "—"}${extra} |`);
  });
  lines.push("");
  if (opts?.bundle) {
    lines.push("## Bundle evidence");
    lines.push("");
    lines.push(`Customer bundle **${opts.bundle.totalKb} KB** against the **${opts.bundle.ceilingKb} KB** ceiling in \`scripts/bundle-budget.json\` — ${opts.bundle.source}.`);
    lines.push("");
  }
  lines.push(`**Verdict: ${report.verdict}**`);
  lines.push("");
  return lines.join("\n");
}

/**
 * Write the record into the repo at docs/evidence/<date>/<vertical>-journey-walk.md.
 * Returns the repo-relative path written. The date is the run's ET date, so
 * the record's path and its timestamp can never disagree.
 */
export async function writeWalkRecord(
  report: WalkReport,
  repoRoot: string,
  opts?: { bundle?: { totalKb: number; ceilingKb: number; source: string } },
): Promise<string> {
  const dateStamp = etDateStamp(new Date(report.startedAtIso));
  const relPath = path.join("docs", "evidence", dateStamp, `${report.specId}-journey-walk.md`);
  const absPath = path.join(repoRoot, relPath);
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, renderWalkRecord(report, opts), "utf8");
  return relPath;
}
