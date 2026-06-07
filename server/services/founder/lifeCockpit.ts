/**
 * lifeCockpit — Founder Life-Cockpit service layer (FOUNDER-SIDE ONLY).
 *
 * All reads/writes are scoped to a single founderUserId. Sensitive values are
 * encrypted at rest via vaultEncryption before they touch the DB and decrypted
 * only on authorized founder reads. NOTHING here is ever logged with a plaintext
 * value, and this data must NEVER feed any customer feature (Quinn's rule).
 */

import { and, desc, eq } from "drizzle-orm";

import { db } from "../../db";
import {
  founderTaxProfile,
  founderDocuments,
  founderObligations,
  founderIncomeSources,
  type FounderObligation,
} from "@shared/schema";
import {
  encryptDocumentBytes,
  decryptDocumentBytes,
  encryptAmount,
  decryptAmount,
  currentEncryptionKid,
} from "./vaultEncryption";

// ─── Tax profile ───────────────────────────────────────────────────────────────

export async function getTaxProfile(founderUserId: string, taxYear: number) {
  const rows = await db
    .select()
    .from(founderTaxProfile)
    .where(
      and(
        eq(founderTaxProfile.founderUserId, founderUserId),
        eq(founderTaxProfile.taxYear, taxYear),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertTaxProfile(input: {
  founderUserId: string;
  taxYear: number;
  filingStatus: string;
  state: string;
  hasSpouse: boolean;
  notes?: string | null;
}) {
  const now = new Date();
  const existing = await getTaxProfile(input.founderUserId, input.taxYear);
  if (existing) {
    const [row] = await db
      .update(founderTaxProfile)
      .set({
        filingStatus: input.filingStatus,
        state: input.state,
        hasSpouse: input.hasSpouse,
        notes: input.notes ?? null,
        updatedAt: now,
      })
      .where(eq(founderTaxProfile.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(founderTaxProfile)
    .values({
      founderUserId: input.founderUserId,
      taxYear: input.taxYear,
      filingStatus: input.filingStatus,
      state: input.state,
      hasSpouse: input.hasSpouse,
      notes: input.notes ?? null,
    })
    .returning();
  return row;
}

// ─── Documents (encrypted vault) ─────────────────────────────────────────────────

/** Metadata-only view — NEVER includes the encrypted blob or any plaintext. */
export async function listDocuments(founderUserId: string) {
  const rows = await db
    .select({
      id: founderDocuments.id,
      docType: founderDocuments.docType,
      label: founderDocuments.label,
      taxYear: founderDocuments.taxYear,
      fileName: founderDocuments.fileName,
      mimeType: founderDocuments.mimeType,
      byteSize: founderDocuments.byteSize,
      createdAt: founderDocuments.createdAt,
    })
    .from(founderDocuments)
    .where(eq(founderDocuments.founderUserId, founderUserId))
    .orderBy(desc(founderDocuments.createdAt));
  return rows;
}

export async function createDocument(input: {
  founderUserId: string;
  docType: string;
  label: string;
  taxYear?: number | null;
  fileName?: string | null;
  mimeType?: string | null;
  bytes: Buffer;
}) {
  const encryptedBlob = encryptDocumentBytes(input.bytes);
  const [row] = await db
    .insert(founderDocuments)
    .values({
      founderUserId: input.founderUserId,
      docType: input.docType,
      label: input.label,
      taxYear: input.taxYear ?? null,
      encryptedBlob,
      encryptionKid: currentEncryptionKid(),
      fileName: input.fileName ?? null,
      mimeType: input.mimeType ?? null,
      byteSize: input.bytes.length,
    })
    .returning({
      id: founderDocuments.id,
      docType: founderDocuments.docType,
      label: founderDocuments.label,
      taxYear: founderDocuments.taxYear,
      fileName: founderDocuments.fileName,
      mimeType: founderDocuments.mimeType,
      byteSize: founderDocuments.byteSize,
      createdAt: founderDocuments.createdAt,
    });
  return row;
}

/** Authorized founder download — returns decrypted bytes + metadata. */
export async function getDocumentBytes(founderUserId: string, id: number) {
  const rows = await db
    .select()
    .from(founderDocuments)
    .where(
      and(
        eq(founderDocuments.id, id),
        eq(founderDocuments.founderUserId, founderUserId),
      ),
    )
    .limit(1);
  const doc = rows[0];
  if (!doc) return null;
  return {
    bytes: decryptDocumentBytes(doc.encryptedBlob),
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    label: doc.label,
  };
}

export async function deleteDocument(founderUserId: string, id: number): Promise<boolean> {
  const deleted = await db
    .delete(founderDocuments)
    .where(
      and(
        eq(founderDocuments.id, id),
        eq(founderDocuments.founderUserId, founderUserId),
      ),
    )
    .returning({ id: founderDocuments.id });
  return deleted.length > 0;
}

// ─── Obligations ─────────────────────────────────────────────────────────────────

export async function listObligations(founderUserId: string): Promise<FounderObligation[]> {
  return db
    .select()
    .from(founderObligations)
    .where(eq(founderObligations.founderUserId, founderUserId))
    .orderBy(desc(founderObligations.dueDate));
}

export async function createObligation(input: {
  founderUserId: string;
  title: string;
  obligationType: string;
  dueDate?: Date | null;
  notes?: string | null;
}) {
  const [row] = await db
    .insert(founderObligations)
    .values({
      founderUserId: input.founderUserId,
      title: input.title,
      obligationType: input.obligationType,
      dueDate: input.dueDate ?? null,
      notes: input.notes ?? null,
    })
    .returning();
  return row;
}

export async function updateObligation(
  founderUserId: string,
  id: number,
  patch: { title?: string; obligationType?: string; dueDate?: Date | null; status?: string; notes?: string | null },
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.obligationType !== undefined) set.obligationType = patch.obligationType;
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.notes !== undefined) set.notes = patch.notes;
  const [row] = await db
    .update(founderObligations)
    .set(set)
    .where(
      and(
        eq(founderObligations.id, id),
        eq(founderObligations.founderUserId, founderUserId),
      ),
    )
    .returning();
  return row ?? null;
}

export async function deleteObligation(founderUserId: string, id: number): Promise<boolean> {
  const deleted = await db
    .delete(founderObligations)
    .where(
      and(
        eq(founderObligations.id, id),
        eq(founderObligations.founderUserId, founderUserId),
      ),
    )
    .returning({ id: founderObligations.id });
  return deleted.length > 0;
}

// ─── Income sources ──────────────────────────────────────────────────────────────

/** Returns decrypted whole-dollar amounts — authorized founder read only. */
export async function listIncomeSources(founderUserId: string, taxYear: number) {
  const rows = await db
    .select()
    .from(founderIncomeSources)
    .where(
      and(
        eq(founderIncomeSources.founderUserId, founderUserId),
        eq(founderIncomeSources.taxYear, taxYear),
      ),
    )
    .orderBy(founderIncomeSources.sourceType);
  return rows.map((r) => ({
    id: r.id,
    taxYear: r.taxYear,
    sourceType: r.sourceType,
    label: r.label,
    amount: decryptAmount(r.encryptedAmount),
    withholdingAtSource: r.withholdingAtSource,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function createIncomeSource(input: {
  founderUserId: string;
  taxYear: number;
  sourceType: string;
  label: string;
  amount?: number | null;
  withholdingAtSource: boolean;
  notes?: string | null;
}) {
  const [row] = await db
    .insert(founderIncomeSources)
    .values({
      founderUserId: input.founderUserId,
      taxYear: input.taxYear,
      sourceType: input.sourceType,
      label: input.label,
      encryptedAmount:
        input.amount === null || input.amount === undefined ? null : encryptAmount(input.amount),
      encryptionKid: currentEncryptionKid(),
      withholdingAtSource: input.withholdingAtSource,
      notes: input.notes ?? null,
    })
    .returning({ id: founderIncomeSources.id });
  return row;
}

export async function updateIncomeSource(
  founderUserId: string,
  id: number,
  patch: {
    sourceType?: string;
    label?: string;
    amount?: number | null;
    withholdingAtSource?: boolean;
    notes?: string | null;
  },
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.sourceType !== undefined) set.sourceType = patch.sourceType;
  if (patch.label !== undefined) set.label = patch.label;
  if (patch.amount !== undefined) {
    set.encryptedAmount = patch.amount === null ? null : encryptAmount(patch.amount);
    set.encryptionKid = currentEncryptionKid();
  }
  if (patch.withholdingAtSource !== undefined) set.withholdingAtSource = patch.withholdingAtSource;
  if (patch.notes !== undefined) set.notes = patch.notes;
  const [row] = await db
    .update(founderIncomeSources)
    .set(set)
    .where(
      and(
        eq(founderIncomeSources.id, id),
        eq(founderIncomeSources.founderUserId, founderUserId),
      ),
    )
    .returning({ id: founderIncomeSources.id });
  return row ?? null;
}

export async function deleteIncomeSource(founderUserId: string, id: number): Promise<boolean> {
  const deleted = await db
    .delete(founderIncomeSources)
    .where(
      and(
        eq(founderIncomeSources.id, id),
        eq(founderIncomeSources.founderUserId, founderUserId),
      ),
    )
    .returning({ id: founderIncomeSources.id });
  return deleted.length > 0;
}
