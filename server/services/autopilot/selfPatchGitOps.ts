/**
 * Founder Autopilot — the REAL GitOps runner for the gated self-patch
 * (step-away gap #4: the immune system's hands).
 *
 * selfPatch.runGatedSelfPatch() takes an injected GitOps so the orchestration
 * is unit-testable; until now no real implementation existed, which is why the
 * immune system was "wired end-to-nowhere". This module is that implementation:
 * plain child-process git + npm, and a PR opened through the GitHub REST API.
 *
 * Capability preflight (assertSelfPatchCapable) — the runner refuses up front,
 * with a specific reason, unless ALL of:
 *   • the process is inside a git work tree with a CLEAN status (we will never
 *     mix an autonomous patch into unrelated local changes);
 *   • GITHUB_TOKEN and GITHUB_REPOSITORY ("owner/name") are set (no PR path,
 *     no point mutating anything).
 * A deployed image without a repo checkout simply reports "not capable" — the
 * immune report records that honestly instead of pretending the motor ran.
 *
 * Cleanup discipline: whatever happens after createBranch, the caller should
 * invoke restore() — it checks out the original branch and hard-resets the
 * package files so a failed attempt leaves no debris. node_modules may retain
 * the patch-level bumps until the next install; acceptable for the safe class
 * (patch-only) and gone on next deploy.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "../../utils/logger";
import type { GitOps } from "./selfPatch";
import type { DepChange } from "./codeChangeGate";
import { runNpmAudit } from "../external-watch/npmWatch";

const EXEC_TIMEOUT_MS = 5 * 60_000; // npm audit fix can be slow

function run(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: EXEC_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} ${args.join(" ")} failed: ${err.message}${stderr ? ` — ${String(stderr).slice(0, 500)}` : ""}`));
        return;
      }
      resolve(String(stdout));
    });
  });
}

/**
 * Pure: diff two package-lock v2/v3 documents into top-level dependency
 * version changes. Reads the `packages` map ("node_modules/<name>" keys) and
 * reports entries whose version changed. Nested (transitive) paths like
 * "node_modules/a/node_modules/b" are reported under their full dep name too —
 * codeChangeGate only cares that every change is a patch bump, wherever it sits.
 */
export function diffLockfilePackages(beforeRaw: string, afterRaw: string): DepChange[] {
  let before: Record<string, { version?: string }> = {};
  let after: Record<string, { version?: string }> = {};
  try {
    before = (JSON.parse(beforeRaw)?.packages ?? {}) as Record<string, { version?: string }>;
    after = (JSON.parse(afterRaw)?.packages ?? {}) as Record<string, { version?: string }>;
  } catch {
    return [];
  }
  const changes: DepChange[] = [];
  for (const [key, b] of Object.entries(after)) {
    if (!key.startsWith("node_modules/")) continue;
    const a = before[key];
    const name = key.replace(/^node_modules\//, "");
    if (a?.version && b?.version && a.version !== b.version) {
      changes.push({ name, fromVersion: a.version, toVersion: b.version });
    }
  }
  return changes;
}

export interface SelfPatchCapability {
  capable: boolean;
  reason: string;
}

/**
 * GitHub credentials — Platform Connections first (founder-pasted, no
 * redeploy), env fallback. Fail-soft to env-only if the connections layer
 * is unavailable.
 */
async function githubCreds(): Promise<{ token: string; repo: string }> {
  let token = process.env.GITHUB_TOKEN?.trim() ?? "";
  let repo = process.env.GITHUB_REPOSITORY?.trim() ?? "";
  try {
    const { resolveGithubCredentials } = await import("../connections/platformConnections");
    const resolved = await resolveGithubCredentials();
    token = resolved.token ?? token;
    repo = resolved.repository ?? repo;
  } catch { /* env-only */ }
  return { token, repo };
}

/** Preflight: can this environment actually run the motor half? Never throws. */
export async function assertSelfPatchCapable(cwd = process.cwd()): Promise<SelfPatchCapability> {
  const { token, repo } = await githubCreds();
  if (!token) {
    return { capable: false, reason: "GitHub token not connected (Control Center → Connections) and GITHUB_TOKEN unset — no PR path" };
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return { capable: false, reason: "GitHub repository not connected and GITHUB_REPOSITORY unset/malformed (expected owner/name) — no PR path" };
  }
  try {
    await run("git", ["rev-parse", "--is-inside-work-tree"], cwd);
  } catch {
    return { capable: false, reason: "not a git work tree (deployed image without a repo checkout)" };
  }
  try {
    const status = await run("git", ["status", "--porcelain"], cwd);
    if (status.trim().length > 0) {
      return { capable: false, reason: "git work tree not clean — refusing to mix an autonomous patch into local changes" };
    }
  } catch (err) {
    return { capable: false, reason: `git status failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { capable: true, reason: "git work tree clean + PR credentials present" };
}

export interface RealGitOps extends GitOps {
  /** Best-effort: return to the original branch and drop package-file changes. */
  restore(): Promise<void>;
}

/**
 * Construct the real runner. Call assertSelfPatchCapable() FIRST — this
 * factory assumes the preflight passed and does not re-verify.
 */
export function createSelfPatchGitOps(cwd = process.cwd()): RealGitOps {
  const lockPath = path.join(cwd, "package-lock.json");
  let originalBranch: string | null = null;

  return {
    async audit(): Promise<unknown> {
      return JSON.parse(await runNpmAudit(cwd));
    },

    async createBranch(name: string): Promise<void> {
      originalBranch = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd)).trim();
      await run("git", ["checkout", "-b", name], cwd);
    },

    async runAuditFix(): Promise<{ files: string[]; depChanges: DepChange[] }> {
      const lockBefore = await readFile(lockPath, "utf8").catch(() => "{}");
      // No --force: npm refuses semver-major fixes on its own, which is
      // exactly the safe class. codeChangeGate still verdicts the real diff.
      await run("npm", ["audit", "fix", "--no-fund", "--no-audit"], cwd).catch((err) => {
        // npm audit fix exits non-zero when some advisories remain unfixed —
        // that's expected (the witnessed/skip classes). The diff below is the
        // ground truth of what changed.
        logger.info(`[selfPatchGitOps] npm audit fix exited non-zero (expected when advisories remain): ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
      });
      const lockAfter = await readFile(lockPath, "utf8").catch(() => "{}");
      const status = await run("git", ["status", "--porcelain"], cwd);
      const files = status
        .split("\n")
        .map((l) => l.slice(3).trim())
        .filter((f) => f.length > 0);
      return { files, depChanges: diffLockfilePackages(lockBefore, lockAfter) };
    },

    async commit(message: string): Promise<void> {
      // Stage ONLY the safe-class files — anything else the fix touched should
      // already have flunked codeChangeGate before we get here.
      await run("git", ["add", "package.json", "package-lock.json"], cwd);
      await run("git", ["commit", "-m", message], cwd);
    },

    async push(branch: string): Promise<void> {
      await run("git", ["push", "-u", "origin", branch], cwd);
    },

    async openPr(branch: string, title: string, body: string): Promise<string> {
      const { token, repo } = await githubCreds();
      const base = process.env.GITHUB_DEFAULT_BRANCH ?? "main";
      const res = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, head: branch, base, body }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`GitHub PR create failed: HTTP ${res.status} — ${detail.slice(0, 500)}`);
      }
      const pr = (await res.json()) as { html_url?: string };
      if (!pr.html_url) throw new Error("GitHub PR create returned no html_url");
      return pr.html_url;
    },

    async restore(): Promise<void> {
      try {
        await run("git", ["checkout", "--", "package.json", "package-lock.json"], cwd).catch(() => undefined);
        if (originalBranch) {
          await run("git", ["checkout", originalBranch], cwd);
        }
      } catch (err) {
        logger.warn(
          `[selfPatchGitOps] restore failed — repo may be left on the patch branch: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
