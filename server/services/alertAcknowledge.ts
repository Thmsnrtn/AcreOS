/**
 * The one way an automated actor acknowledges a system alert (DEFECT-0135).
 *
 * ACKNOWLEDGE, not resolve: an acknowledged alert is still open until its
 * cause is fixed. Only a NEW alert moves — acknowledging must never reopen a
 * resolved or dismissed alert. Zero rows is not success: the caller is told
 * the alert was already handled or does not exist.
 *
 * Callers: the autonomous decision executor (critical_alert approvals) and the
 * Atlas `acknowledge_incident` action executor, which fires from sentinel
 * reactions and founder approvals.
 */
import { and, eq, sql } from "drizzle-orm";
import { unscopedForPlatformOps } from "../utils/orgScopedDb";
import { systemAlerts } from "@shared/schema";
import { clock } from "../utils/clock";

export async function acknowledgeSystemAlert(
  alertId: number,
  by: string,
  note?: Record<string, unknown>,
): Promise<{ success: boolean; detail: string; reason?: "not_found" | "already_handled" }> {
  const stamp = { acknowledgedBy: by, at: clock.now().toISOString(), ...(note ?? {}) };
  // System alerts are platform-level (organization_id is nullable and the
  // actors are platform agents), addressed by alert id.
  const updated = await unscopedForPlatformOps("system alert acknowledgement by alert id (platform agents)")
    .update(systemAlerts)
    .set({
      status: "acknowledged",
      acknowledgedAt: clock.now(),
      metadata: sql`coalesce(${systemAlerts.metadata}, '{}'::jsonb) || ${JSON.stringify({ acknowledgement: stamp })}::jsonb`,
    })
    .where(and(eq(systemAlerts.id, alertId), eq(systemAlerts.status, "new")))
    .returning({ id: systemAlerts.id });
  if (updated.length > 0) {
    return { success: true, detail: `Alert #${alertId} acknowledged (still open until its cause is resolved)` };
  }
  const [current] = await unscopedForPlatformOps("system alert status read by alert id (platform agents)")
    .select({ status: systemAlerts.status })
    .from(systemAlerts)
    .where(eq(systemAlerts.id, alertId))
    .limit(1);
  return {
    success: false,
    reason: current ? "already_handled" : "not_found",
    detail: current
      ? `Alert #${alertId} is already ${current.status} — nothing changed`
      : `Alert #${alertId} not found — nothing changed`,
  };
}
