/**
 * P-9 — contractor tax IDs are encrypted at rest.
 *
 * routes-contractors.ts stored the operator-typed tax ID verbatim in
 * contractors.tax_id_encrypted (two TODOs named the gap), while every
 * comparable TIN in the codebase — the org's own EIN
 * (routes-organization.ts tax-identity) and a note's payer TIN
 * (routes-notes.ts) — is written through the canonical
 * server/services/fieldEncryption module. This suite pins the cure on
 * the REAL route with only the db and auth/org plumbing mocked (the
 * nec1099QualifiedOutputGate harness shape):
 *
 *   - POST create and PATCH update hand the db an `enc:v1:` envelope,
 *     never the typed value; the envelope decrypts back to the typed
 *     value with the canonical helper.
 *   - An already-enveloped value is not double-encrypted (the org
 *     tax-identity isEncrypted guard).
 *   - Reads mask from the DECRYPTED value: a ciphertext row yields the
 *     true last-4 mask; a legacy plaintext row (stored before the cure)
 *     still masks correctly via fieldEncryption's pass-through
 *     convention; an undecryptable envelope masks as missing.
 *   - No response body carries the raw TIN or the stored field.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => {
  process.env.FIELD_ENCRYPTION_KEY = "a".repeat(64);
  return {
    user: { id: "u1", email: "owner@flipper.test" } as { id: string; email: string },
    insertValues: [] as Array<Record<string, unknown>>,
    updateSets: [] as Array<Record<string, unknown>>,
    selectQueue: [] as Array<Array<Record<string, unknown>>>,
  };
});

/** Chainable drizzle stand-in: every builder step returns the chain,
 *  and awaiting the chain resolves to the queued result. */
function chain(result: unknown) {
  const c: Record<string, unknown> = {
    from: () => c,
    where: () => c,
    orderBy: () => c,
    limit: () => c,
    groupBy: () => c,
    then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onF, onR),
  };
  return c;
}

vi.mock("../../server/db", () => ({
  db: {
    select: () => chain(h.selectQueue.shift() ?? []),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        h.insertValues.push(v);
        return { returning: async () => [{ id: "c1", organizationId: 7, ...v }] };
      },
    }),
    update: () => ({
      set: (u: Record<string, unknown>) => {
        h.updateSets.push(u);
        return {
          where: () => ({
            returning: async () => [{ id: "c1", organizationId: 7, ...u }],
          }),
        };
      },
    }),
    execute: vi.fn(async () => ({ rows: [] })),
  },
}));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization: unknown; user: unknown }, _s: unknown, n: () => void) => {
    req.organization = { id: 7 };
    req.user = h.user;
    n();
  },
}));
vi.mock("../../server/middleware/roleGuard", () => ({ requireRole: () => (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/services/form1099NecPdf", () => ({ generate1099NecPdf: vi.fn(() => Buffer.from("%PDF")) }));
vi.mock("../../server/services/featureFlags", () => ({
  featureFlagService: { isEnabled: vi.fn(async () => true) },
  buildFlagContext: (req: any) => ({ userId: req.user?.id, isFounder: false, email: req.user?.email }),
}));
vi.mock("../../server/services/founder", () => ({
  isFounderEmail: (email: string | null | undefined) => email === "founder@acreos.test",
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerContractorRoutes } from "../../server/routes-contractors";
import { encrypt, decrypt, isEncrypted } from "../../server/services/fieldEncryption";

function app() {
  const a = express();
  a.use(express.json());
  registerContractorRoutes(a);
  return a;
}

const RAW_SSN = "123-45-6789";
const RAW_EIN = "12-3456789";

beforeEach(() => {
  h.insertValues = [];
  h.updateSets = [];
  h.selectQueue = [];
});

describe("contractor taxId encryption at rest (P-9)", () => {
  it("POST create stores an enc:v1: envelope that round-trips, never the typed value", async () => {
    const res = await request(app())
      .post("/api/contractors")
      .send({ name: "Marcus Construction", taxIdEncrypted: RAW_SSN, taxIdType: "ssn" });
    expect(res.status).toBe(201);
    expect(h.insertValues).toHaveLength(1);
    const stored = h.insertValues[0]!.taxIdEncrypted;
    expect(typeof stored).toBe("string");
    expect(isEncrypted(stored)).toBe(true);
    expect(stored as string).not.toContain(RAW_SSN);
    expect(decrypt(stored as string)).toBe(RAW_SSN);
    // Response carries neither the raw TIN nor the stored field.
    expect(JSON.stringify(res.body)).not.toContain(RAW_SSN);
    expect(res.body.contractor.taxIdEncrypted).toBeUndefined();
  });

  it("POST create does not double-encrypt an already-enveloped value", async () => {
    const enveloped = encrypt(RAW_EIN);
    const res = await request(app())
      .post("/api/contractors")
      .send({ name: "Enveloped LLC", taxIdEncrypted: enveloped, taxIdType: "ein" });
    expect(res.status).toBe(201);
    expect(h.insertValues[0]!.taxIdEncrypted).toBe(enveloped);
  });

  it("PATCH update stores an enc:v1: envelope that round-trips", async () => {
    const res = await request(app())
      .patch("/api/contractors/c1")
      .send({ taxIdEncrypted: RAW_EIN, taxIdType: "ein" });
    expect(res.status).toBe(200);
    expect(h.updateSets).toHaveLength(1);
    const stored = h.updateSets[0]!.taxIdEncrypted;
    expect(isEncrypted(stored)).toBe(true);
    expect(stored as string).not.toContain(RAW_EIN);
    expect(decrypt(stored as string)).toBe(RAW_EIN);
    expect(JSON.stringify(res.body)).not.toContain(RAW_EIN);
    expect(res.body.contractor.taxIdEncrypted).toBeUndefined();
  });

  it("GET list masks from the decrypted value of a ciphertext row", async () => {
    h.selectQueue = [[
      { id: "c1", name: "Marcus", taxIdEncrypted: encrypt(RAW_SSN), taxIdType: "ssn" },
    ]];
    const res = await request(app()).get("/api/contractors");
    expect(res.status).toBe(200);
    expect(res.body.contractors[0].taxIdMasked).toBe("XXX-XX-6789");
    expect(res.body.contractors[0].taxIdEncrypted).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(RAW_SSN);
  });

  it("GET list still masks a legacy plaintext row (pass-through convention)", async () => {
    h.selectQueue = [[
      { id: "c1", name: "Legacy", taxIdEncrypted: "123456789", taxIdType: "ein" },
    ]];
    const res = await request(app()).get("/api/contractors");
    expect(res.status).toBe(200);
    expect(res.body.contractors[0].taxIdMasked).toBe("XX-XXX6789");
  });

  it("GET detail masks from the decrypted value of a ciphertext row", async () => {
    h.selectQueue = [
      [{ id: "c1", name: "Marcus", taxIdEncrypted: encrypt(RAW_EIN), taxIdType: "ein" }],
      [],
    ];
    const res = await request(app()).get("/api/contractors/c1");
    expect(res.status).toBe(200);
    expect(res.body.contractor.taxIdMasked).toBe("XX-XXX6789");
    expect(res.body.contractor.taxIdEncrypted).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(RAW_EIN);
  });

  it("an undecryptable envelope masks as missing, never as ciphertext digits", async () => {
    h.selectQueue = [[
      { id: "c1", name: "Broken", taxIdEncrypted: "enc:v1:!!!not-an-envelope", taxIdType: "ssn" },
    ]];
    const res = await request(app()).get("/api/contractors");
    expect(res.status).toBe(200);
    expect(res.body.contractors[0].taxIdMasked).toBe("—");
  });
});
