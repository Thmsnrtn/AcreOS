/**
 * Reg-Z §1026.43(c) ability-to-repay gate tests.
 *
 * Statute-register entry `regz.ability-to-repay` recorded this gate as its
 * "clearest piece of enforcement debt": a hard refusal in
 * server/storage/noteRepo.ts + server/routes-finance.ts with ZERO tests, so a
 * refactor that dropped it would break nothing visible — while the borrower
 * gains a §1026.43 foreclosure defense for the life of the loan.
 *
 * Coverage here, in four layers:
 *  A. The repo-layer refusal itself (createNote / updateNote), via the
 *     established scripted-db-mock pattern (see
 *     server/storage/dealRepo.lifecycle.test.ts).
 *  B. Honest-refusal shape: named error code, statutory citation, the
 *     exemption checklist, and the routes' 422 + regulatoryCite surface.
 *  C. The evidence trail: validateAtrDetermination (pure) +
 *     persistAtrDetermination writes the full eight-factor attestation
 *     record with the canonical §1026.43(c) attestation text.
 *  D. Caller-path completeness: every path into `notes` creation/activation
 *     is enumerated and pinned (comment-stripped source assertions), and a
 *     filesystem scan ratchets the set of direct-insert sites so a NEW
 *     ungated insert path fails this test. The DB CHECK constraint
 *     (migration 0099) — the only defense on the payment-side status flips —
 *     is pinned against silent removal.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ── Scripted DB mock (dealRepo.lifecycle.test.ts pattern) ───────────────────
const h = vi.hoisted(() => {
  const state = {
    /** rows returned per select (shifted per query, lazily on await/.limit) */
    selectRows: [] as unknown[][],
    /** captured .values(v) payloads, in call order */
    insertValues: [] as unknown[],
    /** rows returned per insert .returning() */
    insertRows: [] as unknown[][],
    /** captured .set(v) payloads, in call order */
    updateSets: [] as unknown[],
    /** rows returned per update (await or .returning()) */
    updateRows: [] as unknown[][],
  };
  return { state };
});

vi.mock("../../server/db", () => {
  const s = h.state;
  const nextSelect = () => Promise.resolve(s.selectRows.shift() ?? []);
  const nextUpdate = () => Promise.resolve(s.updateRows.shift() ?? []);
  const db = {
    select: (_cols?: unknown) => ({
      from: (_t: unknown) => ({
        where: (_w: unknown) => ({
          limit: (_n: number) => nextSelect(),
          then: (
            onOk: (rows: unknown[]) => unknown,
            onErr?: (e: unknown) => unknown,
          ) => nextSelect().then(onOk, onErr),
        }),
      }),
    }),
    insert: (_t: unknown) => ({
      values: (v: unknown) => {
        s.insertValues.push(v);
        return {
          returning: (_cols?: unknown) =>
            Promise.resolve(s.insertRows.shift() ?? [{ id: 999 }]),
        };
      },
    }),
    update: (_t: unknown) => ({
      set: (v: unknown) => {
        s.updateSets.push(v);
        return {
          where: (_w: unknown) => ({
            returning: (_cols?: unknown) => nextUpdate(),
            then: (
              onOk: (rows: unknown[]) => unknown,
              onErr?: (e: unknown) => unknown,
            ) => nextUpdate().then(onOk, onErr),
          }),
        };
      },
    }),
  };
  return {
    db,
    withTransaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
  };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { noteRepo } from "../../server/storage/noteRepo";
import {
  ATR_ATTESTATION_TEXT,
  AtrIncompleteError,
  persistAtrDetermination,
  validateAtrDetermination,
  type AtrDeterminationInput,
} from "../../server/services/atrSafeHarbor";
import type { DatabaseStorage } from "../../server/storage";
import type { InsertNote } from "@shared/schema";

const s = h.state;

const logActivity = vi.fn(async () => undefined);
const repoThis = { logActivity } as unknown as DatabaseStorage;

function baseNote(overrides: Partial<InsertNote> = {}): InsertNote {
  return {
    organizationId: 1,
    originalPrincipal: "24000",
    currentBalance: "24000",
    interestRate: "9.5",
    termMonths: 24,
    monthlyPayment: "1102.50",
    startDate: new Date("2026-01-01T00:00:00Z"),
    firstPaymentDate: new Date("2026-02-01T00:00:00Z"),
    ...overrides,
  } as InsertNote;
}

async function expectAtrRefusal(p: Promise<unknown>): Promise<Error & { code?: string }> {
  let caught: unknown;
  try {
    await p;
  } catch (e) {
    caught = e;
  }
  expect(caught, "expected the ATR gate to refuse").toBeInstanceOf(Error);
  const err = caught as Error & { code?: string };
  expect(err.code).toBe("ATR_DETERMINATION_REQUIRED");
  return err;
}

beforeEach(() => {
  s.selectRows.length = 0;
  s.insertValues.length = 0;
  s.insertRows.length = 0;
  s.updateSets.length = 0;
  s.updateRows.length = 0;
  vi.clearAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════
// A. createNote — origination gate
// ════════════════════════════════════════════════════════════════════════════

describe("noteRepo.createNote — §1026.43(c) origination gate", () => {
  it("refuses status='active' with no ATR determination and no exemption — and never touches the DB", async () => {
    const err = await expectAtrRefusal(
      noteRepo.createNote.call(repoThis, baseNote({ status: "active" })),
    );
    expect(err.message).toContain("1026.43(c)");
    expect(s.insertValues).toHaveLength(0); // refusal happens BEFORE the insert
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("fails closed when status is omitted (schema default is 'active')", async () => {
    // notes.status has DB default 'active' — the gate must treat an omitted
    // status as an activation attempt, not silently let the default through.
    await expectAtrRefusal(noteRepo.createNote.call(repoThis, baseNote()));
    expect(s.insertValues).toHaveLength(0);
  });

  it("refuses truthy-but-not-true atrDeterminationCompleted (strict === true)", async () => {
    await expectAtrRefusal(
      noteRepo.createNote.call(
        repoThis,
        baseNote({
          status: "active",
          atrDeterminationCompleted: 1 as unknown as boolean,
        }),
      ),
    );
    expect(s.insertValues).toHaveLength(0);
  });

  it("refuses unrecognized exemption codes (case-sensitive whitelist)", async () => {
    for (const bad of ["LEGACY", "Raw_Land", "primary_residence", ""]) {
      await expectAtrRefusal(
        noteRepo.createNote.call(
          repoThis,
          baseNote({ status: "active", atrExemptionCode: bad }),
        ),
      );
    }
    expect(s.insertValues).toHaveLength(0);
  });

  it("refuses a non-string exemption payload (object smuggling through the widened type)", async () => {
    await expectAtrRefusal(
      noteRepo.createNote.call(
        repoThis,
        baseNote({
          status: "active",
          atrExemptionCode: { code: "raw_land" } as unknown as string,
        }),
      ),
    );
    expect(s.insertValues).toHaveLength(0);
  });

  it("allows status='active' with atrDeterminationCompleted=true and persists the flag on the row", async () => {
    s.insertRows.push([{ id: 41 }]);
    await noteRepo.createNote.call(
      repoThis,
      baseNote({ status: "active", atrDeterminationCompleted: true }),
    );
    expect(s.insertValues).toHaveLength(1);
    const inserted = s.insertValues[0] as Record<string, unknown>;
    expect(inserted.status).toBe("active");
    expect(inserted.atrDeterminationCompleted).toBe(true);
    expect(logActivity).toHaveBeenCalledTimes(1);
  });

  it.each(["raw_land", "business_purpose", "commercial_borrower", "legacy"])(
    "allows status='active' with recognized exemption code '%s' and persists it as evidence",
    async (code) => {
      s.insertRows.push([{ id: 42 }]);
      await noteRepo.createNote.call(
        repoThis,
        baseNote({ status: "active", atrExemptionCode: code }),
      );
      const inserted = s.insertValues[0] as Record<string, unknown>;
      expect(inserted.atrExemptionCode).toBe(code);
    },
  );

  it("allows status='pending' with no ATR — the gate guards ACTIVATION, not drafting", async () => {
    s.insertRows.push([{ id: 43 }]);
    await noteRepo.createNote.call(repoThis, baseNote({ status: "pending" }));
    expect(s.insertValues).toHaveLength(1);
    expect((s.insertValues[0] as Record<string, unknown>).status).toBe("pending");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B. updateNote — activation gate on status transitions
// ════════════════════════════════════════════════════════════════════════════

describe("noteRepo.updateNote — §1026.43(c) activation gate", () => {
  it("refuses status→'active' when the stored row has neither ATR nor exemption — no UPDATE issued", async () => {
    s.selectRows.push([{ atrDeterminationCompleted: false, atrExemptionCode: null }]);
    const err = await expectAtrRefusal(
      noteRepo.updateNote.call(repoThis, 5, { status: "active" }, 1),
    );
    expect(err.message).toContain("1026.43(c)");
    expect(s.updateSets).toHaveLength(0);
  });

  it("fails closed when the row does not exist (empty gate select)", async () => {
    s.selectRows.push([]);
    await expectAtrRefusal(
      noteRepo.updateNote.call(repoThis, 999, { status: "active" }, 1),
    );
    expect(s.updateSets).toHaveLength(0);
  });

  it("allows status→'active' when the stored row already has a completed ATR determination", async () => {
    s.selectRows.push([{ atrDeterminationCompleted: true, atrExemptionCode: null }]);
    s.updateRows.push([{ id: 5, status: "active" }]);
    await noteRepo.updateNote.call(repoThis, 5, { status: "active" }, 1);
    expect(s.updateSets).toHaveLength(1);
    expect((s.updateSets[0] as Record<string, unknown>).status).toBe("active");
  });

  it("allows status→'active' when the stored row carries a valid exemption code", async () => {
    s.selectRows.push([{ atrDeterminationCompleted: false, atrExemptionCode: "raw_land" }]);
    s.updateRows.push([{ id: 5, status: "active" }]);
    await noteRepo.updateNote.call(repoThis, 5, { status: "active" }, 1);
    expect(s.updateSets).toHaveLength(1);
  });

  it("allows status→'active' when the update itself carries atrDeterminationCompleted=true", async () => {
    s.selectRows.push([{ atrDeterminationCompleted: false, atrExemptionCode: null }]);
    s.updateRows.push([{ id: 5, status: "active" }]);
    await noteRepo.updateNote.call(
      repoThis,
      5,
      { status: "active", atrDeterminationCompleted: true },
      1,
    );
    expect(s.updateSets).toHaveLength(1);
  });

  it("refuses when the update explicitly sets atrDeterminationCompleted=false, even if the row had true", async () => {
    s.selectRows.push([{ atrDeterminationCompleted: true, atrExemptionCode: null }]);
    await expectAtrRefusal(
      noteRepo.updateNote.call(
        repoThis,
        5,
        { status: "active", atrDeterminationCompleted: false },
        1,
      ),
    );
    expect(s.updateSets).toHaveLength(0);
  });

  it("refuses an invalid exemption code supplied in the update", async () => {
    s.selectRows.push([{ atrDeterminationCompleted: false, atrExemptionCode: null }]);
    await expectAtrRefusal(
      noteRepo.updateNote.call(
        repoThis,
        5,
        { status: "active", atrExemptionCode: "not_a_code" },
        1,
      ),
    );
    expect(s.updateSets).toHaveLength(0);
  });

  it("does not consult the gate for non-activating updates", async () => {
    s.selectRows.push([{ atrDeterminationCompleted: false, atrExemptionCode: null }]); // sentinel
    s.updateRows.push([{ id: 5, status: "defaulted" }]);
    await noteRepo.updateNote.call(repoThis, 5, { status: "defaulted" }, 1);
    expect(s.selectRows).toHaveLength(1); // sentinel unconsumed — no gate select ran
    expect(s.updateSets).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B². Honest-refusal shape
// ════════════════════════════════════════════════════════════════════════════

describe("refusal shape — named reason, citation, actionable checklist", () => {
  it("the refusal names the statute, the fix, and every accepted exemption code", async () => {
    const err = await expectAtrRefusal(
      noteRepo.createNote.call(repoThis, baseNote({ status: "active" })),
    );
    expect(err.message).toMatch(/Reg Z .?1026\.43\(c\)/);
    expect(err.message).toContain("persistAtrDetermination");
    for (const code of ["raw_land", "business_purpose", "commercial_borrower"]) {
      expect(err.message).toContain(code);
    }
  });

  it("routes-finance surfaces every ATR_DETERMINATION_REQUIRED as 422 with the regulatory cite", () => {
    const src = strippedSource("server/routes-finance.ts");
    const marker = 'e?.code === "ATR_DETERMINATION_REQUIRED"';
    const chunks = src.split(marker);
    // Three catch sites: POST /api/notes, PUT /api/notes/:id, POST /api/notes/:id/originate.
    expect(chunks.length - 1).toBe(3);
    for (const after of chunks.slice(1)) {
      expect(after.slice(0, 200)).toContain("res.status(422)");
    }
    expect(src).toContain('regulatoryCite: "12 CFR §1026.43(c)"');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// C. Evidence trail — the record the gate produces survives
// ════════════════════════════════════════════════════════════════════════════

function validAtrInput(
  overrides: Partial<AtrDeterminationInput> = {},
): AtrDeterminationInput {
  return {
    noteId: 5,
    organizationId: 1,
    currentOrReasonablyExpectedIncomeCents: 7_200_000,
    currentEmploymentStatus: "W-2 full-time, 4 years",
    monthlyMortgagePaymentCents: 110_000,
    monthlyPaymentSimultaneousLoansCents: 0,
    monthlyPaymentMortgageRelatedObligationsCents: 25_000,
    currentDebtObligationsAlimonyChildSupportCents: 40_000,
    monthlyDtiOrResidualIncomeCents: 2_900,
    creditHistorySummary: "FICO 712; no bankruptcies; tradelines current",
    verificationDocuments: [
      { factor: "factor_i_income", documentType: "w2", receivedDate: "2026-07-01" },
      {
        factor: "factor_viii_credit_history",
        documentType: "credit_report",
        receivedDate: "2026-07-01",
      },
    ],
    qmClassification: "non_qm",
    attestedBy: "Casey Operator",
    attestedByUserId: 12,
    attestationText: ATR_ATTESTATION_TEXT,
    ...overrides,
  };
}

describe("validateAtrDetermination — the eight statutory factors (pure)", () => {
  it("accepts a complete eight-factor determination with verification documents", () => {
    expect(() => validateAtrDetermination(validAtrInput())).not.toThrow();
  });

  it("names the missing factor when income (factor i) is absent", () => {
    try {
      validateAtrDetermination(
        validAtrInput({ currentOrReasonablyExpectedIncomeCents: 0 }),
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AtrIncompleteError);
      const err = e as AtrIncompleteError;
      expect(err.code).toBe("MISSING_FACTOR");
      expect(err.missing).toContain("factor_i_income");
    }
  });

  it("requires third-party verification documents (§1026.43(c)(3)) — operator say-so is not enough", () => {
    try {
      validateAtrDetermination(validAtrInput({ verificationDocuments: [] }));
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as AtrIncompleteError;
      expect(err.code).toBe("MISSING_VERIFICATION");
      expect(err.missing).toContain("income_verification");
      expect(err.missing).toContain("credit_history_verification");
    }
  });

  it("rejects a tampered attestation text — the canonical §1026.43(c) language is required verbatim", () => {
    try {
      validateAtrDetermination(
        validAtrInput({ attestationText: "I promise the borrower can pay." }),
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as AtrIncompleteError;
      expect(err.missing).toContain("attestation_text");
    }
  });

  it("the canonical attestation text cites all three controlling provisions", () => {
    expect(ATR_ATTESTATION_TEXT).toContain("12 CFR 1026.43(c)(2)");
    expect(ATR_ATTESTATION_TEXT).toContain("12 CFR 1026.43(c)(3)");
    expect(ATR_ATTESTATION_TEXT).toContain("12 CFR 1026.25(c)(3)"); // 3-year retention
  });
});

describe("persistAtrDetermination — writes the defensive record", () => {
  it("persists all eight factors, the verification documents, the attestation, and the completion flag", async () => {
    s.updateRows.push([{ id: 5 }]);
    await persistAtrDetermination(validAtrInput());
    expect(s.updateSets).toHaveLength(1);
    const set = s.updateSets[0] as Record<string, unknown>;
    expect(set.atrDeterminationCompleted).toBe(true);
    expect(set.atrDeterminationCompletedAt).toBeInstanceOf(Date);
    const record = set.atrDetermination as Record<string, unknown>;
    for (const factor of [
      "currentOrReasonablyExpectedIncomeCents",
      "currentEmploymentStatus",
      "monthlyMortgagePaymentCents",
      "monthlyPaymentSimultaneousLoansCents",
      "monthlyPaymentMortgageRelatedObligationsCents",
      "currentDebtObligationsAlimonyChildSupportCents",
      "monthlyDtiOrResidualIncomeCents",
      "creditHistorySummary",
    ]) {
      expect(record, `record must retain ${factor}`).toHaveProperty(factor);
    }
    expect(record.verificationDocuments).toHaveLength(2);
    expect(record.attestationText).toBe(ATR_ATTESTATION_TEXT);
    expect(record.attestedBy).toBe("Casey Operator");
    expect(record.attestedByUserId).toBe(12);
    expect(typeof record.attestedAt).toBe("string");
  });

  it("validates BEFORE writing — an incomplete determination never reaches the DB", async () => {
    await expect(
      persistAtrDetermination(validAtrInput({ creditHistorySummary: "" })),
    ).rejects.toBeInstanceOf(AtrIncompleteError);
    expect(s.updateSets).toHaveLength(0);
  });

  it("throws (rather than silently succeeding) when the note row does not exist", async () => {
    s.updateRows.push([]);
    await expect(persistAtrDetermination(validAtrInput())).rejects.toThrow(
      /not found/,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// D. Caller-path completeness — every way a note is created or activated
// ════════════════════════════════════════════════════════════════════════════
//
// House rule: source assertions run against COMMENT-STRIPPED text, so a
// comment documenting a removed line can never satisfy a check.

const ROOT = path.resolve(__dirname, "../..");

function stripComments(src: string): string {
  return (
    src
      // Line comments FIRST: routes-finance.ts:158 has "/*" INSIDE a "//"
      // comment; stripping blocks first ate 700 lines of real code. The
      // guard keeps "://" (URLs in strings) and quoted "//" intact.
      .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1")
      .replace(/\/\*[\s\S]*?\*\//g, "")
  );
}

function strippedSource(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".claude") continue;
      walkTs(p, out);
    } else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

describe("caller-path completeness — no ungated door into the notes table", () => {
  it("RATCHET: the only direct db.insert(notes) sites are noteRepo (gated) and the subdivision bridge (pending-only)", () => {
    // The twice-repeated program defect is a guard on one path with an
    // early-return around it on another. Any NEW direct insert into `notes`
    // must either go through storage.createNote (gated) or be added here
    // WITH its own pinned gate posture.
    const offenders: string[] = [];
    for (const file of walkTs(path.join(ROOT, "server"))) {
      const src = stripComments(fs.readFileSync(file, "utf8"));
      if (/\.insert\(\s*(notes|notesTable|sellerFinanceNotes)\s*\)/.test(src)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders.sort()).toEqual([
      "server/routes-subdivisions.ts",
      "server/storage/noteRepo.ts",
    ]);
  });

  it("subdivision lot→note bridge (direct insert, bypasses the repo gate) lands status 'pending' only", () => {
    const src = strippedSource("server/routes-subdivisions.ts");
    const at = src.indexOf("db.insert(notes).values({");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf(".returning(", at));
    expect(block).toContain('status: "pending"');
    expect(block).not.toContain('status: "active"');
  });

  it("POST /api/notes downgrades to 'pending' unless active was requested WITH ATR/exemption", () => {
    const src = strippedSource("server/routes-finance.ts");
    expect(src).toMatch(
      /const resolvedStatus = callerSuppliedActiveWithAtr \? "active" : "pending"/,
    );
    const def = src.slice(
      src.indexOf("const callerSuppliedActiveWithAtr"),
      src.indexOf("const resolvedStatus"),
    );
    expect(def).toContain('req.body.status === "active"');
    expect(def).toContain("req.body.atrDeterminationCompleted === true");
    for (const code of ["raw_land", "business_purpose", "commercial_borrower"]) {
      expect(def).toContain(code);
    }
    // And the route funnels through the gated repo seam, not a raw insert.
    expect(src).toContain("storage.createNote(");
  });

  it("PUT /api/notes/:id cannot forge ATR fields — the strict update schema excludes them", () => {
    const src = strippedSource("server/routes-finance.ts");
    const start = src.indexOf("const updateNoteSchema");
    const end = src.indexOf(".strict()", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const schema = src.slice(start, end);
    expect(schema).not.toMatch(/atr/i);
    // status IS updatable — which is exactly why updateNote's gate exists.
    expect(schema).toContain('"active"');
  });

  it("deal→note carry (POST /api/notes/from-deal) maps to status 'pending' — through the originate chokepoint", () => {
    // Behavioral pin lives in carryNoteFromDeal.test.ts ("Origination always
    // lands pending"); this pins the mapper source so both survive together.
    const src = strippedSource("server/routes-notes.ts");
    const at = src.indexOf("function mapDealToNoteFields");
    expect(at).toBeGreaterThan(-1);
    const fn = src.slice(at, at + 4000);
    expect(fn).toContain('status: "pending"');
    expect(src).toContain("storage.createNote(");
  });

  it("CSV note import declares the 'legacy' exemption — pre-AcreOS originations, flagged for retro review", () => {
    const src = strippedSource("server/services/importExport.ts");
    const at = src.indexOf("await storage.createNote({");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 1500)).toContain('atrExemptionCode: "legacy"');
  });

  it("demo seed (routes-admin) declares the business_purpose exemption on its synthetic active notes", () => {
    const src = strippedSource("server/routes-admin.ts");
    const at = src.indexOf("storage.createNote(");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 400)).toContain(
      'atrExemptionCode: "business_purpose"',
    );
  });

  it("sample-onboarding seeder fixture TYPE mandates the business_purpose exemption (compiler-enforced)", () => {
    const src = strippedSource("server/services/onboarding/sampleSeeder.ts");
    const at = src.indexOf("interface SampleNoteFixture");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 2000)).toContain(
      'atrExemptionCode: "business_purpose"',
    );
  });
});

describe("DB CHECK constraint — the last line of defense (migration 0099)", () => {
  // KNOWN RESIDUAL RISK, pinned deliberately: three payment-side writes flip
  // note status to 'active' via direct db/tx.update, BYPASSING the app-layer
  // updateNote gate — noteRepo.createPayment, routes-borrower's Stripe
  // checkout transaction, and achAutopay's settle path. For those paths the
  // CHECK constraint below is the ONLY thing standing between a 'pending'
  // note and an ATR-less activation. It must never be silently dropped.
  const MIGRATION = "migrations/0099_notes_atr_origination_gate.sql";

  it("defines notes_atr_origination_gate exactly as the statute requires", () => {
    const sql = stripComments(
      fs.readFileSync(path.join(ROOT, MIGRATION), "utf8").replace(/^--.*$/gm, ""),
    );
    const at = sql.indexOf('ADD CONSTRAINT "notes_atr_origination_gate"');
    expect(at).toBeGreaterThan(-1);
    const check = sql.slice(at, at + 400);
    expect(check).toContain("status <> 'active'");
    expect(check).toContain("atr_determination_completed = true");
    expect(check).toContain("atr_exemption_code IS NOT NULL");
  });

  it("the constraint is in scripts/migrate.mjs — the migrator production ACTUALLY runs", () => {
    // Found by the wave's independent audit on 2026-08-01: this file's first
    // version pinned the constraint in migrations/0099 and scanned later
    // migrations for drops — but production runs scripts/migrate.mjs as the
    // Fly release_command, and migrate.mjs mirrored only 0099's COLUMN, never
    // its CHECK constraints. So the "last line of defense" this describe()
    // block relies on did not exist in the deployed database at all. The
    // three payment-side direct updates named above had NO defense.
    //
    // The mirror uses a DO block that adds the constraint only when missing,
    // never DROP/ADD — migrate.mjs re-runs every statement on every deploy,
    // and a drop/re-add pair would leave the gate absent for a window on
    // every single deploy.
    const mjs = stripComments(fs.readFileSync(path.join(ROOT, "scripts/migrate.mjs"), "utf8"));
    const at = mjs.indexOf('ADD CONSTRAINT "notes_atr_origination_gate"');
    expect(at, "migrate.mjs must carry the ATR gate constraint").toBeGreaterThan(-1);
    const check = mjs.slice(at, at + 400);
    expect(check).toContain("status <> 'active'");
    expect(check).toContain("atr_determination_completed = true");
    expect(check).toContain("atr_exemption_code IS NOT NULL");
    // Guard-only form: within the statement that adds the gate, there must be
    // no DROP of it. (The pg_constraint existence check is the idempotency.)
    const stmtStart = mjs.lastIndexOf("DO $atr_gate$", at);
    expect(stmtStart, "the gate must be added inside the guarded DO block").toBeGreaterThan(-1);
    const stmt = mjs.slice(stmtStart, mjs.indexOf("$atr_gate$", at));
    expect(stmt).not.toMatch(/DROP\s+CONSTRAINT/i);
    expect(stmt).toContain("pg_constraint");
    // The grandfather UPDATE must precede the gate's ADD in the statement
    // array, or the first real deploy fails on pre-gate active rows.
    const grandfather = mjs.indexOf("SET    atr_exemption_code = 'legacy'");
    expect(grandfather, "grandfather UPDATE must exist").toBeGreaterThan(-1);
    expect(grandfather).toBeLessThan(at);
  });

  it("no later migration drops the constraint without re-adding it", () => {
    const migrations = fs
      .readdirSync(path.join(ROOT, "migrations"))
      .filter((f) => f.endsWith(".sql") && f > "0099")
      .sort();
    expect(migrations.length).toBeGreaterThan(0);
    for (const file of migrations) {
      const sql = fs
        .readFileSync(path.join(ROOT, "migrations", file), "utf8")
        .replace(/^--.*$/gm, "");
      if (sql.includes("notes_atr_origination_gate") && /DROP\s+CONSTRAINT/i.test(sql)) {
        expect(
          sql.includes('ADD CONSTRAINT "notes_atr_origination_gate"'),
          `${file} drops notes_atr_origination_gate without re-adding it`,
        ).toBe(true);
      }
    }
  });
});
