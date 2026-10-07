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

    const stop = await executeBusinessChatTool("pause", { target: "ads" }, tag);
    check(stop.ok, `chat "pause ads" answered ok (${stop.text})`);
    const [s1] = await db.select({ ads: autopilotSettings.adsEnabled }).from(autopilotSettings).where(eq(autopilotSettings.id, 1));
    check(s1?.ads === false, "ad switch is OFF in autopilot_settings");
    const [pa2] = await db.select({ status: autopilotPendingActions.status }).from(autopilotPendingActions).where(eq(autopilotPendingActions.id, pa.id));
    check(pa2?.status === "rejected", "the pending run_ad_campaign action was rejected");
    const rowStatus = async (id: number) => (await db.select({ s: soleneDispatchQueue.status }).from(soleneDispatchQueue).where(eq(soleneDispatchQueue.id, id)))[0]?.s;
    check((await rowStatus(adDispatch)) === "cancelled", "the queued ad-move dispatch was cancelled");
    check((await rowStatus(growthDispatch)) === "queued", "a non-ad growth dispatch was left alone");
    const { getControlState, moveBlockedByControls } = await import("../../server/services/autopilot/founderControls");
    check(moveBlockedByControls({ domain: "growth", kind: "buy_meta_ads_2000", rationale: "Meta ads" }, await getControlState()) != null, "the tick would now skip an ad move");
    const resume = await executeBusinessChatTool("resume", { target: "ads" }, tag);
    const [s2] = await db.select({ ads: autopilotSettings.adsEnabled }).from(autopilotSettings).where(eq(autopilotSettings.id, 1));
    check(resume.ok && s2?.ads === true, "resume ads turns the switch back on");

    // ── pause a domain ────────────────────────────────────────────────────
    await executeBusinessChatTool("pause", { target: "growth" }, tag);
    check((await getControlState()).pausedDomains.includes("growth"), "growth is recorded as paused");
    check((await rowStatus(growthDispatch)) === "cancelled", "growth's queued dispatch was cancelled");
    check((await rowStatus(supportDispatch)) === "queued", "support's queued dispatch was not touched");
    await executeBusinessChatTool("resume", { target: "growth" }, tag);
    check(!(await getControlState()).pausedDomains.includes("growth"), "resume growth lifts the pause");

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
    const { panicStop } = await import("../../server/services/autopilot/panicStop");
    await panicStop({ reason: tag, by: tag });
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

    // ── reply_support_ticket hand ─────────────────────────────────────────
    const [o] = await db.insert(organizations).values({ name: tag, slug: tag, ownerId: tag }).returning({ id: organizations.id });
    orgId = o.id;
    const [t] = await db
      .insert(supportTickets)
      .values({ organizationId: o.id, userId: tag, subject: tag, description: "How do I import leads?", status: "open", resolutionType: "escalated" })
      .returning({ id: supportTickets.id });
    await import("../../server/services/autopilot/hands");
    const { executeHandWitnessed } = await import("../../server/services/autopilot/hands/registry");
    const hr = await executeHandWitnessed("reply_support_ticket", { ticket_id: t.id, message: "Go to Deals → Import and upload the CSV.", resolve: true }, `${tag}-founder`);
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
      const ctx = { dispatchId: 0 };
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
    const w1 = await runOpsWatch({ stripeProbe: async () => true });
    const w2 = await runOpsWatch({ stripeProbe: async () => true });
    const openEmail = await db.select().from(incidents).where(and(eq(incidents.title, "[ops] email_provider"), eq(incidents.status, "open")));
    check(w1.opened.includes("email_provider") && !w2.opened.includes("email_provider") && openEmail.length === 1, `ONE email incident across two passes (opened ${w1.opened.join(",")} then ${w2.opened.join(",") || "nothing"})`);
    await db.insert(jobHealthLogs).values({ jobName: "email_send", runStartedAt: new Date(), status: "success" });
    const w3 = await runOpsWatch({ stripeProbe: async () => true });
    const closed = await db.select().from(incidents).where(eq(incidents.title, "[ops] email_provider"));
    check(w3.resolved.includes("email_provider") && closed.every((c) => c.status === "resolved"), "a success after the outage closed the incident");
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
