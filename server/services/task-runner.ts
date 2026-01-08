import { storage } from "../storage";
import { workflowEngine } from "./workflow-engine";
import type { ScheduledTask, InsertScheduledTask } from "@shared/schema";

const log = (msg: string, meta?: Record<string, any>) => 
  console.log(JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), source: 'task-runner', message: msg, ...meta }));

const logError = (msg: string, meta?: Record<string, any>) => 
  console.error(JSON.stringify({ level: 'ERROR', timestamp: new Date().toISOString(), source: 'task-runner', message: msg, ...meta }));

export function parseSchedule(schedule: string): Date {
  const now = new Date();
  
  switch (schedule.toLowerCase()) {
    case "hourly":
      return new Date(now.getTime() + 60 * 60 * 1000);
    case "daily":
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case "weekly":
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case "monthly":
      const nextMonth = new Date(now);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      return nextMonth;
    default:
      return parseCronExpression(schedule, now);
  }
}

function parseCronExpression(cron: string, from: Date): Date {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) {
    return new Date(from.getTime() + 60 * 60 * 1000);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const next = new Date(from);
  next.setSeconds(0, 0);

  if (minute !== "*") {
    const minVal = parseInt(minute);
    if (!isNaN(minVal)) {
      if (next.getMinutes() >= minVal) {
        next.setHours(next.getHours() + 1);
      }
      next.setMinutes(minVal);
    }
  } else {
    next.setMinutes(next.getMinutes() + 1);
  }

  if (hour !== "*") {
    const hourVal = parseInt(hour);
    if (!isNaN(hourVal)) {
      if (next.getHours() > hourVal || (next.getHours() === hourVal && next.getMinutes() > parseInt(minute || "0"))) {
        next.setDate(next.getDate() + 1);
      }
      next.setHours(hourVal);
    }
  }

  if (dayOfMonth !== "*") {
    const dayVal = parseInt(dayOfMonth);
    if (!isNaN(dayVal)) {
      while (next.getDate() !== dayVal) {
        next.setDate(next.getDate() + 1);
      }
    }
  }

  return next;
}

class TaskRunnerService {
  async scheduleTask(task: InsertScheduledTask): Promise<ScheduledTask> {
    const nextRunAt = task.nextRunAt || parseSchedule(task.schedule);
    const newTask = await storage.createScheduledTask({
      ...task,
      nextRunAt,
      status: task.status || "active",
      retryCount: 0,
    });
    log(`Scheduled task created`, { taskId: newTask.id, name: newTask.name, nextRunAt });
    return newTask;
  }

  async runTask(taskId: number): Promise<{ success: boolean; error?: string }> {
    const task = await storage.getScheduledTask(taskId);
    if (!task) {
      return { success: false, error: "Task not found" };
    }

    if (task.status === "paused") {
      return { success: false, error: "Task is paused" };
    }

    log(`Running task`, { taskId, name: task.name, type: task.type });

    try {
      await this.executeTask(task);
      
      const nextRunAt = parseSchedule(task.schedule);
      await storage.updateScheduledTask(taskId, {
        lastRunAt: new Date(),
        nextRunAt,
        retryCount: 0,
        lastError: null,
        status: "active",
      });

      log(`Task completed successfully`, { taskId, name: task.name, nextRunAt });
      return { success: true };
    } catch (error: any) {
      const errorMessage = error.message || "Unknown error";
      const newRetryCount = task.retryCount + 1;

      logError(`Task execution failed`, { taskId, name: task.name, error: errorMessage, retryCount: newRetryCount });

      if (newRetryCount >= task.maxRetries) {
        await storage.updateScheduledTask(taskId, {
          retryCount: newRetryCount,
          lastError: errorMessage,
          status: "failed",
          lastRunAt: new Date(),
        });
        logError(`Task marked as failed after max retries`, { taskId, maxRetries: task.maxRetries });
        return { success: false, error: `Failed after ${task.maxRetries} retries: ${errorMessage}` };
      }

      const retryDelay = task.retryDelayMinutes * 60 * 1000;
      const nextRetryAt = new Date(Date.now() + retryDelay);
      
      await storage.updateScheduledTask(taskId, {
        retryCount: newRetryCount,
        lastError: errorMessage,
        nextRunAt: nextRetryAt,
        lastRunAt: new Date(),
      });

      log(`Task scheduled for retry`, { taskId, retryCount: newRetryCount, nextRetryAt });
      return { success: false, error: errorMessage };
    }
  }

  private async executeTask(task: ScheduledTask): Promise<void> {
    switch (task.type) {
      case "workflow":
        await this.executeWorkflowTask(task);
        break;
      case "agent_skill":
        await this.executeAgentSkillTask(task);
        break;
      case "custom":
        await this.executeCustomTask(task);
        break;
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  }

  private async executeWorkflowTask(task: ScheduledTask): Promise<void> {
    const workflowId = task.config?.workflowId;
    if (!workflowId) {
      throw new Error("No workflowId specified in task config");
    }

    const workflow = await storage.getWorkflow(task.organizationId, workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    await workflowEngine.executeWorkflow(workflow, {
      event: "scheduled_run",
      data: { scheduledTaskId: task.id, scheduledTaskName: task.name },
    });
  }

  private async executeAgentSkillTask(task: ScheduledTask): Promise<void> {
    const skillId = task.config?.skillId;
    if (!skillId) {
      throw new Error("No skillId specified in task config");
    }

    log(`Executing agent skill`, { taskId: task.id, skillId, params: task.config?.skillParams });
    
    // Dynamically import skill registry to avoid circular dependencies
    const { skillRegistry } = await import("./agent-skills");
    
    const result = await skillRegistry.executeSkill(
      skillId,
      task.config?.skillParams || {},
      {
        organizationId: task.organizationId,
        userId: task.config?.userId,
        relatedLeadId: task.config?.relatedLeadId,
        relatedPropertyId: task.config?.relatedPropertyId,
        relatedDealId: task.config?.relatedDealId,
      }
    );
    
    if (!result.success) {
      throw new Error(result.error || result.message || "Skill execution failed");
    }
    
    log(`Agent skill completed`, { taskId: task.id, skillId, result: result.message });
  }

  private async executeCustomTask(task: ScheduledTask): Promise<void> {
    const handler = task.config?.customHandler;
    if (!handler) {
      throw new Error("No customHandler specified in task config");
    }

    log(`Executing custom handler`, { taskId: task.id, handler, params: task.config?.customParams });
    
    // Custom handlers are pre-defined functions that can be called by name
    const customHandlers: Record<string, (params: any, context: { organizationId: number }) => Promise<void>> = {
      // Add custom handlers here as needed
      "send_digest": async (params, context) => {
        // Example: Send daily digest email
        log(`Sending digest for organization`, { organizationId: context.organizationId });
      },
      "cleanup_old_data": async (params, context) => {
        // Example: Clean up old temporary data
        log(`Cleaning up old data`, { organizationId: context.organizationId, days: params.days });
      },
      "sync_external_data": async (params, context) => {
        // Example: Sync data from external source
        log(`Syncing external data`, { organizationId: context.organizationId, source: params.source });
      },
    };
    
    const handlerFn = customHandlers[handler];
    if (!handlerFn) {
      throw new Error(`Unknown custom handler: ${handler}. Available handlers: ${Object.keys(customHandlers).join(", ")}`);
    }
    
    await handlerFn(task.config?.customParams || {}, { organizationId: task.organizationId });
    log(`Custom handler completed`, { taskId: task.id, handler });
  }

  async processScheduledTasks(): Promise<{ processed: number; succeeded: number; failed: number }> {
    const now = new Date();
    const dueTasks = await storage.getDueScheduledTasks(now);
    
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const task of dueTasks) {
      processed++;
      const result = await this.runTask(task.id);
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    if (processed > 0) {
      log(`Processed scheduled tasks`, { processed, succeeded, failed });
    }

    return { processed, succeeded, failed };
  }

  async pauseTask(taskId: number): Promise<ScheduledTask | undefined> {
    return storage.updateScheduledTask(taskId, { status: "paused" });
  }

  async resumeTask(taskId: number): Promise<ScheduledTask | undefined> {
    const task = await storage.getScheduledTask(taskId);
    if (!task) return undefined;

    const nextRunAt = parseSchedule(task.schedule);
    return storage.updateScheduledTask(taskId, { 
      status: "active",
      retryCount: 0,
      lastError: null,
      nextRunAt,
    });
  }
}

export const taskRunnerService = new TaskRunnerService();
