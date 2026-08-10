/**
 * Self-patch-cannot-merge ratchet — the structural half of
 * `hard-stop.self-patch-never-merges` (master-handoff item F3, "eternal lines").
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 * The autopilot's self-patch motor (selfPatch.ts orchestration +
 * selfPatchGitOps.ts runner) is allowed to do exactly one dangerous thing:
 * open a PULL REQUEST for a safe-class dependency patch bump. Its doctrine
 * says "It opens a PULL REQUEST. It NEVER merges to main" — but until this
 * file, that line was prose plus the absence of a merge member on an
 * interface. One added method, one extra fetch to the merge endpoint, or one
 * `git push origin main` would silently cross the line and every test would
 * stay green.
 *
 * This ratchet makes the line structural, mirroring
 * moneyCustodyHardStop.test.ts: the merge-capability SHAPES appear NOWHERE
 * under server/services/autopilot/, the runner's operation surface is exactly
 * the declared set, and the git staging allowlist is exactly the two package
 * files. No DATABASE_URL, no runtime mocking for the scans — a filesystem
 * scan cannot be defeated by a vi.mock.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HONEST SCOPE — what this ratchet CANNOT prove
 * ═══════════════════════════════════════════════════════════════════════════
 * GitHub-side credential separation is a FOUNDER action outside this repo:
 * a fine-grained PAT for the self-patch that lacks merge/administration
 * rights, and branch protection (required reviews + status checks) on the
 * default branch. If the token in GITHUB_TOKEN can merge, nothing in this
 * repo prevents a FUTURE code change from using it — this ratchet only
 * guarantees the code as written holds no merge capability and that adding
 * one produces a loud, reviewable diff (which codeChangeGate additionally
 * forbids the immune system from authoring autonomously). We state that
 * limitation instead of claiming remote-side enforcement we do not have.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { invariantById } from "@shared/governance/constitution";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ROOT = path.resolve(__dirname, "../..");
const AUTOPILOT_DIR = "server/services/autopilot";

// ───────────────────────────────────────────────────────────────────────────
// Scanner (same comment-stripping discipline as moneyCustodyHardStop.test.ts)
// ───────────────────────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    const st = fs.lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Non-test .ts files under server/services/autopilot/, repo-relative. */
function autopilotSourceFiles(): string[] {
  return walk(path.join(ROOT, AUTOPILOT_DIR))
    .map((abs) => path.relative(ROOT, abs).split(path.sep).join("/"))
    .filter((rel) => /\.ts$/.test(rel) && !/\.(test|spec)\.ts$/.test(rel));
}

/** Lines matching `pattern`, skipping pure comment lines (doc prose may NAME a banned shape). */
function grepAutopilot(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const rel of autopilotSourceFiles()) {
    const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      if (pattern.test(lines[i])) hits.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
    }
  }
  return hits;
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Merge-capability shapes exist nowhere under the autopilot tree
// ───────────────────────────────────────────────────────────────────────────

/**
 * Every one of these is a way to LAND a change rather than propose one:
 *   /merge, /merges       — the GitHub REST merge endpoints
 *                           (PUT /pulls/{n}/merge, POST /repos/{r}/merges);
 *   merge_method          — the REST merge parameter;
 *   mergePullRequest      — the GraphQL mutation (either casing convention);
 *   a bare quoted "merge" — the argv token of `git merge`;
 *   git merge (textual)   — a shelled-out local merge;
 *   auto-merge enablement — enablePullRequestAutoMerge / auto_merge.
 * Identifiers that merely CONTAIN "merge" (autoMergeEarned, prose strings)
 * deliberately do not match — this hunts capability, not vocabulary.
 */
const MERGE_CAPABILITY_SHAPES =
  /\/merges?\b|merge_method|mergePullRequest|merge_pull_request|["'`]merge["'`]|git\s+merge\b|enablePullRequestAutoMerge|enable_pull_request_auto_merge|\bauto_merge\s*:/;

describe("self-patch cannot merge — no merge capability anywhere in the autopilot", () => {
  it("names no merge-capability shape in any autopilot source file", () => {
    const offenders = grepAutopilot(MERGE_CAPABILITY_SHAPES);
    expect(
      offenders,
      "The self-patch motor may only OPEN a pull request " +
        "(hard-stop.self-patch-never-merges). A merge endpoint, merge " +
        "parameter, or git-merge argv token under server/services/autopilot/ " +
        "means the autopilot is growing the capability to land its own " +
        `change — only the founder may rescind that hard stop. Offenders:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("never force-pushes and never pushes a named default branch", () => {
    // The only sanctioned push is `["push", "-u", "origin", branch]` where
    // `branch` is the freshly created autopilot/security-patch-* branch.
    const force = grepAutopilot(/["'](--force|--force-with-lease|-f)["']/);
    expect(force, `force-push tokens found:\n${force.join("\n")}`).toEqual([]);
    const defaultBranchPush = grepAutopilot(/\[\s*["']push["'][^\]]*["'](main|master)["']/);
    expect(
      defaultBranchPush,
      `a git push naming the default branch found:\n${defaultBranchPush.join("\n")}`,
    ).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. The runner's operation surface is exactly the declared set
// ───────────────────────────────────────────────────────────────────────────

describe("self-patch cannot merge — the GitOps surface is closed", () => {
  it("the GitOps interface declares exactly the six proposal-only operations", async () => {
    // Read the interface block from source: a merge member added to the TYPE
    // must show up here even before any implementation exists.
    const src = fs.readFileSync(
      path.join(ROOT, "server/services/autopilot/selfPatch.ts"),
      "utf8",
    );
    const block = /export interface GitOps \{([\s\S]*?)\n\}/.exec(src);
    expect(block, "GitOps interface not found in selfPatch.ts").toBeTruthy();
    const members = [...block![1].matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1]).sort();
    expect(members).toEqual(
      ["audit", "commit", "createBranch", "openPr", "push", "runAuditFix"].sort(),
    );
  });

  it("createSelfPatchGitOps returns exactly the declared keys (GitOps + restore)", async () => {
    const { createSelfPatchGitOps } = await import(
      "../../server/services/autopilot/selfPatchGitOps"
    );
    const ops = createSelfPatchGitOps("/tmp/never-used");
    expect(Object.keys(ops).sort()).toEqual(
      ["audit", "commit", "createBranch", "openPr", "push", "restore", "runAuditFix"].sort(),
    );
  });

  it("stages ONLY the two package files (the safe-class allowlist) and pushes only the feature branch", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "server/services/autopilot/selfPatchGitOps.ts"),
      "utf8",
    );
    // The exact staging allowlist — nothing else may ever be committed.
    expect(src).toContain('["add", "package.json", "package-lock.json"]');
    const addCalls = src.match(/\[\s*["']add["']/g) ?? [];
    expect(addCalls, "exactly one git-add call site").toHaveLength(1);
    // The exact push — the caller-created feature branch, nothing literal.
    expect(src).toContain('["push", "-u", "origin", branch]');
    const pushCalls = src.match(/\[\s*["']push["']/g) ?? [];
    expect(pushCalls, "exactly one git-push call site").toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. The constitution entry is real and resolves
// ───────────────────────────────────────────────────────────────────────────

describe("self-patch cannot merge — registered as a machine-enforced hard stop", () => {
  it("hard-stop.self-patch-never-merges exists, is a code-invariant, and its refs resolve", () => {
    const inv = invariantById("hard-stop.self-patch-never-merges");
    expect(inv, "constitution entry missing").toBeTruthy();
    expect(inv!.category).toBe("hard-stop");
    expect(inv!.enforcement.kind).toBe("code-invariant");
    for (const ref of [
      "server/services/autopilot/selfPatch.ts",
      "server/services/autopilot/selfPatchGitOps.ts",
      "tests/unit/selfPatchCannotMerge.test.ts",
    ]) {
      expect(inv!.enforcement.refs, `ref ${ref} must be declared`).toContain(ref);
      expect(fs.existsSync(path.join(ROOT, ref)), `${ref} must exist`).toBe(true);
    }
    // The honest-scope caveat must survive: the note names the GitHub-side
    // founder controls this ratchet cannot prove, so nobody later reads the
    // entry as claiming remote-side enforcement.
    expect(inv!.enforcement.note ?? "").toContain("HONEST SCOPE");
  });
});
