/**
 * Creator revenue share — the service (W3). Rules: shared/billing/creatorProgram.ts.
 *
 *   createCreator()                 founder adds a creator and their code
 *   creatorForSignupCode()          the attribution rule: a signup's first-touch
 *                                   ?ref= code (users.acquisition_utm.ref) names
 *                                   an active creator created before the signup
 *   recordCreatorConversion()       Stripe paid-invoice webhook → one row per
 *                                   PAID invoice of an attributed customer
 *   voidCreatorConversionForInvoice() a refund voids a conversion not yet paid out
 *   creatorLedger()                 the founder's view
 *   approveCreatorPayout()          founder-only; refused while the rate is unset
 *   markCreatorPayoutPaid()         founder records the payment they made
 *
 * AcreOS's OWN money, paid by the founder outside AcreOS: nothing here calls a
 * processor or moves funds, and no customer money is involved.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { creators, creatorConversions, teamMembers, type Creator } from "@shared/schema";
import { users } from "@shared/models/auth";
import {
  CREATOR_PROGRAM,
  CREATOR_RATE_UNSET_REFUSAL,
  conversionDecision,
  creatorForSignupCode,
  creatorLedgerRow,
  normalizeCreatorCode,
  type CreatorLedgerRow,
} from "@shared/billing/creatorProgram";
import { logger } from "../utils/logger";
import { clock } from "../utils/clock";

export type CreateCreatorResult =
  | { ok: true; creator: Creator }
  | { ok: false; reason: "invalid_code" | "code_taken" | "code_is_customer_referral" | "missing_name" };

export async function createCreator(input: { code: string; displayName: string; contact?: string | null; createdBy: string }): Promise<CreateCreatorResult> {
  const code = normalizeCreatorCode(input.code);
  if (!code) return { ok: false, reason: "invalid_code" };
  const displayName = String(input.displayName ?? "").trim().slice(0, 120);
  if (!displayName) return { ok: false, reason: "missing_name" };
  // A customer's personal referral code wins on ?ref= (applyReferralCode runs
  // first), so a creator may never be given one.
  const [clash] = await db.select({ id: users.id }).from(users).where(eq(users.referralCode, code)).limit(1);
  if (clash) return { ok: false, reason: "code_is_customer_referral" };
  const [existing] = await db.select({ id: creators.id }).from(creators).where(eq(creators.code, code)).limit(1);
  if (existing) return { ok: false, reason: "code_taken" };
  const [creator] = await db
    .insert(creators)
    .values({ code, displayName, contact: input.contact?.trim().slice(0, 200) || null, createdBy: input.createdBy })
    .returning();
  return { ok: true, creator };
}

/** The creator a paying organization is attributed to, if any. */
async function creatorForOrganization(orgId: number): Promise<Pick<Creator, "id" | "code"> | null> {
  const members = await db
    .select({ ref: sql<string | null>`${users.acquisitionUtm}->>'ref'`, createdAt: users.createdAt })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.organizationId, orgId));
  const codes = Array.from(new Set(members.map((m) => normalizeCreatorCode(m.ref ?? "")).filter((c): c is string => !!c)));
  if (codes.length === 0) return null;
  const candidates = await db.select().from(creators).where(inArray(creators.code, codes));
  // Earliest signup wins, so the person who founded the org decides.
  const ordered = [...members].sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
  for (const m of ordered) {
    const hit = creatorForSignupCode(m.ref, m.createdAt ?? null, candidates);
    if (hit) return hit;
  }
  return null;
}

export type RecordConversionResult =
  | { recorded: true; status: "rate_unset" | "owed" }
  | { recorded: false; reason: "nothing_paid" | "not_attributed" | "already_recorded" | "error" };

/**
 * A paid invoice from organization `orgId`. Records ONE conversion per invoice
 * when the org is attributed to a creator and money was actually collected.
 * Idempotent on the invoice id (Stripe redelivers). Never throws.
 */
export async function recordCreatorConversion(
  orgId: number,
  invoice: { id: string; amountPaidCents: number; currency?: string | null; paidAt: Date },
): Promise<RecordConversionResult> {
  try {
    const decision = conversionDecision({ amountPaidCents: invoice.amountPaidCents }, CREATOR_PROGRAM.commissionBps);
    if (!decision.record) return { recorded: false, reason: decision.reason };
    const creator = await creatorForOrganization(orgId);
    if (!creator) return { recorded: false, reason: "not_attributed" };
    const inserted = await db
      .insert(creatorConversions)
      .values({
        creatorId: creator.id,
        stripeInvoiceId: invoice.id,
        amountPaidCents: invoice.amountPaidCents,
        currency: (invoice.currency ?? "usd").toLowerCase(),
        paidAt: invoice.paidAt,
        commissionBps: decision.commissionBps,
        commissionCents: decision.commissionCents,
        status: decision.status,
      })
      .onConflictDoNothing({ target: creatorConversions.stripeInvoiceId })
      .returning({ id: creatorConversions.id });
    if (inserted.length === 0) return { recorded: false, reason: "already_recorded" };
    logger.info("[creator-program] paid conversion recorded", { metadata: { creatorId: creator.id, status: decision.status } });
    return { recorded: true, status: decision.status };
  } catch (err) {
    logger.warn("[creator-program] conversion not recorded (non-fatal)", { metadata: { error: err instanceof Error ? err.message : String(err) } });
    return { recorded: false, reason: "error" };
  }
}

/** A refunded invoice is no longer a paid conversion — unless already paid out. */
export async function voidCreatorConversionForInvoice(invoiceId: string, reason: string): Promise<boolean> {
  try {
    const rows = await db
      .update(creatorConversions)
      .set({ status: "void", voidReason: reason.slice(0, 200) })
      .where(and(eq(creatorConversions.stripeInvoiceId, invoiceId), inArray(creatorConversions.status, ["rate_unset", "owed", "approved"])))
      .returning({ id: creatorConversions.id });
    return rows.length > 0;
  } catch (err) {
    logger.warn("[creator-program] void failed (non-fatal)", { metadata: { error: err instanceof Error ? err.message : String(err) } });
    return false;
  }
}

export interface CreatorLedgerEntry extends CreatorLedgerRow {
  id: number;
  code: string;
  displayName: string;
  contact: string | null;
  status: string;
  createdAt: Date;
  attributedSignups: number;
  /** Approved batches awaiting the founder's payment reference. */
  approvedBatches: Array<{ batch: string; amountCents: number }>;
}

export async function creatorLedger(): Promise<{ commissionBps: number | null; refusal: string | null; creators: CreatorLedgerEntry[] }> {
  const bps = CREATOR_PROGRAM.commissionBps;
  const all = await db.select().from(creators).orderBy(creators.createdAt);
  const conv = all.length
    ? await db
        .select({ creatorId: creatorConversions.creatorId, status: creatorConversions.status, amountPaidCents: creatorConversions.amountPaidCents, commissionCents: creatorConversions.commissionCents, payoutBatch: creatorConversions.payoutBatch })
        .from(creatorConversions)
        .where(inArray(creatorConversions.creatorId, all.map((c) => c.id)))
    : [];
  const signups = all.length
    ? await db
        .select({ code: sql<string>`upper(${users.acquisitionUtm}->>'ref')`, createdAt: users.createdAt })
        .from(users)
        .where(inArray(sql`upper(${users.acquisitionUtm}->>'ref')`, all.map((c) => c.code)))
    : [];
  return {
    commissionBps: bps,
    refusal: bps === null ? CREATOR_RATE_UNSET_REFUSAL : null,
    creators: all.map((c) => ({
      id: c.id,
      code: c.code,
      displayName: c.displayName,
      contact: c.contact,
      status: c.status,
      createdAt: c.createdAt,
      attributedSignups: signups.filter((s) => s.code === c.code && (!s.createdAt || new Date(s.createdAt) >= new Date(c.createdAt))).length,
      approvedBatches: Object.entries(
        conv
          .filter((r) => r.creatorId === c.id && r.status === "approved" && r.payoutBatch)
          .reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.payoutBatch!]: (acc[r.payoutBatch!] ?? 0) + (r.commissionCents ?? 0) }), {}),
      ).map(([batch, amountCents]) => ({ batch, amountCents })),
      ...creatorLedgerRow(conv.filter((r) => r.creatorId === c.id), bps),
    })),
  };
}

export type ApprovePayoutResult =
  | { ok: true; batch: string; amountCents: number; conversions: number }
  | { ok: false; reason: "rate_unset" | "nothing_owed" | "unknown_creator"; message: string };

/** Founder approves everything a creator is owed into one payout batch. */
export async function approveCreatorPayout(creatorId: number, founderId: string): Promise<ApprovePayoutResult> {
  if (CREATOR_PROGRAM.commissionBps === null) return { ok: false, reason: "rate_unset", message: CREATOR_RATE_UNSET_REFUSAL };
  const [creator] = await db.select({ id: creators.id }).from(creators).where(eq(creators.id, creatorId)).limit(1);
  if (!creator) return { ok: false, reason: "unknown_creator", message: "No such creator." };
  const batch = `CP-${creatorId}-${clock.now().toISOString().slice(0, 10)}-${clock.nowMs().toString(36)}`;
  const rows = await db
    .update(creatorConversions)
    .set({ status: "approved", payoutBatch: batch, approvedBy: founderId, approvedAt: clock.now() })
    .where(and(eq(creatorConversions.creatorId, creatorId), eq(creatorConversions.status, "owed")))
    .returning({ cents: creatorConversions.commissionCents });
  if (rows.length === 0) return { ok: false, reason: "nothing_owed", message: "Nothing is owed to this creator." };
  return { ok: true, batch, amountCents: rows.reduce((s, r) => s + (r.cents ?? 0), 0), conversions: rows.length };
}

/** Founder records that they paid an approved batch (outside AcreOS). */
export async function markCreatorPayoutPaid(batch: string, reference: string, founderId: string): Promise<{ ok: boolean; conversions: number }> {
  const ref = reference.trim().slice(0, 200);
  if (!ref) return { ok: false, conversions: 0 };
  const rows = await db
    .update(creatorConversions)
    .set({ status: "paid", paidReference: `${ref} (recorded by ${founderId})`, payoutPaidAt: clock.now() })
    .where(and(eq(creatorConversions.payoutBatch, batch), eq(creatorConversions.status, "approved")))
    .returning({ id: creatorConversions.id });
  return { ok: rows.length > 0, conversions: rows.length };
}
