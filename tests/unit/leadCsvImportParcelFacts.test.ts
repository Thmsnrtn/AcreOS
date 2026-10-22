/**
 * Every lead import path keeps the parcel facts a land investor prices and
 * mails on — ACREAGE, VALUE (assessed vs estimated, never one for the other)
 * and TAX-DELINQUENT status — from the headers a county list actually uses.
 *
 * Behavioural: each path is driven through its real handler / function with a
 * mocked db, and the oracle is the row that reached the insert. Before
 * shared/leads/parcelFacts.ts, POST /api/leads/csv-import's row schema had no
 * such fields (zod stripped them), importLeads() never read them, and the
 * tax-delinquent importer wrote them only into the notes text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const ORG_ID = 77;

const H = vi.hoisted(() => {
  type FakeLead = Record<string, any>;
  const state = {
    LEADS: [] as FakeLead[],
    nextLeadId: 1,
    lobCalls: [] as any[],
  };
  const insertLeadRow = (values: Record<string, any>): FakeLead => {
    const lead = { id: state.nextLeadId++, status: "new", deletedAt: null, tcpaConsent: false, doNotContact: false, ...values } as FakeLead;
    state.LEADS.push(lead);
    return lead;
  };
  const dbMock: any = {
    select: () => ({
      from: () => ({
        // The existing-APN lookup: each test starts from an empty book, and a
        // later batch must see the rows earlier batches stored.
        where: () => state.LEADS.map((l) => ({ ...l })),
      }),
    }),
    insert: () => ({
      values: (vals: any) => {
        const p: any = Promise.resolve(undefined);
        p.returning = () => Promise.resolve(Array.isArray(vals) ? vals.map(insertLeadRow) : [insertLeadRow(vals)]);
        return p;
      },
    }),
    transaction: async (fn: any) => fn(dbMock),
  };
  const storageMock = {
    getLead: vi.fn(async (orgId: number, id: number) => state.LEADS.find((l) => l.id === id && l.organizationId === orgId)),
    getOrganization: vi.fn(async () => ({
      id: 77,
      name: "Test Land Co",
      settings: { mailMode: "test", companyAddress: "1 Main St", companyCity: "Austin", companyState: "TX", companyZip: "78701" },
    })),
    createLeadActivity: vi.fn(async () => ({ id: 1 })),
    createSystemAlert: vi.fn(async () => ({ id: 1 })),
    createAuditLogEntry: vi.fn(async () => ({ id: 1 })),
    // The tax-delinquent route and importLeads() insert through the batch.
    createLeadsBatch: vi.fn(async (rows: any[]) => rows.map((r) => insertLeadRow(r))),
    createLead: vi.fn(async (r: any) => insertLeadRow(r)),
    findDuplicateLeads: vi.fn(async () => []),
    getTeamMemberByEmail: vi.fn(async () => null),
  };
  return { state, dbMock, storageMock };
});

vi.mock("../../server/storage", () => ({ storage: H.storageMock, db: H.dbMock }));
vi.mock("../../server/db", () => ({ db: H.dbMock }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/workflow-engine", () => ({
  emitLeadEvent: vi.fn(),
  emitPropertyEvent: vi.fn(),
  emitDealEvent: vi.fn(),
  emitPaymentEvent: vi.fn(),
  emitParcelEvent: vi.fn(),
  workflowEngine: { emit: vi.fn() },
}));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: any, _s: any, n: any) => n() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (_q: any, _s: any, n: any) => n() }));
vi.mock("../../server/middleware/usageLimitGate", () => ({
  usageLimitGate: () => (_q: any, _s: any, n: any) => n(),
  aiByokThresholdGate: () => (_q: any, _s: any, n: any) => n(),
}));
vi.mock("../../server/middleware/roleScope", () => ({ requireScope: () => (_q: any, _s: any, n: any) => n() }));
vi.mock("../../server/utils/permissions", () => ({
  attachPermissionContext: () => (_q: any, _s: any, n: any) => n(),
  requirePermission: () => (_q: any, _s: any, n: any) => n(),
}));
vi.mock("../../server/utils/orgScope", () => ({ assertUserIsOrgMember: vi.fn(async () => true) }));
vi.mock("../../server/services/usageLimits", () => ({ checkUsageLimit: vi.fn(async () => ({ allowed: true, current: 0, limit: null })) }));
vi.mock("../../server/services/leadNurturer", () => ({ leadNurturerService: { calculateLeadScore: () => ({ score: 10, factors: {} }), segmentLead: () => "cold", generateFollowUp: async () => null } }));
vi.mock("../../server/services/leadScoring", () => ({ leadScoringService: { recordConversion: vi.fn(), scoreLead: vi.fn() } }));
vi.mock("../../server/services/skipTracingService", () => ({ skipTracingService: { trace: vi.fn(), isConfigured: () => false } }));
vi.mock("../../server/services/alerting", () => ({ alertingService: { send: vi.fn() } }));
vi.mock("../../server/services/propertyEnrichment", () => ({ propertyEnrichmentService: { enrichLead: vi.fn(async () => null) } }));
vi.mock("../../server/services/credits", () => ({ usageMeteringService: { recordUsage: vi.fn() }, creditService: { deduct: vi.fn() } }));
vi.mock("../../server/middleware/fileUploadSecurity", () => ({
  createUploadMiddleware: () => ({ single: () => (_q: any, _s: any, n: any) => n() }),
  validateFileMiddleware: () => (_q: any, _s: any, n: any) => n(),
}));
vi.mock("../../server/utils/contractResponse", () => ({ validateResponse: (_s: any, p: any) => p }));
vi.mock("../../server/services/consentEvents", () => ({ recordConsentGranted: async () => ({}) }));
// The direct-mail send: Lob is the boundary, and it records what it was asked to print.
vi.mock("../../server/services/lobService", () => ({
  lobService: {
    isConfigured: () => true,
    isConfiguredForOrg: async () => true,
    sendLetter: async (options: any) => {
      H.state.lobCalls.push(options);
      return { success: true, lobMailingId: "ltr_1", isTestMode: true };
    },
    isRetryableError: () => false,
  },
  LobErrorType: {},
}));
vi.mock("../../server/services/emailService", () => ({ emailService: { isConfigured: async () => true, sendEmail: async () => ({ success: true }) } }));
vi.mock("../../server/services/smsService", () => ({ smsService: { isConfigured: () => true }, sendOrgSMS: async () => ({ success: true }) }));
vi.mock("../../server/services/compliance/contactFrequency", () => ({
  frequencyGateForLead: async () => ({ allowed: true }),
  describeFrequencySkip: () => "",
}));

import { registerLeadRoutes } from "../../server/routes-leads";
import { importLeads, parseCSV } from "../../server/services/importExport";
import { processTaxDelinquentImport } from "../../server/services/taxDelinquentPipeline";
import { mapCsvRow, parseCsv, suggestMapping } from "../../shared/leads/csvImportMapping";

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use((req: any, _res, next) => {
  req.organization = { id: ORG_ID, name: "Test Org" };
  req.organizationId = ORG_ID;
  req.user = { id: "user-1" };
  next();
});
registerLeadRoutes(app);

beforeEach(() => {
  H.state.LEADS = [];
  H.state.nextLeadId = 1;
});

const COUNTY_CSV = [
  "APN,Owner Name,Mailing Address,Mailing City,Mailing State,Mailing Zip,County,Calc Acres,Total Assessed,Market Value,Tax Delinquent,Delinquent Amount,Years Delinquent",
  "101-22-0001,SMITH JOHN,100 N MAIN ST,LOS ANGELES,CA,90012,COCHISE,12.5 ac,\"$45,000\",\"$61,500\",Y,\"$1,234.50\",3",
  "101-22-0002,GARCIA MARY,200 N MAIN ST,HOUSTON,TX,77002,COCHISE,\"1,234.5\",N/A,,N,0,",
  "101-22-0003,NGUYEN LINDA,300 N MAIN ST,BOSTON,MA,02108,COCHISE,N/A,0,garbage,,\"$310.00\",",
].join("\n");

const byApn = (apn: string) => H.state.LEADS.find((l) => l.apn === apn);

describe("POST /api/leads/csv-import keeps acreage, value and tax-delinquent status", () => {
  it("the Smart CSV sheet's mapping + the route store the facts on the lead", async () => {
    const { headers, rows } = parseCsv(COUNTY_CSV);
    const mapping = suggestMapping(headers);
    const mapped = rows.map((r) => mapCsvRow(headers, r, mapping));
    const res = await request(app).post("/api/leads/csv-import").send({ rows: mapped });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(3);

    const a = byApn("101-22-0001")!;
    expect(a.acreage).toBe("12.5");
    expect(a.assessedValue).toBe("45000");
    expect(a.estimatedValue).toBe("61500");
    expect(a.taxDelinquent).toBe(true);
    expect(a.taxDelinquentAmount).toBe("1234.5");
    expect(a.taxDelinquentYears).toBe(3);

    const b = byApn("101-22-0002")!;
    expect(b.acreage).toBe("1234.5");
    // Refuse, never 0: "N/A" and an empty cell are not values.
    expect(b.assessedValue).toBeNull();
    expect(b.estimatedValue).toBeNull();
    expect(b.taxDelinquent).toBe(false);
    expect(b.taxDelinquentYears).toBeNull();

    const c = byApn("101-22-0003")!;
    expect(c.acreage).toBeNull();
    expect(c.assessedValue).toBeNull(); // a county "0" is "not assessed"
    expect(c.estimatedValue).toBeNull();
    // A positive amount owed IS delinquency, with a blank flag column.
    expect(c.taxDelinquent).toBe(true);
    expect(c.taxDelinquentAmount).toBe("310");
  });

  it("an assessed value never lands in estimatedValue (and vice versa)", async () => {
    const res = await request(app).post("/api/leads/csv-import").send({
      rows: [
        { lastName: "SMITH", apn: "A-1", assessedValue: "45000" },
        { lastName: "JONES", apn: "A-2", estimatedValue: "61500" },
      ],
    });
    expect(res.status).toBe(200);
    expect(byApn("A-1")).toMatchObject({ assessedValue: "45000", estimatedValue: null });
    expect(byApn("A-2")).toMatchObject({ assessedValue: null, estimatedValue: "61500" });
  });

  it("a row with no parcel-fact columns stores nulls, not zeros or a guessed flag", async () => {
    const res = await request(app).post("/api/leads/csv-import").send({ rows: [{ lastName: "SMITH", apn: "B-1" }] });
    expect(res.status).toBe(200);
    expect(byApn("B-1")).toMatchObject({
      acreage: null, assessedValue: null, estimatedValue: null,
      taxDelinquent: null, taxDelinquentAmount: null, taxDelinquentYears: null,
    });
  });
});

describe("importLeads() (POST /api/leads/import, /api/import/leads and its background job)", () => {
  it("reads the county headers by their words and stores the facts", async () => {
    const r = await importLeads(parseCSV(
      "firstName,lastName,APN,State,County,Lot Size (Acres),Assessed Value,Estimated Value,Delinquent,Taxes Owed\n" +
      "John,Smith,C-1,AZ,Cochise,40,\"$12,000\",\"$30,000\",Yes,\"$900\"\n" +
      "Mary,Garcia,C-2,AZ,Cochise,,,,,\n",
    ), ORG_ID);
    expect(r.successCount).toBe(2);
    expect(byApn("C-1")).toMatchObject({
      acreage: "40", assessedValue: "12000", estimatedValue: "30000",
      taxDelinquent: true, taxDelinquentAmount: "900",
    });
    expect(byApn("C-2")).toMatchObject({ acreage: null, assessedValue: null, estimatedValue: null, taxDelinquent: null });
  });

  it("a county Land Value fills the assessed value only when no assessed column exists", async () => {
    await importLeads(parseCSV("firstName,lastName,APN,Land Value\nJohn,Smith,D-1,8000\n"), ORG_ID);
    expect(byApn("D-1")).toMatchObject({ assessedValue: "8000", estimatedValue: null });
    await importLeads(parseCSV("firstName,lastName,APN,Land Value,Total Assessed\nMary,Jones,D-2,8000,\n"), ORG_ID);
    expect(byApn("D-2")).toMatchObject({ assessedValue: null });
  });

  it("a caller field map onto a fact field is honoured", async () => {
    await importLeads(parseCSV("firstName,lastName,APN,SZ\nJohn,Smith,E-1,7.25\n"), ORG_ID, { fieldMap: { sz: "acreage" } });
    expect(byApn("E-1")).toMatchObject({ acreage: "7.25" });
  });
});

describe("POST /api/leads/import/tax-delinquent", () => {
  it("writes acreage, assessed value, amount owed and the flag on the lead's columns", async () => {
    const res = await request(app).post("/api/leads/import/tax-delinquent").send({
      mappedData: [
        { parcel_id: "F-1", owner_name: "SMITH JOHN", state: "AZ", county: "Cochise", acreage: "2.5 ac", assessed_value: "$4,500", taxes_owed: "$310.20", years_delinquent: "2" },
        { parcel_id: "F-2", owner_name: "JONES MARY", state: "AZ", county: "Cochise", acreage: "N/A", assessed_value: "", taxes_owed: "" },
        { parcel_id: "F-3", owner_name: "LEE ANN", state: "AZ", county: "Cochise", delinquent: "Current" },
      ],
      columnMapping: {},
    });
    expect(res.status).toBe(200);
    expect(byApn("F-1")).toMatchObject({
      acreage: "2.5", assessedValue: "4500", estimatedValue: null,
      taxDelinquent: true, taxDelinquentAmount: "310.2", taxDelinquentYears: 2,
    });
    // Imported AS a tax-delinquent list: delinquent by the customer's
    // declaration when its own columns are silent — but never a number.
    expect(byApn("F-2")).toMatchObject({ acreage: null, assessedValue: null, taxDelinquentAmount: null, taxDelinquent: true });
    // An explicit "Current" in the delinquent column is believed.
    expect(byApn("F-3")).toMatchObject({ taxDelinquent: false });
  });
});

describe("processTaxDelinquentImport() (the county-pipeline importer)", () => {
  it("stores the facts on the lead's columns and a real assessed value in the payload", async () => {
    const r = await processTaxDelinquentImport(ORG_ID, 1, [
      "APN,Owner Name,Situs Address,State,Acres,Assessed Value,Delinquent Amount,Years Delinquent",
      "G-1,SMITH JOHN,1 CHOLLA RD,AZ,12.5 ac,\"$4,500\",\"$1,200.00\",3",
      "G-2,JONES MARY,2 CHOLLA RD,AZ,N/A,,,",
    ].join("\n"));
    expect(r.imported).toBe(2);
    const byPayloadApn = (apn: string) => H.state.LEADS.find((l) => JSON.parse(l.notes).apn === apn);
    const g1 = byPayloadApn("G-1")!;
    expect(g1).toMatchObject({ acreage: "12.5", assessedValue: "4500", taxDelinquent: true, taxDelinquentAmount: "1200", taxDelinquentYears: 3 });
    expect(JSON.parse(g1.notes).propertyValueCents).toBe(450000);
    const g2 = byPayloadApn("G-2")!;
    expect(g2).toMatchObject({ acreage: null, assessedValue: null, taxDelinquentAmount: null, taxDelinquent: true });
    expect(JSON.parse(g2.notes).propertyValueCents).toBeUndefined();
  });
});
