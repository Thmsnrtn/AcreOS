/**
 * G11 fidelity fix — the named acceptance tests, against a REAL database built
 * from this repository. SYNTHETIC data; a fresh org per test.
 *
 *   Defect 1  originated notes import: Start Date, per-row atomicity, empty CSV
 *   Defect 2  properties export re-imports
 *   Defect 3  leads export loses no field
 *   Defect 4  acquired notes: export, re-import, ZIP
 *   Defect 5  investor-income gate
 *   (a)       PATCH writes provenance observations
 *   (c)       sweep: communications export carries leadEmail
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("g11FidelityFix.realdb.test.ts");

const h = vi.hoisted(() => ({
  org: { id: 0 } as { id: number },
  user: { id: "g11-owner", email: "g11-owner@example.test" } as { id: string; email: string },
  founder: false,
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.user = h.user; next(); } }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = h.org;
    req.organizationId = h.org.id;
    if (h.founder) req.isFounder = true;
    next();
  },
}));
vi.mock("../../server/middleware/roleGuard", () => ({ requireRole: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../../server/utils/permissions", async (orig) => ({
  ...(await orig<typeof import("../../server/utils/permissions")>()),
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

const tag = `g11${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const orgIds: number[] = [];
const expected = JSON.parse(readFileSync(path.join(__dirname, "../../shared/notes/golden/note-tape-golden.expected.json"), "utf8"));
const tape = readFileSync(path.join(__dirname, "../../shared/notes/golden/note-tape-golden.csv"), "utf8");

async function newOrg(suffix: string): Promise<number> {
  const { db } = await import("../../server/db");
  const { organizations } = await import("@shared/schema");
  const [o] = await db.insert(organizations).values({ name: `${tag}-${suffix}`, slug: `${tag}-${suffix}`, ownerId: `${tag}-${suffix}` } as never).returning();
  orgIds.push(o.id);
  return o.id;
}
const n = async (text: string, params: unknown[]) => {
  const { pool } = await import("../../server/db");
  return (await pool.query<{ n: number }>(text, params)).rows[0].n;
};

async function commitGolden(orgId: number) {
  const { readNoteTape, suggestNoteTapeMapping, validateNoteTape } = await import("../../server/services/notes/noteTapeImport");
  const { commitNoteTape } = await import("../../server/services/notes/noteTapeCommit");
  const { sheet, sha256 } = readNoteTape(tape);
  const validation = validateNoteTape({ sheet, mapping: suggestNoteTapeMapping(sheet.headers).mapping });
  const r = await commitNoteTape({ organizationId: orgId, actorUserId: `${tag}-u`, fileName: "golden.csv", fileSha256: sha256, asOf: "2026-09-30", validation, excludeRows: [4, 5] });
  if (r.status !== "committed") throw new Error(JSON.stringify(r));
  return r;
}

describe.runIf(realDbAvailable)("G11 fidelity fix — real database", () => {
  afterAll(async () => {
    const { pool } = await import("../../server/db");
    for (const id of orgIds) {
      for (const text of [
        "DELETE FROM export_jobs WHERE organization_id = $1",
        "DELETE FROM note_ownership_splits WHERE organization_id = $1",
        "DELETE FROM acquired_notes WHERE organization_id = $1",
        "DELETE FROM notes WHERE organization_id = $1",
        "DELETE FROM properties WHERE organization_id = $1",
        "DELETE FROM leads WHERE organization_id = $1",
        "DELETE FROM team_members WHERE organization_id = $1",
        "DELETE FROM activity_log WHERE organization_id = $1",
        "DELETE FROM organizations WHERE id = $1",
      ]) {
        await pool.query(text, [id]).catch(() => undefined);
      }
    }
    await pool.end();
  });

  // ───────────────────────── Defect 1 ─────────────────────────
  describe("Defect 1 — originated notes import", () => {
    const head = "Borrower First Name,Borrower Last Name,Borrower Email,Original Principal,Interest Rate,Term (Months),Monthly Payment";
    it("originated notes import succeeds with a Start Date column", async () => {
      const orgId = await newOrg("d1a");
      const { importNotesFromCSV, parseCSV } = await import("../../server/services/importExport");
      const csv = `${head},Start Date,First Payment Date\nAnn,Synth,ann-${tag}@example.test,"$12,000",8,12,1043.88,2026-01-01,2026-02-01\nBob,Synth,bob-${tag}@example.test,24000,6,24,1063.7,3/15/2026,4/15/2026`;
      const r = await importNotesFromCSV(parseCSV(csv), orgId);
      expect(r).toMatchObject({ totalRows: 2, successCount: 2, errorCount: 0 });
      const { db } = await import("../../server/db");
      const { notes } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const rows = (await db.select().from(notes).where(eq(notes.organizationId, orgId))).sort((a, b) => a.termMonths - b.termMonths);
      expect(rows.map((x) => x.startDate.toISOString().slice(0, 10))).toEqual(["2026-01-01", "2026-03-15"]);
      expect(rows.map((x) => x.maturityDate!.toISOString().slice(0, 10))).toEqual(["2027-01-01", "2028-03-15"]);
      expect(rows.map((x) => x.firstPaymentDate.toISOString().slice(0, 10))).toEqual(["2026-02-01", "2026-04-15"]);
    });

    it("originated notes import with a fieldMap supplying Start Date succeeds", async () => {
      const orgId = await newOrg("d1b");
      const { importNotesFromCSV, parseCSV } = await import("../../server/services/importExport");
      const csv = `${head},Begin,FirstDue\nAnn,Synth,,12000,8,12,1043.88,2026-01-01,2026-02-01\nBob,Synth,,24000,6,24,1063.7,2026-03-15,2026-04-15`;
      const r = await importNotesFromCSV(parseCSV(csv), orgId, { Begin: "startDate", FirstDue: "firstPaymentDate", "Start Date": "startDate", "First Payment Date": "firstPaymentDate" });
      expect(r).toMatchObject({ successCount: 2, errorCount: 0 });
    });

    it("originated notes import without a start date refuses per row, leaves no orphan lead", async () => {
      const orgId = await newOrg("d1c");
      const { importNotesFromCSV, parseCSV } = await import("../../server/services/importExport");
      const csv = `${head}\nAnn,Synth,ann@example.test,12000,8,12,1043.88\nBob,Synth,bob@example.test,24000,6,24,1063.7`;
      const r = await importNotesFromCSV(parseCSV(csv), orgId);
      expect(r).toMatchObject({ successCount: 0, errorCount: 2 });
      for (const e of r.errors) expect(e.error).toMatch(/Start Date is required; add a Start Date column/);
      expect(await n("SELECT count(*)::int AS n FROM leads WHERE organization_id = $1", [orgId])).toBe(0);
      expect(await n("SELECT count(*)::int AS n FROM notes WHERE organization_id = $1", [orgId])).toBe(0);
    });

    it("a note that cannot be created takes its borrower lead with it", async () => {
      const orgId = await newOrg("d1d");
      const { importNotesFromCSV, parseCSV } = await import("../../server/services/importExport");
      const { storage } = await import("../../server/storage");
      const spy = vi.spyOn(storage, "createNote").mockRejectedValue(new Error("boom"));
      try {
        const csv = `${head},Start Date,First Payment Date\nAnn,Synth,ann@example.test,12000,8,12,1043.88,2026-01-01,2026-02-01`;
        const r = await importNotesFromCSV(parseCSV(csv), orgId);
        expect(r).toMatchObject({ successCount: 0, errorCount: 1 });
      } finally {
        spy.mockRestore();
      }
      expect(await n("SELECT count(*)::int AS n FROM leads WHERE organization_id = $1", [orgId])).toBe(0);
      expect(await n("SELECT count(*)::int AS n FROM activity_log WHERE organization_id = $1 AND entity_type = 'lead'", [orgId])).toBe(0);
    });

    it("empty notes CSV re-import returns zero rows, not 500", async () => {
      const orgId = await newOrg("d1e");
      h.org = { id: orgId };
      const { registerImportExportRoutes } = await import("../../server/routes-import-export");
      const app = express();
      app.use(express.json());
      registerImportExportRoutes(app);
      const exported = await request(app).get("/api/export/notes?format=csv");
      expect(exported.status).toBe(200);
      const res = await request(app).post("/api/import/notes").field("intent", "originated").attach("file", Buffer.from(exported.text), "notes.csv");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ totalRows: 0, successCount: 0, errorCount: 0 });
    });

    it("an originated-notes export re-import refuses per row naming the borrower — it carries no borrower contact, and never 500s", async () => {
      const a = await newOrg("d1f-a");
      const b = await newOrg("d1f-b");
      const { importNotesFromCSV, exportNotesToCSV, parseCSV } = await import("../../server/services/importExport");
      const csv = `${head},Start Date,First Payment Date\nAnn,Synth,ann-${tag}@example.test,12000,8,12,1043.88,2026-01-01,2026-02-01`;
      expect((await importNotesFromCSV(parseCSV(csv), a)).successCount).toBe(1);
      const r = await importNotesFromCSV(parseCSV(await exportNotesToCSV(a)), b);
      expect(r).toMatchObject({ totalRows: 1, successCount: 0, errorCount: 1 });
      expect(r.errors[0].error).toMatch(/Borrower name is required/);
    });
  });

  // ───────────────────────── Defect 2 ─────────────────────────
  it("properties export re-imports 3/3", async () => {
    const a = await newOrg("d2-a");
    const b = await newOrg("d2-b");
    const { importProperties, exportPropertiesToCSV, parseCSV } = await import("../../server/services/importExport");
    const src: Array<Record<string, string>> = [
      { apn: `${tag}-1`, county: "Wake", state: "NC", sizeAcres: "12.5", assessedValue: "40000", purchaseDate: "2025-05-01" },
      { apn: `${tag}-2`, county: "Davidson", state: "TN", sizeAcres: "0.125" },
      { apn: `${tag}-3`, county: "Wake", state: "NC", sizeAcres: "100", soldPrice: "9000", soldDate: "2026-02-03" },
    ];
    expect(await importProperties(src, a)).toMatchObject({ successCount: 3, errorCount: 0 });
    const csv = await exportPropertiesToCSV(a);
    expect(await importProperties(parseCSV(csv), b)).toMatchObject({ totalRows: 3, successCount: 3, errorCount: 0 });
    const { db } = await import("../../server/db");
    const { properties } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const read = async (o: number) => (await db.select().from(properties).where(eq(properties.organizationId, o))).sort((x, y) => x.apn.localeCompare(y.apn));
    const [ra, rb] = [await read(a), await read(b)];
    expect(rb.map((p) => [p.apn, Number(p.sizeAcres), p.county, p.state, p.assessedValue === null ? null : Number(p.assessedValue), p.soldPrice === null ? null : Number(p.soldPrice)]))
      .toEqual(ra.map((p) => [p.apn, Number(p.sizeAcres), p.county, p.state, p.assessedValue === null ? null : Number(p.assessedValue), p.soldPrice === null ? null : Number(p.soldPrice)]));
    expect(rb.map((p) => p.purchaseDate?.toISOString() ?? null)).toEqual(ra.map((p) => p.purchaseDate?.toISOString() ?? null));
    expect(rb.map((p) => p.soldDate?.toISOString() ?? null)).toEqual(ra.map((p) => p.soldDate?.toISOString() ?? null));
  });

  // ───────────────────────── Defect 3 ─────────────────────────
  it("leads export round-trips with zero fields lost", async () => {
    const a = await newOrg("d3-a");
    const b = await newOrg("d3-b");
    const { importLeads, exportLeadsToCSV, parseCSV } = await import("../../server/services/importExport");
    const src = [
      { firstName: "Ann", lastName: "One", email: `a-${tag}@example.test`, state: "NC", county: "Wake", apn: `${tag}-1`, Acres: "12.5", "Assessed Value": "40000", "Estimated Value": "55000", "Tax Delinquent": "Yes", "Tax Delinquent Amount": "1200.50", "Tax Delinquent Years": "3", tags: "hot,mailed", dnc: "Y" },
      { firstName: "Bob", lastName: "Two", email: `b-${tag}@example.test`, state: "TN", county: "Davidson", apn: `${tag}-2`, Acres: "0.75", "Assessed Value": "9000", "Tax Delinquent": "No" },
      { firstName: "Cy", lastName: "Three", state: "NC", county: "Wake", apn: `${tag}-3`, Acres: "100", "Estimated Value": "300000" },
    ];
    expect(await importLeads(src as never, a)).toMatchObject({ successCount: 3, errorCount: 0 });
    const csv = await exportLeadsToCSV(a);
    expect(await importLeads(parseCSV(csv), b)).toMatchObject({ totalRows: 3, successCount: 3, errorCount: 0 });
    const { db } = await import("../../server/db");
    const { leads } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const shape = (l: typeof leads.$inferSelect) => ({
      firstName: l.firstName, lastName: l.lastName, email: l.email, state: l.state, county: l.county, apn: l.apn,
      acreage: num(l.acreage), assessedValue: num(l.assessedValue), estimatedValue: num(l.estimatedValue),
      taxDelinquent: l.taxDelinquent, taxDelinquentAmount: num(l.taxDelinquentAmount), taxDelinquentYears: l.taxDelinquentYears,
      tags: l.tags, doNotContact: !!l.doNotContact,
    });
    const read = async (o: number) => (await db.select().from(leads).where(eq(leads.organizationId, o))).sort((x, y) => (x.apn ?? "").localeCompare(y.apn ?? "")).map(shape);
    const [ra, rb] = [await read(a), await read(b)];
    expect(ra[0]).toMatchObject({ county: "Wake", acreage: 12.5, assessedValue: 40000, estimatedValue: 55000, taxDelinquent: true, taxDelinquentAmount: 1200.5, taxDelinquentYears: 3, tags: ["hot", "mailed"], doNotContact: true });
    expect(rb).toEqual(ra);
  });

  // ───────────────────────── Defect 4 ─────────────────────────
  describe("Defect 4 — acquired notes", () => {
    it("acquired notes export lists the N1 book", async () => {
      const a = await newOrg("d4a");
      await commitGolden(a);
      h.org = { id: a };
      const { registerImportExportRoutes } = await import("../../server/routes-import-export");
      const app = express();
      app.use(express.json());
      registerImportExportRoutes(app);
      const json = await request(app).get("/api/export/acquired-notes?format=json");
      expect(json.status).toBe(200);
      const rows = JSON.parse(json.text) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(3);
      const first = rows.find((r) => r.noteNumber === "SYNTH-1001")!;
      expect(first).toMatchObject({ payerName: "SYNTHETIC Borrower One", originalPrincipal: "120000.00", currentBalance: "84250.00", interestRate: "8.50", termMonths: 360, paymentAmount: "922.70", paymentDueDay: 1, status: "performing", docNote: "present", collateralApn: "SYNTH-0101-001", collateralState: "NC" });
      const csv = await request(app).get("/api/export/acquired-notes");
      expect(csv.status).toBe(200);
      expect(csv.text.split("\n")).toHaveLength(4);
      expect(JSON.stringify(rows)).not.toMatch(/tin/i);
    });

    it("acquired notes export re-imports", async () => {
      const a = await newOrg("d4b-a");
      const b = await newOrg("d4b-b");
      await commitGolden(a);
      const { exportAcquiredNotesToCSV } = await import("../../server/services/notes/acquiredNotesExport");
      const csv = await exportAcquiredNotesToCSV(a);
      const { readNoteTape, suggestNoteTapeMapping, validateNoteTape } = await import("../../server/services/notes/noteTapeImport");
      const { commitNoteTape } = await import("../../server/services/notes/noteTapeCommit");
      const { sheet, sha256 } = readNoteTape(csv);
      const validation = validateNoteTape({ sheet, mapping: suggestNoteTapeMapping(sheet.headers).mapping });
      expect(validation.rejected).toEqual([]);
      expect(validation.valid).toHaveLength(3);
      // The golden.expected.json exact-match bar, field for field.
      validation.valid.forEach((got, i) => {
        const want = { ...expected.valid[i] };
        delete want.fileRow;
        const picked = Object.fromEntries(Object.keys(want).map((k) => [k, (got as never as Record<string, unknown>)[k]]));
        expect(picked, want.noteNumber).toEqual(want);
      });
      const r = await commitNoteTape({ organizationId: b, actorUserId: `${tag}-u`, fileName: "export.csv", fileSha256: sha256, asOf: null, validation, excludeRows: [] });
      expect(r).toMatchObject({ status: "committed", created: 3 });
      const { db } = await import("../../server/db");
      const { acquiredNotes } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const cols = (o: number) => db.select().from(acquiredNotes).where(eq(acquiredNotes.organizationId, o)).then((rs) =>
        rs.sort((x, y) => x.noteNumber.localeCompare(y.noteNumber)).map((x) => ({
          noteNumber: x.noteNumber, payerName: x.payerName, originalPrincipalCents: x.originalPrincipalCents, currentBalanceCents: x.currentBalanceCents,
          interestRateBps: x.interestRateBps, termMonths: x.termMonths, paymentAmountCents: x.paymentAmountCents, paymentDueDay: x.paymentDueDay,
          originationDate: x.originationDate, maturityDate: x.maturityDate, acquisitionDate: x.acquisitionDate, acquisitionPriceCents: x.acquisitionPriceCents,
          status: x.status, remainingTermMonths: x.remainingTermMonths, balloonAmountCents: x.balloonAmountCents, balloonDate: x.balloonDate, paidThroughDate: x.paidThroughDate,
        })));
      expect(await cols(b)).toEqual(await cols(a));
    });

    it("export-everything ZIP contains acquired notes", async () => {
      const a = await newOrg("d4c");
      await commitGolden(a);
      const { createExportJob, runMigrationJobsTick, readExportArchive } = await import("../../server/services/migrationJobs");
      const job = await createExportJob({ organizationId: a, userId: `${tag}-u`, params: { includeAttachments: false } });
      await runMigrationJobsTick();
      const buf = await readExportArchive(job.id, a);
      expect(buf).not.toBeNull();
      const zip = await JSZip.loadAsync(buf!);
      expect(Object.keys(zip.files)).toContain("acquired-notes.csv");
      const text = await zip.file("acquired-notes.csv")!.async("string");
      expect(text.split("\n").length).toBeGreaterThan(1);
      expect(text).toContain("SYNTH-1001");
      const schema = JSON.parse(await zip.file("schema.json")!.async("string"));
      expect(schema.counts.acquiredNotes).toBe(3);
      expect(await zip.file("README.md")!.async("string")).toContain("acquired-notes.csv");
    });

    it("sweep: communications export carries leadEmail, the column its importer matches on", async () => {
      const a = await newOrg("d4d");
      const { db } = await import("../../server/db");
      const { leads, conversations, messages } = await import("@shared/schema");
      const [lead] = await db.insert(leads).values({ organizationId: a, type: "seller", firstName: "C", lastName: "L", email: `c-${tag}@example.test` } as never).returning();
      const [convo] = await db.insert(conversations).values({ organizationId: a, leadId: lead.id, channel: "email", status: "active" } as never).returning();
      await db.insert(messages).values({ conversationId: convo.id, organizationId: a, direction: "inbound", sender: "lead", content: "hello", status: "delivered" } as never);
      const { createExportJob, runMigrationJobsTick, readExportArchive } = await import("../../server/services/migrationJobs");
      const job = await createExportJob({ organizationId: a, userId: `${tag}-u`, params: { entityTypes: ["communications"], includeAttachments: false } });
      await runMigrationJobsTick();
      const zip = await JSZip.loadAsync((await readExportArchive(job.id, a))!);
      const csv = await zip.file("communications.csv")!.async("string");
      expect(csv.split("\n")[0]).toContain("leadEmail");
      expect(csv).toContain(`c-${tag}@example.test`);
    });
  });

  // ───────────────────────── PATCH provenance ─────────────────────────
  it("PATCH writes provenance observations", async () => {
    const a = await newOrg("pa");
    await commitGolden(a);
    h.org = { id: a };
    const { db } = await import("../../server/db");
    const { acquiredNotes, noteFieldObservations } = await import("@shared/schema");
    const { and, eq } = await import("drizzle-orm");
    const [note] = await db.select().from(acquiredNotes).where(and(eq(acquiredNotes.organizationId, a), eq(acquiredNotes.noteNumber, "SYNTH-1001")));
    const countsBefore = async () => {
      const rows = await db.select().from(noteFieldObservations).where(eq(noteFieldObservations.noteId, note.id));
      const m: Record<string, number> = {};
      for (const r of rows) m[r.field] = (m[r.field] ?? 0) + 1;
      return { m, total: rows.length };
    };
    const before = await countsBefore();
    const { registerNoteRoutes } = await import("../../server/routes-notes");
    const app = express();
    app.use(express.json());
    registerNoteRoutes(app);
    const res = await request(app).patch(`/api/notes/${note.id}`).send({ currentBalanceCents: 8_000_000, payerName: "SYNTHETIC Renamed" });
    expect(res.status).toBe(200);
    const rows = await db.select().from(noteFieldObservations).where(eq(noteFieldObservations.noteId, note.id));
    const edits = rows.filter((r) => r.source === "edit");
    expect(edits.map((r) => [r.field, r.value, r.kind, r.recordedBy]).sort()).toEqual([
      ["currentBalance", 8_000_000, "value", h.user.id],
      ["payerName", "SYNTHETIC Renamed", "value", h.user.id],
    ]);
    const after = await countsBefore();
    expect(after.total).toBe(before.total + 2);
    for (const [f, c] of Object.entries(before.m)) expect(after.m[f], f).toBe(f === "currentBalance" || f === "payerName" ? c + 1 : c);
    // The import-time rows are untouched: the original balance is still on the ledger.
    expect(rows.find((r) => r.field === "currentBalance" && r.source === "note_tape")?.value).toBe(8_425_000);
    // A PATCH that changes nothing writes nothing.
    await request(app).patch(`/api/notes/${note.id}`).send({ payerName: "SYNTHETIC Renamed" });
    expect((await countsBefore()).total).toBe(after.total);
  });

  // ───────────────────────── Defect 5 ─────────────────────────
  describe("Defect 5 — investor-income gate", () => {
    let orgId = 0;
    let app: express.Express;
    beforeAll(async () => {
      if (!realDbAvailable) return;
      orgId = await newOrg("d5");
      const { db } = await import("../../server/db");
      const { teamMembers, acquiredNotes, noteOwnershipSplits, notePayments } = await import("@shared/schema");
      await db.insert(teamMembers).values([
        { organizationId: orgId, userId: "g11-owner", role: "owner", isActive: true },
        { organizationId: orgId, userId: "g11-member", role: "member", isActive: true },
      ] as never);
      const [note] = await db.insert(acquiredNotes).values({
        organizationId: orgId, noteNumber: `${tag}-N`, payerName: "SYNTHETIC Payer", originalPrincipalCents: 10_000_000, currentBalanceCents: 9_000_000,
        interestRateBps: 800, termMonths: 360, paymentAmountCents: 100_000, paymentDueDay: 1, originationDate: "2025-01-01", maturityDate: "2055-01-01",
        acquisitionDate: "2025-06-01", acquisitionPriceCents: 8_000_000, status: "performing",
      } as never).returning();
      await db.insert(noteOwnershipSplits).values([
        { organizationId: orgId, noteId: note.id, investorName: "LP One", investorEmail: "one@example.test", role: "lp", percentageBps: 5000 },
        { organizationId: orgId, noteId: note.id, investorName: "LP Two", investorEmail: "two@example.test", role: "lp", percentageBps: 2500 },
        { organizationId: orgId, noteId: note.id, investorName: "Org", role: "org", percentageBps: 2500 },
      ] as never);
      await db.insert(notePayments).values([
        { organizationId: orgId, noteId: note.id, paymentDate: "2026-03-01", interestCents: 60_000, principalCents: 40_000 },
        { organizationId: orgId, noteId: note.id, paymentDate: "2026-04-01", interestCents: 40_000, principalCents: 60_000 },
        { organizationId: orgId, noteId: note.id, paymentDate: "2025-12-01", interestCents: 999_999, principalCents: 1 },
      ] as never);
      const accounting = (await import("../../server/routes-accounting")).default;
      app = express();
      app.use(express.json());
      app.use("/api/accounting", (req: any, _res, next) => {
        req.user = h.user;
        req.organization = h.org;
        req.organizationId = h.org.id;
        if (h.founder) req.isFounder = true;
        next();
      }, accounting);
    });
    const as = (user: string, founder = false) => {
      h.user = { id: user, email: `${user}@example.test` };
      h.founder = founder;
      h.org = { id: orgId };
    };

    it("investor-income returns aggregation for the org owner", async () => {
      as("g11-owner");
      const res = await request(app).get("/api/accounting/investor-income?taxYear=2026");
      expect(res.status).toBe(200);
      expect(res.body.taxYear).toBe(2026);
      expect(res.body.totalInvestorInterestCents).toBe(75_000);
      const by = Object.fromEntries(res.body.statements.map((s: any) => [s.investorName, s.totalInterestCents]));
      expect(by).toEqual({ "LP One": 50_000, "LP Two": 25_000 });
    });

    it("investor-income returns aggregation for the founder identity", async () => {
      as("g11-founder-not-a-member", true);
      const res = await request(app).get("/api/accounting/investor-income?taxYear=2026");
      expect(res.status).toBe(200);
      expect(res.body.totalInvestorInterestCents).toBe(75_000);
    });

    it("investor-income still 403s a non-owner non-admin", async () => {
      as("g11-member");
      expect((await request(app).get("/api/accounting/investor-income?taxYear=2026")).status).toBe(403);
      as("g11-stranger");
      expect((await request(app).get("/api/accounting/investor-income?taxYear=2026")).status).toBe(403);
    });
  });
});
