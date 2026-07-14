/**
 * Horizon A5 — STRUCTURAL read-only dispatches.
 *
 * Pins the closing of the CP2 comment-only gap: 'verify' and
 * 'self_audit_drift' dispatches must be INCAPABLE of writing files or
 * committing — at the TOOLSET level (mutating tools stripped from the
 * schemas shown to the model) AND at the EXECUTOR level (a hallucinated
 * mutating call is rejected fail-closed with a logged refusal while the
 * dispatch continues). Other sourceTypes are unchanged.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ────────────────────────────────────────────────────────────────────────────
// Mocks — the executor's service imports (mirrors dispatchToolExecutor.test.ts)
// ────────────────────────────────────────────────────────────────────────────

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const screenToolCallMock = vi.fn();
vi.mock("../../server/services/solene/constitutionalGuard", () => ({
  screenToolCall: (...a: unknown[]) => screenToolCallMock(...a),
}));

vi.mock("../../server/services/solene/agentMessages", () => ({
  sendAgentMessage: vi.fn(),
  readInbox: vi.fn(),
}));
vi.mock("../../server/services/solene/agentIdentity", () => ({
  recordAgentDecision: vi.fn(),
}));
vi.mock("../../server/services/solene/decisionTraces", () => ({
  addTraceStep: vi.fn(),
}));
vi.mock("../../server/services/solene/counterfactuals", () => ({
  recordCounterfactual: vi.fn(),
}));
vi.mock("../../server/services/solene/speculations", () => ({
  createSpeculation: vi.fn(),
  findMatchingSpeculations: vi.fn(),
}));
vi.mock("../../server/services/solene/evidenceWeights", () => ({
  assessEvidence: vi.fn(),
}));
vi.mock("../../server/services/solene/capabilityDiscovery", () => ({
  proposeCapability: vi.fn(),
}));

// Hand registry — one fake outward hand so we can prove read-only strips +
// refuses hands too.
const fakeHandHandler = vi.fn(async () => ({
  success: true,
  output: "hand ran",
  durationMs: 1,
}));
vi.mock("../../server/services/autopilot/hands", () => ({
  getHand: (name: string) =>
    name === "send_test_hand"
      ? { domain: "growth", requiresApproval: false, handler: fakeHandHandler }
      : undefined,
  listHandSchemas: () => [
    {
      name: "send_test_hand",
      description: "fake outward hand",
      input_schema: { type: "object", properties: {} },
    },
  ],
}));

import {
  READ_ONLY_DISPATCH_SOURCE_TYPES,
  isReadOnlyDispatchSourceType,
  DISPATCH_SOURCE_TYPES,
} from "../../shared/schema/solene-dispatch";
import { logger } from "../../server/utils/logger";

// Point the executor's PROJECT_ROOT at a throwaway dir so the
// "allowed for others" case writes into tmp, never the repo. Static imports
// hoist above statements, so the module under test is loaded DYNAMICALLY
// after the env var is set (vi.mock calls are hoisted regardless).
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "readonly-dispatch-test-"));
process.env.SOLENE_DISPATCH_PROJECT_ROOT = TMP_ROOT;

const {
  getDispatchToolSchemas,
  executeDispatchTool,
  isReadOnlyBlockedDispatchTool,
  READ_ONLY_BLOCKED_TOOL_NAMES,
} = await import("../../server/services/solene/dispatchToolExecutor");

beforeEach(() => {
  vi.clearAllMocks();
  screenToolCallMock.mockResolvedValue({ allowed: true });
});

// ────────────────────────────────────────────────────────────────────────────
// The source-type binding
// ────────────────────────────────────────────────────────────────────────────

describe("READ_ONLY_DISPATCH_SOURCE_TYPES", () => {
  it("binds exactly verify + self_audit_drift", () => {
    expect([...READ_ONLY_DISPATCH_SOURCE_TYPES].sort()).toEqual([
      "self_audit_drift",
      "verify",
    ]);
  });

  it("isReadOnlyDispatchSourceType: true only for the two audit lanes", () => {
    expect(isReadOnlyDispatchSourceType("verify")).toBe(true);
    expect(isReadOnlyDispatchSourceType("self_audit_drift")).toBe(true);
    for (const st of DISPATCH_SOURCE_TYPES) {
      if (st === "verify" || st === "self_audit_drift") continue;
      expect(isReadOnlyDispatchSourceType(st), st).toBe(false);
    }
    expect(isReadOnlyDispatchSourceType("made_up")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Toolset level — the model never sees a mutating tool
// ────────────────────────────────────────────────────────────────────────────

describe("getDispatchToolSchemas({ readOnly: true })", () => {
  const readOnlyNames = getDispatchToolSchemas({ untrusted: true, readOnly: true }).map(
    (t) => t.name,
  );

  it("strips every mutating built-in (file_write, git_commit, bash, run_tests)", () => {
    for (const blocked of READ_ONLY_BLOCKED_TOOL_NAMES) {
      expect(readOnlyNames, blocked).not.toContain(blocked);
    }
  });

  it("keeps the read-only surface (file_read, file_list, git_status, git_diff, typecheck)", () => {
    for (const kept of ["file_read", "file_list", "git_status", "git_diff", "typecheck"]) {
      expect(readOnlyNames, kept).toContain(kept);
    }
  });

  it("excludes ALL autopilot hands (outward effects) from the read-only toolset", () => {
    expect(readOnlyNames).not.toContain("send_test_hand");
  });

  it("other dispatches are unchanged: untrusted keeps file_write/git_commit/run_tests + hands (only bash removed)", () => {
    const untrusted = getDispatchToolSchemas({ untrusted: true }).map((t) => t.name);
    expect(untrusted).not.toContain("bash");
    expect(untrusted).toContain("file_write");
    expect(untrusted).toContain("git_commit");
    expect(untrusted).toContain("run_tests");
    expect(untrusted).toContain("send_test_hand");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Executor level — hallucinated mutating calls are rejected fail-closed
// ────────────────────────────────────────────────────────────────────────────

describe("executeDispatchTool — read-only rejection", () => {
  const roCtx = { dispatchId: 7, agentRole: "general-purpose", untrusted: true, readOnly: true };

  it("classifier: blocked built-ins + hands are read-only-blocked; read tools are not", () => {
    expect(isReadOnlyBlockedDispatchTool("file_write")).toBe(true);
    expect(isReadOnlyBlockedDispatchTool("git_commit")).toBe(true);
    expect(isReadOnlyBlockedDispatchTool("bash")).toBe(true);
    expect(isReadOnlyBlockedDispatchTool("run_tests")).toBe(true);
    expect(isReadOnlyBlockedDispatchTool("send_test_hand")).toBe(true);
    expect(isReadOnlyBlockedDispatchTool("file_read")).toBe(false);
    expect(isReadOnlyBlockedDispatchTool("git_diff")).toBe(false);
    expect(isReadOnlyBlockedDispatchTool("typecheck")).toBe(false);
  });

  it("REJECTS file_write for a read-only dispatch — nothing written, refusal logged, dispatch continues", async () => {
    const target = "ro-refused.txt";
    const r = await executeDispatchTool("file_write", { path: target, content: "x" }, roCtx);
    expect(r.success).toBe(false);
    expect(r.output).toContain("[READ-ONLY REFUSAL]");
    expect(fs.existsSync(path.join(TMP_ROOT, target))).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("read-only dispatch REFUSED mutating tool 'file_write'"),
      expect.anything(),
    );
    // Fail-closed BEFORE anything runs — not even the constitutional screen.
    expect(screenToolCallMock).not.toHaveBeenCalled();
  });

  it("REJECTS git_commit for a read-only dispatch", async () => {
    const r = await executeDispatchTool("git_commit", { message: "sneaky" }, roCtx);
    expect(r.success).toBe(false);
    expect(r.output).toContain("[READ-ONLY REFUSAL]");
  });

  it("REJECTS bash and run_tests for a read-only dispatch", async () => {
    const bash = await executeDispatchTool("bash", { command: "echo hi" }, roCtx);
    expect(bash.success).toBe(false);
    expect(bash.output).toContain("[READ-ONLY REFUSAL]");
    const tests = await executeDispatchTool("run_tests", {}, roCtx);
    expect(tests.success).toBe(false);
    expect(tests.output).toContain("[READ-ONLY REFUSAL]");
  });

  it("REJECTS a registered hand for a read-only dispatch — the hand handler never runs", async () => {
    const r = await executeDispatchTool("send_test_hand", {}, roCtx);
    expect(r.success).toBe(false);
    expect(r.output).toContain("[READ-ONLY REFUSAL]");
    expect(fakeHandHandler).not.toHaveBeenCalled();
  });

  it("ALLOWS read tools for a read-only dispatch (file_read reaches the tool body)", async () => {
    fs.writeFileSync(path.join(TMP_ROOT, "readable.md"), "doctrine text");
    const r = await executeDispatchTool("file_read", { path: "readable.md" }, roCtx);
    expect(r.success).toBe(true);
    expect(r.output).toContain("doctrine text");
  });

  it("ALLOWS file_write for NON-read-only dispatches (other sourceTypes unchanged)", async () => {
    const target = "allowed-write.txt";
    const r = await executeDispatchTool(
      "file_write",
      { path: target, content: "written" },
      { dispatchId: 8, agentRole: "iris", untrusted: true },
    );
    expect(r.success).toBe(true);
    expect(fs.readFileSync(path.join(TMP_ROOT, target), "utf8")).toBe("written");
  });
});
