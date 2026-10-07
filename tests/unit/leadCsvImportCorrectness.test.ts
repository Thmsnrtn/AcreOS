/**
 * Lead CSV import correctness — the Smart CSV import sheet end to end, against
 * the six land-list shapes the market simulation built
 * (tests/simulation/campaign/market/csv-imports.ts: county parcel export,
 * list-broker export, PropStream-style, tax-delinquent roll, skip-traced
 * return, a large county pull).
 *
 * Each file goes through the SHIPPED path: the sheet's own parser and
 * auto-mapping (shared/leads/csvImportMapping.ts, which CsvImportSheet.tsx
 * imports), in the sheet's request-sized batches, into the real
 * POST /api/leads/csv-import handler, and the stored lead is then handed to
 * the real direct-mail send. The oracle is the generated truth, never the
 * mapping's own output.
 *
 * Defects pinned (all found by the simulation, all reproduced red here first):
 *   1. Mailing and situs columns both mapped to `address`, last column won:
 *      the postcard was addressed to the vacant parcel.
 *   2. "Owner 1 First Name" / "Owner 1 Last Name" both mapped to the owner
 *      name (last wins), and a county "SMITH JOHN & MARY" was split into
 *      firstName "SMITH": messages greeted the owner by surname.
 *   3. "Phone1" / "Mobile Phone 1" / "Landline 1" were not phones, and a DNC
 *      column was ignored on every row.
 *   4. A file over 500 rows failed whole with "Validation failed".
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
        p.returning = () => Promise.resolve([insertLeadRow(vals)]);
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
vi.mock("../../server/middleware/usageLimitGate", () => ({ usageLimitGate: () => (_q: any, _s: any, n: any) => n() }));
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
import { communicationsService } from "../../server/services/communications";
import {
  CSV_IMPORT_MAX_ROWS_PER_REQUEST,
  chunkCsvImportRows,
  mapCsvRow,
  parseCsv,
  suggestMapping,
} from "../../shared/leads/csvImportMapping";
import { salutationName } from "../../shared/parcel/ownerName";

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
  H.state.lobCalls = [];
});

// ─── ground truth, in the simulation's shapes ───────────────────────────────
interface Truth {
  given: string; surname: string; ownerRaw: string; entity: boolean;
  mailAddr: string; mailCity: string; mailState: string; mailZip: string;
  situsAddr: string; situsCity: string; situsState: string; situsZip: string;
  county: string; apn: string; phones: string[]; email: string; dnc: boolean;
}
const SURNAMES = ["SMITH", "GARCIA", "NGUYEN", "O'BRIEN", "DE LA CRUZ", "THOMAS"];
const GIVEN = ["JOHN", "MARY", "ROBERT", "LINDA", "JOSE", "DOROTHY"];
const MAIL: Array<[string, string, string]> = [["CA", "LOS ANGELES", "90012"], ["NJ", "NEWARK", "07102"], ["MA", "BOSTON", "02108"], ["TX", "HOUSTON", "77002"]];
const SITUS: Array<[string, string, string, string]> = [["AZ", "COCHISE", "WILLCOX", "85643"], ["NM", "LUNA", "DEMING", "88030"], ["TX", "HUDSPETH", "SIERRA BLANCA", "79851"]];
function truths(n: number, opts: { phones?: boolean; dnc?: boolean } = {}): Truth[] {
  return Array.from({ length: n }, (_, i) => {
    const s = SURNAMES[i % SURNAMES.length];
    const g = GIVEN[(i * 5) % GIVEN.length];
    const entity = i % 9 === 4;
    const m = MAIL[i % MAIL.length];
    const p = SITUS[i % SITUS.length];
    return {
      given: entity ? "" : g,
      surname: entity ? `${s} FAMILY TRUST` : s,
      ownerRaw: entity ? `${s} FAMILY TRUST` : i % 3 === 0 ? `${s} ${g} & ${GIVEN[(i + 1) % GIVEN.length]}` : `${s} ${g}`,
      entity,
      mailAddr: i % 5 === 3 ? `PO BOX ${1000 + i}` : `${100 + i} N MAIN ST`,
      mailCity: m[1], mailState: m[0], mailZip: m[2],
      situsAddr: i % 4 === 0 ? "" : `${1000 + i} CHOLLA RD`,
      situsCity: p[2], situsState: p[0], situsZip: p[3],
      county: p[1],
      apn: `${100 + (i % 80)}-${String(10 + (i % 89)).padStart(2, "0")}-${String(i).padStart(4, "0")}`,
      // Some rows have only the SECOND phone column filled, some have both
      // (the first one is the lead's phone — never the last column's).
      phones: opts.phones && i % 4 !== 0
        ? i % 3 === 0
          ? ["", `(213) 556-${String(1000 + i).slice(-4)}`]
          : i % 5 === 2
            ? [`(602) 555-${String(1000 + i).slice(-4)}`, `(602) 557-${String(1000 + i).slice(-4)}`]
            : [`(602) 555-${String(1000 + i).slice(-4)}`]
        : [],
      email: i % 4 === 1 ? `owner${i}@example.net` : "",
      dnc: !!opts.dnc && i % 4 === 1,
    };
  });
}
const tc = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const toCsv = (h: string[], rows: string[][], o: { bom?: boolean; crlf?: boolean } = {}) =>
  (o.bom ? "﻿" : "") + [h, ...rows].map((r) => r.map(esc).join(",")).join(o.crlf ? "\r\n" : "\n") + (o.crlf ? "\r\n" : "\n");
const phoneOf = (t: Truth) => t.phones.find((p) => p) ?? "";

interface Fixture { name: string; csv: string; truth: Truth[] }
function fixtures(): Fixture[] {
  const f: Fixture[] = [];
  {
    const t = truths(24);
    const h = ["PARCEL_NUM", "OWNER_NAME", "MAIL_ADDR1", "MAIL_CITY", "MAIL_STATE", "MAIL_ZIP", "SITUS_ADDR", "SITUS_CITY", "SITUS_ZIP", "COUNTY", "ACRES", "LAND_USE"];
    f.push({ name: "county-parcel-export", truth: t, csv: toCsv(h, t.map((r) => [r.apn, r.ownerRaw, r.mailAddr, r.mailCity, r.mailState, r.mailZip, r.situsAddr, r.situsCity, r.situsZip, r.county, "2.50", "VACANT RESIDENTIAL"]), { bom: true, crlf: true }) });
  }
  {
    const t = truths(24, { phones: true });
    const h = ["Owner 1 First Name", "Owner 1 Last Name", "Mailing Address", "Mailing City", "Mailing State", "Mailing Zip", "Property Address", "Property City", "Property State", "Property Zip", "APN", "County", "Lot Acreage", "Phone 1", "Phone 2", "Email"];
    // The spreadsheet dropped the leading zero from New England / NJ ZIPs.
    f.push({ name: "list-broker-vacant-land", truth: t, csv: toCsv(h, t.map((r) => [r.entity ? "" : tc(r.given), tc(r.surname), r.mailAddr, tc(r.mailCity), r.mailState, r.mailZip.replace(/^0+/, ""), r.situsAddr, tc(r.situsCity), r.situsState, r.situsZip, r.apn, tc(r.county), "5", r.phones[0] ?? "", r.phones[1] ?? "", r.email]), { crlf: true }) });
  }
  {
    const t = truths(24, { phones: true });
    const h = ["Owner 1 Full Name", "Owner Mailing Address", "Owner Mailing City", "Owner Mailing State", "Owner Mailing Zip", "Address", "City", "State", "Zip", "County", "APN", "Lot Size Sqft", "Mobile Phone 1", "Landline 1", "Email 1"];
    f.push({ name: "propstream-style", truth: t, csv: toCsv(h, t.map((r) => [r.entity ? r.ownerRaw : `${tc(r.given)} ${tc(r.surname)}`, r.mailAddr, tc(r.mailCity), r.mailState, r.mailZip, r.situsAddr, tc(r.situsCity), r.situsState, r.situsZip, tc(r.county), r.apn, "43560", r.phones[0] ?? "", r.phones[1] ?? "", r.email])) });
  }
  {
    const t = truths(24);
    const h = ["Account #", "Parcel ID", "Owner", "Owner Address", "City State Zip", "Amount Due", "Years Delinquent", "County"];
    f.push({ name: "tax-delinquent-roll", truth: t, csv: toCsv(h, t.map((r, i) => [`ACCT-${20000 + i}`, r.apn, r.ownerRaw, r.mailAddr, `${r.mailCity} ${r.mailState} ${r.mailZip}`, "$210.00", "2", r.county]), { crlf: true }) });
  }
  {
    const t = truths(24, { phones: true, dnc: true });
    const h = ["First Name", "Last Name", "Mailing Address", "Mailing City", "Mailing State", "Mailing Zip", "Property Address", "Property County", "Property State", "APN", "Phone1", "Phone1 Type", "Phone1 DNC", "Phone2", "Phone2 Type", "Litigator", "Email1"];
    f.push({ name: "skip-traced-return", truth: t, csv: toCsv(h, t.map((r, i) => [r.entity ? "" : tc(r.given), r.entity ? r.ownerRaw : tc(r.surname), r.mailAddr, tc(r.mailCity), r.mailState, r.mailZip, r.situsAddr, tc(r.county), r.situsState, r.apn, r.phones[0] ?? "", r.phones[0] ? (i % 3 ? "Wireless" : "Landline") : "", r.dnc ? "Y" : "N", r.phones[1] ?? "", r.phones[1] ? "Wireless" : "", "N", r.email])) });
  }
  {
    // Larger than one request: the sheet must batch it, not fail it whole.
    const t = truths(1200, { phones: true });
    const h = ["APN", "Owner Name", "Mailing Address", "Mailing City", "Mailing State", "Mailing Zip", "Situs Address", "County", "State", "Acres", "Phone"];
    f.push({ name: "county-pull-large", truth: t, csv: toCsv(h, t.map((r, i) => [r.apn, r.ownerRaw + (i % 17 === 0 ? "   " : ""), r.mailAddr, r.mailCity, r.mailState, r.mailZip, r.situsAddr, r.county, r.situsState, "3", phoneOf(r)]), { bom: true, crlf: true }) });
  }
  return f;
}

/** What the sheet does: parse, auto-map, batch, POST. */
async function importViaSheet(csv: string) {
  const { headers, rows } = parseCsv(csv);
  const mapping = suggestMapping(headers);
  const mapped = rows.map((r) => mapCsvRow(headers, r, mapping));
  const totals = { imported: 0, skippedInvalid: 0, statuses: [] as number[] };
  for (const batch of chunkCsvImportRows(mapped)) {
    const res = await request(app).post("/api/leads/csv-import").send({ rows: batch.rows });
    totals.statuses.push(res.status);
    totals.imported += res.body.imported ?? 0;
    totals.skippedInvalid += res.body.skippedInvalid ?? 0;
  }
  return { mapping, totals };
}

const norm = (s: unknown) => String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
const leadFor = (t: Truth) => H.state.LEADS.find((l) => norm(l.apn) === norm(t.apn));

describe("each simulation fixture imports to the right fields", () => {
  for (const fx of fixtures()) {
    it(`${fx.name}: mailing block, situs, names, phones and DNC land where they belong`, async () => {
      const { totals } = await importViaSheet(fx.csv);
      expect(totals.statuses.every((s) => s === 200), `statuses ${totals.statuses}`).toBe(true);
      expect(totals.imported).toBe(fx.truth.length);

      for (const t of fx.truth) {
        const lead = leadFor(t);
        expect(lead, `no lead for ${t.apn}`).toBeTruthy();
        // 1. The block mail is addressed to is the owner's MAILING address.
        expect(norm(lead!.address), `${fx.name} ${t.apn} street`).toBe(norm(t.mailAddr));
        expect(norm(lead!.city), `${fx.name} ${t.apn} city`).toBe(norm(t.mailCity));
        expect(norm(lead!.state), `${fx.name} ${t.apn} state`).toBe(norm(t.mailState));
        expect(lead!.zip, `${fx.name} ${t.apn} zip`).toBe(t.mailZip);
        // ...and the parcel's situs is kept, separately, wherever the file has it.
        const fileHasSitus = fx.name !== "tax-delinquent-roll";
        if (fileHasSitus && t.situsAddr) expect(norm(lead!.propertyAddress)).toContain(norm(t.situsAddr));
        if (!t.situsAddr) expect(lead!.propertyAddress ?? null).toBeNull();
        // 2. Never greet the owner by surname.
        if (!t.entity) expect(norm(salutationName(lead!)), `${fx.name} "${t.ownerRaw}" greets`).not.toBe(norm(t.surname));
        if (t.entity) expect(lead!.firstName).toBe("");
        // 3. A phone in the file is a phone on the lead; a DNC flag is honoured.
        if (phoneOf(t)) expect(lead!.phone, `${fx.name} ${t.apn} phone`).toBe(phoneOf(t));
        expect(!!lead!.doNotContact, `${fx.name} ${t.apn} dnc`).toBe(t.dnc);
        // An import never grants consent.
        expect(lead!.tcpaConsent).toBe(false);
      }
    });
  }

  it("split first/last columns map to first/last; a lone county name is kept whole", async () => {
    const [county, broker] = fixtures();
    await importViaSheet(broker.csv);
    const person = broker.truth.find((t) => !t.entity)!;
    expect(norm(leadFor(person)!.firstName)).toBe(norm(person.given));
    expect(norm(leadFor(person)!.lastName)).toBe(norm(person.surname));
    H.state.LEADS = [];
    await importViaSheet(county.csv);
    const lastFirst = county.truth.find((t) => !t.entity && t.ownerRaw.includes("&"))!;
    expect(leadFor(lastFirst)!.firstName).toBe("");
    expect(norm(leadFor(lastFirst)!.lastName)).toBe(norm(lastFirst.ownerRaw));
  });
});

describe("the postcard goes to the owner's mailing address", () => {
  it("direct mail for an imported absentee owner is addressed to the mailing block, not the parcel", async () => {
    const fx = fixtures().find((f) => f.name === "list-broker-vacant-land")!;
    await importViaSheet(fx.csv);
    const t = fx.truth.find((x) => x.situsAddr && x.mailState !== x.situsState)!;
    const lead = leadFor(t)!;
    const r = await communicationsService.sendDirectMailToLead(lead.id, ORG_ID, { subject: "We buy land", body: "Offer" } as any);
    expect(r.success, String(r.error)).toBe(true);
    expect(H.state.lobCalls).toHaveLength(1);
    const to = H.state.lobCalls[0].to;
    expect(norm(to.addressLine1)).toBe(norm(t.mailAddr));
    expect(norm(to.city)).toBe(norm(t.mailCity));
    expect(norm(to.state)).toBe(norm(t.mailState));
    expect(to.zip).toBe(t.mailZip);
    expect(norm(to.addressLine1)).not.toBe(norm(t.situsAddr));
  });

  it("a lead the list flagged DNC is not mailed", async () => {
    const fx = fixtures().find((f) => f.name === "skip-traced-return")!;
    await importViaSheet(fx.csv);
    const t = fx.truth.find((x) => x.dnc)!;
    const r = await communicationsService.sendDirectMailToLead(leadFor(t)!.id, ORG_ID, { subject: "s", body: "b" } as any);
    expect(r.success).toBe(false);
    expect(H.state.lobCalls).toHaveLength(0);
  });
});

describe("a file over one request's limit", () => {
  it("is imported in full by the sheet's batches", async () => {
    const fx = fixtures().find((f) => f.name === "county-pull-large")!;
    const { totals } = await importViaSheet(fx.csv);
    expect(totals.statuses.length).toBe(Math.ceil(fx.truth.length / CSV_IMPORT_MAX_ROWS_PER_REQUEST));
    expect(H.state.LEADS).toHaveLength(fx.truth.length);
  });

  it("sent in one request, is refused with the limit and the way through, not 'Validation failed'", async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ lastName: `L${i}`, apn: `A-${i}` }));
    const res = await request(app).post("/api/leads/csv-import").send({ rows });
    expect(res.status).toBe(400);
    expect(res.body.message).not.toMatch(/^Validation failed$/);
    expect(res.body.message).toContain(String(CSV_IMPORT_MAX_ROWS_PER_REQUEST));
    expect(res.body.message).toMatch(/batches/);
    expect(H.state.LEADS).toHaveLength(0);
  });
});

describe("header-level mapping", () => {
  it.each([
    ["Owner Mailing Address", "address"],
    ["Mailing City", "city"],
    ["SITUS_ADDR", "propertyAddress"],
    ["Property Address", "propertyAddress"],
    ["Owner 1 First Name", "firstName"],
    ["Owner 1 Last Name", "lastName"],
    ["OWNER_NAME", "ownerName"],
    ["Phone1", "phone"],
    ["Phone (Cell)", "phone"],
    ["Mobile", "phone"],
    ["Landline 1", "phone"],
    ["Phone1 Type", "skip"],
    ["Phone1 DNC", "doNotContact"],
    ["DNC", "doNotContact"],
    ["Parcel #", "apn"],
    ["Property County", "county"],
  ])("%s → %s", (header, field) => {
    expect(suggestMapping([header])[header]).toBe(field);
  });

  it("a bare City/State/Zip is the property's when the file names the mailing ones", () => {
    const m = suggestMapping(["Owner Mailing Address", "Owner Mailing City", "Owner Mailing State", "Owner Mailing Zip", "Address", "City", "State", "Zip"]);
    expect([m["Address"], m["City"], m["State"], m["Zip"]]).toEqual(["propertyAddress", "propertyCity", "propertyState", "propertyZip"]);
    // ...and the mailing block when it does not.
    expect(suggestMapping(["Address", "City", "State", "Zip"]).City).toBe("city");
  });
});
