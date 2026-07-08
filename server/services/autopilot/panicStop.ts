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
  const result: PanicStopResult = { switchesOff: [], domainsQuarantined: [], receiptHash: null, reason };
  logger.error(`[autopilot/panicStop] TRIPPED by ${params.by}: ${reason}`);

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
      payloadHash: hashPayload({ reason, switchesOff: result.switchesOff, domains: result.domainsQuarantined }),
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
      body: `${reason}\nSwitches off: ${result.switchesOff.join(", ") || "none"}\nDomains quarantined: ${result.domainsQuarantined.length}`,
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
