/**
 * Giving ledger (W5a) — the server half of shared/trust/giving.ts.
 *
 * WHO IS A PAYING MEMBER: an organization whose billing row says it is on a
 * paid tier with an active Stripe subscription — `subscription_status =
 * 'active'`, `subscription_tier <> 'free'`, a `stripe_subscription_id`, and
 * not the founder's own org. The same predicate the revenue agent and the
 * founder digest count with (agents/revenue.ts, founderWeeklyDigest.ts), plus
 * the Stripe id so a hand-flipped tier with no subscription is not "paying".
 * Counted when the monthly job runs; the card says when.
 *
 * NOTHING HERE MOVES MONEY. The job proposes; the founder approves on the
 * Decisions door and pays outside AcreOS; a receipt records it.
 */
import { and, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "../../db";
import { givingFoodBanks, givingMonths, givingReceipts, organizations, platformSettings } from "@shared/schema";
import {
  computeGivingPledge,
  evaluateGivingApproval,
  evaluateGivingReceipt,
  givingMonthFor,
  memberGivingPanel,
  normalizeGivingCounty,
  type MemberGivingPanel,
  type PayingMember,
} from "@shared/trust/giving";
import { unscopedForPlatformOps } from "../../utils/orgScopedDb";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";

const GIVING_CAP_SETTING_KEY = "giving.monthly_cap_cents";

async function payingMembers(): Promise<PayingMember[]> {
  const rows = await unscopedForPlatformOps(
    "giving: the pledge counts every paying member org; read of billing columns only",
  )
    .select({ id: organizations.id, settings: organizations.settings })
    .from(organizations)
    .where(
      and(
        eq(organizations.subscriptionStatus, "active"),
        ne(organizations.subscriptionTier, "free"),
        isNotNull(organizations.stripeSubscriptionId),
        sql`coalesce(${organizations.isFounder}, false) = false`,
      ),
    );
  return rows.map((r) => ({ organizationId: r.id, area: r.settings?.givingArea ?? null }));
}

async function readGivingCapCents(): Promise<number | null> {
  const [row] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(and(eq(platformSettings.key, GIVING_CAP_SETTING_KEY), eq(platformSettings.scope, "global"), isNull(platformSettings.scopeRef)))
    .limit(1);
  const n = row ? Number(row.value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export async function setGivingCapCents(capCents: number, founderId: string): Promise<void> {
  const before = await readGivingCapCents();
  const now = clock.now();
  // scope_ref is NULL for a global row, and NULLs never conflict in a unique
  // index — so this is select-then-write, not ON CONFLICT.
  const [row] = await db
    .select({ id: platformSettings.id })
    .from(platformSettings)
    .where(and(eq(platformSettings.key, GIVING_CAP_SETTING_KEY), eq(platformSettings.scope, "global"), isNull(platformSettings.scopeRef)))
    .limit(1);
  if (row) {
    await db
      .update(platformSettings)
      .set({ value: capCents, lastChangedBy: founderId, lastChangedAt: now })
      .where(eq(platformSettings.id, row.id));
  } else {
    await db.insert(platformSettings).values({
      key: GIVING_CAP_SETTING_KEY,
      scope: "global",
      scopeRef: null,
      value: capCents,
      defaultValue: 0,
      category: "cost",
      description: "W5a giving: the founder's monthly cap on food-bank giving, in cents. Absent = unset; nothing can be approved.",
      lastChangedBy: founderId,
      lastChangedAt: now,
    });
  }
  const { recordAudit } = await import("../settings");
  await recordAudit({ founderId, area: "giving", action: "set_cap", targetType: "setting", targetId: GIVING_CAP_SETTING_KEY, before, after: capCents });
}

/**
 * The monthly job: count, compute, and put ONE card on the founder's
 * Decisions door. Idempotent per month (unique month); re-running a month
 * that is still awaiting the founder refreshes its counts.
 */
export async function computeGivingMonth(now: Date = clock.now()): Promise<{ month: string; pledgeCents: number; payingMembers: number }> {
  const month = givingMonthFor(now);
  const [members, banks] = await Promise.all([payingMembers(), db.select().from(givingFoodBanks)]);
  const p = computeGivingPledge(members, banks);
  const [existing] = await db.select().from(givingMonths).where(eq(givingMonths.month, month)).limit(1);
  if (existing && existing.status !== "awaiting_founder") {
    return { month, pledgeCents: existing.pledgeCents, payingMembers: existing.payingMembers };
  }
  const values = {
    month,
    computedAt: now,
    payingMembers: p.payingMembers,
    membersWithoutCounty: p.membersWithoutCounty,
    lines: p.lines,
    pledgeCents: p.pledgeCents,
  };
  if (existing) {
    await db.update(givingMonths).set(values).where(eq(givingMonths.id, existing.id));
  } else {
    await db.insert(givingMonths).values(values).onConflictDoNothing({ target: givingMonths.month });
  }
  const { decisionsInboxService } = await import("../decisionsInbox");
  await decisionsInboxService.createDirectDecisionCard({
    itemType: "feature_request_flagged",
    riskLevel: p.pledgeCents > 50_000 ? "high" : "medium",
    urgencyScore: 40,
    sophieAnalysis:
      `${p.payingMembers} paying member(s) counted ${now.toISOString().slice(0, 10)}: ` +
      `$${(p.pledgeCents / 100).toFixed(2)} pledged to mapped food banks; ` +
      `${p.unmappedMembers} member(s) in counties with no food bank entered and ${p.membersWithoutCounty} with no county are not pledged. ` +
      "Nothing is paid until you approve on Decisions → Giving and pay outside AcreOS.",
    recommendedAction: "Review the giving pledge",
    recommendedActionLabel: "Open Giving",
    subject: `Giving pledge for ${month}`,
    options: [],
  });
  logger.info("[giving] monthly pledge computed", { metadata: { month, pledgeCents: p.pledgeCents, payingMembers: p.payingMembers } });
  return { month, pledgeCents: p.pledgeCents, payingMembers: p.payingMembers };
}

export async function approveGivingMonth(input: {
  monthId: number;
  amountCents: number;
  approverIsFounder: boolean;
  founderId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [m] = await db.select().from(givingMonths).where(eq(givingMonths.id, input.monthId)).limit(1);
  if (!m) return { ok: false, reason: "No such month." };
  const capCents = await readGivingCapCents();
  const verdict = evaluateGivingApproval({
    amountCents: input.amountCents,
    pledgeCents: m.pledgeCents,
    capCents,
    approverIsFounder: input.approverIsFounder,
    monthStatus: m.status,
  });
  if (!verdict.ok) return verdict;
  const updated = await db
    .update(givingMonths)
    .set({ status: "approved", approvedCents: input.amountCents, capCentsAtApproval: capCents, decidedAt: clock.now(), decidedBy: input.founderId })
    .where(and(eq(givingMonths.id, m.id), eq(givingMonths.status, "awaiting_founder")))
    .returning({ id: givingMonths.id });
  // A concurrent decision got there first: report what happened, not success.
  if (updated.length === 0) return { ok: false, reason: "This month has already been decided." };
  return { ok: true };
}

export async function declineGivingMonth(monthId: number, founderId: string): Promise<boolean> {
  const r = await db
    .update(givingMonths)
    .set({ status: "declined", decidedAt: clock.now(), decidedBy: founderId })
    .where(and(eq(givingMonths.id, monthId), eq(givingMonths.status, "awaiting_founder")))
    .returning({ id: givingMonths.id });
  return r.length > 0;
}

export async function recordGivingReceipt(input: {
  month: string;
  foodBankId: number;
  amountCents: number;
  reference: string;
  receiptUrl: string | null;
  paidOn: string;
  founderId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [m] = await db.select().from(givingMonths).where(eq(givingMonths.month, input.month)).limit(1);
  if (!m) return { ok: false, reason: "No pledge for that month." };
  if (!m.lines.some((l) => l.foodBankId === input.foodBankId)) return { ok: false, reason: "That food bank has no pledge line in this month." };
  const [{ total }] = await db
    .select({ total: sql<number>`coalesce(sum(${givingReceipts.amountCents}), 0)::int` })
    .from(givingReceipts)
    .where(eq(givingReceipts.month, input.month));
  const verdict = evaluateGivingReceipt({
    amountCents: input.amountCents,
    monthStatus: m.status,
    approvedCents: m.approvedCents,
    alreadyReceiptedCents: Number(total) || 0,
    reference: input.reference,
  });
  if (!verdict.ok) return verdict;
  await db.insert(givingReceipts).values({
    month: input.month,
    foodBankId: input.foodBankId,
    amountCents: input.amountCents,
    reference: input.reference.trim(),
    receiptUrl: input.receiptUrl,
    paidOn: input.paidOn,
    recordedBy: input.founderId,
  });
  return { ok: true };
}

export async function upsertFoodBank(input: { state: string; county: string; name: string; website: string | null }): Promise<void> {
  const state = input.state.trim().toUpperCase();
  const county = normalizeGivingCounty(input.county);
  await db
    .insert(givingFoodBanks)
    .values({ state, county, name: input.name.trim(), website: input.website, source: "founder_entry" })
    .onConflictDoUpdate({
      target: [givingFoodBanks.state, givingFoodBanks.county],
      set: { name: input.name.trim(), website: input.website, enteredAt: clock.now() },
    });
}

export async function founderGivingView() {
  const [months, banks, capCents] = await Promise.all([
    db.select().from(givingMonths).orderBy(desc(givingMonths.month)).limit(12),
    db.select().from(givingFoodBanks).orderBy(givingFoodBanks.state, givingFoodBanks.county),
    readGivingCapCents(),
  ]);
  const receipts = await db.select().from(givingReceipts).orderBy(desc(givingReceipts.paidOn)).limit(200);
  return { capCents, months, foodBanks: banks, receipts };
}

/** A member's panel — receipts only (shared/trust/giving.ts memberGivingPanel). */
export async function memberGivingPanelFor(organizationId: number): Promise<MemberGivingPanel & { area: { state: string; county: string } | null }> {
  const [org] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const area = org?.settings?.givingArea ?? null;
  if (!area) return { ...memberGivingPanel(null, []), area: null };
  const [bank] = await db
    .select()
    .from(givingFoodBanks)
    .where(and(eq(givingFoodBanks.state, area.state.toUpperCase()), eq(givingFoodBanks.county, normalizeGivingCounty(area.county))))
    .limit(1);
  if (!bank) return { ...memberGivingPanel(null, []), area };
  const receipts = await db
    .select({ amountCents: givingReceipts.amountCents, paidOn: givingReceipts.paidOn, reference: givingReceipts.reference, receiptUrl: givingReceipts.receiptUrl })
    .from(givingReceipts)
    .where(eq(givingReceipts.foodBankId, bank.id));
  return { ...memberGivingPanel(bank, receipts), area };
}

export async function setMemberGivingArea(organizationId: number, area: { state: string; county: string } | null): Promise<void> {
  const value = area ? { state: area.state.trim().toUpperCase(), county: normalizeGivingCounty(area.county) } : null;
  await db
    .update(organizations)
    .set({
      settings: value
        ? sql`coalesce(${organizations.settings}, '{}'::jsonb) || jsonb_build_object('givingArea', ${JSON.stringify(value)}::jsonb)`
        : sql`coalesce(${organizations.settings}, '{}'::jsonb) - 'givingArea'`,
    })
    .where(eq(organizations.id, organizationId));
}
