/**
 * Tests for toolExecutor — classification + auto-allowed + approval-required
 * + hard-blocked paths. dispatchToolExecutor is stubbed so the chat layer's
 * decision logic is what's exercised.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Stub dispatchToolExecutor — we just want to verify the chat layer
// routes correctly + propagates results, not re-test the underlying executor.
let LAST_DISPATCH_CALL: { toolName: string; input: Record<string, unknown> } | null = null;
let DISPATCH_RESULT: { success: boolean; output: string; durationMs: number } = {
  success: true,
  output: "stubbed-output",
  durationMs: 12,
};

vi.mock("../dispatchToolExecutor", async () => {
  const actual: any = await vi.importActual("../dispatchToolExecutor");
  return {
    DISPATCH_TOOL_SCHEMAS: actual.DISPATCH_TOOL_SCHEMAS,
    async executeDispatchTool(toolName: string, input: Record<string, unknown>) {
      LAST_DISPATCH_CALL = { toolName, input };
      return DISPATCH_RESULT;
    },
  };
});

import {
  CHAT_APPROVAL_REQUIRED_TOOLS,
  CHAT_AUTO_ALLOWED_TOOLS,
  CHAT_TOOL_SCHEMAS,
  classifyChatTool,
  deletePendingApproval,
  executeChatTool,
  getPendingApproval,
  wrapToolResult,
} from "./toolExecutor";

beforeEach(() => {
  LAST_DISPATCH_CALL = null;
  DISPATCH_RESULT = {
    success: true,
    output: "stubbed-output",
    durationMs: 12,
  };
});

// ============================================================================
// classifyChatTool
// ============================================================================

describe("classifyChatTool", () => {
  it("classifies read-only tools as auto-allowed", () => {
    for (const tool of [
      "file_read",
      "file_list",
      "git_status",
      "git_diff",
      "read_agent_inbox",
      "record_decision",
      "find_matching_speculations",
    ]) {
      expect(classifyChatTool(tool).kind).toBe("auto");
    }
  });

  it("classifies side-effecting tools as approval-required", () => {
    for (const tool of ["file_write", "git_commit", "bash"]) {
      const d = classifyChatTool(tool);
      expect(d.kind).toBe("approval_required");
      expect(d.reason).toMatch(/requires founder approval/);
    }
  });

  it("treats unknown tools as hard_blocked", () => {
    const d = classifyChatTool("rm_rf_universe");
    expect(d.kind).toBe("hard_blocked");
  });

  it("CHAT_AUTO_ALLOWED + CHAT_APPROVAL_REQUIRED sets are disjoint", () => {
    for (const t of CHAT_AUTO_ALLOWED_TOOLS) {
      expect(CHAT_APPROVAL_REQUIRED_TOOLS.has(t)).toBe(false);
    }
  });
});

// ============================================================================
// CHAT_TOOL_SCHEMAS
// ============================================================================

describe("CHAT_TOOL_SCHEMAS", () => {
  it("advertises file_write + bash so the model can intend them (approval gates execution)", () => {
    const names = CHAT_TOOL_SCHEMAS.map((t) => t.name);
    expect(names).toContain("file_write");
    expect(names).toContain("bash");
    expect(names).toContain("file_read");
  });
});

// ============================================================================
// executeChatTool — auto-allowed path
// ============================================================================

describe("executeChatTool", () => {
  it("delegates auto-allowed tools to executeDispatchTool", async () => {
    DISPATCH_RESULT = {
      success: true,
      output: "file content here",
      durationMs: 5,
    };
    const r = await executeChatTool({
      toolName: "file_read",
      toolInput: { path: "package.json" },
      conversationId: 1,
      founderUserId: "user_x",
    });
    expect(r.awaitingApproval).toBe(false);
    expect(LAST_DISPATCH_CALL?.toolName).toBe("file_read");
    expect(LAST_DISPATCH_CALL?.input).toEqual({ path: "package.json" });
    expect(r.result).toHaveLength(1);
    expect(r.result[0].type).toBe("text");
    if (r.result[0].type === "text") {
      // Guard-totality audit P-2: executor output re-enters the model
      // wrapped in the untrusted-data envelope, labeled with the tool.
      expect(r.result[0].text).toContain("<<USER_DATA>>");
      expect(r.result[0].text).toContain("[source: tool:file_read]");
      expect(r.result[0].text).toContain("file content here");
      expect(r.result[0].text).toContain("<<END_USER_DATA>>");
    }
  });

  it("returns awaiting_approval (no dispatch call) for approval-required tools", async () => {
    const r = await executeChatTool({
      toolName: "file_write",
      toolInput: { path: "x", content: "y" },
      conversationId: 5,
      founderUserId: "user_x",
    });
    expect(r.awaitingApproval).toBe(true);
    expect(r.approvalToken).toBeTruthy();
    expect(LAST_DISPATCH_CALL).toBeNull();
    expect(r.result[0]).toMatchObject({ type: "text" });
    if (r.result[0].type === "text") {
      expect(r.result[0].text).toContain("AWAITING_APPROVAL");
      // Server-authored constant — must NOT get the untrusted envelope.
      expect(r.result[0].text).not.toContain("<<USER_DATA>>");
    }

    // Pending entry should be retrievable + deletable.
    const pending = getPendingApproval(r.approvalToken!);
    expect(pending).not.toBeNull();
    expect(pending?.toolName).toBe("file_write");
    expect(pending?.conversationId).toBe(5);
    deletePendingApproval(r.approvalToken!);
    expect(getPendingApproval(r.approvalToken!)).toBeNull();
  });

  it("hard-blocks unknown tools without dispatching", async () => {
    const r = await executeChatTool({
      toolName: "rm_universe",
      toolInput: {},
      conversationId: 1,
      founderUserId: "u",
    });
    expect(r.awaitingApproval).toBe(false);
    expect(LAST_DISPATCH_CALL).toBeNull();
    if (r.result[0].type === "text") {
      expect(r.result[0].text).toMatch(/BLOCKED/);
    }
  });

  it("propagates failed dispatch results", async () => {
    DISPATCH_RESULT = {
      success: false,
      output: "ENOENT: bad path",
      durationMs: 1,
    };
    const r = await executeChatTool({
      toolName: "file_read",
      toolInput: { path: "missing" },
      conversationId: 2,
      founderUserId: "u",
    });
    if (r.result[0].type === "text") {
      expect(r.result[0].text).toContain("ENOENT");
      // Failure outputs can carry external text (fs errors, stderr) — the
      // envelope applies to them too.
      expect(r.result[0].text).toContain("<<USER_DATA>>");
    }
  });
});

// ============================================================================
// wrapToolResult
// ============================================================================

describe("wrapToolResult", () => {
  it("wraps a single text block as string content", () => {
    const r = wrapToolResult({
      toolUseId: "toolu_x",
      blocks: [{ type: "text", text: "hello" }],
    });
    expect(r.type).toBe("tool_result");
    expect(r.tool_use_id).toBe("toolu_x");
    expect(r.content).toBe("hello");
  });

  it("concatenates multiple blocks as a single string", () => {
    const r = wrapToolResult({
      toolUseId: "toolu_x",
      blocks: [
        { type: "text", text: "line1" },
        { type: "text", text: "line2" },
      ],
    });
    expect(r.content).toBe("line1\nline2");
  });

  it("propagates is_error", () => {
    const r = wrapToolResult({
      toolUseId: "toolu_x",
      blocks: [{ type: "text", text: "boom" }],
      isError: true,
    });
    expect(r.is_error).toBe(true);
  });
});
