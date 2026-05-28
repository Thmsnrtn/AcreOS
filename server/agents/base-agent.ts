/**
 * Base class for all autonomous founder operations agents.
 * Provides start/stop/runOnce lifecycle, scheduling, graceful degradation,
 * and integration with existing agent infrastructure.
 */

import { db } from "../storage";
import { sql } from "drizzle-orm";
import { emailService } from "../services/emailService";
import { logger } from "../utils/logger";
import { coerceTimerDelay } from "../utils/safeTimer";

export type AgentStatus = "idle" | "running" | "error" | "disabled";

export interface AgentHealth {
  name: string;
  enabled: boolean;
  status: AgentStatus;
  lastRun: Date | null;
  nextRun: Date | null;
  lastError: string | null;
  runCount: number;
}

export interface AgentDecision {
  agentName: string;
  action: string;
  reason: string;
  riskLevel: "low" | "medium" | "high";
  autoApproved: boolean;
  data?: any;
  timestamp: Date;
}

export abstract class BaseAgent {
  abstract readonly name: string;
  abstract readonly featureFlag: string;
  abstract readonly intervalMs: number;

  protected status: AgentStatus = "idle";
  protected lastRun: Date | null = null;
  protected nextRun: Date | null = null;
  protected lastError: string | null = null;
  protected runCount = 0;
  protected enabled = true;
  private timer: ReturnType<typeof setInterval> | null = null;

  abstract runOnce(): Promise<void>;

  async start(): Promise<void> {
    if (!this.enabled) {
      logger.info(`[${this.name}] Agent disabled via feature flag`);
      return;
    }
    // Sanitize the subclass-provided intervalMs so a bad constant (NaN,
    // a phone string promoted to a number, etc.) can't trigger Node's
    // TimeoutOverflowWarning and silently turn into a 1ms hot-loop.
    const safeInterval = coerceTimerDelay(this.intervalMs, `agent:${this.name}:intervalMs`);
    if (safeInterval === null) {
      logger.error(`[${this.name}] refusing to start — intervalMs is not a usable number`, undefined, {
        metadata: { intervalMs: String(this.intervalMs) },
      });
      return;
    }
    logger.info(`[${this.name}] Starting (interval: ${safeInterval}ms)`);
    // Run once immediately then schedule
    await this.safeRun();
    this.timer = setInterval(() => this.safeRun(), safeInterval);
    this.nextRun = new Date(Date.now() + safeInterval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.status = "idle";
    this.nextRun = null;
    logger.info(`[${this.name}] Stopped`);
  }

  private async safeRun(): Promise<void> {
    try {
      this.status = "running";
      await this.runOnce();
      this.status = "idle";
      this.lastRun = new Date();
      this.runCount++;
      this.lastError = null;
      this.nextRun = new Date(Date.now() + this.intervalMs);
    } catch (err: any) {
      this.status = "error";
      this.lastError = err.message || "Unknown error";
      this.lastRun = new Date();
      logger.error(`[${this.name}] Error`, err);
    }
  }

  getHealth(): AgentHealth {
    return {
      name: this.name,
      enabled: this.enabled,
      status: this.status,
      lastRun: this.lastRun,
      nextRun: this.nextRun,
      lastError: this.lastError,
      runCount: this.runCount,
    };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  // --- Helper: Check if email is configured ---
  protected isEmailConfigured(): Promise<boolean> {
    return emailService.isConfigured();
  }

  // --- Helper: Send email with graceful degradation ---
  protected async trySendEmail(options: {
    to: string;
    subject: string;
    html: string;
    organizationId?: number;
  }): Promise<boolean> {
    if (!(await this.isEmailConfigured())) {
      logger.info(`[${this.name}] Email not configured, skipping: ${options.subject}`);
      return false;
    }
    try {
      const result = await emailService.sendEmail(options);
      return result.success;
    } catch (err: any) {
      logger.error(`[${this.name}] Email failed`, err);
      return false;
    }
  }

  // --- Helper: Log decision to founder_briefs for observatory ---
  protected async logDecision(decision: AgentDecision): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO founder_briefs (agent_type, brief_type, content, generated_at)
        VALUES (${this.name}, 'decision', ${JSON.stringify(decision)}::jsonb, NOW())
      `);
    } catch (err: any) {
      logger.error(`[${this.name}] Failed to log decision`, err);
    }
  }

  // --- Helper: Store a brief/report ---
  protected async storeBrief(briefType: string, content: Record<string, any>): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO founder_briefs (agent_type, brief_type, content, generated_at)
        VALUES (${this.name}, ${briefType}, ${JSON.stringify(content)}::jsonb, NOW())
      `);
    } catch (err: any) {
      logger.error(`[${this.name}] Failed to store brief`, err);
    }
  }

  // --- Helper: Get autonomy level ---
  protected async getAutonomyLevel(): Promise<"assisted" | "supervised" | "autonomous"> {
    // Default to assisted (safest)
    return "assisted";
  }
}
