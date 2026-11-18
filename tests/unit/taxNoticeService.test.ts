/**
 * T-P1 (P3-2 Tax transplant) — SERVICE-level proof for the rail's tax
 * redemption notice (server/services/settlementRail/taxNotice.ts), driving
 * the REAL service against an in-memory db (the settlementRailServices
 * pattern). Only the db edge and the mail delivery lane are faked; the
 * procedure read, the tax-calendar read, the amount engine and the gate
 * are the real functions.
 *
 *   1. A mail-lane send is WITNESSED: the tax_events entry is written only
 *      after the provider accepted, and carries the provider's receipt
 *      (sentViaRail, providerId) citing the procedure object.
 *   2. A gate refusal (no recorded notice requirements) fires BEFORE any
 *      delivery attempt and writes nothing.
 *   3. The no-encoded-rule refusal (amount not determinable) likewise
 *      sends and records nothing; an operator-supplied county amount with
 *      its source clears it.
 *   4. A download drafts the artifact and records NOTHING as sent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Op = "select" | "insert" | "update";
interface DbCall {
  op: Op;
  table: unknown;
  values?: unknown;
  set?: Record<string, unknown>;
}

const fake = vi.hoisted(() => {
  const state = {
    calls: [] as DbCall[],
    selectRows: new Map<unknown, unknown[]>(),
    insertReturning: new Map<unknown, unknown[]>(),
    updateReturning: new Map<unknown, (patch: Record<string, unknown>) => unknown[]>(),
  };
  return state;
});

vi.mock("../../server/db", () => {
  function builder(resolve: () => unknown[]) {
    const b: Record<string, unknown> = {};
    const self = () => b;
    for (const m of ["where", "orderBy", "limit", "returning", "innerJoin", "leftJoin"]) b[m] = self;
    b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve().then(resolve).then(ok, bad);
    return b;
  }
  const db = {
    select: vi.fn(() => ({
      from: (table: unknown) => {
        fake.calls.push({ op: "select", table });
        return builder(() => (fake.selectRows.get(table) ?? []).map((r) => ({ ...(r as object) })));
      },
    })),
    insert: vi.fn((table: unknown) => ({
      values: (values: unknown) => {
        fake.calls.push({ op: "insert", table, values });
        return builder(() => fake.insertReturning.get(table) ?? [{ id: "evt-1", ...(values as object) }]);
      },
    })),
    update: vi.fn((table: unknown) => ({
      set: (patch: Record<string, unknown>) => {
        fake.calls.push({ op: "update", table, set: patch });
        return builder(() => fake.updateReturning.get(table)?.(patch) ?? [{ ...patch }]);
      },
    })),
  };
  return { db };
});

vi.mock("../../server/services/settlementRail/delivery", () => ({
  deliverRailLetterByMail: vi.fn(),
  RailDeliveryRefusedError: class extends Error {},
}));

import { organizations, taxCertificates, taxEvents, taxProcedureObjects } from "@shared/schema";
import { sendTaxRedemptionNotice, TaxNoticeRefusedError } from "../../server/services/settlementRail/taxNotice";
import { deliverRailLetterByMail } from "../../server/services/settlementRail/delivery";

const ORG = 7;
const CERT_ID = "22222222-3333-4444-5555-666666666666";

function certRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CERT_ID,
    organizationId: ORG,
    state: "FL",
    county: "Hillsborough",
    apn: "A-12-34-56",
    certificateNumber: "2024-1187",
    saleType: "lien",
    saleDate: "2024-06-01",
    purchaseAmountCents: 120_000,
    bidDownRateBps: null,
    ownerName: "Pat Owner",
    ownerAddress: { line1: "12 Palm Way", city: "Tampa", state: "FL", zip: "33602" },
    redemptionDeadline: "2027-06-01",
    deadlineSource: "computed_preliminary",
    status: "active",
    ...overrides,
  };
}

function procedureRow(fields: Record<string, unknown>) {
  return {
    id: "proc-1",
    organizationId: ORG,
    state: "FL",
    county: "Hillsborough",
    version: 3,
    fields,
    countyVerification: { completedOn: "2026-06-02", completedBy: "user-1", method: "called the county tax office" },
    recordedBy: "user-1",
    recordedAt: new Date("2026-06-02T00:00:00Z"),
  };
}

const NOTICE_FIELD = {
  value: "Notify the owner of record by certified mail at least 60 days before the redemption deadline.",
  source: "Fla. Stat. §197.522",
  asOf: "2026-06-01",
  basis: "state_law",
  verification: "checked_against_statute",
};

const callsOn = (op: Op, table: unknown) => fake.calls.filter((c) => c.op === op && c.table === table);
const deliverMock = vi.mocked(deliverRailLetterByMail);

beforeEach(() => {
  fake.calls.length = 0;
  fake.selectRows.clear();
  fake.insertReturning.clear();
  fake.updateReturning.clear();
  vi.clearAllMocks();
  fake.selectRows.set(organizations, [{ name: "Sunshine Lien Holdings LLC" }]);
  fake.selectRows.set(taxCertificates, [certRow()]);
  fake.selectRows.set(taxProcedureObjects, [procedureRow({ noticeRequirements: NOTICE_FIELD })]);
  fake.selectRows.set(taxEvents, []);
  deliverMock.mockResolvedValue({ lane: "certified_mail", providerId: "ltr_9", testMode: true, alreadySent: false, expectedDeliveryDate: null });
});

describe("T-P1 service — witnessed send", () => {
  it("mails through the rail and records the send FROM the provider receipt", async () => {
    const result = await sendTaxRedemptionNotice({
      organizationId: ORG,
      certificateId: CERT_ID,
      lane: "certified_mail",
      recordedByUserId: "user-1",
    });
    expect(result.delivery).toMatchObject({ providerId: "ltr_9", lane: "certified_mail" });
    expect(result.artifact.kind).toBe("tax_redemption_notice");
    expect(deliverMock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deliverMock).mock.calls[0][0].idempotencyKey).toContain(CERT_ID);
    expect(vi.mocked(deliverMock).mock.calls[0][0].recipient.name).toBe("Pat Owner");

    const inserts = callsOn("insert", taxEvents);
    expect(inserts).toHaveLength(1);
    const values = inserts[0].values as { eventType: string; ruleCited: Record<string, unknown>; detail: Record<string, unknown> };
    expect(values.eventType).toBe("redemption_notice_recorded");
    expect(values.ruleCited).toMatchObject({ kind: "procedure_object", field: "noticeRequirements", version: 3, source: "Fla. Stat. §197.522" });
    expect(values.detail).toMatchObject({ sentViaRail: true, providerId: "ltr_9", testMode: true, amountBasis: "computed_preliminary" });
  });

  it("a download drafts the notice and records nothing as sent", async () => {
    const result = await sendTaxRedemptionNotice({
      organizationId: ORG,
      certificateId: CERT_ID,
      lane: "download",
      recordedByUserId: "user-1",
    });
    expect(result.delivery).toBeNull();
    expect(result.artifact.pdf.length).toBeGreaterThan(0);
    expect(deliverMock).not.toHaveBeenCalled();
    expect(callsOn("insert", taxEvents)).toHaveLength(0);
  });
});

describe("T-P1 service — refusals send nothing and record nothing", () => {
  it("no recorded notice requirements → refusal before any delivery", async () => {
    fake.selectRows.set(taxProcedureObjects, [procedureRow({})]);
    await expect(
      sendTaxRedemptionNotice({ organizationId: ORG, certificateId: CERT_ID, lane: "certified_mail", recordedByUserId: "user-1" }),
    ).rejects.toMatchObject({ name: "TaxNoticeRefusedError", reason: "notice_requirements_not_recorded" });
    expect(deliverMock).not.toHaveBeenCalled();
    expect(callsOn("insert", taxEvents)).toHaveLength(0);
  });

  it("no encoded rule and no county amount → amount refusal; with the county amount + source it sends", async () => {
    fake.selectRows.set(taxCertificates, [certRow({ state: "WY", county: "Laramie" })]);
    fake.selectRows.set(taxProcedureObjects, [procedureRow({ noticeRequirements: NOTICE_FIELD })]);
    await expect(
      sendTaxRedemptionNotice({ organizationId: ORG, certificateId: CERT_ID, lane: "mail", recordedByUserId: "user-1" }),
    ).rejects.toMatchObject({ name: "TaxNoticeRefusedError", reason: "amount_not_determinable" });
    expect(deliverMock).not.toHaveBeenCalled();
    expect(callsOn("insert", taxEvents)).toHaveLength(0);

    const ok = await sendTaxRedemptionNotice({
      organizationId: ORG,
      certificateId: CERT_ID,
      lane: "mail",
      recordedByUserId: "user-1",
      operatorAmountCents: 130_500,
      operatorAmountSource: "county payoff quote dated 2026-11-10",
    });
    expect(ok.amountCents).toBe(130_500);
    expect(deliverMock).toHaveBeenCalledTimes(1);
    const inserts = callsOn("insert", taxEvents);
    expect(inserts).toHaveLength(1);
    expect((inserts[0].values as { detail: Record<string, unknown> }).detail).toMatchObject({ amountBasis: "operator_supplied", amountCents: 130_500 });
  });

  it("an unknown certificate is a refusal, not a send", async () => {
    fake.selectRows.set(taxCertificates, []);
    await expect(
      sendTaxRedemptionNotice({ organizationId: ORG, certificateId: CERT_ID, lane: "download", recordedByUserId: "user-1" }),
    ).rejects.toBeInstanceOf(TaxNoticeRefusedError);
    expect(deliverMock).not.toHaveBeenCalled();
  });
});
