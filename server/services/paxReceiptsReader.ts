/**
 * "What Pax did" — the ONE reader behind GET /api/pax/receipts
 * (AUTONOMY_SPEC.md §4.7).
 *
 * server/services/paxReceipts.ts is the attributed WRITER: every effect Pax
 * or a customer's rule has lands in `activity_log` with `agent_type = 'pax'`
 * and a `metadata.receipt = "pax_effect"` marker carrying who acted, how,
 * under which stance and from which lane. This module reads that table back
 * for the page's "What Pax did" section, the overflow menu and
 * `/activity?actor=pax` — one query, org-scoped, newest first, cursor-paged.
 *
 * Rows written BEFORE the receipt writer existed (the per-case
 * `logActivity({ agentType: "pax" })` calls, the old `pax_value_event`) carry
 * no marker. They are still Pax's history, so they are listed too, with the
 * fields the row does not carry left null — never guessed: an old row with
 * `metadata.witnessed === true` reads as "asked", any other as "ran on its
 * own", and its origin / group are null.
 *
 * The executed sends are joined to `pax_sends` by pendingActionId so a
 * receipt for a witnessed send can say which channel it left on and when —
 * both from the append-only audit row, never re-derived.
 *
 * Pure read: no pause / stance read here (the state is attribution on the
 * row, captured at write time), no side effects.
 */

import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { activityLog, paxSends } from "@shared/schema";
import { PAX_RECEIPT_WORDS } from "@shared/pax-glossary";

/** The third column of a receipt row, as the API spells it. */
export type PaxReceiptMode = "asked" | "on_its_own" | "rule";

export interface PaxReceiptItem {
  id: number;
  /** ISO timestamp of the effect. */
  at: string;
  actor: "pax" | "rule";
  /** The ask lane or "engine"; null on rows written before the receipt writer. */
  origin: string | null;
  /** Capability group (PAX_TOOL_GROUPS); null when unknown. */
  group: string | null;
  mode: PaxReceiptMode;
  /** The glossary word for `mode` — "asked" / "ran on its own" / "rule". */
  modeLabel: string;
  action: string;
  entityType: string;
  entityId: number;
  entityLabel?: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  pendingActionId?: number;
  /** The append-only pax_sends row for a witnessed send, when one exists. */
  sent?: { channel: string; recipientRef: string | null; sentAt: string | null };
}

export interface PaxReceiptsPage {
  items: PaxReceiptItem[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const RECEIPT_KIND = "pax_effect";

/** Opaque, order-preserving cursor: the last row's (createdAt, id). */
function encodeCursor(row: { createdAt: Date | null; id: number }): string {
  const at = row.createdAt instanceof Date ? row.createdAt.getTime() : 0;
  return Buffer.from(`${at}:${row.id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined | null): { at: Date; id: number } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const [atStr, idStr] = raw.split(":");
    const at = Number(atStr);
    const id = Number(idStr);
    if (!Number.isFinite(at) || !Number.isInteger(id)) return null;
    return { at: new Date(at), id };
  } catch {
    return null;
  }
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit as number)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit as number)), MAX_LIMIT);
}

const modeOf = (meta: Record<string, unknown>): PaxReceiptMode => {
  if (meta.receipt === RECEIPT_KIND) {
    switch (meta.how) {
      case "asked":
        return "asked";
      case "rule":
        return "rule";
      default:
        return "on_its_own";
    }
  }
  // A pre-receipt row: the only attribution it carries is the witnessed flag.
  return meta.witnessed === true || meta.approvedByHuman === true ? "asked" : "on_its_own";
};

const MODE_LABEL: Record<PaxReceiptMode, string> = {
  asked: PAX_RECEIPT_WORDS.asked,
  on_its_own: PAX_RECEIPT_WORDS.onItsOwn,
  rule: PAX_RECEIPT_WORDS.rule,
};

const intOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) ? v : null;

/**
 * One page of the org's receipts, newest first. `cursor` is the
 * `nextCursor` of the previous page; a malformed cursor reads as "from the
 * top" rather than failing the page.
 */
export async function listPaxReceipts(
  organizationId: number,
  opts: { limit?: number; cursor?: string | null } = {},
): Promise<PaxReceiptsPage> {
  const limit = clampLimit(opts.limit);
  const after = decodeCursor(opts.cursor);

  const scope = and(eq(activityLog.organizationId, organizationId), eq(activityLog.agentType, "pax"));
  const where = after
    ? and(
        scope,
        or(
          lt(activityLog.createdAt, after.at),
          and(eq(activityLog.createdAt, after.at), lt(activityLog.id, after.id)),
        ),
      )
    : scope;

  const rows = await db
    .select()
    .from(activityLog)
    .where(where)
    .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? encodeCursor(page[page.length - 1]) : null;

  // Witnessed sends: join to the append-only audit by pendingActionId, in
  // ONE org-scoped query for the page.
  const pendingIds = page
    .map((r) => intOrNull((r.metadata as Record<string, unknown> | null)?.pendingActionId))
    .filter((id): id is number => id !== null);
  const sends = new Map<number, { channel: string; recipientRef: string | null; sentAt: Date | null }>();
  if (pendingIds.length > 0) {
    const sendRows = await db
      .select({
        pendingActionId: paxSends.pendingActionId,
        channel: paxSends.channel,
        recipientRef: paxSends.recipientRef,
        sentAt: paxSends.sentAt,
      })
      .from(paxSends)
      .where(and(eq(paxSends.organizationId, organizationId), inArray(paxSends.pendingActionId, pendingIds)));
    for (const s of sendRows) {
      if (!sends.has(s.pendingActionId)) {
        sends.set(s.pendingActionId, { channel: s.channel, recipientRef: s.recipientRef, sentAt: s.sentAt });
      }
    }
  }

  const items: PaxReceiptItem[] = page.map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const isReceipt = meta.receipt === RECEIPT_KIND;
    const changes = (r.changes ?? null) as { before?: unknown; after?: unknown } | null;
    const mode = modeOf(meta);
    const pendingActionId = intOrNull(meta.pendingActionId) ?? undefined;
    const sent = pendingActionId !== undefined ? sends.get(pendingActionId) : undefined;
    return {
      id: r.id,
      at: r.createdAt instanceof Date ? r.createdAt.toISOString() : new Date(0).toISOString(),
      actor: isReceipt && meta.actor === "rule" ? "rule" : "pax",
      origin: isReceipt && typeof meta.origin === "string" ? meta.origin : null,
      group: isReceipt && typeof meta.group === "string" ? meta.group : null,
      mode,
      modeLabel: MODE_LABEL[mode],
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      summary: r.description ?? r.action,
      ...(changes && changes.before !== undefined ? { before: changes.before } : {}),
      ...(changes && changes.after !== undefined ? { after: changes.after } : {}),
      ...(pendingActionId !== undefined ? { pendingActionId } : {}),
      ...(sent
        ? {
            sent: {
              channel: sent.channel,
              recipientRef: sent.recipientRef,
              sentAt: sent.sentAt instanceof Date ? sent.sentAt.toISOString() : null,
            },
          }
        : {}),
    };
  });

  return { items, nextCursor };
}

/**
 * Counts for the digest and the controls page — every number a COUNT over
 * receipt rows in a window, never a running tally kept elsewhere.
 *   recordChanges  Pax changed a record on its own ("ran on its own")
 *   rulesRan       a rule the customer turned on acted
 *   approvedSends  a human tapped and the send went out (a pax_sends row)
 */
export async function countPaxEffects(
  organizationId: number,
  since: Date,
): Promise<{ recordChanges: number; rulesRan: number; approvedSends: number }> {
  const [row] = await db
    .select({
      recordChanges: sql<number>`count(*) filter (where ${activityLog.metadata}->>'how' = 'onItsOwn')::int`,
      rulesRan: sql<number>`count(*) filter (where ${activityLog.metadata}->>'how' = 'rule')::int`,
    })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.organizationId, organizationId),
        eq(activityLog.agentType, "pax"),
        sql`${activityLog.createdAt} >= ${since}`,
      ),
    );
  const [sends] = await db
    .select({ approvedSends: sql<number>`count(*)::int` })
    .from(paxSends)
    .where(and(eq(paxSends.organizationId, organizationId), sql`${paxSends.sentAt} >= ${since}`));
  return {
    recordChanges: Number(row?.recordChanges ?? 0),
    rulesRan: Number(row?.rulesRan ?? 0),
    approvedSends: Number(sends?.approvedSends ?? 0),
  };
}
