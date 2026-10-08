/**
 * The shared monthly AI allowance — enforcement for EVERY customer-triggered
 * AI feature (founder decision 2026-10-08,
 * docs/company/founder-decisions-2026-10-08.md).
 *
 * Each plan includes one monthly allowance of platform AI cost, in cents
 * (TIER_LIMITS[*].aiAllowanceCents = turn threshold × 1.5¢). Chat, document
 * intelligence, due diligence, negotiation, valuation, agent skills — every
 * call the org triggers — draws from it. Past it, the org runs on its OWN AI
 * key, exactly as chat does: never a hard wall with no way forward, never
 * silent metered overage.
 *
 *   under the allowance            → platform key (returns null)
 *   past it, org has an AI key     → the org's key serves the call (returns
 *                                    the BYOK routing; recorded at $0)
 *   past it, no key                → AiAllowanceExhaustedError — a recoverable
 *                                    429 byok_required pointing at
 *                                    /settings/byok (Errors.internal maps it)
 *
 * WHAT COUNTS (and the rule for work the org did not trigger): spend recorded
 * with origin = 'customer'. Background work that serves the org but that it
 * did not trigger (origin = 'background') is NOT counted and is never gated
 * here — it cannot quietly drain the allowance and wall the customer off; it is
 * bounded by the per-org tier ceilings (aiCostCeiling.ts) and shows on the
 * founder's cost-to-serve view instead. Platform-internal and founder AI has no
 * org and is never anyone's allowance.
 *
 * The decision is checkAiTurnGate()'s — the SAME function the chat route gate
 * uses — so chat and every other feature agree on one number.
 *
 * Read errors fail OPEN (a metering hiccup must not break a customer's call);
 * the per-org cost ceiling still bounds spend in that window.
 */
import { logger } from "../utils/logger";
import { clock } from "../utils/clock";
import type { AiByokRouting } from "./byok/aiByok";

export class AiAllowanceExhaustedError extends Error {
  readonly code = "AI_ALLOWANCE_BYOK_REQUIRED" as const;
  readonly reason = "byok_required" as const;
  readonly byokSettingsUrl = "/settings/byok";
  constructor(
    public readonly organizationId: number,
    public readonly spentCents: number,
    public readonly allowanceCents: number,
    public readonly byokAvailable: boolean,
  ) {
    super(
      byokAvailable
        ? "You've used this month's included AI. Add your own Anthropic, OpenRouter, or OpenAI key in Settings → Your provider keys to keep going — your data and drafts stay fully accessible."
        : "You've used this month's included AI. Upgrade your plan to unlock bring-your-own-key — your data and drafts stay fully accessible.",
    );
    this.name = "AiAllowanceExhaustedError";
  }
}

const GATE_TTL_MS = 30_000;
const MAX_CACHED_ORGS = 5_000;
const gateCache = new Map<number, { at: number; exhausted: boolean; spent: number; allowance: number; byokAvailable: boolean }>();

/** Test seam. */
export function __resetAiAllowanceCacheForTests(): void {
  gateCache.clear();
}

async function readGate(orgId: number) {
  const hit = gateCache.get(orgId);
  if (hit && clock.nowMs() - hit.at <= GATE_TTL_MS) return hit;
  const { checkAiTurnGate } = await import("./usageLimits");
  const g = await checkAiTurnGate(orgId);
  const exhausted = g.mode !== "founder" && g.threshold !== null && g.current >= g.threshold;
  const entry = {
    at: clock.nowMs(),
    exhausted,
    spent: g.current,
    allowance: g.threshold ?? 0,
    byokAvailable: g.byokAvailable,
  };
  if (gateCache.size >= MAX_CACHED_ORGS) {
    const oldest = gateCache.keys().next().value;
    if (oldest !== undefined) gateCache.delete(oldest);
  }
  gateCache.set(orgId, entry);
  return entry;
}

/**
 * Enforce the allowance for one customer-triggered call by `orgId`.
 * Returns the org's BYOK routing when the call must run on their key, null
 * when the platform key serves it; throws AiAllowanceExhaustedError when the
 * allowance is spent and the org has no key.
 */
export async function enforceAiAllowance(orgId: number): Promise<AiByokRouting | null> {
  let gate: Awaited<ReturnType<typeof readGate>>;
  try {
    gate = await readGate(orgId);
  } catch (err) {
    logger.warn("[ai-allowance] allowance unreadable — allowing on the platform key", {
      metadata: { orgId, detail: err instanceof Error ? err.message : String(err) },
    });
    return null;
  }
  if (!gate.exhausted) return null;
  let byok: AiByokRouting | null = null;
  try {
    const { resolveAiByokClient } = await import("./byok/aiByok");
    byok = await resolveAiByokClient(orgId);
  } catch {
    byok = null;
  }
  if (byok) return byok;
  throw new AiAllowanceExhaustedError(orgId, gate.spent, gate.allowance, gate.byokAvailable);
}
