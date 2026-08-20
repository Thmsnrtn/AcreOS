/**
 * A document with more than one signer must be completable.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * Both signature-capture paths recorded progress by rewriting the signer roster
 * on the document:
 *
 *     const updatedSigners = signers.map((x, i) =>
 *       i === signerIdx ? { ...x, signedAt: now, signatureUrl: … } : x);
 *     await storage.updateGeneratedDocument(doc.id, {
 *       signers: updatedSigners,
 *       status: allSigned ? "signed" : "partially_signed",
 *     });
 *
 * `acreos_block_signed_doc_mutation_trigger` (scripts/migrate.mjs) raises on any
 * UPDATE that changes `content`, `variables` or `signers` of a document already
 * in status 'signed' | 'partially_signed' | 'final'. So the FIRST signature was
 * fine — the document was still 'draft' — and it set status to
 * 'partially_signed'. The SECOND signature then changed `signers` on a
 * 'partially_signed' row and the trigger raised, which the route surfaced as a
 * 500.
 *
 * Every multi-signer document was therefore impossible to complete, on the
 * counterparty-facing public signing page, in production. `allSigned` could
 * never become true, so `status` never reached 'signed' and `completedAt` was
 * never set.
 *
 * ── WHY THE TRIGGER WAS NOT THE THING TO FIX ────────────────────────────────
 * Loosening it to permit `signers` edits while 'partially_signed' would reopen
 * the tamper vector it exists to close: changing WHO is on the signer roster
 * after somebody has already signed. The bug was two different things sharing
 * one column. The roster is document substance and belongs under the trigger.
 * Who actually signed is evidence, and the `signatures` table is its home.
 *
 * ── HOW THIS TEST AVOIDS BEING A COPY OF THE THING IT GUARDS ────────────────
 * The protected-column list is READ OUT OF scripts/migrate.mjs at test time
 * rather than restated here. A test carrying its own copy of the predicate goes
 * green when the real trigger changes underneath it — it would then be pinning
 * a rule the database no longer has. Parsing the source means widening the
 * trigger to protect a fourth column immediately makes this test consider that
 * column too.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

// ── The real trigger, read from the migration that creates it ───────────────

const MIGRATE = fs.readFileSync(path.join(ROOT, "scripts/migrate.mjs"), "utf8");

/** Columns the live trigger refuses to let change once a doc is immutable. */
function protectedColumns(): string[] {
  const fn = /CREATE OR REPLACE FUNCTION acreos_block_signed_doc_mutation\(\)([\s\S]*?)\$\$ LANGUAGE plpgsql/.exec(
    MIGRATE,
  );
  if (!fn) return [];
  return [...fn[1].matchAll(/NEW\.(\w+) IS DISTINCT FROM OLD\.\1/g)].map((m) => m[1]);
}

/** Statuses in which the live trigger enforces immutability. */
function immutableStatuses(): string[] {
  const fn = /CREATE OR REPLACE FUNCTION acreos_block_signed_doc_mutation\(\)([\s\S]*?)\$\$ LANGUAGE plpgsql/.exec(
    MIGRATE,
  );
  if (!fn) return [];
  const inClause = /OLD\.status IN \(([^)]*)\)/.exec(fn[1]);
  if (!inClause) return [];
  return [...inClause[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/**
 * The trigger, in JS. Not a restatement of the RULE — the rule (which columns,
 * which statuses) is parsed above. This is only the mechanical comparison.
 */
function triggerWouldRaise(oldRow: Record<string, unknown>, patch: Record<string, unknown>): boolean {
  if (!immutableStatuses().includes(String(oldRow.status))) return false;
  return protectedColumns().some(
    (col) => col in patch && JSON.stringify(patch[col]) !== JSON.stringify(oldRow[col]),
  );
}

// ── The unit under test ─────────────────────────────────────────────────────

const rows: any[] = [];
vi.mock("../../server/storage", () => ({
  storage: { getSignatures: async () => rows },
}));

import { loadSigningProgress, statusPatchFor } from "../../server/services/esign/signingProgress";

const ROSTER = [
  { id: "s1", name: "Alice Buyer", email: "alice@example.com", role: "buyer" },
  { id: "s2", name: "Bob Seller", email: "bob@example.com", role: "seller" },
];

function sig(email: string, name: string) {
  return { signerEmail: email, signerName: name, signedAt: new Date("2026-08-20T12:00:00Z"), createdAt: null };
}

beforeEach(() => {
  rows.length = 0;
});

describe("the trigger this fix works around is real and still says what we think", () => {
  it("vacuity: the trigger is found in the migration and protects real columns", () => {
    // Every assertion below is about a parsed list. If the parse breaks, the
    // lists are empty, `triggerWouldRaise` returns false for everything, and
    // this file certifies a trigger it never read.
    const cols = protectedColumns();
    const statuses = immutableStatuses();
    expect(cols.length, "parsed no protected columns out of scripts/migrate.mjs").toBeGreaterThan(0);
    expect(cols, "the trigger no longer protects `signers` — re-read this test's premise").toContain(
      "signers",
    );
    expect(cols).toContain("content");
    expect(statuses).toContain("partially_signed");
    expect(statuses).toContain("signed");
  });

  it("models the raise: a roster rewrite on a partially-signed doc trips it", () => {
    // The negative-space check. If this did not raise, the whole defect story
    // is wrong and the rest of the file is guarding nothing.
    const oldRow = { status: "partially_signed", signers: ROSTER, content: "x", variables: {} };
    const rosterRewrite = { signers: [{ ...ROSTER[0], signedAt: "now" }, ROSTER[1]], status: "signed" };
    expect(triggerWouldRaise(oldRow, rosterRewrite)).toBe(true);
  });
});

describe("signing progress is derived, so the second signer completes", () => {
  it("vacuity: a fully-signed roster reports allSigned, so absence means something", async () => {
    rows.push(sig("alice@example.com", "Alice Buyer"), sig("bob@example.com", "Bob Seller"));
    const p = await loadSigningProgress(1, 10, ROSTER);
    expect(p.allSigned).toBe(true);
    expect(p.outstanding).toEqual([]);
  });

  it("one of two signed → partially signed, and the patch does NOT trip the trigger", async () => {
    rows.push(sig("alice@example.com", "Alice Buyer"));
    const p = await loadSigningProgress(1, 10, ROSTER);
    expect(p.allSigned).toBe(false);
    expect(p.hasSigned("s1")).toBe(true);
    expect(p.hasSigned("s2")).toBe(false);

    const patch = statusPatchFor(p);
    const oldRow = { status: "pending_signature", signers: ROSTER, content: "x", variables: {} };
    expect(triggerWouldRaise(oldRow, patch as any)).toBe(false);
  });

  it("THE REGRESSION: the second signature's patch does not trip the trigger", async () => {
    // This is the exact moment that used to 500. The document is already
    // 'partially_signed' — the immutable state — and the second signature has
    // just landed.
    rows.push(sig("alice@example.com", "Alice Buyer"), sig("bob@example.com", "Bob Seller"));
    const p = await loadSigningProgress(1, 10, ROSTER);
    expect(p.allSigned).toBe(true);

    const patch = statusPatchFor(p);
    const oldRow = { status: "partially_signed", signers: ROSTER, content: "x", variables: {} };
    expect(
      triggerWouldRaise(oldRow, patch as any),
      "the status patch touches a column the immutability trigger protects — this is " +
        "the multi-signer 500 returning. The patch must carry status fields ONLY.",
    ).toBe(false);
    expect(patch.status).toBe("signed");
    expect(patch.completedAt).toBeInstanceOf(Date);
  });

  it("carries no protected column at all, whatever the progress state", async () => {
    // Stated as a property over the parsed column list rather than as
    // `expect(patch).not.toHaveProperty('signers')`, so a trigger that grows a
    // fourth protected column is covered without editing this test.
    for (const preloaded of [[], [sig("alice@example.com", "Alice Buyer")]]) {
      rows.length = 0;
      rows.push(...preloaded);
      const patch = statusPatchFor(await loadSigningProgress(1, 10, ROSTER)) as Record<string, unknown>;
      for (const col of protectedColumns()) {
        expect(Object.keys(patch), `the status patch carries protected column "${col}"`).not.toContain(
          col,
        );
      }
    }
  });

  it("an empty roster is not vacuously complete", async () => {
    // The old code used `updatedSigners.every(s => s.signedAt)`, which is true
    // for [] — so a document with no signers would have been stamped 'signed'
    // and given a completedAt.
    const p = await loadSigningProgress(1, 10, []);
    expect(p.allSigned).toBe(false);
  });

  it("honours legacy roster markers so historical documents do not regress", async () => {
    // Documents partly signed before progress moved to the signatures table
    // carry `signedAt` on the roster. That is a truthful record of something
    // that happened and must keep counting.
    const legacyRoster = [
      { ...ROSTER[0], signedAt: "2026-01-05T09:00:00.000Z" },
      ROSTER[1],
    ];
    rows.push(sig("bob@example.com", "Bob Seller"));
    const p = await loadSigningProgress(1, 10, legacyRoster);
    expect(p.allSigned).toBe(true);
    expect(p.perSigner.find((x) => x.signer.id === "s1")?.source).toBe("legacy_roster");
    expect(p.perSigner.find((x) => x.signer.id === "s2")?.source).toBe("signature_row");
  });

  it("does not credit a signature to the wrong roster entry", async () => {
    // Matching is exact on email, then exact on name. A looser match would let
    // one signature mark a different party as having signed — the worst
    // available failure in this file.
    rows.push(sig("alice@example.com", "Alice Buyer"));
    const p = await loadSigningProgress(1, 10, [
      { id: "s1", name: "Alice Buyer", email: "alice@example.com" },
      { id: "s2", name: "Alice Buyer Jr", email: "alice.jr@example.com" },
    ]);
    expect(p.hasSigned("s1")).toBe(true);
    expect(p.hasSigned("s2")).toBe(false);
  });
});

describe("neither SIGNATURE-RECORDING handler writes the roster", () => {
  /**
   * Scoped to the two handlers that RECORD a signature, deliberately.
   *
   * A blanket "never pass `signers` to updateGeneratedDocument" rule fails on
   * three legitimate call sites: PUT /api/generated-documents/:id and the two
   * /request-signature paths all write the roster, and all three refuse first
   * when the document is already in a frozen status (the first via
   * IMMUTABLE_DOCUMENT_STATUSES, the other two via `status !== "draft"`). They
   * ESTABLISH the roster on a draft; they never mutate one mid-signing. The
   * defect was specifically the progress-advance path, so that is what this
   * pins — a rule that also flagged the safe sites would be turned off.
   */
  function handlerBody(rel: string, decl: string): string {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const at = src.indexOf(decl);
    expect(at, `route declaration not found in ${rel}: ${decl}`).toBeGreaterThan(-1);
    let depth = 0;
    let i = src.indexOf("{", at);
    const start = i;
    do {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") depth -= 1;
      i += 1;
    } while (i < src.length && depth > 0);
    return src.slice(start, i);
  }

  const HANDLERS: Array<[string, string]> = [
    ["server/routes-public-sign.ts", 'app.post("/api/public/sign/:docId"'],
    ["server/routes-doc-system.ts", 'api.post("/api/signatures"'],
  ];

  it.each(HANDLERS)("%s → %s advances status without a protected column", (rel, decl) => {
    const body = handlerBody(rel, decl);

    // Vacuity: the handler must actually contain the call being constrained,
    // or "no violation" means "nothing was examined".
    const calls = [...body.matchAll(/updateGeneratedDocument\(([\s\S]{0,400}?)\)\s*;/g)];
    expect(calls.length, `no updateGeneratedDocument call in ${rel} ${decl}`).toBeGreaterThan(0);

    for (const call of calls) {
      for (const col of protectedColumns()) {
        expect(
          new RegExp(`\\b${col}\\s*:`).test(call[1]),
          `${rel} passes "${col}" while recording a signature. That column is protected ` +
            "by acreos_block_signed_doc_mutation_trigger, so the write raises the moment " +
            "the document is already partially_signed — which is the multi-signer 500.",
        ).toBe(false);
      }
    }
  });
});

describe("the app-layer immutability rule has not drifted from the trigger", () => {
  /**
   * routes-doc-system.ts restates the trigger's rule in TypeScript, as
   * IMMUTABLE_DOCUMENT_STATUSES and CONTENT_BEARING_FIELDS, and enforces it at
   * the route level. Two independent statements of one rule drift, and the
   * failure is silent in the dangerous direction: if the trigger grew a fourth
   * protected column, the route guard would keep letting that column through
   * and callers would start getting 500s from the database instead of a clean
   * 403 — or, worse, if the constants grew and the trigger did not, the app
   * would advertise a protection the database does not have.
   */
  const DOC_ROUTES = fs.readFileSync(path.join(ROOT, "server/routes-doc-system.ts"), "utf8");

  function tsSetMembers(name: string): string[] {
    const m = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(DOC_ROUTES);
    return m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : [];
  }
  function tsArrayMembers(name: string): string[] {
    const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`).exec(DOC_ROUTES);
    return m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : [];
  }

  it("the statuses match", () => {
    const ts = tsSetMembers("IMMUTABLE_DOCUMENT_STATUSES");
    expect(ts.length, "parsed no members out of IMMUTABLE_DOCUMENT_STATUSES").toBeGreaterThan(0);
    expect([...ts].sort()).toEqual([...immutableStatuses()].sort());
  });

  it("the protected fields match", () => {
    const ts = tsArrayMembers("CONTENT_BEARING_FIELDS");
    expect(ts.length, "parsed no members out of CONTENT_BEARING_FIELDS").toBeGreaterThan(0);
    expect([...ts].sort()).toEqual([...protectedColumns()].sort());
  });
});
