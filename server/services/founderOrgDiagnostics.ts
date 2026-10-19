/**
 * Is the founder's organisation resolvable — and by which rule? Reported
 * without ever naming the organisation.
 *
 * System alerts, on-call pages and founder-scoped writes land in the founder's
 * organisation and refuse to guess when it cannot be resolved
 * (FOUNDER_ORG_UNRESOLVED, server/services/founder.ts). That refusal is
 * correct, and it is also silent from the outside: a production deploy with
 * FOUNDER_PRIMARY_ORG_ID unset and no single founder-owned organisation keeps
 * dropping in-app alerts and pushes, and nobody can see why without reading
 * production secrets. Two surfaces make the misconfiguration visible:
 *
 *   1. `reportFounderOrgAtBoot` — once per production process boot: one
 *      structured error log when the founder org cannot be resolved, and, on
 *      the process that runs the scheduler, one on-call email (the on-call
 *      email channel needs no organisation; the in-app row and push do).
 *   2. `describeFounderOrgResolution` — the state for the founder-only launch
 *      readiness endpoint (/api/founder/launch-readiness → /founder/readiness):
 *      resolved yes/no, the rule that answered, the strict rule's refusal
 *      reason, and whether FOUNDER_PRIMARY_ORG_ID is set. Never an id.
 */
import { logger } from "../utils/logger";
import { clock } from "../utils/clock";
import {
  resolveFounderOrganization,
  resolveFounderPrimaryOrgIdWithSource,
  type FounderOrgResolution,
  type FounderPrimaryOrgSource,
} from "./founder";

type StrictRefusal = Extract<FounderOrgResolution, { ok: false }>["reason"];

export interface FounderOrgDiagnostics {
  /** Whether system alerts have a founder organisation to land in. */
  resolved: boolean;
  /** The rule that answered, or null when unresolved. */
  source: FounderPrimaryOrgSource | null;
  /** The strict (canonical) rule's refusal, or null when it resolved. */
  strictReason: StrictRefusal | null;
  /** Whether FOUNDER_PRIMARY_ORG_ID is set (its value is never reported). */
  pinConfigured: boolean;
  checkedAt: string;
}

export async function describeFounderOrgResolution(env: NodeJS.ProcessEnv = process.env): Promise<FounderOrgDiagnostics> {
  const effective = await resolveFounderPrimaryOrgIdWithSource();
  // The strict verdict: reuse the one the resolver just computed; run it only
  // when the resolver answered from its cache or its miss window.
  const strict =
    effective.strict ??
    (effective.source === "sole-owned" || effective.source === "pinned"
      ? null
      : await resolveFounderOrganization());
  return {
    resolved: effective.organizationId !== null,
    source: effective.organizationId !== null ? effective.source : null,
    strictReason: strict === null || strict.ok ? null : strict.reason,
    pinConfigured: (env.FOUNDER_PRIMARY_ORG_ID ?? "").trim().length > 0,
    checkedAt: clock.now().toISOString(),
  };
}

/** What the founder should do about each strict-rule refusal. */
export const FOUNDER_ORG_REMEDY: Record<StrictRefusal, string> = {
  "no-founder-identity":
    "No user matches FOUNDER_EMAIL/FOUNDER_EMAILS or FOUNDER_USER_IDS. Sign in once with the founder email, or correct those settings.",
  "no-founder-org": "No organisation is owned by a founder identity. Create (or take ownership of) the AcreOS company organisation.",
  ambiguous: "Several organisations are owned by founder identities. Set FOUNDER_PRIMARY_ORG_ID to the one system alerts belong in.",
  "pin-not-founder-owned":
    "FOUNDER_PRIMARY_ORG_ID is set, but to an organisation no founder identity owns, so it is refused (founder decision 2026-10-18). Point it at the founder-owned organisation.",
  "lookup-failed": "The lookup itself failed (database unavailable?). It is retried on every alert.",
};

/** Per process: a fresh module (a restart) reports again. */
let _bootReported = false;

export type FounderOrgBootOutcome = "skipped-not-production" | "already-reported" | "resolved" | "unresolved" | "lookup-failed";

/**
 * Once per process, in production only. `notify` is true on the process that
 * runs the scheduler (the worker in production), so a fleet of app machines
 * logs but sends one email per worker boot, not one per machine.
 */
export async function reportFounderOrgAtBoot(opts: {
  notify: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<FounderOrgBootOutcome> {
  const env = opts.env ?? process.env;
  if (env.NODE_ENV !== "production") return "skipped-not-production";
  if (_bootReported) return "already-reported";
  _bootReported = true;

  let state: FounderOrgDiagnostics;
  try {
    state = await describeFounderOrgResolution(env);
  } catch (err) {
    logger.warn("[founder-org] boot check could not run", { metadata: { message: err instanceof Error ? err.message : String(err) } });
    return "lookup-failed";
  }

  if (state.resolved) {
    // Resolved means the strict rule answered: there is no other rule
    // (founder decisions 2026-10-18).
    logger.info("[founder-org] founder organization resolved at boot", {
      metadata: { source: state.source, pinConfigured: state.pinConfigured },
    });
    return "resolved";
  }
  if (state.strictReason === "lookup-failed") {
    // A database hiccup at boot is not a misconfiguration; every alert retries.
    logger.warn("[founder-org] founder organization lookup failed at boot; not reporting a misconfiguration", {
      metadata: { pinConfigured: state.pinConfigured },
    });
    return "lookup-failed";
  }

  const remedy = state.strictReason ? FOUNDER_ORG_REMEDY[state.strictReason] : "Set FOUNDER_PRIMARY_ORG_ID.";
  logger.error("[founder-org] FOUNDER_ORG_UNRESOLVED at boot — system alerts have no founder organization to land in", undefined, {
    metadata: { code: "FOUNDER_ORG_UNRESOLVED", reason: state.strictReason, pinConfigured: state.pinConfigured, remedy },
  });

  if (opts.notify) {
    // Founder decision 2026-10-18 ("refuse and alert"): a pin the strict check
    // did not accept is refused, never used as written — say so plainly.
    const pinInvalid = state.pinConfigured;
    try {
      const { notifyOnCall } = await import("./oncall");
      await notifyOnCall(
        "P1",
        pinInvalid ? "FOUNDER_PRIMARY_ORG_ID is invalid and was refused" : "Founder organization is not configured",
        (pinInvalid
          ? "FOUNDER_PRIMARY_ORG_ID is set, but the strict check did not accept it, so it is refused (never used as written, never replaced by a guess). "
          : "") +
          "System alerts and on-call pages have no founder organization to land in, so the in-app alert and the phone push are skipped " +
          "(this email still arrives).\n\n" +
          `Why: ${state.strictReason ?? "unresolved"}. ${remedy}\n\n` +
          "Confirm on /founder/readiness (\"Founder organization resolves\"), or check the secret with `fly secrets list` (FOUNDER_PRIMARY_ORG_ID).",
        { code: "FOUNDER_ORG_UNRESOLVED", reason: state.strictReason, pinConfigured: state.pinConfigured },
      );
    } catch (err) {
      logger.error("[founder-org] on-call notice for the unresolved founder organization failed", err instanceof Error ? err : undefined);
    }
  }
  return "unresolved";
}
