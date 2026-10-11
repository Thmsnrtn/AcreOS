/**
 * Reversible lead imports (W5b). One batch = one file the customer imported;
 * it records the ids of the leads it CREATED (never rows it skipped), so the
 * customer can undo exactly that import and nothing else.
 *
 * UNDO is a soft delete through storage.bulkDeleteLeads (the same path as the
 * leads list's bulk delete: legal holds respected, restorable) and it KEEPS any
 * lead that has since become real work — contacted, moved past "new", or tied
 * to a property — and says which and why. It is the customer's own action on
 * rows their own import made; nothing here deletes data the customer did not
 * just create.
 *
 * Every query is scoped by organization id; a batch id from another org reads
 * as not found.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { leadImportBatches, leads, properties, type LeadImportBatch } from "@shared/schema";
import { storage } from "../../storage";
import { clock } from "../../utils/clock";

export async function createImportBatch(
  organizationId: number,
  userId: string | null,
  input: { sourceFormat: string; fileName: string | null; rowCount: number },
): Promise<LeadImportBatch> {
  const [row] = await db
    .insert(leadImportBatches)
    .values({
      organizationId,
      sourceFormat: input.sourceFormat,
      fileName: input.fileName,
      rowCount: input.rowCount,
      createdBy: userId,
    })
    .returning();
  return row;
}

/** The batch if it belongs to this org and has not been undone. */
export async function getOpenImportBatch(organizationId: number, batchId: number): Promise<LeadImportBatch | null> {
  const [row] = await db
    .select()
    .from(leadImportBatches)
    .where(and(eq(leadImportBatches.organizationId, organizationId), eq(leadImportBatches.id, batchId), isNull(leadImportBatches.undoneAt)))
    .limit(1);
  return row ?? null;
}

export async function recordImportIntoBatch(
  organizationId: number,
  batchId: number,
  input: { leadIds: number[]; imported: number; skipped: number; suppressed: number },
): Promise<void> {
  await db
    .update(leadImportBatches)
    .set({
      leadIds:
        input.leadIds.length > 0
          ? sql`${leadImportBatches.leadIds} || ARRAY[${sql.join(input.leadIds.map((id) => sql`${id}`), sql`, `)}]::integer[]`
          : sql`${leadImportBatches.leadIds}`,
      importedCount: sql`${leadImportBatches.importedCount} + ${input.imported}`,
      skippedCount: sql`${leadImportBatches.skippedCount} + ${input.skipped}`,
      suppressedCount: sql`${leadImportBatches.suppressedCount} + ${input.suppressed}`,
    })
    .where(and(eq(leadImportBatches.organizationId, organizationId), eq(leadImportBatches.id, batchId)));
}

export async function listImportBatches(organizationId: number, limit = 20) {
  return db
    .select({
      id: leadImportBatches.id,
      sourceFormat: leadImportBatches.sourceFormat,
      fileName: leadImportBatches.fileName,
      rowCount: leadImportBatches.rowCount,
      importedCount: leadImportBatches.importedCount,
      skippedCount: leadImportBatches.skippedCount,
      suppressedCount: leadImportBatches.suppressedCount,
      createdAt: leadImportBatches.createdAt,
      undoneAt: leadImportBatches.undoneAt,
      undoResult: leadImportBatches.undoResult,
    })
    .from(leadImportBatches)
    .where(eq(leadImportBatches.organizationId, organizationId))
    .orderBy(desc(leadImportBatches.createdAt))
    .limit(limit);
}

export type UndoOutcome =
  | { ok: true; removed: number; kept: Array<{ leadId: number; reason: string }> }
  | { ok: false; reason: "not_found" | "already_undone" };

export async function undoImportBatch(organizationId: number, batchId: number, userId: string | null): Promise<UndoOutcome> {
  const [batch] = await db
    .select()
    .from(leadImportBatches)
    .where(and(eq(leadImportBatches.organizationId, organizationId), eq(leadImportBatches.id, batchId)))
    .limit(1);
  if (!batch) return { ok: false, reason: "not_found" };
  if (batch.undoneAt) return { ok: false, reason: "already_undone" };

  const ids = batch.leadIds ?? [];
  const kept: Array<{ leadId: number; reason: string }> = [];
  let removable: number[] = [];
  if (ids.length > 0) {
    const rows = await db
      .select({ id: leads.id, status: leads.status, lastContactedAt: leads.lastContactedAt, deletedAt: leads.deletedAt })
      .from(leads)
      .where(and(eq(leads.organizationId, organizationId), inArray(leads.id, ids)));
    const linked = await db
      .select({ sellerId: properties.sellerId })
      .from(properties)
      .where(and(eq(properties.organizationId, organizationId), inArray(properties.sellerId, ids)));
    const linkedIds = new Set(linked.map((r) => r.sellerId));
    for (const r of rows) {
      if (r.deletedAt) continue; // already gone
      if (r.lastContactedAt) kept.push({ leadId: r.id, reason: "already contacted" });
      else if (r.status !== "new") kept.push({ leadId: r.id, reason: `moved to "${r.status}"` });
      else if (linkedIds.has(r.id)) kept.push({ leadId: r.id, reason: "linked to a property" });
      else removable.push(r.id);
    }
  }
  removable = Array.from(new Set(removable));
  const removed = removable.length > 0 ? await storage.bulkDeleteLeads(organizationId, removable, userId ?? undefined) : 0;
  if (removed < removable.length) {
    // bulkDeleteLeads drops ids under legal hold; say so rather than claim them.
    const heldCount = removable.length - removed;
    kept.push({ leadId: 0, reason: `${heldCount} lead${heldCount === 1 ? " is" : "s are"} under a legal hold` });
  }
  await db
    .update(leadImportBatches)
    .set({ undoneAt: clock.now(), undoneBy: userId, undoResult: { removed, kept } })
    .where(and(eq(leadImportBatches.organizationId, organizationId), eq(leadImportBatches.id, batchId)));
  return { ok: true, removed, kept };
}
