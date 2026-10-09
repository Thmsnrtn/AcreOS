/**
 * One-click full export: leads, properties, deals, communications, notes,
 * PAYMENTS, the audit log, attachments and a FILES MANIFEST — org-scoped,
 * owner/admin only.
 *
 * The export job already carried most entities; payments and a manifest of
 * the org's files were missing, and the Settings button still called the
 * deprecated JSON backup (no payments, no files). Every query the two new
 * builders run is rendered through drizzle's dialect and must name this org.
 */
import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const H = vi.hoisted(() => ({ wheres: [] as any[], rows: new Map<any, any[]>() }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", async () => {
  const schema = await import("@shared/schema");
  const select = () => ({
    from: (t: any) => {
      const rows = t === schema.payments
        ? [{ id: 1, noteId: 9, paymentDate: new Date(Date.UTC(2026, 0, 5)), dueDate: new Date(Date.UTC(2026, 0, 1)), amount: "500", principalAmount: "400", interestAmount: "100", feeAmount: "0", lateFeeAmount: "25", status: "completed", paymentMethod: "ach", createdAt: new Date(0) }]
        : t === schema.notePayments
          ? [{ id: "np1", noteId: "n1", paymentDate: "2026-02-01", principalCents: 30000, interestCents: 5000, escrowCents: 0, lateFeeCents: 0, paymentType: "regular", paymentMethod: "check", createdAt: new Date(0) }]
          : t === schema.activityLog
            ? [{ entityType: "lead", entityId: 3, metadata: { filename: "deed.pdf", ref: "org7/deed.pdf" } }]
            : t === schema.documentAnalysis
              ? [{ id: 4, fileUrl: "s3://b/doc.pdf" }]
              : [{ id: 5, propertyId: 8, filename: "lot.jpg", storageKey: "photos/lot.jpg" }];
      const c: any = {
        innerJoin: () => c,
        where: (w: any) => { H.wheres.push(w); return c; },
        orderBy: () => c,
        then: (ok: any, bad: any) => Promise.resolve(rows).then(ok, bad),
      };
      return c;
    },
  });
  return { db: { select } };
});

import { FULL_EXPORT_ENTITY_TYPES, buildPaymentsCsv, buildFilesManifestCsv } from "../../server/services/migrationJobs";
import { getPermissionsForRole } from "../../server/utils/permissions";

describe("the full export's contents", () => {
  it("defaults to every entity, payments and the files manifest included", () => {
    for (const e of ["leads", "properties", "deals", "communications", "notes", "payments", "audit-log", "files-manifest"]) {
      expect(FULL_EXPORT_ENTITY_TYPES).toContain(e);
    }
  });

  it("payments.csv carries both ledgers; every query names the org", async () => {
    H.wheres.length = 0;
    const csv = await buildPaymentsCsv(7);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^servicing,1,9,2026-01-05/);
    expect(lines[2]).toMatch(/^acquired_note,np1,n1,2026-02-01,,350\.00,300\.00,50\.00/);
    const dialect = new PgDialect();
    expect(H.wheres.length).toBe(2);
    for (const w of H.wheres) {
      const { sql, params } = dialect.sqlToQuery(w);
      expect(sql).toMatch(/"organization_id" = \$1/);
      expect(params).toEqual([7]);
    }
  });

  it("files-manifest.csv lists packed, missing and referenced files; every query names the org", async () => {
    H.wheres.length = 0;
    const csv = await buildFilesManifestCsv(7, ["attachments/lead/3/deed.pdf"]);
    expect(csv).toMatch(/imported_document,lead,3,deed\.pdf,org7\/deed\.pdf,yes/);
    expect(csv).toMatch(/analyzed_document,document_analysis,4,,s3:\/\/b\/doc\.pdf,no \(referenced\)/);
    expect(csv).toMatch(/property_photo,property,8,lot\.jpg,photos\/lot\.jpg,no \(referenced\)/);
    const dialect = new PgDialect();
    expect(H.wheres.length).toBe(3);
    for (const w of H.wheres) expect(dialect.sqlToQuery(w).sql).toMatch(/"organization_id" = \$1/);
  });
});

describe("who may export", () => {
  it.each([["owner", true], ["admin", true], ["member", false], ["va", false], ["viewer", false]])("%s → %s", (role, allowed) => {
    expect(getPermissionsForRole(role).canExportData).toBe(allowed);
  });

  it("the export, its job status and its download are gated on canExportData", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "../../server/routes-import-export.ts"), "utf8");
    expect(src).toMatch(/api\.post\("\/api\/export\/everything", isAuthenticated, getOrCreateOrg, requirePermission\("canExportData"\)/);
    const client = fs.readFileSync(path.resolve(__dirname, "../../client/src/components/import-export.tsx"), "utf8");
    expect(client).toMatch(/apiRequest\("POST", "\/api\/export\/everything"/);
    expect(client).not.toMatch(/fetch\("\/api\/export\/backup"/);
  });
});
