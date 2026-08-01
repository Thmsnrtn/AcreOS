/**
 * Statute register `fcra.permissible-purpose` (15 U.S.C. §1681b,
 * §1681b(a)(3)(F)) — first real tests for the permissible-purpose gate,
 * which the register recorded as a well-designed refusal with ZERO tests.
 * FCRA is the classic class-action vehicle; this gate is the defence.
 *
 * Caller paths into the sensitive writes (tenant screening fields on
 * `tenants`, `tenant_screenings` rows, skip-trace lookups):
 *
 *   1. PATCH /api/tenants/:id (server/routes-rentals.ts) — GUARDED when the
 *      body touches any screening field OR status approved/denied, via
 *      assertScreeningPermitted (annual org attestation + per-lookup
 *      tenant_screenings row < 1h old).
 *   2. POST /api/tenants/:id/adverse-action (server/routes-rentals.ts) —
 *      GUARDED via the same assertScreeningPermitted.
 *   3. POST /api/tenants/:id/attest-screening (server/routes-rentals.ts) —
 *      the per-lookup attestation WRITE, itself gated on the annual org
 *      attestation and a valid purpose enum.
 *   4. POST /api/skip-traces (server/routes-leads.ts) — GUARDED via
 *      assertSkipTracePermitted (purpose ∈ skip-trace purposes + ≥10-char
 *      justification + annual attestation).
 *   5. POST /api/skip-tracing/trace/:leadId (server/routes-skip-tracing.ts)
 *      — GUARDED (since 2026-08-01) via the same assertSkipTracePermitted;
 *      previously performed the identical consumer lookup with NO gate.
 *   6. POST /api/skip-tracing/batch (server/routes-skip-tracing.ts) —
 *      GUARDED (since 2026-08-01): gates ONCE per request and stamps the
 *      one claimed purpose + justification onto every persisted trace row.
 *   7. POST /api/tenants (create) — UNGUARDED SIBLING: accepts all five
 *      screening fields with no attestation check. Pinned below as a known
 *      statute-register finding, not blessed as correct.
 *
 * What this suite pins:
 *   - every refusal is honest and named (FCRA_ATTESTATION_REQUIRED /
 *     TENANT_SCREENING_NOT_ATTESTED / SKIP_TRACE_PURPOSE_REQUIRED) with a
 *     remedy in the message — no silent fallthrough;
 *   - refusals fire BEFORE the sensitive write (nothing lands);
 *   - the attestation trail is written BEFORE screening fields may update,
 *     and the ordering is pinned at runtime via the CALLS ledger;
 *   - annual attestations expire (365d) and die on version bumps; per-lookup
 *     rows expire (1h) and are scoped to org + tenant + requesting user;
 *   - the adverse-action record never claims a send that didn't happen.
 *
 * idempotent: true — db and storage are fully mocked; the gate service
 * (server/services/fcraAttestation.ts) runs REAL.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

const ORG_ID = 42;
const USER_ID = "user-1";
const TENANT_ID = "11111111-2222-3333-4444-555555555555";

const H = vi.hoisted(() => {
  /** Execution ledger — every db/storage touch in order, for ordering pins. */
  const CALLS: string[] = [];

  const state = {
    tables: {} as Record<string, any[]>,
    /** Leads served by storage.getLeads for the /api/skip-tracing/batch path. */
    leadsList: [] as any[],
  };

  const tableName = (t: any) => t?.[Symbol.for("drizzle:Name")] ?? "";

  // Recover (db_column, value) pairs from a drizzle eq()/and() predicate so
  // the mock filters the way SQL would (eq → [Column, chunk, Param]).
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
    if (name === "tenant_screenings" || name === "fcra_attestations") {
      return { attestedAt: new Date() };
    }
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
            const sortKey = ["attestedAt", "consentedAt"].find(
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
        const row = { id: `${name}-${arr.length + 1}`, ...rowDefaults(name), ...v };
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
    delete: (table: any) => ({
      where: (_w: any) => {
        const name = tableName(table);
        const p: any = Promise.resolve([]);
        p.returning = () => Promise.resolve([]);
        return p;
      },
    }),
  };

  const storageMock = {
    getLead: vi.fn(async (_orgId: number, id: number) => ({
      id,
      firstName: "Dana",
      lastName: "Reyes",
      phone: null,
      email: null,
      address: "1 A St",
      city: null,
      state: null,
      zip: null,
    })),
    getLeads: vi.fn(async () => state.leadsList),
    getSkipTraces: vi.fn(async () => []),
    createSkipTrace: vi.fn(async (data: any) => {
      CALLS.push("storage.createSkipTrace");
      return { id: 1, ...data };
    }),
    updateSkipTrace: vi.fn(async (id: number, updates: any) => ({ id, ...updates })),
    updateLead: vi.fn(async (id: number, updates: any) => ({ id, ...updates })),
  };

  // Credit-pool doubles for the routes-skip-tracing endpoints — the gate
  // must refuse BEFORE any debit, so refusal tests assert zero calls here.
  const poolDebitMock = vi.fn(async ({ units }: { units: number }) => ({
    allowed: true,
    debitedCents: units * 20,
    remaining: 10_000,
    poolMonthly: 20_000,
  }));
  const refundPoolDebitMock = vi.fn(async () => ({}));

  // Skip-trace provider double with per-test behavior. Default: honest
  // "no provider" failure (matches isConfigured() === false below). Tests
  // that need a hit set `traceState.impl`.
  const traceState = { impl: null as null | (() => Promise<any>) };
  const traceMock = vi.fn(async (..._args: any[]) =>
    traceState.impl
      ? traceState.impl()
      : { success: false, source: "none", contacts: [], error: "No skip tracing provider configured." },
  );

  return { CALLS, state, dbMock, storageMock, poolDebitMock, refundPoolDebitMock, traceState, traceMock };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/db", () => ({ db: H.dbMock }));
vi.mock("../../server/storage", () => ({ storage: H.storageMock, db: H.dbMock }));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/middleware/usageLimitGate", () => ({
  usageLimitGate: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/middleware/roleScope", () => ({
  requireScope: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/utils/permissions", () => ({
  attachPermissionContext: () => (_req: any, _res: any, next: any) => next(),
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/utils/orgScope", () => ({
  assertUserIsOrgMember: vi.fn(async () => true),
}));
vi.mock("../../server/services/usageLimits", () => ({
  checkUsageLimit: vi.fn(async () => ({ allowed: true, current: 0, limit: null })),
}));
vi.mock("../../server/services/leadNurturer", () => ({
  leadNurturerService: {
    calculateLeadScore: () => ({ score: 10, factors: {} }),
    segmentLead: () => "cold",
    generateFollowUp: async () => null,
  },
}));
vi.mock("../../server/services/leadScoring", () => ({
  leadScoringService: { recordConversion: vi.fn(async () => ({})), scoreLead: vi.fn(async () => ({})) },
}));
// No skip-trace provider configured by default: after the gate passes, the
// routes-leads path must answer an honest "unavailable" — never fabricate
// PII, never charge. The routes-skip-tracing endpoints call trace() directly;
// tests that exercise their success path set H.traceState.impl to a hit.
vi.mock("../../server/services/skipTracingService", () => ({
  skipTracingService: { trace: H.traceMock, isConfigured: () => false },
}));
vi.mock("../../server/middleware/rateLimit", () => ({
  createRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/services/creditPool", () => ({
  poolDebit: (...args: any[]) => H.poolDebitMock(...(args as [any])),
  refundPoolDebit: (...args: any[]) => H.refundPoolDebitMock(...(args as [any])),
  poolRefusalDetails: () => ({ reason: "pool_exhausted" }),
}));
vi.mock("../../server/services/alerting", () => ({ alertingService: { send: vi.fn() } }));
vi.mock("../../server/services/propertyEnrichment", () => ({
  propertyEnrichmentService: { enrichLead: vi.fn(async () => null) },
}));
vi.mock("../../server/services/credits", () => ({
  usageMeteringService: { recordUsage: vi.fn(async () => ({ insufficientCredits: false })) },
  creditService: { deduct: vi.fn() },
}));
vi.mock("../../server/middleware/fileUploadSecurity", () => ({
  createUploadMiddleware: () => ({ single: () => (_req: any, _res: any, next: any) => next() }),
  validateFileMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/utils/contractResponse", () => ({
  validateResponse: (_schema: any, payload: any) => payload,
}));
vi.mock("../../server/services/workflow-engine", () => ({
  emitLeadEvent: vi.fn(),
  emitPropertyEvent: vi.fn(),
  emitDealEvent: vi.fn(),
  emitPaymentEvent: vi.fn(),
  emitParcelEvent: vi.fn(),
  workflowEngine: { emit: vi.fn() },
}));

// The gate itself runs REAL — that is the point of the suite.
import {
  assertScreeningPermitted,
  assertSkipTracePermitted,
  getCurrentAttestation,
  CURRENT_FCRA_ATTESTATION_VERSION,
  FcraAttestationStaleError,
  SkipTracePurposeRequiredError,
  TenantScreeningNotAttestedError,
} from "../../server/services/fcraAttestation";
import { registerRentalRoutes } from "../../server/routes-rentals";
import { registerLeadRoutes } from "../../server/routes-leads";
import skipTracingRouter from "../../server/routes-skip-tracing";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { id: USER_ID };
    req.organization = { id: ORG_ID, name: "Test Org" };
    req.organizationId = ORG_ID;
    next();
  });
  registerRentalRoutes(app);
  registerLeadRoutes(app);
  // Same mount path as server/routes.ts:1432 (isAuthenticated + getOrCreateOrg
  // are emulated by the middleware above).
  app.use("/api/skip-tracing", skipTracingRouter);
  return app;
}
const app = makeApp();

const DAY_MS = 24 * 60 * 60 * 1000;

function seedAnnualAttestation(opts: { ageDays?: number; version?: string; userId?: string } = {}) {
  const row = {
    id: `att-${(H.state.tables["fcra_attestations"]?.length ?? 0) + 1}`,
    organizationId: ORG_ID,
    userId: opts.userId ?? USER_ID,
    attestationVersion: opts.version ?? CURRENT_FCRA_ATTESTATION_VERSION,
    attestedAt: new Date(Date.now() - (opts.ageDays ?? 0) * DAY_MS),
  };
  (H.state.tables["fcra_attestations"] ??= []).push(row);
  return row;
}

function seedScreeningRow(opts: { ageMinutes?: number; userId?: string; tenantId?: string } = {}) {
  const row = {
    id: `scr-${(H.state.tables["tenant_screenings"]?.length ?? 0) + 1}`,
    organizationId: ORG_ID,
    tenantId: opts.tenantId ?? TENANT_ID,
    requestingUserId: opts.userId ?? USER_ID,
    purposeOfUse: "tenant_screening",
    purposeJustification: null,
    attestationVersion: CURRENT_FCRA_ATTESTATION_VERSION,
    attestedAt: new Date(Date.now() - (opts.ageMinutes ?? 5) * 60_000),
  };
  (H.state.tables["tenant_screenings"] ??= []).push(row);
  return row;
}

function seedTenant() {
  const row = {
    id: TENANT_ID,
    organizationId: ORG_ID,
    firstName: "Ada",
    lastName: "Applicant",
    status: "applicant",
  };
  (H.state.tables["tenants"] ??= []).push(row);
  return row;
}

/** Successful provider result for the routes-skip-tracing success paths. */
function skipTraceProviderHit() {
  return {
    success: true,
    source: "batch_skip_tracing",
    contacts: [
      { type: "phone", value: "512-555-0100", confidence: 0.8, isPrimary: true, lineType: "mobile" },
      { type: "email", value: "owner@example.com", confidence: 0.7, isPrimary: true },
    ],
    creditsUsed: 1,
  };
}

/** Lead rows served by storage.getLeads for the /api/skip-tracing/batch path. */
function batchLead(id: number) {
  return {
    id,
    firstName: "Lead",
    lastName: `Number${id}`,
    phone: null,
    email: null,
    address: `${id} Main St`,
    city: null,
    state: null,
    zip: null,
  };
}

beforeEach(() => {
  H.CALLS.length = 0;
  H.state.tables = {};
  H.state.leadsList = [];
  H.traceState.impl = null;
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
describe("PATCH /api/tenants/:id — screening writes refuse without the attestation trail", () => {
  it("no annual attestation → 422 FCRA_ATTESTATION_REQUIRED with a remedy; the tenant row never updates", async () => {
    seedTenant();

    const res = await request(app)
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ screeningCreditScore: 640 });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("FCRA_ATTESTATION_REQUIRED"); // named refusal
    expect(res.body.message).toContain(CURRENT_FCRA_ATTESTATION_VERSION);
    expect(res.body.message).toContain("/account/fcra-attestation"); // remedy, not a dead end
    expect(H.CALLS).not.toContain("update:tenants"); // refusal BEFORE the write
  });

  it("an annual attestation older than 365 days is dead → 422", async () => {
    seedTenant();
    seedAnnualAttestation({ ageDays: 366 });

    const res = await request(app)
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ screeningCreditScore: 640 });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("FCRA_ATTESTATION_REQUIRED");
    expect(H.CALLS).not.toContain("update:tenants");
  });

  it("an annual attestation at a superseded version is dead → 422", async () => {
    seedTenant();
    seedAnnualAttestation({ version: "2020-01-01-v0" });

    const res = await request(app)
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ screeningCreditScore: 640 });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("FCRA_ATTESTATION_REQUIRED");
    expect(H.CALLS).not.toContain("update:tenants");
  });

  it("annual attestation but NO per-lookup row → 422 TENANT_SCREENING_NOT_ATTESTED naming the attest endpoint + 1h expiry", async () => {
    seedTenant();
    seedAnnualAttestation();

    const res = await request(app)
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ screeningCreditScore: 640 });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("TENANT_SCREENING_NOT_ATTESTED");
    expect(res.body.message).toContain("attest-screening");
    expect(res.body.message).toContain("1 hour");
    expect(H.CALLS).not.toContain("update:tenants");
  });

  it("a per-lookup row older than 1 hour has expired → 422", async () => {
    seedTenant();
    seedAnnualAttestation();
    seedScreeningRow({ ageMinutes: 90 });

    const res = await request(app)
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ screeningCreditScore: 640 });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("TENANT_SCREENING_NOT_ATTESTED");
    expect(H.CALLS).not.toContain("update:tenants");
  });

  it("a per-lookup row attested by a DIFFERENT user does not cover this operator → 422", async () => {
    seedTenant();
    seedAnnualAttestation();
    seedScreeningRow({ userId: "user-2" });

    const res = await request(app)
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ screeningCreditScore: 640 });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("TENANT_SCREENING_NOT_ATTESTED");
  });

  it("status → 'approved' and 'denied' are screening outcomes and hit the same gate", async () => {
    seedTenant();

    for (const status of ["approved", "denied"]) {
      const res = await request(app).patch(`/api/tenants/${TENANT_ID}`).send({ status });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("FCRA_ATTESTATION_REQUIRED");
    }
    expect(H.CALLS).not.toContain("update:tenants");
  });

  it("a NON-screening update (phone) is not gated and proceeds — pins the gate's scope", async () => {
    seedTenant();

    const res = await request(app)
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ phone: "5551234567" });

    expect(res.status).toBe(200);
    expect(H.CALLS).not.toContain("select:fcra_attestations"); // gate never invoked
    expect(H.CALLS).toContain("update:tenants");
  });

  it("with the full trail (annual + fresh per-lookup) the write lands, and the gate reads precede it", async () => {
    seedTenant();
    seedAnnualAttestation();
    seedScreeningRow({ ageMinutes: 5 });

    const res = await request(app)
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ screeningCreditScore: 640, screeningCriteriaMet: true });

    expect(res.status).toBe(200);
    expect(res.body.tenant.screeningCreditScore).toBe(640);
    const updateIdx = H.CALLS.indexOf("update:tenants");
    expect(updateIdx).toBeGreaterThan(H.CALLS.indexOf("select:fcra_attestations"));
    expect(updateIdx).toBeGreaterThan(H.CALLS.indexOf("select:tenant_screenings"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("POST /api/tenants/:id/attest-screening — the per-lookup attestation write", () => {
  it("refuses without the annual attestation → 422 FCRA_ATTESTATION_REQUIRED; no row written", async () => {
    const res = await request(app)
      .post(`/api/tenants/${TENANT_ID}/attest-screening`)
      .send({ purposeOfUse: "tenant_screening" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("FCRA_ATTESTATION_REQUIRED");
    expect(H.CALLS).not.toContain("insert:tenant_screenings");
  });

  it("refuses an invalid purpose BEFORE any lookup — no attestation read, no row", async () => {
    seedAnnualAttestation();

    const res = await request(app)
      .post(`/api/tenants/${TENANT_ID}/attest-screening`)
      .send({ purposeOfUse: "curiosity" });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain("purposeOfUse must be one of");
    expect(H.CALLS).not.toContain("select:fcra_attestations"); // validated before touching the db
    expect(H.CALLS).not.toContain("insert:tenant_screenings");
  });

  it("legitimate_business_need without a ≥30-char justification is refused", async () => {
    seedAnnualAttestation();

    const res = await request(app)
      .post(`/api/tenants/${TENANT_ID}/attest-screening`)
      .send({ purposeOfUse: "legitimate_business_need", justification: "too short" });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain("justification");
    expect(H.CALLS).not.toContain("insert:tenant_screenings");
  });

  it("records the per-lookup row with purpose, requesting user, and the CURRENT attestation version", async () => {
    seedAnnualAttestation();

    const res = await request(app)
      .post(`/api/tenants/${TENANT_ID}/attest-screening`)
      .send({ purposeOfUse: "tenant_screening" });

    expect(res.status).toBe(201);
    expect(res.body.screening).toMatchObject({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      purposeOfUse: "tenant_screening",
      requestingUserId: USER_ID,
      attestationVersion: CURRENT_FCRA_ATTESTATION_VERSION,
    });
  });

  it("full flow: attest-screening THEN the screening write — the attestation row lands strictly first", async () => {
    seedTenant();
    seedAnnualAttestation();

    const attest = await request(app)
      .post(`/api/tenants/${TENANT_ID}/attest-screening`)
      .send({ purposeOfUse: "tenant_screening" });
    expect(attest.status).toBe(201);

    const patch = await request(app)
      .patch(`/api/tenants/${TENANT_ID}`)
      .send({ screeningCreditScore: 612, screeningHasPriorEviction: true });
    expect(patch.status).toBe(200);

    // Ordering pin: the purpose attestation is persisted BEFORE the
    // screening fields update — the §1681b sequence a court would look for.
    const attestIdx = H.CALLS.indexOf("insert:tenant_screenings");
    const writeIdx = H.CALLS.indexOf("update:tenants");
    expect(attestIdx).toBeGreaterThanOrEqual(0);
    expect(writeIdx).toBeGreaterThan(attestIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("POST /api/tenants/:id/adverse-action — gated, and never claims a send", () => {
  it("refuses without the per-lookup trail → 422; neither the screening row nor the tenant is touched", async () => {
    seedTenant();
    seedAnnualAttestation();

    const res = await request(app).post(`/api/tenants/${TENANT_ID}/adverse-action`).send({});

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("TENANT_SCREENING_NOT_ATTESTED");
    expect(H.CALLS).not.toContain("update:tenant_screenings");
    expect(H.CALLS).not.toContain("update:tenants");
  });

  it("with the trail: records the denial as 'recorded' — adverseActionNoticeSentAt stays unset (nothing lies)", async () => {
    seedTenant();
    seedAnnualAttestation();
    seedScreeningRow();

    const res = await request(app).post(`/api/tenants/${TENANT_ID}/adverse-action`).send({});

    expect(res.status).toBe(201);
    expect(res.body.deliveryStatus).toBe("recorded");
    expect(res.body.message).toContain("manually"); // honest: no send rail exists
    const screening = H.state.tables["tenant_screenings"][0];
    expect(screening.outcome).toBe("denied");
    expect(screening.adverseActionDeliveryStatus).toBe("recorded");
    expect(screening.adverseActionNoticeSentAt).toBeUndefined(); // never stamped without a real send
    expect(H.state.tables["tenants"][0].status).toBe("denied");
    expect(H.state.tables["tenants"][0].adverseActionNoticeSentAt).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("POST /api/skip-traces — §1681b(a)(3)(F) purpose gate on consumer-report-adjacent lookups", () => {
  const body = (extra: Record<string, unknown> = {}) => ({
    leadId: 9,
    purposeOfUse: "collection",
    justification: "Locating debtor for collection of delinquent note #123",
    ...extra,
  });

  it("no purpose → 400 with SKIP_TRACE_PURPOSE_REQUIRED and the statute named; no trace row", async () => {
    const res = await request(app).post("/api/skip-traces").send(body({ purposeOfUse: undefined }));

    expect(res.status).toBe(400);
    expect(res.body.details?.code).toBe("SKIP_TRACE_PURPOSE_REQUIRED");
    expect(res.body.message).toContain("1681b");
    expect(H.storageMock.createSkipTrace).not.toHaveBeenCalled();
  });

  it("'tenant_screening' is NOT a permissible skip-trace purpose → 400", async () => {
    const res = await request(app)
      .post("/api/skip-traces")
      .send(body({ purposeOfUse: "tenant_screening" }));

    expect(res.status).toBe(400);
    expect(res.body.details?.code).toBe("SKIP_TRACE_PURPOSE_REQUIRED");
    expect(H.storageMock.createSkipTrace).not.toHaveBeenCalled();
  });

  it("a justification under 10 chars is refused — the audit trail must say WHY", async () => {
    const res = await request(app).post("/api/skip-traces").send(body({ justification: "because" }));

    expect(res.status).toBe(400);
    expect(res.body.details?.code).toBe("SKIP_TRACE_PURPOSE_REQUIRED");
    expect(res.body.message).toContain("justification");
    expect(H.storageMock.createSkipTrace).not.toHaveBeenCalled();
  });

  it("valid purpose + justification but NO annual attestation → 403 FCRA_ATTESTATION_REQUIRED; no trace row", async () => {
    const res = await request(app).post("/api/skip-traces").send(body());

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FCRA_ATTESTATION_REQUIRED");
    expect(res.body.message).toContain("/account/fcra-attestation");
    expect(H.storageMock.createSkipTrace).not.toHaveBeenCalled();
  });

  it("with the attestation the gate opens — and with no provider the route answers honestly, fabricating nothing", async () => {
    seedAnnualAttestation();

    const res = await request(app).post("/api/skip-traces").send(body());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("unavailable"); // past the gate, honest about the missing vendor
    expect(H.storageMock.createSkipTrace).not.toHaveBeenCalled(); // no row, no cost, no fake PII
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("POST /api/skip-tracing/trace/:leadId — same §1681b gate as /api/skip-traces (ungated until 2026-08-01)", () => {
  const body = (extra: Record<string, unknown> = {}) => ({
    purposeOfUse: "collection",
    justification: "Locating debtor for collection of delinquent note #123",
    ...extra,
  });

  it("no purpose → 400 SKIP_TRACE_PURPOSE_REQUIRED citing §1681b; nothing debited, no lookup, no trace row", async () => {
    seedAnnualAttestation(); // even a fully attested org must claim a purpose per request

    const res = await request(app)
      .post("/api/skip-tracing/trace/9")
      .send(body({ purposeOfUse: undefined }));

    expect(res.status).toBe(400);
    expect(res.body.details?.code).toBe("SKIP_TRACE_PURPOSE_REQUIRED");
    expect(res.body.message).toContain("1681b");
    expect(H.storageMock.createSkipTrace).not.toHaveBeenCalled();
    expect(H.traceMock).not.toHaveBeenCalled(); // no consumer lookup happened
    expect(H.poolDebitMock).not.toHaveBeenCalled(); // refusal costs nothing
  });

  it("a justification under 10 chars is refused — the audit trail must say WHY", async () => {
    seedAnnualAttestation();

    const res = await request(app)
      .post("/api/skip-tracing/trace/9")
      .send(body({ justification: "because" }));

    expect(res.status).toBe(400);
    expect(res.body.details?.code).toBe("SKIP_TRACE_PURPOSE_REQUIRED");
    expect(res.body.message).toContain("justification");
    expect(H.storageMock.createSkipTrace).not.toHaveBeenCalled();
    expect(H.traceMock).not.toHaveBeenCalled();
  });

  it("valid purpose + justification but NO annual attestation → 403 FCRA_ATTESTATION_REQUIRED with the remedy; no trace row", async () => {
    const res = await request(app).post("/api/skip-tracing/trace/9").send(body());

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FCRA_ATTESTATION_REQUIRED");
    expect(res.body.message).toContain("/account/fcra-attestation");
    expect(H.storageMock.createSkipTrace).not.toHaveBeenCalled();
    expect(H.traceMock).not.toHaveBeenCalled();
    expect(H.poolDebitMock).not.toHaveBeenCalled();
  });

  it("with the full trail the trace runs and the §1681b audit fields land on the persisted row", async () => {
    seedAnnualAttestation();
    H.traceState.impl = async () => skipTraceProviderHit();

    const res = await request(app).post("/api/skip-tracing/trace/9").send(body());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(H.storageMock.createSkipTrace).toHaveBeenCalledTimes(1);
    expect(H.storageMock.createSkipTrace.mock.calls[0][0]).toMatchObject({
      organizationId: ORG_ID,
      leadId: 9,
      purposeOfUse: "collection",
      justification: "Locating debtor for collection of delinquent note #123",
      attestingUserId: USER_ID,
      attestationVersion: CURRENT_FCRA_ATTESTATION_VERSION,
    });
    // The gate read the attestation BEFORE the row was written.
    expect(H.CALLS.indexOf("select:fcra_attestations")).toBeGreaterThan(-1);
    expect(H.CALLS.indexOf("select:fcra_attestations")).toBeLessThan(
      H.CALLS.indexOf("storage.createSkipTrace"),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("POST /api/skip-tracing/batch — gates ONCE, one purpose stamped on every row (ungated until 2026-08-01)", () => {
  const body = (extra: Record<string, unknown> = {}) => ({
    purposeOfUse: "collection",
    justification: "Locating debtors for collection of delinquent notes",
    ...extra,
  });

  it("no purpose → 400 SKIP_TRACE_PURPOSE_REQUIRED; refused before leads are even enumerated", async () => {
    seedAnnualAttestation();
    H.state.leadsList = [batchLead(1), batchLead(2)];

    const res = await request(app)
      .post("/api/skip-tracing/batch")
      .send(body({ purposeOfUse: undefined }));

    expect(res.status).toBe(400);
    expect(res.body.details?.code).toBe("SKIP_TRACE_PURPOSE_REQUIRED");
    expect(res.body.message).toContain("1681b");
    expect(H.storageMock.getLeads).not.toHaveBeenCalled(); // gate precedes selection
    expect(H.poolDebitMock).not.toHaveBeenCalled();
    expect(H.traceMock).not.toHaveBeenCalled();
    expect(H.storageMock.createSkipTrace).not.toHaveBeenCalled();
  });

  it("no annual attestation → 403 FCRA_ATTESTATION_REQUIRED; N untraced leads waiting changes nothing", async () => {
    H.state.leadsList = [batchLead(1), batchLead(2)];

    const res = await request(app).post("/api/skip-tracing/batch").send(body());

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FCRA_ATTESTATION_REQUIRED");
    expect(res.body.message).toContain("/account/fcra-attestation");
    expect(H.poolDebitMock).not.toHaveBeenCalled();
    expect(H.traceMock).not.toHaveBeenCalled();
    expect(H.storageMock.createSkipTrace).not.toHaveBeenCalled();
  });

  it("full trail: ONE gate check covers the batch and EVERY persisted row carries the claimed purpose", async () => {
    seedAnnualAttestation();
    H.state.leadsList = [batchLead(1), batchLead(2)];
    H.traceState.impl = async () => skipTraceProviderHit();

    const res = await request(app).post("/api/skip-tracing/batch").send(body());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ requested: 2, traced: 2, failed: 0 });

    // Gate consulted exactly once for the whole batch…
    expect(H.CALLS.filter((c) => c === "select:fcra_attestations")).toHaveLength(1);

    // …and its ONE claimed purpose is stamped on BOTH rows — never N silent
    // lookups under an attestation made for a different purpose.
    expect(H.storageMock.createSkipTrace).toHaveBeenCalledTimes(2);
    for (const [row] of H.storageMock.createSkipTrace.mock.calls) {
      expect(row).toMatchObject({
        organizationId: ORG_ID,
        purposeOfUse: "collection",
        justification: "Locating debtors for collection of delinquent notes",
        attestingUserId: USER_ID,
        attestationVersion: CURRENT_FCRA_ATTESTATION_VERSION,
      });
    }

    // The debit happened once, after the gate, for exactly the attempted units.
    expect(H.poolDebitMock).toHaveBeenCalledTimes(1);
    expect(H.poolDebitMock.mock.calls[0][0].units).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("gate service internals (real fcraAttestation.ts)", () => {
  it("assertSkipTracePermitted validates purpose BEFORE any db read", async () => {
    await expect(
      assertSkipTracePermitted({
        organizationId: ORG_ID,
        userId: USER_ID,
        purposeOfUse: null,
        justification: "a perfectly long justification",
      }),
    ).rejects.toBeInstanceOf(SkipTracePurposeRequiredError);
    expect(H.CALLS).toHaveLength(0); // refused without touching the db
  });

  it("assertSkipTracePermitted returns the live attestation version on success", async () => {
    seedAnnualAttestation();
    const out = await assertSkipTracePermitted({
      organizationId: ORG_ID,
      userId: USER_ID,
      purposeOfUse: "account_review",
      justification: "annual account review of borrower",
    });
    expect(out.attestationVersion).toBe(CURRENT_FCRA_ATTESTATION_VERSION);
  });

  it("getCurrentAttestation: fresh row returned; >365d old or version-superseded → null", async () => {
    seedAnnualAttestation();
    expect(await getCurrentAttestation(ORG_ID, USER_ID)).not.toBeNull();

    H.state.tables = {};
    seedAnnualAttestation({ ageDays: 366 });
    expect(await getCurrentAttestation(ORG_ID, USER_ID)).toBeNull();

    H.state.tables = {};
    seedAnnualAttestation({ version: "2020-01-01-v0" });
    expect(await getCurrentAttestation(ORG_ID, USER_ID)).toBeNull();
  });

  it("assertScreeningPermitted throws typed, coded errors — never a silent pass", async () => {
    await expect(
      assertScreeningPermitted({ organizationId: ORG_ID, userId: USER_ID, tenantId: TENANT_ID }),
    ).rejects.toBeInstanceOf(FcraAttestationStaleError);

    seedAnnualAttestation();
    await expect(
      assertScreeningPermitted({ organizationId: ORG_ID, userId: USER_ID, tenantId: TENANT_ID }),
    ).rejects.toBeInstanceOf(TenantScreeningNotAttestedError);
  });

  it("requirePerLookupRow:false (read-only endpoints) needs only the annual attestation", async () => {
    seedAnnualAttestation();
    await expect(
      assertScreeningPermitted({
        organizationId: ORG_ID,
        userId: USER_ID,
        tenantId: TENANT_ID,
        requirePerLookupRow: false,
      }),
    ).resolves.toBeUndefined();
    expect(H.CALLS).not.toContain("select:tenant_screenings");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Source-level pins — enumerate every WRITER of the sensitive data so an
// unguarded sibling cannot appear silently (this repo's repeated defect).
// The enumeration is anchored on the ACTION (the persisted write), never on
// the gate: a ratchet that scans callers of assert*Permitted is structurally
// blind to a new writer that simply never calls the gate — exactly how the
// /api/skip-tracing endpoints shipped ungated. Comments are stripped before
// matching.
// ═══════════════════════════════════════════════════════════════════════════

const ROOT = path.resolve(__dirname, "../..");

function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let mode: "code" | "line" | "block" | "single" | "double" | "template" = "code";
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && n === "*") { mode = "block"; i += 2; continue; }
      if (c === "'") mode = "single";
      else if (c === '"') mode = "double";
      else if (c === "`") mode = "template";
      out += c; i++; continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } i++; continue; }
    if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i += 2; continue; } i++; continue; }
    if (c === "\\") { out += c + (n ?? ""); i += 2; continue; }
    if ((mode === "single" && c === "'") || (mode === "double" && c === '"') || (mode === "template" && c === "`")) mode = "code";
    out += c; i++;
  }
  return out;
}

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

describe("writer enumeration for consumer-report rows (action-anchored ratchet)", () => {
  // INVERTED 2026-08-01: the previous version of this test enumerated callers
  // of the GATE (/assert(?:Screening|SkipTrace)Permitted\(/), which passed
  // green while server/routes-skip-tracing.ts wrote consumer-report rows with
  // no gate at all — the enumeration could not see a writer that never called
  // it. These pins enumerate writers of storage.createSkipTrace (the ACTION),
  // so a new ungated writer FAILS here instead of sailing past.
  it("storage.createSkipTrace is written from exactly the two known route files", () => {
    expect(
      serverFilesMatching(/storage\.createSkipTrace\(/),
      "The set of files persisting skip-trace rows changed. A writer ADDED performs " +
        "consumer-report lookups (15 U.S.C. §1681b) — it must call assertSkipTracePermitted " +
        "BEFORE the write, and this suite must cover its refusal + success paths. A writer " +
        "REMOVED: verify the endpoint is gone, not merely its persistence.",
    ).toEqual(["server/routes-leads.ts", "server/routes-skip-tracing.ts"]);
  });

  it("every file that writes a skip-trace row calls the §1681b gate", () => {
    const writers = serverFilesMatching(/storage\.createSkipTrace\(/);
    expect(writers.length).toBeGreaterThan(0);
    for (const writer of writers) {
      const src = stripComments(fs.readFileSync(path.join(ROOT, writer), "utf8"));
      expect(
        src.includes("assertSkipTracePermitted"),
        `${writer} persists consumer-report rows but never calls assertSkipTracePermitted — ` +
          "an FCRA §1681b lookup with no permissible-purpose gate. Gate it before the write.",
      ).toBe(true);
    }
  });

  it("routes-skip-tracing: both POST handlers gate before debiting or persisting", () => {
    const src = stripComments(
      fs.readFileSync(path.join(ROOT, "server/routes-skip-tracing.ts"), "utf8"),
    );
    const traceStart = src.indexOf('router.post("/trace/:leadId"');
    const batchStart = src.indexOf('router.post("/batch"');
    const statsStart = src.indexOf('router.get("/stats"');
    expect(traceStart).toBeGreaterThan(-1);
    expect(batchStart).toBeGreaterThan(traceStart);
    expect(statsStart).toBeGreaterThan(batchStart);
    for (const handler of [src.slice(traceStart, batchStart), src.slice(batchStart, statsStart)]) {
      const gateIdx = handler.indexOf("gateSkipTracePermitted");
      const debitIdx = handler.indexOf("poolDebit");
      const persistIdx = handler.indexOf("persistTraceResult");
      expect(gateIdx).toBeGreaterThan(-1);
      expect(debitIdx).toBeGreaterThan(-1);
      expect(persistIdx).toBeGreaterThan(-1);
      expect(gateIdx).toBeLessThan(debitIdx); // a refusal never costs a credit
      expect(gateIdx).toBeLessThan(persistIdx); // …and never lands a row
    }
  });

  it("tenant screening columns are written from exactly one server file (routes-rentals.ts)", () => {
    expect(
      serverFilesMatching(/screeningCreditScore/),
      "A NEW server file touches tenant screening fields. Every write to screening data must go " +
        "through assertScreeningPermitted BEFORE the write (15 U.S.C. §1681b) — gate it and extend this suite.",
    ).toEqual(["server/routes-rentals.ts"]);
  });

  it("routes-rentals: the gate call precedes the tenants update in source", () => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, "server/routes-rentals.ts"), "utf8"));
    const gateIdx = src.indexOf("assertScreeningPermitted");
    const writeIdx = src.indexOf("db.update(tenants)");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(writeIdx);
  });

  it("routes-leads: the skip-trace gate precedes the trace-row write in source", () => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, "server/routes-leads.ts"), "utf8"));
    const handler = src.slice(src.indexOf('api.post("/api/skip-traces"'));
    const gateIdx = handler.indexOf("assertSkipTracePermitted");
    const writeIdx = handler.indexOf("storage.createSkipTrace");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(writeIdx);
  });

  it("KNOWN GAP (statute register fcra.permissible-purpose): POST /api/tenants CREATE accepts screening fields ungated", () => {
    // This pins the CURRENT state so the gap stays visible, not to bless it:
    // the tenant-create handler inserts screeningCreditScore et al. with no
    // assertScreeningPermitted call, so an operator can record consumer-report
    // data with zero purpose attestation by creating instead of patching. If
    // this assertion starts failing, the gate has been added — REWRITE this
    // test to assert the gate's presence and ordering in the create path
    // (do not delete it).
    const src = stripComments(fs.readFileSync(path.join(ROOT, "server/routes-rentals.ts"), "utf8"));
    const start = src.indexOf('app.post("/api/tenants"');
    const end = src.indexOf('app.patch("/api/tenants/:id"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const createHandler = src.slice(start, end);
    expect(createHandler).toContain("screeningCreditScore");
    expect(createHandler).not.toContain("assertScreeningPermitted");
  });
});
