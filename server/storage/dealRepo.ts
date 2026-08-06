// Deals (CRUD + bulk + pagination + auto-checklist hook).
// Extracted from the god-class server/storage.ts.

import { and, asc, desc, eq, sql, count, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  deals, properties,
  type Deal, type InsertDeal,
} from "@shared/schema";
import type { DatabaseStorage, PaginationOptions, PaginatedResult } from "../storage";
import { logger } from "../utils/logger";
import { publishDealLifecycle } from "../services/dealLifecycleEvents";
import { LIST_READ_CAP, capListRead } from "./listCap";

export const dealRepo = {
  async getDeals(this: DatabaseStorage, orgId: number): Promise<Deal[]> {
    // Task 223: exclude soft-deleted deals from list queries
    // Audit F-10-2: loud cap — truncation past the cap is logged, not silent.
    const rows = await db.select().from(deals)
      .where(and(eq(deals.organizationId, orgId), sql`${deals.status} != 'deleted'`))
      .orderBy(desc(deals.createdAt))
      .limit(LIST_READ_CAP + 1);
    return capListRead(rows, LIST_READ_CAP, "getDeals", orgId);
  },

  async getDealsPaginated(this: DatabaseStorage, orgId: number, options: PaginationOptions): Promise<PaginatedResult<Deal>> {
    const whereClause = and(eq(deals.organizationId, orgId), sql`${deals.status} != 'deleted'`);
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
  async createDeal(this: DatabaseStorage, deal: InsertDeal & { organizationId: number }): Promise<Deal> {
    const [newDeal] = await db.insert(deals).values(deal).returning();
    // Jarvis 2.1 (audit G2): a new deal is a perception event. Fire-and-forget
    // — publishDealLifecycle never throws, so a mesh outage can't fail the create.
    if (newDeal) publishDealLifecycle(newDeal.organizationId, null, newDeal);
    return newDeal;
  },

  async updateDeal(this: DatabaseStorage, id: number, updates: Partial<InsertDeal>, expectedUpdatedAt?: Date, organizationId?: number): Promise<Deal> {
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
      .where(eq(deals.id, id));

    const [updated] = await db.update(deals)
      .set({ ...updates, updatedAt: new Date() })
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

      const triggerStatuses = new Set(["accepted", "under_contract", "in_escrow"]);
      if (triggerStatuses.has(updated.status ?? "")) {
        void this._autoGenerateClosingChecklist(updated.id, before?.propertyId ?? null).catch((err) => {
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
  async _autoGenerateClosingChecklist(this: DatabaseStorage, dealId: number, propertyId: number | null): Promise<void> {
    const existing = await this.getDealChecklist(dealId);
    if (existing) return;
    // Pull property state for state-specific checklist (stateDocumentConfig).
    let state = "TX";
    if (propertyId) {
      try {
        const [prop] = await db.select({ state: properties.state })
          .from(properties)
          .where(eq(properties.id, propertyId))
          .limit(1);
        if (prop?.state && prop.state.length === 2) state = prop.state.toUpperCase();
      } catch {}
    }
    const closingDate = new Date();
    closingDate.setDate(closingDate.getDate() + 30);
    const { generateClosingChecklist } = await import("../services/closingChecklistGenerator");
    await generateClosingChecklist(dealId, state, closingDate, false).catch(() => {});
  },

  async bulkDeleteDeals(this: DatabaseStorage, orgId: number, ids: number[]): Promise<number> {
    // Task 223: Soft delete — set status='deleted' rather than hard-deleting
    if (ids.length === 0) return 0;
    await db.update(deals)
      .set({ status: "deleted", updatedAt: new Date() })
      .where(and(eq(deals.organizationId, orgId), inArray(deals.id, ids)));
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
    // should see. Capture pre-images only when status is actually changing;
    // read failure degrades to "no events" (never fails the mutation).
    let beforeRows: Array<{ id: number; status: string | null; acceptedAmount: string | null; offerAmount: string | null }> = [];
    if (updates.status !== undefined) {
      try {
        beforeRows = await db
          .select({ id: deals.id, status: deals.status, acceptedAmount: deals.acceptedAmount, offerAmount: deals.offerAmount })
          .from(deals)
          .where(and(eq(deals.organizationId, orgId), inArray(deals.id, ids)));
      } catch (err) {
        logger.warn(`[storage.bulkUpdateDeals] lifecycle pre-image read skipped: ${(err as Error)?.message}`);
      }
    }

    await db.update(deals)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(deals.organizationId, orgId), inArray(deals.id, ids)));

    for (const before of beforeRows) {
      if (before.status === updates.status) continue; // no transition
      publishDealLifecycle(orgId, before, { ...before, ...updates, id: before.id });
    }

    return ids.length;
  },
};

export type DealRepo = typeof dealRepo;
