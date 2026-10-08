/**
 * panicStop — the single atomic STOP for the autopilot (kernel-elevation T0.3).
 *
 * One call halts everything the brain can do: it flips all three master switches
 * (dispatch / cognition / publish) OFF and quarantines every domain back to
 * OBSERVE, records one reason + a proof-receipt, and pages. It is the control a
 * founder reaches for at 3am and the primitive an insurer relies on.
 *
 * Two layers of STOP, by design:
 *   • this DB-level panicStop() — the routine, reversible, founder-facing atomic
 *     stop (flip it from the Control Center; flip the switches back to resume);
 *   • the env SOLENE_PANIC_STOP (settings.isPanicStopped) — the out-of-reach
 *     hard floor the agent cannot write, which overrides the DB unconditionally.
 *
 * Composition layer (touches settings + domain autonomy + the receipt) — NOT
 * kernel. Best-effort on each sub-step so a single failure can't leave the stop
 * half-applied silently; it logs + continues + reports what it managed to do.
 */

import { logger } from "../../utils/logger";
import { PLATFORM_SCOPE } from "./tenantScope";

export interface PanicStopResult {
  switchesOff: string[];
  /** Frozen actions rejected by the stop — none can be released afterwards. */
  pendingActionsRejected: number[];
  /** Live WitnessGrants revoked by the stop — delegation is re-issued deliberately. */
  grantsRevoked: number[];
  /** In-flight dispatches cancelled (each runner stops at its next turn/tool boundary). */
  dispatchesAborted: number[];
  domainsQuarantined: string[];
  receiptHash: string | null;
  reason: string;
}

/**
 * Trip every safety control at once. `reason` is recorded; `by` is the
 * accountable human (a founder id, or "auto:<code>" when the drift sentinel
 * trips it). Never throws — a panic stop must always run as far as it can.
 */
export async function panicStop(params: { reason: string; by: string }): Promise<PanicStopResult> {
  const reason = params.reason?.trim() || "panic stop (no reason given)";
  const result: PanicStopResult = { switchesOff: [], pendingActionsRejected: [], grantsRevoked: [], dispatchesAborted: [], domainsQuarantined: [], receiptHash: null, reason };
  logger.error(`[autopilot/panicStop] TRIPPED by ${params.by}: ${reason}`);

  // 0. Record what is ON right now (switches + every domain's level) BEFORE
  // turning it off, so the resume can restore it as ONE founder confirm (S10).
  // Best-effort: a stop must never wait on its own bookkeeping.
  try {
    const { recordPreStopSnapshot } = await import("./founderControls");
    await recordPreStopSnapshot(params.by);
  } catch (err) {
    logger.warn("[autopilot/panicStop] pre-stop snapshot failed (stop still applies; resume falls back to staged)", err instanceof Error ? err : undefined);
  }

  // 1. Flip all three master switches OFF.
  try {
    const { setAutopilotSetting } = await import("./settings");
    for (const key of ["dispatchEnabled", "cognitionEnabled", "publishEnabled"] as const) {
      try {
        await setAutopilotSetting(key, false, params.by);
        result.switchesOff.push(key);
      } catch (err) {
        logger.error(`[autopilot/panicStop] failed to flip ${key} off`, err instanceof Error ? err : undefined);
      }
    }
  } catch (err) {
    logger.error("[autopilot/panicStop] settings module unavailable", err instanceof Error ? err : undefined);
  }

  // 1b. Abort IN-FLIGHT dispatches. The switches only stop NEW claims; a
  // dispatch already running kept going through every remaining turn and
  // tool. Cancelling the row makes its runner stop at the next turn/tool
  // boundary (cooperative abort in dispatchRunner — it cannot preempt a
  // streaming model call, but it never starts another tool).
  try {
    const { cancelInFlightDispatches } = await import("../solene/dispatchQueue");
    result.dispatchesAborted = await cancelInFlightDispatches(`panic stop: ${reason}`);
  } catch (err) {
    logger.error("[autopilot/panicStop] failed to abort in-flight dispatches", err instanceof Error ? err : undefined);
  }

  // 1c. What is already DRAFTED stops too. Every pending action is rejected
  // (terminal — no tap or grant can release it later) and every live
  // WitnessGrant is revoked, so a stop reaches delegated sends and not only
  // new dispatches. Grants are not part of the one-confirm restore: after a
  // stop, delegation is re-issued deliberately.
  try {
    const { db } = await import("../../db");
    const { autopilotPendingActions } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const rejected = await db
      .update(autopilotPendingActions)
      .set({ status: "rejected", approvedBy: `${params.by} (panic stop)` })
      .where(eq(autopilotPendingActions.status, "pending"))
      .returning({ id: autopilotPendingActions.id });
    result.pendingActionsRejected = rejected.map((r) => r.id);
  } catch (err) {
    logger.error("[autopilot/panicStop] failed to reject pending actions", err instanceof Error ? err : undefined);
  }
  try {
    const { revokeAllLiveGrants } = await import("./witnessGrantStore");
    result.grantsRevoked = await revokeAllLiveGrants(`panic stop: ${reason}`);
  } catch (err) {
    logger.error("[autopilot/panicStop] failed to revoke witness grants", err instanceof Error ? err : undefined);
  }

  // 2. Quarantine every domain back to OBSERVE.
  try {
    const { AUTOPILOT_DOMAINS, setDomainLevel } = await import("./domainAutonomy");
    for (const domain of AUTOPILOT_DOMAINS) {
      try {
        await setDomainLevel(domain, "observe", `panic stop: ${reason}`);
        result.domainsQuarantined.push(domain);
      } catch (err) {
        logger.error(`[autopilot/panicStop] failed to quarantine ${domain}`, err instanceof Error ? err : undefined);
      }
    }
  } catch (err) {
    logger.error("[autopilot/panicStop] domainAutonomy module unavailable", err instanceof Error ? err : undefined);
  }

  // 3. Record one tamper-evident proof-receipt of the stop (platform scope).
  try {
    const { recordReceipt } = await import("./proofReceiptStore");
    const { hashPayload } = await import("./proofReceipt");
    const receipt = await recordReceipt({
      actionKind: "panic_stop",
      scope: PLATFORM_SCOPE,
      payloadHash: hashPayload({ reason, switchesOff: result.switchesOff, dispatchesAborted: result.dispatchesAborted, pendingActionsRejected: result.pendingActionsRejected, grantsRevoked: result.grantsRevoked, domains: result.domainsQuarantined }),
      accountableHumanId: params.by,
      autonomyLevel: "halted",
    });
    result.receiptHash = receipt?.receiptHash ?? null;
  } catch (err) {
    logger.warn("[autopilot/panicStop] receipt failed (stop still applied)", err instanceof Error ? err : undefined);
  }

  // 4. Page — the founder must know the stop tripped.
  try {
    const { sendSolenePage } = await import("../solene/pagerService");
    await sendSolenePage({
      severity: "critical",
      subject: "Autopilot PANIC STOP tripped",
      body: `${reason}\nSwitches off: ${result.switchesOff.join(", ") || "none"}\nIn-flight dispatches aborted: ${result.dispatchesAborted.length}\nDrafted actions rejected: ${result.pendingActionsRejected.length}\nDelegations revoked: ${result.grantsRevoked.length}\nDomains quarantined: ${result.domainsQuarantined.length}`,
    });
  } catch (err) {
    // Best-effort by design (the stop itself already applied), but a
    // founder-invisible panic stop is its own incident — log loudly.
    logger.error(
      "[autopilot/panicStop] PANIC STOP page failed — founder may not know the stop tripped",
      err instanceof Error ? err : undefined,
    );
  }

  return result;
}
