/**
 * data-classification registry lint (Tahoe / Beatrice).
 *
 * This test is the second MOUNT point of the classification registry (the
 * first being server/utils/customerAudit.ts, which labels audit metadata by
 * class). Here the registry is consumed as a guard rail:
 *
 *   For each high-risk table, every column whose NAME matches the PII
 *   heuristic (ssn, email, phone, tax_id, first/last name, dob, …) MUST have
 *   an explicit classification declared in CLASSIFICATION_REGISTRY. A new
 *   PII-shaped column that lands without a decision fails this test — turning
 *   "did someone classify this field?" into a CI gate instead of a code review
 *   hope.
 *
 * It also asserts the redactor actually scrubs/labels by class, so the
 * registry can't rot into a decorative map nothing reads.
 */

import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  users,
  organizations,
  leads,
  supportTickets,
} from "@shared/schema";
import {
  CLASSIFICATION_REGISTRY,
  classify,
  looksLikePII,
  redactByClassification,
  DATA_CLASSES,
} from "@shared/data-classification";

// High-risk tables the registry is responsible for. financial_ledger is
// covered in the registry but its Drizzle export name varies; the four below
// are the load-bearing PII/financial surfaces we lint structurally.
const GUARDED_TABLES: Array<{ name: string; table: Record<string, any> }> = [
  { name: "users", table: users as any },
  { name: "organizations", table: organizations as any },
  { name: "leads", table: leads as any },
  { name: "support_tickets", table: supportTickets as any },
];

describe("data-classification registry lint", () => {
  for (const { name, table } of GUARDED_TABLES) {
    it(`every PII-shaped column in ${name} has an explicit classification`, () => {
      const cols = getTableColumns(table);
      const undeclared: string[] = [];
      for (const col of Object.values(cols) as Array<{ name: string }>) {
        const sqlName = col.name; // snake_case SQL column name
        const key = `${name}.${sqlName}`;
        if (looksLikePII(sqlName) && !(key in CLASSIFICATION_REGISTRY)) {
          undeclared.push(key);
        }
      }
      expect(
        undeclared,
        `These PII-shaped columns need a classification in ` +
          `shared/data-classification.ts → CLASSIFICATION_REGISTRY:\n  ` +
          undeclared.join("\n  "),
      ).toEqual([]);
    });
  }

  it("registry values are all valid classes", () => {
    for (const [key, cls] of Object.entries(CLASSIFICATION_REGISTRY)) {
      expect(DATA_CLASSES, `${key} has invalid class ${cls}`).toContain(cls);
    }
  });

  it("classify() returns the declared class and defaults unknown to internal", () => {
    expect(classify("users", "email")).toBe("pii");
    expect(classify("organizations", "tax_id_last4")).toBe("sensitive_financial");
    expect(classify("users", "id")).toBe("public");
    expect(classify("users", "some_unmapped_col")).toBe("internal");
  });

  it("redactByClassification labels PII/financial and passes public through", () => {
    const out = redactByClassification(
      { id: 7, email: "a@b.com", tax_id_last4: "1234", status: "active" },
      { table: "organizations", label: true },
    ) as Record<string, unknown>;
    // organizations.id = public, organizations.email not in registry → heuristic
    // not used because table is set; unknown → internal (passes). status not in
    // registry → internal (passes). tax_id_last4 = sensitive_financial (label).
    expect(out.id).toBe(7);
    expect(out.tax_id_last4).toBe("[Financial]");
    expect(out.status).toBe("active");
  });

  it("redactByClassification without table uses the name heuristic", () => {
    const out = redactByClassification(
      { email: "a@b.com", phone: "5551234567", note: "hi" },
      { label: true },
    ) as Record<string, unknown>;
    expect(out.email).toBe("[Personal]");
    expect(out.phone).toBe("[Personal]");
    expect(out.note).toBe("hi");
  });
});
