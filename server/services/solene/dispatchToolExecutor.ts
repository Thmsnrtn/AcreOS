/**
 * SOLENE DISPATCH — minimal tool executor for the worker loop.
 *
 * Today's session-based dispatches (this Claude Code conversation) use
 * Claude Code's built-in tool infrastructure. The worker process has none
 * of that. This module is the minimum-viable tool executor the worker
 * uses when invoking the Anthropic SDK directly.
 *
 * Supported tools:
 *   - file_read  (path: string, encoding?: string)
 *   - file_write (path: string, content: string)
 *   - file_list  (path: string)
 *   - bash       (command: string, timeout_ms?: number)  — no shell exec; uses
 *                  bash -lc with a wall-clock timeout.
 *   - git_status ()
 *   - git_diff   (path?: string, staged?: boolean)
 *   - git_commit (message: string, files?: string[])
 *
 * HONEST GAP LIST (what this executor INTENTIONALLY does NOT support):
 *   - No `git push` — pushing to origin from the worker is gated behind
 *     founder approval; dispatched agents leave commits local for review.
 *   - No network access tools beyond what bash can do (no curl helper,
 *     no fetch helper). Bash can still curl; the cost-cap + turn limit
 *     bounds runaway behavior.
 *   - No interactive shell — no stdin write after spawn. Tools that need
 *     interactive prompts will fail; agents must use non-interactive
 *     flags (--yes, --no-edit, etc.).
 *   - No sudo. The worker user cannot escalate.
 *   - No filesystem ops outside the repo root (CWD); paths are resolved
 *     relative to CWD and rejected if they escape via `..`.
 *
 * Safety:
 *   - Every bash run gets a wall-clock timeout (default 60s, max 5m).
 *   - File paths are normalized + must stay inside the project root.
 *   - bash stdout/stderr capped at 50 KB each; truncation noted in result.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { promises as fs } from "node:fs";
import { screenToolCall } from "./constitutionalGuard";

const PROJECT_ROOT = process.env.SOLENE_DISPATCH_PROJECT_ROOT
  ? path.resolve(process.env.SOLENE_DISPATCH_PROJECT_ROOT)
  : process.cwd();

const BASH_DEFAULT_TIMEOUT_MS = 60_000;
const BASH_MAX_TIMEOUT_MS = 5 * 60_000;
const BASH_OUTPUT_BYTE_CAP = 50_000;
const FILE_READ_BYTE_CAP = 1_000_000; // 1 MB
const FILE_WRITE_BYTE_CAP = 1_000_000;

// ----------------------------------------------------------------------------
// Path safety: resolve inside the project root, reject escape attempts.
// ----------------------------------------------------------------------------

function resolveSafePath(p: string): string {
  const abs = path.resolve(PROJECT_ROOT, p);
  const rel = path.relative(PROJECT_ROOT, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `path outside project root: ${p} (resolved=${abs} root=${PROJECT_ROOT})`,
    );
  }
  return abs;
}

// ----------------------------------------------------------------------------
// Tool schemas — passed to the Anthropic SDK as `tools` so the model knows
// what's available. Keep these JSON-schema-correct.
// ----------------------------------------------------------------------------

export const DISPATCH_TOOL_SCHEMAS = [
  {
    name: "file_read",
    description:
      "Read a file from the project tree. Path is relative to the project root. Returns up to 1MB of content.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to project root" },
        encoding: {
          type: "string",
          enum: ["utf8", "base64"],
          default: "utf8",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "file_write",
    description:
      "Write a file to the project tree. Path is relative to the project root. Overwrites existing content. Max 1MB.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to project root" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "file_list",
    description: "List entries in a directory (relative to project root).",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
  },
  {
    name: "bash",
    description:
      "Run a shell command via `bash -lc`. CWD is the project root. Wall-clock timeout enforced. No interactive stdin. No sudo. Output capped at 50KB per stream.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_ms: {
          type: "number",
          minimum: 1000,
          maximum: BASH_MAX_TIMEOUT_MS,
          default: BASH_DEFAULT_TIMEOUT_MS,
        },
      },
      required: ["command"],
    },
  },
  {
    name: "git_status",
    description: "Run `git status --short` and return the output.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "git_diff",
    description:
      "Show git diff. With staged=true shows the staged diff, otherwise unstaged. Optional path filter.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        staged: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "git_commit",
    description:
      "Stage the provided files (or `-A` if none given) and create a commit with the given message. Does NOT push.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", minLength: 1 },
        files: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["message"],
    },
  },
] as const;

export type DispatchToolName =
  (typeof DISPATCH_TOOL_SCHEMAS)[number]["name"];

// ----------------------------------------------------------------------------
// Tool executor — single entrypoint, switches on tool name.
// ----------------------------------------------------------------------------

export interface ToolExecutionResult {
  success: boolean;
  output: string;
  truncated?: boolean;
  durationMs: number;
  /** When the tool modified files, list them (for the result row). */
  filesModified?: string[];
  /** When git_commit ran, the SHA (for the result row). */
  commitSha?: string;
}

/**
 * Constitutional context for the L6.29 guard. Optional so existing callers
 * (pre-L6.29 callsites that don't yet plumb dispatch identity) keep working;
 * when omitted, the guard still screens patterns but logs the violation with
 * dispatch_id=null and agent_role='unknown'.
 */
export interface DispatchToolContext {
  dispatchId?: number | null;
  agentRole?: string;
}

export async function executeDispatchTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: DispatchToolContext = {},
): Promise<ToolExecutionResult> {
  const started = Date.now();
  try {
    // L6.29 — constitutional self-defense at the tool-call layer.
    // screenToolCall is awaited BEFORE the underlying tool runs. If a
    // pattern rule blocks the call, the underlying tool is NOT invoked,
    // a violation row is written, and a page is fired.
    const screen = await screenToolCall({
      dispatchId: ctx.dispatchId ?? null,
      toolName,
      toolInput: input,
      agentRole: ctx.agentRole ?? "unknown",
    });
    if (!screen.allowed) {
      return {
        success: false,
        output:
          `[CONSTITUTIONAL REFUSAL] This tool call would violate ` +
          `immutable #${screen.immutableNumber}: "${screen.immutableText}". ` +
          `The call has been blocked, logged, and escalated to Solene. Refusing.`,
        durationMs: Date.now() - started,
      };
    }

    switch (toolName) {
      case "file_read":
        return await toolFileRead(input, started);
      case "file_write":
        return await toolFileWrite(input, started);
      case "file_list":
        return await toolFileList(input, started);
      case "bash":
        return await toolBash(input, started);
      case "git_status":
        return await toolGitStatus(started);
      case "git_diff":
        return await toolGitDiff(input, started);
      case "git_commit":
        return await toolGitCommit(input, started);
      default:
        return {
          success: false,
          output: `unknown tool: ${toolName}`,
          durationMs: Date.now() - started,
        };
    }
  } catch (err) {
    return {
      success: false,
      output: `tool ${toolName} threw: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - started,
    };
  }
}

// ----------------------------------------------------------------------------
// Individual tool implementations.
// ----------------------------------------------------------------------------

async function toolFileRead(
  input: Record<string, unknown>,
  started: number,
): Promise<ToolExecutionResult> {
  const p = String(input.path ?? "");
  const enc = String(input.encoding ?? "utf8");
  if (!p) {
    return { success: false, output: "missing 'path'", durationMs: Date.now() - started };
  }
  const abs = resolveSafePath(p);
  const stat = await fs.stat(abs).catch((e) => {
    throw new Error(`stat failed: ${e.message}`);
  });
  if (stat.size > FILE_READ_BYTE_CAP) {
    return {
      success: false,
      output: `file too large: ${stat.size} > ${FILE_READ_BYTE_CAP} bytes`,
      durationMs: Date.now() - started,
    };
  }
  const buf = await fs.readFile(abs);
  const content = enc === "base64" ? buf.toString("base64") : buf.toString("utf8");
  return {
    success: true,
    output: content,
    durationMs: Date.now() - started,
  };
}

async function toolFileWrite(
  input: Record<string, unknown>,
  started: number,
): Promise<ToolExecutionResult> {
  const p = String(input.path ?? "");
  const content = String(input.content ?? "");
  if (!p) {
    return { success: false, output: "missing 'path'", durationMs: Date.now() - started };
  }
  if (Buffer.byteLength(content, "utf8") > FILE_WRITE_BYTE_CAP) {
    return {
      success: false,
      output: `content too large: > ${FILE_WRITE_BYTE_CAP} bytes`,
      durationMs: Date.now() - started,
    };
  }
  const abs = resolveSafePath(p);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  return {
    success: true,
    output: `wrote ${Buffer.byteLength(content, "utf8")} bytes to ${path.relative(PROJECT_ROOT, abs)}`,
    durationMs: Date.now() - started,
    filesModified: [path.relative(PROJECT_ROOT, abs)],
  };
}

async function toolFileList(
  input: Record<string, unknown>,
  started: number,
): Promise<ToolExecutionResult> {
  const p = String(input.path ?? ".");
  const abs = resolveSafePath(p);
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const lines = entries.map((e) => `${e.isDirectory() ? "d" : "-"} ${e.name}`);
  return {
    success: true,
    output: lines.join("\n"),
    durationMs: Date.now() - started,
  };
}

async function toolBash(
  input: Record<string, unknown>,
  started: number,
): Promise<ToolExecutionResult> {
  const cmd = String(input.command ?? "");
  if (!cmd.trim()) {
    return { success: false, output: "missing 'command'", durationMs: Date.now() - started };
  }
  const rawTimeout = Number(input.timeout_ms ?? BASH_DEFAULT_TIMEOUT_MS);
  const timeoutMs = Math.min(
    BASH_MAX_TIMEOUT_MS,
    Math.max(1000, Number.isFinite(rawTimeout) ? rawTimeout : BASH_DEFAULT_TIMEOUT_MS),
  );

  return await new Promise<ToolExecutionResult>((resolve) => {
    const child = spawn("bash", ["-lc", cmd], {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    const append = (which: "out" | "err", data: Buffer) => {
      const cur = which === "out" ? stdout : stderr;
      const remaining = BASH_OUTPUT_BYTE_CAP - Buffer.byteLength(cur, "utf8");
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const piece = data.toString("utf8").slice(0, remaining);
      if (which === "out") stdout += piece;
      else stderr += piece;
      if (Buffer.byteLength(piece, "utf8") < data.length) truncated = true;
    };
    child.stdout.on("data", (b) => append("out", b));
    child.stderr.on("data", (b) => append("err", b));

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 2000);
    }, timeoutMs);

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const exitMarker = signal
        ? `signal=${signal}`
        : `exit=${code ?? "null"}`;
      const out = [
        `[${exitMarker}${truncated ? " truncated" : ""}]`,
        stdout && `--- stdout ---\n${stdout}`,
        stderr && `--- stderr ---\n${stderr}`,
      ]
        .filter(Boolean)
        .join("\n");
      resolve({
        success: code === 0,
        output: out,
        truncated,
        durationMs: Date.now() - started,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        output: `spawn error: ${err.message}`,
        durationMs: Date.now() - started,
      });
    });
  });
}

async function toolGitStatus(started: number): Promise<ToolExecutionResult> {
  return await toolBash({ command: "git status --short" }, started);
}

async function toolGitDiff(
  input: Record<string, unknown>,
  started: number,
): Promise<ToolExecutionResult> {
  const staged = input.staged === true ? "--staged " : "";
  const pathArg = input.path ? `-- ${shellEscape(String(input.path))}` : "";
  const cmd = `git diff ${staged}${pathArg}`.trim();
  return await toolBash({ command: cmd }, started);
}

async function toolGitCommit(
  input: Record<string, unknown>,
  started: number,
): Promise<ToolExecutionResult> {
  const message = String(input.message ?? "").trim();
  if (!message) {
    return {
      success: false,
      output: "git_commit: missing 'message'",
      durationMs: Date.now() - started,
    };
  }
  const filesRaw = Array.isArray(input.files) ? (input.files as unknown[]) : [];
  const files = filesRaw.map((f) => String(f)).filter((f) => f.length > 0);
  // Validate each file is inside the repo root.
  for (const f of files) {
    try {
      resolveSafePath(f);
    } catch (err) {
      return {
        success: false,
        output: `git_commit: rejected unsafe path ${f}: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - started,
      };
    }
  }
  const addCmd =
    files.length > 0
      ? `git add ${files.map(shellEscape).join(" ")}`
      : `git add -A`;
  // Quote message with a heredoc to preserve newlines.
  const commitCmd = `git commit -m "$(cat <<'__SOLENE_DISPATCH_EOF__'\n${message}\n__SOLENE_DISPATCH_EOF__\n)"`;
  const combined = `${addCmd} && ${commitCmd} && git rev-parse HEAD`;
  const r = await toolBash({ command: combined, timeout_ms: 60_000 }, started);
  let commitSha: string | undefined;
  if (r.success) {
    // Last line of stdout (between "--- stdout ---" + end) should be the SHA.
    const m = r.output.match(/\b[0-9a-f]{40}\b/);
    if (m) commitSha = m[0];
  }
  return { ...r, commitSha, filesModified: files.length > 0 ? files : undefined };
}

// ----------------------------------------------------------------------------
// Helpers.
// ----------------------------------------------------------------------------

function shellEscape(s: string): string {
  if (/^[A-Za-z0-9_\-./@:=+,]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export { PROJECT_ROOT, BASH_OUTPUT_BYTE_CAP };
