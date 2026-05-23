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
      logger.warn({ url, status: res.status, body: text.slice(0, 200) }, "github api non-ok");
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
