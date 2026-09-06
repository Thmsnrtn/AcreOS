/**
 * Statute register `esign.consumer-consent` (E-SIGN Act §101(c), 15 U.S.C.
 * §7001(c)) — first real tests for the signing-consent gate, which the
 * register recorded as a well-designed refusal with ZERO tests.
 *
 * Caller paths into the sensitive write (a signature row via
 * `storage.createSignature`, then a STATUS-ONLY patch on the document —
 * progress moved off `generated_documents.signers` on 2026-08-20 because
 * rewriting the roster tripped the immutability trigger for every signer after
 * the first; see services/esign/signingProgress.ts):
 *
 *   1. POST /api/public/sign/:docId (server/routes-public-sign.ts) — GUARDED.
 *      Refuses 412 ESIGN_CONSENT_REQUIRED unless a signing_consent_audit row
 *      exists for this signer + document at the CURRENT disclosure version.
 *   2. POST /api/signatures (server/routes-doc-system.ts) — UNGUARDED SIBLING.
 *      Writes a signature with no consent-audit check at all. Pinned below as
 *      a known statute-register finding, not blessed as correct. NARROWED
 *      2026-08-20: it now records only the SIGNED-IN USER's own signature and
 *      refuses any other signer email, so the unguarded path can no longer be
 *      used to mint a counterparty's signature — which was its sharpest edge.
 *      The missing consent check on an operator self-signature remains open and
 *      is still pinned below.
 *   3. executeSignedLease (server/services/rental/leaseSigningPacket.ts) —
 *      downstream consumer: a lease may only flip to 'active' when every
 *      signer has BOTH signed and a consent row at the current version.
 *
 * What this suite pins:
 *   - the refusal fires when consent is absent, is honestly named
 *     (ESIGN_CONSENT_REQUIRED / §101(c) in the message), and NOTHING is
 *     written before it;
 *   - a disclosure-version bump invalidates stale consent (the register's
 *     explicitly-unpinned behaviour);
 *   - consent is scoped per document and per signer email;
 *   - the consent-audit row is written BEFORE the signature, and the
 *     signature handler re-checks the trail before the write (order pinned
 *     at runtime via the CALLS ledger, and in source);
 *   - the consent capture itself refuses unless all five §101(c) disclosure
 *     flags are true and the posted disclosure version matches the server's;
 *   - lease execution stands on the audit trail, refusing with a named
 *     blocker when any signer's consent row is missing or stale.
 *
 * idempotent: true — db, storage and signing tokens are fully mocked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

const ORG_ID = 42;
const DOC_ID = 7;

const H = vi.hoisted(() => {
  /** Execution ledger — every db/storage touch in order, for ordering pins. */
  const CALLS: string[] = [];

  const state = {
    tables: {} as Record<string, any[]>,
  };

  const tableName = (t: any) => t?.[Symbol.for("drizzle:Name")] ?? "";

  /**
   * Recover (db_column, value) pairs from a drizzle eq()/and() predicate so
   * the mock filters the way SQL would. eq(col, v) compiles to SQL whose
   * queryChunks are [Column, StringChunk, Param]; and(...) nests SQL objects.
   */
  const extractEqPairs = (
    node: any,
    pairs: Array<{ column: string; value: unknown }> = [],
  ): Array<{ column: string; value: unknown }> => {
    if (!node || typeof node !== "object") return pairs;
    const chunks: any[] = Array.isArray(node.queryChunks) ? node.queryChunks : [];
    let pendingColumn: string | null = null;
    for (const chunk of chunks) {
      if (!chunk || typeof chunk !== "object") continue;
      if (Array.isArray(chunk.queryChunks)) {
        extractEqPairs(chunk, pairs);
        continue;
      }
      if (typeof chunk.name === "string" && chunk.table !== undefined) {
        pendingColumn = chunk.name;
        continue;
      }
      if ("encoder" in chunk && "value" in chunk) {
        if (pendingColumn !== null) {
          pairs.push({ column: pendingColumn, value: chunk.value });
          pendingColumn = null;
        }
      }
    }
    return pairs;
  };

  const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

  const rowsMatching = (rows: any[], whereArg: any): any[] => {
    if (!whereArg) return rows;
    const pairs = extractEqPairs(whereArg);
    return rows.filter((r) => pairs.every((p) => r[snakeToCamel(p.column)] === p.value));
  };

  const rowDefaults = (name: string): Record<string, unknown> => {
    if (name === "signing_consent_audit") return { consentedAt: new Date() };
    return {};
  };

  const dbMock: any = {
    select: (_proj?: unknown) => ({
      from: (table: any) => {
        const name = tableName(table);
        const ctx = { where: undefined as any };
        const make = (): any => ({
          where: (w: any) => {
            ctx.where = w;
            return make();
          },
          orderBy: () => make(),
          limit: () => make(),
          groupBy: () => make(),
          then: (onF: any, onR: any) => {
            CALLS.push(`select:${name}`);
            const rows = rowsMatching(state.tables[name] ?? [], ctx.where).map((r) => ({ ...r }));
            const sortKey = ["consentedAt", "attestedAt"].find(
              (k) => rows[0]?.[k] instanceof Date,
            );
            if (sortKey) rows.sort((a, b) => b[sortKey].getTime() - a[sortKey].getTime());
            return Promise.resolve(rows).then(onF, onR);
          },
        });
        return make();
      },
    }),
    insert: (table: any) => ({
      values: (v: any) => {
        const name = tableName(table);
        const arr = (state.tables[name] ??= []);
        const row = { id: arr.length + 1, ...rowDefaults(name), ...v };
        arr.push(row);
        CALLS.push(`insert:${name}`);
        const p: any = Promise.resolve([{ ...row }]);
        p.returning = () => Promise.resolve([{ ...row }]);
        return p;
      },
    }),
    update: (table: any) => ({
      set: (patch: any) => ({
        where: (w: any) => {
          const name = tableName(table);
          CALLS.push(`update:${name}`);
          const matched = rowsMatching(state.tables[name] ?? [], w);
          for (const row of matched) Object.assign(row, patch);
          const p: any = Promise.resolve(matched.map((r) => ({ ...r })));
          p.returning = () => Promise.resolve(matched.map((r) => ({ ...r })));
          return p;
        },
      }),
    }),
  };

  const storageMock = {
    createSignature: vi.fn(async (sig: any) => {
      CALLS.push("storage.createSignature");
      // Land the row so `getSignatures` below can see it. Progress is derived
      // from these rows now, not from the roster (see the note on getSignatures).
      (state.tables["signatures"] ??= []).push({ id: 1, ...sig });
      return { id: 1, ...sig };
    }),
    /**
     * Added 2026-08-20. Signing progress moved OFF the document roster and onto
     * the signatures table, because writing progress back to
     * `generated_documents.signers` tripped
     * `acreos_block_signed_doc_mutation_trigger` for every signer after the
     * first — so no multi-signer document could ever complete.
     *
     * This mock previously had no `getSignatures`, so the moment the route
     * started deriving progress every case here 500'd. That is the mock pinning
     * the OLD shape, not a defect in the route; it is updated to the new truth
     * rather than deleted, so every consent assertion below still means what it
     * meant.
     */
    getSignatures: vi.fn(async (_orgId: number, documentId?: number) => {
      CALLS.push("storage.getSignatures");
      const rows = state.tables["signatures"] ?? [];
      return documentId === undefined ? rows : rows.filter((r: any) => r.documentId === documentId);
    }),
    updateGeneratedDocument: vi.fn(async (id: number, updates: any) => {
      CALLS.push("storage.updateGeneratedDocument");
      const doc = (state.tables["generated_documents"] ?? []).find((d) => d.id === id);
      if (doc) Object.assign(doc, updates);
      return doc ? { ...doc } : undefined;
    }),
    createGeneratedDocument: vi.fn(async (doc: any) => {
      CALLS.push("storage.createGeneratedDocument");
      const arr = (state.tables["generated_documents"] ??= []);
      const row = { id: arr.length + 100, ...doc };
      arr.push(row);
      return { ...row };
    }),
  };

  return { CALLS, state, dbMock, storageMock };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/db", () => ({ db: H.dbMock }));
vi.mock("../../server/storage", () => ({ storage: H.storageMock, db: H.dbMock }));
vi.mock("../../server/services/signingTokens", () => ({
  // "valid" is the only accepted token — invalid-token refusal stays testable.
  verifySigningToken: (_docId: number, _signerId: string, token: string) => token === "valid",
  makeSigningToken: (docId: number, signerId: string) => `tok-${docId}-${signerId}`,
}));
vi.mock("../../server/middleware/idempotency", () => ({
  idempotencyMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import { registerPublicSignRoutes } from "../../server/routes-public-sign";
import { ESIGN_DISCLOSURE_VERSION } from "@shared/schema";
import { stripComments } from "../helpers/stripComments";
import {
  executeSignedLease,
  getLeaseSignatureStatus,
  LeasePacketBlockedError,
} from "../../server/services/rental/leaseSigningPacket";

const app = express();
app.use(express.json());
registerPublicSignRoutes(app);

const SIGNER = { id: "s-1", name: "Ada Borrower", email: "ada@example.com", role: "buyer", order: 1 };
const COSIGNER = { id: "s-2", name: "Lin Cosigner", email: "lin@example.com", role: "seller", order: 2 };

function seedDoc(overrides: Record<string, unknown> = {}) {
  const doc = {
    id: DOC_ID,
    organizationId: ORG_ID,
    name: "Purchase Agreement",
    type: "purchase_agreement",
    content: "The parties agree…",
    status: "pending_signature",
    expiresAt: null,
    signers: [{ ...SIGNER }],
    ...overrides,
  };
  (H.state.tables["generated_documents"] ??= []).push(doc);
  return doc;
}

function seedConsent(overrides: Record<string, unknown> = {}) {
  const row = {
    id: (H.state.tables["signing_consent_audit"]?.length ?? 0) + 1,
    userId: null,
    organizationId: ORG_ID,
    signerEmail: SIGNER.email,
    documentId: DOC_ID,
    disclosureVersion: ESIGN_DISCLOSURE_VERSION,
    consentedHardwareRequirements: true,
    consentedPaperCopyRight: true,
    consentedWithdrawalRight: true,
    consentedContactUpdate: true,
    consentedScope: true,
    consentedAt: new Date(),
    ...overrides,
  };
  (H.state.tables["signing_consent_audit"] ??= []).push(row);
  return row;
}

const ALL_FIVE = {
  consentedHardwareRequirements: true,
  consentedPaperCopyRight: true,
  consentedWithdrawalRight: true,
  consentedContactUpdate: true,
  consentedScope: true,
};

const signBody = (extra: Record<string, unknown> = {}) => ({
  s: SIGNER.id,
  t: "valid",
  signatureData: "data:image/png;base64,SIG",
  signatureType: "drawn",
  consentGiven: true,
  ...extra,
});

beforeEach(() => {
  H.CALLS.length = 0;
  H.state.tables = {};
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
describe("POST /api/public/sign/:docId — the §101(c) server-side gate", () => {
  it("refuses 412 ESIGN_CONSENT_REQUIRED when no consent row exists — and writes NOTHING first", async () => {
    seedDoc();

    const res = await request(app).post(`/api/public/sign/${DOC_ID}`).send(signBody());

    expect(res.status).toBe(412);
    expect(res.body.error).toBe("ESIGN_CONSENT_REQUIRED"); // named refusal, not a generic 4xx
    expect(res.body.message).toContain("§101(c)");
    // The refusal happened BEFORE the sensitive write — nothing landed.
    expect(H.storageMock.createSignature).not.toHaveBeenCalled();
    expect(H.storageMock.updateGeneratedDocument).not.toHaveBeenCalled();
    expect(H.CALLS).toContain("select:signing_consent_audit"); // the gate really ran
  });

  it("a consent row at a STALE disclosure version does not satisfy the gate (version bump invalidates)", async () => {
    seedDoc();
    seedConsent({ disclosureVersion: "2020-01-01" }); // all five flags true, wrong version

    const res = await request(app).post(`/api/public/sign/${DOC_ID}`).send(signBody());

    expect(res.status).toBe(412);
    expect(res.body.error).toBe("ESIGN_CONSENT_REQUIRED");
    expect(H.storageMock.createSignature).not.toHaveBeenCalled();
  });

  it("consent captured for a DIFFERENT document does not unlock this one", async () => {
    seedDoc();
    seedConsent({ documentId: 999 });

    const res = await request(app).post(`/api/public/sign/${DOC_ID}`).send(signBody());

    expect(res.status).toBe(412);
    expect(H.storageMock.createSignature).not.toHaveBeenCalled();
  });

  it("consent captured for a DIFFERENT signer email does not unlock this signer", async () => {
    seedDoc();
    seedConsent({ signerEmail: "someone-else@example.com" });

    const res = await request(app).post(`/api/public/sign/${DOC_ID}`).send(signBody());

    expect(res.status).toBe(412);
    expect(H.storageMock.createSignature).not.toHaveBeenCalled();
  });

  it("with current-version consent on record, the signature lands — and the gate check precedes the write", async () => {
    seedDoc();
    seedConsent();

    const res = await request(app).post(`/api/public/sign/${DOC_ID}`).send(signBody());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(H.storageMock.createSignature).toHaveBeenCalledTimes(1);
    const sig = H.storageMock.createSignature.mock.calls[0][0];
    expect(sig.organizationId).toBe(ORG_ID);
    expect(sig.documentId).toBe(DOC_ID);
    expect(sig.signerEmail).toBe(SIGNER.email);
    // Ordering pin: the consent-audit lookup executed BEFORE the signature write.
    const gateIdx = H.CALLS.indexOf("select:signing_consent_audit");
    const writeIdx = H.CALLS.indexOf("storage.createSignature");
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    expect(writeIdx).toBeGreaterThan(gateIdx);
    // The signer flip only happens after the signature row exists.
    expect(H.CALLS.indexOf("storage.updateGeneratedDocument")).toBeGreaterThan(writeIdx);
  });

  it("an invalid signing token is refused before any read of the consent trail", async () => {
    seedDoc();
    seedConsent();

    const res = await request(app)
      .post(`/api/public/sign/${DOC_ID}`)
      .send(signBody({ t: "forged" }));

    expect(res.status).toBe(403);
    expect(H.storageMock.createSignature).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("POST /api/public/sign/consent — the consent capture itself", () => {
  const consentBody = (extra: Record<string, unknown> = {}) => ({
    docId: DOC_ID,
    s: SIGNER.id,
    t: "valid",
    ...ALL_FIVE,
    disclosureVersion: ESIGN_DISCLOSURE_VERSION,
    ...extra,
  });

  it("refuses unless ALL FIVE §101(c) disclosure flags are true — nothing recorded", async () => {
    seedDoc();

    for (const flag of Object.keys(ALL_FIVE)) {
      const res = await request(app)
        .post("/api/public/sign/consent")
        .send(consentBody({ [flag]: false }));

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("§101(c)");
    }
    expect(H.state.tables["signing_consent_audit"] ?? []).toHaveLength(0);
    expect(H.CALLS).not.toContain("insert:signing_consent_audit");
  });

  it("refuses a stale posted disclosure version with a named mismatch — nothing recorded", async () => {
    seedDoc();

    const res = await request(app)
      .post("/api/public/sign/consent")
      .send(consentBody({ disclosureVersion: "2020-01-01" }));

    expect(res.status).toBe(400);
    expect(res.body.message).toContain("Disclosure version mismatch");
    expect(res.body.message).toContain(ESIGN_DISCLOSURE_VERSION);
    expect(H.CALLS).not.toContain("insert:signing_consent_audit");
  });

  it("records the audit row with all five flags, the current version, and the doc's org", async () => {
    seedDoc();

    const res = await request(app).post("/api/public/sign/consent").send(consentBody());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.disclosureVersion).toBe(ESIGN_DISCLOSURE_VERSION);
    const rows = H.state.tables["signing_consent_audit"];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: ORG_ID,
      documentId: DOC_ID,
      signerEmail: SIGNER.email,
      disclosureVersion: ESIGN_DISCLOSURE_VERSION,
      ...ALL_FIVE,
    });
  });

  it("full flow: sign refused → consent recorded → sign lands; audit row precedes the signature write", async () => {
    seedDoc();

    const first = await request(app).post(`/api/public/sign/${DOC_ID}`).send(signBody());
    expect(first.status).toBe(412);

    const consent = await request(app).post("/api/public/sign/consent").send(consentBody());
    expect(consent.status).toBe(200);

    const second = await request(app).post(`/api/public/sign/${DOC_ID}`).send(signBody());
    expect(second.status).toBe(200);

    // Ordering pin across the whole flow: consent audit written BEFORE the
    // signature — the §101(c) sequence a regulator would reconstruct.
    const consentIdx = H.CALLS.indexOf("insert:signing_consent_audit");
    const signIdx = H.CALLS.indexOf("storage.createSignature");
    expect(consentIdx).toBeGreaterThanOrEqual(0);
    expect(signIdx).toBeGreaterThan(consentIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("GET /api/public/sign/consent/status — boolean-only gate probe", () => {
  const q = { docId: String(DOC_ID), s: SIGNER.id, t: "valid" };

  it("required:true when no consent row exists", async () => {
    seedDoc();
    const res = await request(app).get("/api/public/sign/consent/status").query(q);
    expect(res.status).toBe(200);
    expect(res.body.required).toBe(true);
    expect(res.body.disclosureVersion).toBe(ESIGN_DISCLOSURE_VERSION);
  });

  it("required:true when consent exists only at a stale version; false at the current one", async () => {
    seedDoc();
    seedConsent({ disclosureVersion: "2020-01-01" });
    const stale = await request(app).get("/api/public/sign/consent/status").query(q);
    expect(stale.body.required).toBe(true);

    seedConsent();
    const fresh = await request(app).get("/api/public/sign/consent/status").query(q);
    expect(fresh.body.required).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("lease execution stands on the consent audit trail (leaseSigningPacket)", () => {
  const signedAt = new Date().toISOString();

  function seedLeaseDoc() {
    return seedDoc({
      signers: [
        { ...SIGNER, role: "tenant", signedAt },
        { ...COSIGNER, role: "landlord", signedAt },
      ],
    });
  }
  const lease = {
    id: "lease-1",
    status: "pending_signature",
    signingDocumentId: DOC_ID,
    executedAt: null,
  } as any;

  it("all signed but one consent row missing → NOT ready, blocker names §101(c) + version; execute refuses and writes nothing", async () => {
    seedLeaseDoc();
    seedConsent(); // tenant only — the landlord's consent row is missing

    const status = await getLeaseSignatureStatus({ organizationId: ORG_ID, lease });
    expect(status.allSigned).toBe(true);
    expect(status.allConsented).toBe(false);
    expect(status.readyToExecute).toBe(false);
    const blocker = status.blockers.find((b) => b.includes("§101(c)"));
    expect(blocker).toBeDefined();
    expect(blocker).toContain(ESIGN_DISCLOSURE_VERSION);
    expect(blocker).toContain(COSIGNER.name); // says WHO is missing consent

    await expect(
      executeSignedLease({ organizationId: ORG_ID, lease, userId: "user-1" }),
    ).rejects.toThrow(LeasePacketBlockedError);
    expect(H.CALLS).not.toContain("update:rental_leases"); // the lease never moved
  });

  it("a consent row at a stale disclosure version does not count toward execution", async () => {
    seedLeaseDoc();
    seedConsent();
    seedConsent({ signerEmail: COSIGNER.email, disclosureVersion: "2020-01-01" });

    const status = await getLeaseSignatureStatus({ organizationId: ORG_ID, lease });
    expect(status.allConsented).toBe(false);
    expect(status.readyToExecute).toBe(false);
  });

  it("all signed + all consented at the current version → executes to 'active'", async () => {
    seedLeaseDoc();
    seedConsent();
    seedConsent({ signerEmail: COSIGNER.email });
    (H.state.tables["rental_leases"] ??= []).push({
      id: lease.id,
      organizationId: ORG_ID,
      status: "pending_signature",
    });

    const result = await executeSignedLease({ organizationId: ORG_ID, lease, userId: "user-1" });
    expect(result.executed).toBe(true);
    expect(result.alreadyExecuted).toBe(false);
    expect(H.CALLS).toContain("update:rental_leases");
    expect(H.state.tables["rental_leases"][0].status).toBe("active");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Source-level pins — enumerate every caller of the sensitive write so a new
// unguarded sibling cannot appear silently (this repo's repeated defect).
// Comments are stripped before matching (three assertions in this program
// once matched the comment documenting a removed line).
// ═══════════════════════════════════════════════════════════════════════════

const ROOT = path.resolve(__dirname, "../..");

function serverFilesMatching(re: RegExp): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        if (re.test(stripComments(fs.readFileSync(full, "utf8")))) {
          hits.push(path.relative(ROOT, full));
        }
      }
    }
  };
  walk(path.join(ROOT, "server"));
  return hits.sort();
}

describe("caller-path enumeration for the signature write", () => {
  it("storage.createSignature has exactly the two known route call sites", () => {
    const callers = serverFilesMatching(/\.createSignature\(/);
    expect(
      callers,
      "NEW storage.createSignature caller detected. Every signature write must pass the " +
        "E-SIGN §101(c) consent gate (signing_consent_audit at the current ESIGN_DISCLOSURE_VERSION) " +
        "BEFORE the write — add the gate to the new caller, cover it in this suite, then extend this list.",
    ).toEqual(["server/routes-doc-system.ts", "server/routes-public-sign.ts"]);
  });

  it("routes-public-sign: the ESIGN_CONSENT_REQUIRED refusal precedes the signature write in source", () => {
    const src = stripComments(
      fs.readFileSync(path.join(ROOT, "server/routes-public-sign.ts"), "utf8"),
    );
    const gateIdx = src.indexOf("ESIGN_CONSENT_REQUIRED");
    const writeIdx = src.indexOf("storage.createSignature");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(writeIdx);
  });

  it("KNOWN GAP (statute register esign.consumer-consent): POST /api/signatures in routes-doc-system is unguarded", () => {
    // This pins the CURRENT state so the gap stays visible, not to bless it:
    // the authenticated /api/signatures endpoint writes a signature row with
    // NO signing_consent_audit check. If this assertion starts failing, the
    // gate has been added — REWRITE this test to assert the gate's presence
    // and its ordering before storage.createSignature (do not delete it).
    const src = stripComments(
      fs.readFileSync(path.join(ROOT, "server/routes-doc-system.ts"), "utf8"),
    );
    expect(src).toContain(".createSignature(");
    expect(src).not.toContain("signingConsentAudit");
    expect(src).not.toContain("ESIGN_CONSENT_REQUIRED");
  });
});
