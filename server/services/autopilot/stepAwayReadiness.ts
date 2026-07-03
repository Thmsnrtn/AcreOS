/**
 * Founder Autopilot — Step-Away Readiness (the "can I leave?" answer).
 *
 * The founder's core question is not "what happened?" (the Letter) or "what
 * needs me?" (Decisions) — it's "if I walk away right now, will this thing
 * run, and will it reach me if something breaks?" This module answers that
 * with MACHINE-VERIFIED checks, not vibes: every line is read from the same
 * switches/gates/ledgers the runtime actually obeys.
 *
 * Honesty rules:
 *   • A check that cannot be read reports "attention" with the reason — an
 *     unreadable safety signal is never shown green.
 *   • `critical: true` checks gate the verdict (paging reachability, loop
 *     health, budget discipline, the panic stop). Non-critical items are
 *     "worth doing" — the verdict stays ready without them, because waiting
 *     for perfection would mean never stepping away.
 *   • The horizon comes from the Trust Ledger's earned-autonomy derivation —
 *     the same number the ledger shows, never a marketing figure.
 */
import { logger } from "../../utils/logger";

export type ReadinessStatus = "ready" | "action_needed" | "attention";

export interface ReadinessCheck {
  key: string;
  /** CEO-plain title. */
  title: string;
  status: ReadinessStatus;
  /** What was actually verified (or why it couldn't be). */
  detail: string;
  /** What to do about it, in plain words. Absent when ready. */
  fix?: string;
  /** Deep link to the surface where the fix lives. */
  href?: string;
  /** Critical checks gate the overall verdict. */
  critical: boolean;
}

export interface StepAwayReadiness {
  verdict: "ready" | "not_ready";
  headline: string;
  /** Earned unattended runway, from the Trust Ledger (days). */
  horizonDays: number;
  readyCount: number;
  totalCount: number;
  checks: ReadinessCheck[];
}

function attention(base: Omit<ReadinessCheck, "status" | "detail">, why: string): ReadinessCheck {
  return { ...base, status: "attention", detail: `Could not verify: ${why}. An unreadable safety signal is never shown green.` };
}

/** Build the full readiness picture. Never throws. */
export async function buildStepAwayReadiness(): Promise<StepAwayReadiness> {
  const checks: ReadinessCheck[] = [];

  // ── 1. Panic stop (critical) ───────────────────────────────────────────────
  {
    const base = { key: "panic_stop", title: "Emergency stop", critical: true, href: "/founder/autopilot/control" };
    try {
      const { isPanicStopped } = await import("./settings");
      checks.push(
        isPanicStopped()
          ? { ...base, status: "attention", detail: "SOLENE_PANIC_STOP is ENGAGED — the autopilot is halted at the environment level.", fix: "Clear the panic stop (remove the Fly secret) once the incident that tripped it is resolved." }
          : { ...base, status: "ready", detail: "Disengaged. The machine may operate (through every gate)." },
      );
    } catch (err) {
      checks.push(attention(base, err instanceof Error ? err.message : String(err)));
    }
  }

  // ── 2. Reachability — paging + email fallback (critical) ─────────────────
  {
    const base = { key: "paging", title: "It can reach you", critical: true, href: "/founder/autopilot/control" };
    try {
      const { pageTopic } = await import("../solene/pagerService");
      // A founder-connected value (Platform Connections) counts; otherwise
      // the env/production semantics of pageTopic(). Fail-soft to env-only.
      let topicConfigured = pageTopic() !== null;
      let emailFallback = Boolean(process.env.FOUNDER_EMAIL?.trim());
      try {
        const { resolveConnection } = await import("../connections/platformConnections");
        const t = await resolveConnection("paging", "topic");
        if (t.source === "db" && t.value) topicConfigured = true;
        const e = await resolveConnection("paging", "founder_email");
        if (e.source === "db" && e.value) emailFallback = true;
      } catch { /* env stands */ }
      if (!topicConfigured && !emailFallback) {
        checks.push({ ...base, status: "action_needed", detail: "NO page channel is configured — incidents would be invisible until you next log in.", fix: "Open Connections on the Control Center and fill in Paging (a private ntfy topic + your email)." });
      } else if (!topicConfigured) {
        checks.push({ ...base, status: "action_needed", detail: "Push paging is unconfigured — pages fall back to email only.", fix: "Add the private ntfy topic under Connections → Paging so critical pages hit your phone." });
      } else if (!emailFallback) {
        checks.push({ ...base, status: "action_needed", detail: "Push paging is configured, but there is no email fallback — a single ntfy outage could silence a critical page.", fix: "Add your email under Connections → Paging so every failed push falls back to your inbox." });
      } else {
        checks.push({ ...base, status: "ready", detail: "Two independent page channels: push (ntfy) with automatic email fallback." });
      }
    } catch (err) {
      checks.push(attention(base, err instanceof Error ? err.message : String(err)));
    }
  }

  // ── 3. Loop health (critical) ─────────────────────────────────────────────
  {
    const base = { key: "loop_health", title: "The brain is alive", critical: true, href: "/founder/autopilot/control" };
    try {
      const { observeLoopHealth } = await import("./loopStall");
      const v = await observeLoopHealth();
      if (v.severity === "healthy") {
        checks.push({ ...base, status: "ready", detail: v.summary });
      } else if (v.severity === "degraded") {
        checks.push({ ...base, status: "attention", detail: `Degraded: ${v.summary}`, fix: "Check the Live card on the Control Center — a fresh deploy usually clears this within an hour." });
      } else {
        checks.push({ ...base, status: "attention", detail: `STALLED: ${v.summary}`, fix: "The loop has gone dark. Check worker logs before stepping away." });
      }
    } catch (err) {
      checks.push(attention(base, err instanceof Error ? err.message : String(err)));
    }
  }

  // ── 4. Budget discipline (critical) ───────────────────────────────────────
  {
    const base = { key: "budget", title: "Spending is bounded", critical: true, href: "/founder/autopilot/control" };
    try {
      const { getEnsembleCapStatus } = await import("../solene/capitalTracker");
      const s = await getEnsembleCapStatus();
      if (s.readFailed) {
        checks.push({ ...base, status: "attention", detail: "Month-to-date spend is unreadable — the money gates are failing CLOSED (dispatches refuse), so nothing can overspend, but the machine is partially parked.", fix: "Check database health; the gates reopen on their own once spend is readable." });
      } else if (s.exceeded) {
        checks.push({ ...base, status: "ready", detail: `Monthly agent budget fully used ($${s.monthToDateUsd.toFixed(2)} of $${s.capUsd}). The cap is HOLDING — no more agent spend until the month rolls or you raise it.` });
      } else {
        const pct = s.capUsd > 0 ? Math.round((s.monthToDateUsd / s.capUsd) * 100) : 0;
        checks.push({ ...base, status: "ready", detail: `$${s.monthToDateUsd.toFixed(2)} of the $${s.capUsd} monthly agent budget used (${pct}%). Every layer fails closed.` });
      }
    } catch (err) {
      checks.push(attention(base, err instanceof Error ? err.message : String(err)));
    }
  }

  // ── 5. Nothing waiting on you right now ───────────────────────────────────
  {
    const base = { key: "decisions_clear", title: "Decision queue is clear", critical: false, href: "/founder/decisions" };
    try {
      const { listPendingHands } = await import("./pendingHands");
      const { listOpenAsks } = await import("../solene/founderCollab");
      const pending = (await listPendingHands()).length;
      const asks = (await listOpenAsks()).length;
      const total = pending + asks;
      checks.push(
        total === 0
          ? { ...base, status: "ready", detail: "No frozen actions and no open asks." }
          : { ...base, status: "action_needed", detail: `${pending} frozen action(s) + ${asks} open ask(s) are waiting on you.`, fix: "Clear them in Decisions before you leave — or they'll wait (safely frozen) until you're back." },
      );
    } catch (err) {
      checks.push(attention(base, err instanceof Error ? err.message : String(err)));
    }
  }

  // ── 6. Delegation coverage ────────────────────────────────────────────────
  {
    const base = { key: "delegation", title: "It can act while you're gone", critical: false, href: "/founder/autopilot/control" };
    try {
      const { liveGrantsFor } = await import("./witnessGrantStore");
      const grants = await liveGrantsFor("solene");
      if (grants.length === 0) {
        checks.push({ ...base, status: "action_needed", detail: "No live delegation grants — every outward action will freeze and wait for your tap while you're away.", fix: "Issue a bounded delegation on the Control Center (start narrow: support, $5/action, small budget, short expiry)." });
      } else {
        const soonest = grants.reduce((min, g) => Math.min(min, g.expiresAt.getTime()), Infinity);
        const daysLeft = Math.max(0, Math.floor((soonest - Date.now()) / (24 * 60 * 60 * 1000)));
        const budgetLeft = grants.reduce((sum, g) => sum + Math.max(0, g.maxActions - g.usedCount), 0);
        checks.push({ ...base, status: "ready", detail: `${grants.length} live grant(s), ${budgetLeft} delegated action(s) remaining; earliest expiry in ~${daysLeft} day(s).` });
      }
    } catch (err) {
      checks.push(attention(base, err instanceof Error ? err.message : String(err)));
    }
  }

  // ── 7. Dead letters ───────────────────────────────────────────────────────
  {
    const base = { key: "dead_letters", title: "No stuck work", critical: false, href: "/founder/dispatches" };
    try {
      const { db } = await import("../../db");
      const { soleneDispatchQueue } = await import("@shared/schema/solene-dispatch");
      const { sql } = await import("drizzle-orm");
      const rows = await db
        .select({ id: soleneDispatchQueue.id })
        .from(soleneDispatchQueue)
        .where(
          sql`${soleneDispatchQueue.status} = 'failed'
            AND ${soleneDispatchQueue.resultSummary} LIKE '[dead-letter]%'
            AND ${soleneDispatchQueue.completedAt} > now() - interval '7 days'`,
        );
      checks.push(
        rows.length === 0
          ? { ...base, status: "ready", detail: "No dead-lettered dispatches in the last 7 days." }
          : { ...base, status: "action_needed", detail: `${rows.length} dispatch(es) exhausted their retries in the last 7 days.`, fix: "Review them on the dispatches page — a repeated dead-letter usually means a provider or config problem worth fixing before you leave." },
      );
    } catch (err) {
      checks.push(attention(base, err instanceof Error ? err.message : String(err)));
    }
  }

  // ── 8. Immune motor ───────────────────────────────────────────────────────
  {
    const base = { key: "immune", title: "It can patch itself", critical: false, href: "/founder/autopilot/control" };
    try {
      const { isSelfPatchEnabled } = await import("./settings");
      const enabled = await isSelfPatchEnabled();
      const { assertSelfPatchCapable } = await import("./selfPatchGitOps");
      const cap = await assertSelfPatchCapable();
      if (enabled && cap.capable) {
        checks.push({ ...base, status: "ready", detail: "Security advisories with a safe (patch-only) fix become pull requests on their own; you review and merge from anywhere." });
      } else {
        const why = [
          !enabled ? "the self-patch switch is off" : null,
          !cap.capable ? cap.reason : null,
        ].filter(Boolean).join("; ");
        checks.push({ ...base, status: "action_needed", detail: `Advisories are still watched and planned daily, but fixes wait for you (${why}).`, fix: "Optional: flip Self-patching on the Control Center (plus GITHUB_TOKEN/GITHUB_REPOSITORY where the motor should run)." });
      }
    } catch (err) {
      checks.push(attention(base, err instanceof Error ? err.message : String(err)));
    }
  }

  // ── Horizon + verdict ─────────────────────────────────────────────────────
  let horizonDays = 1;
  try {
    const { getTrustLedger, deriveAutonomyHorizonDays } = await import("./domainAutonomy");
    const ledger = await getTrustLedger();
    horizonDays = deriveAutonomyHorizonDays(ledger.map((e) => e.level));
  } catch (err) {
    logger.warn(
      `[stepAwayReadiness] trust ledger unreadable — horizon floored at 1 day: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const readyCount = checks.filter((c) => c.status === "ready").length;
  const criticalNotReady = checks.filter((c) => c.critical && c.status !== "ready");
  const verdict: StepAwayReadiness["verdict"] = criticalNotReady.length === 0 ? "ready" : "not_ready";
  const worthDoing = checks.filter((c) => !c.critical && c.status !== "ready").length;

  const headline =
    verdict === "ready"
      ? worthDoing === 0
        ? `You can step away. Every system is armed; the ledger supports ~${horizonDays} day(s) of unattended runway.`
        : `You can step away — the safety net is complete. ${worthDoing} optional item(s) below would let it do more while you're gone.`
      : `${criticalNotReady.length} thing(s) need you before you step away: ${criticalNotReady.map((c) => c.title.toLowerCase()).join(", ")}.`;

  return { verdict, headline, horizonDays, readyCount, totalCount: checks.length, checks };
}
