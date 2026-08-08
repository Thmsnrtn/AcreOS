// Pins the residential-wholesaler deal lifecycle emitters (audit Wave 1,
// beta→core): the two wired wholesaler templates were dead until this emitter
// shipped, so this test fixes the new truth — the events fire on the REAL
// operator transitions the templates handle (deal → in_escrow = a signed
// purchase agreement; contract_assignments → sent_for_signature), carry only
// real columns (no fabricated comp/asking/buyer-price fields), pass nullable
// columns through as null (never a fabricated 0), and no-op on everything else.
// Fire-and-forget: a throwing engine never propagates.
import { afterEach, describe, expect, it, vi } from "vitest";

const { emitWholesaleDealEvent } = vi.hoisted(() => ({
  emitWholesaleDealEvent: vi.fn(),
}));
vi.mock("../../server/services/workflow-engine", () => ({ emitWholesaleDealEvent }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  emitContractSigned,
  emitAssignmentPending,
} from "../../server/services/wholesaleEvents";

const TODAY = new Date().toISOString().slice(0, 10);

const deal = {
  id: 501,
  organizationId: 7,
  status: "in_escrow",
  acceptedAmount: "185000", // numeric column comes back as a string
  closingDate: new Date("2026-09-15T00:00:00Z"),
};

const dealCtx = { propertyAddress: "1247 Cherokee Pl" };

const assignment = {
  id: 88,
  organizationId: 7,
  dealId: 501,
  status: "sent_for_signature",
  assignmentFeeCents: 1_500_000, // $15,000
  endBuyerName: "Ari Cash Buyer LLC",
  originalContractDate: "2026-08-01",
};

const assignmentCtx = { propertyAddress: "1247 Cherokee Pl", state: "TN" };

afterEach(() => emitWholesaleDealEvent.mockReset());

describe("emitContractSigned", () => {
  it("fires deal.contract_signed on a genuine accepted→in_escrow transition, real fields only", () => {
    emitContractSigned("accepted", deal, dealCtx);
    expect(emitWholesaleDealEvent).toHaveBeenCalledTimes(1);
    const [event, orgId, entityId, data] = emitWholesaleDealEvent.mock.calls[0];
    expect(event).toBe("deal.contract_signed");
    expect(orgId).toBe(7);
    expect(entityId).toBe(501); // entityId is the deals.id
    expect(data.dealId).toBe(501);
    expect(data.propertyAddress).toBe("1247 Cherokee Pl");
    expect(data.contractPrice).toBe(185000); // the accepted purchase price, numeric-parsed
    expect(data.closingDate).toBe("2026-09-15"); // timestamp → ISO day
    expect(data.contractDate).toBe(TODAY); // the transition IS happening now
    // No fabricated comp/asking/fee fields leak into the payload.
    expect(data.compArv).toBeUndefined();
    expect(data.askingPrice).toBeUndefined();
    expect(data.assignmentFee).toBeUndefined();
  });

  it("no-ops on in_escrow→in_escrow, non-escrow edits, and no pre-image", () => {
    emitContractSigned("in_escrow", deal, dealCtx); // already in escrow → no re-fire
    emitContractSigned("accepted", { ...deal, status: "closed" }, dealCtx); // different target
    emitContractSigned("negotiating", { ...deal, status: "offer_sent" }, dealCtx); // unrelated
    expect(emitWholesaleDealEvent).not.toHaveBeenCalled();
  });

  it("passes null (never a fabricated 0/date) when the money/closing columns are absent", () => {
    emitContractSigned("accepted", {
      ...deal,
      acceptedAmount: null,
      closingDate: null,
    }, dealCtx);
    const [, , , data] = emitWholesaleDealEvent.mock.calls[0];
    expect(data.contractPrice).toBeNull();
    expect(data.closingDate).toBeNull();
  });

  it("passes a null propertyAddress through (never a fabricated address)", () => {
    emitContractSigned("accepted", deal, { propertyAddress: null });
    const [, , , data] = emitWholesaleDealEvent.mock.calls[0];
    expect(data.propertyAddress).toBeNull();
  });

  it("does not propagate a throwing engine (fire-and-forget)", () => {
    emitWholesaleDealEvent.mockImplementationOnce(() => {
      throw new Error("engine down");
    });
    expect(() => emitContractSigned("accepted", deal, dealCtx)).not.toThrow();
  });
});

describe("emitAssignmentPending", () => {
  it("fires deal.assignment_pending on a genuine →sent_for_signature transition, real fields only", () => {
    emitAssignmentPending("doc_generated", assignment, assignmentCtx);
    expect(emitWholesaleDealEvent).toHaveBeenCalledTimes(1);
    const [event, orgId, entityId, data] = emitWholesaleDealEvent.mock.calls[0];
    expect(event).toBe("deal.assignment_pending");
    expect(orgId).toBe(7);
    expect(entityId).toBe(501); // entityId is the DEAL the assignment hangs off
    expect(data.assignmentId).toBe(88);
    expect(data.dealId).toBe(501);
    expect(data.propertyAddress).toBe("1247 Cherokee Pl");
    expect(data.state).toBe("TN");
    expect(data.assignmentFee).toBe(15000); // cents → dollars, real column
    expect(data.buyerName).toBe("Ari Cash Buyer LLC"); // real end_buyer_name
    expect(data.originalContractDate).toBe("2026-08-01");
    // No fabricated buyer-entity/price fields leak into the payload.
    expect(data.buyerEntity).toBeUndefined();
    expect(data.buyerPrice).toBeUndefined();
  });

  it("no-ops on sent_for_signature→sent_for_signature and non-target edits", () => {
    emitAssignmentPending("sent_for_signature", assignment, assignmentCtx); // already sent → no re-fire
    emitAssignmentPending("draft", { ...assignment, status: "signed" }, assignmentCtx); // different target
    emitAssignmentPending("draft", { ...assignment, status: "doc_generated" }, assignmentCtx); // unrelated
    expect(emitWholesaleDealEvent).not.toHaveBeenCalled();
  });

  it("passes null (never a fabricated name/0) when the end buyer is a linked profile with no free-text name", () => {
    emitAssignmentPending("doc_generated", {
      ...assignment,
      endBuyerName: null,
      assignmentFeeCents: null,
      originalContractDate: null,
    }, assignmentCtx);
    const [, , , data] = emitWholesaleDealEvent.mock.calls[0];
    expect(data.buyerName).toBeNull();
    expect(data.assignmentFee).toBeNull();
    expect(data.originalContractDate).toBeNull();
  });

  it("does not propagate a throwing engine (fire-and-forget)", () => {
    emitWholesaleDealEvent.mockImplementationOnce(() => {
      throw new Error("engine down");
    });
    expect(() =>
      emitAssignmentPending("doc_generated", assignment, assignmentCtx),
    ).not.toThrow();
  });
});
