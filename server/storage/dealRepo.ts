// Deals (CRUD + bulk + pagination + auto-checklist hook).
// Extracted from the god-class server/storage.ts.

import { and, asc, count, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { omitProtectedFields } from "../utils/updatePayload";
import { db, type PrimaryDb } from "../db";
import {
  deals, properties,
  type Deal, type InsertDeal,
} from "@shared/schema";
import type { DatabaseStorage, PaginationOptions, PaginatedResult } from "../storage";
import { logger } from "../utils/logger";
import { publishDealLifecycle, recordDealTransitionEvidence } from "../services/dealLifecycleEvents";
import { LIST_READ_CAP, capListRead } from "./listCap";

import { ADMINISTRATIVE_DEAL_STATUSES, isDealStatus, validateDealTransition } from "@shared/lifecycle/pipeline-status";
import { clock } from "../utils/clock";

/**
 * A deal status write the state machine refuses. Thrown by the repository —
 * the last line, where every status write passes (audit of 9ed61f4: PUT,
 * PATCH /stage and Pax update_deal each checked a copy of the table, or
 * nothing, and a deleted deal passed them all). Routes validate first and
 * answer 400; reaching this is a writer that forgot to.
 */
export class DealTransitionRefusedError extends Error {
  constructor(readonly dealId: number, readonly refusal: string) {
    super(`Deal ${dealId}: ${refusal}`);
    this.name = "DealTransitionRefusedError";
  }
}

/**
 * The state machine's verdict on a status write. `backwardUndo` is the bulk
 * undo's reverse move — it may go backwards (that is its purpose) but still
 * only to a real stage and never out of an administrative status.
 */
function dealStatusRefusal(current: string | null | undefined, next: string, opts: { backwardUndo?: boolean }): string | null {
  if (current === next) return null;
  if (opts.backwardUndo) {
    if (!isDealStatus(next)) return `"${next}" is not a valid deal status`;
    if ((ADMINISTRATIVE_DEAL_STATUSES as readonly string[]).includes(current ?? "")) return `A ${current} deal cannot change stage`;
    return null;
  }
  return validateDealTransition(current, next);
}
export const dealRepo = {
  async getDeals(this: DatabaseStorage, orgId: number): Promise<Deal[]> {
    // Task 223: exclude soft-deleted deals from list queries
    // Audit F-10-2: loud cap — truncation past the cap is logged, not silent.
    const rows = await db.select().from(deals)
      .where(and(eq(deals.organizationId, orgId), notInArray(deals.status, [...ADMINISTRATIVE_DEAL_STATUSES])))
      .orderBy(desc(deals.createdAt))
      .limit(LIST_READ_CAP + 1);
    return capListRead(rows, LIST_READ_CAP, "getDeals", orgId);
  },

  async getDealsPaginated(this: DatabaseStorage, orgId: number, options: PaginationOptions, filters?: { book?: "client" | "own_investment" }): Promise<PaginatedResult<Deal>> {
    // agent_investor book filter (migration 0226). 'client' includes legacy-null
    // rows (a null book was always a client deal); 'own_investment' matches only
    // the explicitly tagged own-book deals.
    const bookClause =
      filters?.book === "own_investment"
        ? sql`${deals.dealBook} = 'own_investment'`
        : filters?.book === "client"
        ? sql`(${deals.dealBook} = 'client' OR ${deals.dealBook} IS NULL)`
        : undefined;
    const whereClause = and(eq(deals.organizationId, orgId), notInArray(deals.status, [...ADMINISTRATIVE_DEAL_STATUSES]), bookClause);
    const [{ count: total }] = await db.select({ count: count() }).from(deals).where(whereClause);
    const totalNum = Number(total);
    const totalPages = Math.max(1, Math.ceil(totalNum / options.pageSize));
    const offset = (options.page - 1) * options.pageSize;

    const sortColumn = (deals as any)[options.sortBy] ?? deals.createdAt;
    const orderFn = options.sortOrder === "asc" ? asc : desc;

    const data = await db.select().from(deals)
      .where(whereClause)
      .orderBy(orderFn(sortColumn))
      .limit(options.pageSize)
      .offset(offset);

    return { data, total: totalNum, page: options.page, pageSize: options.pageSize, totalPages };
  },

  async getDeal(this: DatabaseStorage, orgId: number, id: number): Promise<Deal | undefined> {
    const [deal] = await db.select().from(deals)
      .where(and(eq(deals.organizationId, orgId), eq(deals.id, id)));
    return deal;
  },

  // organizationId is omitted from InsertDeal (set server-side) but the DB
  // column is NOT NULL — callers supply it, so it is required here.
  /**
   * @param tx  Executor for the INSERT. Defaults to the global handle; a
   *              caller inside `withTransaction` passes its `tx` so the write
   *              actually joins the transaction rather than opening a second
   *              connection beside it.
   */
  async createDeal(
    this: DatabaseStorage,
    deal: InsertDeal & { organizationId: number },
    tx: PrimaryDb = db,
  ): Promise<Deal> {
    const [newDeal] = await tx.insert(deals).values(deal).returning();
    // Jarvis 2.1 (audit G2): a new deal is a perception event. Fire-and-forget
    // — publishDealLifecycle never throws, so a mesh outage can't fail the create.
    //
    // ONLY WHEN THIS IS THE WHOLE WRITE. Inside a transaction the row is not
    // committed yet and the caller may still roll it back, so announcing here
    // would publish a deal that never existed. Transactional callers announce
    // after the transaction returns — routes-deals.ts does exactly that for
    // emitDealCreated already.
    if (newDeal && tx === db) publishDealLifecycle(newDeal.organizationId, null, newDeal);
    return newDeal;
  },

  async updateDeal(
    this: DatabaseStorage,
    id: number,
    updates: Partial<InsertDeal>,
    expectedUpdatedAt?: Date,
    organizationId?: number,
    opts: { backwardUndo?: boolean } = {},
  ): Promise<Deal> {
    // Task 219: Optimistic locking — if the caller provides an expectedUpdatedAt timestamp,
    // only apply the update when the row still has that timestamp (prevents lost-update
    // races between concurrent requests).
    const conditions = [eq(deals.id, id)];
    if (organizationId) conditions.push(eq(deals.organizationId, organizationId));
    if (expectedUpdatedAt) conditions.push(eq(deals.updatedAt, expectedUpdatedAt));
    const whereClause = and(...conditions);

    // Capture pre-update status so the post-update hook can tell
    // whether the status actually transitioned (vs. other field updates).
    const [before] = await db.select({ status: deals.status, propertyId: deals.propertyId })
      .from(deals)
      .where(organizationId ? and(eq(deals.id, id), eq(deals.organizationId, organizationId)) : eq(deals.id, id));

    if (updates.status !== undefined && before) {
      const refusal = dealStatusRefusal(before.status, String(updates.status), opts);
      if (refusal) throw new DealTransitionRefusedError(id, refusal);
    }

    const [updated] = await db.update(deals)
      .set({ ...omitProtectedFields(updates), updatedAt: clock.now() })
      .where(whereClause!)
      .returning();

    if (!updated && expectedUpdatedAt) {
      // Row existed but timestamp didn't match — concurrent modification detected
      throw new Error(
        "Deal was modified by another request. Please reload and retry your changes."
      );
    }

    // Autonomy hook: when a deal transitions to an actionable closing
    // status (accepted / under_contract / in_escrow) and no checklist
    // exists yet, generate one automatically. State-specific via
    // stateDocumentConfig. Keeps the closing workflow from getting
    // stuck on "who's supposed to create this checklist."
    if (updated && before?.status !== updated.status) {
      // Jarvis 2.1 (audit G2): every genuine stage transition is a perception
      // event (deal:updated, or deal:closed on won/lost). Fire-and-forget —
      // never fails the mutation. Requires a real pre-image: without one we
      // can't honestly claim a from→to transition, so we publish nothing.
      if (before) publishDealLifecycle(updated.organizationId, before, updated);
      // The transition's evidence (first offer made; a reopened sale
      // retracted) — here, where every status write passes.
      recordDealTransitionEvidence(updated.organizationId, before, updated);

      const triggerStatuses = new Set(["accepted", "under_contract", "in_escrow"]);
      if (triggerStatuses.has(updated.status ?? "")) {
        // The deal's CURRENT property, org and closing date (DEFECT-0176):
        // this passed the pre-update property, so a deal corrected to a new
        // parcel generated the old parcel's state rules.
        void this._autoGenerateClosingChecklist(updated.id, updated.propertyId ?? null, updated.organizationId, updated.closingDate ?? null).catch((err) => {
          // Never let a hook failure break the primary update.
          logger.warn(`[storage.updateDeal] auto-checklist skipped: ${err?.message}`);
        });
      }
    }

    return updated;
  },

  /**
   * Fire-and-forget: generate a closing checklist if none exists.
   * Called from updateDeal's post-update hook on status transitions
   * into accepted / under_contract / in_escrow.
   * Underscore prefix preserves the pre-extraction "private" intent —
   * mixin methods cannot be physically marked `private`, but treat as such.
   */
  async _autoGenerateClosingChecklist(
    this: DatabaseStorage,
    dealId: number,
    propertyId: number | null,
    organizationId: number,
    closingDate: Date | null,
  ): Promise<void> {
    const existing = await this.getDealChecklist(organizationId, dealId);
    // A template-started checklist still needs the closing items
    // (DEFECT-0180); only a row that already holds them is done.
    if (existing?.items.some((i) => i.phase)) return;
    // No guessed facts (DEFECT-0176): this fell back to "TX" and a closing
    // date 30 days out, and the generator then returned that checklist
    // forever — due dates computed from a date nobody agreed and one state's
    // rules for another state's parcel. Without a real state and closing
    // date it now waits; POST /api/deals/:id/closing-checklist generates it
    // once those facts exist.
    let state: string | null = null;
    if (propertyId) {
      const [prop] = await db.select({ state: properties.state })
        .from(properties)
        .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)))
        .limit(1);
      if (prop?.state && prop.state.length === 2) state = prop.state.toUpperCase();
    }
    if (!state || !closingDate) {
      logger.info(`[storage.updateDeal] closing checklist deferred for deal ${dealId}: ${!state ? "no property state" : "no closing date"} yet`);
      return;
    }
    const { generateClosingChecklist } = await import("../services/closingChecklistGenerator");
    await generateClosingChecklist(dealId, state, closingDate, false);
  },

  async bulkDeleteDeals(this: DatabaseStorage, orgId: number, ids: number[]): Promise<number> {
    // Task 223: Soft delete — set status='deleted' rather than hard-deleting
    if (ids.length === 0) return 0;
    // A deleted closed deal is not a sale: its recorded comp is retracted.
    const closedBefore = await db.select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.organizationId, orgId), inArray(deals.id, ids), eq(deals.status, "closed")));
    await db.update(deals)
      .set({ status: "deleted", updatedAt: clock.now() })
      .where(and(eq(deals.organizationId, orgId), inArray(deals.id, ids)));
    for (const d of closedBefore) recordDealTransitionEvidence(orgId, { status: "closed" }, { id: d.id, status: "deleted" });
    return ids.length;
  },

  async getDealsByIds(this: DatabaseStorage, orgId: number, ids: number[]): Promise<Deal[]> {
    if (ids.length === 0) return [];
    return await db.select().from(deals)
      .where(and(eq(deals.organizationId, orgId), inArray(deals.id, ids)));
  },

  async bulkUpdateDeals(this: DatabaseStorage, orgId: number, ids: number[], updates: Partial<InsertDeal>): Promise<number> {
    if (ids.length === 0) return 0;

    // Jarvis 2.1 (audit G2): a bulk stage move is N real transitions the brain
    // should see. Capture pre-images only when status is actually changing.
    // The pre-image is also what the state machine checks, so a failed read
    // fails the write — it used to degrade to "no events", which would now
    // mean "no check" (audit of 9ed61f4).
    let beforeRows: Array<{ id: number; status: string | null; acceptedAmount: string | null; offerAmount: string | null }> = [];
    if (updates.status !== undefined) {
      beforeRows = await db
        .select({ id: deals.id, status: deals.status, acceptedAmount: deals.acceptedAmount, offerAmount: deals.offerAmount })
        .from(deals)
        .where(and(eq(deals.organizationId, orgId), inArray(deals.id, ids)));
    }

    if (updates.status !== undefined) {
      for (const before of beforeRows) {
        const refusal = dealStatusRefusal(before.status, String(updates.status), {});
        if (refusal) throw new DealTransitionRefusedError(before.id, refusal);
      }
    }

    await db.update(deals)
      .set({ ...omitProtectedFields(updates), updatedAt: clock.now() })
      .where(and(eq(deals.organizationId, orgId), inArray(deals.id, ids)));

    for (const before of beforeRows) {
      if (before.status === updates.status) continue; // no transition
      publishDealLifecycle(orgId, before, { ...before, ...updates, id: before.id });
      recordDealTransitionEvidence(orgId, before, { ...before, ...updates, id: before.id });
    }

    return ids.length;
  },
};

export type DealRepo = typeof dealRepo;
