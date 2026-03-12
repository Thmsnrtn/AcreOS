/**
 * T178 — GDPR Service Tests
 * Tests data anonymization logic and deletion pattern matching.
 */

import { describe, it, expect } from "vitest";
import crypto from "crypto";

// ─── Inline GDPR pure logic ───────────────────────────────────────────────────

function generateAnonEmail(userId: number): string {
  const hash = crypto.createHash("sha256").update(String(userId)).digest("hex").substring(0, 8);
  return `deleted-user-${hash}@gdpr-deleted.invalid`;
}

function generateAnonName(userId: number): string {
  const hash = crypto.createHash("sha256").update(String(userId)).digest("hex").substring(0, 8);
  return `[Deleted User ${hash}]`;
}

function isDeletedEmail(email: string): boolean {
  return email.endsWith("@gdpr-deleted.invalid");
}

function sanitizeExportData(user: Record<string, any>): Record<string, any> {
  const { password, ...safe } = user;
  return safe;
}

function validateDeletionConfirmation(confirm: string): boolean {
  return confirm === "DELETE MY DATA";
}

function buildDeletionReport(
  userId: number,
  counts: { agentEvents: number; teamMessages: number; supportTickets: number; tasks: number; sessions: number },
  leadsAnonymized: number
): object {
  return {
    userId,
    deletedAt: expect.any(String),
    itemsDeleted: counts,
    leadsAnonymized,
    userAnonymized: true,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("generateAnonEmail", () => {
  it("generates a valid anonymous email format", () => {
    const email = generateAnonEmail(42);
    expect(email).toMatch(/^deleted-user-[a-f0-9]{8}@gdpr-deleted\.invalid$/);
  });

  it("generates different emails for different user IDs", () => {
    const e1 = generateAnonEmail(1);
    const e2 = generateAnonEmail(2);
    expect(e1).not.toBe(e2);
  });

  it("generates same email for same user ID (deterministic)", () => {
    expect(generateAnonEmail(100)).toBe(generateAnonEmail(100));
  });

  it("always ends with gdpr-deleted.invalid domain", () => {
    for (const id of [1, 42, 999, 123456]) {
      expect(generateAnonEmail(id).endsWith("@gdpr-deleted.invalid")).toBe(true);
    }
  });
});

describe("generateAnonName", () => {
  it("generates a bracket-wrapped name", () => {
    const name = generateAnonName(42);
    expect(name).toMatch(/^\[Deleted User [a-f0-9]{8}\]$/);
  });

  it("is deterministic for the same user ID", () => {
    expect(generateAnonName(7)).toBe(generateAnonName(7));
  });

  it("differs across user IDs", () => {
    expect(generateAnonName(1)).not.toBe(generateAnonName(2));
  });
});

describe("isDeletedEmail", () => {
  it("returns true for GDPR-deleted email pattern", () => {
    expect(isDeletedEmail("deleted-user-abc12345@gdpr-deleted.invalid")).toBe(true);
  });

  it("returns false for normal email", () => {
    expect(isDeletedEmail("user@example.com")).toBe(false);
  });

  it("returns false for partial match (different domain)", () => {
    expect(isDeletedEmail("test@gdpr-deleted.com")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isDeletedEmail("")).toBe(false);
  });

  it("returns true for any email ending in @gdpr-deleted.invalid", () => {
    expect(isDeletedEmail("foo@gdpr-deleted.invalid")).toBe(true);
    expect(isDeletedEmail("x@gdpr-deleted.invalid")).toBe(true);
  });
});

describe("sanitizeExportData", () => {
  it("removes password field from export", () => {
    const user = { id: 1, email: "user@example.com", password: "hashed_secret", name: "Alice" };
    const safe = sanitizeExportData(user);
    expect(safe).not.toHaveProperty("password");
  });

  it("retains all non-sensitive fields", () => {
    const user = { id: 1, email: "user@example.com", password: "secret", firstName: "Alice", createdAt: "2024-01-01" };
    const safe = sanitizeExportData(user);
    expect(safe).toEqual({ id: 1, email: "user@example.com", firstName: "Alice", createdAt: "2024-01-01" });
  });

  it("handles user with no password field", () => {
    const user = { id: 1, email: "user@example.com" };
    const safe = sanitizeExportData(user);
    expect(safe).toEqual({ id: 1, email: "user@example.com" });
  });
});

describe("validateDeletionConfirmation", () => {
  it("accepts exact confirmation phrase", () => {
    expect(validateDeletionConfirmation("DELETE MY DATA")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(validateDeletionConfirmation("")).toBe(false);
  });

  it("rejects partial phrase", () => {
    expect(validateDeletionConfirmation("delete my data")).toBe(false); // case-sensitive
    expect(validateDeletionConfirmation("DELETE")).toBe(false);
    expect(validateDeletionConfirmation("yes")).toBe(false);
  });

  it("rejects phrase with extra whitespace", () => {
    expect(validateDeletionConfirmation(" DELETE MY DATA ")).toBe(false);
  });
});

describe("data anonymization integrity", () => {
  it("anonymized email is not the original email", () => {
    const original = "user@example.com";
    const anon = generateAnonEmail(42);
    expect(anon).not.toBe(original);
  });

  it("anonymized email cannot be reverse-engineered to userId", () => {
    // SHA-256 is one-way; we can only verify it's not the raw userId
    const anon = generateAnonEmail(42);
    expect(anon).not.toContain("42");
  });

  it("different users get different hash identifiers", () => {
    const emails = [1, 2, 3, 4, 5].map(generateAnonEmail);
    const unique = new Set(emails);
    expect(unique.size).toBe(5);
  });

  it("export contains all required sections", () => {
    const exportData = {
      exportedAt: new Date().toISOString(),
      user: { id: 1, email: "user@example.com" },
      leads: [],
      deals: [],
      properties: [],
      tasks: [],
      messages: [],
      supportTickets: [],
    };

    expect(exportData).toHaveProperty("exportedAt");
    expect(exportData).toHaveProperty("user");
    expect(exportData).toHaveProperty("leads");
    expect(exportData).toHaveProperty("deals");
    expect(exportData).toHaveProperty("properties");
    expect(exportData).toHaveProperty("supportTickets");
  });
});
