/**
 * NOTES MONEY ON THE PUSH-BUILT DB — the post-payment flows the migration-built
 * DB cannot reach (POST /api/payments 500s there: the known partial-unique-index
 * vs bare ON CONFLICT defect). Run against a server whose DATABASE_URL is the
 * drizzle-push-built `acreos_market_push`, the way production MAY be built.
 *
 * A note investor's first quarter, through the real API, with an EXPLICIT clock
 * wherever time matters:
 *   1. note keyed in (Notes → New): $30,000 at 9% for 120 months — the app's
 *      payment vs an independent amortization ($380.03);
 *   2. installment 1 paid on time — principal/interest split vs independent;
 *   3. installment 2 missed: the registered daily job's pass
 *      (runServicedLateFeeAssessmentPass) invoked IN-PROCESS with now = due+9d
 *      (inside grace → no fee) and now = due+11d (past grace → one fee);
 *   4. a payment of installment + fee: does the fee get collected, the rest
 *      to principal?
 *   5. payoff quote (quoteServicedNotePayoff, the lender path Pax uses) vs an
 *      independent per-diem computation;
 *   6. the money views the customer reads (bookkeeping + finance portfolio
 *      summaries, delinquent list) vs the DB;
 *   7. month-end: a note whose first payment is Jan 31 — the schedule's due
 *      dates for Feb/Mar.
 * Everything that time-travels says so in its row.
 */
import { q, one, provisionOrg, msg, writeJson, DB_LABEL } from "./common";

const out: Record<string, unknown> = { db: DB_LABEL };
const r2 = (x: number) => Math.round(x * 100) / 100;
function pmt(P: number, annualPct: number, n: number) { const i = annualPct / 1200; return (P * i) / (1 - Math.pow(1 + i, -n)); }

async function main() {
  if (!/push/.test(DB_LABEL)) throw new Error(`refusing: DATABASE_URL must be the push-built DB, got ${DB_LABEL}`);
  const o = await provisionOrg("mkt-notes-push", { businessType: "note_investor", noteRole: "invest", orgName: "Push Notes" });
  await q(`UPDATE organizations SET subscription_tier='pro', credit_balance=10000, trial_ends_at=NULL WHERE id=$1`, [o.orgId]);
  await o.client.post("/api/onboarding/complete", { businessType: "note_investor", noteRole: "invest", orgName: "Push Notes", seedSampleData: false });
  const lead = await o.client.post("/api/leads", { firstName: "Ana", lastName: "Garcia", type: "buyer", phone: "+15205550111" });
  const prop = await o.client.post("/api/properties", { apn: "201-11-0001", county: "Cochise", state: "AZ", sizeAcres: "5" });

  // 1. note: first payment due on the 1st, three months ago
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  const n = await o.client.post("/api/notes", { originalPrincipal: "30000", interestRate: "9", termMonths: 120, propertyId: prop.body?.id, borrowerId: lead.body?.id, startDate: start.toISOString(), firstPaymentDate: first.toISOString(), status: "active", atrExemptionCode: "raw_land", gracePeriodDays: 10, lateFee: "25" });
  const note = await one(`SELECT * FROM notes WHERE id=$1`, [n.body?.id]);
  const indep = r2(pmt(30000, 9, 120));
  out.noteCreate = { status: n.status, msg: n.status >= 300 ? msg(n) : undefined, monthlyPayment: note?.monthly_payment, independent: indep, nextPaymentDate: note?.next_payment_date };
  console.log("note", JSON.stringify(out.noteCreate));
  if (!note) throw new Error("note not created");

  // 2. installment 1 on time
  const p1 = await o.client.post("/api/payments", { noteId: note.id, amount: String(indep), paymentMethod: "check" }, { headers: { "idempotency-key": `push-p1-${note.id}-abcdefgh` } });
  const pay1 = await one(`SELECT * FROM payments WHERE note_id=$1 ORDER BY id LIMIT 1`, [note.id]).catch(() => null);
  out.payment1 = { status: p1.status, msg: p1.status >= 300 ? msg(p1) : undefined, row: pay1 && { amount: pay1.amount, principal: pay1.principal_amount, interest: pay1.interest_amount, lateFee: pay1.late_fee_amount }, independentInterest: r2(30000 * 0.09 / 12), independentPrincipal: r2(indep - 30000 * 0.09 / 12) };
  console.log("payment1", JSON.stringify(out.payment1));

  // 3. the daily late-fee pass with an explicit clock
  const { runServicedLateFeeAssessmentPass } = await import("../../../../server/services/notes/servicedLateFees");
  const due2 = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
  const at = (d: number) => new Date(due2.getTime() + d * 864e5 + 15 * 3600e3); // 15:00 UTC
  const pass9 = await runServicedLateFeeAssessmentPass(at(9));
  const fees9 = await q(`SELECT period_start, fee_amount_cents, status FROM late_fee_assessments WHERE loan_id=$1`, [String(note.id)]);
  const pass11 = await runServicedLateFeeAssessmentPass(at(11));
  const fees11 = await q(`SELECT period_start, fee_amount_cents, status FROM late_fee_assessments WHERE loan_id=$1`, [String(note.id)]);
  out.lateFees = { clock: "runServicedLateFeeAssessmentPass(now) invoked in-process with explicit now", due2: due2.toISOString().slice(0, 10), at9: { now: at(9).toISOString(), pass: pass9, fees: fees9 }, at11: { now: at(11).toISOString(), pass: pass11, fees: fees11 } };
  console.log("lateFees", JSON.stringify(out.lateFees));

  // 4. installment + fee
  const p2 = await o.client.post("/api/payments", { noteId: note.id, amount: String(r2(indep + 25)), paymentMethod: "check" }, { headers: { "idempotency-key": `push-p2-${note.id}-abcdefgh` } });
  const pays = await q(`SELECT amount, principal_amount, interest_amount, late_fee_amount FROM payments WHERE note_id=$1 ORDER BY id`, [note.id]);
  const feesAfter = await q(`SELECT fee_amount_cents, status FROM late_fee_assessments WHERE loan_id=$1`, [String(note.id)]);
  out.payment2 = { status: p2.status, msg: p2.status >= 300 ? msg(p2) : undefined, payments: pays, feesAfter, noteAfter: await one(`SELECT current_balance, status, next_payment_date FROM notes WHERE id=$1`, [note.id]) };
  console.log("payment2", JSON.stringify(out.payment2));

  // 5. payoff quote (lender path), good through 10 days from now
  try {
    const { quoteServicedNotePayoff } = await import("../../../../server/services/notes/servicedNotePayoff");
    const fresh = await import("../../../../server/storage").then((m: any) => m.storage.getNote(o.orgId, note.id));
    const payoffDate = new Date(Date.now() + 10 * 864e5);
    const { quote } = await quoteServicedNotePayoff({ note: fresh, payoffDate, lenderTimeZone: "America/Phoenix", channel: "lender" as any, payerName: "Ana Garcia", quotedByUserId: null, provenance: "market-sim" });
    const bal = Number((await one(`SELECT current_balance FROM notes WHERE id=$1`, [note.id])).current_balance);
    out.payoff = { quote, independentBalance: bal, independentPerDiem: r2((bal * 0.09) / 365) };
  } catch (e) { out.payoff = { error: String(e).slice(0, 300) }; }
  console.log("payoff", JSON.stringify(out.payoff).slice(0, 600));

  // 6. money views
  const y = new Date().getUTCFullYear();
  const views: Record<string, unknown> = {};
  for (const p of [`/api/bookkeeping/portfolio-summary?year=${y}`, "/api/finance/portfolio-summary", "/api/notes/delinquent", `/api/notes/${note.id}/schedule`]) {
    const r = await o.client.get(p);
    views[p] = { status: r.status, hasNaN: /NaN/.test(r.text), body: r.text.slice(0, 700) };
  }
  out.views = views;
  const dbTruth = await one(`SELECT coalesce(sum(interest_amount::numeric),0) interest, coalesce(sum(principal_amount::numeric),0) principal, coalesce(sum(late_fee_amount::numeric),0) fees, count(*)::int n FROM payments WHERE note_id=$1`, [note.id]);
  out.dbTruth = dbTruth;
  console.log("views", JSON.stringify(Object.fromEntries(Object.entries(views).map(([k, v]: any) => [k, `${v.status} NaN=${v.hasNaN} ${v.body.slice(0, 220)}`]))), "db", JSON.stringify(dbTruth));

  // 7. month-end due dates
  const me = await o.client.post("/api/notes", { originalPrincipal: "12000", interestRate: "10", termMonths: 24, propertyId: prop.body?.id, borrowerId: lead.body?.id, startDate: "2026-12-31T00:00:00.000Z", firstPaymentDate: "2027-01-31T00:00:00.000Z", status: "active", atrExemptionCode: "raw_land", gracePeriodDays: 10, lateFee: "25" });
  const sched = me.body?.id ? await o.client.get(`/api/notes/${me.body.id}/schedule`) : null;
  out.monthEnd = { status: me.status, msg: me.status >= 300 ? msg(me) : undefined, firstDueDates: (sched?.body?.schedule ?? []).slice(0, 5).map((s: any) => s.dueDate) };
  console.log("monthEnd", JSON.stringify(out.monthEnd));

  writeJson("notes-money-push.json", out);
  process.exit(0);
}
main().catch((e) => { console.error(e); writeJson("notes-money-push.json", { ...out, crash: String(e).slice(0, 400) }); process.exit(2); });
