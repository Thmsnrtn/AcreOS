/**
 * Phase H batch 1 read-only operations tools — GitHub batch.
 *
 * Stubs global.fetch so we exercise the tool registration + handler
 * pipeline without hitting the live GitHub API. Verifies:
 *   - 6 tools register and resolve via slash aliases
 *   - read_file truncates files larger than 4 KB
 *   - repo_search returns "no matches" message on empty result
 *   - view_ci_status shows ✓ for success and ✗ for failure
 *   - missing GITHUB_FINE_GRAINED_TOKEN degrades to graceful text
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetRegistryForTests,
  getTool,
  getToolBySlashAlias,
} from "../../server/services/founder-chat/tool-registry";

let realFetch: typeof globalThis.fetch;
let realToken: string | undefined;

beforeAll(async () => {
  __resetRegistryForTests();
  await import("../../server/services/founder-chat/tools/operations");
});

afterAll(() => {
  __resetRegistryForTests();
});

function stubFetchOk(payload: unknown) {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  ) as unknown as typeof globalThis.fetch;
}

const FAKE_CTX = {
  founderUserId: "user_test",
  organizationId: 1,
  threadId: 1,
  recentMentions: [],
  auditLog: async () => {},
} as const;

beforeEach(() => {
  realFetch = globalThis.fetch;
  realToken = process.env.GITHUB_FINE_GRAINED_TOKEN;
  process.env.GITHUB_FINE_GRAINED_TOKEN = "test_gh_token";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realToken === undefined) delete process.env.GITHUB_FINE_GRAINED_TOKEN;
  else process.env.GITHUB_FINE_GRAINED_TOKEN = realToken;
  vi.restoreAllMocks();
});

describe("founder-chat operations tools — GitHub", () => {
  it("registers all 6 GitHub tools and resolves via slash aliases", () => {
    expect(getTool("repo_search")?.name).toBe("repo_search");
    expect(getTool("read_file")?.name).toBe("read_file");
    expect(getTool("git_log")?.name).toBe("git_log");
    expect(getTool("git_diff")?.name).toBe("git_diff");
    expect(getTool("git_blame")?.name).toBe("git_blame");
    expect(getTool("view_ci_status")?.name).toBe("view_ci_status");

    expect(getToolBySlashAlias("grep")?.name).toBe("repo_search");
    expect(getToolBySlashAlias("repo-search")?.name).toBe("repo_search");
    expect(getToolBySlashAlias("cat")?.name).toBe("read_file");
    expect(getToolBySlashAlias("read-file")?.name).toBe("read_file");
    expect(getToolBySlashAlias("log")?.name).toBe("git_log");
    expect(getToolBySlashAlias("diff")?.name).toBe("git_diff");
    expect(getToolBySlashAlias("blame")?.name).toBe("git_blame");
    expect(getToolBySlashAlias("ci")?.name).toBe("view_ci_status");
  });

  it("read_file truncates files larger than 4 KB", async () => {
    const bigContent = "A".repeat(8000);
    const b64 = Buffer.from(bigContent, "utf8").toString("base64");
    stubFetchOk({
      type: "file",
      encoding: "base64",
      size: 8000,
      name: "big.txt",
      path: "big.txt",
      content: b64,
      sha: "abc",
      html_url: "https://example",
    });

    const tool = getTool("read_file")!;
    const result = await tool.handler({ path: "big.txt" }, FAKE_CTX);
    expect(result.artifact.type).toBe("text");
    if (result.artifact.type === "text") {
      const md = result.artifact.markdown as string;
      expect(md).toMatch(/truncated/);
      expect(md).toMatch(/8000 bytes/);
      // The fenced block should not contain all 8000 chars.
      const fence = md.split("```")[1] ?? "";
      // Strip leading newline.
      const body = fence.replace(/^\n/, "").replace(/\n$/, "");
      expect(body.length).toBeLessThanOrEqual(4096);
    }
  });

  it("read_file returns full content when under the 4 KB cap", async () => {
    const small = "hello world";
    stubFetchOk({
      type: "file",
      encoding: "base64",
      size: small.length,
      name: "tiny.txt",
      path: "tiny.txt",
      content: Buffer.from(small).toString("base64"),
      sha: "def",
      html_url: "https://example",
    });
    const tool = getTool("read_file")!;
    const result = await tool.handler({ path: "tiny.txt" }, FAKE_CTX);
    if (result.artifact.type === "text") {
      expect(result.artifact.markdown).toMatch(/hello world/);
      expect(result.artifact.markdown).not.toMatch(/truncated/);
    }
  });

  it("repo_search returns a 'no matches' message on empty result", async () => {
    stubFetchOk({ total_count: 0, incomplete_results: false, items: [] });
    const tool = getTool("repo_search")!;
    const result = await tool.handler({ query: "nonexistent_symbol_xyz" }, FAKE_CTX);
    expect(result.artifact.type).toBe("text");
    if (result.artifact.type === "text") {
      expect(result.artifact.markdown).toMatch(/No matches/);
      expect(result.artifact.markdown).toMatch(/nonexistent_symbol_xyz/);
    }
  });

  it("repo_search renders match list when items present", async () => {
    stubFetchOk({
      total_count: 2,
      incomplete_results: false,
      items: [
        { name: "a.ts", path: "src/a.ts", sha: "1", html_url: "u" },
        { name: "b.ts", path: "src/b.ts", sha: "2", html_url: "u" },
      ],
    });
    const tool = getTool("repo_search")!;
    const result = await tool.handler({ query: "foo" }, FAKE_CTX);
    if (result.artifact.type === "text") {
      expect(result.artifact.markdown).toMatch(/src\/a\.ts/);
      expect(result.artifact.markdown).toMatch(/src\/b\.ts/);
      expect(result.artifact.markdown).toMatch(/2 matches/);
    }
  });

  it("view_ci_status shows ✓ for success and ✗ for failure", async () => {
    stubFetchOk({
      total_count: 2,
      check_runs: [
        {
          id: 1,
          name: "build",
          status: "completed",
          conclusion: "success",
          html_url: "u",
        },
        {
          id: 2,
          name: "test",
          status: "completed",
          conclusion: "failure",
          html_url: "u",
        },
      ],
    });
    const tool = getTool("view_ci_status")!;
    const result = await tool.handler({}, FAKE_CTX);
    expect(result.artifact.type).toBe("text");
    if (result.artifact.type === "text") {
      const md = result.artifact.markdown as string;
      expect(md).toMatch(/✓ \*\*build\*\*/);
      expect(md).toMatch(/✗ \*\*test\*\*/);
      expect(md).toMatch(/success/);
      expect(md).toMatch(/failure/);
    }
  });

  it("git_log renders commit list with sha, subject, author", async () => {
    stubFetchOk([
      {
        sha: "abcdef1234567890",
        html_url: "u",
        commit: {
          author: { name: "Thomas", date: "2026-05-01T12:00:00Z" },
          message: "feat: add thing\n\nbody",
        },
        author: { login: "Thmsnrtn" },
      },
    ]);
    const tool = getTool("git_log")!;
    const result = await tool.handler({}, FAKE_CTX);
    if (result.artifact.type === "text") {
      expect(result.artifact.markdown).toMatch(/abcdef1/);
      expect(result.artifact.markdown).toMatch(/feat: add thing/);
      expect(result.artifact.markdown).toMatch(/Thmsnrtn/);
      expect(result.artifact.markdown).toMatch(/2026-05-01/);
    }
  });

  it("git_diff renders per-file headers and patch fences", async () => {
    stubFetchOk({
      sha: "deadbeef",
      html_url: "u",
      commit: { message: "fix: a bug" },
      stats: { additions: 1, deletions: 1, total: 2 },
      files: [
        {
          filename: "src/x.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
          changes: 2,
          patch: "@@ -1 +1 @@\n-old\n+new",
        },
      ],
    });
    const tool = getTool("git_diff")!;
    const result = await tool.handler({ sha: "deadbeef" }, FAKE_CTX);
    if (result.artifact.type === "text") {
      const md = result.artifact.markdown as string;
      expect(md).toMatch(/src\/x\.ts/);
      expect(md).toMatch(/\+1 \/ -1/);
      expect(md).toMatch(/```diff/);
      expect(md).toMatch(/\+new/);
    }
  });

  it("git_blame notes the GraphQL caveat in its output", async () => {
    stubFetchOk([
      {
        sha: "1234567abcdef",
        html_url: "u",
        commit: {
          author: { name: "Thomas", date: "2026-04-15T00:00:00Z" },
          message: "refactor: tidy",
        },
        author: { login: "Thmsnrtn" },
      },
    ]);
    const tool = getTool("git_blame")!;
    const result = await tool.handler({ path: "src/y.ts", line: 42 }, FAKE_CTX);
    if (result.artifact.type === "text") {
      const md = result.artifact.markdown as string;
      expect(md).toMatch(/src\/y\.ts/);
      expect(md).toMatch(/line 42/);
      expect(md).toMatch(/1234567/);
      expect(md).toMatch(/GraphQL/);
    }
  });

  it("missing GITHUB_FINE_GRAINED_TOKEN degrades to a text artifact (no throw)", async () => {
    delete process.env.GITHUB_FINE_GRAINED_TOKEN;
    const tool = getTool("repo_search")!;
    const result = await tool.handler({ query: "anything" }, FAKE_CTX);
    expect(result.artifact.type).toBe("text");
    if (result.artifact.type === "text") {
      expect(result.artifact.markdown).toMatch(/unavailable/);
    }
  });
});
