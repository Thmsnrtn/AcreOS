/**
 * Founder Autopilot — standing orders + intents ("Your Voice").
 *
 * Durable natural-language policy the founder issues by speaking to the system:
 *  - intent          — a north-star goal ("reach $1k MRR sustainably").
 *  - standing_order  — a durable rule ("never email anyone twice in a week").
 *
 * The honest enforcement path in P0: every outward autopilot action composes
 * the ACTIVE orders into its dispatch prompt, so the acting agent is bound by
 * them from the first token (alongside the constitution + craft standard). Hard
 * mechanical enforcement of specific rules (rate limits, etc.) layers on later;
 * this makes the founder's voice load-bearing now without pretending it's more
 * than instruction-level.
 *
 * The compose helper is pure → unit-testable; the DB functions are thin.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { autopilotStandingOrders, type AutopilotStandingOrder } from "@shared/schema";
import { logger } from "../../utils/logger";

export const STANDING_ORDER_KINDS = ["standing_order", "intent"] as const;
export type StandingOrderKind = (typeof STANDING_ORDER_KINDS)[number];

export const STANDING_ORDER_MAX_LEN = 600;

export async function createStandingOrder(input: {
  kind: StandingOrderKind;
  body: string;
  createdBy?: string;
}): Promise<AutopilotStandingOrder> {
  const body = input.body.trim();
  if (!body) throw new Error("createStandingOrder: body must be non-empty");
  if (body.length > STANDING_ORDER_MAX_LEN) {
    throw new Error(`createStandingOrder: body exceeds ${STANDING_ORDER_MAX_LEN} chars`);
  }
  if (!STANDING_ORDER_KINDS.includes(input.kind)) {
    throw new Error(`createStandingOrder: unknown kind "${input.kind}"`);
  }
  const [row] = await db
    .insert(autopilotStandingOrders)
    .values({ kind: input.kind, body, createdBy: input.createdBy ?? null })
    .returning();
  logger.info("[autopilot] standing order created", { id: row?.id, kind: input.kind });
  return row;
}

export async function listStandingOrders(opts?: {
  kind?: StandingOrderKind;
  activeOnly?: boolean;
}): Promise<AutopilotStandingOrder[]> {
  const conds = [];
  if (opts?.kind) conds.push(eq(autopilotStandingOrders.kind, opts.kind));
  if (opts?.activeOnly) conds.push(eq(autopilotStandingOrders.active, true));
  const query = db.select().from(autopilotStandingOrders);
  const rows = conds.length
    ? await query.where(and(...conds)).orderBy(desc(autopilotStandingOrders.createdAt))
    : await query.orderBy(desc(autopilotStandingOrders.createdAt));
  return rows;
}

/** Soft-delete: deactivate (so it stops binding) without losing the history. */
export async function deactivateStandingOrder(id: number): Promise<{ ok: boolean }> {
  const res = await db
    .update(autopilotStandingOrders)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(autopilotStandingOrders.id, id))
    .returning({ id: autopilotStandingOrders.id });
  return { ok: res.length > 0 };
}

/**
 * Compose active orders into a prompt block the dispatch prepends. Pure +
 * total. Returns "" when there are none (so nothing is injected). Intents and
 * standing orders are labelled distinctly so the agent treats a goal as
 * direction and a rule as a hard constraint.
 */
export function composeStandingOrdersBlock(
  orders: Array<Pick<AutopilotStandingOrder, "kind" | "body">>,
): string {
  const active = orders.filter((o) => o.body && o.body.trim().length > 0);
  if (active.length === 0) return "";
  const intents = active.filter((o) => o.kind === "intent");
  const rules = active.filter((o) => o.kind === "standing_order");
  const lines: string[] = ["The founder has given you durable direction. Honor it:"];
  if (intents.length) {
    lines.push("Intents (the why — steer toward these):");
    for (const i of intents) lines.push(`  • ${i.body.trim()}`);
  }
  if (rules.length) {
    lines.push("Standing orders (hard rules — never violate):");
    for (const r of rules) lines.push(`  • ${r.body.trim()}`);
  }
  return lines.join("\n");
}
