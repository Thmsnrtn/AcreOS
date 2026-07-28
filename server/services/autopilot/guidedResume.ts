/**
 * guidedResume — the staged, honest way BACK from the panic stop.
 *
 * panicStop() is a world-class STOP: one tap flips every master switch off and
 * quarantines every domain to observe. But a stop with no guided resume is
 * psychologically unusable — a layperson founder who trips the red button at
 * 3am would otherwise face a wall of half-remembered switches at the exact
 * moment their confidence is lowest. This module is the other half:
 *
 *   resumePreflight() — a plain-words checklist BEFORE anything turns on:
 *     • whether the out-of-reach SOLENE_PANIC_STOP env override is engaged
 *       (which this app CANNOT clear — that's the whole point of it);
 *     • what tripped the stop, to the extent it's honestly discoverable;
 *     • the relevant machine-verified readiness checks (reused from
 *       stepAwayReadiness — same reads the runtime obeys, never vibes).
 *
 *   resumeStage(stage) — three ordered stages, tighten-biased by design:
 *     1. "cognition" — the brain back on (thinks/watches/drafts; no hands);
 *     2. "observe"   — verifies every domain sits at watching-only (the stop
 *        already put them there; this stage changes NOTHING and says so);
 *     3. "dispatch"  — hands back on. Auto-publish stays OFF: neither the
 *        proof receipt (it seals only a HASH of {reason, switchesOff, domains},
 *        and switchesOff records what was turned off, not what was on before)
 *        nor autopilot_settings (no history, only current values) records the
 *        pre-stop publish state — so rather than guess, publish waits for the
 *        founder's own tap.
 *
 * NEVER restored automatically: domain autonomy levels. Post-resume every
 * domain stays at observe and the founder re-grants from the trust ledger.
 * That is the honest, tighten-biased behavior — your autopilot restarts
 * cautious and re-earns trust; it doesn't get it back by default.
 *
 * Composition layer (reads settings/ledger/receipts) — NOT kernel. The pure
 * parts (stage ordering, narration, preflight composition) are exported and
 * unit-tested without a DB; the async functions wrap them best-effort.
 */

import { logger } from "../../utils/logger";

// ── Pure core (no DB — unit-tested directly) ─────────────────────────────────

/** The three resume stages, in the ONLY order they may run. */
export const RESUME_STAGES = ["cognition", "observe", "dispatch"] as const;
export type ResumeStage = (typeof RESUME_STAGES)[number];

export function isResumeStage(v: unknown): v is ResumeStage {
  return typeof v === "string" && (RESUME_STAGES as readonly string[]).includes(v);
}

/** 0-based position of a stage in the mandatory order. */
export function resumeStageIndex(stage: ResumeStage): number {
  return RESUME_STAGES.indexOf(stage);
}

export interface ResumeChecklistItem {
  /** Plain-words name of the check. */
  label: string;
  ok: boolean;
  /** What was actually verified (or why it couldn't be) — plain words. */
  detail: string;
}

export interface ResumePreflight {
  ok: boolean;
  items: ResumeChecklistItem[];
}

export interface PreflightFacts {
  /** SOLENE_PANIC_STOP env override — the floor the founder cannot clear here. */
  envStopEngaged: boolean;
  /** From the latest panic_stop proof receipt, when one exists. */
  stoppedAt: string | null;
  stoppedBy: string | null;
  /** Plain-text trip reason, recovered from the trust ledger's quarantine
   * entries when a demotion recorded it. The receipt itself only seals a hash. */
  tripReason: string | null;
  /** Relevant readiness checks (reused stepAwayReadiness machinery), already
   * mapped to plain items — or null when they could not be run at all. */
  readiness: Array<{ label: string; ok: boolean; detail: string }> | null;
}

const ENV_STOP_ENGAGED_DETAIL =
  "The server-level stop (SOLENE_PANIC_STOP) is ENGAGED. You cannot clear it from this app — " +
  "by design, so the autopilot can never un-stop itself. It has to be removed where the server's " +
  "secrets live. Until then, every switch reads OFF no matter what you turn on here.";

/** Pure composition of the resume-preflight checklist. */
export function composeResumePreflight(facts: PreflightFacts): ResumePreflight {
  const items: ResumeChecklistItem[] = [];

  // 1. The out-of-reach env floor — the one thing this screen cannot fix.
  items.push(
    facts.envStopEngaged
      ? { label: "Server-level stop", ok: false, detail: ENV_STOP_ENGAGED_DETAIL }
      : {
          label: "Server-level stop",
          ok: true,
          detail: "Not engaged — nothing at the server level is holding the autopilot off.",
        },
  );

  // 2. What tripped the stop — only what the records honestly support.
  {
    const parts: string[] = [];
    if (facts.tripReason) {
      parts.push(`Reason recorded at the time: “${facts.tripReason}”.`);
    } else if (facts.stoppedAt) {
      parts.push(
        "The written reason isn't recoverable — the stop's receipt seals it as a hash, and the ledger kept no plain-text copy.",
      );
    }
    if (facts.stoppedAt) {
      parts.push(`The stop was tripped ${facts.stoppedAt}${facts.stoppedBy ? ` by ${facts.stoppedBy}` : ""}.`);
    }
    items.push(
      parts.length > 0
        ? { label: "What tripped the stop", ok: true, detail: parts.join(" ") }
        : {
            label: "What tripped the stop",
            ok: true,
            detail:
              "No panic-stop receipt was found — the switches may have been turned off by hand rather than by the red button. Coming back the staged way is still the safe path.",
          },
    );
  }

  // 3. The reused readiness checks — an unreadable safety signal is never green.
  if (facts.readiness === null) {
    items.push({
      label: "Safety checks",
      ok: false,
      detail:
        "Could not run the safety checks (pager, loop health, budget). An unreadable safety signal is never shown green — fix the read before coming back online.",
    });
  } else {
    for (const c of facts.readiness) items.push(c);
  }

  return { ok: items.every((i) => i.ok), items };
}

export interface ResumeStageResult {
  done: boolean;
  narration: string;
}

export interface StageDomainStanding {
  domain: string;
  level: string;
}

const CAUTIOUS_TAIL =
  "Every part of the company stays at watching-only until you re-grant trust from the trust ledger — " +
  "that's deliberate: your autopilot restarts cautious and re-earns autonomy, it doesn't get it back automatically.";

/**
 * Pure narration for each stage, in plain words. `domains` is only read by the
 * "observe" stage (to say truthfully what was verified vs. changed).
 */
export function narrateResumeStage(stage: ResumeStage, domains: StageDomainStanding[] = []): string {
  switch (stage) {
    case "cognition":
      return (
        "The brain is back on: it thinks, watches, and drafts again. Its hands are still off — " +
        "nothing goes out, nothing publishes. " +
        CAUTIOUS_TAIL
      );
    case "observe": {
      const above = domains.filter((d) => d.level !== "observe");
      if (above.length === 0) {
        const names = domains.map((d) => d.domain).join(", ");
        return (
          `This step changes nothing — the stop already put every part${names ? ` (${names})` : ""} at watching-only, ` +
          "and that's exactly where they are now; this step verified it. " +
          CAUTIOUS_TAIL
        );
      }
      return (
        `Verified: ${above.length} part${above.length === 1 ? " sits" : "s sit"} above watching-only ` +
        `(${above.map((d) => `${d.domain}: ${d.level}`).join(", ")}) — trust granted since the stop. ` +
        "This step never raises or lowers trust either way; the rest stay at watching-only. " +
        CAUTIOUS_TAIL
      );
    }
    case "dispatch":
      return (
        "Hands are back on — actions run through every safety gate again. Auto-publish stays OFF: " +
        "the system doesn't record whether it was on before the stop, so rather than guess, it leaves " +
        "publishing for your own tap when you want it. " +
        CAUTIOUS_TAIL
      );
  }
}

// ── Async wrappers (best-effort reads/writes, dynamic imports) ───────────────

/**
 * Build the plain-words preflight checklist. Never throws — every read is
 * best-effort, and an unreadable safety signal reports honestly as not-ok.
 */
export async function resumePreflight(): Promise<ResumePreflight> {
  // The env floor — read directly; this is the one check that must never lie.
  let envStopEngaged = false;
  try {
    const { isPanicStopped } = await import("./settings");
    envStopEngaged = isPanicStopped();
  } catch (err) {
    logger.warn("[autopilot/guidedResume] could not read env panic stop", err instanceof Error ? err : undefined);
    // Unreadable = treat as engaged; never assume the floor is clear.
    envStopEngaged = true;
  }

  // The latest panic_stop receipt — WHEN and WHO. (The reason is only a hash.)
  let stoppedAt: string | null = null;
  let stoppedBy: string | null = null;
  try {
    const { db } = await import("../../db");
    const { proofReceipts } = await import("@shared/schema");
    const { desc, eq } = await import("drizzle-orm");
    const [row] = await db
      .select({ issuedAt: proofReceipts.issuedAt, by: proofReceipts.accountableHumanId })
      .from(proofReceipts)
      .where(eq(proofReceipts.actionKind, "panic_stop"))
      .orderBy(desc(proofReceipts.id))
      .limit(1);
    if (row) {
      stoppedAt = row.issuedAt ?? null;
      stoppedBy = row.by ?? null;
    }
  } catch (err) {
    logger.warn("[autopilot/guidedResume] panic receipt unreadable", err instanceof Error ? err : undefined);
  }

  // The trip reason — recoverable only when the quarantine demoted a domain
  // that was above observe (setDomainLevel recorded "panic stop: <reason>").
  let tripReason: string | null = null;
  try {
    const { getTrustLedger } = await import("./domainAutonomy");
    const ledger = await getTrustLedger();
    for (const entry of ledger) {
      const m = entry.lastDemotionReason?.match(/panic stop:\s*(.+)/i);
      if (m?.[1]) {
        tripReason = m[1].trim();
        break;
      }
    }
  } catch (err) {
    logger.warn("[autopilot/guidedResume] trust ledger unreadable for trip reason", err instanceof Error ? err : undefined);
  }

  // The relevant readiness checks — same machinery, same reads (stepAwayReadiness).
  let readiness: PreflightFacts["readiness"] = null;
  try {
    const { buildStepAwayReadiness } = await import("./stepAwayReadiness");
    const r = await buildStepAwayReadiness();
    const RELEVANT = ["paging", "loop_health", "budget"];
    readiness = r.checks
      .filter((c) => RELEVANT.includes(c.key))
      .map((c) => ({
        label: c.title,
        ok: c.status === "ready",
        detail: c.fix ? `${c.detail} ${c.fix}` : c.detail,
      }));
  } catch (err) {
    logger.warn("[autopilot/guidedResume] readiness checks failed", err instanceof Error ? err : undefined);
    readiness = null;
  }

  return composeResumePreflight({ envStopEngaged, stoppedAt, stoppedBy, tripReason, readiness });
}

/**
 * Run one resume stage. Ordered, tighten-biased, and honest:
 *   cognition → re-enable the cognition switch only;
 *   observe   → verify (change nothing) that every domain sits at observe;
 *   dispatch  → re-enable dispatch; publish stays OFF (pre-stop state is not
 *               recorded anywhere, so it is never guessed back on).
 * Never throws; a failed write comes back { done: false } with plain words.
 */
export async function resumeStage(stage: ResumeStage, by: string): Promise<ResumeStageResult> {
  // The env floor overrides everything — flipping DB switches under it would
  // look like progress while doing nothing. Refuse honestly instead.
  try {
    const { isPanicStopped } = await import("./settings");
    if (isPanicStopped()) {
      logger.warn("[autopilot/guidedResume] resume refused — env panic stop engaged", { stage, by });
      return { done: false, narration: ENV_STOP_ENGAGED_DETAIL };
    }
  } catch (err) {
    logger.error("[autopilot/guidedResume] cannot verify env panic stop — refusing", err instanceof Error ? err : undefined);
    return {
      done: false,
      narration:
        "Couldn't verify the server-level stop is clear, so nothing was turned on — better to refuse than to pretend.",
    };
  }

  try {
    if (stage === "cognition") {
      const { setAutopilotSetting } = await import("./settings");
      await setAutopilotSetting("cognitionEnabled", true, by);
      logger.info("[autopilot/guidedResume] stage 1 — cognition re-enabled", { by });
      return { done: true, narration: narrateResumeStage("cognition") };
    }

    if (stage === "observe") {
      const { getTrustLedger } = await import("./domainAutonomy");
      const ledger = await getTrustLedger();
      logger.info("[autopilot/guidedResume] stage 2 — domain standing verified (no changes)", {
        by,
        levels: ledger.map((d) => `${d.domain}:${d.level}`).join(","),
      });
      return {
        done: true,
        narration: narrateResumeStage("observe", ledger.map((d) => ({ domain: d.domain, level: d.level }))),
      };
    }

    // stage === "dispatch" — hands on; publish deliberately untouched (see header).
    const { setAutopilotSetting } = await import("./settings");
    await setAutopilotSetting("dispatchEnabled", true, by);
    logger.info("[autopilot/guidedResume] stage 3 — dispatch re-enabled; publish left OFF (pre-stop state unrecorded)", { by });
    return { done: true, narration: narrateResumeStage("dispatch") };
  } catch (err) {
    logger.error(`[autopilot/guidedResume] stage "${stage}" failed`, err instanceof Error ? err : undefined);
    return {
      done: false,
      narration: `Couldn't complete this step (${err instanceof Error ? err.message : String(err)}). Nothing was half-applied silently — try again, and if it keeps failing, check the database before coming back online.`,
    };
  }
}
