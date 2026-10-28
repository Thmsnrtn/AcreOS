/**
 * V-Notes-1 N2 — the note record against a REAL database built from this
 * repository. The golden tape is imported through the real commit, then each
 * note's record is read back through the real buildNoteRecord. SYNTHETIC data.
 *
 *   - every term traces to its tape row and cell; a yield field the tape left
 *     blank is null with no invented provenance;
 *   - the document set says which critical document is missing or excepted;
 *   - collateral reads matched (with investment-to-value from the parcel's
 *     market value), unmatched (searched, none found) or not searched (no APN)
 *     — three different answers, never a blank;
 *   - senior liens, tax status and hazards say "never searched", not clean;
 *   - a note entered outside the import says "no source recorded";
 *   - another organization's note is null (the route answers 404).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("noteRecord.realdb.test.ts");
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `n2${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const apnMatched = `SYNTH-${tag}-001`;
const tape = readFileSync(path.join(__dirname, "../../shared/notes/golden/note-tape-golden.csv"), "utf8").replace("SYNTH-0101-001", apnMatched);
const orgIds: number[] = [];
let parcelId: number | null = null;
const noteIds: Record<string, string> = {};

describe.runIf(realDbAvailable)("note record — real database", () => {
  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations, parcelSnapshots } = await import("@shared/schema");
    const { ownedApn, OWNED_SNAPSHOT_SOURCE } = await import("../../server/services/landData/ownedParcelStore");
    const [org] = await db.insert(organizations).values({ name: tag, slug: tag, ownerId: `${tag}-o` } as never).returning();
    orgIds.push(org.id);
    const [p] = await db
      .insert(parcelSnapshots)
      .values({ apn: ownedApn("NC", "wake", apnMatched)!, state: "NC", county: "wake", source: OWNED_SNAPSHOT_SOURCE, organizationId: null, parcelKey: `pk-${tag}`, marketValue: "150000", assessedValue: "120000", taxAmount: "1450.25", taxYear: 2026, rawData: { sourceName: "SYNTHETIC county roll" } } as never)
      .returning({ id: parcelSnapshots.id });
    parcelId = p.id;
    const { readNoteTape, suggestNoteTapeMapping, validateNoteTape } = await import("../../server/services/notes/noteTapeImport");
    const { commitNoteTape } = await import("../../server/services/notes/noteTapeCommit");
    const { sheet, sha256 } = readNoteTape(tape);
    const r = await commitNoteTape({ organizationId: org.id, actorUserId: `${tag}-u`, fileName: "golden.csv", fileSha256: sha256, asOf: "2026-09-30", validation: validateNoteTape({ sheet, mapping: suggestNoteTapeMapping(sheet.headers).mapping }), excludeRows: [4, 5] });
    if (r.status !== "committed") throw new Error(JSON.stringify(r));
    for (const n of r.notes) noteIds[n.noteNumber] = n.noteId;
  });

  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    for (const id of orgIds) {
      await db.execute(sql`DELETE FROM acquired_notes WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${id}`).catch(() => undefined);
    }
    if (parcelId) await db.execute(sql`DELETE FROM parcel_snapshots WHERE id = ${parcelId}`).catch(() => undefined);
    await pool.end();
  });

  it("every term traces to its tape row and cell; a blank yield field is null with no provenance", async () => {
    const { buildNoteRecord } = await import("../../server/services/notes/noteRecord");
    const r = (await buildNoteRecord(orgIds[0], noteIds["SYNTH-1001"]))!;
    const bal = r.terms.find((t) => t.field === "currentBalance")!;
    expect(bal.value).toBe(8425000);
    expect(bal.provenance).toMatchObject({ source: "note_tape", asOf: "2026-09-30", confidence: "medium", sourceRef: { fileRow: 2, column: "UPB", raw: "$84,250.00" } });
    expect(r.terms.every((t) => t.provenance !== null)).toBe(true);
    const balloon = r.yieldFields.find((t) => t.field === "balloonAmount")!;
    expect(balloon).toMatchObject({ value: null, provenance: null, observations: [] });
    expect(r.yieldFields.find((t) => t.field === "remainingTermMonths")).toMatchObject({ value: 221, provenance: expect.objectContaining({ sourceRef: expect.objectContaining({ column: "Remaining Term" }) }) });
  });

  it("matched collateral carries its value with its source, investment-to-value, and liens/tax/hazards as never searched", async () => {
    const { buildNoteRecord } = await import("../../server/services/notes/noteRecord");
    const r = (await buildNoteRecord(orgIds[0], noteIds["SYNTH-1001"]))!;
    expect(r.collateral.status).toBe("matched");
    expect(r.collateral.parcel).toMatchObject({
      parcelKey: `pk-${tag}`,
      source: { name: "SYNTHETIC county roll" },
      value: { marketValueCents: 15000000, assessedValueCents: 12000000 },
      tax: { taxAmountCents: 145025, taxYear: 2026, delinquency: { status: "never_searched" } },
      seniorLiens: { status: "never_searched" },
      hazards: { status: "never_searched" },
    });
    // $61,500 paid against a $150,000 market value.
    expect(r.investmentToValue).toMatchObject({ ratio: 0.41 });
    expect(r.documents).toMatchObject({ complete: true, gaps: [] });
  });

  it("unmatched and never-searched collateral are different answers; incomplete documents name the gap", async () => {
    const { buildNoteRecord } = await import("../../server/services/notes/noteRecord");
    const unmatched = (await buildNoteRecord(orgIds[0], noteIds["SYNTH-1005"]))!;
    expect(unmatched.collateral).toMatchObject({ status: "unmatched", searchedFor: { apn: "SYNTH-0101-005", state: "NC", county: "Wake" }, parcel: null });
    expect(unmatched.investmentToValue).toMatchObject({ status: "not_on_record" });
    const none = (await buildNoteRecord(orgIds[0], noteIds["SYNTH-1002"]))!;
    expect(none.collateral).toMatchObject({ status: "not_searched", searchedFor: null, parcel: null });
    expect(none.documents.complete).toBe(false);
    expect(none.documents.gaps).toEqual(["Assignment chain: exception"]);
    expect(none.documents.exceptionNote).toBe("AOM from SYNTHETIC Bank to SYNTHETIC Trust unrecorded");
    expect(none.documents.entries.find((d) => d.field === "docAllonges")?.state).toBe("not_recorded");
  });

  it("a value entered outside the import says no source recorded — it is never dressed in a source", async () => {
    const { db } = await import("../../server/db");
    const { acquiredNotes } = await import("@shared/schema");
    const [n] = await db
      .insert(acquiredNotes)
      .values({ organizationId: orgIds[0], noteNumber: `${tag}-manual`, payerName: "SYNTHETIC", originalPrincipalCents: 1000, currentBalanceCents: 900, interestRateBps: 800, termMonths: 120, paymentAmountCents: 10, paymentDueDay: 1, originationDate: "2020-01-01", maturityDate: "2030-01-01", acquisitionDate: "2026-01-01", acquisitionPriceCents: 500 })
      .returning({ id: acquiredNotes.id });
    const { buildNoteRecord } = await import("../../server/services/notes/noteRecord");
    const r = (await buildNoteRecord(orgIds[0], n.id))!;
    expect(r.terms.find((t) => t.field === "currentBalance")).toMatchObject({ value: 900, provenance: null });
    expect(r.documents.complete).toBe(false);
    expect(r.documents.gaps).toContain("Original note: no document record");
  });

  it("another organization's note is null — not readable across tenants", async () => {
    const { db } = await import("../../server/db");
    const { organizations } = await import("@shared/schema");
    const [other] = await db.insert(organizations).values({ name: `${tag}-b`, slug: `${tag}-b`, ownerId: `${tag}-b` } as never).returning();
    orgIds.push(other.id);
    const { buildNoteRecord } = await import("../../server/services/notes/noteRecord");
    expect(await buildNoteRecord(other.id, noteIds["SYNTH-1001"])).toBeNull();
  });
});
