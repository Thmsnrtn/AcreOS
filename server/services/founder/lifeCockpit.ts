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
  founderTaxReturns,
  type FounderObligation,
} from "@shared/schema";
import {
  encryptDocumentBytes,
  decryptDocumentBytes,
  encryptAmount,
  decryptAmount,
  currentEncryptionKid,
} from "./vaultEncryption";
import { decrypt, encrypt } from "../fieldEncryption";
import {
  computeDraftReturn,
  type DraftReturn,
  type TaxEngineIncomeInput,
} from "./taxEngine";
import type { FilingStatus } from "./taxRules";
import { buildSelfFilePackage, type SelfFilePackage } from "./taxPackage";

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
    federalWithheld: decryptAmount(r.encryptedFederalWithheld),
    stateWithheld: decryptAmount(r.encryptedStateWithheld),
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
  federalWithheld?: number | null;
  stateWithheld?: number | null;
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
      encryptedFederalWithheld:
        input.federalWithheld === null || input.federalWithheld === undefined
          ? null
          : encryptAmount(input.federalWithheld),
      encryptedStateWithheld:
        input.stateWithheld === null || input.stateWithheld === undefined
          ? null
          : encryptAmount(input.stateWithheld),
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
    federalWithheld?: number | null;
    stateWithheld?: number | null;
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
  if (patch.federalWithheld !== undefined) {
    set.encryptedFederalWithheld =
      patch.federalWithheld === null ? null : encryptAmount(patch.federalWithheld);
    set.encryptionKid = currentEncryptionKid();
  }
  if (patch.stateWithheld !== undefined) {
    set.encryptedStateWithheld =
      patch.stateWithheld === null ? null : encryptAmount(patch.stateWithheld);
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

// ─── Draft return + self-file package ──────────────────────────────────────────
//
// computeAndStoreDraft reads the founder's tax profile + decrypted income +
// withholding, runs the pure taxEngine, persists the computed draft ENCRYPTED in
// founder_tax_returns (a new version each time), and returns the in-memory draft
// + the generated self-file package. NOTHING dollar-valued is logged or stored
// in plaintext. This is self-prepared DRAFT software — never IRS e-file.

export interface DraftResult {
  /** The computed federal + MA draft (line-by-line with basis). */
  draft: DraftReturn;
  /** The transcription-ready self-file package (text/markdown). */
  package: SelfFilePackage;
  /** The stored row id + version for this draft, if persisted. */
  returnId: number | null;
  version: number;
  status: string;
  /**
   * True when there is not enough captured data to compute (no income / no
   * profile). The UI shows a "capture income first" empty state.
   */
  ready: boolean;
  /** Human reason when not ready. */
  reason?: string;
}

/**
 * Compute the draft from current data and persist it as a new version.
 * @param persist when false, computes + returns without writing a new row
 *   (used by the read-only GET so opening the tab doesn't spam versions).
 */
export async function computeAndStoreDraft(
  founderUserId: string,
  taxYear: number,
  persist: boolean,
): Promise<DraftResult> {
  const profile = await getTaxProfile(founderUserId, taxYear);
  const incomeRows = await listIncomeSources(founderUserId, taxYear);

  const filingStatus = (profile?.filingStatus ?? "married_joint") as FilingStatus;
  const state = (profile?.state ?? "MA").toUpperCase();

  const usableIncome = incomeRows.filter((r) => (r.amount ?? 0) > 0);
  if (usableIncome.length === 0) {
    // Compute an empty draft anyway (all-zero, honest), but flag not-ready so
    // the UI nudges the founder to capture income first.
    const emptyDraft = computeDraftReturn({ taxYear, filingStatus, state, income: [] });
    return {
      draft: emptyDraft,
      package: buildSelfFilePackage(emptyDraft),
      returnId: null,
      version: 0,
      status: "draft",
      ready: false,
      reason:
        "No income captured for this year yet. Add your W-2 / 1099 amounts in the Income tab, then generate your draft.",
    };
  }

  const engineIncome: TaxEngineIncomeInput[] = usableIncome.map((r) => ({
    sourceType: r.sourceType,
    label: r.label,
    amount: r.amount ?? 0,
    withholdingAtSource: r.withholdingAtSource,
    federalWithheld: r.federalWithheld ?? 0,
    stateWithheld: r.stateWithheld ?? 0,
  }));

  const draft = computeDraftReturn({ taxYear, filingStatus, state, income: engineIncome });
  const pkg = buildSelfFilePackage(draft);

  if (!persist) {
    const latest = await getLatestReturnMeta(founderUserId, taxYear);
    return {
      draft,
      package: pkg,
      returnId: latest?.id ?? null,
      version: latest?.version ?? 0,
      status: latest?.status ?? "draft",
      ready: true,
    };
  }

  // Persist as a new version. Encrypt the full payload + headline figures.
  const nextVersion = (await getMaxVersion(founderUserId, taxYear)) + 1;
  const [stored] = await db
    .insert(founderTaxReturns)
    .values({
      founderUserId,
      taxYear,
      version: nextVersion,
      filingStatus,
      state,
      encryptedPayload: encrypt(JSON.stringify(draft)),
      encryptionKid: currentEncryptionKid(),
      encryptedFederalTotalTax: encryptAmount(draft.federal.summary.totalTax),
      encryptedFederalRefundOrOwed: encryptAmount(draft.federal.summary.refundOrOwed),
      encryptedStateTotalTax:
        draft.massachusetts === null ? null : encryptAmount(draft.massachusetts.summary.totalTax),
      encryptedStateRefundOrOwed:
        draft.massachusetts === null
          ? null
          : encryptAmount(draft.massachusetts.summary.refundOrOwed),
      provisional: draft.provisional,
      status: "draft",
    })
    .returning({ id: founderTaxReturns.id, version: founderTaxReturns.version, status: founderTaxReturns.status });

  return {
    draft,
    package: pkg,
    returnId: stored?.id ?? null,
    version: stored?.version ?? nextVersion,
    status: stored?.status ?? "draft",
    ready: true,
  };
}

async function getMaxVersion(founderUserId: string, taxYear: number): Promise<number> {
  const rows = await db
    .select({ version: founderTaxReturns.version })
    .from(founderTaxReturns)
    .where(
      and(
        eq(founderTaxReturns.founderUserId, founderUserId),
        eq(founderTaxReturns.taxYear, taxYear),
      ),
    )
    .orderBy(desc(founderTaxReturns.version))
    .limit(1);
  return rows[0]?.version ?? 0;
}

async function getLatestReturnMeta(founderUserId: string, taxYear: number) {
  const rows = await db
    .select({
      id: founderTaxReturns.id,
      version: founderTaxReturns.version,
      status: founderTaxReturns.status,
    })
    .from(founderTaxReturns)
    .where(
      and(
        eq(founderTaxReturns.founderUserId, founderUserId),
        eq(founderTaxReturns.taxYear, taxYear),
      ),
    )
    .orderBy(desc(founderTaxReturns.version))
    .limit(1);
  return rows[0] ?? null;
}

/** Metadata-only history of stored drafts — NEVER decrypts the payload. */
export async function listReturnHistory(founderUserId: string, taxYear: number) {
  const rows = await db
    .select({
      id: founderTaxReturns.id,
      version: founderTaxReturns.version,
      filingStatus: founderTaxReturns.filingStatus,
      state: founderTaxReturns.state,
      provisional: founderTaxReturns.provisional,
      status: founderTaxReturns.status,
      createdAt: founderTaxReturns.createdAt,
    })
    .from(founderTaxReturns)
    .where(
      and(
        eq(founderTaxReturns.founderUserId, founderUserId),
        eq(founderTaxReturns.taxYear, taxYear),
      ),
    )
    .orderBy(desc(founderTaxReturns.version));
  return rows;
}

/** Authorized founder read of a stored draft (decrypts the payload). */
export async function getStoredDraft(
  founderUserId: string,
  id: number,
): Promise<{ draft: DraftReturn; package: SelfFilePackage; status: string; version: number } | null> {
  const rows = await db
    .select()
    .from(founderTaxReturns)
    .where(
      and(eq(founderTaxReturns.id, id), eq(founderTaxReturns.founderUserId, founderUserId)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const draft = JSON.parse(decrypt(row.encryptedPayload)) as DraftReturn;
  return {
    draft,
    package: buildSelfFilePackage(draft),
    status: row.status,
    version: row.version,
  };
}

const RETURN_STATUSES = new Set(["draft", "reviewed", "filed"]);

/** Update a stored draft's workflow status (draft → reviewed → filed). */
export async function updateReturnStatus(
  founderUserId: string,
  id: number,
  status: string,
): Promise<boolean> {
  if (!RETURN_STATUSES.has(status)) return false;
  const updated = await db
    .update(founderTaxReturns)
    .set({ status, updatedAt: new Date() })
    .where(
      and(eq(founderTaxReturns.id, id), eq(founderTaxReturns.founderUserId, founderUserId)),
    )
    .returning({ id: founderTaxReturns.id });
  return updated.length > 0;
}
