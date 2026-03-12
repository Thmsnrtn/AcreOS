/**
 * Investor Verification Unit Tests
 *
 * Tests the investor verification state machine and business logic:
 * - State transitions (pending → reviewing → approved/rejected)
 * - Document upload validation
 * - Accreditation check logic (net worth / income thresholds)
 * - Admin review workflow
 * - Gate enforcement for verified vs. unverified investors
 */

import { describe, it, expect } from "vitest";

// ── Types mirroring InvestorVerificationService ───────────────────────────────

type VerificationStatus =
  | "pending"
  | "reviewing"
  | "approved"
  | "rejected"
  | "more_info_needed";

interface VerificationRequest {
  id: number;
  investorProfileId: number;
  orgId: number;
  status: VerificationStatus;
  documents: Array<{ docType: string; fileData: any; uploadedAt: Date }>;
  submittedAt?: Date;
  reviewedAt?: Date;
  reviewedBy?: number;
  decision?: string;
  reason?: string;
  accreditationData?: { netWorth: number; annualIncome: number };
  history: Array<{
    status: VerificationStatus;
    changedAt: Date;
    changedBy?: number;
    note?: string;
  }>;
  createdAt: Date;
}

// ── Pure helpers mirroring service logic ──────────────────────────────────────

function canUploadDocument(status: VerificationStatus): boolean {
  return status === "pending" || status === "more_info_needed";
}

function canSubmitForReview(request: VerificationRequest): { allowed: boolean; reason?: string } {
  if (request.documents.length === 0) {
    return { allowed: false, reason: "At least one document required before submission" };
  }
  if (request.status !== "pending" && request.status !== "more_info_needed") {
    return { allowed: false, reason: `Cannot submit from status: ${request.status}` };
  }
  return { allowed: true };
}

function transitionStatus(
  current: VerificationStatus,
  next: VerificationStatus
): { valid: boolean; reason?: string } {
  const validTransitions: Record<VerificationStatus, VerificationStatus[]> = {
    pending: ["reviewing"],
    reviewing: ["approved", "rejected", "more_info_needed"],
    more_info_needed: ["reviewing"],
    approved: [],
    rejected: [],
  };

  if (validTransitions[current].includes(next)) {
    return { valid: true };
  }
  return { valid: false, reason: `Cannot transition from ${current} to ${next}` };
}

function checkAccreditation(data: { netWorth: number; annualIncome: number }): {
  isAccredited: boolean;
  method: "net_worth" | "income" | "neither";
} {
  // SEC Rule 501 thresholds
  const NET_WORTH_THRESHOLD = 1_000_000; // excluding primary residence
  const INCOME_SINGLE_THRESHOLD = 200_000;
  const INCOME_JOINT_THRESHOLD = 300_000;

  if (data.netWorth >= NET_WORTH_THRESHOLD) {
    return { isAccredited: true, method: "net_worth" };
  }
  if (data.annualIncome >= INCOME_SINGLE_THRESHOLD) {
    return { isAccredited: true, method: "income" };
  }
  return { isAccredited: false, method: "neither" };
}

function validateDocument(docType: string, fileData: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const allowedTypes = ["drivers_license", "passport", "bank_statement", "tax_return", "w2", "brokerage_statement"];

  if (!allowedTypes.includes(docType)) {
    errors.push(`Document type '${docType}' is not accepted`);
  }

  if (!fileData) {
    errors.push("File data is required");
  } else {
    if (fileData.sizeBytes && fileData.sizeBytes > 10 * 1024 * 1024) {
      errors.push("File exceeds 10MB limit");
    }
    if (fileData.mimeType && !["application/pdf", "image/jpeg", "image/png"].includes(fileData.mimeType)) {
      errors.push("File must be PDF, JPEG, or PNG");
    }
  }

  return { valid: errors.length === 0, errors };
}

function enforceVerificationGate(
  status: VerificationStatus,
  requiredStatus: VerificationStatus = "approved"
): { allowed: boolean; reason?: string } {
  if (status === requiredStatus) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `Action requires ${requiredStatus} verification status. Current: ${status}`,
  };
}

function computeVerificationProgress(request: VerificationRequest): number {
  let progress = 0;
  if (request.documents.length > 0) progress += 30;
  if (request.documents.length >= 2) progress += 10;
  if (request.submittedAt) progress += 20;
  if (request.accreditationData) progress += 20;
  if (request.status === "reviewing") progress += 10;
  if (request.status === "approved") progress = 100;
  if (request.status === "rejected") progress = 100;
  return Math.min(100, progress);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Document Upload Validation", () => {
  it("accepts valid document types", () => {
    const result = validateDocument("drivers_license", { sizeBytes: 500_000, mimeType: "image/jpeg" });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects unknown document types", () => {
    const result = validateDocument("selfie_video", { sizeBytes: 500_000, mimeType: "video/mp4" });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("not accepted"))).toBe(true);
  });

  it("rejects files exceeding 10MB", () => {
    const result = validateDocument("passport", { sizeBytes: 11 * 1024 * 1024, mimeType: "application/pdf" });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("10MB"))).toBe(true);
  });

  it("rejects unsupported MIME types", () => {
    const result = validateDocument("tax_return", { sizeBytes: 1_000_000, mimeType: "application/docx" });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("PDF, JPEG, or PNG"))).toBe(true);
  });

  it("rejects missing file data", () => {
    const result = validateDocument("w2", null);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("required"))).toBe(true);
  });

  it("accepts PDF up to 10MB", () => {
    const result = validateDocument("bank_statement", { sizeBytes: 9 * 1024 * 1024, mimeType: "application/pdf" });
    expect(result.valid).toBe(true);
  });
});

describe("State Machine Transitions", () => {
  it("allows pending → reviewing", () => {
    const result = transitionStatus("pending", "reviewing");
    expect(result.valid).toBe(true);
  });

  it("allows reviewing → approved", () => {
    const result = transitionStatus("reviewing", "approved");
    expect(result.valid).toBe(true);
  });

  it("allows reviewing → rejected", () => {
    const result = transitionStatus("reviewing", "rejected");
    expect(result.valid).toBe(true);
  });

  it("allows reviewing → more_info_needed", () => {
    const result = transitionStatus("reviewing", "more_info_needed");
    expect(result.valid).toBe(true);
  });

  it("allows more_info_needed → reviewing", () => {
    const result = transitionStatus("more_info_needed", "reviewing");
    expect(result.valid).toBe(true);
  });

  it("blocks pending → approved (must go through reviewing)", () => {
    const result = transitionStatus("pending", "approved");
    expect(result.valid).toBe(false);
  });

  it("blocks approved → any other status (terminal state)", () => {
    expect(transitionStatus("approved", "reviewing").valid).toBe(false);
    expect(transitionStatus("approved", "rejected").valid).toBe(false);
    expect(transitionStatus("approved", "pending").valid).toBe(false);
  });

  it("blocks rejected → any other status (terminal state)", () => {
    expect(transitionStatus("rejected", "reviewing").valid).toBe(false);
    expect(transitionStatus("rejected", "approved").valid).toBe(false);
  });
});

describe("Document Upload Gate", () => {
  it("allows upload in pending status", () => {
    expect(canUploadDocument("pending")).toBe(true);
  });

  it("allows upload in more_info_needed status", () => {
    expect(canUploadDocument("more_info_needed")).toBe(true);
  });

  it("blocks upload in reviewing status", () => {
    expect(canUploadDocument("reviewing")).toBe(false);
  });

  it("blocks upload in approved status", () => {
    expect(canUploadDocument("approved")).toBe(false);
  });

  it("blocks upload in rejected status", () => {
    expect(canUploadDocument("rejected")).toBe(false);
  });
});

describe("Accreditation Check Logic", () => {
  it("approves investor with net worth ≥ $1M", () => {
    const result = checkAccreditation({ netWorth: 1_000_000, annualIncome: 100_000 });
    expect(result.isAccredited).toBe(true);
    expect(result.method).toBe("net_worth");
  });

  it("approves investor with income ≥ $200K (net worth below threshold)", () => {
    const result = checkAccreditation({ netWorth: 500_000, annualIncome: 250_000 });
    expect(result.isAccredited).toBe(true);
    expect(result.method).toBe("income");
  });

  it("prefers net worth method when both qualify", () => {
    const result = checkAccreditation({ netWorth: 2_000_000, annualIncome: 300_000 });
    expect(result.isAccredited).toBe(true);
    expect(result.method).toBe("net_worth");
  });

  it("rejects investor below both thresholds", () => {
    const result = checkAccreditation({ netWorth: 500_000, annualIncome: 150_000 });
    expect(result.isAccredited).toBe(false);
    expect(result.method).toBe("neither");
  });

  it("rejects investor exactly below net worth threshold", () => {
    const result = checkAccreditation({ netWorth: 999_999, annualIncome: 199_999 });
    expect(result.isAccredited).toBe(false);
  });

  it("approves at exactly the net worth threshold", () => {
    const result = checkAccreditation({ netWorth: 1_000_000, annualIncome: 0 });
    expect(result.isAccredited).toBe(true);
  });
});

describe("Submit for Review Validation", () => {
  const baseRequest: VerificationRequest = {
    id: 1,
    investorProfileId: 100,
    orgId: 10,
    status: "pending",
    documents: [],
    history: [{ status: "pending", changedAt: new Date() }],
    createdAt: new Date(),
  };

  it("allows submission with at least one document", () => {
    const request = {
      ...baseRequest,
      documents: [{ docType: "passport", fileData: {}, uploadedAt: new Date() }],
    };
    const result = canSubmitForReview(request);
    expect(result.allowed).toBe(true);
  });

  it("blocks submission with no documents", () => {
    const result = canSubmitForReview(baseRequest);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("document");
  });

  it("blocks submission from reviewing status", () => {
    const request = {
      ...baseRequest,
      status: "reviewing" as VerificationStatus,
      documents: [{ docType: "passport", fileData: {}, uploadedAt: new Date() }],
    };
    const result = canSubmitForReview(request);
    expect(result.allowed).toBe(false);
  });

  it("allows re-submission from more_info_needed with new docs", () => {
    const request = {
      ...baseRequest,
      status: "more_info_needed" as VerificationStatus,
      documents: [{ docType: "tax_return", fileData: {}, uploadedAt: new Date() }],
    };
    const result = canSubmitForReview(request);
    expect(result.allowed).toBe(true);
  });
});

describe("Gate Enforcement", () => {
  it("allows action for approved investors", () => {
    const result = enforceVerificationGate("approved");
    expect(result.allowed).toBe(true);
  });

  it("blocks action for pending investors", () => {
    const result = enforceVerificationGate("pending");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("approved");
  });

  it("blocks action for rejected investors", () => {
    const result = enforceVerificationGate("rejected");
    expect(result.allowed).toBe(false);
  });

  it("blocks action for investors under review", () => {
    const result = enforceVerificationGate("reviewing");
    expect(result.allowed).toBe(false);
  });

  it("respects custom required status", () => {
    // Some actions might only require 'reviewing' status
    expect(enforceVerificationGate("reviewing", "reviewing").allowed).toBe(true);
    expect(enforceVerificationGate("pending", "reviewing").allowed).toBe(false);
  });
});

describe("Verification Progress Calculation", () => {
  const makeRequest = (overrides: Partial<VerificationRequest>): VerificationRequest => ({
    id: 1,
    investorProfileId: 1,
    orgId: 1,
    status: "pending",
    documents: [],
    history: [],
    createdAt: new Date(),
    ...overrides,
  });

  it("starts at 0 with no documents", () => {
    const req = makeRequest({});
    expect(computeVerificationProgress(req)).toBe(0);
  });

  it("increases to 30 with first document", () => {
    const req = makeRequest({ documents: [{ docType: "passport", fileData: {}, uploadedAt: new Date() }] });
    expect(computeVerificationProgress(req)).toBeGreaterThanOrEqual(30);
  });

  it("reaches 100 when approved", () => {
    const req = makeRequest({ status: "approved" });
    expect(computeVerificationProgress(req)).toBe(100);
  });

  it("reaches 100 when rejected", () => {
    const req = makeRequest({ status: "rejected" });
    expect(computeVerificationProgress(req)).toBe(100);
  });

  it("increases progressively with more completed steps", () => {
    const step1 = makeRequest({ documents: [{ docType: "passport", fileData: {}, uploadedAt: new Date() }] });
    const step2 = makeRequest({
      documents: [{ docType: "passport", fileData: {}, uploadedAt: new Date() }],
      submittedAt: new Date(),
    });
    const step3 = makeRequest({
      documents: [{ docType: "passport", fileData: {}, uploadedAt: new Date() }],
      submittedAt: new Date(),
      accreditationData: { netWorth: 1_500_000, annualIncome: 250_000 },
      status: "reviewing",
    });
    expect(computeVerificationProgress(step3)).toBeGreaterThan(computeVerificationProgress(step2));
    expect(computeVerificationProgress(step2)).toBeGreaterThan(computeVerificationProgress(step1));
  });
});
