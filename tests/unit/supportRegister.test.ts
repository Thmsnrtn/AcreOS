import { describe, it, expect } from "vitest";
import {
  SUPPORT_REGISTER_HEADER,
  renderRegister,
  parseRegister,
  upsertRow,
  buildDigest,
  formatDigestBlock,
  type SupportRegisterRow,
} from "../../shared/support/register";
import { SUPPORT_TRIAGE_CATEGORIES } from "../../shared/support/triage";

function row(over: Partial<SupportRegisterRow> & Pick<SupportRegisterRow, "id">): SupportRegisterRow {
  return {
    arrivedAt: "2026-11-09T10:00:00.000Z",
    from: "person@example.com",
    subject: "Hello",
    category: "how-to",
    status: "open",
    deadlineAt: null,
    dsarRecordId: null,
    reAlert50FiredAt: null,
    reAlert90FiredAt: null,
    firstResponseAt: null,
    draftNote: "",
    ...over,
  };
}

describe("register round-trip", () => {
  const rows: SupportRegisterRow[] = [
    row({
      id: "SUP-2026-0001",
      category: "privacy",
      subject: "Delete my data",
      status: "drafted",
      deadlineAt: "2026-11-10T10:00:00.000Z",
      dsarRecordId: null,
    }),
    row({
      id: "SUP-2026-0002",
      category: "billing-money",
      subject: "Charged twice",
      status: "answered",
      deadlineAt: "2026-11-09T23:59:59.999Z",
      firstResponseAt: "2026-11-09T12:00:00.000Z",
    }),
    row({
      id: "SUP-2026-0003",
      category: "how-to",
      subject: "Export notes",
      draftNote: 'Reply says "see docs", then: (a) step; (b) step — done.',
    }),
  ];

  it("render → parse deep-equals the original rows", () => {
    expect(parseRegister(renderRegister(rows))).toEqual(rows);
  });

  it("default header includes the file title", () => {
    expect(renderRegister(rows)).toContain("# Support inbox register");
    expect(renderRegister(rows)).toContain(SUPPORT_REGISTER_HEADER);
  });
});

describe("upsertRow", () => {
  const a = row({ id: "A" });
  const b = row({ id: "B" });

  it("appends a new id", () => {
    const next = upsertRow([a, b], row({ id: "C" }));
    expect(next.map((r) => r.id)).toEqual(["A", "B", "C"]);
  });

  it("replaces in place without mutating the original", () => {
    const original = [a, b];
    const updated = row({ id: "A", status: "closed" });
    const next = upsertRow(original, updated);
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(updated);
    expect(next[1]).toBe(b);
    expect(original[0]).toBe(a);
    expect(original[0].status).toBe("open");
  });
});

describe("digest", () => {
  const now = "2026-11-10T00:00:00.000Z";
  const rows: SupportRegisterRow[] = [
    row({
      id: "P1",
      category: "privacy",
      status: "open",
      deadlineAt: "2026-11-09T18:00:00.000Z",
    }),
    row({
      id: "M1",
      category: "billing-money",
      status: "answered",
      deadlineAt: "2026-11-09T23:59:59.999Z",
      firstResponseAt: "2026-11-09T12:00:00.000Z",
    }),
    row({
      id: "M2",
      category: "billing-money",
      status: "closed",
      deadlineAt: "2026-11-08T23:59:59.999Z",
      firstResponseAt: "2026-11-08T09:00:00.000Z",
    }),
    row({
      id: "H1",
      category: "how-to",
      status: "open",
      deadlineAt: "2026-11-11T23:59:59.999Z",
    }),
  ];

  it("buildDigest counts per category", () => {
    const d = buildDigest(rows, now);
    expect(d.byCategory.privacy).toEqual({ open: 1, closed: 0, breached: 1 });
    expect(d.byCategory["billing-money"]).toEqual({ open: 0, closed: 2, breached: 0 });
    expect(d.byCategory["how-to"]).toEqual({ open: 1, closed: 0, breached: 0 });
    expect(d.byCategory.bug).toEqual({ open: 0, closed: 0, breached: 0 });
    expect(d.totalOpen).toBe(2);
    expect(d.breachesByCategory).toEqual(["privacy"]);
  });

  it("formatDigestBlock has a line per category and the breach line", () => {
    const text = formatDigestBlock(buildDigest(rows, now));
    for (const c of SUPPORT_TRIAGE_CATEGORIES) {
      expect(text).toContain(`${c}: open `);
    }
    expect(text).toContain("Breaches: privacy");
  });

  it("no-breach digest renders Breaches: none", () => {
    const text = formatDigestBlock(buildDigest([rows[3]], now));
    expect(text).toContain("Breaches: none");
  });
});

describe("parse tolerance", () => {
  it("skips a malformed block and header prose without throwing", () => {
    const valid = row({ id: "SUP-OK", category: "bug", subject: "Crash" });
    const good = renderRegister([valid], "");
    const text = [
      "# Some hand-edited header",
      "",
      "Random prose that is not a row.",
      "",
      "### SUP-BAD",
      "- arrived: 2026-11-09T10:00:00.000Z",
      "- from: x@example.com",
      "- subject: Whatever",
      "- category: not-a-category",
      "- status: open",
      "- deadline: -",
      "- dsar: -",
      "- alert50: -",
      "- alert90: -",
      "- first-response: -",
      '- draft: ""',
      "",
      good,
    ].join("\n");

    let parsed: SupportRegisterRow[] = [];
    expect(() => {
      parsed = parseRegister(text);
    }).not.toThrow();
    expect(parsed).toEqual([valid]);
  });
});
