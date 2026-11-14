/**
 * P1-13 — first-settlement milestone (pure model).
 *
 * Shapes raw `activation_events` rows into the founder-visible state of the
 * LLC-formation trigger "first real borrower-money settlement". The event is
 * recorded by portalPaymentPosting.ts (`first_borrower_payment_received`,
 * eventValue.amount in DOLLARS). This model only READS that fact.
 *
 * Standing founder posture: the trigger is ALERT-ONLY. `llcTrigger.posture`
 * is a constant; nothing in this slice gates or blocks anything.
 *
 * Honesty: never throws, never guesses. A missing/non-finite amount is null,
 * a malformed row is excluded and counted. No person identifiers in output.
 */

export const FIRST_SETTLEMENT_EVENT_NAME = "first_borrower_payment_received";

/** Hard bound on rows the gatherer scans. The table is unique per (org, event), so this bounds ORGS. */
export const FIRST_SETTLEMENT_SCAN_LIMIT = 500;

export interface ActivationEventRowLike {
  eventName: string;
  organizationId: number | null | undefined;
  eventValue: unknown;
  occurredAt: Date | string | number | null | undefined;
}

export interface FirstSettlement {
  organizationId: number;
  occurredAt: string;
  paymentId: string | number | null;
  noteId: string | number | null;
  amountCents: number | null;
}

export interface FirstSettlementMilestone {
  milestoneReached: boolean;
  firstSettlement: FirstSettlement | null;
  orgsWithFirstSettlement: number;
  llcTrigger: {
    fired: boolean;
    accelerator: "first-borrower-money-settlement";
    posture: "alert-only";
  };
  excludedMalformed: number;
}

function isId(v: unknown): v is string | number {
  return (typeof v === "string" && v.length > 0) || (typeof v === "number" && Number.isFinite(v));
}

export function shapeFirstSettlementMilestone(
  rows: readonly ActivationEventRowLike[] | null | undefined,
): FirstSettlementMilestone {
  let excludedMalformed = 0;
  const orgs = new Set<number>();
  let earliest: { ms: number; row: FirstSettlement } | null = null;

  try {
    for (const r of Array.isArray(rows) ? rows : []) {
      try {
        if (!r || r.eventName !== FIRST_SETTLEMENT_EVENT_NAME) continue;
        const org = r.organizationId;
        const v = r.eventValue;
        const ms = r.occurredAt == null ? NaN : new Date(r.occurredAt as Date | string | number).getTime();
        if (
          typeof org !== "number" || !Number.isInteger(org) || org <= 0 ||
          !v || typeof v !== "object" || Array.isArray(v) ||
          !Number.isFinite(ms)
        ) {
          excludedMalformed++;
          continue;
        }
        const val = v as Record<string, unknown>;
        const amount = typeof val.amount === "number" && Number.isFinite(val.amount) ? val.amount : null;
        orgs.add(org);
        if (!earliest || ms < earliest.ms) {
          earliest = {
            ms,
            row: {
              organizationId: org,
              occurredAt: new Date(ms).toISOString(),
              paymentId: isId(val.paymentId) ? val.paymentId : null,
              noteId: isId(val.noteId) ? val.noteId : null,
              amountCents: amount === null ? null : Math.round(amount * 100),
            },
          };
        }
      } catch {
        excludedMalformed++;
      }
    }
  } catch {
    /* never throws */
  }

  const milestoneReached = earliest !== null;
  return {
    milestoneReached,
    firstSettlement: earliest ? earliest.row : null,
    orgsWithFirstSettlement: orgs.size,
    llcTrigger: {
      fired: milestoneReached,
      accelerator: "first-borrower-money-settlement",
      posture: "alert-only",
    },
    excludedMalformed,
  };
}
