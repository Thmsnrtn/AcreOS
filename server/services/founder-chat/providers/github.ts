/**
 * GitHub REST API client for Atlas operational hands (Phase H batch 1).
 *
 * Thin wrapper around the GitHub REST API at https://api.github.com using
 * a fine-grained personal access token from GITHUB_FINE_GRAINED_TOKEN.
 * Owner/repo default to the AcreOS repo and can be overridden via
 * GITHUB_REPO_OWNER / GITHUB_REPO_NAME env vars.
 *
 * Mirrors the graceful-degradation pattern in providers/fly.ts — when the
 * token is unset, every call throws a GithubClientError with status 503
 * so callers can render a friendly fallback artifact rather than crash.
 *
 * READ-ONLY methods only in this drop (Phase H batch 1):
 *   - searchCode(query, fileGlob?)
 *   - readFile(path, ref?)
 *   - listCommits(branch='main', limit=20)
 *   - getCommitDiff(sha)
 *   - blameLine(path, line)  — closest approximation via REST; true blame
 *                              requires the GraphQL API.
 *   - getCheckRuns(ref)
 *
 * Destructive operations (PR creation, merge, comments, issues, workflow
 * dispatch) land in Phase H batch 2 with the sealed-paste flow + Tier-3
 * confirmation per the founder-chat plan.
 */

import { logger } from "../../../utils/logger";

export const GITHUB_API_BASE = "https://api.github.com";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface GithubSearchCodeItem {
  name: string;
  path: string;
  sha: string;
  html_url: string;
  repository?: { full_name: string };
  text_matches?: Array<{ fragment: string }>;
}

export interface GithubSearchCodeResult {
  total_count: number;
  incomplete_results: boolean;
  items: GithubSearchCodeItem[];
}

export interface GithubContentFile {
  type: "file";
  encoding: "base64" | string;
  size: number;
  name: string;
  path: string;
  content: string; // base64-encoded when encoding === "base64"
  sha: string;
  html_url: string;
}

export interface GithubCommitListEntry {
  sha: string;
  html_url: string;
  commit: {
    author?: { name?: string; email?: string; date?: string };
    committer?: { name?: string; email?: string; date?: string };
    message: string;
  };
  author?: { login?: string } | null;
}

export interface GithubCommitDiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface GithubCommitDiff {
  sha: string;
  html_url: string;
  commit: GithubCommitListEntry["commit"];
  stats?: { additions: number; deletions: number; total: number };
  files: GithubCommitDiffFile[];
}

export interface GithubCheckRun {
  id: number;
  name: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | neutral | cancelled | skipped | timed_out | action_required
  html_url: string;
  started_at?: string;
  completed_at?: string;
}

export interface GithubCheckRunsResponse {
  total_count: number;
  check_runs: GithubCheckRun[];
}

export class GithubClientError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "GithubClientError";
    this.status = status;
    this.body = body;
  }
}

function token(): string {
  const t = process.env.GITHUB_FINE_GRAINED_TOKEN;
  if (!t) {
    throw new GithubClientError(
      "GITHUB_FINE_GRAINED_TOKEN not configured — GitHub tools unavailable in this environment",
      503,
      "",
    );
  }
  return t;
}

export function repoOwner(): string {
  return process.env.GITHUB_REPO_OWNER ?? "Thmsnrtn";
}

export function repoName(): string {
  return process.env.GITHUB_REPO_NAME ?? "AcreOS";
}

function repoSlug(): string {
  return `${repoOwner()}/${repoName()}`;
}

async function gh<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `${GITHUB_API_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      logger.warn("github api non-ok", { url, status: res.status, body: text.slice(0, 200) });
      throw new GithubClientError(`GitHub API ${res.status} on ${path}`, res.status, text);
    }
    return text ? (JSON.parse(text) as T) : ({} as T);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Search the repo for code matching `query`. Optional `fileGlob` adds a
 * `path:` qualifier (e.g. "*.ts"). Uses GET /search/code with `q=…`.
 */
export async function searchCode(
  query: string,
  fileGlob?: string,
): Promise<GithubSearchCodeResult> {
  const parts = [query, `repo:${repoSlug()}`];
  if (fileGlob) parts.push(`path:${fileGlob}`);
  const q = encodeURIComponent(parts.join(" "));
  return gh<GithubSearchCodeResult>(`/search/code?q=${q}&per_page=20`);
}

/** Read a file's raw content. `ref` defaults to the repo's default branch. */
export async function readFile(
  path: string,
  ref?: string,
): Promise<GithubContentFile> {
  const safePath = path.split("/").map(encodeURIComponent).join("/");
  const refQ = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  return gh<GithubContentFile>(
    `/repos/${repoOwner()}/${repoName()}/contents/${safePath}${refQ}`,
  );
}

/** List recent commits on a branch (default: main). */
export async function listCommits(
  branch = "main",
  limit = 20,
): Promise<GithubCommitListEntry[]> {
  const data = await gh<GithubCommitListEntry[]>(
    `/repos/${repoOwner()}/${repoName()}/commits?sha=${encodeURIComponent(branch)}&per_page=${Math.min(limit, 100)}`,
  );
  return Array.isArray(data) ? data.slice(0, limit) : [];
}

/** Get a single commit with file-level patches. */
export async function getCommitDiff(sha: string): Promise<GithubCommitDiff> {
  return gh<GithubCommitDiff>(
    `/repos/${repoOwner()}/${repoName()}/commits/${encodeURIComponent(sha)}`,
  );
}

/**
 * "Blame" approximation — true line-level blame requires the GraphQL
 * API. We return the most recent commit that touched the file as a
 * useful proxy for "who/when did this file last change?". Callers
 * should communicate this caveat in the rendered artifact.
 */
export async function blameLine(
  path: string,
  _line: number,
): Promise<GithubCommitListEntry | null> {
  const data = await gh<GithubCommitListEntry[]>(
    `/repos/${repoOwner()}/${repoName()}/commits?path=${encodeURIComponent(path)}&per_page=1`,
  );
  return Array.isArray(data) && data.length ? data[0] : null;
}

/** Check-run status for a ref (sha, branch, or tag). */
export async function getCheckRuns(ref: string): Promise<GithubCheckRunsResponse> {
  return gh<GithubCheckRunsResponse>(
    `/repos/${repoOwner()}/${repoName()}/commits/${encodeURIComponent(ref)}/check-runs`,
  );
}

/** Latest commit sha on main (or the named branch). */
export async function latestMainSha(branch = "main"): Promise<string> {
  const data = await gh<{ commit: { sha: string } }>(
    `/repos/${repoOwner()}/${repoName()}/branches/${encodeURIComponent(branch)}`,
  );
  return data?.commit?.sha;
}

// ─── Destructive operations (Phase G/H/I batch 2) ───────────────────────────
// Only invoked from a confirmed Tier-3 tool handler. The fine-grained PAT
// is scoped to the AcreOS repo only (Tom decision #12, 2026-05-23).

export interface GithubPullRequest {
  number: number;
  html_url: string;
  title: string;
  state: string;
  merged: boolean;
  draft: boolean;
  head: { sha: string; ref: string };
  base: { sha: string; ref: string };
  user?: { login?: string };
}

export interface GithubIssue {
  number: number;
  html_url: string;
  title: string;
  state: string;
  labels: Array<{ name: string }>;
}

/**
 * Create a branch from a base ref. Idempotent for the same ref — POST to
 * /git/refs returns 422 if the ref already exists; we surface that as a
 * GithubClientError the caller can handle.
 */
export async function createBranch(
  branchName: string,
  fromSha: string,
): Promise<{ ok: boolean }> {
  await gh(`/repos/${repoOwner()}/${repoName()}/git/refs`, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: fromSha,
    }),
  });
  return { ok: true };
}

/**
 * Create-or-update a file on a branch. The contents API accepts a
 * base64-encoded value + a `sha` (the existing file's blob sha when
 * updating). The caller must supply `sha` when overwriting.
 */
export async function putFileOnBranch(
  branchName: string,
  path: string,
  contentBase64: string,
  message: string,
  existingSha?: string,
): Promise<{ commitSha: string }> {
  const safePath = path.split("/").map(encodeURIComponent).join("/");
  const body: Record<string, unknown> = {
    message,
    content: contentBase64,
    branch: branchName,
  };
  if (existingSha) body.sha = existingSha;
  const data = await gh<{ commit?: { sha?: string } }>(
    `/repos/${repoOwner()}/${repoName()}/contents/${safePath}`,
    { method: "PUT", body: JSON.stringify(body) },
  );
  return { commitSha: data?.commit?.sha ?? "" };
}

export async function createPullRequest(
  branchName: string,
  title: string,
  body: string,
  base = "main",
): Promise<GithubPullRequest> {
  return gh<GithubPullRequest>(`/repos/${repoOwner()}/${repoName()}/pulls`, {
    method: "POST",
    body: JSON.stringify({ title, body, head: branchName, base }),
  });
}

export async function mergePullRequest(
  prNumber: number,
  squash = true,
): Promise<{ merged: boolean; sha?: string; message: string }> {
  const data = await gh<{ merged: boolean; sha?: string; message: string }>(
    `/repos/${repoOwner()}/${repoName()}/pulls/${prNumber}/merge`,
    {
      method: "PUT",
      body: JSON.stringify({ merge_method: squash ? "squash" : "merge" }),
    },
  );
  return data;
}

export async function getPullRequest(prNumber: number): Promise<GithubPullRequest> {
  return gh<GithubPullRequest>(
    `/repos/${repoOwner()}/${repoName()}/pulls/${prNumber}`,
  );
}

export async function commentOnPr(
  prNumber: number,
  body: string,
): Promise<{ id: number; html_url: string }> {
  return gh<{ id: number; html_url: string }>(
    `/repos/${repoOwner()}/${repoName()}/issues/${prNumber}/comments`,
    { method: "POST", body: JSON.stringify({ body }) },
  );
}

export async function createIssue(
  title: string,
  body: string,
  labels?: string[],
): Promise<GithubIssue> {
  return gh<GithubIssue>(`/repos/${repoOwner()}/${repoName()}/issues`, {
    method: "POST",
    body: JSON.stringify({ title, body, labels: labels ?? [] }),
  });
}

/**
 * Dispatch a workflow_dispatch event on a workflow filename. Inputs map
 * to the workflow's `on.workflow_dispatch.inputs` section.
 */
export async function dispatchWorkflow(
  workflowFile: string,
  ref: string,
  inputs?: Record<string, string>,
): Promise<{ ok: true }> {
  await gh(
    `/repos/${repoOwner()}/${repoName()}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`,
    {
      method: "POST",
      body: JSON.stringify({ ref, inputs: inputs ?? {} }),
    },
  );
  return { ok: true };
}
