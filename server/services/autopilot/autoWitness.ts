/**
 * Founder Autopilot — the auto-witness sweep (step-away gap #5: the keystone
 * integration witnessGrant.ts deliberately left for review).
 *
 * Every witnessed-send still freezes in pendingHands exactly as before. This
 * sweep walks the frozen queue and, for each action, asks the pure policy
 * engine whether a live founder-issued WitnessGrant covers it. Only then does
 * it tap — through the SAME approvePendingHand path a founder tap uses (hash
 * re-verify, atomic pending→approved claim, executeHandWitnessed, panic-stop
 * re-read, proof-receipt, append-only audit). Nothing is weakened; a bounded
 * delegate path is ADDED.
 *
 * Fail-closed properties, in order:
 *   • Panic stop engaged → the sweep does nothing at all.
 *   • Zero grants issued → the sweep is a no-op (status quo: founder taps).
 *   • A money-moving hand whose cost cannot be PROVEN from the frozen args is
 *     never covered — an unprovable amount cannot be shown under the ceiling.
 *   • The grant budget is consumed via a conditional UPDATE *before* the tap;
 *     a revocation that lands between authorization and consumption wins.
 *   • Attribution never thins: the approver identity recorded on the pending
 *     row, the proof-receipt, and the sends audit is
 *     "<grantee> (delegated by <grantor> via witness-grant #<id>)".
 */
import { logger } from "../../utils/logger";
import { authorizeByAnyGrant, evaluateWitnessGrant, type WitnessRequest } from "./witnessGrant";

/** The machine principal grants are issued to for autonomous operation. */
export const AUTO_WITNESS_GRANTEE = "solene";

/**
 * Pure: extract a provable predicted cost (USD) from frozen hand args.
 * Recognizes the arg names the money-class hands actually use. Returns null
 * when no explicit amount is present — for a money-moving hand that means
 * "cannot prove it's under the ceiling", which the sweep treats as NOT covered.
 */
export function predictedCostUsdFromArgs(args: Record<string, unknown>): number | null {
  const usdKeys = ["amount_usd", "amountUsd", "refund_amount_usd", "budget_usd", "max_spend_usd"];
  for (const k of usdKeys) {
    const v = args[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  }
  const centKeys = ["amount_cents", "amountCents", "refund_amount_cents"];
  for (const k of centKeys) {
    const v = args[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v / 100;
  }
  return null;
}

export interface AutoWitnessDecision {
  pendingId: number;
  handName: string;
  outcome: "witnessed" | "skipped";
  reason: string;
}

export interface AutoWitnessSweepResult {
  considered: number;
  witnessed: number;
  decisions: AutoWitnessDecision[];
}

/**
 * One sweep over the frozen queue. Never throws; every skip carries its
 * reason so the Control door can show WHY the machine did not act.
 */
export async function runAutoWitnessSweep(
  opts: { granteeId?: string; now?: number } = {},
): Promise<AutoWitnessSweepResult> {
  const granteeId = opts.granteeId ?? AUTO_WITNESS_GRANTEE;
  const now = opts.now ?? Date.now();
  const result: AutoWitnessSweepResult = { considered: 0, witnessed: 0, decisions: [] };

  // Panic stop → the machine's hands are off, delegation included.
  try {
    const { isPanicStopped } = await import("./settings");
    if (isPanicStopped()) return result;
  } catch {
    /* settings unavailable → continue; approvePendingHand's executor re-checks */
  }

  let grantRows;
  try {
    const { liveGrantsFor } = await import("./witnessGrantStore");
    grantRows = await liveGrantsFor(granteeId);
  } catch (err) {
    logger.warn(
      `[autoWitness] grant load failed — sweep abstains: ${err instanceof Error ? err.message : String(err)}`,
    );
    return result;
  }
  if (grantRows.length === 0) return result; // status quo: founder taps

  const { toPolicyGrant, consumeGrantUse } = await import("./witnessGrantStore");
  const { listPendingHands, approvePendingHand } = await import("./pendingHands");
  const { getHand } = await import("./hands");
  const grants = grantRows.map(toPolicyGrant);

  const pending = await listPendingHands();
  for (const action of pending) {
    result.considered++;
    const skip = (reason: string) => {
      result.decisions.push({ pendingId: action.id, handName: action.handName, outcome: "skipped", reason });
    };

    const spec = getHand(action.handName);
    if (!spec) {
      skip("hand not registered in this process — cannot evaluate its governance class");
      continue;
    }

    const args = (action.args ?? {}) as Record<string, unknown>;
    const movesMoney = spec.movesMoney === true || spec.domain === "finance";
    const predicted = predictedCostUsdFromArgs(args);
    if (movesMoney && predicted === null) {
      skip("money-moving hand with no provable amount in frozen args — cannot prove it under any ceiling");
      continue;
    }

    const req: WitnessRequest = {
      domain: spec.domain,
      predictedCostUsd: predicted ?? 0,
      movesMoney,
      isBroadcast: spec.outwardClass === "broadcast",
      granteeId,
    };

    const { verdict, grant } = authorizeByAnyGrant(grants, req, now);
    if (!verdict.authorized || !grant || !verdict.attribution) {
      // Record the PER-GRANT deny reasons so the founder can see exactly why
      // the machine held back (the aggregate "no grant authorizes" is opaque).
      const detail = grants
        .map((g) => `grant #${g.id}: ${evaluateWitnessGrant(g, req, now).reason}`)
        .join("; ");
      skip(detail || verdict.reason);
      continue;
    }

    // Spend the budget slot FIRST — the conditional UPDATE re-verifies
    // revocation/expiry/budget at the database, so a founder revoke that
    // landed after our in-memory read wins here.
    const consumed = await consumeGrantUse(Number(grant.id));
    if (!consumed) {
      skip("grant budget slot unavailable (revoked/expired/exhausted since load)");
      continue;
    }
    grant.usedCount += 1; // keep in-sweep budget honest for subsequent actions

    const approver = `${verdict.attribution.grantee} (delegated by ${verdict.attribution.grantor} via witness-grant #${verdict.attribution.grantId})`;
    try {
      const outcome = await approvePendingHand({ id: action.id, approvedBy: approver, now });
      if (outcome.outcome === "executed") {
        result.witnessed++;
        result.decisions.push({ pendingId: action.id, handName: action.handName, outcome: "witnessed", reason: verdict.reason });
        logger.warn(
          `[autoWitness] DELEGATED SEND: ${action.handName} #${action.id} witnessed by ${approver}`,
        );
      } else {
        // Budget slot stays spent (conservative — never risks exceeding the
        // founder's intended send count); the pending row's own state machine
        // handled the refusal.
        skip(`approval path refused: ${outcome.outcome}${"error" in outcome ? ` — ${outcome.error}` : ""}`);
      }
    } catch (err) {
      skip(`approval path threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (result.considered > 0) {
    logger.info(
      `[autoWitness] sweep: considered=${result.considered} witnessed=${result.witnessed} grants=${grants.length}`,
    );
  }
  return result;
}
