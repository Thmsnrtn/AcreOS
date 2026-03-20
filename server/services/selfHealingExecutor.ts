// @ts-nocheck
/**
 * Self-Healing Executor — Closes the loop between playbook evaluation and actual remediation.
 *
 * When evaluatePlaybooks() returns matched playbooks + actions, this executor
 * actually runs those actions through the execution engine.
 */

import { executionEngine } from "./executionEngine";
import { wsServer } from "../websocket";

interface PlaybookAction {
  type: string;
  params: Record<string, any>;
}

class SelfHealingExecutor {
  /**
   * Execute playbook actions through the real execution engine.
   */
  async executePlaybookActions(
    orgId: number,
    playbookName: string,
    actions: PlaybookAction[],
  ): Promise<{ executed: number; failed: number; results: any[] }> {
    let executed = 0;
    let failed = 0;
    const results: any[] = [];

    console.log(`[self-healing] Executing ${actions.length} actions from playbook: ${playbookName}`);

    for (const action of actions) {
      try {
        const result = await executionEngine.execute({
          orgId,
          agentCodename: "sentinel",
          action: action.type,
          input: action.params ?? {},
        });

        if (result.success) {
          executed++;
        } else {
          failed++;
        }
        results.push({ action: action.type, ...result });
      } catch (err: any) {
        failed++;
        results.push({ action: action.type, success: false, error: err.message });
      }
    }

    // Broadcast results
    wsServer.broadcastFounderEvent("self_healing_executed", {
      playbookName,
      executed,
      failed,
      totalActions: actions.length,
    });

    console.log(`[self-healing] Playbook ${playbookName}: ${executed} executed, ${failed} failed`);
    return { executed, failed, results };
  }

  /**
   * Full pipeline: evaluate playbooks for an anomaly + execute matched actions.
   * Called from the self-healing mesh after anomaly detection.
   */
  async evaluateAndExecute(orgId: number, anomalyId: string): Promise<void> {
    try {
      const { selfHealingMesh } = await import("./selfHealingMeshV13");
      const { matched, actions } = await selfHealingMesh.evaluatePlaybooks(anomalyId);

      for (const entry of actions) {
        await this.executePlaybookActions(orgId, entry.playbookName, entry.actions);
      }

      if (matched.length > 0) {
        console.log(`[self-healing] Executed ${matched.length} playbooks for anomaly ${anomalyId}`);
      }
    } catch (err: any) {
      console.error(`[self-healing] Evaluate+execute failed for anomaly ${anomalyId}:`, err.message);
    }
  }
}

export const selfHealingExecutor = new SelfHealingExecutor();
