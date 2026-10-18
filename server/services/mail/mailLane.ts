/**
 * THE physical-mail lane — founder decisions 2026-10-17 A and B
 * (docs/company/founder-decisions-2026-10-17.md).
 *
 * A customer's postcards and letters go out on exactly one of two lanes:
 *
 *   own_account — the org's OWN Lob (or PostGrid) key. The provider bills the
 *                 org directly; AcreOS charges no credits and never touches
 *                 its own provider account for the piece.
 *   house       — AcreOS house mail: AcreOS's own Lob account. Every house
 *                 piece carries the ORG's own VERIFIED sender identity as its
 *                 return address, and is PRE-PAID from the org's PURCHASED
 *                 credits only — never the included monthly pool, a trial
 *                 allowance, a sponsor pool or any grant — at a charge that
 *                 covers what the piece costs AcreOS
 *                 (shared/billing/house-mail-pricing.ts).
 *
 * Anything else is `refused`, in plain words, before any provider is
 * contacted — no key, no verified identity, no house account, or a spec
 * AcreOS has no recorded cost for means nothing prints and nothing is charged.
 *
 * Scope: physical mail only. Counterparty email and SMS stay strictly BYO
 * (emailService purpose lanes, smsService requireByoIdentity) — this module
 * never decides an email or SMS send.
 *
 * Every physical-mail send site resolves its lane HERE
 * (tests/unit/physicalMailLanePopulation.test.ts holds the population), and
 * the Lob client for a lane comes only from
 * `directMailService.getLobClientForLane`, which hands out the platform key
 * for the house lane and nothing else.
 */

import { and, eq, sql } from "drizzle-orm";
import type { MailSenderIdentity } from "@shared/schema";
import { creditTransactions, financialLedger, organizations } from "@shared/schema";
import type { CreditAction } from "@shared/billing/credit-weights";
import {
  HOUSE_MAIL_COST_TABLE,
  houseMailCostEntry,
  houseMailCreditsPerPiece,
  houseMailChargeIsSelfFunding,
  houseMailMinimumCredits,
  HOUSE_MAIL_CARD_FEE_ALLOWANCE,
  HOUSE_MAIL_MARGIN_FLOOR,
  houseMailSpecKey,
  type HouseMailSpec,
  type HouseMailSpecKey,
} from "@shared/billing/house-mail-pricing";
import { db, withTransaction, type PrimaryDb } from "../../db";
import { ProviderNotContactedError } from "../actions/outwardAction";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";

export type { HouseMailSpec } from "@shared/billing/house-mail-pricing";
export type MailPieceKind = "postcard" | "letter";
/** Providers an org can bring its own key for. */
export type OwnMailProvider = "lob" | "postgrid";

/**
 * The credit weight each kind is LISTED at (founder-recalibratable through
 * `credits.weight.*` in founder_settings via creditCost). The charge is that
 * listing raised, where needed, to the self-funding minimum.
 */
const HOUSE_MAIL_LIST_ACTION: Readonly<Record<MailPieceKind, CreditAction>> = {
  postcard: "postcard_lob",
  letter: "letter_lob",
};

/** The env knobs the old Lob piece-cost table read — still honoured, below a founder setting. */
const HOUSE_MAIL_COST_ENV: Readonly<Record<HouseMailSpecKey, string>> = {
  postcard_4x6: "LOB_POSTCARD_4X6_CENTS",
  postcard_6x9: "LOB_POSTCARD_6X9_CENTS",
  postcard_6x11: "LOB_POSTCARD_6X11_CENTS",
  letter_bw: "LOB_LETTER_BW_CENTS",
  letter_color: "LOB_LETTER_COLOR_CENTS",
};

/** founder_settings key for a spec's provider cost (0 = use the compiled table). */
function houseMailCostSettingKey(key: HouseMailSpecKey): string {
  return `mail.house.cost_cents.${key}`;
}

/** A spec for a postcard of `size` (Lob's sizes: 4x6, 6x9, 6x11). */
export function postcardSpec(size: string | null | undefined): HouseMailSpec {
  return { kind: "postcard", size: size || "4x6" };
}

/** A spec for a letter. `pages` is what the caller knows; unknown means one. */
export function letterSpec(opts: { color?: boolean | null; pages?: number | null } = {}): HouseMailSpec {
  return { kind: "letter", color: opts.color ?? false, pages: opts.pages ?? 1 };
}

/**
 * AcreOS's provider cost for one piece of `key`, in cents: a founder setting
 * when one is set, else the legacy env knob, else the compiled table. This is
 * the ONE place AcreOS's mail cost is read — the house charge and the COGS
 * ledger posting both come through here.
 */
export async function houseMailProviderCostCents(key: HouseMailSpecKey): Promise<number> {
  const compiled = houseMailCostEntry(key).providerCostCents;
  try {
    const { getSetting } = await import("../settings");
    const value = await getSetting<number>(houseMailCostSettingKey(key), 0, { scope: "global", scopeRef: null });
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  } catch {
    /* settings unavailable — fall through to the env knob / compiled cost */
  }
  const env = Number(process.env[HOUSE_MAIL_COST_ENV[key]]);
  return Number.isFinite(env) && env > 0 ? env : compiled;
}

export interface HouseMailPrice {
  key: HouseMailSpecKey;
  label: string;
  providerCostCents: number;
  /** The credits the surface lists for this piece before the floor. */
  listedCredits: number;
  /** What one piece is charged — never below the self-funding minimum. */
  creditsPerPiece: number;
  /** True when the listing did not cover the cost and was raised. */
  raisedToFloor: boolean;
}

async function listedCreditsFor(kind: MailPieceKind): Promise<number> {
  const { creditCost } = await import("../creditCost");
  return creditCost(HOUSE_MAIL_LIST_ACTION[kind]);
}

/**
 * The house price of one piece of `spec`, or null when AcreOS has no recorded
 * cost for it (refused, never guessed). `listedCredits` lets a surface with its
 * own listed price (the campaign send) price through the same floor.
 */
async function houseMailPrice(
  spec: HouseMailSpec,
  opts: { listedCredits?: number } = {},
): Promise<HouseMailPrice | null> {
  const key = houseMailSpecKey(spec);
  if (!key) return null;
  const [providerCostCents, listed] = await Promise.all([
    houseMailProviderCostCents(key),
    opts.listedCredits !== undefined ? Promise.resolve(opts.listedCredits) : listedCreditsFor(spec.kind),
  ]);
  const listedCredits = Math.ceil(listed);
  const creditsPerPiece = houseMailCreditsPerPiece(listedCredits, providerCostCents);
  // Belt and braces: a charge that does not pay for the piece is never
  // offered (a non-positive or non-finite cost from a bad setting lands here).
  if (!houseMailChargeIsSelfFunding(creditsPerPiece, providerCostCents)) {
    logger.error("[mailLane] house price fails the self-funding rule — refusing the spec", undefined, {
      metadata: { key, providerCostCents, creditsPerPiece },
    });
    return null;
  }
  return {
    key,
    label: houseMailCostEntry(key).label,
    providerCostCents,
    listedCredits,
    creditsPerPiece,
    raisedToFloor: listedCredits < houseMailMinimumCredits(providerCostCents),
  };
}

/** The house price of every spec in the cost table — what Settings shows. */
async function houseMailPriceTable(): Promise<HouseMailPrice[]> {
  const rows = await Promise.all(
    HOUSE_MAIL_COST_TABLE.map((e) =>
      houseMailPrice(e.kind === "postcard" ? postcardSpec(e.key.replace("postcard_", "")) : letterSpec({ color: e.key === "letter_color" })),
    ),
  );
  return rows.filter((r): r is HouseMailPrice => r !== null);
}

export type MailLaneRefusalReason =
  | "no_sender_identity"
  | "sender_identity_unverified"
  | "house_mail_unavailable"
  | "unknown_spec";

export type HouseMailLane = {
  lane: "house";
  provider: "lob";
  spec: HouseMailSpec;
  price: HouseMailPrice;
  creditsPerPiece: number;
  /** The org's verified return address every house piece must carry. */
  senderIdentity: MailSenderIdentity;
};

export type MailLane =
  | { lane: "own_account"; provider: OwnMailProvider; creditsPerPiece: 0 }
  | HouseMailLane
  | { lane: "refused"; reason: MailLaneRefusalReason; message: string };

export type SendableMailLane = Exclude<MailLane, { lane: "refused" }>;

type IdentityLike = Pick<MailSenderIdentity, "organizationId" | "status"> & { isActive?: boolean | null };

/** True when `identity` is this org's own, active and Lob-verified return address. */
function isVerifiedSenderIdentityFor(
  organizationId: number,
  identity: IdentityLike | null | undefined,
): boolean {
  return Boolean(
    identity &&
      identity.organizationId === organizationId &&
      identity.status === "verified" &&
      identity.isActive !== false,
  );
}

const BOTH_WAYS =
  "Buy credits for AcreOS mail in Settings → Usage & Credits, or connect your own Lob key in Settings → Your provider keys.";

interface MailLaneInputs {
  organizationId: number;
  spec: HouseMailSpec;
  /** The provider this piece would be sent through. */
  via: OwnMailProvider;
  /** True when the org holds its OWN key for `via`. */
  hasOwnKey: boolean;
  /** True when AcreOS's own Lob account can send at all. */
  houseConfigured: boolean;
  /** The return address the piece would carry (the org's default when the caller names none). */
  senderIdentity: MailSenderIdentity | null | undefined;
  /** The house price of the spec, or null when the cost table has no row for it. */
  price: HouseMailPrice | null;
}

/**
 * Pure: the lane for one piece. Own key first (no credits, the provider bills
 * the org); otherwise house mail on Lob, which requires a verified identity
 * and a spec AcreOS knows the cost of; otherwise a refusal that says what is
 * missing and names both ways forward.
 */
function decideMailLane(input: MailLaneInputs): MailLane {
  if (input.hasOwnKey) {
    return { lane: "own_account", provider: input.via, creditsPerPiece: 0 };
  }
  if (input.via !== "lob") {
    return {
      lane: "refused",
      reason: "house_mail_unavailable",
      message:
        "PostGrid mail goes out only on your own PostGrid key. Connect it in Settings → Your provider keys, " +
        "or send through AcreOS mail on Lob instead.",
    };
  }
  if (!input.senderIdentity) {
    return {
      lane: "refused",
      reason: "no_sender_identity",
      message:
        "AcreOS mail needs your own return address. Add one in Mail Settings and verify it, " +
        "or connect your own Lob key in Settings → Your provider keys.",
    };
  }
  if (!isVerifiedSenderIdentityFor(input.organizationId, input.senderIdentity)) {
    return {
      lane: "refused",
      reason: "sender_identity_unverified",
      message:
        `AcreOS mail only goes out under a verified return address, and "${input.senderIdentity.name}" ` +
        "is not verified yet. Verify it in Mail Settings, or connect your own Lob key in Settings → Your provider keys.",
    };
  }
  if (!input.price) {
    return {
      lane: "refused",
      reason: "unknown_spec",
      message:
        "AcreOS mail can't print this piece yet — it has no recorded price for that size, page count or mail class. " +
        "Send a one-page letter or a 4×6, 6×9 or 6×11 postcard, or connect your own Lob key in Settings → Your provider keys.",
    };
  }
  if (!input.houseConfigured) {
    return {
      lane: "refused",
      reason: "house_mail_unavailable",
      message:
        "AcreOS mail is not available on this deployment yet. Connect your own Lob key in " +
        "Settings → Your provider keys to send now.",
    };
  }
  return {
    lane: "house",
    provider: "lob",
    spec: input.spec,
    price: input.price,
    creditsPerPiece: input.price.creditsPerPiece,
    senderIdentity: input.senderIdentity,
  };
}

/** True when AcreOS's own Lob account resolves (under the live-send interlock). */
export async function houseMailConfigured(): Promise<boolean> {
  const { resolvePlatformLobKey } = await import("./liveSendInterlock");
  try {
    resolvePlatformLobKey();
    return true;
  } catch {
    return false;
  }
}

/** True when the org holds its own key for `provider`. */
export async function orgHasOwnMailKey(organizationId: number, provider: OwnMailProvider): Promise<boolean> {
  if (provider === "lob") {
    const { getOwnLobClient } = await import("../directMailService");
    return (await getOwnLobClient(organizationId)) !== null;
  }
  try {
    const { getByokCredential } = await import("../byok/key-vault");
    return Boolean(await getByokCredential({ organizationId, channel: "postgrid" }, { touchLastUsed: false }));
  } catch (err) {
    logger.warn("[mailLane] PostGrid key lookup failed — treating as no own key", {
      metadata: { organizationId, error: err instanceof Error ? err.message : String(err) },
    });
    return false;
  }
}

/**
 * THE lane resolver every physical-mail send site calls.
 *
 * `spec`: what the piece is (postcardSpec / letterSpec). `senderIdentity`: the
 * return address the caller intends to print — omit it to use the org's
 * default identity. A house piece is refused unless that identity is the
 * org's own, active and verified, and unless the cost table prices the spec.
 * `listedCredits`: a surface's own listed per-piece price (the campaign send);
 * the floor still applies.
 */
export async function resolveMailLane(
  organizationId: number,
  spec: HouseMailSpec,
  opts: { via?: OwnMailProvider; senderIdentity?: MailSenderIdentity | null; listedCredits?: number } = {},
): Promise<MailLane> {
  const via = opts.via ?? "lob";
  const hasOwnKey = await orgHasOwnMailKey(organizationId, via);
  if (hasOwnKey) {
    return decideMailLane({ organizationId, spec, via, hasOwnKey, houseConfigured: false, senderIdentity: null, price: null });
  }
  let senderIdentity = opts.senderIdentity;
  if (senderIdentity === undefined) {
    const { storage } = await import("../../storage");
    senderIdentity = (await storage.getDefaultMailSenderIdentity(organizationId).catch(() => undefined)) ?? null;
  }
  // The house account is only probed once the identity would pass — a refused
  // identity never touches anything of AcreOS's.
  const [houseConfigured, price] = await Promise.all([
    isVerifiedSenderIdentityFor(organizationId, senderIdentity) ? houseMailConfigured() : Promise.resolve(false),
    via === "lob" ? houseMailPrice(spec, { listedCredits: opts.listedCredits }) : Promise.resolve(null),
  ]);
  return decideMailLane({ organizationId, spec, via, hasOwnKey: false, houseConfigured, senderIdentity, price });
}

/** Raised when a lane refuses or purchased credits run short — nothing was sent or charged. */
class MailLaneRefusedError extends Error {
  constructor(
    readonly reason: MailLaneRefusalReason | "insufficient_purchased_credits",
    message: string,
  ) {
    super(message);
    this.name = "MailLaneRefusedError";
  }
}

// ── Purchased credits ───────────────────────────────────────────────────────

/**
 * credit_transactions types whose credits were PAID for (a credit pack, a mail
 * recharge, a card top-up) or returned from a balance debit (refund). Every
 * other positive row — a support courtesy credit, a bonus, an allowance — is a
 * GRANT, and house mail may never spend it (decision B). An unknown future
 * type counts as a grant: the safe direction.
 */
const PURCHASED_CREDIT_INFLOW_TYPES = ["purchase", "mail_credit_recharge", "topup", "refund"] as const;

/** Credits ever granted (not bought) to the org's balance. */
function grantedCreditsSql(organizationId: number) {
  return sql`(SELECT coalesce(sum(${creditTransactions.amountCents}), 0) FROM ${creditTransactions}
    WHERE ${creditTransactions.organizationId} = ${organizationId}
      AND ${creditTransactions.amountCents} > 0
      AND ${creditTransactions.type} NOT IN (${sql.join(PURCHASED_CREDIT_INFLOW_TYPES.map((t) => sql`${t}`), sql`, `)}))`;
}

/**
 * The purchased credits house mail may spend: the balance less every credit
 * ever granted. Conservative by construction — grants are assumed unspent —
 * so the sum of every house charge can never exceed what the org paid for.
 */
export async function purchasedCreditsAvailable(organizationId: number, q: PrimaryDb = db): Promise<number> {
  const [row] = await q
    .select({
      available: sql<number>`greatest(coalesce(${organizations.creditBalance}, '0')::numeric - ${grantedCreditsSql(organizationId)}, 0)::int`,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return Number(row?.available ?? 0);
}

export interface HouseMailCharge {
  /** The ledger row's key — refunds are keyed off it. */
  externalEventId: string;
  /** Credits taken for this charge (a replay reports the original). */
  debitedCents: number;
  units: number;
  /** True when this externalEventId had already been charged — nothing new was taken. */
  replay: boolean;
}

/** The ledger posted_by suffix creditPool reads as "paid from purchased credits" (never pool usage). */
const HOUSE_LEDGER_POSTED_BY = (key: HouseMailSpecKey) => `system:house-mail:${key}:purchased-overflow`;

class InsufficientPurchasedCredits extends Error {
  constructor(readonly required: number) {
    super("insufficient purchased credits");
  }
}

function shortMessage(lane: HouseMailLane, units: number): string {
  const total = lane.creditsPerPiece * units;
  return (
    `AcreOS mail is paid from purchased credits only: this needs ${total} credit${total === 1 ? "" : "s"} ` +
    `(${lane.creditsPerPiece} per ${lane.price.label.toLowerCase()}) and your purchased balance is short. ` +
    `Nothing was mailed. ${BOTH_WAYS}`
  );
}

/**
 * PRE-PAY house pieces from the org's PURCHASED credits — atomically, before
 * any provider is contacted.
 *
 *   1. Claim the charge: a financial_ledger row under `externalEventId`
 *      (unique). A retry with the same key finds the claim and is charged
 *      nothing (replay) — no double charge.
 *   2. Take the credits in ONE conditional UPDATE: balance − every granted
 *      credit ≥ the charge. The monthly pool, trial allowance and sponsor pools
 *      are not in this balance at all; grants are excluded by the predicate.
 *   3. Record the debit in credit_transactions.
 *
 * All three commit together (the caller's transaction when it passes `tx`, so
 * the charge commits or rolls back with the shipment it pays for). Short of
 * purchased credits → MailLaneRefusedError and nothing is written. There is no
 * founder or tier bypass: a house piece is always paid for.
 */
export async function chargeHouseMail(args: {
  organizationId: number;
  lane: HouseMailLane;
  units?: number;
  externalEventId: string;
  notes?: string;
  tx?: PrimaryDb;
}): Promise<HouseMailCharge> {
  const units = Math.max(1, Math.floor(args.units ?? 1));
  const cents = args.lane.creditsPerPiece * units;
  const key = args.lane.price.key;

  const run = async (tx: PrimaryDb): Promise<HouseMailCharge> => {
    const claimed = await tx
      .insert(financialLedger)
      .values({
        organizationId: args.organizationId,
        bucket: "opex_available",
        category: "opex_spent",
        amountCents: -cents,
        feature: "postcard",
        provider: "lob",
        externalEventId: args.externalEventId,
        postedAt: clock.now(),
        postedBy: HOUSE_LEDGER_POSTED_BY(key),
        notes: args.notes ?? `AcreOS mail: ${units} × ${args.lane.price.label}`,
      })
      .onConflictDoNothing({ target: financialLedger.externalEventId })
      .returning({ id: financialLedger.id });
    if (claimed.length === 0) {
      const [existing] = await tx
        .select({ amountCents: financialLedger.amountCents, postedBy: financialLedger.postedBy })
        .from(financialLedger)
        .where(and(eq(financialLedger.externalEventId, args.externalEventId), eq(financialLedger.organizationId, args.organizationId)))
        .limit(1);
      if (existing && (existing.postedBy ?? "").startsWith("system:house-mail:")) {
        return { externalEventId: args.externalEventId, debitedCents: Math.abs(Number(existing.amountCents)), units, replay: true };
      }
      throw new Error(`house mail charge key ${args.externalEventId} is already used by another ledger row`);
    }
    const [updated] = await tx
      .update(organizations)
      .set({ creditBalance: sql`COALESCE(${organizations.creditBalance}, '0')::numeric - ${cents}` })
      .where(
        and(
          eq(organizations.id, args.organizationId),
          sql`COALESCE(${organizations.creditBalance}, '0')::numeric - ${grantedCreditsSql(args.organizationId)} >= ${cents}`,
        ),
      )
      .returning({ newBalance: sql<number>`(COALESCE(${organizations.creditBalance}, '0')::numeric)::int` });
    // Throwing rolls the claim back with everything else in this transaction.
    if (!updated) throw new InsufficientPurchasedCredits(cents);
    await tx.insert(creditTransactions).values({
      organizationId: args.organizationId,
      type: "debit",
      amountCents: -cents,
      balanceAfterCents: updated.newBalance,
      description: `AcreOS mail: ${units} × ${args.lane.price.label}`,
      metadata: { source: "house-mail", specKey: key, units, creditsPerPiece: args.lane.creditsPerPiece, externalEventId: args.externalEventId },
    });
    return { externalEventId: args.externalEventId, debitedCents: cents, units, replay: false };
  };

  try {
    const charge = args.tx ? await run(args.tx) : await withTransaction(run);
    if (!args.tx && !charge.replay) {
      const { creditService } = await import("../credits");
      creditService.afterDebitCommitted(args.organizationId);
    }
    return charge;
  } catch (err) {
    if (err instanceof InsufficientPurchasedCredits) {
      throw new MailLaneRefusedError("insufficient_purchased_credits", shortMessage(args.lane, units));
    }
    throw err;
  }
}

/** True for a refusal raised by chargeHouseMail when purchased credits are short. */
export function isHouseMailShort(err: unknown): err is MailLaneRefusedError {
  return err instanceof MailLaneRefusedError && err.reason === "insufficient_purchased_credits";
}

/**
 * Charge ONE house piece before the provider call, as a refusal the
 * outward-action boundary records as "not contacted" (a retry after buying
 * credits works under the same key).
 */
export async function chargeHouseMailPiece(args: {
  organizationId: number;
  lane: HouseMailLane;
  externalEventId: string;
  notes?: string;
}): Promise<HouseMailCharge> {
  try {
    return await chargeHouseMail({ ...args, units: 1 });
  } catch (err) {
    if (err instanceof MailLaneRefusedError) throw new ProviderNotContactedError(err.message, err);
    throw new ProviderNotContactedError(
      "The AcreOS mail credit charge could not be taken, so nothing was mailed.",
      err instanceof Error ? err : undefined,
    );
  }
}

// ── Refunds: only for a piece the provider did not bill ─────────────────────

/** Lob HTTP statuses that mean "request rejected, nothing created or billed". */
const LOB_REJECTED_STATUSES: ReadonlySet<number> = new Set([400, 401, 402, 403, 404, 405, 413, 415, 422, 429]);

function lobStatusOf(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { status_code?: unknown; statusCode?: unknown; status?: unknown; _response?: { statusCode?: unknown } };
  for (const v of [e.status_code, e._response?.statusCode, e.statusCode, e.status]) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 100 && n < 600) return n;
  }
  return null;
}

/**
 * True only when it is CERTAIN the provider did not accept — and so did not
 * bill — the piece: the provider was never contacted, or Lob answered with a
 * rejection status. A timeout, a network error, a 5xx or anything else is
 * "unknown": Lob may have printed and billed it, so it is never refunded.
 */
export function providerDidNotBill(err: unknown): boolean {
  if (err instanceof ProviderNotContactedError) return true;
  if (err && typeof err === "object" && (err as { providerNotBilled?: unknown }).providerNotBilled === true) return true;
  const status = lobStatusOf(err);
  return status !== null && LOB_REJECTED_STATUSES.has(status);
}

/** Mark a wrapped send error with what the provider's answer proved. */
export function withBillingVerdict<E extends Error>(wrapped: E, cause: unknown): E & { providerNotBilled: boolean } {
  return Object.assign(wrapped, { providerNotBilled: providerDidNotBill(cause) });
}

/**
 * Return a house charge for a piece that did not go out — ONLY when the
 * provider certainly did not bill it (providerDidNotBill). Otherwise the
 * charge stands and the piece is logged for reconciliation. Never throws.
 */
export async function refundUnbilledHouseMail(
  organizationId: number,
  charge: HouseMailCharge | null,
  failure: unknown,
  reason: string,
  opts: { amountCents?: number; refundKey?: string } = {},
): Promise<boolean> {
  if (!charge || charge.debitedCents <= 0) return false;
  if (!providerDidNotBill(failure)) {
    logger.error("[mailLane] house piece failed with an unknown provider outcome — charge kept, reconcile with Lob", undefined, {
      metadata: { organizationId, externalEventId: charge.externalEventId, error: failure instanceof Error ? failure.message : String(failure) },
    });
    return false;
  }
  try {
    const { refundPoolDebit } = await import("../creditPool");
    await refundPoolDebit({
      organizationId,
      originalEventId: charge.externalEventId,
      amountCents: opts.amountCents ?? charge.debitedCents,
      reason,
      refundKey: opts.refundKey,
    });
    return true;
  } catch (err) {
    logger.error("[mailLane] house mail refund failed", err instanceof Error ? err : undefined, {
      metadata: { organizationId, externalEventId: charge.externalEventId },
    });
    return false;
  }
}

/** Throw the lane's refusal as an error that proves no provider was contacted. */
export async function assertSendableLane(lane: MailLane): Promise<SendableMailLane> {
  if (lane.lane === "refused") {
    throw new ProviderNotContactedError(lane.message, new MailLaneRefusedError(lane.reason, lane.message));
  }
  return lane;
}

// ── What the customer sees ──────────────────────────────────────────────────

/** The lane a customer sees in Settings and at send — no secrets, numbers from the canonical table. */
export interface MailLaneSummary {
  lob: { lane: MailLane["lane"]; reason?: MailLaneRefusalReason; message?: string };
  ownKeys: Record<OwnMailProvider, boolean>;
  /** Credits per house piece, per kind: the cheapest spec of each (the headline numbers). */
  houseRates: Record<MailPieceKind, number>;
  /** Every spec AcreOS mail prints, with its credits per piece. */
  housePrices: Array<{ key: HouseMailSpecKey; label: string; kind: MailPieceKind; creditsPerPiece: number }>;
  /** Purchased credits house mail may spend (grants excluded). */
  purchasedCredits: number;
  /** The self-funding rule every house price satisfies (founder decision 2026-10-17 B). */
  pricingRule: { cardFeeAllowance: number; marginFloor: number };
  houseConfigured: boolean;
  senderIdentity: { id: number; name: string; status: string } | null;
}

export async function summarizeMailLane(organizationId: number): Promise<MailLaneSummary> {
  const [lane, postgrid, prices, houseConfigured, purchasedCredits] = await Promise.all([
    resolveMailLane(organizationId, postcardSpec("4x6"), { via: "lob" }),
    orgHasOwnMailKey(organizationId, "postgrid"),
    houseMailPriceTable(),
    houseMailConfigured(),
    purchasedCreditsAvailable(organizationId),
  ]);
  const { storage } = await import("../../storage");
  const identity = await storage.getDefaultMailSenderIdentity(organizationId).catch(() => undefined);
  const housePrices = prices.map((p) => ({
    key: p.key,
    label: p.label,
    kind: (p.key.startsWith("postcard_") ? "postcard" : "letter") as MailPieceKind,
    creditsPerPiece: p.creditsPerPiece,
  }));
  const cheapest = (kind: MailPieceKind) => Math.min(...housePrices.filter((p) => p.kind === kind).map((p) => p.creditsPerPiece));
  return {
    lob: {
      lane: lane.lane,
      reason: lane.lane === "refused" ? lane.reason : undefined,
      message: lane.lane === "refused" ? lane.message : undefined,
    },
    ownKeys: { lob: lane.lane === "own_account", postgrid },
    houseRates: { postcard: cheapest("postcard"), letter: cheapest("letter") },
    housePrices,
    purchasedCredits,
    pricingRule: { cardFeeAllowance: HOUSE_MAIL_CARD_FEE_ALLOWANCE, marginFloor: HOUSE_MAIL_MARGIN_FLOOR },
    houseConfigured,
    senderIdentity: identity ? { id: identity.id, name: identity.name, status: identity.status } : null,
  };
}
