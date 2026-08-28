/**
 * Evolution Pipeline
 *
 * Fully autonomous 6-stage code evolution pipeline.
 *
 * Picks up approved self-assessment proposals from `agentTasks` and runs them
 * through a safety gauntlet:
 *
 *   Stage 1 — Code Generation (Claude Opus)
 *   Stage 2 — Adversarial Review (GPT-4o)
 *   Stage 3 — Intent Verification (DeepSeek Reasoner)
 *   Stage 4 — Static Analysis (tsc --noEmit on a throwaway git branch)
 *   Stage 5 — Deploy (merge + record baseline metrics)
 *   Stage 6 — Regression Check (compare error rates after 30 min)
 *
 * A circuit-breaker (`evolutionCircuitBreaker`) prevents runaway deployments
 * when consecutive reverts accumulate.
 */

import OpenAI from "openai";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { db } from "../db";
import {
  agentTasks,
  evolutionHistory,
  evolutionCircuitBreaker,
  aiTelemetryEvents,
} from "@shared/schema";
import { eq, desc, and, isNull, sql, gte, lt } from "drizzle-orm";
import { MODELS } from "./models";
import { logger } from "../utils/logger";
import { requireOpenAIClient } from "../utils/openaiClient";

import { sanitizePromptInline } from "../utils/sanitizePrompt";
// ---------------------------------------------------------------------------
// OpenRouter client
// ---------------------------------------------------------------------------
// Lazy shared client (server/utils/openaiClient.ts): the previous module-
// level `new OpenAI({ apiKey: ...OPENROUTER_API_KEY! })` threw at import
// time when the key was unset, killing the scheduled job that dynamically
// imported this module with an opaque constructor error. The shared helper
// resolves the same key/baseURL/headers at call time and throws an honest
// "not configured" error instead.
function openrouter(): OpenAI {
  return requireOpenAIClient();
}

const ASSESSMENT_MODEL = MODELS.OPUS;
const REVIEW_MODEL = MODELS.VISION;
const REASONER_MODEL = MODELS.DEEPSEEK_REASONER;

// ---------------------------------------------------------------------------
// Safety allowlists
// ---------------------------------------------------------------------------

/**
 * Only these existing files may be modified by the pipeline.
 * New files within ALLOWED_NEW_FILE_PREFIX are also allowed.
 */
const ALLOWED_TARGET_FILES = [
  "server/ai/tools.ts",
  "server/services/agent-skills.ts",
  "server/services/workflow-engine.ts",
  "server/services/connectors/registry.ts",
  "server/services/connectors/executor.ts",
];

const ALLOWED_NEW_FILE_PREFIX = "server/services/";

/**
 * Any generated code containing these strings is automatically rejected.
 * Protects against SQL drops, shell deletions, eval-based code injection,
 * process termination, and accidental .env exposure.
 */
const FORBIDDEN_PATTERNS = [
  "DROP ",
  "DELETE FROM",
  "rm -",
  "process.exit",
  "eval(",
  "Function(",
  ".env",
];

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------
const log = (msg: string, meta?: Record<string, unknown>) =>
  logger.info(JSON.stringify({
      level: "INFO",
      timestamp: new Date().toISOString(),
      source: "[evolution-pipeline]",
      message: msg,
      ...meta,
    }));

const logError = (msg: string, meta?: Record<string, unknown>) =>
  logger.error(JSON.stringify({
      level: "ERROR",
      timestamp: new Date().toISOString(),
      source: "[evolution-pipeline]",
      message: msg,
      ...meta,
    }));

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

/**
 * Returns true if the pipeline is clear to proceed, false if blocked.
 *
 * If the breaker is tripped but `resumeAt` has passed, it is automatically
 * reset before returning true.
 */
export async function checkCircuitBreaker(): Promise<boolean> {
  try {
    const [breaker] = await db
      .select()
      .from(evolutionCircuitBreaker)
      .where(eq(evolutionCircuitBreaker.id, 1));

    if (!breaker) {
      // No row yet — treat as clear
      return true;
    }

    if (!breaker.isTripped) {
      return true;
    }

    const now = new Date();

    // Tripped but auto-resume time has not passed
    if (breaker.resumeAt && breaker.resumeAt > now) {
      log("checkCircuitBreaker — BLOCKED", {
        trippedAt: breaker.trippedAt?.toISOString(),
        resumeAt: breaker.resumeAt?.toISOString(),
      });
      return false;
    }

    // Tripped but resume time has passed — auto-reset
    log("checkCircuitBreaker — auto-resetting expired circuit breaker");
    await db
      .update(evolutionCircuitBreaker)
      .set({
        isTripped: false,
        consecutiveReverts: 0,
        updatedAt: new Date(),
      })
      .where(eq(evolutionCircuitBreaker.id, 1));

    return true;
  } catch (err) {
    logError("checkCircuitBreaker — error, defaulting to BLOCKED for safety", {
      error: String(err),
    });
    return false;
  }
}

/**
 * Trips the circuit breaker, incrementing `consecutiveReverts` and locking
 * the pipeline for 7 days.
 */
async function tripCircuitBreaker(reason: string): Promise<void> {
  log("tripCircuitBreaker — tripping", { reason });

  try {
    const [existing] = await db
      .select()
      .from(evolutionCircuitBreaker)
      .where(eq(evolutionCircuitBreaker.id, 1));

    const now = new Date();
    const resumeAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const newReverts = (existing?.consecutiveReverts ?? 0) + 1;

    if (existing) {
      await db
        .update(evolutionCircuitBreaker)
        .set({
          isTripped: true,
          consecutiveReverts: newReverts,
          trippedAt: now,
          resumeAt,
          updatedAt: now,
        })
        .where(eq(evolutionCircuitBreaker.id, 1));
    } else {
      await db.insert(evolutionCircuitBreaker).values({
        id: 1,
        isTripped: true,
        consecutiveReverts: newReverts,
        trippedAt: now,
        resumeAt,
      });
    }

    logError("tripCircuitBreaker — TRIPPED", {
      reason,
      consecutiveReverts: newReverts,
      resumeAt: resumeAt.toISOString(),
    });
  } catch (err) {
    logError("tripCircuitBreaker — failed to update breaker row", {
      error: String(err),
    });
  }
}

/**
 * Resets the consecutive revert counter after a successful (non-reverted)
 * deployment, indicating the pipeline is healthy.
 */
export async function resetConsecutiveReverts(): Promise<void> {
  try {
    await db
      .update(evolutionCircuitBreaker)
      .set({ consecutiveReverts: 0, updatedAt: new Date() })
      .where(eq(evolutionCircuitBreaker.id, 1));
    log("resetConsecutiveReverts — counter reset to 0");
  } catch (err) {
    logError("resetConsecutiveReverts — failed", { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Stage 1 — Code Generation
// ---------------------------------------------------------------------------

/**
 * Validates the target file, reads its current content, calls Claude Opus to
 * generate the requested code change, and performs basic safety validation
 * (forbidden patterns, line-count guard).
 *
 * @returns `{ code, historyId }` on success, or `null` on rejection.
 */
export async function stage1Generate(proposal: {
  description: string;
  targetFile: string;
  codeLocation: string;
}): Promise<{ code: string; historyId: number } | null> {
  log("stage1Generate — starting", { targetFile: proposal.targetFile });

  // 1. Validate target file against allowlist
  const isAllowedExisting = ALLOWED_TARGET_FILES.includes(proposal.targetFile);
  const isAllowedNew = proposal.targetFile.startsWith(ALLOWED_NEW_FILE_PREFIX);

  if (!isAllowedExisting && !isAllowedNew) {
    throw new Error(
      `Target file '${proposal.targetFile}' is not in ALLOWED_TARGET_FILES and does not start with '${ALLOWED_NEW_FILE_PREFIX}'. Rejecting.`
    );
  }

  // 2. Read current file content (new files may not exist yet)
  const absolutePath = path.join(process.cwd(), proposal.targetFile);
  let fileContent = "";
  try {
    if (fs.existsSync(absolutePath)) {
      fileContent = fs.readFileSync(absolutePath, "utf8");
    }
  } catch (err) {
    logError("stage1Generate — could not read target file", {
      targetFile: proposal.targetFile,
      error: String(err),
    });
  }

  // 3. Create evolutionHistory row (status: 'proposed')
  const [historyRow] = await db
    .insert(evolutionHistory)
    .values({
      proposalDescription: proposal.description,
      targetFile: proposal.targetFile,
      status: "proposed",
    })
    .returning({ id: evolutionHistory.id });

  const historyId = historyRow.id;
  log("stage1Generate — history row created", { historyId });

  // Rosy River budget gate — preflight before the LLM call. Stage 1 uses
  // Opus, ~$0.20-0.50 per call depending on file size. Bail with abandoned
  // status if the weekly ceiling would be breached.
  try {
    const { preflightBudgetCheck } = await import("./rosyRiver");
    const preflight = await preflightBudgetCheck(0.5);
    if (!preflight.ok) {
      logError("stage1Generate — budget preflight failed", {
        historyId,
        reason: preflight.reason,
      });
      await db
        .update(evolutionHistory)
        .set({
          status: "abandoned",
          stageFailedAt: "stage1",
          stageFailureReason: `Budget preflight: ${preflight.reason}`,
          updatedAt: new Date(),
        })
        .where(eq(evolutionHistory.id, historyId));
      return null;
    }
  } catch (preflightErr) {
    // Preflight is advisory — don't block the pipeline if Rosy River is
    // unavailable. Log and proceed.
    logError("stage1Generate — preflight threw, proceeding without gate", {
      historyId,
      error: preflightErr instanceof Error ? preflightErr.message : String(preflightErr),
    });
  }

  // 4. Call Claude Opus to generate the code change
  let generatedCode = "";
  try {
    const completion = await openrouter().chat.completions.create({
      model: ASSESSMENT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a TypeScript code generation expert. Generate ONLY the exact code change requested — no explanations, no markdown, just the raw TypeScript code to insert or replace. Match the exact style, naming, imports, and patterns of the existing file.",
        },
        {
          role: "user",
          content: `File: ${proposal.targetFile}

Existing file content:
${fileContent || "(new file — no existing content)"}

Required change:
${sanitizePromptInline(proposal.description ?? "", { source: "proposal.description" })}

Code location: ${proposal.codeLocation}

Output ONLY the TypeScript code to add/replace, nothing else.`,
        },
      ],
      max_tokens: 4000,
    });
    generatedCode = completion.choices[0]?.message?.content ?? "";

    // Rosy River cost ledger — write the LLM call into agent_llm_traces
    // so the weekly budget aggregator (and the founder dashboard banner)
    // see the spend.
    try {
      const { logAgentTrace } = await import("./agentLlmTraces");
      const usage = (completion as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage;
      // Opus rough cost: $15/M input, $75/M output → cents per call.
      const inputTokens = usage?.prompt_tokens ?? 0;
      const outputTokens = usage?.completion_tokens ?? 0;
      const costCents = Math.ceil((inputTokens * 0.0015) + (outputTokens * 0.0075));
      await logAgentTrace({
        agentCodename: "evolution_pipeline",
        purpose: "stage1_code_generation",
        decisionId: historyId,
        model: ASSESSMENT_MODEL,
        userPrompt: `target: ${proposal.targetFile}`,
        response: generatedCode.slice(0, 4000),
        inputTokens,
        outputTokens,
        costCents,
      });
    } catch (_) {
      /* fire-and-forget, never block the pipeline */
    }
  } catch (err) {
    logError("stage1Generate — OpenRouter call failed", {
      historyId,
      error: String(err),
    });
    await db
      .update(evolutionHistory)
      .set({
        status: "abandoned",
        stageFailedAt: "stage1",
        stageFailureReason: `OpenRouter call failed: ${String(err)}`,
        updatedAt: new Date(),
      })
      .where(eq(evolutionHistory.id, historyId));
    return null;
  }

  // 5a. Check for forbidden patterns
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (generatedCode.includes(pattern)) {
      const reason = `Generated code contains forbidden pattern: '${pattern}'`;
      logError("stage1Generate — forbidden pattern detected", {
        historyId,
        pattern,
      });
      await db
        .update(evolutionHistory)
        .set({
          status: "abandoned",
          stageFailedAt: "stage1",
          stageFailureReason: reason,
          generatedCode,
          updatedAt: new Date(),
        })
        .where(eq(evolutionHistory.id, historyId));
      return null;
    }
  }

  // 5b. Count net-new lines added (reject if > 200)
  const existingLineCount = fileContent ? fileContent.split("\n").length : 0;
  const generatedLineCount = generatedCode.split("\n").length;
  const netNewLines = Math.max(0, generatedLineCount - existingLineCount);

  if (netNewLines > 200) {
    const reason = `Generated code adds ${netNewLines} net-new lines (limit: 200). Rejecting to avoid unreviewed bulk changes.`;
    logError("stage1Generate — line count exceeded", { historyId, netNewLines });
    await db
      .update(evolutionHistory)
      .set({
        status: "abandoned",
        stageFailedAt: "stage1",
        stageFailureReason: reason,
        generatedCode,
        updatedAt: new Date(),
      })
      .where(eq(evolutionHistory.id, historyId));
    return null;
  }

  // 6. Update history to stage1_pass
  await db
    .update(evolutionHistory)
    .set({
      status: "stage1_pass",
      generatedCode,
      stagesCompleted: sql`array_append(${evolutionHistory.stagesCompleted}, 'stage1')`,
      updatedAt: new Date(),
    })
    .where(eq(evolutionHistory.id, historyId));

  log("stage1Generate — PASS", { historyId, netNewLines });
  return { code: generatedCode, historyId };
}

// ---------------------------------------------------------------------------
// Stage 2 — Adversarial Review
// ---------------------------------------------------------------------------

/**
 * Sends the generated code to GPT-4o for adversarial review.  A 'block'
 * severity result causes the history row to be abandoned.
 *
 * @returns true if the code passes, false if blocked.
 */
export async function stage2AdversarialReview(
  code: string,
  historyId: number
): Promise<boolean> {
  log("stage2AdversarialReview — starting", { historyId });

  let rawContent = "";
  try {
    const completion = await openrouter().chat.completions.create({
      model: REVIEW_MODEL,
      messages: [
        {
          role: "user",
          content: `You are a senior TypeScript security engineer doing an adversarial code review. Find bugs, type errors, security vulnerabilities, race conditions, and unintended side effects. Be thorough and adversarial.

Code to review:
\`\`\`typescript
${code}
\`\`\`

Return JSON only (no prose, no fences):
{"pass": boolean, "issues": ["string", ...], "severity": "block" | "warn" | "none"}`,
        },
      ],
      max_tokens: 2000,
    });
    rawContent = completion.choices[0]?.message?.content ?? "";
  } catch (err) {
    logError("stage2AdversarialReview — OpenRouter call failed", {
      historyId,
      error: String(err),
    });
    await db
      .update(evolutionHistory)
      .set({
        status: "abandoned",
        stageFailedAt: "stage2",
        stageFailureReason: `OpenRouter call failed: ${String(err)}`,
        updatedAt: new Date(),
      })
      .where(eq(evolutionHistory.id, historyId));
    return false;
  }

  let review: { pass: boolean; issues: string[]; severity: string } = {
    pass: false,
    issues: [],
    severity: "block",
  };

  try {
    const cleaned = rawContent
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    review = JSON.parse(cleaned);
  } catch (err) {
    logError("stage2AdversarialReview — failed to parse response, blocking", {
      historyId,
      raw: rawContent.slice(0, 300),
    });
    await db
      .update(evolutionHistory)
      .set({
        status: "abandoned",
        stageFailedAt: "stage2",
        stageFailureReason: "Could not parse adversarial review JSON",
        reviewModelOutput: rawContent,
        updatedAt: new Date(),
      })
      .where(eq(evolutionHistory.id, historyId));
    return false;
  }

  if (review.severity === "block") {
    const reason = review.issues.join("; ");
    logError("stage2AdversarialReview — BLOCKED", { historyId, reason });
    await db
      .update(evolutionHistory)
      .set({
        status: "abandoned",
        stageFailedAt: "stage2",
        stageFailureReason: reason,
        reviewModelOutput: rawContent,
        updatedAt: new Date(),
      })
      .where(eq(evolutionHistory.id, historyId));
    return false;
  }

  // Pass (warn or none)
  await db
    .update(evolutionHistory)
    .set({
      status: "stage2_pass",
      reviewModelOutput: rawContent,
      stagesCompleted: sql`array_append(${evolutionHistory.stagesCompleted}, 'stage2')`,
      updatedAt: new Date(),
    })
    .where(eq(evolutionHistory.id, historyId));

  log("stage2AdversarialReview — PASS", {
    historyId,
    severity: review.severity,
    issueCount: review.issues.length,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Stage 3 — Intent Verification
// ---------------------------------------------------------------------------

/**
 * Uses DeepSeek Reasoner to confirm the generated code does what the proposal
 * description says it should do and integrates correctly.
 *
 * @returns true if intent and integration are confirmed, false otherwise.
 */
export async function stage3IntentVerification(
  code: string,
  proposal: object,
  historyId: number
): Promise<boolean> {
  log("stage3IntentVerification — starting", { historyId });

  let rawContent = "";
  try {
    const completion = await openrouter().chat.completions.create({
      model: REASONER_MODEL,
      messages: [
        {
          role: "user",
          content: `Proposal:
${JSON.stringify(proposal, null, 2)}

Generated TypeScript code:
\`\`\`typescript
${code}
\`\`\`

Does this TypeScript code do exactly what the proposal description says it should? Does it integrate correctly with the surrounding code?

Return JSON only (no prose, no fences):
{"intentMatch": boolean, "integrationValid": boolean, "concerns": ["string", ...]}`,
        },
      ],
      max_tokens: 1500,
    });
    rawContent = completion.choices[0]?.message?.content ?? "";
  } catch (err) {
    logError("stage3IntentVerification — OpenRouter call failed", {
      historyId,
      error: String(err),
    });
    await db
      .update(evolutionHistory)
      .set({
        status: "abandoned",
        stageFailedAt: "stage3",
        stageFailureReason: `OpenRouter call failed: ${String(err)}`,
        updatedAt: new Date(),
      })
      .where(eq(evolutionHistory.id, historyId));
    return false;
  }

  let verification: {
    intentMatch: boolean;
    integrationValid: boolean;
    concerns: string[];
  } = { intentMatch: false, integrationValid: false, concerns: [] };

  try {
    const cleaned = rawContent
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    verification = JSON.parse(cleaned);
  } catch (err) {
    logError("stage3IntentVerification — failed to parse response, failing", {
      historyId,
      raw: rawContent.slice(0, 300),
    });
    await db
      .update(evolutionHistory)
      .set({
        status: "abandoned",
        stageFailedAt: "stage3",
        stageFailureReason: "Could not parse intent verification JSON",
        intentVerificationOutput: rawContent,
        updatedAt: new Date(),
      })
      .where(eq(evolutionHistory.id, historyId));
    return false;
  }

  if (!verification.intentMatch || !verification.integrationValid) {
    const reason = [
      !verification.intentMatch ? "Intent does not match proposal" : "",
      !verification.integrationValid ? "Integration invalid" : "",
      ...verification.concerns,
    ]
      .filter(Boolean)
      .join("; ");

    logError("stage3IntentVerification — FAIL", { historyId, reason });
    await db
      .update(evolutionHistory)
      .set({
        status: "abandoned",
        stageFailedAt: "stage3",
        stageFailureReason: reason,
        intentVerificationOutput: rawContent,
        updatedAt: new Date(),
      })
      .where(eq(evolutionHistory.id, historyId));
    return false;
  }

  await db
    .update(evolutionHistory)
    .set({
      status: "stage3_pass",
      intentVerificationOutput: rawContent,
      stagesCompleted: sql`array_append(${evolutionHistory.stagesCompleted}, 'stage3')`,
      updatedAt: new Date(),
    })
    .where(eq(evolutionHistory.id, historyId));

  log("stage3IntentVerification — PASS", {
    historyId,
    concerns: verification.concerns.length,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Stage 4 — Static Analysis
// ---------------------------------------------------------------------------

/**
 * Creates a throwaway git branch, writes the generated code to the target
 * file, runs `tsc --noEmit`, and commits on success.  Reverts on TypeScript
 * failure.
 *
 * @returns true if TypeScript compilation passes, false otherwise.
 */
export async function stage4StaticAnalysis(
  targetFile: string,
  code: string,
  historyId: number
): Promise<boolean> {
  log("stage4StaticAnalysis — starting", { historyId, targetFile });

  const branchName = `evolution/${historyId}-${Date.now()}`;

  // 1. Create and switch to a temporary branch
  try {
    execSync(`git checkout -b ${branchName}`, {
      cwd: process.cwd(),
      stdio: "pipe",
    });
    log("stage4StaticAnalysis — branch created", { branchName });
  } catch (err) {
    logError("stage4StaticAnalysis — failed to create branch", {
      historyId,
      error: String(err),
    });
    await db
      .update(evolutionHistory)
      .set({
        status: "abandoned",
        stageFailedAt: "stage4",
        stageFailureReason: `Failed to create git branch: ${String(err)}`,
        branchName,
        updatedAt: new Date(),
      })
      .where(eq(evolutionHistory.id, historyId));
    return false;
  }

  // 2. Write the modified code to the target file
  const absolutePath = path.join(process.cwd(), targetFile);
  try {
    // Ensure parent directory exists for new files
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(absolutePath, code, "utf8");
    log("stage4StaticAnalysis — code written to file", { targetFile });
  } catch (err) {
    logError("stage4StaticAnalysis — failed to write file", {
      historyId,
      targetFile,
      error: String(err),
    });
    // Clean up: revert and return to main
    try {
      execSync("git checkout -- .", { cwd: process.cwd(), stdio: "pipe" });
      execSync("git checkout main", { cwd: process.cwd(), stdio: "pipe" });
    } catch (_) { /* best-effort cleanup */ }

    await db
      .update(evolutionHistory)
      .set({
        status: "abandoned",
        stageFailedAt: "stage4",
        stageFailureReason: `Failed to write file: ${String(err)}`,
        branchName,
        updatedAt: new Date(),
      })
      .where(eq(evolutionHistory.id, historyId));
    return false;
  }

  // 3. Run TypeScript compiler
  let tscOutput = "";
  let tscPassed = false;
  try {
    tscOutput = execSync("npx tsc --noEmit 2>&1", {
      cwd: process.cwd(),
      stdio: "pipe",
      encoding: "utf8",
      timeout: 120_000, // 2 min max for compilation
    });
    tscPassed = true;
  } catch (err: any) {
    // execSync throws on non-zero exit; stdout/stderr captured in err.stdout
    tscOutput = err?.stdout ?? err?.stderr ?? String(err);
    tscPassed = false;
  }

  // 4. Handle TypeScript failure
  if (!tscPassed) {
    logError("stage4StaticAnalysis — TypeScript FAIL", {
      historyId,
      tscOutputSnippet: tscOutput.slice(0, 500),
    });

    // Revert file changes and return to main
    try {
      execSync("git checkout -- .", { cwd: process.cwd(), stdio: "pipe" });
      execSync("git checkout main", { cwd: process.cwd(), stdio: "pipe" });
    } catch (revertErr) {
      logError("stage4StaticAnalysis — revert failed", {
        historyId,
        error: String(revertErr),
      });
    }

    await db
      .update(evolutionHistory)
      .set({
        status: "abandoned",
        stageFailedAt: "stage4",
        stageFailureReason: "TypeScript compilation failed",
        staticAnalysisOutput: tscOutput.slice(0, 5000),
        branchName,
        updatedAt: new Date(),
      })
      .where(eq(evolutionHistory.id, historyId));
    return false;
  }

  // 5. Commit the change
  let commitHash = "";
  try {
    execSync(`git add ${targetFile}`, { cwd: process.cwd(), stdio: "pipe" });
    execSync(`git commit -m "evolution: ${historyId}"`, {
      cwd: process.cwd(),
      stdio: "pipe",
    });
    commitHash = execSync("git rev-parse HEAD", {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
    log("stage4StaticAnalysis — committed", { historyId, commitHash });
  } catch (err) {
    logError("stage4StaticAnalysis — commit failed", {
      historyId,
      error: String(err),
    });
    try {
      execSync("git checkout -- .", { cwd: process.cwd(), stdio: "pipe" });
      execSync("git checkout main", { cwd: process.cwd(), stdio: "pipe" });
    } catch (_) { /* best-effort cleanup */ }

    await db
      .update(evolutionHistory)
      .set({
        status: "abandoned",
        stageFailedAt: "stage4",
        stageFailureReason: `Git commit failed: ${String(err)}`,
        staticAnalysisOutput: tscOutput.slice(0, 5000),
        branchName,
        updatedAt: new Date(),
      })
      .where(eq(evolutionHistory.id, historyId));
    return false;
  }

  // 6. Update history to stage4_pass
  await db
    .update(evolutionHistory)
    .set({
      status: "stage4_pass",
      branchName,
      commitHash,
      staticAnalysisOutput: tscOutput.slice(0, 5000) || "(clean — no output)",
      stagesCompleted: sql`array_append(${evolutionHistory.stagesCompleted}, 'stage4')`,
      updatedAt: new Date(),
    })
    .where(eq(evolutionHistory.id, historyId));

  log("stage4StaticAnalysis — PASS", { historyId, branchName, commitHash });
  return true;
}

// ---------------------------------------------------------------------------
// Stage 5 — Deploy
// ---------------------------------------------------------------------------

/**
 * Records the baseline error rate, marks the history row as 'deployed', and
 * schedules an async 30-minute regression check via setTimeout.
 *
 * Returns true immediately — monitoring is non-blocking.
 */
export async function stage5Deploy(
  historyId: number,
  targetFile: string
): Promise<boolean> {
  log("stage5Deploy — deploying", { historyId, targetFile });

  // Rosy River C3: in PR mode (default), Stage 5 pushes the evolution branch
  // and opens a GitHub PR via gh. The founder reviews + merges in GitHub.
  // The regression check (Stage 6) only fires after the actual merge — for
  // now we don't auto-schedule it; a future iteration will poll for merge
  // via the GitHub API and trigger Stage 6 then.
  try {
    const { openPullRequestForEvolution, isPrModeEnabled } = await import("./evolutionPrGenerator");
    if (isPrModeEnabled()) {
      const [history] = await db
        .select({ branchName: evolutionHistory.branchName })
        .from(evolutionHistory)
        .where(eq(evolutionHistory.id, historyId))
        .limit(1);
      if (history?.branchName) {
        const pr = await openPullRequestForEvolution(historyId, history.branchName);
        if (pr) {
          await db
            .update(evolutionHistory)
            .set({
              status: "pr_opened",
              stagesCompleted: sql`array_append(${evolutionHistory.stagesCompleted}, 'stage5')`,
              updatedAt: new Date(),
            })
            .where(eq(evolutionHistory.id, historyId));
          log("stage5Deploy — PR opened, awaiting founder merge", {
            historyId,
            prNumber: pr.prNumber,
            prUrl: pr.prUrl,
          });
          return true;
        }
        logError("stage5Deploy — openPullRequest returned null, falling back to legacy deploy", {
          historyId,
        });
      } else {
        logError("stage5Deploy — no branchName on history row, falling back to legacy deploy", {
          historyId,
        });
      }
    }
  } catch (err) {
    logError("stage5Deploy — PR mode threw, falling back to legacy deploy", {
      historyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 1. Capture baseline error rate from the last hour of aiTelemetryEvents
  let baselineErrorRate = 0;
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Derive a taskType filter from the target file name for correlation
    const taskTypeHint = targetFile
      .replace(/^server\//, "")
      .replace(/\//g, "_")
      .replace(/\.ts$/, "");

    const [stats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        errors: sql<number>`sum(case when ${aiTelemetryEvents.success} = false then 1 else 0 end)::int`,
      })
      .from(aiTelemetryEvents)
      .where(gte(aiTelemetryEvents.createdAt, oneHourAgo));

    const total = stats?.total ?? 0;
    const errors = stats?.errors ?? 0;
    baselineErrorRate = total > 0 ? errors / total : 0;

    log("stage5Deploy — baseline captured", {
      historyId,
      total,
      errors,
      baselineErrorRate,
    });
  } catch (err) {
    logError("stage5Deploy — failed to capture baseline, defaulting to 0", {
      historyId,
      error: String(err),
    });
  }

  // 2. Mark as deployed + stamp the persisted Stage-6 due-time. The old
  // in-process setTimeout died with the process (a redeploy inside the 30-min
  // window silently skipped the regression check forever); the
  // evolution_regression_scan job now fires the check durably.
  try {
    await db
      .update(evolutionHistory)
      .set({
        status: "deployed",
        deployedAt: new Date(),
        errorRateBeforeDeploy: String(baselineErrorRate),
        regressionCheckDueAt: new Date(Date.now() + REGRESSION_CHECK_DELAY_MS),
        stagesCompleted: sql`array_append(${evolutionHistory.stagesCompleted}, 'stage5')`,
        updatedAt: new Date(),
      })
      .where(eq(evolutionHistory.id, historyId));
  } catch (err) {
    logError("stage5Deploy — failed to update history row", {
      historyId,
      error: String(err),
    });
    return false;
  }

  log("[evolution-pipeline] stage5Deploy — DEPLOYED, regression check due in 30m (durable scan)", {
    historyId,
  });

  return true;
}

/** How long after deploy the Stage-6 regression check becomes due. */
export const REGRESSION_CHECK_DELAY_MS = 30 * 60 * 1000;

/**
 * Durable Stage-6 driver (step-away gap #6) — run by the
 * evolution_regression_scan job every 10 minutes.
 *
 *  1. DUE CHECKS: for every deployed row whose regression_check_due_at has
 *     passed, atomically CLAIM the check (null the due-time via conditional
 *     UPDATE — exactly one scanner runs it) and fire stage6RegressionCheck.
 *  2. PR MODE: rows parked at 'pr_opened' never got a check at all ("never
 *     armed in PR mode"). When GITHUB_TOKEN + GITHUB_REPOSITORY are present,
 *     poll each open evolution PR; on merge, capture the baseline, flip the
 *     row to deployed, and stamp the due-time so step 1 picks it up.
 *
 * Never throws; returns honest counts.
 */
export async function scanDueRegressionChecks(): Promise<{
  checked: number;
  mergesDetected: number;
}> {
  let checked = 0;
  let mergesDetected = 0;

  // 1. Fire due checks (claim-by-nulling so a check runs exactly once).
  try {
    const due = await db
      .select({ id: evolutionHistory.id })
      .from(evolutionHistory)
      .where(
        and(
          eq(evolutionHistory.status, "deployed"),
          sql`${evolutionHistory.regressionCheckDueAt} IS NOT NULL`,
          sql`${evolutionHistory.regressionCheckDueAt} <= now()`
        )
      );
    for (const row of due) {
      const claimed = await db
        .update(evolutionHistory)
        .set({ regressionCheckDueAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(evolutionHistory.id, row.id),
            sql`${evolutionHistory.regressionCheckDueAt} IS NOT NULL`
          )
        )
        .returning({ id: evolutionHistory.id });
      if (claimed.length === 0) continue; // another scanner took it
      try {
        await stage6RegressionCheck(row.id);
        checked++;
      } catch (err) {
        logError("scanDueRegressionChecks — stage6 threw", {
          historyId: row.id,
          error: String(err),
        });
      }
    }
  } catch (err) {
    logError("scanDueRegressionChecks — due scan failed", { error: String(err) });
  }

  // 2. PR-mode merge detection — arms Stage 6 for founder-merged evolutions.
  // Credentials resolve through Platform Connections (founder-pasted, no
  // redeploy) with env fallback; fail-soft to env-only.
  let token: string | null = process.env.GITHUB_TOKEN ?? null;
  let repo: string | null = process.env.GITHUB_REPOSITORY ?? null;
  try {
    const { resolveGithubCredentials } = await import("./connections/platformConnections");
    const resolved = await resolveGithubCredentials();
    token = resolved.token ?? token;
    repo = resolved.repository ?? repo;
  } catch { /* env-only */ }
  if (token && repo && /^[\w.-]+\/[\w.-]+$/.test(repo)) {
    try {
      const parked = await db
        .select({ id: evolutionHistory.id, prNumber: evolutionHistory.prNumber })
        .from(evolutionHistory)
        .where(eq(evolutionHistory.status, "pr_opened"));
      for (const row of parked) {
        if (!row.prNumber) continue;
        try {
          const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${row.prNumber}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
          });
          if (!res.ok) continue;
          const pr = (await res.json()) as { merged?: boolean; state?: string };
          if (pr.merged === true) {
            await db
              .update(evolutionHistory)
              .set({
                status: "deployed",
                deployedAt: new Date(),
                regressionCheckDueAt: new Date(Date.now() + REGRESSION_CHECK_DELAY_MS),
                updatedAt: new Date(),
              })
              .where(and(eq(evolutionHistory.id, row.id), eq(evolutionHistory.status, "pr_opened")));
            mergesDetected++;
            log("scanDueRegressionChecks — evolution PR merged, Stage 6 armed", {
              historyId: row.id,
              prNumber: row.prNumber,
            });
          } else if (pr.state === "closed") {
            // Closed without merge = the founder rejected it. Terminal.
            await db
              .update(evolutionHistory)
              .set({ status: "abandoned", updatedAt: new Date() })
              .where(and(eq(evolutionHistory.id, row.id), eq(evolutionHistory.status, "pr_opened")));
            log("scanDueRegressionChecks — evolution PR closed unmerged, abandoned", {
              historyId: row.id,
              prNumber: row.prNumber,
            });
          }
        } catch (err) {
          logError("scanDueRegressionChecks — PR poll failed", {
            historyId: row.id,
            error: String(err),
          });
        }
      }
    } catch (err) {
      logError("scanDueRegressionChecks — pr_opened scan failed", { error: String(err) });
    }
  }

  return { checked, mergesDetected };
}

// ---------------------------------------------------------------------------
// Stage 6 — Regression Check
// ---------------------------------------------------------------------------

/**
 * Runs 30 minutes after deployment.  Compares the post-deploy error rate to
 * the baseline.  If errors have more than doubled, triggers an automatic
 * git revert and trips the circuit breaker.
 */
export async function stage6RegressionCheck(historyId: number): Promise<void> {
  log("stage6RegressionCheck — starting", { historyId });

  // 1. Fetch the history row to get the baseline error rate
  const [history] = await db
    .select()
    .from(evolutionHistory)
    .where(eq(evolutionHistory.id, historyId));

  if (!history) {
    logError("stage6RegressionCheck — history row not found", { historyId });
    return;
  }

  const baselineRate = parseFloat(String(history.errorRateBeforeDeploy ?? "0"));

  // 2. Check post-deploy error rate (last 30 minutes)
  let postDeployRate = 0;
  try {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    const [stats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        errors: sql<number>`sum(case when ${aiTelemetryEvents.success} = false then 1 else 0 end)::int`,
      })
      .from(aiTelemetryEvents)
      .where(gte(aiTelemetryEvents.createdAt, thirtyMinutesAgo));

    const total = stats?.total ?? 0;
    const errors = stats?.errors ?? 0;
    postDeployRate = total > 0 ? errors / total : 0;

    log("stage6RegressionCheck — post-deploy rate measured", {
      historyId,
      total,
      errors,
      postDeployRate,
      baselineRate,
    });
  } catch (err) {
    logError("stage6RegressionCheck — failed to measure post-deploy rate", {
      historyId,
      error: String(err),
    });
    return;
  }

  // 3. Update history with post-deploy metrics
  await db
    .update(evolutionHistory)
    .set({
      errorRateAfterDeploy: String(postDeployRate),
      updatedAt: new Date(),
    })
    .where(eq(evolutionHistory.id, historyId));

  // 4. Check regression threshold: > 2x baseline
  const threshold = baselineRate > 0 ? baselineRate * 2 : 0.1; // 10% floor if baseline was 0
  const isRegression = postDeployRate > threshold;

  if (isRegression) {
    logError("stage6RegressionCheck — REGRESSION DETECTED, reverting", {
      historyId,
      baselineRate,
      postDeployRate,
      threshold,
    });

    // Auto-revert via git
    try {
      execSync("git revert HEAD --no-edit", {
        cwd: process.cwd(),
        stdio: "pipe",
        timeout: 60_000,
      });
      log("stage6RegressionCheck — git revert successful", { historyId });
    } catch (revertErr) {
      logError("stage6RegressionCheck — git revert failed", {
        historyId,
        error: String(revertErr),
      });
    }

    // Update history
    await db
      .update(evolutionHistory)
      .set({
        status: "reverted",
        revertedAt: new Date(),
        revertReason: "error_rate_spike",
        updatedAt: new Date(),
      })
      .where(eq(evolutionHistory.id, historyId));

    // Trip the circuit breaker
    await tripCircuitBreaker("error_rate_spike_after_deploy");
  } else {
    log("stage6RegressionCheck — NO regression, deployment healthy", {
      historyId,
      baselineRate,
      postDeployRate,
    });
    await resetConsecutiveReverts();

    await db
      .update(evolutionHistory)
      .set({
        stagesCompleted: sql`array_append(${evolutionHistory.stagesCompleted}, 'stage6')`,
        updatedAt: new Date(),
      })
      .where(eq(evolutionHistory.id, historyId));
  }
}

// ---------------------------------------------------------------------------
// processPendingProposals  (master function)
// ---------------------------------------------------------------------------

/**
 * Master entry point for the evolution pipeline.
 *
 * 1. Checks the circuit breaker.
 * 2. Picks up the next pending self-assessment proposal from `agentTasks`.
 * 3. Runs it through Stages 1–5 sequentially, abandoning on any failure.
 * 4. Marks the agentTask as 'completed' or 'failed' accordingly.
 */
export async function processPendingProposals(): Promise<void> {
  log("processPendingProposals — starting");

  // 1. Circuit breaker check
  const clear = await checkCircuitBreaker();
  if (!clear) {
    log("processPendingProposals — circuit breaker is TRIPPED, aborting");
    return;
  }

  // 2. Find next pending proposal
  const [task] = await db
    .select()
    .from(agentTasks)
    .where(
      and(
        eq(agentTasks.agentType, "self_assessment"),
        eq(agentTasks.status, "pending")
      )
    )
    .orderBy(agentTasks.priority, agentTasks.createdAt)
    .limit(1);

  if (!task) {
    log("processPendingProposals — no pending proposals found");
    return;
  }

  log("processPendingProposals — picked up task", {
    taskId: task.id,
    priority: task.priority,
  });

  // 3. Mark task as processing
  await db
    .update(agentTasks)
    .set({ status: "processing", startedAt: new Date() })
    .where(eq(agentTasks.id, task.id));

  // Extract proposal fields from the task output (stored by selfAssessmentAgent)
  const output = (task.output ?? {}) as {
    description?: string;
    targetFile?: string;
    codeLocation?: string;
    proposedFix?: string;
    category?: string;
    estimatedImpact?: string;
  };

  const proposal = {
    description: output.proposedFix ?? output.description ?? "No description provided",
    targetFile: output.targetFile ?? "",
    codeLocation: output.codeLocation ?? "end of file",
  };

  if (!proposal.targetFile) {
    logError("processPendingProposals — task has no targetFile, marking failed", {
      taskId: task.id,
    });
    await db
      .update(agentTasks)
      .set({
        status: "failed",
        error: "Proposal has no targetFile",
        completedAt: new Date(),
      })
      .where(eq(agentTasks.id, task.id));
    return;
  }

  let historyId: number | null = null;

  try {
    // Stage 1: Generate
    const stage1Result = await stage1Generate(proposal);
    if (!stage1Result) {
      throw new Error("Stage 1 (code generation) failed or rejected");
    }
    const { code, historyId: hId } = stage1Result;
    historyId = hId;

    // Link history row back to the agentTask
    await db
      .update(evolutionHistory)
      .set({ proposalId: task.id, updatedAt: new Date() })
      .where(eq(evolutionHistory.id, historyId));

    // Stage 2: Adversarial Review
    const stage2Pass = await stage2AdversarialReview(code, historyId);
    if (!stage2Pass) {
      throw new Error("Stage 2 (adversarial review) blocked the code");
    }

    // Stage 3: Intent Verification
    const stage3Pass = await stage3IntentVerification(code, proposal, historyId);
    if (!stage3Pass) {
      throw new Error("Stage 3 (intent verification) failed");
    }

    // Stage 4: Static Analysis
    const stage4Pass = await stage4StaticAnalysis(proposal.targetFile, code, historyId);
    if (!stage4Pass) {
      throw new Error("Stage 4 (static analysis / TypeScript) failed");
    }

    // Stage 5: Deploy (async monitoring starts here)
    const stage5Pass = await stage5Deploy(historyId, proposal.targetFile);
    if (!stage5Pass) {
      throw new Error("Stage 5 (deploy) failed");
    }

    // Mark agentTask as completed
    await db
      .update(agentTasks)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(agentTasks.id, task.id));

    log("processPendingProposals — task COMPLETED", {
      taskId: task.id,
      historyId,
      targetFile: proposal.targetFile,
    });
  } catch (err) {
    const errorMsg = String(err);
    logError("processPendingProposals — pipeline FAILED", {
      taskId: task.id,
      historyId,
      error: errorMsg,
    });

    await db
      .update(agentTasks)
      .set({
        status: "failed",
        error: errorMsg,
        completedAt: new Date(),
      })
      .where(eq(agentTasks.id, task.id));
  }
}
