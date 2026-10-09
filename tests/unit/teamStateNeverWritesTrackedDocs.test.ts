/**
 * The running server never writes a tracked repository file.
 *
 * The Solene team-state regenerator (a 15-minute job in runScheduledJobs) ran
 * scripts/regenerate-team-state.mjs, which wrote docs/internal/solene-team-
 * state.md — a TRACKED file — on every host where FLY_APP_NAME was unset. It
 * now writes the runtime copy (server/services/solene/teamState.ts), and the
 * script refuses a target inside docs/ unless told --repo-doc.
 *
 * Population: every tracked file under docs/ (`git ls-files docs`), hashed
 * before and after the server's own code path runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = resolve(__dirname, "../..");
const TRACKED = join(ROOT, "docs/internal/solene-team-state.md");

function trackedDocsDigest(): Map<string, string> {
  const files = execFileSync("git", ["ls-files", "docs"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const out = new Map<string, string>();
  for (const f of files) {
    const p = join(ROOT, f);
    out.set(f, existsSync(p) ? createHash("sha1").update(readFileSync(p)).digest("hex") : "(absent)");
  }
  return out;
}

let tmp: string;
const saved = { path: process.env.SOLENE_TEAM_STATE_PATH, legacy: process.env.SOLENE_DISPATCH_TEAM_STATE_PATH };
beforeEach(() => {
  tmp = mkdtempSync(join(os.tmpdir(), "team-state-test-"));
  delete process.env.SOLENE_TEAM_STATE_PATH;
  delete process.env.SOLENE_DISPATCH_TEAM_STATE_PATH;
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  if (saved.path === undefined) delete process.env.SOLENE_TEAM_STATE_PATH;
  else process.env.SOLENE_TEAM_STATE_PATH = saved.path;
  if (saved.legacy === undefined) delete process.env.SOLENE_DISPATCH_TEAM_STATE_PATH;
  else process.env.SOLENE_DISPATCH_TEAM_STATE_PATH = saved.legacy;
});

describe("the server's team-state regeneration", () => {
  it("writes the runtime copy, seeded from the tracked doc, and leaves every tracked docs/ file byte-identical", async () => {
    const before = trackedDocsDigest();
    expect(before.size, "vacuity: git ls-files docs found nothing").toBeGreaterThan(1000);
    expect(before.has("docs/internal/solene-team-state.md")).toBe(true);

    process.env.SOLENE_TEAM_STATE_PATH = join(tmp, "team-state.md");
    const { regenerateTeamState } = await import("../../server/services/solene/teamState");
    const written = await regenerateTeamState({ cwd: ROOT });

    expect(written).toBe(join(tmp, "team-state.md"));
    const runtime = readFileSync(written, "utf8");
    expect(runtime).toMatch(/<!-- AUTO -->[\s\S]*<!-- \/AUTO -->/);
    // Seeded: the hand-maintained text outside AUTO comes from the tracked doc.
    const trackedTail = readFileSync(TRACKED, "utf8").split("<!-- /AUTO -->")[1];
    expect(runtime.split("<!-- /AUTO -->")[1]).toBe(trackedTail);

    const after = trackedDocsDigest();
    const changed = [...before].filter(([f, h]) => after.get(f) !== h).map(([f]) => f);
    expect(changed).toEqual([]);
  });

  it("with no override the runtime path is outside the repository", async () => {
    const { runtimeTeamStatePath } = await import("../../server/services/solene/teamState");
    const p = resolve(runtimeTeamStatePath());
    expect(p.startsWith(ROOT + "/")).toBe(false);
  });
});

describe("the script refuses to write tracked docs implicitly", () => {
  const run = (env: Record<string, string>, args: string[] = []) =>
    spawnSync(process.execPath, [join(ROOT, "scripts/regenerate-team-state.mjs"), ...args], {
      cwd: ROOT,
      env: { ...process.env, SOLENE_TEAM_STATE_SKIP_HEALTHCHECK: "1", SOLENE_TEAM_STATE_PATH: "", ...env },
      encoding: "utf8",
    });

  it("no target → exit 2, nothing written", () => {
    const before = readFileSync(TRACKED);
    const r = run({});
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/no target/);
    expect(readFileSync(TRACKED).equals(before)).toBe(true);
  });

  it("a target inside docs/ (by env or --out) → exit 2 unless --repo-doc", () => {
    const before = readFileSync(TRACKED);
    expect(run({ SOLENE_TEAM_STATE_PATH: TRACKED }).status).toBe(2);
    expect(run({}, ["--out", join(ROOT, "docs/internal/other.md")]).status).toBe(2);
    expect(readFileSync(TRACKED).equals(before)).toBe(true);
    expect(existsSync(join(ROOT, "docs/internal/other.md"))).toBe(false);
  });
});

describe("the reader and the job use the runtime path", () => {
  it("dispatchRunner reads runtimeTeamStatePath(); the job calls regenerateTeamState()", () => {
    const runner = stripComments(readFileSync(join(ROOT, "server/services/solene/dispatchRunner.ts"), "utf8"));
    expect(runner).toMatch(/const TEAM_STATE_PATH = runtimeTeamStatePath\(\);/);
    expect(runner).not.toMatch(/docs\/internal\/solene-team-state\.md/);
    const jobs = stripComments(readFileSync(join(ROOT, "server/jobs/runScheduledJobs.ts"), "utf8"));
    const body = jobs.slice(jobs.indexOf("async function processSoleneTeamStateRegenerator"));
    expect(body.slice(0, 400)).toMatch(/regenerateTeamState\(\)/);
    expect(jobs).not.toMatch(/regenerate-team-state\.mjs/);
  });
});
