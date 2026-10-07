/**
 * tests/db/soleneStage2OnBuiltSchema.ts — do Stage 2's founder controls,
 * ask fold, panic-stop restore, Support reply hand and ops watch read and
 * write what they claim, on a database built from this repository?
 *
 *     DATABASE_URL=postgres://… npx tsx tests/db/soleneStage2OnBuiltSchema.ts
 *
 * Proves, by reading the rows (never a reply text):
 *   - "stop spending money on ads" through the CHAT TOOL turns the ad switch
 *     off, rejects every pending run_ad_campaign action and cancels a queued
 *     ad-move dispatch — and resume turns the switch back on;
 *   - pausing a domain records it and cancels that domain's queued dispatch,
 *     not another domain's;
 *   - two open asks with the same summary never coexist: the second folds
 *     into the first (fold_count 1, no second row);
 *   - a panic stop records the prior standing and ONE restore puts the
 *     switches and trust levels back exactly, then forgets the snapshot;
 *   - the reply_support_ticket hand writes the reply on the ticket thread;
 *   - the ops watch opens ONE incident for a sustained email outage, a second
 *     pass does not open another, and a success closes it.
 * Cleans up what it seeded. Exits non-zero on any failure and prints why.
 */
import { and, eq, inArray, like, sql } from "drizzle-orm";
import {
  agentLlmTraces,
  autopilotPendingActions,
  autopilotSenses,
  autopilotSettings,
  creditTransactions,
  domainAutonomyLevels,
  incidents,
  jobHealthLogs,
  organizations,
  supportTicketMessages,
  supportTickets,
  systemAlerts,
} from "@shared/schema";
import { soleneDispatchQueue } from "@shared/schema/solene-dispatch";
import { soleneFounderAsks } from "@shared/schema/solene-founder-collab";
import { witnessGrants } from "@shared/schema/autopilot-witness-grants";
import { db, pool } from "../../server/db";

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`[stage2-on-built-schema] ${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

async function main(): Promise<void> {
  // The panic stop and the ops watch PAGE. This check must never reach a real
  // pager: with NODE_ENV=production and no SOLENE_PAGE_TOPIC the push channel
  // refuses (pageTopic → null), and with no FOUNDER_EMAIL there is no email
  // fallback. The page events are still recorded — that is all this reads.
  process.env.NODE_ENV = "production";
  delete process.env.SOLENE_PAGE_TOPIC;
  delete process.env.FOUNDER_EMAIL;
  if (!process.env.DATABASE_URL) {
    console.error("[stage2-on-built-schema] DATABASE_URL not set — this needs a real, built database.");
    process.exit(1);
  }
  const tag = `stage2-${process.pid}-${Date.now()}`;
  const [savedSettings] = await db.select().from(autopilotSettings).where(eq(autopilotSettings.id, 1));
  const savedLevels = await db.select().from(domainAutonomyLevels);
  const dispatchIds: number[] = [];
  const pendingIds: number[] = [];
  const extraOrgIds: number[] = [];
  const grantIds: number[] = [];
  let orgId: number | null = null;
  try {
    const { executeBusinessChatTool } = await import("../../server/services/solene/chat/businessTools");

    // ── the ad switch, through the chat tool ──────────────────────────────
    const [pa] = await db
      .insert(autopilotPendingActions)
      .values({ handName: "run_ad_campaign", args: { platform: "meta", daily_budget_cents: 2000 }, contentHash: tag, status: "pending", expiresAt: new Date(Date.now() + 3_600_000) })
      .returning({ id: autopilotPendingActions.id });
    pendingIds.push(pa.id);
    const enq = async (sourceId: string) => {
      const [d] = await db
        .insert(soleneDispatchQueue)
        .values({ sourceType: "auto_dispatch", sourceId, agentRole: "soren", promptText: tag, enqueuedBy: tag, status: "queued", maxCostUsd: "1", timeoutMs: 60_000 })
        .returning({ id: soleneDispatchQueue.id });
      dispatchIds.push(d.id);
      return d.id;
    };
    const adDispatch = await enq("autopilot:buy_meta_ads_2000");
    const growthDispatch = await enq("autopilot:grow_owned_channels");
    const supportDispatch = await enq("autopilot:clear_support_backlog");

    // M3: a campaign the founder launched himself is NOT paused by the switch — the reply must say so.
    const { growthCampaigns } = await import("@shared/schema");
    const [ownCampaign] = await db.insert(growthCampaigns).values({ name: `${tag}-own`, templateKey: "land_investors_signup", status: "active", dailyBudgetCents: 2500 }).returning({ id: growthCampaigns.id });
    const stop = await executeBusinessChatTool("pause", { target: "ads" }, tag);
    check(stop.ok, `chat "pause ads" answered ok (${stop.text})`);
    check(/NOT paused: 1 campaign/.test(stop.text) && stop.text.includes(`${tag}-own`) && !/Ad spending is OFF/.test(stop.text), "the reply names the founder's own still-active campaign instead of claiming all ad spending is off");
    await db.delete(growthCampaigns).where(eq(growthCampaigns.id, ownCampaign.id));
    const [s1] = await db.select({ ads: autopilotSettings.adsEnabled }).from(autopilotSettings).where(eq(autopilotSettings.id, 1));
    check(s1?.ads === false, "ad switch is OFF in autopilot_settings");
    const [pa2] = await db.select({ status: autopilotPendingActions.status }).from(autopilotPendingActions).where(eq(autopilotPendingActions.id, pa.id));
    check(pa2?.status === "rejected", "the pending run_ad_campaign action was rejected");
    const rowStatus = async (id: number) => (await db.select({ s: soleneDispatchQueue.status }).from(soleneDispatchQueue).where(eq(soleneDispatchQueue.id, id)))[0]?.s;
    check((await rowStatus(adDispatch)) === "cancelled", "the queued ad-move dispatch was cancelled");
    check((await rowStatus(growthDispatch)) === "queued", "a non-ad growth dispatch was left alone");
    const { getControlState, moveBlockedByControls } = await import("../../server/services/autopilot/founderControls");
    check(moveBlockedByControls({ domain: "growth", kind: "buy_meta_ads_2000", rationale: "Meta ads" }, await getControlState()) != null, "the tick would now skip an ad move");
    const unconfirmed = await executeBusinessChatTool("resume", { target: "ads" }, tag);
    const [s1b] = await db.select({ ads: autopilotSettings.adsEnabled }).from(autopilotSettings).where(eq(autopilotSettings.id, 1));
    check(!unconfirmed.ok && s1b?.ads === false, "resume ads WITHOUT the founder's confirmation changes nothing");
    const resume = await executeBusinessChatTool("resume", { target: "ads" }, tag, { confirmed: true });
    const [s2] = await db.select({ ads: autopilotSettings.adsEnabled }).from(autopilotSettings).where(eq(autopilotSettings.id, 1));
    check(resume.ok && s2?.ads === true, "a confirmed resume ads turns the switch back on");

    // ── pause a domain ────────────────────────────────────────────────────
    await executeBusinessChatTool("pause", { target: "growth" }, tag);
    check((await getControlState()).pausedDomains.includes("growth"), "growth is recorded as paused");
    check((await rowStatus(growthDispatch)) === "cancelled", "growth's queued dispatch was cancelled");
    check((await rowStatus(supportDispatch)) === "queued", "support's queued dispatch was not touched");
    await executeBusinessChatTool("resume", { target: "growth" }, tag);
    check(!(await getControlState()).pausedDomains.includes("growth"), "resume growth lifts the pause");

    // ── H2: a pause reaches what is already DRAFTED in the domain ──────────
    {
      await import("../../server/services/autopilot/hands");
      const exp = new Date(Date.now() + 3_600_000);
      const mk = async (handName: string, domain: string | null, h: string) =>
        (await db.insert(autopilotPendingActions).values({ handName, args: { tag }, contentHash: `${tag}-${h}`, domain, sourceRole: "retention", status: "pending", expiresAt: exp }).returning({ id: autopilotPendingActions.id }))[0].id;
      const email = await mk("send_email", "retention", "pe"); // a seam-labelled support-domain hand
      const reply = await mk("reply_support_ticket", "support", "pr");
      const refund = await mk("apply_refund", "finance", "pf");
      pendingIds.push(email, reply, refund);
      const { setPaused } = await import("../../server/services/autopilot/founderControls");
      const pr = await setPaused("support", true, tag);
      const st = async (id: number) => (await db.select({ s: autopilotPendingActions.status }).from(autopilotPendingActions).where(eq(autopilotPendingActions.id, id)))[0]?.s;
      check((await st(email)) === "rejected" && (await st(reply)) === "rejected", `pausing support rejected its drafted actions (rejected ${pr.pendingActionsRejected.length})`);
      check((await st(refund)) === "pending", "a finance draft was not touched by a support pause");
      await setPaused("support", false, tag);
    }

    // ── S13 fold ──────────────────────────────────────────────────────────
    const { askFounder } = await import("../../server/services/solene/founderCollab");
    const summary = `${tag} Review a drafted growth action`;
    const a1 = await askFounder({ askingAgentRole: "soren", questionSummary: summary, questionBody: "body v1 (forecast 40%)", answerFormat: "yes_no", urgency: "low" });
    const a2 = await askFounder({ askingAgentRole: "soren", questionSummary: summary, questionBody: "body v2 (forecast 41%)", answerFormat: "yes_no", urgency: "low" });
    const open = await db.select().from(soleneFounderAsks).where(and(eq(soleneFounderAsks.questionSummary, summary), eq(soleneFounderAsks.status, "open")));
    check(a1.askId === a2.askId && open.length === 1, `the repeat folded into ask #${a1.askId} (open rows with that summary: ${open.length})`);
    check(open[0]?.foldCount === 1 && open[0]?.questionBody === "body v2 (forecast 41%)", "fold_count is 1 and the body carries the newest facts");
    await db.delete(soleneFounderAsks).where(eq(soleneFounderAsks.questionSummary, summary));

    // ── S10 panic stop → one-confirm restore ──────────────────────────────
    const { setAutopilotSetting } = await import("../../server/services/autopilot/settings");
    const { setDomainLevel, ensureDomainsSeeded } = await import("../../server/services/autopilot/domainAutonomy");
    await ensureDomainsSeeded();
    await setAutopilotSetting("dispatchEnabled", true, tag);
    await setAutopilotSetting("publishEnabled", true, tag);
    await setAutopilotSetting("cognitionEnabled", false, tag);
    await setDomainLevel("growth", "execute_gated", tag);
    await setDomainLevel("support", "draft", tag);
    // H2: a stop reaches drafted actions and delegations too.
    const { issueWitnessGrant: issueG } = await import("../../server/services/autopilot/witnessGrantStore");
    const liveGrant = await issueG({ grantorId: tag, granteeId: "solene", domains: ["support"], hands: ["reply_support_ticket"], sourceRoles: ["support"], maxCostUsd: 1, maxActions: 5, expiresAt: new Date(Date.now() + 86_400_000), note: tag });
    grantIds.push(liveGrant.id);
    const [stopPending] = await db.insert(autopilotPendingActions).values({ handName: "reply_support_ticket", args: { tag }, contentHash: `${tag}-ps`, domain: "support", sourceRole: "support", status: "pending", expiresAt: new Date(Date.now() + 3_600_000) }).returning({ id: autopilotPendingActions.id });
    pendingIds.push(stopPending.id);
    const { panicStop } = await import("../../server/services/autopilot/panicStop");
    await panicStop({ reason: tag, by: tag });
    const [psRow] = await db.select({ s: autopilotPendingActions.status }).from(autopilotPendingActions).where(eq(autopilotPendingActions.id, stopPending.id));
    const [gRow] = await db.select({ revoked: witnessGrants.revoked }).from(witnessGrants).where(eq(witnessGrants.id, liveGrant.id));
    check(psRow?.s === "rejected", "the panic stop rejected every drafted action");
    check(gRow?.revoked === true, "the panic stop revoked every live delegation");
    const lv = async () => Object.fromEntries((await db.select().from(domainAutonomyLevels)).map((r) => [r.domain, r.level]));
    const afterStop = await lv();
    check(afterStop.growth === "observe" && afterStop.support === "observe", "the stop quarantined every domain");
    const { restorePriorStanding } = await import("../../server/services/autopilot/guidedResume");
    const r = await restorePriorStanding(tag);
    const after = await lv();
    const { getEffectiveSettings, __resetSettingsCacheForTest } = await import("../../server/services/autopilot/settings");
    __resetSettingsCacheForTest();
    const st = await getEffectiveSettings();
    check(r.done, `one restore confirm reported done (${r.narration.slice(0, 120)})`);
    check(after.growth === "execute_gated" && after.support === "draft", `levels restored exactly (growth=${after.growth}, support=${after.support})`);
    check(st.dispatchEnabled && st.publishEnabled && !st.cognitionEnabled, "switches restored exactly (dispatch on, publish on, cognition off)");
    const again = await restorePriorStanding(tag);
    check(!again.done, "the snapshot is single-use (a second restore does nothing)");
    // LOW: a manual resume (the founder turns dispatch back on himself) forgets the snapshot.
    await panicStop({ reason: `${tag}-2`, by: tag });
    const { readPreStopSnapshot, setSwitchByFounder } = await import("../../server/services/autopilot/founderControls");
    check((await readPreStopSnapshot()) != null, "a second stop recorded a snapshot");
    await setSwitchByFounder("dispatchEnabled", true, tag);
    check((await readPreStopSnapshot()) == null, "turning dispatch back on by hand forgets the stale pre-stop snapshot");

    // ── reply_support_ticket hand ─────────────────────────────────────────
    const [o] = await db.insert(organizations).values({ name: tag, slug: tag, ownerId: tag }).returning({ id: organizations.id });
    orgId = o.id;
    const [t] = await db
      .insert(supportTickets)
      .values({ organizationId: o.id, userId: tag, subject: tag, description: "How do I import leads?", status: "open", resolutionType: "escalated" })
      .returning({ id: supportTickets.id });
    await import("../../server/services/autopilot/hands");
    const { executeHandWitnessed } = await import("../../server/services/autopilot/hands/registry");
    const hr = await executeHandWitnessed("reply_support_ticket", { ticket_id: t.id, organization_id: o.id, message: "Go to Deals → Import and upload the CSV.", resolve: true }, `${tag}-founder`);
    const msgs = await db.select().from(supportTicketMessages).where(eq(supportTicketMessages.ticketId, t.id));
    const [t2] = await db.select({ status: supportTickets.status }).from(supportTickets).where(eq(supportTickets.id, t.id));
    check(hr.success && msgs.some((m) => m.role === "agent" && /Import/.test(m.content)), `the reply landed on the ticket thread (${hr.output.slice(0, 120)})`);
    check(t2?.status === "resolved", "resolve=true resolved the ticket");

    // ── the Support worker's tools: what a model must never choose freely ──
    {
      const tools = await import("../../server/services/solene/roleWorkers/tools");
      await db.insert(creditTransactions).values({ organizationId: o.id, type: "purchase", amountCents: 3000, balanceAfterCents: 3000, description: tag, stripePaymentIntentId: `pi_${tag}` });
      const [t3] = await db
        .insert(supportTickets)
        .values({ organizationId: o.id, userId: tag, subject: `${tag} refund`, description: "Please refund my $30 pack.", status: "open", resolutionType: "escalated" })
        .returning({ id: supportTickets.id });
      // The run is bound to the ONE ticket its briefing named (audit M2).
      const ctx = { dispatchId: 0, ticketId: t3.id, organizationId: o.id };
      const foreignTicket = await tools.executeRoleTool("support", "list_recent_purchases", { ticket_id: t.id }, ctx);
      check(!foreignTicket.success && /only/.test(foreignTicket.output), "a Support tool call naming a ticket the run was not briefed on is refused");
      const refunds = async () => (await db.select().from(autopilotPendingActions).where(eq(autopilotPendingActions.handName, "apply_refund"))).filter((r) => (r.args as { charge_id?: string }).charge_id === `pi_${tag}`);
      const big = await tools.executeRoleTool("support", "refund_purchase", { ticket_id: t3.id, payment_intent_id: `pi_${tag}`, amount_cents: 200000, reason: "x" }, ctx);
      check(!big.success && (await refunds()).length === 0, `a $2,000 refund is refused before anything is drafted (${big.output.slice(0, 80)})`);
      // An $80 purchase exists, so only the $50 ceiling stands between the model and an $80 refund.
      await db.insert(creditTransactions).values({ organizationId: o.id, type: "purchase", amountCents: 8000, balanceAfterCents: 11000, description: tag, stripePaymentIntentId: `pi_${tag}_80` });
      const over = await tools.executeRoleTool("support", "refund_purchase", { ticket_id: t3.id, payment_intent_id: `pi_${tag}_80`, amount_cents: 8000, reason: "x" }, ctx);
      const anyOver = (await db.select().from(autopilotPendingActions).where(eq(autopilotPendingActions.handName, "apply_refund"))).filter((r) => (r.args as { charge_id?: string }).charge_id === `pi_${tag}_80`);
      check(!over.success && anyOver.length === 0 && /\$50/.test(over.output), `an $80 refund of a real $80 purchase is refused at the $50 ceiling (${over.output.slice(0, 80)})`);
      const other = await tools.executeRoleTool("support", "refund_purchase", { ticket_id: t3.id, payment_intent_id: "pi_someone_else", amount_cents: 3000, reason: "x" }, ctx);
      check(!other.success, "a payment the ticket's org never made is refused");
      const ok = await tools.executeRoleTool("support", "refund_purchase", { ticket_id: t3.id, payment_intent_id: `pi_${tag}`, amount_cents: 3000, reason: "x" }, ctx);
      const r1 = await refunds();
      check(ok.success && r1.length === 1 && r1[0].status === "pending", "a $30 refund of the org's own purchase is drafted, frozen for its witness");
      const twice = await tools.executeRoleTool("support", "refund_purchase", { ticket_id: t3.id, payment_intent_id: `pi_${tag}`, amount_cents: 3000, reason: "again" }, ctx);
      check(!twice.success && (await refunds()).length === 1, "the same payment is never refunded twice");
      const reply = await tools.executeRoleTool("support", "reply_to_ticket", { ticket_id: t3.id, message: "Your $30 refund is being processed.", resolve: true }, ctx);
      const frozenReply = await db.select().from(autopilotPendingActions).where(eq(autopilotPendingActions.handName, "reply_support_ticket"));
      check(reply.success && frozenReply.some((r) => (r.args as { ticket_id?: number }).ticket_id === t3.id && r.status === "pending"), "a reply is FROZEN for its witness, not sent by the model");
      const fake = await tools.executeRoleTool("support", "reply_to_ticket", { ticket_id: t3.id, message: "92% of our customers get refunds within a day.", resolve: true }, ctx);
      check(!fake.success, "an invented statistic in a reply is refused by the honesty screen");
      await db.delete(autopilotPendingActions).where(inArray(autopilotPendingActions.handName, ["apply_refund", "reply_support_ticket"]));
      await db.delete(supportTickets).where(eq(supportTickets.id, t3.id));
      await db.delete(creditTransactions).where(eq(creditTransactions.organizationId, o.id));
    }

    // ── H1/M4: the refund rules live INSIDE apply_refund, whoever witnessed it ──
    {
      // No Stripe credentials in this check: every refusal below must happen
      // before Stripe, and an eligible refund fails AT Stripe and must then
      // put everything back.
      delete process.env.STRIPE_SECRET_KEY;
      const { executeHandWitnessed } = await import("../../server/services/autopilot/hands/registry");
      const [other] = await db.insert(organizations).values({ name: `${tag}-other`, slug: `${tag}-other`, ownerId: `${tag}-other` }).returning({ id: organizations.id });
      extraOrgIds.push(other.id);
      await db.update(organizations).set({ creditBalance: "3000" }).where(eq(organizations.id, o.id));
      const pi = `pi_${tag}_rf`;
      await db.insert(creditTransactions).values({ organizationId: o.id, type: "purchase", amountCents: 3000, balanceAfterCents: 3000, description: tag, stripePaymentIntentId: pi });
      // The autopilot's claim on a payment is its 'purchase_refund' row.
      const claims = async () => db.select().from(creditTransactions).where(and(eq(creditTransactions.stripePaymentIntentId, pi), eq(creditTransactions.type, "purchase_refund")));
      const balance = async () => Number((await db.select({ b: organizations.creditBalance }).from(organizations).where(eq(organizations.id, o.id)))[0]?.b ?? 0);
      const founder = `${tag}-founder`;

      const foreign = await executeHandWitnessed("apply_refund", { charge_id: pi, amount_cents: 1000, organization_id: other.id }, founder);
      check(!foreign.success && /not a purchase organization/.test(foreign.output) && (await claims()).length === 0, `a founder-witnessed refund of ANOTHER org's purchase is refused in the hand (${foreign.output.slice(0, 90)})`);
      const over = await executeHandWitnessed("apply_refund", { charge_id: pi, amount_cents: 3500, organization_id: o.id }, founder);
      check(!over.success && /more than the purchase cost/.test(over.output), "a refund over the purchase cost is refused in the hand");
      const noOrg = await executeHandWitnessed("apply_refund", { charge_id: pi, amount_cents: 1000 }, founder);
      check(!noOrg.success && /organization_id' is required/.test(noOrg.output), "a refund naming no organization is refused in the hand");

      // Eligible — but Stripe is unreachable here: the claim and the clawback must both be undone.
      const failed = await executeHandWitnessed("apply_refund", { charge_id: pi, amount_cents: 1000, organization_id: o.id }, founder);
      check(!failed.success && (await claims()).length === 0 && (await balance()) === 3000, `a refund that fails at Stripe releases its claim and returns the credits (${failed.output.slice(0, 80)}; balance ${await balance()})`);

      // Concurrency: five executions at once never leave a claim, a double clawback, or a lost credit.
      await Promise.all(Array.from({ length: 5 }, () => executeHandWitnessed("apply_refund", { charge_id: pi, amount_cents: 1000, organization_id: o.id }, founder)));
      check((await claims()).length === 0 && (await balance()) === 3000, `five concurrent executions end consistent (claims ${(await claims()).length}, balance ${await balance()})`);

      // ONCE, at the database: a second claim on the same payment cannot exist.
      const claimRow = { organizationId: o.id, type: "purchase_refund", amountCents: -1000, balanceAfterCents: 2000, description: tag, stripePaymentIntentId: pi };
      await db.insert(creditTransactions).values(claimRow);
      let dupRejected = false;
      try {
        await db.insert(creditTransactions).values(claimRow);
      } catch {
        dupRejected = true;
      }
      check(dupRejected, "the database refuses a second claim on the same payment (partial UNIQUE index)");
      const twice = await executeHandWitnessed("apply_refund", { charge_id: pi, amount_cents: 1000, organization_id: o.id }, founder);
      check(!twice.success && /never twice/.test(twice.output) && (await balance()) === 3000, "a payment already refunded by the autopilot is never refunded again");
      await db.delete(creditTransactions).where(and(eq(creditTransactions.stripePaymentIntentId, pi), eq(creditTransactions.type, "purchase_refund")));

      // An UNCERTAIN refund is listed for the Decisions door.
      const [unc] = await db.insert(creditTransactions).values({ organizationId: o.id, type: "purchase_refund", amountCents: -1000, balanceAfterCents: 2000, description: tag, stripePaymentIntentId: `${pi}_unc`, metadata: { state: "uncertain", uncertainBecause: "timeout" } }).returning({ id: creditTransactions.id });
      const { listUncertainRefunds } = await import("../../server/services/autopilot/hands/apply-refund");
      check((await listUncertainRefunds()).some((r) => r.id === unc.id && r.why === "timeout"), "an uncertain refund is listed for the founder's Decisions door");
      await db.delete(creditTransactions).where(eq(creditTransactions.id, unc.id));

      // An INTERRUPTED refund (process died between claim and outcome) surfaces
      // after 10 minutes; a fresh claim does not; the founder resolves one,
      // recorded, and the payment is still never refunded again.
      const piInt = `${pi}_int`;
      await db.insert(creditTransactions).values({ organizationId: o.id, type: "purchase", amountCents: 3000, balanceAfterCents: 3000, description: tag, stripePaymentIntentId: piInt });
      const [stale] = await db.insert(creditTransactions).values({ organizationId: o.id, type: "purchase_refund", amountCents: -1000, balanceAfterCents: 2000, description: tag, stripePaymentIntentId: piInt, metadata: { state: "claimed" }, createdAt: new Date(Date.now() - 15 * 60_000) }).returning({ id: creditTransactions.id });
      const [fresh] = await db.insert(creditTransactions).values({ organizationId: o.id, type: "purchase_refund", amountCents: -1000, balanceAfterCents: 2000, description: tag, stripePaymentIntentId: `${pi}_fresh`, metadata: { state: "claimed" } }).returning({ id: creditTransactions.id });
      const { resolveUncertainRefund } = await import("../../server/services/autopilot/hands/apply-refund");
      const listed = await listUncertainRefunds();
      check(listed.some((r) => r.id === stale.id && /interrupted/.test(r.why ?? "")) && !listed.some((r) => r.id === fresh.id), "a claim with no outcome after 10 minutes is listed as interrupted; a fresh claim is not");
      check(await resolveUncertainRefund(o.id, stale.id, founder, "refund seen on Stripe"), "the founder can resolve an uncertain refund");
      const [resolved] = await db.select({ metadata: creditTransactions.metadata }).from(creditTransactions).where(eq(creditTransactions.id, stale.id));
      check((resolved?.metadata as { state?: string; resolvedBy?: string } | null)?.resolvedBy === founder && !(await listUncertainRefunds()).some((r) => r.id === stale.id), "resolving is recorded (who) and removes it from the list");
      const again = await executeHandWitnessed("apply_refund", { charge_id: piInt, amount_cents: 1000, organization_id: o.id }, founder);
      check(!again.success && /never twice/.test(again.output), "a resolved payment is still never refunded again");
      await db.delete(creditTransactions).where(inArray(creditTransactions.id, [stale.id, fresh.id]));

      // Refunded OUTSIDE the autopilot (a credit_transactions refund row for the payment).
      const [outside] = await db.insert(creditTransactions).values({ organizationId: o.id, type: "refund", amountCents: 500, balanceAfterCents: 3500, description: tag, stripePaymentIntentId: pi }).returning({ id: creditTransactions.id });
      const recorded = await executeHandWitnessed("apply_refund", { charge_id: pi, amount_cents: 1000, organization_id: o.id }, founder);
      check(!recorded.success && /never twice/.test(recorded.output) && (await claims()).length === 0, "a payment refunded outside the autopilot is never refunded again");
      await db.delete(creditTransactions).where(eq(creditTransactions.id, outside.id));

      // M4: the credits were spent → refused, nothing clawed back partially.
      await db.update(organizations).set({ creditBalance: "200" }).where(eq(organizations.id, o.id));
      const spent = await executeHandWitnessed("apply_refund", { charge_id: pi, amount_cents: 1000, organization_id: o.id }, founder);
      check(!spent.success && /no longer holds/.test(spent.output) && (await balance()) === 200 && (await claims()).length === 0, `a refund of credits the org already spent is refused, balance untouched (${spent.output.slice(0, 80)})`);
      await db.update(organizations).set({ creditBalance: "3000" }).where(eq(organizations.id, o.id));

      // The auditor's case, end to end: a coding-agent-frozen refund of a FOREIGN
      // charge and a Support-frozen refund of an ALREADY-REFUNDED charge, with a
      // live finance grant that allows money → neither released, neither executed.
      const { ensureDomainsSeeded, setDomainLevel } = await import("../../server/services/autopilot/domainAutonomy");
      await ensureDomainsSeeded();
      await setDomainLevel("finance", "draft", tag);
      await setAutopilotSetting("dispatchEnabled", true, tag);
      const { issueWitnessGrant } = await import("../../server/services/autopilot/witnessGrantStore");
      const g = await issueWitnessGrant({ grantorId: founder, granteeId: "solene", domains: ["finance"], hands: ["apply_refund"], sourceRoles: ["support"], maxCostUsd: 50, maxActions: 10, expiresAt: new Date(Date.now() + 86_400_000), allowMoney: true, note: tag });
      grantIds.push(g.id);
      await db.insert(creditTransactions).values({ organizationId: other.id, type: "purchase", amountCents: 4000, balanceAfterCents: 4000, description: tag, stripePaymentIntentId: `${pi}_foreign` });
      await db.insert(creditTransactions).values({ organizationId: o.id, type: "purchase_refund", amountCents: -1000, balanceAfterCents: 2000, description: tag, stripePaymentIntentId: `${pi}_done` });
      await db.insert(creditTransactions).values({ organizationId: o.id, type: "purchase", amountCents: 3000, balanceAfterCents: 3000, description: tag, stripePaymentIntentId: `${pi}_done` });
      const exp = new Date(Date.now() + 3_600_000);
      // REAL content hashes: a fake one would make the approval path refuse on
      // hash_mismatch and hide whether the sweep tried to release at all.
      const { actionContentHash } = await import("../../server/services/approvalKernel");
      const caArgs = { charge_id: `${pi}_foreign`, amount_cents: 4000, organization_id: other.id };
      const dupArgs = { charge_id: `${pi}_done`, amount_cents: 1000, organization_id: o.id };
      const [codingAgent] = await db.insert(autopilotPendingActions).values({ handName: "apply_refund", args: caArgs, contentHash: actionContentHash("apply_refund", caArgs), domain: "finance", status: "pending", expiresAt: exp }).returning({ id: autopilotPendingActions.id });
      const [dup] = await db.insert(autopilotPendingActions).values({ handName: "apply_refund", args: dupArgs, contentHash: actionContentHash("apply_refund", dupArgs), domain: "finance", sourceRole: "support", status: "pending", expiresAt: exp }).returning({ id: autopilotPendingActions.id });
      pendingIds.push(codingAgent.id, dup.id);
      const { runAutoWitnessSweep } = await import("../../server/services/autopilot/autoWitness");
      const sweep = await runAutoWitnessSweep();
      const rows = await db.select().from(autopilotPendingActions).where(inArray(autopilotPendingActions.id, [codingAgent.id, dup.id]));
      const [gAfter] = await db.select({ used: witnessGrants.usedCount }).from(witnessGrants).where(eq(witnessGrants.id, g.id));
      const foreignClaims = await db.select().from(creditTransactions).where(and(eq(creditTransactions.stripePaymentIntentId, `${pi}_foreign`), eq(creditTransactions.type, "purchase_refund")));
      check(
        sweep.witnessed === 0 && rows.every((r) => r.status === "pending" && r.approvedBy == null) && gAfter?.used === 0 && foreignClaims.length === 0 &&
          sweep.decisions.filter((d) => d.handName === "apply_refund").every((d) => /^not released|no source role/.test(d.reason)),
        `with a live finance grant, a coding-agent refund of a foreign charge and a Support refund of an already-refunded charge are NOT released and NOT executed (${sweep.decisions.filter((d) => d.handName === "apply_refund").map((d) => d.reason.slice(0, 60)).join(" | ")})`,
      );
      await db.delete(creditTransactions).where(inArray(creditTransactions.organizationId, [o.id, other.id]));
    }

    // ── the founder's own org is never a churning customer ────────────────
    const [fo] = await db
      .insert(organizations)
      .values({ name: `${tag}-founder`, slug: `${tag}-founder`, ownerId: `${tag}-founder`, isFounder: true, subscriptionTier: "enterprise", subscriptionStatus: "active", createdAt: new Date(Date.now() - 90 * 24 * 3_600_000) })
      .returning({ id: organizations.id });
    const { churnEngine } = await import("../../server/services/churnEngine");
    await churnEngine.runForAllOrgs();
    await new Promise((r) => setTimeout(r, 500)); // recordSense is fire-and-forget
    const founderSignals = await db.select().from(autopilotSenses).where(and(eq(autopilotSenses.kind, "churn_signal"), sql`${autopilotSenses.detail}->>'org' = ${String(fo.id)}`));
    check(founderSignals.length === 0, `the founder's own org raised no churn signal (got ${founderSignals.length})`);
    await db.delete(autopilotSenses).where(sql`${autopilotSenses.detail}->>'org' = ${String(fo.id)}`);
    await db.delete(systemAlerts).where(eq(systemAlerts.organizationId, fo.id));
    await db.delete(organizations).where(eq(organizations.id, fo.id));

    // ── ops watch: one incident per outage ────────────────────────────────
    await db.delete(incidents).where(like(incidents.title, "[ops] %"));
    const now = Date.now();
    for (const m of [50, 40, 30]) {
      await db.insert(jobHealthLogs).values({ jobName: "email_send", runStartedAt: new Date(now - m * 60_000), status: "failed", errorMessage: tag });
    }
    const { runOpsWatch } = await import("../../server/services/autopilot/opsWatch");
    // the provider is still down: the probe fails, nothing closes, no second page
    const w1 = await runOpsWatch({ stripeProbe: async () => true, emailProbe: async () => false });
    const w2 = await runOpsWatch({ stripeProbe: async () => true, emailProbe: async () => false });
    const openEmail = await db.select().from(incidents).where(and(eq(incidents.title, "[ops] email_provider"), eq(incidents.status, "open")));
    check(w1.opened.includes("email_provider") && !w2.opened.includes("email_provider") && openEmail.length === 1, `ONE email incident across two passes (opened ${w1.opened.join(",")} then ${w2.opened.join(",") || "nothing"})`);
    // the provider answers again (no other email had to go out): the probe closes it
    const w3 = await runOpsWatch({ stripeProbe: async () => true, emailProbe: async () => true });
    const closed = await db.select().from(incidents).where(eq(incidents.title, "[ops] email_provider"));
    check(w3.resolved.includes("email_provider") && closed.every((c) => c.status === "resolved"), "the provider answering the probe closed the incident (no send needed)");
    // the model provider: three ticks in a row of nothing but failed calls → ONE incident
    await db.delete(agentLlmTraces);
    // as the watch sees them at the START of a tick: the newest calls are a tick old
    for (const m of [100, 70, 40]) {
      for (let i = 0; i < 2; i++) await db.insert(agentLlmTraces).values({ agentCodename: tag, purpose: "deliberation", model: "x", userPrompt: tag, response: "", error: "500 stand-in failure", createdAt: new Date(Date.now() - m * 60_000) });
    }
    const m1 = await runOpsWatch({ stripeProbe: async () => true, emailProbe: async () => true });
    check(m1.opened.includes("model_provider"), `three all-failed ticks of model calls opened the model incident (${JSON.stringify(m1.readings.find((r) => r.provider === "model_provider"))})`);
    await db.insert(agentLlmTraces).values({ agentCodename: tag, purpose: "deliberation", model: "x", userPrompt: tag, response: "ok" });
    const m2 = await runOpsWatch({ stripeProbe: async () => true, emailProbe: async () => true });
    check(m2.resolved.includes("model_provider"), "one successful model call closed it");
    await db.delete(agentLlmTraces).where(eq(agentLlmTraces.agentCodename, tag));
    await db.delete(incidents).where(like(incidents.title, "[ops] %"));
    await db.delete(jobHealthLogs).where(inArray(jobHealthLogs.jobName, ["email_send", "ops_probe:stripe"]));
    if (t) {
      await db.delete(supportTicketMessages).where(eq(supportTicketMessages.ticketId, t.id));
      await db.delete(supportTickets).where(eq(supportTickets.id, t.id));
    }
  } catch (err) {
    const e = err as { message?: string; cause?: { message?: string } };
    check(false, `threw: ${e?.cause?.message ?? e?.message ?? String(err)}`);
  } finally {
    if (dispatchIds.length) await db.delete(soleneDispatchQueue).where(inArray(soleneDispatchQueue.id, dispatchIds)).catch(() => {});
    if (pendingIds.length) await db.delete(autopilotPendingActions).where(inArray(autopilotPendingActions.id, pendingIds)).catch(() => {});
    if (orgId != null) await db.delete(organizations).where(eq(organizations.id, orgId)).catch(() => {});
    if (extraOrgIds.length) await db.delete(organizations).where(inArray(organizations.id, extraOrgIds)).catch(() => {});
    if (grantIds.length) await db.delete(witnessGrants).where(inArray(witnessGrants.id, grantIds)).catch(() => {});
    if (savedSettings) await db.update(autopilotSettings).set(savedSettings).where(eq(autopilotSettings.id, 1)).catch(() => {});
    else await db.delete(autopilotSettings).where(eq(autopilotSettings.id, 1)).catch(() => {});
    for (const l of savedLevels) await db.update(domainAutonomyLevels).set({ level: l.level, cleanCycleCount: l.cleanCycleCount }).where(eq(domainAutonomyLevels.domain, l.domain)).catch(() => {});
    await pool.end().catch(() => {});
  }
  if (failures.length) {
    console.error(`[stage2-on-built-schema] ${failures.length} FAILURE(S):\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("[stage2-on-built-schema] PASS");
}
main();
