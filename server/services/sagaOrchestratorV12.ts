// @ts-nocheck
/**
 * Saga Orchestrator — Sovereign Company Protocol v12
 *
 * Distributed transactions with compensation. Each saga defines ordered steps
 * with both an action and a compensating action. Steps execute sequentially;
 * if any step fails, compensating actions run in reverse order to maintain
 * consistency. Idempotency keys prevent duplicate saga creation.
 */

import { db } from "../db";
import {
  sagaInstances,
  type SagaInstance,
} from "@shared/schema";
import { eq, desc, and, lte, sql, isNull, inArray } from "drizzle-orm";
import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SagaStep {
  order: number;
  agent: string;
  action: string;
  compensatingAction: string;
  status: string;
  result?: Record<string, any>;
  compensationResult?: Record<string, any>;
}

type SagaStatus = "running" | "completed" | "rolled_back" | "partially_compensated" | "timed_out";
type StepStatus = "pending" | "executing" | "completed" | "failed" | "compensated";

interface CreateSagaParams {
  sagaName: string;
  initiatorAgent: string;
  steps: Array<{
    agent: string;
    action: string;
    compensatingAction: string;
  }>;
  idempotencyKey: string;
  timeoutMs?: number;
  parentSagaId?: string;
  orgId?: number;
}

interface StepExecutionResult {
  success: boolean;
  result?: Record<string, any>;
  error?: string;
}

// ─── Real Step Execution via Execution Engine ────────────────────────────────

async function executeStep(step: SagaStep): Promise<StepExecutionResult> {
  console.log(
    `[saga] Executing step ${step.order}: ${step.agent} → ${step.action}`,
  );

  try {
    const { executionEngine } = await import("./executionEngine");
    const result = await executionEngine.execute({
      orgId: 0, // Sagas are system-level; orgId resolved from context
      agentCodename: step.agent,
      action: step.action,
      input: (step as any).input ?? {},
    });

    if (result.success) {
      return {
        success: true,
        result: {
          executedAt: new Date().toISOString(),
          agent: step.agent,
          action: step.action,
          ...result.output,
          sideEffects: result.sideEffects,
          durationMs: result.durationMs,
        },
      };
    }

    return {
      success: false,
      error: result.error ?? `Failed executing ${step.action} for ${step.agent}`,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message ?? `Exception executing ${step.action}`,
    };
  }
}

async function executeCompensation(step: SagaStep): Promise<StepExecutionResult> {
  console.log(
    `[saga] Compensating step ${step.order}: ${step.agent} → ${step.compensatingAction}`,
  );

  if (!step.compensatingAction) {
    return { success: true, result: { note: "No compensation defined", agent: step.agent } };
  }

  try {
    const { executionEngine } = await import("./executionEngine");
    const result = await executionEngine.execute({
      orgId: 0,
      agentCodename: step.agent,
      action: step.compensatingAction,
      input: (step as any).compensationInput ?? {},
    });

    return {
      success: result.success,
      result: {
        compensatedAt: new Date().toISOString(),
        agent: step.agent,
        compensatingAction: step.compensatingAction,
        ...result.output,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message ?? `Compensation failed: ${step.compensatingAction}`,
    };
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

class SagaOrchestratorService {
  /**
   * Define a new saga with ordered steps.
   * Idempotency: returns existing saga if idempotencyKey already exists.
   */
  async createSaga(params: CreateSagaParams): Promise<SagaInstance> {
    // Check idempotency
    const existing = await db
      .select()
      .from(sagaInstances)
      .where(eq(sagaInstances.idempotencyKey, params.idempotencyKey))
      .limit(1);

    if (existing.length > 0) {
      console.log(
        `[saga] Idempotent hit for key ${params.idempotencyKey}, returning existing saga ${existing[0].sagaId}`,
      );
      return existing[0];
    }

    const sagaId = crypto.randomUUID();
    const steps: SagaStep[] = params.steps.map((s, i) => ({
      order: i + 1,
      agent: s.agent,
      action: s.action,
      compensatingAction: s.compensatingAction,
      status: "pending" as StepStatus,
    }));

    const [saga] = await db
      .insert(sagaInstances)
      .values({
        sagaId,
        sagaName: params.sagaName,
        initiatorAgent: params.initiatorAgent,
        status: "running",
        steps,
        currentStep: 0,
        totalSteps: steps.length,
        idempotencyKey: params.idempotencyKey,
        timeoutMs: params.timeoutMs ?? 300000,
        parentSagaId: params.parentSagaId ?? null,
        orgId: params.orgId ?? null,
      })
      .returning();

    console.log(
      `[saga] Created saga ${sagaId} (${params.sagaName}) with ${steps.length} steps`,
    );
    return saga;
  }

  /**
   * Execute a saga's steps sequentially.
   * If any step fails, compensate all completed steps in reverse order.
   */
  async executeSaga(sagaId: string): Promise<SagaInstance> {
    const saga = await this.getById(sagaId);
    if (!saga) throw new Error(`Saga not found: ${sagaId}`);
    if (saga.status !== "running") {
      throw new Error(`Saga ${sagaId} is not in running state (current: ${saga.status})`);
    }

    const steps = [...saga.steps] as SagaStep[];
    let failedAtStep = -1;

    for (let i = saga.currentStep; i < steps.length; i++) {
      const step = steps[i];

      // Mark step as executing
      step.status = "executing";
      await this.updateSteps(sagaId, steps, i);

      const result = await executeStep(step);

      if (result.success) {
        step.status = "completed";
        step.result = result.result;
        await this.updateSteps(sagaId, steps, i + 1);
      } else {
        step.status = "failed";
        step.result = { error: result.error };
        failedAtStep = i;
        await this.updateSteps(sagaId, steps, i);

        console.warn(
          `[saga] Step ${i + 1}/${steps.length} failed in saga ${sagaId}: ${result.error}`,
        );
        break;
      }
    }

    // All steps completed successfully
    if (failedAtStep === -1) {
      const [completed] = await db
        .update(sagaInstances)
        .set({
          status: "completed",
          steps,
          currentStep: steps.length,
          completedAt: new Date(),
        })
        .where(eq(sagaInstances.sagaId, sagaId))
        .returning();

      console.log(`[saga] Saga ${sagaId} completed successfully`);
      return completed;
    }

    // A step failed — compensate in reverse
    return this.compensateFromStep(sagaId, steps, failedAtStep);
  }

  /**
   * Run compensation for completed steps in reverse order starting from the failed step.
   */
  private async compensateFromStep(
    sagaId: string,
    steps: SagaStep[],
    failedAtStep: number,
  ): Promise<SagaInstance> {
    let allCompensated = true;

    // Compensate completed steps in reverse order (skip the failed step itself)
    for (let i = failedAtStep - 1; i >= 0; i--) {
      const step = steps[i];
      if (step.status !== "completed") continue;

      const result = await executeCompensation(step);

      if (result.success) {
        step.status = "compensated";
        step.compensationResult = result.result;
      } else {
        // Compensation itself failed — partial compensation
        allCompensated = false;
        step.compensationResult = { error: result.error };
        console.error(
          `[saga] Compensation failed for step ${i + 1} in saga ${sagaId}`,
        );
      }
    }

    const finalStatus: SagaStatus = allCompensated ? "rolled_back" : "partially_compensated";

    const [updated] = await db
      .update(sagaInstances)
      .set({
        status: finalStatus,
        steps,
        compensatedAt: new Date(),
        error: `Failed at step ${failedAtStep + 1}: ${steps[failedAtStep]?.result?.error ?? "unknown"}`,
      })
      .where(eq(sagaInstances.sagaId, sagaId))
      .returning();

    console.log(`[saga] Saga ${sagaId} ${finalStatus}`);
    return updated;
  }

  /**
   * Helper: persist step updates and current step position.
   */
  private async updateSteps(
    sagaId: string,
    steps: SagaStep[],
    currentStep: number,
  ): Promise<void> {
    await db
      .update(sagaInstances)
      .set({ steps, currentStep })
      .where(eq(sagaInstances.sagaId, sagaId));
  }

  /**
   * Get a saga by its ID.
   */
  async getById(sagaId: string): Promise<SagaInstance | null> {
    const [row] = await db
      .select()
      .from(sagaInstances)
      .where(eq(sagaInstances.sagaId, sagaId))
      .limit(1);
    return row ?? null;
  }

  /**
   * Get sagas by status.
   */
  async getByStatus(status: SagaStatus): Promise<SagaInstance[]> {
    return db
      .select()
      .from(sagaInstances)
      .where(eq(sagaInstances.status, status))
      .orderBy(desc(sagaInstances.startedAt));
  }

  /**
   * Get the most recent sagas.
   */
  async getRecent(limit: number = 50): Promise<SagaInstance[]> {
    return db
      .select()
      .from(sagaInstances)
      .orderBy(desc(sagaInstances.startedAt))
      .limit(limit);
  }

  /**
   * Manually trigger compensation for a running saga.
   * Compensates all completed steps in reverse.
   */
  async compensate(sagaId: string): Promise<SagaInstance> {
    const saga = await this.getById(sagaId);
    if (!saga) throw new Error(`Saga not found: ${sagaId}`);

    if (saga.status !== "running") {
      throw new Error(
        `Cannot compensate saga ${sagaId} — status is ${saga.status}, expected running`,
      );
    }

    const steps = [...saga.steps] as SagaStep[];
    // Find the last completed step
    const lastCompleted = steps.reduce(
      (max, s, i) => (s.status === "completed" ? i : max),
      -1,
    );

    if (lastCompleted === -1) {
      // Nothing to compensate — just mark as rolled back
      const [updated] = await db
        .update(sagaInstances)
        .set({
          status: "rolled_back",
          compensatedAt: new Date(),
          error: "Manual compensation — no steps completed",
        })
        .where(eq(sagaInstances.sagaId, sagaId))
        .returning();
      return updated;
    }

    return this.compensateFromStep(sagaId, steps, lastCompleted + 1);
  }

  /**
   * Find sagas that have exceeded their timeout and trigger compensation.
   */
  async timeout(): Promise<{ timedOut: string[]; compensated: string[] }> {
    const running = await this.getByStatus("running");
    const now = Date.now();
    const timedOut: string[] = [];
    const compensated: string[] = [];

    for (const saga of running) {
      const startedAt = new Date(saga.startedAt).getTime();
      const elapsed = now - startedAt;

      if (elapsed > saga.timeoutMs) {
        timedOut.push(saga.sagaId);

        try {
          await this.compensate(saga.sagaId);
          compensated.push(saga.sagaId);
        } catch (err) {
          console.error(
            `[saga] Failed to compensate timed-out saga ${saga.sagaId}:`,
            (err as Error).message,
          );
        }
      }
    }

    if (timedOut.length > 0) {
      console.log(
        `[saga] Timed out ${timedOut.length} sagas, compensated ${compensated.length}`,
      );
    }

    return { timedOut, compensated };
  }

  /**
   * Get aggregate saga statistics.
   */
  async getStats(): Promise<{
    running: number;
    completed: number;
    rolledBack: number;
    partiallyCompensated: number;
    timedOut: number;
    totalSagas: number;
    avgStepsPerSaga: number;
  }> {
    const allSagas = await db.select().from(sagaInstances);

    const stats = {
      running: 0,
      completed: 0,
      rolledBack: 0,
      partiallyCompensated: 0,
      timedOut: 0,
      totalSagas: allSagas.length,
      avgStepsPerSaga: 0,
    };

    let totalSteps = 0;

    for (const saga of allSagas) {
      totalSteps += saga.totalSteps;
      switch (saga.status) {
        case "running":
          stats.running++;
          break;
        case "completed":
          stats.completed++;
          break;
        case "rolled_back":
          stats.rolledBack++;
          break;
        case "partially_compensated":
          stats.partiallyCompensated++;
          break;
        case "timed_out":
          stats.timedOut++;
          break;
      }
    }

    stats.avgStepsPerSaga =
      allSagas.length > 0 ? Math.round((totalSteps / allSagas.length) * 100) / 100 : 0;

    return stats;
  }

  /**
   * Get child sagas of a parent saga.
   */
  async getNestedSagas(parentSagaId: string): Promise<SagaInstance[]> {
    return db
      .select()
      .from(sagaInstances)
      .where(eq(sagaInstances.parentSagaId, parentSagaId))
      .orderBy(sagaInstances.startedAt);
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const sagaOrchestratorService = new SagaOrchestratorService();
