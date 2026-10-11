/**
 * tests/db/trustOnBuiltSchema.ts — does W5a work on a database built from
 * this repository?
 *
 *     DATABASE_URL=postgres://… npx tsx tests/db/trustOnBuiltSchema.ts
 *
 * Drives the REAL services, on real tables (only the emailed confirmation
 * token is replaced by one this script knows — the email itself cannot be
 * read back):
 *
 *   OWNER OPT-OUT
 *     1. A request finds matching leads in EVERY org (by email in one, by
 *        mailing address in another) and suppresses nothing until confirmed.
 *     2. Confirming writes keyed hashes only, stamps those leads
 *        do-not-contact in both orgs, and tells each org's owner.
 *     3. The guard now refuses that owner through the real suppression table,
 *        and a later list import in a THIRD org arrives do-not-contact.
 *     4. Erasure is per org and only on the founder's ruling: an approved org's
 *        lead loses its personal fields; a declined org's stays, suppressed.
 *     5. The statutory clock raises one founder card near the deadline and
 *        does not re-raise it the same day.
 *   GIVING
 *     6. The pledge counts real paid members by county; unmapped counties and
 *        members without a county are counted, never pledged.
 *     7. No cap → nothing approves; over the cap → refused; within → approved.
 *        A receipt over the approved amount is refused. The member panel shows
 *        only the receipted amount.
 *
 * Seeds its own rows and deletes them afterwards. Exits non-zero on failure.
 */
import { and, eq, inArray, like, sql } from "drizzle-orm";
import {
  decisionsInboxItems,
  givingFoodBanks,
  givingMonths,
  givingReceipts,
  leads,
  notifications,
  organizations,
  ownerOptOutRequests,
  ownerSuppressions,
  platformSettings,
} from "@shared/schema";

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`[trust-on-built-schema] ${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

async function main() {
  process.env.OWNER_SUPPRESSION_HASH_KEY = process.env.OWNER_SUPPRESSION_HASH_KEY ?? "built-schema-test-key-0001";
  const { db, pool } = await import("../../server/db");
  const { createHash } = await import("node:crypto");
  const { submitOwnerOptOut, verifyOwnerOptOut, decideOwnerDeletion, runOwnerOptOutDeadlineCheck } = await import(
    "../../server/services/trust/ownerOptOut"
  );
  const { ownerContactRefusal } = await import("../../server/services/trust/ownerSuppression");
  const { storage } = await import("../../server/storage");
  const giving = await import("../../server/services/trust/givingService");
  const { clock } = await import("../../server/utils/clock");

  const tag = `w5a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const orgIds: number[] = [];
  const requestIds: number[] = [];
  const email = `${tag}@example.com`;
  const phone = `423${String(Date.now()).slice(-7)}`;

  try {
    const mkOrg = async (suffix: string, extra: Record<string, unknown> = {}) => {
      const [o] = await db
        .insert(organizations)
        .values({ name: `${tag}-${suffix}`, slug: `${tag}-${suffix}`, ownerId: `${tag}-owner-${suffix}`, ...extra })
        .returning({ id: organizations.id });
      orgIds.push(o.id);
      return o.id;
    };
    const orgA = await mkOrg("a");
    const orgB = await mkOrg("b");
    const orgC = await mkOrg("c");
    const [leadA] = await db.insert(leads).values({ organizationId: orgA, firstName: "Jane", lastName: "Owner", email: email.toUpperCase() }).returning();
    const [leadB] = await db
      .insert(leads)
      .values({ organizationId: orgB, firstName: "J", lastName: "Owner", address: "123 North Main Street", zip: "37402-1111" })
      .returning();
    const [other] = await db.insert(leads).values({ organizationId: orgB, firstName: "Not", lastName: "Her", email: `other-${email}` }).returning();

    // ── 1. submit ────────────────────────────────────────────────────────
    const sub = await submitOwnerOptOut({ email, phone, addressLine1: "123 N. Main St", zip: "37402", wantsDeletion: true, verification: "email" });
    check(sub.ok, "a request with an email, a phone and an address is accepted");
    if (!sub.ok) throw new Error(sub.reason);
    const [req] = await db.select().from(ownerOptOutRequests).where(eq(ownerOptOutRequests.publicRef, sub.ref));
    requestIds.push(req.id);
    const matchedOrgs = req.orgMatches.map((m) => m.organizationId).sort();
    check(JSON.stringify(matchedOrgs) === JSON.stringify([orgA, orgB].sort()), "matching leads were found in BOTH orgs (email in one, address in the other)");
    check(!req.orgMatches.some((m) => m.leadIds.includes(other.id)), "a lead that is not the owner was not matched");
    check(req.identifierHashes.length === 3 && !JSON.stringify(req).includes(email) && !JSON.stringify(req).includes(phone), "only keyed hashes are stored — no plaintext email or phone in the row");
    check(Math.round((req.dueAt.getTime() - req.receivedAt.getTime()) / 86_400_000) === 45, "the statutory window is 45 days from receipt");
    check((await ownerContactRefusal("email", { email })) === null, "nothing is suppressed before the owner confirms");

    // ── 2. confirm (the emailed token is replaced by one this script knows) ──
    const token = `${tag}-token`;
    await db.update(ownerOptOutRequests).set({ verificationSecretHash: createHash("sha256").update(token).digest("hex") }).where(eq(ownerOptOutRequests.id, req.id));
    check(!(await verifyOwnerOptOut(sub.ref, "wrong-token")).ok, "a wrong token is refused");
    const v = await verifyOwnerOptOut(sub.ref, token);
    check(v.ok && v.status === "verified", "the right token confirms the request");
    const supp = await db.select().from(ownerSuppressions).where(eq(ownerSuppressions.requestId, req.id));
    check(supp.length === 3 && supp.every((s) => /^[0-9a-f]{64}$/.test(s.identifierHash)), "three suppressions written, each a keyed hash");
    const [a1] = await db.select().from(leads).where(eq(leads.id, leadA.id));
    const [b1] = await db.select().from(leads).where(eq(leads.id, leadB.id));
    const [o1] = await db.select().from(leads).where(eq(leads.id, other.id));
    check(a1.doNotContact === true && b1.doNotContact === true && !!a1.optOutDate, "the owner's leads are do-not-contact in BOTH orgs, immediately");
    check(o1.doNotContact !== true, "an unrelated lead in the same org is untouched");
    const notes = await db.select().from(notifications).where(inArray(notifications.organizationId, [orgA, orgB]));
    check(notes.length === 2 && notes.every((n) => n.type === "system_alert"), "each org's owner was told a lead was suppressed");

    // ── 3. the guard and a later import, through real tables ────────────
    check(/stop all contact/.test((await ownerContactRefusal("sms", { phone: `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}` })) ?? ""), "the guard refuses the owner's phone, typed differently");
    check(/stop all contact/.test((await ownerContactRefusal("mail", { addressLine1: "123 north main street", zip: "37402" })) ?? ""), "the guard refuses the owner's mailing address");
    const [imported] = await storage.createLeadsBatch([{ organizationId: orgC, firstName: "Jane", lastName: "O", phone } as never]);
    check(imported.doNotContact === true, "a list imported LATER into a third org arrives do-not-contact");

    // ── 4. erasure is the founder's, per org ────────────────────────────
    const delA = await decideOwnerDeletion(req.id, orgA, true, null);
    check(delA.ok && delA.rowsErased === 1, "the founder's approval erases org A's record");
    const [a2] = await db.select().from(leads).where(eq(leads.id, leadA.id));
    check(a2.email === null && a2.firstName === "Deleted" && a2.deletedAt !== null, "org A's lead lost its personal fields");
    const delB = await decideOwnerDeletion(req.id, orgB, false, "legal hold");
    check(delB.ok, "the founder may decline for org B");
    const [b2] = await db.select().from(leads).where(eq(leads.id, leadB.id));
    check(b2.address !== null && b2.doNotContact === true, "org B's lead is kept and still suppressed");
    const [req2] = await db.select().from(ownerOptOutRequests).where(eq(ownerOptOutRequests.id, req.id));
    check(req2.status === "completed" && !!req2.completedAt, "the request completes once every org is ruled on");
    check(!(await decideOwnerDeletion(req.id, orgA, true, null)).ok, "a ruled org cannot be ruled again");

    // ── 5. the statutory clock ──────────────────────────────────────────
    const sub2 = await submitOwnerOptOut({ email: `late-${email}`, wantsDeletion: true, verification: "email" });
    if (!sub2.ok) throw new Error(sub2.reason);
    const [late] = await db.select().from(ownerOptOutRequests).where(eq(ownerOptOutRequests.publicRef, sub2.ref));
    requestIds.push(late.id);
    await db
      .update(ownerOptOutRequests)
      .set({ status: "verified", dueAt: new Date(clock.nowMs() + 5 * 86_400_000), verificationExpiresAt: new Date(clock.nowMs() + 86_400_000) })
      .where(eq(ownerOptOutRequests.id, late.id));
    const first = await runOwnerOptOutDeadlineCheck();
    const [late2] = await db.select().from(ownerOptOutRequests).where(eq(ownerOptOutRequests.id, late.id));
    check(first.alerted >= 1 && !!late2.deadlineAlertedAt, "a request 5 days from its deadline raises a founder card");
    await runOwnerOptOutDeadlineCheck();
    const [late3] = await db.select().from(ownerOptOutRequests).where(eq(ownerOptOutRequests.id, late.id));
    check(late3.deadlineAlertedAt?.getTime() === late2.deadlineAlertedAt?.getTime(), "…and not again the same day");

    // ── 6–7. giving ─────────────────────────────────────────────────────
    const paid = { subscriptionTier: "pro", subscriptionStatus: "active", stripeSubscriptionId: "sub_x" };
    await mkOrg("p1", { ...paid, settings: { givingArea: { state: "TN", county: "Hamilton" } } });
    const p2 = await mkOrg("p2", { ...paid, settings: { givingArea: { state: "tn", county: "Hamilton County" } } });
    await mkOrg("p3", { ...paid });
    await mkOrg("p4", { ...paid, settings: { givingArea: { state: "TN", county: "Zzunmapped" } } });
    await mkOrg("free", { subscriptionTier: "free", settings: { givingArea: { state: "TN", county: "Hamilton" } } });
    await giving.upsertFoodBank({ state: "TN", county: "Hamilton County", name: `${tag} Food Bank`, website: null });
    const month = await giving.computeGivingMonth();
    const [m] = await db.select().from(givingMonths).where(eq(givingMonths.month, month.month));
    const hamilton = m.lines.find((l) => l.county === "Hamilton" && l.state === "TN");
    const unmapped = m.lines.find((l) => l.county === "Zzunmapped");
    check(!!hamilton && hamilton.members === 2 && hamilton.cents === hamilton.members * 100, "Hamilton's paid members pledge $1 each (the free org is not counted)");
    check(!!unmapped && unmapped.cents === 0 && unmapped.foodBankId === null, "an unmapped county is counted, never pledged");
    check(m.membersWithoutCounty >= 1, "a member with no county is counted as such");
    check(m.status === "awaiting_founder", "nothing is approved by the job");
    const [capRow] = await db.select().from(platformSettings).where(eq(platformSettings.key, "giving.monthly_cap_cents"));
    const priorCap = capRow ? capRow.value : undefined;
    if (capRow) await db.delete(platformSettings).where(eq(platformSettings.id, capRow.id));
    const noCap = await giving.approveGivingMonth({ monthId: m.id, amountCents: m.pledgeCents, approverIsFounder: true, founderId: tag });
    check(!noCap.ok && /cap/i.test(noCap.reason), "with no cap set, nothing can be approved");
    await giving.setGivingCapCents(Math.max(0, m.pledgeCents - 1), tag);
    const overCap = await giving.approveGivingMonth({ monthId: m.id, amountCents: m.pledgeCents, approverIsFounder: true, founderId: tag });
    check(!overCap.ok, "an approval over the cap is refused");
    const notFounder = await giving.approveGivingMonth({ monthId: m.id, amountCents: 1, approverIsFounder: false, founderId: tag });
    check(!notFounder.ok, "a non-founder cannot approve");
    await giving.setGivingCapCents(m.pledgeCents, tag);
    const ok = await giving.approveGivingMonth({ monthId: m.id, amountCents: m.pledgeCents, approverIsFounder: true, founderId: tag });
    check(ok.ok, "the founder approves within the cap");
    const [panelBefore] = [await giving.memberGivingPanelFor(p2)];
    check(panelBefore.state === "nothing_yet" && panelBefore.givenCents === 0, "approved is not given: the member sees nothing until a receipt");
    const fb = (await db.select().from(givingFoodBanks).where(like(givingFoodBanks.name, `${tag}%`)))[0];
    const tooMuch = await giving.recordGivingReceipt({ month: m.month, foodBankId: fb.id, amountCents: m.pledgeCents + 1, reference: "R-1", receiptUrl: null, paidOn: "2026-10-11", founderId: tag });
    check(!tooMuch.ok, "a receipt over the approved amount is refused");
    const rc = await giving.recordGivingReceipt({ month: m.month, foodBankId: fb.id, amountCents: hamilton!.cents, reference: "R-2", receiptUrl: null, paidOn: "2026-10-11", founderId: tag });
    check(rc.ok, "the receipt is recorded");
    const panel = await giving.memberGivingPanelFor(p2);
    check(panel.state === "given" && panel.givenCents === hamilton!.cents && panel.receiptReference === "R-2" && panel.asOf === "2026-10-11", "the member panel shows exactly the receipted amount, its date and reference");

    // restore the founder's cap as it was
    const [capNow] = await db.select().from(platformSettings).where(eq(platformSettings.key, "giving.monthly_cap_cents"));
    if (priorCap === undefined) await db.delete(platformSettings).where(eq(platformSettings.id, capNow.id));
    else await db.update(platformSettings).set({ value: priorCap }).where(eq(platformSettings.id, capNow.id));
    await db.delete(givingReceipts).where(eq(givingReceipts.foodBankId, fb.id));
    await db.delete(givingMonths).where(eq(givingMonths.id, m.id));
    await db.delete(givingFoodBanks).where(eq(givingFoodBanks.id, fb.id));
  } finally {
    await db.delete(decisionsInboxItems).where(sql`${decisionsInboxItems.contextBundle}->>'directCardSubject' like '%owner deletion request%' or ${decisionsInboxItems.contextBundle}->>'directCardSubject' like 'Giving pledge for %'`);
    if (requestIds.length) {
      await db.delete(ownerSuppressions).where(inArray(ownerSuppressions.requestId, requestIds));
      await db.delete(ownerOptOutRequests).where(inArray(ownerOptOutRequests.id, requestIds));
    }
    if (orgIds.length) {
      await db.delete(notifications).where(inArray(notifications.organizationId, orgIds));
      await db.delete(leads).where(inArray(leads.organizationId, orgIds));
      await db.execute(sql`delete from activity_log where organization_id in (${sql.join(orgIds.map((i) => sql`${i}`), sql`, `)})`);
      await db.delete(organizations).where(and(inArray(organizations.id, orgIds)));
    }
    await pool.end().catch(() => {});
  }
  if (failures.length) {
    console.error(`[trust-on-built-schema] ${failures.length} failure(s)`);
    process.exit(1);
  }
  console.log("[trust-on-built-schema] PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error("[trust-on-built-schema] crashed:", err);
  process.exit(1);
});
