/**
 * Phase G/H/I batch 2 — destructive GitHub + DB + Sentry tool tests.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetRegistryForTests,
  getTool,
  type FounderToolContext,
} from "../../server/services/founder-chat/tool-registry";
import {
  runTool,
  __resetCooldownTrackerForTests,
  __setKillSwitchOverrideForTests,
} from "../../server/services/founder-chat/executor";

vi.mock("../../server/services/founder-chat/providers/github", () => ({
  GithubClientError: class extends Error {
    status = 0;
    body = "";
    constructor(m: string, s: number, b: string) {
      super(m);
      this.status = s;
      this.body = b;
    }
  },
  latestMainSha: vi.fn(async () => "abc1234"),
  readFile: vi.fn(async () => ({
    type: "file",
    encoding: "utf-8",
    size: 20,
    name: "f.ts",
    path: "f.ts",
    content: "hello world from atlas",
    sha: "blob_sha",
    html_url: "https://github.com/x/y/blob/main/f.ts",
  })),
  createBranch: vi.fn(async () => ({ ok: true })),
  putFileOnBranch: vi.fn(async () => ({ commitSha: "commit_sha" })),
  createPullRequest: vi.fn(async () => ({
    number: 42,
    html_url: "https://github.com/x/y/pull/42",
    title: "atlas: test",
    state: "open",
    merged: false,
    draft: false,
    head: { sha: "headsha", ref: "atlas/foo" },
    base: { sha: "basesha", ref: "main" },
  })),
  getPullRequest: vi.fn(async () => ({
    number: 42,
    html_url: "https://github.com/x/y/pull/42",
    title: "atlas: test",
    state: "open",
    merged: false,
    draft: false,
    head: { sha: "headsha", ref: "atlas/foo" },
    base: { sha: "basesha", ref: "main" },
  })),
  getCheckRuns: vi.fn(async () => ({
    total_count: 1,
    check_runs: [{ id: 1, name: "ci", status: "completed", conclusion: "success", html_url: "" }],
  })),
  mergePullRequest: vi.fn(async () => ({ merged: true, sha: "mergesha", message: "merged" })),
  commentOnPr: vi.fn(async () => ({ id: 7, html_url: "https://github.com/x/y/pull/42#c7" })),
  createIssue: vi.fn(async () => ({ number: 100, html_url: "https://github.com/x/y/issues/100", title: "x", state: "open", labels: [] })),
}));

vi.mock("../../server/services/founder-chat/providers/fly", () => ({
  FlyClientError: class extends Error { status = 0; body = ""; },
  listMachines: vi.fn(async () => []),
  listReleases: vi.fn(async () => []),
  getMachine: vi.fn(),
  restartMachine: vi.fn(),
  scaleApp: vi.fn(),
  triggerDeploy: vi.fn(),
  rollbackToVersion: vi.fn(),
  setSecret: vi.fn(),
}));

vi.mock("../../server/services/founder-chat/providers/stripe-ops", () => ({
  lookupCustomer: vi.fn(),
  getCustomerInvoices: vi.fn(),
  getActiveSubscriptions: vi.fn(),
  refundCharge: vi.fn(),
  cancelSubscription: vi.fn(),
  reactivateSubscription: vi.fn(),
  grantCredit: vi.fn(),
  pauseSubscription: vi.fn(),
}));

vi.mock("../../server/services/founder-chat/providers/clerk-ops", () => ({
  ClerkOpsError: class extends Error { status = 0; },
  getUser: vi.fn(),
  suspendUser: vi.fn(),
  restoreUser: vi.fn(),
  forcePasswordReset: vi.fn(),
}));

vi.mock("../../server/services/founder-chat/providers/db-ops", () => ({
  DbOpsError: class extends Error {
    kind = "exec";
    constructor(m: string, k: string) {
      super(m);
      this.kind = k;
    }
  },
  parseSqlSafety: vi.fn((sql: string) => {
    if (/^\s*SELECT\b/i.test(sql)) return { isReadOnly: true };
    return { isReadOnly: false, reason: "destructive" };
  }),
  runDestructiveQuery: vi.fn(async () => ({
    rowCount: 1,
    snapshot: [{ id: 1, val: "snap" }],
    snapshotTable: "things",
  })),
}));

vi.mock("../../server/services/founder-chat/providers/sentry-ops", () => ({
  SentryClientError: class extends Error { status = 0; },
  getIssueDetails: vi.fn(async () => ({ id: "issue_1", title: "t", status: "resolved" })),
  resolveIssue: vi.fn(async () => ({ id: "issue_1", title: "t", status: "resolved" })),
  unresolveIssue: vi.fn(async () => ({ id: "issue_1", title: "t", status: "unresolved" })),
}));

vi.mock("../../server/db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{}]) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }),
  },
}));

function ctx(): FounderToolContext {
  return {
    founderUserId: "u_gh",
    organizationId: 1,
    threadId: 1,
    recentMentions: [],
    auditLog: async () => {},
  };
}

beforeAll(async () => {
  __resetRegistryForTests();
  await import("../../server/services/founder-chat/tools/destructive");
});
afterAll(() => __resetRegistryForTests());

beforeEach(() => {
  __resetCooldownTrackerForTests();
  __setKillSwitchOverrideForTests(false);
});
afterEach(() => {
  __setKillSwitchOverrideForTests(null);
  vi.clearAllMocks();
});

describe("github destructive — registration shape", () => {
  it("propose_edit + merge_pr are T3 destructive; comment + issue are T2", () => {
    expect(getTool("propose_edit")?.tier).toBe(3);
    expect(getTool("propose_edit")?.destructive).toBe(true);
    expect(getTool("merge_pr")?.tier).toBe(3);
    expect(getTool("comment_on_pr")?.tier).toBe(2);
    expect(getTool("create_issue")?.tier).toBe(2);
  });
});

describe("github destructive — propose_edit flow", () => {
  it("confirmed call reads file, branches, commits, opens PR", async () => {
    const out = await runTool({
      toolName: "propose_edit",
      args: {
        path: "f.ts",
        find: "hello",
        replace: "howdy",
        rationale: "switch greeting per Tom's request",
      },
      ctx: ctx(),
      confirmed: true,
    });
    expect(out.artifact.type).toBe("text");
    const md = (out.artifact as { markdown: string }).markdown;
    expect(md).toMatch(/PR \*\*#42\*\*/);

    const gh = await import("../../server/services/founder-chat/providers/github");
    expect(gh.readFile).toHaveBeenCalled();
    expect(gh.createBranch).toHaveBeenCalled();
    expect(gh.putFileOnBranch).toHaveBeenCalled();
    expect(gh.createPullRequest).toHaveBeenCalled();
  });

  it("refuses when find string isn't present", async () => {
    const gh = await import("../../server/services/founder-chat/providers/github");
    (gh.readFile as any).mockResolvedValueOnce({
      type: "file",
      encoding: "utf-8",
      size: 5,
      name: "f.ts",
      path: "f.ts",
      content: "abcde",
      sha: "blob",
      html_url: "",
    });
    const out = await runTool({
      toolName: "propose_edit",
      args: {
        path: "f.ts",
        find: "MISSING",
        replace: "Y",
        rationale: "expected to fail",
      },
      ctx: ctx(),
      confirmed: true,
    });
    const md = (out.artifact as { markdown: string }).markdown;
    expect(md).toMatch(/not present/);
    expect(gh.createPullRequest).not.toHaveBeenCalled();
  });
});

describe("github destructive — merge_pr requires green CI", () => {
  it("merges when checks are green", async () => {
    const out = await runTool({
      toolName: "merge_pr",
      args: { prNumber: 42, squash: true, reason: "ship it" },
      ctx: ctx(),
      confirmed: true,
    });
    expect(out.artifact.type).toBe("text");
    const md = (out.artifact as { markdown: string }).markdown;
    expect(md).toMatch(/Merged PR #42/);
    const gh = await import("../../server/services/founder-chat/providers/github");
    expect(gh.mergePullRequest).toHaveBeenCalledWith(42, true);
  });

  it("refuses when CI is failing", async () => {
    const gh = await import("../../server/services/founder-chat/providers/github");
    (gh.getCheckRuns as any).mockResolvedValueOnce({
      total_count: 1,
      check_runs: [{ id: 2, name: "ci", status: "completed", conclusion: "failure", html_url: "" }],
    });
    const out = await runTool({
      toolName: "merge_pr",
      args: { prNumber: 42, squash: true, reason: "should refuse" },
      ctx: ctx(),
      confirmed: true,
    });
    const md = (out.artifact as { markdown: string }).markdown;
    expect(md).toMatch(/Refusing to merge/);
    expect(gh.mergePullRequest).not.toHaveBeenCalled();
  });
});

describe("db destructive — db_query_write", () => {
  it("is registered as T3 destructive", () => {
    expect(getTool("db_query_write")?.tier).toBe(3);
    expect(getTool("db_query_write")?.destructive).toBe(true);
  });

  it("refuses read-only SQL with a friendly hint", async () => {
    const out = await runTool({
      toolName: "db_query_write",
      args: { sql: "SELECT * FROM things", reason: "test" },
      ctx: ctx(),
      confirmed: true,
    });
    const md = (out.artifact as { markdown: string }).markdown;
    expect(md).toMatch(/read-only/);
  });

  it("runs destructive SQL and captures a snapshot", async () => {
    const out = await runTool({
      toolName: "db_query_write",
      args: { sql: "DELETE FROM things WHERE id = 1", reason: "cleanup" },
      ctx: ctx(),
      confirmed: true,
    });
    const md = (out.artifact as { markdown: string }).markdown;
    expect(md).toMatch(/rowCount=1/);
    expect(md).toMatch(/affected row/);
  });
});

describe("sentry destructive — resolve / unresolve", () => {
  it("sentry_resolve_issue is T2 destructive with reverse recipe", async () => {
    expect(getTool("sentry_resolve_issue")?.tier).toBe(2);
    const out = await runTool({
      toolName: "sentry_resolve_issue",
      args: { issueId: "issue_1", reason: "fixed" },
      ctx: ctx(),
      confirmed: true,
    });
    expect(out.artifact.type).toBe("text");
    const sentry = await import("../../server/services/founder-chat/providers/sentry-ops");
    expect(sentry.resolveIssue).toHaveBeenCalledWith("issue_1", "fixed");
  });
});
