import { describe, it, expect } from "vitest";
import {
  buildFcraDefenseFile,
  fcraDefenseFileToCsv,
  type DefenseFileLedgerRow,
} from "../../server/services/fcraDefenseFile";

const CUR = "2026-05-08-v1";
const NOW = new Date("2026-11-14T12:00:00.000Z");
const DAY = 86_400_000;
const PHONE = "555-867-5309";

function row(over: Partial<DefenseFileLedgerRow> & { id: number }): DefenseFileLedgerRow {
  return {
    createdAt: new Date("2026-11-01T00:00:00Z"),
    actorUserId: "u1",
    surface: "skip_trace_call",
    purposeCode: "legitimate_business_need",
    justification: "Reaching the owner about a land offer",
    attestationVersion: CUR,
    leadId: 1,
    skipTraceId: null,
    apid: null,
    meteringRef: null,
    // Carries a phone-like string the projection must never emit.
    ...({ metadata: { phone: PHONE } } as object),
    ...over,
  };
}

const build = (entries: DefenseFileLedgerRow[], attestations: any[] = [], truncated = false) =>
  buildFcraDefenseFile({
    organizationId: 7,
    generatedAt: NOW,
    currentAttestationVersion: CUR,
    entries,
    attestations,
    truncated,
  });

describe("buildFcraDefenseFile — coverage", () => {
  it("computes counts, distinct actors and date range", () => {
    const f = build(
      [
        row({ id: 3, createdAt: new Date("2026-11-10T00:00:00Z"), actorUserId: "u2", purposeCode: "collection", surface: "batch" }),
        row({ id: 2, createdAt: new Date("2026-11-05T00:00:00Z") }),
        row({ id: 1, createdAt: new Date("2026-10-01T00:00:00Z") }),
      ],
      [],
      true,
    );
    expect(f.organizationId).toBe(7);
    expect(f.generatedAt).toBe(NOW.toISOString());
    expect(f.coverage).toEqual({
      totalEntries: 3,
      byPurposeCode: { collection: 1, legitimate_business_need: 2 },
      bySurface: { batch: 1, skip_trace_call: 2 },
      distinctActors: 2,
      firstEntryAt: "2026-10-01T00:00:00.000Z",
      lastEntryAt: "2026-11-10T00:00:00.000Z",
      truncated: true,
    });
  });

  it("empty trail: zeros, null range, empty lists", () => {
    const f = build([]);
    expect(f.coverage).toEqual({
      totalEntries: 0,
      byPurposeCode: {},
      bySurface: {},
      distinctActors: 0,
      firstEntryAt: null,
      lastEntryAt: null,
      truncated: false,
    });
    expect(f.entries).toEqual([]);
    expect(f.attestations).toEqual([]);
    expect(fcraDefenseFileToCsv(f).split("\r\n")[0]).toContain("id,createdAt");
  });

  it("preserves input order of entries", () => {
    const f = build([row({ id: 5 }), row({ id: 9 }), row({ id: 2 })]);
    expect(f.entries.map((e) => e.id)).toEqual([5, 9, 2]);
  });
});

describe("buildFcraDefenseFile — attestations", () => {
  const at = (userId: string, version: string, d: Date) => ({ userId, attestationVersion: version, attestedAt: d });

  it("picks the latest per user regardless of input order; current case + expiresAt", () => {
    const newer = new Date(NOW.getTime() - 10 * DAY);
    const older = new Date(NOW.getTime() - 200 * DAY);
    const f = build([], [at("u1", CUR, older), at("u1", CUR, newer), at("u2", CUR, older)]);
    const u1 = f.attestations.find((a) => a.userId === "u1")!;
    expect(f.attestations).toHaveLength(2);
    expect(u1.attestedAt).toBe(newer.toISOString());
    expect(u1.expiresAt).toBe(new Date(newer.getTime() + 365 * DAY).toISOString());
    expect(u1.status).toBe("current");
  });

  it("stale by version mismatch", () => {
    const f = build([], [at("u1", "old-v0", new Date(NOW.getTime() - DAY))]);
    expect(f.attestations[0].status).toBe("stale");
    expect(f.attestations[0].attestationVersion).toBe("old-v0");
  });

  it("stale by age only beyond 365 days", () => {
    const f = build([], [
      at("edge", CUR, new Date(NOW.getTime() - 365 * DAY)),
      at("old", CUR, new Date(NOW.getTime() - 366 * DAY)),
    ]);
    expect(f.attestations.find((a) => a.userId === "edge")!.status).toBe("current");
    expect(f.attestations.find((a) => a.userId === "old")!.status).toBe("stale");
  });
});

describe("buildFcraDefenseFile — projection + CSV", () => {
  it("projects exactly the listed fields; metadata appears nowhere", () => {
    const f = build([row({ id: 1 })]);
    expect(Object.keys(f.entries[0])).toEqual([
      "id", "createdAt", "actorUserId", "surface", "purposeCode", "justification",
      "attestationVersion", "leadId", "skipTraceId", "apid", "meteringRef",
    ]);
    expect(JSON.stringify(f)).not.toContain(PHONE);
    expect(JSON.stringify(f)).not.toContain("metadata");
    expect(fcraDefenseFileToCsv(f)).not.toContain(PHONE);
  });

  it("CSV header follows projection order; null → empty", () => {
    const lines = fcraDefenseFileToCsv(build([row({ id: 1, justification: null })])).split("\r\n");
    expect(lines[0]).toBe(
      "id,createdAt,actorUserId,surface,purposeCode,justification,attestationVersion,leadId,skipTraceId,apid,meteringRef",
    );
    expect(lines[1]).toBe(`1,2026-11-01T00:00:00.000Z,u1,skip_trace_call,legitimate_business_need,,${CUR},1,,,`);
  });

  it("quotes commas, double quotes and newlines (RFC 4180)", () => {
    const j = 'Owner said "yes", call\nback';
    const csv = fcraDefenseFileToCsv(build([row({ id: 1, justification: j })]));
    expect(csv).toContain('"Owner said ""yes"", call\nback"');
    // Round-trip with a minimal RFC-4180 reader.
    const fields: string[] = [];
    const body = csv.split("\r\n")[1] + "\r\n" + csv.split("\r\n").slice(2).join("\r\n");
    let cur = "", q = false;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (q) {
        if (c === '"' && body[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { fields.push(cur); cur = ""; }
      else if (c === "\r") break;
      else cur += c;
    }
    fields.push(cur);
    expect(fields[5]).toBe(j);
    expect(fields).toHaveLength(11);
  });
});
