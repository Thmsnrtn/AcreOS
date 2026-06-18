/**
 * Founder Autopilot — land-native customer deal-success (T1).
 *
 * The flywheel that grows a land-investing SaaS isn't company chores — it's
 * customers CLOSING MORE DEALS. This is the deal-coach core: given a customer's
 * pipeline (leads/deals in their real statuses), it recommends the single
 * highest-leverage next action per the land-investing playbook, across every
 * investor type (flipper, wholesaler, note/seller-finance, buy-and-hold,
 * subdivide, tax-delinquent/auction).
 *
 * The expertise, encoded as transparent rules:
 *   - Money on the table (accepted / under contract) → DRIVE IT TO CLOSE. The
 *     deal you've already won is the one you most can't afford to let slip.
 *   - A warm negotiation going quiet is the #1 deal-killer → FOLLOW UP before it
 *     cools. Hotter + higher-value = more urgent.
 *   - A hot lead decays fast → REACH OUT TODAY.
 *   - A new, unworked lead → MAKE FIRST CONTACT.
 *   - A cold lead clogging the pipeline → REQUALIFY OR DROP.
 *
 * Pure + deterministic over a normalized shape (decoupled from the DB), so it's
 * exhaustively testable and reusable for both the customer-facing "next best
 * action" surface and the autopilot's activation/support moves.
 */

export interface DealSignal {
  id: string;
  /** Pipeline status as stored (seller or buyer vocabulary; matched loosely). */
  status: string;
  /** hot | warm | cold | dead | new (optional). */
  nurturingStage?: string | null;
  /** 0–100 lead score (optional). */
  score?: number | null;
  estimatedValueUsd?: number | null;
  /** Epoch ms of last outbound contact (optional). */
  lastContactedAt?: number | null;
  /** Epoch ms the deal was created. */
  createdAt?: number | null;
}

export type DealActionKind =
  | "advance_to_close"
  | "follow_up"
  | "contact_now"
  | "first_contact"
  | "requalify_or_drop";

export interface DealAction {
  dealId: string;
  kind: DealActionKind;
  priority: number; // lower = more urgent
  urgency: "high" | "medium" | "low";
  reason: string;
}

const DAY = 24 * 60 * 60 * 1000;
export const STALE_NEGOTIATION_DAYS = 7;
export const HOT_DECAY_DAYS = 2;
export const NEW_FIRST_CONTACT_DAYS = 1;
export const COLD_REQUALIFY_DAYS = 30;
export const HIGH_VALUE_USD = 25_000;

const COMMITTED = ["accepted", "under_contract", "under contract", "contract"];
const NEGOTIATION = ["negotiating", "responded", "interested", "qualified", "offer_sent", "offer", "counter", "countered"];
const NEW = ["new", "mailed"];
const TERMINAL = ["dead", "closed", "closed_won", "closed_lost", "won", "lost", "archived"];

function inSet(status: string, set: string[]): boolean {
  const s = (status || "").toLowerCase().trim();
  return set.includes(s);
}
function daysBetween(a: number | null | undefined, now: number): number | null {
  if (a == null) return null;
  return (now - a) / DAY;
}
function isHot(d: DealSignal): boolean {
  return (d.nurturingStage || "").toLowerCase() === "hot" || (d.score ?? 0) >= 80;
}
function isHighValue(d: DealSignal): boolean {
  return (d.estimatedValueUsd ?? 0) >= HIGH_VALUE_USD;
}

/** The single best next action for one deal, or null if none is warranted. Pure. */
export function scoreDealAction(d: DealSignal, now: number): DealAction | null {
  if (inSet(d.status, TERMINAL)) return null;

  // 1. Money on the table — drive it home.
  if (inSet(d.status, COMMITTED)) {
    return { dealId: d.id, kind: "advance_to_close", priority: 0, urgency: "high", reason: "Under contract / accepted — keep it moving to closing (title, due diligence, signatures)." };
  }

  const sinceContact = daysBetween(d.lastContactedAt, now);

  // 2. A warm negotiation going quiet — the #1 deal-killer.
  if (inSet(d.status, NEGOTIATION)) {
    if (sinceContact == null || sinceContact >= STALE_NEGOTIATION_DAYS) {
      const hv = isHighValue(d) || isHot(d);
      const n = sinceContact == null ? "with no contact logged" : `${Math.floor(sinceContact)} days since contact`;
      return { dealId: d.id, kind: "follow_up", priority: hv ? 1 : 2, urgency: hv ? "high" : "medium", reason: `In negotiation, ${n} — follow up before it cools.` };
    }
    return null; // recently touched + progressing
  }

  // 3. A hot lead decays fast.
  if (isHot(d)) {
    if (sinceContact == null || sinceContact >= HOT_DECAY_DAYS) {
      return { dealId: d.id, kind: "contact_now", priority: 2, urgency: "high", reason: "Hot lead with no recent contact — reach out today before it goes cold." };
    }
    return null;
  }

  // 4. A new, unworked lead.
  if (inSet(d.status, NEW)) {
    const age = daysBetween(d.createdAt, now);
    if (age == null || age >= NEW_FIRST_CONTACT_DAYS) {
      return { dealId: d.id, kind: "first_contact", priority: 3, urgency: "medium", reason: "New and unworked — make first contact." };
    }
    return null;
  }

  // 5. A cold lead clogging the pipeline.
  if ((d.nurturingStage || "").toLowerCase() === "cold") {
    if (sinceContact == null || sinceContact >= COLD_REQUALIFY_DAYS) {
      return { dealId: d.id, kind: "requalify_or_drop", priority: 5, urgency: "low", reason: "Cold for 30+ days — requalify with a fresh angle or drop it to keep the pipeline clean." };
    }
  }

  return null;
}

/**
 * Rank the next best actions across a pipeline. Pure. Sorted by urgency
 * (priority) then value, so the most leverage is first. `limit` trims to the
 * top actions (the founder/customer shouldn't drown).
 */
export function recommendNextActions(deals: DealSignal[], now: number, limit = 10): DealAction[] {
  const valueOf = new Map(deals.map((d) => [d.id, d.estimatedValueUsd ?? 0]));
  return deals
    .map((d) => scoreDealAction(d, now))
    .filter((a): a is DealAction => a != null)
    .sort((a, b) => a.priority - b.priority || (valueOf.get(b.dealId)! - valueOf.get(a.dealId)!))
    .slice(0, Math.max(0, limit));
}

/**
 * Adapter: read an org's open leads, normalize, and return the top next actions.
 * Thin DB seam over the pure core. Best-effort — never throws.
 */
export async function getDealActionsForOrg(organizationId: number, limit = 10): Promise<DealAction[]> {
  try {
    const { db } = await import("../../db");
    const { leads } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select({
        id: leads.id,
        status: leads.status,
        nurturingStage: leads.nurturingStage,
        score: leads.score,
        estimatedValue: leads.estimatedValue,
        lastContactedAt: leads.lastContactedAt,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .where(eq(leads.organizationId, organizationId))
      .limit(1000);
    const signals: DealSignal[] = rows.map((r) => ({
      id: String(r.id),
      status: r.status,
      nurturingStage: r.nurturingStage,
      score: r.score,
      estimatedValueUsd: r.estimatedValue != null ? Number(r.estimatedValue) : null,
      lastContactedAt: r.lastContactedAt ? new Date(r.lastContactedAt).getTime() : null,
      createdAt: r.createdAt ? new Date(r.createdAt).getTime() : null,
    }));
    return recommendNextActions(signals, Date.now(), limit);
  } catch {
    return [];
  }
}

// ── D4: surface the deal-coach to the customer (Deals door) ──────────────────

/** Human label for each action kind (customer-facing). Pure. */
const KIND_LABELS: Record<DealActionKind, string> = {
  advance_to_close: "Advance to close",
  follow_up: "Follow up",
  contact_now: "Contact now",
  first_contact: "Make first contact",
  requalify_or_drop: "Requalify or drop",
};
export function labelForKind(kind: DealActionKind): string {
  return KIND_LABELS[kind] ?? kind;
}

export interface DealCoachItem extends DealAction {
  /** Display name of the lead/deal the action is about. */
  leadName: string;
  /** Customer-facing label for the action kind. */
  label: string;
}

/**
 * The deal-coach for a customer org: the next-best actions enriched with the
 * lead's display name. Best-effort — degrades to a generic name (never throws),
 * mirroring getDealActionsForOrg.
 */
export async function getDealCoachForOrg(organizationId: number, limit = 8): Promise<DealCoachItem[]> {
  const actions = await getDealActionsForOrg(organizationId, limit);
  if (actions.length === 0) return [];
  try {
    const { db } = await import("../../db");
    const { leads } = await import("@shared/schema");
    const { and, eq, inArray } = await import("drizzle-orm");
    const ids = actions.map((a) => Number(a.dealId)).filter((n) => Number.isFinite(n));
    const rows = ids.length
      ? await db
          .select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName, email: leads.email })
          .from(leads)
          .where(and(eq(leads.organizationId, organizationId), inArray(leads.id, ids)))
      : [];
    const nameById = new Map(
      rows.map((r) => {
        const name = [r.firstName, r.lastName].filter(Boolean).join(" ").trim() || r.email || `Lead ${r.id}`;
        return [String(r.id), name];
      }),
    );
    return actions.map((a) => ({ ...a, leadName: nameById.get(a.dealId) ?? `Lead ${a.dealId}`, label: labelForKind(a.kind) }));
  } catch {
    return actions.map((a) => ({ ...a, leadName: `Lead ${a.dealId}`, label: labelForKind(a.kind) }));
  }
}
