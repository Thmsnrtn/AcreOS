/**
 * tests/db/soleneSensesOnBuiltSchema.ts — do Solene's new senses and abort path
 * read and write what they claim, on a database built from this repository?
 *
 *     DATABASE_URL=postgres://… npx tsx tests/db/soleneSensesOnBuiltSchema.ts
 *
 * Each sense is measured as a DELTA: read, seed one qualifying row (and one
 * non-qualifying row beside it), read again. Proves:
 *   - an escalated Pax ticket counts toward the support backlog and is named;
 *   - an open data-subject request counts (both intake tables);
 *   - a signup not onboarded after 48h counts as stalled activation;
 *   - an org in dunning counts as a failed-payment org;
 *   - an open legal/compliance ask counts as pending;
 *   - a tick recorded only in job_health_logs is a heartbeat;
 *   - cancelInFlightDispatches cancels in_progress rows (not queued ones) and
 *     isDispatchCancelled then reports it.
 * Deletes what it seeded. Exits non-zero on any failure and prints why.
 */
import { eq, inArray, like } from "drizzle-orm";
import {
  dsarRequests,
  dsarRequestsLifecycle,
  jobHealthLogs,
  organizations,
  supportTickets,
} from "@shared/schema";
import { soleneDispatchQueue } from "@shared/schema/solene-dispatch";
import { soleneFounderAsks } from "@shared/schema/solene-founder-collab";
import { db, pool } from "../../server/db";
import {
  getSupportBacklog,
  readOpenDsarCount,
  getStalledActivationCount,
  readFailedPaymentOrgCount,
  readPendingLegalAskCount,
} from "../../server/services/autopilot/senses";
import { readLoopLastSuccess } from "../../server/services/autopilot/loopHeartbeat";

const LOOP_JOB = "solene_continuous_tick";
import { cancelInFlightDispatches, isDispatchCancelled } from "../../server/services/solene/dispatchQueue";
import { LEGAL_ASK_SUMMARY_PREFIX } from "../../server/services/supportLegalIntake";

const failures: string[] = [];
const why = (err: unknown) => {
  const e = err as { message?: string; cause?: { message?: string } };
  return e?.cause?.message ?? e?.message ?? String(err);
};
const check = (ok: boolean, what: string) => {
  console.log(`[senses-on-built-schema] ${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[senses-on-built-schema] DATABASE_URL not set — this needs a real, built database.");
    process.exit(1);
  }
  const tag = `senses-built-${process.pid}-${Date.now()}`;
  const orgIds: number[] = [];
  const mkOrg = async (extra: Record<string, unknown>) => {
    const [o] = await db
      .insert(organizations)
      .values({ name: `${tag}-${orgIds.length}`, slug: `${tag}-${orgIds.length}`, ownerId: tag, ...extra } as any)
      .returning({ id: organizations.id });
    orgIds.push(o.id);
    return o.id;
  };
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
  try {
    const org = await mkOrg({ onboardingCompleted: true });

    // Support backlog: escalated + open counts; escalated + resolved does not.
    const before = await getSupportBacklog();
    const [t] = await db
      .insert(supportTickets)
      .values({ organizationId: org, userId: tag, subject: tag, description: tag, status: "open", resolutionType: "escalated" } as any)
      .returning({ id: supportTickets.id });
    await db
      .insert(supportTickets)
      .values({ organizationId: org, userId: tag, subject: tag, description: tag, status: "resolved", resolutionType: "escalated" } as any);
    const after = await getSupportBacklog();
    check(after.total === before.total + 1, `escalated open ticket counts toward the backlog (${before.total} → ${after.total})`);
    check(after.escalatedTicketIds.includes(t.id) || after.escalatedTicketIds.length === 5, "the escalated ticket can be named");

    // DSAR: an open request in each intake table counts; a completed one does not.
    const d0 = await readOpenDsarCount();
    await db.insert(dsarRequests).values({ requestType: "erasure", email: `${tag}@x.test`, fullName: tag, status: "pending" } as any);
    await db.insert(dsarRequests).values({ requestType: "erasure", email: `${tag}@x.test`, fullName: tag, status: "completed" } as any);
    await db.insert(dsarRequestsLifecycle).values({ requestType: "erasure", requesterEmail: `${tag}@x.test`, slaDeadlineAt: new Date() } as any);
    const d1 = await readOpenDsarCount();
    check(d1 === d0 + 2, `open data-subject requests counted across both tables (${d0} → ${d1})`);

    // Activation: not onboarded 72h after signup counts; 1h-old signup does not.
    const a0 = await getStalledActivationCount();
    await mkOrg({ onboardingCompleted: false, createdAt: hoursAgo(72) });
    await mkOrg({ onboardingCompleted: false, createdAt: hoursAgo(1) });
    const a1 = await getStalledActivationCount();
    check(a1 === a0 + 1, `a signup not onboarded after 48h is stalled (${a0} → ${a1})`);

    // Dunning.
    const p0 = await readFailedPaymentOrgCount();
    await mkOrg({ onboardingCompleted: true, dunningStage: "warning" });
    const p1 = await readFailedPaymentOrgCount();
    check(p1 === p0 + 1, `an org in dunning counts as a failed payment (${p0} → ${p1})`);

    // Legal ask.
    const l0 = await readPendingLegalAskCount();
    await db.insert(soleneFounderAsks).values({
      askingAgentRole: "beatrice",
      questionSummary: `${LEGAL_ASK_SUMMARY_PREFIX}: ${tag}`,
      questionBody: tag,
      answerFormat: "free_text",
      urgency: "urgent",
      status: "open",
      timeoutAt: new Date(Date.now() + 3_600_000),
    } as any);
    const l1 = await readPendingLegalAskCount();
    check(l1 === l0 + 1, `an open legal/compliance ask is pending (${l0} → ${l1})`);

    // Heartbeat from job_health_logs alone.
    const beat = new Date(Date.now() + 86_400_000); // later than any real row
    await db.insert(jobHealthLogs).values({ jobName: LOOP_JOB, runStartedAt: beat, runCompletedAt: beat, status: "success", errorMessage: tag } as any);
    const last = await readLoopLastSuccess(db);
    check(last?.getTime() === beat.getTime(), "a tick recorded only in job_health_logs is the heartbeat");
    await db.delete(jobHealthLogs).where(eq(jobHealthLogs.errorMessage, tag));

    // Cooperative abort: in_progress → cancelled; queued untouched.
    const base = { priority: "0.1", sourceType: "auto_dispatch", agentRole: "iris", promptText: tag, maxCostUsd: "1", timeoutMs: 1000 };
    const [running] = await db.insert(soleneDispatchQueue).values({ ...base, status: "in_progress", sourceId: `${tag}-r` } as any).returning({ id: soleneDispatchQueue.id });
    const [waiting] = await db.insert(soleneDispatchQueue).values({ ...base, status: "queued", sourceId: `${tag}-q` } as any).returning({ id: soleneDispatchQueue.id });
    check(!(await isDispatchCancelled(running.id)), "a running dispatch is not cancelled before the stop");
    const aborted = await cancelInFlightDispatches(tag);
    check(aborted.includes(running.id), "the panic-stop abort cancels the in-flight dispatch");
    check(await isDispatchCancelled(running.id), "the runner's check sees the cancel");
    check(!(await isDispatchCancelled(waiting.id)) && !aborted.includes(waiting.id), "a queued dispatch is left for the switch to hold");
  } catch (err) {
    check(false, `unexpected: ${why(err)}`);
  } finally {
    await db.delete(soleneDispatchQueue).where(like(soleneDispatchQueue.sourceId, `${tag}%`)).catch(() => undefined);
    await db.delete(soleneFounderAsks).where(like(soleneFounderAsks.questionBody, tag)).catch(() => undefined);
    await db.delete(dsarRequests).where(like(dsarRequests.fullName, tag)).catch(() => undefined);
    await db.delete(dsarRequestsLifecycle).where(like(dsarRequestsLifecycle.requesterEmail, `${tag}%`)).catch(() => undefined);
    if (orgIds.length) {
      await db.delete(supportTickets).where(inArray(supportTickets.organizationId, orgIds)).catch(() => undefined);
      await db.delete(organizations).where(inArray(organizations.id, orgIds)).catch(() => undefined);
    }
  }
}

main()
  .catch((err) => check(false, `unexpected: ${why(err)}`))
  .finally(async () => {
    await pool.end().catch(() => undefined);
    if (failures.length > 0) {
      console.error(`[senses-on-built-schema] FAIL — ${failures.length} check(s) failed`);
      process.exit(1);
    }
    console.log("[senses-on-built-schema] PASS");
    process.exit(0);
  });
