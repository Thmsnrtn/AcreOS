// @ts-nocheck
/**
 * Reactive Orchestration Engine — Sovereign Company Protocol v14
 *
 * The most critical V14 pillar: events trigger agent chains automatically,
 * creating closed-loop autonomous workflows. Domain events flow in, matching
 * chains fire, steps execute sequentially with governance gates, and downstream
 * chains cascade via cross-chain links.
 */

import { db } from "../db";
import {
  reactionChains,
  reactionChainRuns,
  reactionChainLinks,
} from "@shared/schema";
import { eq, and, desc, sql, gte, lte, inArray } from "drizzle-orm";
import crypto from "crypto";

// ─── Cross-Pillar Integration (V13 Services) ────────────────────────────────

import { governanceBrainService } from "./governanceBrainV13";
import { cognitiveMemoryService } from "./cognitiveMemoryV13";
import { selfHealingMeshService } from "./selfHealingMeshV13";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChainStep {
  agentCodename: string;
  action: string;
  inputMapping: Record<string, string>;
  governanceCheck: boolean;
  timeoutMs: number;
}

interface StepResult {
  stepIndex: number;
  agentCodename: string;
  action: string;
  input: Record<string, any>;
  status: "completed" | "timed_out" | "governance_blocked" | "error";
  output?: Record<string, any>;
  governanceResult?: string;
  haltReason?: string;
  durationMs: number;
  executedAt: string;
}

interface CreateChainData {
  name: string;
  description?: string;
  triggerEventType: string;
  triggerConditions?: Record<string, any>;
  steps: ChainStep[];
  enabled?: boolean;
  priority?: number;
  maxConcurrentRuns?: number;
  cooldownMs?: number;
}

interface UpdateChainData {
  name?: string;
  description?: string;
  triggerConditions?: Record<string, any>;
  steps?: ChainStep[];
  enabled?: boolean;
  priority?: number;
  maxConcurrentRuns?: number;
  cooldownMs?: number;
}

interface ChainFilters {
  triggerEventType?: string;
  enabled?: boolean;
}

interface RunFilters {
  chainId?: string;
  status?: string;
  startedAfter?: Date;
  startedBefore?: Date;
  limit?: number;
  offset?: number;
}

interface ChainStatsResult {
  chainId: string;
  totalRuns: number;
  successfulRuns: number;
  successRate: number;
  avgDurationMs: number | null;
  failureReasons: Record<string, number>;
  haltReasons: Record<string, number>;
}

interface EventCoverageResult {
  covered: string[];
  uncovered: string[];
  chainsByEvent: Record<string, number>;
}

// ─── Cooldown Tracker (in-memory for fast lookups) ───────────────────────────

const cooldownTracker: Map<string, number> = new Map();

// ─── Service ─────────────────────────────────────────────────────────────────

class ReactiveOrchestrationService {

  // ─── 1. Create Chain ─────────────────────────────────────────────────────────
  async createChain(orgId: number, data: CreateChainData) {
    const chainId = crypto.randomUUID();

    const [chain] = await db
      .insert(reactionChains)
      .values({
        chainId,
        orgId,
        name: data.name,
        description: data.description ?? null,
        triggerEventType: data.triggerEventType,
        triggerConditions: data.triggerConditions ?? {},
        steps: data.steps,
        enabled: data.enabled ?? true,
        priority: data.priority ?? 50,
        maxConcurrentRuns: data.maxConcurrentRuns ?? 5,
        cooldownMs: data.cooldownMs ?? 0,
        totalRuns: 0,
        successfulRuns: 0,
        avgDurationMs: null,
      })
      .returning();

    return chain;
  }

  // ─── 2. Update Chain ─────────────────────────────────────────────────────────
  async updateChain(chainId: string, updates: UpdateChainData) {
    const updatePayload: Record<string, any> = { updatedAt: new Date() };

    if (updates.name !== undefined) updatePayload.name = updates.name;
    if (updates.description !== undefined) updatePayload.description = updates.description;
    if (updates.triggerConditions !== undefined) updatePayload.triggerConditions = updates.triggerConditions;
    if (updates.steps !== undefined) updatePayload.steps = updates.steps;
    if (updates.enabled !== undefined) updatePayload.enabled = updates.enabled;
    if (updates.priority !== undefined) updatePayload.priority = updates.priority;
    if (updates.maxConcurrentRuns !== undefined) updatePayload.maxConcurrentRuns = updates.maxConcurrentRuns;
    if (updates.cooldownMs !== undefined) updatePayload.cooldownMs = updates.cooldownMs;

    const [chain] = await db
      .update(reactionChains)
      .set(updatePayload)
      .where(eq(reactionChains.chainId, chainId))
      .returning();

    return chain;
  }

  // ─── 3. Delete Chain (soft) ──────────────────────────────────────────────────
  async deleteChain(chainId: string) {
    const [existing] = await db
      .select()
      .from(reactionChains)
      .where(eq(reactionChains.chainId, chainId))
      .limit(1);

    if (!existing) return null;

    const [chain] = await db
      .update(reactionChains)
      .set({
        enabled: false,
        name: `[DELETED] ${existing.name}`,
        updatedAt: new Date(),
      })
      .where(eq(reactionChains.chainId, chainId))
      .returning();

    return chain;
  }

  // ─── 4. Get Chains ──────────────────────────────────────────────────────────
  async getChains(orgId: number, filters?: ChainFilters) {
    const conditions: any[] = [eq(reactionChains.orgId, orgId)];

    if (filters?.triggerEventType) {
      conditions.push(eq(reactionChains.triggerEventType, filters.triggerEventType));
    }
    if (filters?.enabled !== undefined) {
      conditions.push(eq(reactionChains.enabled, filters.enabled));
    }

    const chains = await db
      .select()
      .from(reactionChains)
      .where(and(...conditions))
      .orderBy(desc(reactionChains.priority));

    return chains;
  }

  // ─── 5. Link Chains ─────────────────────────────────────────────────────────
  async linkChains(
    fromChainId: string,
    toChainId: string,
    linkType: "on_complete" | "on_fail" | "on_halt",
    conditionFilter?: Record<string, any>,
  ) {
    const [link] = await db
      .insert(reactionChainLinks)
      .values({
        fromChainId,
        toChainId,
        linkType,
        conditionFilter: conditionFilter ?? {},
      })
      .returning();

    return link;
  }

  // ─── 6. Process Event — THE MAIN METHOD ──────────────────────────────────────
  async processEvent(
    orgId: number,
    eventType: string,
    eventPayload: Record<string, any>,
  ): Promise<string[]> {
    // Find all enabled chains matching this event type for this org
    const matchingChains = await db
      .select()
      .from(reactionChains)
      .where(
        and(
          eq(reactionChains.orgId, orgId),
          eq(reactionChains.triggerEventType, eventType),
          eq(reactionChains.enabled, true),
        ),
      )
      .orderBy(desc(reactionChains.priority));

    const runIds: string[] = [];

    for (const chain of matchingChains) {
      // Evaluate trigger conditions against the payload
      const conditions = (chain.triggerConditions ?? {}) as Record<string, any>;
      if (Object.keys(conditions).length > 0) {
        if (!this.evaluateConditions(conditions, eventPayload)) {
          continue;
        }
      }

      // Check cooldown: skip if same chain+entity was triggered within cooldownMs
      const cooldownMs = chain.cooldownMs ?? 0;
      if (cooldownMs > 0) {
        const entityKey = eventPayload.entityId ?? eventPayload.id ?? "global";
        const cooldownKey = `${chain.chainId}:${entityKey}`;
        const lastTriggered = cooldownTracker.get(cooldownKey);
        const now = Date.now();

        if (lastTriggered && now - lastTriggered < cooldownMs) {
          continue; // Still in cooldown
        }
        cooldownTracker.set(cooldownKey, now);
      }

      // Check concurrency: skip if activeRuns >= maxConcurrentRuns
      const [activeCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(reactionChainRuns)
        .where(
          and(
            eq(reactionChainRuns.chainId, chain.chainId),
            eq(reactionChainRuns.status, "running"),
          ),
        );

      if ((activeCount?.count ?? 0) >= chain.maxConcurrentRuns) {
        continue; // At capacity
      }

      // Execute the chain
      const triggerEvent = { eventType, payload: eventPayload, triggeredAt: new Date().toISOString() };
      const run = await this.executeChain(chain, triggerEvent);
      if (run) {
        runIds.push(run.runId);
      }
    }

    return runIds;
  }

  // ─── 7. Execute Chain ────────────────────────────────────────────────────────
  async executeChain(
    chain: typeof reactionChains.$inferSelect,
    triggerEvent: Record<string, any>,
  ) {
    const runId = crypto.randomUUID();
    const startTime = Date.now();

    // Create the run record
    const [run] = await db
      .insert(reactionChainRuns)
      .values({
        runId,
        chainId: chain.chainId,
        orgId: chain.orgId,
        triggerEvent,
        status: "running",
        currentStepIndex: 0,
        stepResults: [],
        startedAt: new Date(),
      })
      .returning();

    const steps = (chain.steps ?? []) as ChainStep[];
    const stepResults: StepResult[] = [];
    let halted = false;
    let haltReason: string | null = null;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepStart = Date.now();

      // Update current step index
      await db
        .update(reactionChainRuns)
        .set({ currentStepIndex: i })
        .where(eq(reactionChainRuns.runId, runId));

      // Build step input by mapping trigger event fields through inputMapping
      const stepInput: Record<string, any> = {};
      for (const [targetKey, sourcePath] of Object.entries(step.inputMapping)) {
        stepInput[targetKey] = this.getNestedValue(triggerEvent.payload ?? triggerEvent, sourcePath);
      }

      // Governance check if required
      if (step.governanceCheck) {
        try {
          const evaluation = await governanceBrainService.evaluateAction({
            actionId: crypto.randomUUID(),
            agentCodename: step.agentCodename,
            actionType: step.action,
            actionContext: stepInput,
            orgId: chain.orgId,
          });

          if (evaluation.overallResult === "blocked") {
            const reason = `Governance blocked at step ${i}: ${step.agentCodename}.${step.action} — ${evaluation.explanation}`;
            stepResults.push({
              stepIndex: i,
              agentCodename: step.agentCodename,
              action: step.action,
              input: stepInput,
              status: "governance_blocked",
              governanceResult: evaluation.overallResult,
              haltReason: reason,
              durationMs: Date.now() - stepStart,
              executedAt: new Date().toISOString(),
            });

            halted = true;
            haltReason = reason;

            // Update run as halted
            await db
              .update(reactionChainRuns)
              .set({
                status: "halted_for_review",
                stepResults: [...stepResults],
                haltReason: reason,
                currentStepIndex: i,
              })
              .where(eq(reactionChainRuns.runId, runId));

            break;
          }
        } catch (err: any) {
          // Governance service error — log but continue
          stepResults.push({
            stepIndex: i,
            agentCodename: step.agentCodename,
            action: step.action,
            input: stepInput,
            status: "error",
            haltReason: `Governance check error: ${err.message}`,
            durationMs: Date.now() - stepStart,
            executedAt: new Date().toISOString(),
          });
          continue;
        }
      }

      // Check timeout — simulate execution duration
      const stepDuration = Date.now() - stepStart;
      if (step.timeoutMs > 0 && stepDuration > step.timeoutMs) {
        stepResults.push({
          stepIndex: i,
          agentCodename: step.agentCodename,
          action: step.action,
          input: stepInput,
          status: "timed_out",
          durationMs: stepDuration,
          executedAt: new Date().toISOString(),
        });
        continue;
      }

      // Execute step through the REAL execution engine (Phase A-E upgrade)
      let stepOutput: Record<string, any>;
      try {
        const { executionEngine } = await import("./executionEngine");
        const execResult = await executionEngine.execute({
          orgId,
          agentCodename: step.agentCodename,
          action: step.action,
          input: stepInput,
          chainRunId: run.id,
          stepIndex: i,
        });
        stepOutput = {
          agent: step.agentCodename,
          action: step.action,
          input: stepInput,
          executedAt: new Date().toISOString(),
          ...execResult.output,
          success: execResult.success,
          sideEffects: execResult.sideEffects,
          error: execResult.error,
        };
        if (!execResult.success) {
          stepResults.push({
            stepIndex: i,
            agentCodename: step.agentCodename,
            action: step.action,
            input: stepInput,
            status: "failed",
            output: stepOutput,
            durationMs: Date.now() - stepStart,
            executedAt: new Date().toISOString(),
            error: execResult.error,
          });
          break; // Stop chain on failure
        }
      } catch (execErr: any) {
        stepOutput = {
          agent: step.agentCodename,
          action: step.action,
          input: stepInput,
          executedAt: new Date().toISOString(),
          error: execErr.message,
        };
        stepResults.push({
          stepIndex: i,
          agentCodename: step.agentCodename,
          action: step.action,
          input: stepInput,
          status: "failed",
          output: stepOutput,
          durationMs: Date.now() - stepStart,
          executedAt: new Date().toISOString(),
          error: execErr.message,
        });
        break;
      }

      stepResults.push({
        stepIndex: i,
        agentCodename: step.agentCodename,
        action: step.action,
        input: stepInput,
        status: "completed",
        output: stepOutput,
        durationMs: Date.now() - stepStart,
        executedAt: new Date().toISOString(),
      });

      // Record episode in cognitive memory for the executing agent
      try {
        await cognitiveMemoryService.recordEpisode(step.agentCodename, {
          action: step.action,
          outcome: `Executed step ${i} of chain "${chain.name}"`,
          outcomeSuccess: true,
          context: {
            chainId: chain.chainId,
            runId,
            stepIndex: i,
            triggerEvent,
            input: stepInput,
          },
          tags: ["reactive-orchestration", chain.triggerEventType, chain.name],
          orgId: chain.orgId,
        });
      } catch (_memErr) {
        // Memory recording is non-critical — don't halt the chain
      }
    }

    // If halted, don't update stats — return run as-is
    if (halted) {
      const [haltedRun] = await db
        .select()
        .from(reactionChainRuns)
        .where(eq(reactionChainRuns.runId, runId))
        .limit(1);

      return haltedRun;
    }

    // Determine final status
    const hasErrors = stepResults.some((r) => r.status === "error");
    const allTimedOut = stepResults.every((r) => r.status === "timed_out");
    const finalStatus = hasErrors || allTimedOut ? "failed" : "completed";

    const totalDurationMs = Date.now() - startTime;

    // Update the run record
    await db
      .update(reactionChainRuns)
      .set({
        status: finalStatus,
        stepResults: [...stepResults],
        currentStepIndex: steps.length,
        totalDurationMs,
        completedAt: new Date(),
      })
      .where(eq(reactionChainRuns.runId, runId));

    // Update chain stats using running average
    const newTotalRuns = (chain.totalRuns ?? 0) + 1;
    const newSuccessfulRuns = finalStatus === "completed"
      ? (chain.successfulRuns ?? 0) + 1
      : (chain.successfulRuns ?? 0);
    const oldAvg = chain.avgDurationMs ?? 0;
    const newAvgDuration = Math.round(oldAvg + (totalDurationMs - oldAvg) / newTotalRuns);

    await db
      .update(reactionChains)
      .set({
        totalRuns: newTotalRuns,
        successfulRuns: newSuccessfulRuns,
        avgDurationMs: newAvgDuration,
        updatedAt: new Date(),
      })
      .where(eq(reactionChains.chainId, chain.chainId));

    // Check reactionChainLinks for downstream chains to trigger
    const linkType = finalStatus === "completed" ? "on_complete" : "on_fail";
    await this.triggerDownstreamChains(chain.chainId, linkType, triggerEvent);

    // Fetch and return the final run
    const [completedRun] = await db
      .select()
      .from(reactionChainRuns)
      .where(eq(reactionChainRuns.runId, runId))
      .limit(1);

    return completedRun;
  }

  // ─── 8. Resume Run ──────────────────────────────────────────────────────────
  async resumeRun(runId: string, resumedBy: string) {
    const [existingRun] = await db
      .select()
      .from(reactionChainRuns)
      .where(eq(reactionChainRuns.runId, runId))
      .limit(1);

    if (!existingRun) return null;
    if (existingRun.status !== "halted_for_review") return existingRun;

    // Mark as resumed
    await db
      .update(reactionChainRuns)
      .set({ status: "running", resumedBy })
      .where(eq(reactionChainRuns.runId, runId));

    // Fetch the chain to get the steps
    const [chain] = await db
      .select()
      .from(reactionChains)
      .where(eq(reactionChains.chainId, existingRun.chainId))
      .limit(1);

    if (!chain) return null;

    const steps = (chain.steps ?? []) as ChainStep[];
    const previousResults = (existingRun.stepResults ?? []) as StepResult[];
    const stepResults: StepResult[] = [...previousResults];
    const resumeFromIndex = existingRun.currentStepIndex + 1;
    const startTime = Date.now();
    let halted = false;

    for (let i = resumeFromIndex; i < steps.length; i++) {
      const step = steps[i];
      const stepStart = Date.now();

      await db
        .update(reactionChainRuns)
        .set({ currentStepIndex: i })
        .where(eq(reactionChainRuns.runId, runId));

      // Build step input
      const triggerEvent = existingRun.triggerEvent as Record<string, any>;
      const stepInput: Record<string, any> = {};
      for (const [targetKey, sourcePath] of Object.entries(step.inputMapping)) {
        stepInput[targetKey] = this.getNestedValue(triggerEvent.payload ?? triggerEvent, sourcePath);
      }

      // Governance check if required
      if (step.governanceCheck) {
        try {
          const evaluation = await governanceBrainService.evaluateAction({
            actionId: crypto.randomUUID(),
            agentCodename: step.agentCodename,
            actionType: step.action,
            actionContext: stepInput,
            orgId: chain.orgId,
          });

          if (evaluation.overallResult === "blocked") {
            const reason = `Governance blocked at step ${i}: ${step.agentCodename}.${step.action} — ${evaluation.explanation}`;
            stepResults.push({
              stepIndex: i,
              agentCodename: step.agentCodename,
              action: step.action,
              input: stepInput,
              status: "governance_blocked",
              governanceResult: evaluation.overallResult,
              haltReason: reason,
              durationMs: Date.now() - stepStart,
              executedAt: new Date().toISOString(),
            });

            halted = true;
            await db
              .update(reactionChainRuns)
              .set({
                status: "halted_for_review",
                stepResults: [...stepResults],
                haltReason: reason,
                currentStepIndex: i,
              })
              .where(eq(reactionChainRuns.runId, runId));

            break;
          }
        } catch (err: any) {
          stepResults.push({
            stepIndex: i,
            agentCodename: step.agentCodename,
            action: step.action,
            input: stepInput,
            status: "error",
            haltReason: `Governance check error: ${err.message}`,
            durationMs: Date.now() - stepStart,
            executedAt: new Date().toISOString(),
          });
          continue;
        }
      }

      // Execute step (simulated)
      const stepOutput = {
        agent: step.agentCodename,
        action: step.action,
        input: stepInput,
        executedAt: new Date().toISOString(),
        simulatedResult: `${step.agentCodename} executed ${step.action} successfully (resumed)`,
      };

      stepResults.push({
        stepIndex: i,
        agentCodename: step.agentCodename,
        action: step.action,
        input: stepInput,
        status: "completed",
        output: stepOutput,
        durationMs: Date.now() - stepStart,
        executedAt: new Date().toISOString(),
      });

      // Record to cognitive memory
      try {
        await cognitiveMemoryService.recordEpisode(step.agentCodename, {
          action: step.action,
          outcome: `Executed step ${i} of chain "${chain.name}" (resumed by ${resumedBy})`,
          outcomeSuccess: true,
          context: {
            chainId: chain.chainId,
            runId,
            stepIndex: i,
            triggerEvent: existingRun.triggerEvent,
            input: stepInput,
            resumedBy,
          },
          tags: ["reactive-orchestration", "resumed", chain.triggerEventType],
          orgId: chain.orgId,
        });
      } catch (_memErr) {
        // Non-critical
      }
    }

    if (halted) {
      const [haltedRun] = await db
        .select()
        .from(reactionChainRuns)
        .where(eq(reactionChainRuns.runId, runId))
        .limit(1);
      return haltedRun;
    }

    // Finalize run
    const hasErrors = stepResults.some((r) => r.status === "error");
    const finalStatus = hasErrors ? "failed" : "completed";
    const totalDurationMs = (existingRun.totalDurationMs ?? 0) + (Date.now() - startTime);

    await db
      .update(reactionChainRuns)
      .set({
        status: finalStatus,
        stepResults: [...stepResults],
        currentStepIndex: steps.length,
        totalDurationMs,
        completedAt: new Date(),
      })
      .where(eq(reactionChainRuns.runId, runId));

    // Update chain stats
    const newTotalRuns = (chain.totalRuns ?? 0) + 1;
    const newSuccessfulRuns = finalStatus === "completed"
      ? (chain.successfulRuns ?? 0) + 1
      : (chain.successfulRuns ?? 0);
    const oldAvg = chain.avgDurationMs ?? 0;
    const newAvgDuration = Math.round(oldAvg + (totalDurationMs - oldAvg) / newTotalRuns);

    await db
      .update(reactionChains)
      .set({
        totalRuns: newTotalRuns,
        successfulRuns: newSuccessfulRuns,
        avgDurationMs: newAvgDuration,
        updatedAt: new Date(),
      })
      .where(eq(reactionChains.chainId, chain.chainId));

    // Trigger downstream chains
    const linkType = finalStatus === "completed" ? "on_complete" : "on_fail";
    const triggerEvent = existingRun.triggerEvent as Record<string, any>;
    await this.triggerDownstreamChains(chain.chainId, linkType, triggerEvent);

    const [finalRun] = await db
      .select()
      .from(reactionChainRuns)
      .where(eq(reactionChainRuns.runId, runId))
      .limit(1);

    return finalRun;
  }

  // ─── 9. Get Run History ─────────────────────────────────────────────────────
  async getRunHistory(orgId: number, filters?: RunFilters) {
    const conditions: any[] = [eq(reactionChainRuns.orgId, orgId)];

    if (filters?.chainId) {
      conditions.push(eq(reactionChainRuns.chainId, filters.chainId));
    }
    if (filters?.status) {
      conditions.push(eq(reactionChainRuns.status, filters.status));
    }
    if (filters?.startedAfter) {
      conditions.push(gte(reactionChainRuns.startedAt, filters.startedAfter));
    }
    if (filters?.startedBefore) {
      conditions.push(lte(reactionChainRuns.startedAt, filters.startedBefore));
    }

    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;

    const runs = await db
      .select()
      .from(reactionChainRuns)
      .where(and(...conditions))
      .orderBy(desc(reactionChainRuns.startedAt))
      .limit(limit)
      .offset(offset);

    return runs;
  }

  // ─── 10. Get Run Details ────────────────────────────────────────────────────
  async getRunDetails(runId: string) {
    const [run] = await db
      .select()
      .from(reactionChainRuns)
      .where(eq(reactionChainRuns.runId, runId))
      .limit(1);

    if (!run) return null;

    // Also fetch the chain definition for context
    const [chain] = await db
      .select()
      .from(reactionChains)
      .where(eq(reactionChains.chainId, run.chainId))
      .limit(1);

    return {
      run,
      chain: chain ?? null,
      stepResults: (run.stepResults ?? []) as StepResult[],
      stepsTotal: chain ? ((chain.steps ?? []) as ChainStep[]).length : 0,
      stepsCompleted: ((run.stepResults ?? []) as StepResult[]).filter(
        (r) => r.status === "completed",
      ).length,
    };
  }

  // ─── 11. Get Chain Stats ────────────────────────────────────────────────────
  async getChainStats(chainId: string): Promise<ChainStatsResult | null> {
    const [chain] = await db
      .select()
      .from(reactionChains)
      .where(eq(reactionChains.chainId, chainId))
      .limit(1);

    if (!chain) return null;

    // Fetch failure/halt reasons from recent runs
    const recentRuns = await db
      .select()
      .from(reactionChainRuns)
      .where(eq(reactionChainRuns.chainId, chainId))
      .orderBy(desc(reactionChainRuns.startedAt))
      .limit(200);

    const failureReasons: Record<string, number> = {};
    const haltReasons: Record<string, number> = {};

    for (const run of recentRuns) {
      if (run.status === "failed") {
        const results = (run.stepResults ?? []) as StepResult[];
        const failedStep = results.find((r) => r.status === "error" || r.status === "timed_out");
        const reason = failedStep
          ? `${failedStep.agentCodename}.${failedStep.action}: ${failedStep.status}`
          : "unknown";
        failureReasons[reason] = (failureReasons[reason] ?? 0) + 1;
      }
      if (run.status === "halted_for_review" && run.haltReason) {
        const shortReason = run.haltReason.length > 100
          ? run.haltReason.substring(0, 100) + "..."
          : run.haltReason;
        haltReasons[shortReason] = (haltReasons[shortReason] ?? 0) + 1;
      }
    }

    const totalRuns = chain.totalRuns ?? 0;
    const successfulRuns = chain.successfulRuns ?? 0;

    return {
      chainId,
      totalRuns,
      successfulRuns,
      successRate: totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 10000) / 100 : 0,
      avgDurationMs: chain.avgDurationMs ?? null,
      failureReasons,
      haltReasons,
    };
  }

  // ─── 12. Get Event Coverage ─────────────────────────────────────────────────
  async getEventCoverage(orgId: number): Promise<EventCoverageResult> {
    // Get all distinct event types that have chains
    const chains = await db
      .select({
        triggerEventType: reactionChains.triggerEventType,
        count: sql<number>`count(*)::int`,
      })
      .from(reactionChains)
      .where(and(eq(reactionChains.orgId, orgId), eq(reactionChains.enabled, true)))
      .groupBy(reactionChains.triggerEventType);

    const chainsByEvent: Record<string, number> = {};
    const covered: string[] = [];

    for (const row of chains) {
      chainsByEvent[row.triggerEventType] = row.count;
      covered.push(row.triggerEventType);
    }

    // Get all distinct event types that have been seen in runs but have no chain
    const seenEvents = await db
      .select({
        eventType: sql<string>`DISTINCT (trigger_event->>'eventType')`,
      })
      .from(reactionChainRuns)
      .where(eq(reactionChainRuns.orgId, orgId));

    // Also check for common event types that should be covered
    const knownEventTypes = [
      "lead.created",
      "lead.qualified",
      "lead.lost",
      "deal.created",
      "deal.won",
      "deal.lost",
      "deal.stalled",
      "task.completed",
      "task.overdue",
      "payment.received",
      "payment.failed",
      "property.listed",
      "property.sold",
      "agent.error",
      "agent.degraded",
      "compliance.violation",
      "review.received",
    ];

    const allSeenTypes = new Set<string>([
      ...seenEvents.map((e) => e.eventType).filter(Boolean),
      ...knownEventTypes,
    ]);

    const uncovered = Array.from(allSeenTypes).filter((et) => !chainsByEvent[et]);

    return { covered, uncovered, chainsByEvent };
  }

  // ─── Private: Trigger Downstream Chains ─────────────────────────────────────
  private async triggerDownstreamChains(
    fromChainId: string,
    linkType: string,
    triggerEvent: Record<string, any>,
  ) {
    const links = await db
      .select()
      .from(reactionChainLinks)
      .where(
        and(
          eq(reactionChainLinks.fromChainId, fromChainId),
          eq(reactionChainLinks.linkType, linkType),
        ),
      );

    for (const link of links) {
      // If there's a condition filter, evaluate it against the trigger event payload
      const conditionFilter = (link.conditionFilter ?? {}) as Record<string, any>;
      if (Object.keys(conditionFilter).length > 0) {
        const payload = triggerEvent.payload ?? triggerEvent;
        if (!this.evaluateConditions(conditionFilter, payload)) {
          continue;
        }
      }

      // Fetch the downstream chain and execute it
      const [downstreamChain] = await db
        .select()
        .from(reactionChains)
        .where(
          and(
            eq(reactionChains.chainId, link.toChainId),
            eq(reactionChains.enabled, true),
          ),
        )
        .limit(1);

      if (downstreamChain) {
        const cascadeTrigger = {
          ...triggerEvent,
          cascadedFrom: fromChainId,
          cascadeLinkType: linkType,
        };
        await this.executeChain(downstreamChain, cascadeTrigger);
      }
    }
  }

  // ─── Private: Evaluate Conditions (JSON Path Matcher) ───────────────────────
  /**
   * Evaluate trigger conditions against an event payload.
   * Supports operators: $eq, $ne, $gte, $lte, $in, $exists
   * Supports dot-notation for nested paths: "deal.amount", "lead.tags", "property.state"
   *
   * Conditions format:
   * {
   *   "lead.score": { "$gte": 80 },
   *   "deal.amount": { "$lte": 500000 },
   *   "property.state": { "$in": ["TX", "CA", "FL"] },
   *   "lead.email": { "$exists": true },
   *   "status": { "$eq": "qualified" },
   *   "source": { "$ne": "spam" }
   * }
   *
   * All conditions must match (AND logic). Returns true if all conditions pass.
   */
  private evaluateConditions(
    conditions: Record<string, any>,
    payload: Record<string, any>,
  ): boolean {
    for (const [path, condition] of Object.entries(conditions)) {
      const actualValue = this.getNestedValue(payload, path);

      // If condition is a primitive (not an operator object), treat as $eq
      if (condition === null || typeof condition !== "object" || Array.isArray(condition)) {
        if (actualValue !== condition) return false;
        continue;
      }

      // Evaluate each operator in the condition object
      for (const [operator, expected] of Object.entries(condition)) {
        switch (operator) {
          case "$eq":
            if (actualValue !== expected) return false;
            break;

          case "$ne":
            if (actualValue === expected) return false;
            break;

          case "$gte":
            if (typeof actualValue !== "number" || actualValue < (expected as number)) return false;
            break;

          case "$lte":
            if (typeof actualValue !== "number" || actualValue > (expected as number)) return false;
            break;

          case "$in":
            if (!Array.isArray(expected)) return false;
            if (Array.isArray(actualValue)) {
              // If actual value is an array, check for intersection
              const hasOverlap = actualValue.some((v: any) => (expected as any[]).includes(v));
              if (!hasOverlap) return false;
            } else {
              if (!(expected as any[]).includes(actualValue)) return false;
            }
            break;

          case "$exists":
            if (expected === true && actualValue === undefined) return false;
            if (expected === false && actualValue !== undefined) return false;
            break;

          default:
            // Unknown operator — skip (lenient evaluation)
            break;
        }
      }
    }

    return true;
  }

  // ─── Private: Get Nested Value by Dot Path ──────────────────────────────────
  private getNestedValue(obj: Record<string, any>, path: string): any {
    const parts = path.split(".");
    let current: any = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== "object") return undefined;
      current = current[part];
    }

    return current;
  }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

export const reactiveOrchestrationService = new ReactiveOrchestrationService();
