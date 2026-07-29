/**
 * Investor Verification (KYC) — marketplace satellite.
 *
 * State machine: pending → reviewing → approved | rejected | more_info_needed
 * (more_info_needed re-enters via submitForReview).
 *
 * DB-BACKED (Wave A "Nothing lies", founder ruling #12(c), 2026-07-29):
 * verification requests previously lived in a module-level Map with a
 * per-process id counter — KYC state vanished on every restart/deploy and
 * split across machines (deletion-ledger "Module-state residue", audit
 * 2026-07-07: "must be DB-backed before any marketplace reactivation").
 * Requests now live in `investor_verification_requests`; the old
 * write-only backgroundJobs "durability" record (never read back) is gone.
 *
 * Storage is injectable so tests can prove state survives service
 * re-instantiation without a database; the default storage is Drizzle.
 */

import { db } from "../db";
import {
  investorProfiles,
  investorVerificationRequests,
} from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { logger } from "../utils/logger";

// State machine: pending → reviewing → approved | rejected | more_info_needed
type VerificationStatus = "pending" | "reviewing" | "approved" | "rejected" | "more_info_needed";

export interface VerificationDocument {
  docType: string;
  fileData: any;
  uploadedAt: Date | string;
}

export interface VerificationHistoryEntry {
  status: VerificationStatus;
  changedAt: Date | string;
  changedBy?: number;
  note?: string;
}

export interface VerificationRequestRecord {
  id: number;
  investorProfileId: number;
  orgId: number;
  status: VerificationStatus;
  documents: VerificationDocument[];
  submittedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewedBy?: number | null;
  decision?: string | null;
  reason?: string | null;
  accreditationData?: { netWorth: number; annualIncome: number } | null;
  history: VerificationHistoryEntry[];
  createdAt: Date;
}

/**
 * Persistence seam. The DB is the source of truth — no request state may
 * live only in process memory.
 */
export interface InvestorVerificationStorage {
  /** Latest request in an active (pending | reviewing) status for a profile. */
  findActiveRequest(investorProfileId: number): Promise<VerificationRequestRecord | undefined>;
  insertRequest(values: {
    investorProfileId: number;
    orgId: number;
    status: VerificationStatus;
    documents: VerificationDocument[];
    history: VerificationHistoryEntry[];
  }): Promise<VerificationRequestRecord>;
  getRequest(id: number): Promise<VerificationRequestRecord | undefined>;
  updateRequest(
    id: number,
    updates: Partial<Omit<VerificationRequestRecord, "id" | "investorProfileId" | "orgId" | "createdAt">>,
  ): Promise<VerificationRequestRecord | undefined>;
  /** All requests for a profile, newest first. */
  listRequestsByProfile(investorProfileId: number): Promise<VerificationRequestRecord[]>;
  /** Requests for an org in the given statuses, newest first. */
  listRequestsByOrg(orgId: number, statuses: VerificationStatus[]): Promise<VerificationRequestRecord[]>;
  /** Whether the investor profile carries the verified flag. */
  isProfileVerified(investorProfileId: number): Promise<boolean>;
  /** Set the verified flag on the investor profile. */
  markProfileVerified(investorProfileId: number): Promise<void>;
}

// ─── Default Drizzle-backed storage ───────────────────────────────────────────

type RequestRow = typeof investorVerificationRequests.$inferSelect;

function rowToRecord(row: RequestRow): VerificationRequestRecord {
  return {
    id: row.id,
    investorProfileId: row.investorProfileId,
    orgId: row.organizationId,
    status: row.status as VerificationStatus,
    documents: (row.documents ?? []) as VerificationDocument[],
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    reviewedBy: row.reviewedBy,
    decision: row.decision,
    reason: row.reason,
    accreditationData: row.accreditationData ?? null,
    history: (row.history ?? []) as VerificationHistoryEntry[],
    createdAt: row.createdAt,
  };
}

/** jsonb round-trips Dates as ISO strings — normalize before writing. */
function isoDocuments(docs: VerificationDocument[]): Array<{ docType: string; fileData: any; uploadedAt: string }> {
  return docs.map((d) => ({
    docType: d.docType,
    fileData: d.fileData,
    uploadedAt: d.uploadedAt instanceof Date ? d.uploadedAt.toISOString() : d.uploadedAt,
  }));
}

function isoHistory(history: VerificationHistoryEntry[]): Array<{ status: string; changedAt: string; changedBy?: number; note?: string }> {
  return history.map((h) => ({
    status: h.status,
    changedAt: h.changedAt instanceof Date ? h.changedAt.toISOString() : h.changedAt,
    ...(h.changedBy !== undefined ? { changedBy: h.changedBy } : {}),
    ...(h.note !== undefined ? { note: h.note } : {}),
  }));
}

export const drizzleInvestorVerificationStorage: InvestorVerificationStorage = {
  async findActiveRequest(investorProfileId) {
    const [row] = await db
      .select()
      .from(investorVerificationRequests)
      .where(
        and(
          eq(investorVerificationRequests.investorProfileId, investorProfileId),
          inArray(investorVerificationRequests.status, ["pending", "reviewing"]),
        ),
      )
      .orderBy(desc(investorVerificationRequests.createdAt))
      .limit(1);
    return row ? rowToRecord(row) : undefined;
  },

  async insertRequest(values) {
    const [row] = await db
      .insert(investorVerificationRequests)
      .values({
        investorProfileId: values.investorProfileId,
        organizationId: values.orgId,
        status: values.status,
        documents: isoDocuments(values.documents),
        history: isoHistory(values.history),
      })
      .returning();
    return rowToRecord(row);
  },

  async getRequest(id) {
    const [row] = await db
      .select()
      .from(investorVerificationRequests)
      .where(eq(investorVerificationRequests.id, id))
      .limit(1);
    return row ? rowToRecord(row) : undefined;
  },

  async updateRequest(id, updates) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.status !== undefined) set.status = updates.status;
    if (updates.documents !== undefined) set.documents = isoDocuments(updates.documents);
    if (updates.history !== undefined) set.history = isoHistory(updates.history);
    if (updates.submittedAt !== undefined) set.submittedAt = updates.submittedAt;
    if (updates.reviewedAt !== undefined) set.reviewedAt = updates.reviewedAt;
    if (updates.reviewedBy !== undefined) set.reviewedBy = updates.reviewedBy;
    if (updates.decision !== undefined) set.decision = updates.decision;
    if (updates.reason !== undefined) set.reason = updates.reason;
    if (updates.accreditationData !== undefined) set.accreditationData = updates.accreditationData;
    const [row] = await db
      .update(investorVerificationRequests)
      .set(set)
      .where(eq(investorVerificationRequests.id, id))
      .returning();
    return row ? rowToRecord(row) : undefined;
  },

  async listRequestsByProfile(investorProfileId) {
    const rows = await db
      .select()
      .from(investorVerificationRequests)
      .where(eq(investorVerificationRequests.investorProfileId, investorProfileId))
      .orderBy(desc(investorVerificationRequests.createdAt));
    return rows.map(rowToRecord);
  },

  async listRequestsByOrg(orgId, statuses) {
    const rows = await db
      .select()
      .from(investorVerificationRequests)
      .where(
        and(
          eq(investorVerificationRequests.organizationId, orgId),
          inArray(investorVerificationRequests.status, statuses),
        ),
      )
      .orderBy(desc(investorVerificationRequests.createdAt));
    return rows.map(rowToRecord);
  },

  async isProfileVerified(investorProfileId) {
    const [profile] = await db
      .select({ isVerified: investorProfiles.isVerified })
      .from(investorProfiles)
      .where(eq(investorProfiles.id, investorProfileId))
      .limit(1);
    return profile?.isVerified === true;
  },

  async markProfileVerified(investorProfileId) {
    await db
      .update(investorProfiles)
      .set({ isVerified: true, verifiedAt: new Date() })
      .where(eq(investorProfiles.id, investorProfileId));
  },
};

// ─── Service ──────────────────────────────────────────────────────────────────

export class InvestorVerificationService {
  private readonly storage: InvestorVerificationStorage;

  constructor(storage: InvestorVerificationStorage = drizzleInvestorVerificationStorage) {
    this.storage = storage;
  }

  /**
   * Create a new KYC verification request for an investor profile.
   * Idempotent while an active (pending/reviewing) request exists.
   */
  async createVerificationRequest(investorProfileId: number, orgId: number) {
    const existing = await this.storage.findActiveRequest(investorProfileId);
    if (existing) {
      return existing;
    }

    const now = new Date();
    const request = await this.storage.insertRequest({
      investorProfileId,
      orgId,
      status: "pending",
      documents: [],
      history: [{ status: "pending", changedAt: now }],
    });

    logger.info("[InvestorVerification] Verification request created", {
      metadata: { verificationId: request.id, investorProfileId, orgId },
    });
    return request;
  }

  /**
   * Upload a document to the verification request
   */
  async uploadDocument(verificationId: number, docType: string, fileData: any) {
    const request = await this.storage.getRequest(verificationId);
    if (!request) throw new Error(`Verification ${verificationId} not found`);
    if (!["pending", "more_info_needed"].includes(request.status)) {
      throw new Error(`Cannot upload documents in status: ${request.status}`);
    }

    const uploadedAt = new Date();
    await this.storage.updateRequest(verificationId, {
      documents: [...request.documents, { docType, fileData, uploadedAt }],
    });
    return { verificationId, docType, uploadedAt };
  }

  /**
   * Submit verification for review — moves to 'reviewing'
   */
  async submitForReview(verificationId: number) {
    const request = await this.storage.getRequest(verificationId);
    if (!request) throw new Error(`Verification ${verificationId} not found`);
    if (request.documents.length === 0) {
      throw new Error("At least one document required before submission");
    }
    if (!["pending", "more_info_needed"].includes(request.status)) {
      throw new Error(`Cannot submit from status: ${request.status}`);
    }

    const submittedAt = new Date();
    await this.storage.updateRequest(verificationId, {
      status: "reviewing",
      submittedAt,
      history: [
        ...request.history,
        { status: "reviewing", changedAt: submittedAt, note: `Transitioned from ${request.status}` },
      ],
    });

    return { verificationId, status: "reviewing", submittedAt };
  }

  /**
   * Admin reviews and decides on the verification
   */
  async reviewVerification(
    verificationId: number,
    adminId: number,
    decision: "approved" | "rejected" | "more_info_needed",
    reason?: string
  ) {
    const request = await this.storage.getRequest(verificationId);
    if (!request) throw new Error(`Verification ${verificationId} not found`);
    if (request.status !== "reviewing") {
      throw new Error(`Cannot review verification in status: ${request.status}`);
    }

    const reviewedAt = new Date();
    await this.storage.updateRequest(verificationId, {
      status: decision,
      reviewedAt,
      reviewedBy: adminId,
      decision,
      reason,
      history: [
        ...request.history,
        { status: decision, changedAt: reviewedAt, changedBy: adminId, note: reason },
      ],
    });

    // If approved, update the investor profile
    if (decision === "approved") {
      await this.storage.markProfileVerified(request.investorProfileId);
    }

    logger.info("[InvestorVerification] Verification reviewed", {
      metadata: { verificationId, decision, adminId },
    });
    return { verificationId, status: decision, reviewedAt };
  }

  /**
   * Get the current verification status for an investor profile
   */
  async getVerificationStatus(investorProfileId: number) {
    const [request] = await this.storage.listRequestsByProfile(investorProfileId);

    if (!request) {
      return { investorProfileId, status: "not_started", verificationId: null };
    }

    return {
      investorProfileId,
      verificationId: request.id,
      status: request.status,
      documentsUploaded: request.documents.length,
      submittedAt: request.submittedAt ?? undefined,
      reviewedAt: request.reviewedAt ?? undefined,
      reason: request.reason ?? undefined,
    };
  }

  /**
   * Check if the investor has passed verification (gate check)
   */
  async checkVerificationGate(investorProfileId: number): Promise<boolean> {
    // Check the profile's verified flag first
    if (await this.storage.isProfileVerified(investorProfileId)) return true;

    // Fall back to an approved request that hasn't been reflected on the profile
    const requests = await this.storage.listRequestsByProfile(investorProfileId);
    return requests.some((r) => r.status === "approved");
  }

  /**
   * Run accreditation check based on net worth / income thresholds (SEC Rule 501)
   */
  async accreditationCheck(
    investorProfileId: number,
    data: { netWorth: number; annualIncome: number }
  ) {
    // SEC accredited investor thresholds (2024)
    const NET_WORTH_THRESHOLD = 1_000_000; // $1M excluding primary residence
    const INCOME_THRESHOLD_SINGLE = 200_000;
    const INCOME_THRESHOLD_JOINT = 300_000;

    const isAccreditedByNetWorth = data.netWorth >= NET_WORTH_THRESHOLD;
    const isAccreditedByIncome = data.annualIncome >= INCOME_THRESHOLD_SINGLE;

    const isAccredited = isAccreditedByNetWorth || isAccreditedByIncome;

    // Store the attestation on the profile's latest request, if any
    const [request] = await this.storage.listRequestsByProfile(investorProfileId);
    if (request) {
      await this.storage.updateRequest(request.id, { accreditationData: data });
    }

    return {
      investorProfileId,
      isAccredited,
      qualifyingCriteria: {
        netWorth: isAccreditedByNetWorth,
        income: isAccreditedByIncome,
      },
      thresholdsApplied: {
        netWorth: NET_WORTH_THRESHOLD,
        incomeSingle: INCOME_THRESHOLD_SINGLE,
        incomeJoint: INCOME_THRESHOLD_JOINT,
      },
    };
  }

  /**
   * Get full verification history for an investor profile
   */
  async getVerificationHistory(investorProfileId: number) {
    const requests = await this.storage.listRequestsByProfile(investorProfileId);

    return requests.map((r) => ({
      verificationId: r.id,
      status: r.status,
      documentsCount: r.documents.length,
      createdAt: r.createdAt,
      submittedAt: r.submittedAt ?? undefined,
      reviewedAt: r.reviewedAt ?? undefined,
      reviewedBy: r.reviewedBy ?? undefined,
      decision: r.decision ?? undefined,
      reason: r.reason ?? undefined,
      history: r.history,
    }));
  }

  /**
   * List an org's verification requests (admin queue). Defaults to the
   * active statuses an admin needs to act on.
   */
  async listVerifications(
    orgId: number,
    statuses: VerificationStatus[] = ["pending", "reviewing", "more_info_needed"]
  ) {
    const requests = await this.storage.listRequestsByOrg(orgId, statuses);
    return requests.map((r) => ({
      verificationId: r.id,
      investorProfileId: r.investorProfileId,
      status: r.status,
      documentsUploaded: r.documents.length,
      createdAt: r.createdAt,
      submittedAt: r.submittedAt ?? undefined,
    }));
  }
}

export const investorVerificationService = new InvestorVerificationService();
