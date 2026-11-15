/**
 * PKG-1 §2 / §5 companion — the DSAR action gate, without a database.
 *
 * `gateDsarAction` (server/services/privacy/dsarActionGate.ts) is the ONLY
 * producer of a DsarSubject. This pins:
 *   - every refusal reason, and the gate ORDER: not-found → not-verified →
 *     type → subject-missing → mismatch / already-erased. Order is proved by
 *     scripting a record that is wrong in SEVERAL ways at once and asserting
 *     the earliest reason wins, AND by the read log: a refusal at step N reads
 *     nothing that a later step would read;
 *   - the gate never writes (insert/update/delete on the mock throw and log);
 *   - posture-as-switch: flip `requireOperatorVerification` /
 *     `requireExactEmailMatch` on a mocked posture module and the matching
 *     refusal disappears — the posture object is the switch, not decoration;
 *   - refusal details never carry the subject's (or requester's) email.
 *
 * The db mock is a scripted select keyed by the SQL table name the query
 * reads (via drizzle's getTableConfig), so it does not care how many times or
 * in which order a table is read — only WHAT is read is logged and asserted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const dbState = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  reads: [] as string[],
  writes: [] as string[],
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/db", async () => {
  const { getTableConfig } = await import("drizzle-orm/pg-core");
  const nameOf = (t: unknown) => getTableConfig(t as Parameters<typeof getTableConfig>[0]).name;
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["where", "limit", "orderBy", "innerJoin", "leftJoin", "groupBy"]) c[m] = () => c;
    c.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => Promise.resolve(rows).then(ok, err);
    return c;
  };
  const write = (op: string) => (t: unknown) => {
    dbState.writes.push(`${op}:${nameOf(t)}`);
    throw new Error(`dsarActionGate test: the gate must not ${op} (${nameOf(t)})`);
  };
  return {
    db: {
      select: () => ({
        from: (t: unknown) => {
          const name = nameOf(t);
          dbState.reads.push(name);
          const rows = dbState.rows[name];
          if (!rows) throw new Error(`dsarActionGate test: unscripted read of ${name}`);
          return chain(rows);
        },
      }),
      insert: write("insert"),
      update: write("update"),
      delete: write("delete"),
    },
  };
});

// A mutable CLONE of the real posture, so a test can flip a switch and the
// gate (which reads the object at call time) sees it.
vi.mock("@shared/privacy/dsarIdentityPosture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/privacy/dsarIdentityPosture")>();
  return { ...actual, DSAR_IDENTITY_POSTURE: { ...actual.DSAR_IDENTITY_POSTURE } };
});

import { gateDsarAction, type GateRefusal } from "../../server/services/privacy/dsarActionGate";
import { DSAR_IDENTITY_POSTURE } from "@shared/privacy/dsarIdentityPosture";

const posture = DSAR_IDENTITY_POSTURE as unknown as { requireOperatorVerification: boolean; requireExactEmailMatch: boolean };
const ORIGINAL = { ...posture };

const DSAR_ID = "11111111-2222-3333-4444-555555555555";
const SUBJECT_EMAIL = "subject+gate@example.test";
const OTHER_EMAIL = "someone-else+gate@example.test";
const USER_ID = "user-uuid-gate-1";
const ORG = 41;
const LEAD = 7;

function record(over: Partial<{ requestType: string; requesterEmail: string; requesterIdentityVerified: boolean }> = {}) {
  return [{
    id: DSAR_ID,
    requestType: "access",
    requesterEmail: SUBJECT_EMAIL,
    requesterIdentityVerified: true,
    fulfilledAt: null,
    isSelfTest: false,
    ...over,
  }];
}

function refusalOf(r: Awaited<ReturnType<typeof gateDsarAction>>): GateRefusal {
  if (r.ok) throw new Error("expected a refusal, the gate passed");
  return r.refusal;
}

/** The refusal never echoes an email — not the subject's, not the requester's. */
function expectNoEmail(refusal: GateRefusal) {
  const text = JSON.stringify(refusal);
  expect(text).not.toContain(SUBJECT_EMAIL);
  expect(text).not.toContain(OTHER_EMAIL);
  expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
}

const userSel = { kind: "user" as const, userId: USER_ID };
const leadSel = { kind: "lead" as const, organizationId: ORG, leadId: LEAD };

beforeEach(() => {
  dbState.rows = {};
  dbState.reads = [];
  dbState.writes = [];
});

afterEach(() => {
  Object.assign(posture, ORIGINAL);
  // Whatever the case, the gate never wrote.
  expect(dbState.writes).toEqual([]);
});

describe("dsarActionGate — refusal reasons and order", () => {
  it("1. missing record → 404 DSAR_NOT_FOUND, and nothing past the record is read", async () => {
    dbState.rows = { dsar_requests_lifecycle: [], users: [] };
    const refusal = refusalOf(await gateDsarAction(DSAR_ID, userSel, "export"));
    expect(refusal.status).toBe(404);
    expect(refusal.reason).toBe("DSAR_NOT_FOUND");
    expect(dbState.reads).toEqual(["dsar_requests_lifecycle"]);
    expectNoEmail(refusal);
  });

  it("2. unverified wins over a wrong type and a missing subject → 422 DSAR_NOT_VERIFIED", async () => {
    dbState.rows = {
      dsar_requests_lifecycle: record({ requesterIdentityVerified: false, requestType: "rectification" }),
      users: [],
    };
    for (const action of ["export", "erasure"] as const) {
      dbState.reads = [];
      const refusal = refusalOf(await gateDsarAction(DSAR_ID, userSel, action));
      expect(refusal.status).toBe(422);
      expect(refusal.reason).toBe("DSAR_NOT_VERIFIED");
      expect(refusal.message).toContain("verify-identity");
      expect(dbState.reads).toEqual(["dsar_requests_lifecycle"]);
      expectNoEmail(refusal);
    }
  });

  it("3. wrong request type wins over a missing subject → 422 DSAR_TYPE_MISMATCH (both directions)", async () => {
    dbState.rows = { dsar_requests_lifecycle: record({ requestType: "erasure" }), users: [] };
    let refusal = refusalOf(await gateDsarAction(DSAR_ID, userSel, "export"));
    expect(refusal.reason).toBe("DSAR_TYPE_MISMATCH");
    expect(refusal.status).toBe(422);
    expect(dbState.reads).toEqual(["dsar_requests_lifecycle"]);
    expectNoEmail(refusal);

    dbState.rows.dsar_requests_lifecycle = record({ requestType: "access" });
    dbState.reads = [];
    refusal = refusalOf(await gateDsarAction(DSAR_ID, userSel, "erasure"));
    expect(refusal.reason).toBe("DSAR_TYPE_MISMATCH");
    expect(dbState.reads).toEqual(["dsar_requests_lifecycle"]);

    // portability is an export type; rectification is neither.
    dbState.rows.dsar_requests_lifecycle = record({ requestType: "rectification" });
    refusal = refusalOf(await gateDsarAction(DSAR_ID, userSel, "export"));
    expect(refusal.reason).toBe("DSAR_TYPE_MISMATCH");
  });

  it("4. subject missing → 404 SUBJECT_NOT_FOUND, for users and for leads (org-scoped)", async () => {
    dbState.rows = { dsar_requests_lifecycle: record(), users: [], leads: [] };
    let refusal = refusalOf(await gateDsarAction(DSAR_ID, userSel, "export"));
    expect(refusal.status).toBe(404);
    expect(refusal.reason).toBe("SUBJECT_NOT_FOUND");
    expectNoEmail(refusal);

    refusal = refusalOf(await gateDsarAction(DSAR_ID, leadSel, "export"));
    expect(refusal.status).toBe(404);
    expect(refusal.reason).toBe("SUBJECT_NOT_FOUND");
    expect(refusal.details).toMatchObject({ organizationId: ORG, leadId: LEAD });
    expectNoEmail(refusal);
  });

  it("5a. email mismatch on a live subject → 422 DSAR_SUBJECT_MISMATCH, details carry ids only", async () => {
    dbState.rows = {
      dsar_requests_lifecycle: record(),
      users: [{ id: USER_ID, email: OTHER_EMAIL }],
      team_members: [{ organizationId: ORG }],
    };
    let refusal = refusalOf(await gateDsarAction(DSAR_ID, userSel, "export"));
    expect(refusal.status).toBe(422);
    expect(refusal.reason).toBe("DSAR_SUBJECT_MISMATCH");
    expect(refusal.details).toMatchObject({ userId: USER_ID });
    expectNoEmail(refusal);

    dbState.rows = {
      dsar_requests_lifecycle: record(),
      leads: [{ id: LEAD, organizationId: ORG, email: OTHER_EMAIL }],
      notes: [],
    };
    refusal = refusalOf(await gateDsarAction(DSAR_ID, leadSel, "export"));
    expect(refusal.reason).toBe("DSAR_SUBJECT_MISMATCH");
    expectNoEmail(refusal);
  });

  it("5b. a subject with no email on file never matches", async () => {
    dbState.rows = {
      dsar_requests_lifecycle: record(),
      leads: [{ id: LEAD, organizationId: ORG, email: null }],
      notes: [],
    };
    const refusal = refusalOf(await gateDsarAction(DSAR_ID, leadSel, "export"));
    expect(refusal.reason).toBe("DSAR_SUBJECT_MISMATCH");
  });

  it("5c. an ERASED subject is refused as SUBJECT_ALREADY_ERASED, not as a mismatch (design §3 ordering)", async () => {
    dbState.rows = {
      dsar_requests_lifecycle: record({ requestType: "erasure" }),
      users: [{ id: USER_ID, email: "deleted-user-abcd1234@gdpr-deleted.invalid" }],
      team_members: [],
    };
    let refusal = refusalOf(await gateDsarAction(DSAR_ID, userSel, "erasure"));
    expect(refusal.status).toBe(422);
    expect(refusal.reason).toBe("SUBJECT_ALREADY_ERASED");
    expectNoEmail(refusal);

    dbState.rows = {
      dsar_requests_lifecycle: record({ requestType: "access" }),
      leads: [{ id: LEAD, organizationId: ORG, email: `deleted-${LEAD}@gdpr-deleted.invalid` }],
      notes: [],
    };
    // Same name for an export of an erased subject.
    refusal = refusalOf(await gateDsarAction(DSAR_ID, leadSel, "export"));
    expect(refusal.reason).toBe("SUBJECT_ALREADY_ERASED");
    expectNoEmail(refusal);
  });

  it("passes with an exact (case-insensitive) match and returns the gated subject", async () => {
    dbState.rows = {
      dsar_requests_lifecycle: record(),
      users: [{ id: USER_ID, email: SUBJECT_EMAIL.toUpperCase() }],
      team_members: [{ organizationId: ORG }, { organizationId: ORG }],
    };
    const r = await gateDsarAction(DSAR_ID, userSel, "export");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.subject).toMatchObject({ kind: "user", userId: USER_ID, organizationIds: [ORG] });
    expect(r.record).toMatchObject({ id: DSAR_ID, table: "dsar_requests_lifecycle", verified: true });

    dbState.rows = {
      dsar_requests_lifecycle: record({ requestType: "portability" }),
      leads: [{ id: LEAD, organizationId: ORG, email: SUBJECT_EMAIL }],
      notes: [{ id: 901 }, { id: 902 }],
    };
    const l = await gateDsarAction(DSAR_ID, leadSel, "export");
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    expect(l.subject).toMatchObject({ kind: "lead", organizationId: ORG, leadId: LEAD, isBorrower: true, noteIds: [901, 902] });
  });
});

describe("dsarActionGate — the posture is the switch", () => {
  it("requireOperatorVerification=false makes the DSAR_NOT_VERIFIED refusal disappear", async () => {
    dbState.rows = {
      dsar_requests_lifecycle: record({ requesterIdentityVerified: false }),
      users: [{ id: USER_ID, email: SUBJECT_EMAIL }],
      team_members: [],
    };
    // Control: under the shipped posture the unverified record is refused.
    expect(refusalOf(await gateDsarAction(DSAR_ID, userSel, "export")).reason).toBe("DSAR_NOT_VERIFIED");

    posture.requireOperatorVerification = false;
    const r = await gateDsarAction(DSAR_ID, userSel, "export");
    expect(r.ok).toBe(true);
  });

  it("requireExactEmailMatch=false makes the DSAR_SUBJECT_MISMATCH refusal disappear", async () => {
    dbState.rows = {
      dsar_requests_lifecycle: record(),
      users: [{ id: USER_ID, email: OTHER_EMAIL }],
      team_members: [],
    };
    expect(refusalOf(await gateDsarAction(DSAR_ID, userSel, "export")).reason).toBe("DSAR_SUBJECT_MISMATCH");

    posture.requireExactEmailMatch = false;
    const r = await gateDsarAction(DSAR_ID, userSel, "export");
    expect(r.ok).toBe(true);
  });

  it("the shipped posture is the strict one (the switches above start ON)", () => {
    expect(ORIGINAL.requireOperatorVerification).toBe(true);
    expect(ORIGINAL.requireExactEmailMatch).toBe(true);
  });
});
