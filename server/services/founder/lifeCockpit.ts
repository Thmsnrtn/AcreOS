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
  founderEstimatedPayments,
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
import { TAX_ADVISORY_COPY } from "../../utils/taxAdvisory";
import {
  computeDraftReturn,
  type DraftReturn,
  type TaxEngineIncomeInput,
} from "./taxEngine";
import type { FilingStatus } from "./taxRules";
import { buildSelfFilePackage, type SelfFilePackage } from "./taxPackage";
import {
  computeEstimatedTaxRadar,
  type EstimatedTaxRadar,
  type PriorYearLiability,
  type QuarterPaidInput,
} from "./estimatedTax";

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

// ─── Quarterly estimated-tax radar ─────────────────────────────────────────────
//
// The radar reuses computeDraftReturn (current year) + an optional prior-year
// liability (from the most-recent stored prior-year draft) + any quarters the
// founder has marked paid, then runs the pure safe-harbor engine. It stays quiet
// ($0) until there is non-withheld income that withholding doesn't already cover.
// NOTHING dollar-valued is logged; payments are stored encrypted.

const ESTIMATE_JURISDICTIONS = new Set(["federal", "massachusetts"]);

/**
 * Derive the prior-year liability (federal + MA total tax + AGI) from the most
 * recent stored draft for (taxYear − 1), if one exists. Decrypts the headline
 * figures + the payload's AGI line — authorized founder read only, never logged.
 */
export async function getPriorYearLiability(
  founderUserId: string,
  taxYear: number,
): Promise<PriorYearLiability | null> {
  const rows = await db
    .select()
    .from(founderTaxReturns)
    .where(
      and(
        eq(founderTaxReturns.founderUserId, founderUserId),
        eq(founderTaxReturns.taxYear, taxYear - 1),
      ),
    )
    .orderBy(desc(founderTaxReturns.version))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const federalTotalTax = decryptAmount(row.encryptedFederalTotalTax);
  const stateTotalTax = decryptAmount(row.encryptedStateTotalTax);

  // AGI lives only in the full payload; decrypt it to pick the high-income
  // (110%) safe-harbor multiplier honestly. Falls back to null on any parse miss.
  let agi: number | null = null;
  try {
    const draft = JSON.parse(decrypt(row.encryptedPayload)) as DraftReturn;
    agi = draft.federal?.summary?.adjustedGrossIncome ?? null;
  } catch {
    agi = null;
  }

  return { federalTotalTax, stateTotalTax, agi };
}

/** Decrypted quarters the founder has marked paid for the year. Founder read only. */
export async function listEstimatedPayments(
  founderUserId: string,
  taxYear: number,
): Promise<QuarterPaidInput[]> {
  const rows = await db
    .select()
    .from(founderEstimatedPayments)
    .where(
      and(
        eq(founderEstimatedPayments.founderUserId, founderUserId),
        eq(founderEstimatedPayments.taxYear, taxYear),
      ),
    );
  return rows
    .filter((r) => r.jurisdiction === "federal" || r.jurisdiction === "massachusetts")
    .map((r) => ({
      quarter: r.quarter,
      jurisdiction: r.jurisdiction as "federal" | "massachusetts",
      amountPaid: decryptAmount(r.encryptedAmountPaid) ?? 0,
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
    }));
}

/**
 * Mark (or update) a quarter as paid. Upserts on the unique
 * (founder, year, jurisdiction, quarter) key; amount is stored encrypted.
 * Pass amountPaid = 0 / null to CLEAR a paid marker (delete the row).
 */
export async function markEstimatedPaymentPaid(input: {
  founderUserId: string;
  taxYear: number;
  jurisdiction: string;
  quarter: number;
  amountPaid: number | null;
  paidAt?: Date | null;
  notes?: string | null;
}): Promise<boolean> {
  if (!ESTIMATE_JURISDICTIONS.has(input.jurisdiction)) return false;
  if (!Number.isInteger(input.quarter) || input.quarter < 1 || input.quarter > 4) return false;

  // Clearing a marker → delete the row so the quarter reverts to upcoming/overdue.
  if (input.amountPaid === null || input.amountPaid <= 0) {
    await db
      .delete(founderEstimatedPayments)
      .where(
        and(
          eq(founderEstimatedPayments.founderUserId, input.founderUserId),
          eq(founderEstimatedPayments.taxYear, input.taxYear),
          eq(founderEstimatedPayments.jurisdiction, input.jurisdiction),
          eq(founderEstimatedPayments.quarter, input.quarter),
        ),
      );
    return true;
  }

  const now = new Date();
  await db
    .insert(founderEstimatedPayments)
    .values({
      founderUserId: input.founderUserId,
      taxYear: input.taxYear,
      jurisdiction: input.jurisdiction,
      quarter: input.quarter,
      encryptedAmountPaid: encryptAmount(input.amountPaid),
      encryptionKid: currentEncryptionKid(),
      paidAt: input.paidAt ?? now,
      notes: input.notes ?? null,
    })
    .onConflictDoUpdate({
      target: [
        founderEstimatedPayments.founderUserId,
        founderEstimatedPayments.taxYear,
        founderEstimatedPayments.jurisdiction,
        founderEstimatedPayments.quarter,
      ],
      set: {
        encryptedAmountPaid: encryptAmount(input.amountPaid),
        encryptionKid: currentEncryptionKid(),
        paidAt: input.paidAt ?? now,
        notes: input.notes ?? null,
        updatedAt: now,
      },
    });
  return true;
}

export interface EstimatedTaxRadarResult {
  radar: EstimatedTaxRadar;
  /** True when there is enough captured income to compute a meaningful radar. */
  ready: boolean;
  reason?: string;
  /**
   * Beatrice / compliance-debt §4 — centralized "informational, not tax advice"
   * framing for the founder tax cockpit's estimated-tax radar. Render adjacent
   * to the computed quarterly figures.
   */
  disclaimer: string;
}

/**
 * Compute the quarterly estimated-tax radar for the year. Reuses the draft-return
 * engine (current year) + prior-year liability + paid markers. When no income is
 * captured the radar is computed empty (all-zero, quiet) and flagged not-ready so
 * the UI nudges the founder to capture income first.
 */
export async function computeEstimatedTaxRadarForFounder(
  founderUserId: string,
  taxYear: number,
): Promise<EstimatedTaxRadarResult> {
  const profile = await getTaxProfile(founderUserId, taxYear);
  const incomeRows = await listIncomeSources(founderUserId, taxYear);
  const filingStatus = (profile?.filingStatus ?? "married_joint") as FilingStatus;
  const state = (profile?.state ?? "MA").toUpperCase();

  const usableIncome = incomeRows.filter((r) => (r.amount ?? 0) > 0);
  const [priorYear, paid] = await Promise.all([
    getPriorYearLiability(founderUserId, taxYear),
    listEstimatedPayments(founderUserId, taxYear),
  ]);

  const engineIncome: TaxEngineIncomeInput[] = usableIncome.map((r) => ({
    sourceType: r.sourceType,
    label: r.label,
    amount: r.amount ?? 0,
    withholdingAtSource: r.withholdingAtSource,
    federalWithheld: r.federalWithheld ?? 0,
    stateWithheld: r.stateWithheld ?? 0,
  }));

  const draft = computeDraftReturn({ taxYear, filingStatus, state, income: engineIncome });
  const radar = computeEstimatedTaxRadar({ taxYear, filingStatus, draft, priorYear, paid });

  // Mirror active quarterly estimates into the obligations/Deadlines tab so they
  // show alongside other deadlines. Idempotent: one obligation per (year,
  // jurisdiction, quarter), keyed by a stable title prefix. No dollar figures in
  // the title — amounts live only in the encrypted radar.
  await syncEstimatedTaxObligations(founderUserId, taxYear, radar);

  return {
    radar,
    ready: usableIncome.length > 0,
    reason:
      usableIncome.length === 0
        ? "No income captured for this year yet. Add your income in the Income tab — the radar lights up once there's non-withheld income (an AcreOS draw or side income)."
        : undefined,
    disclaimer: TAX_ADVISORY_COPY,
  };
}

/**
 * Keep founder_obligations in sync with the ACTIVE quarterly estimates so they
 * appear in the Deadlines tab. Creates one open obligation per active, not-yet-
 * paid quarter (idempotent on a stable title), and removes obligations for
 * quarters that are no longer due (paid, or radar went quiet). No dollar figure
 * in any title — only the deadline + jurisdiction + quarter.
 */
async function syncEstimatedTaxObligations(
  founderUserId: string,
  taxYear: number,
  radar: EstimatedTaxRadar,
): Promise<void> {
  const TITLE_PREFIX = `Estimated tax · ${taxYear} ·`;
  const jurisdictions = [radar.federal, radar.massachusetts].filter(
    (j): j is NonNullable<typeof j> => j !== null,
  );

  // The set of titles that SHOULD exist right now (active + unpaid quarters).
  const desired = new Map<string, { dueDate: Date }>();
  for (const j of jurisdictions) {
    if (!j.active) continue;
    const jLabel = j.jurisdiction === "federal" ? "Federal" : "MA";
    for (const q of j.quarters) {
      if (q.status === "paid" || q.amountDue <= 0) continue;
      const title = `${TITLE_PREFIX} ${jLabel} ${q.label}`.slice(0, 200);
      desired.set(title, { dueDate: new Date(`${q.dueDate}T00:00:00Z`) });
    }
  }

  // Existing auto-created estimate obligations for this year.
  const existing = await db
    .select({ id: founderObligations.id, title: founderObligations.title })
    .from(founderObligations)
    .where(eq(founderObligations.founderUserId, founderUserId));
  const existingByTitle = new Map(
    existing.filter((o) => o.title.startsWith(TITLE_PREFIX)).map((o) => [o.title, o.id]),
  );

  // Create the missing ones.
  for (const [title, { dueDate }] of desired) {
    if (!existingByTitle.has(title)) {
      await db.insert(founderObligations).values({
        founderUserId,
        title,
        obligationType: "tax",
        dueDate,
        status: "open",
        notes: "Auto-tracked from the quarterly-estimate radar. Amount is in the Income → radar tab (encrypted).",
      });
    }
  }

  // Delete obligations that no longer apply (paid / radar quiet).
  for (const [title, id] of existingByTitle) {
    if (!desired.has(title)) {
      await db
        .delete(founderObligations)
        .where(
          and(
            eq(founderObligations.id, id),
            eq(founderObligations.founderUserId, founderUserId),
          ),
        );
    }
  }
}
