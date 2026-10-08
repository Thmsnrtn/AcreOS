/**
 * Refusals that name their own way forward — read off the server's error
 * body, rendered as a title, the server's sentence, and one call to action.
 *
 * Two shapes qualify:
 *   - `PLAN_LIMIT_REACHED` (server/utils/errors.ts `planLimitReached`): a plan
 *     cap. The message is built server-side from the canonical tier table;
 *     the client renders it verbatim and links `details.upgradeUrl`.
 *   - any refusal carrying `details.nextStep = { label, href }`
 *     (server/utils/firstRunRefusals.ts): Pax credits, teammate seats.
 *
 * Everything else returns null and keeps its existing handling — in
 * particular a real rate limit (`LIMIT_EXCEEDED` / `rate_limit_exceeded`)
 * keeps its "slow down" copy, because for a rate limit that is the truth.
 */

import {
  PLAN_LIMIT_REACHED,
  planLimitTitle,
  tierDisplayName,
  type PlanLimitDetails,
} from "@shared/billing/plan-limit-copy";

export interface RefusalView {
  title: string;
  description: string;
  action: { label: string; href: string };
}

const NEXT_STEP_TITLES: Record<string, string> = {
  PAX_CREDITS_REQUIRED: "Pax needs credits to continue",
  upgrade_required: "Teammate seats need a different plan",
  seat_purchase_required: "This organization needs another seat",
};

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

const FALLBACK_HREF = "/settings#billing";

/**
 * Only an in-app path may become a call to action. The href arrives in an
 * error body and is assigned to `window.location.href` / a link, so a
 * `javascript:` URL or a protocol-relative `//host` must never pass.
 */
function safeHref(v: unknown): string {
  if (typeof v !== "string") return FALLBACK_HREF;
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return FALLBACK_HREF;
  return v;
}

/** The refusal view for a parsed error body, or null if it is not one. */
export function refusalFromBody(body: unknown): RefusalView | null {
  if (!isObject(body) || typeof body.message !== "string" || body.message.length === 0) return null;
  const details = isObject(body.details) ? body.details : {};

  if (body.error === PLAN_LIMIT_REACHED) {
    const d = details as Partial<PlanLimitDetails>;
    const hasShape = typeof d.resourceType === "string" && typeof d.currentTier === "string";
    return {
      title: hasShape ? planLimitTitle(d as PlanLimitDetails) : "Plan limit reached",
      description: body.message,
      action: {
        label: d.nextTier ? `See ${tierDisplayName(d.nextTier)}` : "See plans",
        href: safeHref(d.upgradeUrl),
      },
    };
  }

  const step = details.nextStep;
  if (isObject(step) && typeof step.label === "string" && typeof step.href === "string") {
    return {
      title: NEXT_STEP_TITLES[String(body.error)] ?? "Action needed",
      description: body.message,
      action: { label: step.label, href: safeHref(step.href) },
    };
  }
  return null;
}
