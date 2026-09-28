/**
 * Evidence before a closing interlock is ticked (DEFECT-0176).
 *
 * The closing checklist's wire-verification item is `critical`,
 * `documentRequired` and categorised "fraud_gate" — "DO NOT WIRE until this
 * is checked" — yet both routes that complete an item (the closing PATCH and
 * the deal page's checklist toggle, which share one `deal_checklists` row)
 * set it done on one click, and the recorded two-channel wire confirmation
 * (`title_orders.wire_confirmed_at`) had no reader anywhere. A label in JSON
 * is not an interlock. This is the one check both routes run.
 */
import { and, eq, gte, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "../db";
import { titleOrders } from "@shared/schema";

/**
 * What the person who verified the wire records: the number they called,
 * where they found it independently (not the email that carried the
 * instructions), and who confirmed routing + account on that call.
 */
interface WireVerificationAttestation {
  phoneNumber: string;
  numberSource: string;
  spokeWith: string;
}

function attestationProblem(a: unknown): string | null {
  if (!a || typeof a !== "object") return "missing";
  const v = a as Record<string, unknown>;
  const digits = typeof v.phoneNumber === "string" ? v.phoneNumber.replace(/\D/g, "") : "";
  if (digits.length < 7) return "the phone number you called";
  if (typeof v.numberSource !== "string" || v.numberSource.trim().length < 3) return "where you looked that number up";
  if (typeof v.spokeWith !== "string" || v.spokeWith.trim().length < 2) return "who confirmed the instructions";
  return null;
}

/**
 * Null when the item may be completed. A fraud-gate item passes on a wire
 * confirmation recorded on the deal's title order AFTER its instructions
 * were issued (re-issued instructions reset it), or on a complete
 * attestation supplied with this request.
 */
export async function fraudGateRefusal(
  organizationId: number,
  dealId: number,
  item: { category?: string | null },
  attestation?: unknown,
): Promise<string | null> {
  if (item.category !== "fraud_gate") return null;
  if (!attestationProblem(attestation)) return null;
  const [confirmed] = await db
    .select({ id: titleOrders.id })
    .from(titleOrders)
    .where(
      and(
        eq(titleOrders.organizationId, organizationId),
        eq(titleOrders.dealId, dealId),
        isNotNull(titleOrders.wireConfirmedAt),
        or(isNull(titleOrders.wireInstructionsIssuedAt), gte(titleOrders.wireConfirmedAt, titleOrders.wireInstructionsIssuedAt)),
      ),
    )
    .limit(1);
  if (confirmed) return null;
  const missing = attestationProblem(attestation);
  return missing === "missing"
    ? "This is the wire-fraud step: record the phone number you called, where you looked it up independently, and who confirmed the instructions."
    : `This is the wire-fraud step: record ${missing}.`;
}

/** The attestation as stored on the item, or null when it is incomplete. Pure. */
export function sealWireAttestation(
  attestation: unknown,
  confirmedBy: string | null,
): (WireVerificationAttestation & { confirmedBy: string | null; confirmedAt: string }) | null {
  if (attestationProblem(attestation)) return null;
  const a = attestation as WireVerificationAttestation;
  return {
    phoneNumber: a.phoneNumber.trim(),
    numberSource: a.numberSource.trim(),
    spokeWith: a.spokeWith.trim(),
    confirmedBy,
    confirmedAt: new Date().toISOString(),
  };
}

/**
 * Record the confirmation on every title order for the deal, so it has a
 * reader AND a writer (DEFECT-0176 audit: `recordWireConfirmation` had no
 * caller, so nothing could satisfy the gate). Callers run this AFTER the
 * checklist write, so a failed write never leaves an unrecorded stamp.
 */
export async function stampWireConfirmation(organizationId: number, dealId: number): Promise<void> {
  const orders = await db
    .select({ id: titleOrders.id })
    .from(titleOrders)
    .where(and(eq(titleOrders.organizationId, organizationId), eq(titleOrders.dealId, dealId)));
  const { recordWireConfirmation } = await import("./wireInstructions");
  for (const o of orders) await recordWireConfirmation(organizationId, o.id);
}

/** Unticking the wire step withdraws its confirmation: a re-tick needs new evidence. */
export async function withdrawWireConfirmation(organizationId: number, dealId: number): Promise<void> {
  await db
    .update(titleOrders)
    .set({ wireConfirmedAt: null, updatedAt: new Date() })
    .where(and(eq(titleOrders.organizationId, organizationId), eq(titleOrders.dealId, dealId)));
}
