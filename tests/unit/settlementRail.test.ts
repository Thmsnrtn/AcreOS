/**
 * Settlement & Documents Rail (P1-3 core + Notes transplant) — unit proof.
 *
 * What this pins:
 *   N-1  the payoff letter renders ONLY the recorded quote row's figures
 *        (letter ≡ quote by construction) and states the no-custody line
 *        when the lender gave no payment instructions of their own;
 *   N-2  the lien release names the parties + the original instrument and
 *        carries the satisfaction language; it is the recordable kind (its
 *        generation opens a recording row — S-2);
 *   S-1  certified/registered are priced surcharges on a LETTER's base key
 *        and still refused on a postcard (no recorded cost, no send);
 *   S-2  the recording workflow's transition table (instrument number is
 *        enforced in the service; the table itself is pinned here);
 *   S-3  the money-event variance read (received vs expected);
 *   L-2  mergeMailCopy merges a piece's OWN price into {offerPrice}/{price}
 *        only when a price is passed — every other caller is byte-identical;
 *   and the two books are told apart by id shape (integer = serviced,
 *   uuid = acquired), the disambiguation the whole transplant relies on.
 */
import { describe, it, expect } from "vitest";
import type { NotePayoffQuote } from "@shared/schema";
import {
  RAIL_DOCUMENT_KINDS,
  recordingTransitionAllowed,
} from "@shared/settlement-rail";
import {
  buildLienRelease,
  buildPayoffLetter,
} from "../../server/services/settlementRail/documents";
import { noteBookForId } from "../../server/services/settlementRail/payoffLetter";
import { moneyEventVarianceCents } from "../../server/services/settlementRail/moneyEvents";
import { mergeMailCopy } from "@shared/parcel/ownerName";
import {
  HOUSE_MAIL_EXTRA_SERVICE_COST_CENTS,
  houseMailBaseKey,
  houseMailExtraService,
} from "@shared/billing/house-mail-pricing";

function quoteFixture(overrides: Partial<NotePayoffQuote> = {}): NotePayoffQuote {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    organizationId: 7,
    noteSystem: "serviced_note",
    noteRef: "42",
    noteNumber: "N-1042",
    payerName: "Pat Borrower",
    quotedByUserId: null,
    channel: "operator_api",
    payoffDate: "2026-11-20",
    goodThroughDate: "2026-11-20",
    principalBalanceCents: 12_000_000,
    annualRateBpsHundredths: 85000,
    accrualStartDate: "2026-11-01",
    daysAccrued: 19,
    dayCountConvention: "actual/365",
    perDiemInterestCents: 2795,
    accruedInterestCents: 53_100,
    unappliedCreditCents: 0,
    lateFeesOutstandingCents: 2_500,
    payoffFeeCents: 0,
    totalPayoffCents: 12_055_600,
    engineVersion: "test",
    engineInputJson: {},
    notes: null,
    quotedAt: new Date("2026-11-12T00:00:00Z"),
    createdAt: new Date("2026-11-12T00:00:00Z"),
    ...overrides,
  } as NotePayoffQuote;
}

describe("noteBookForId — the two books by id shape", () => {
  it("integer ids are the serviced book, uuids the acquired book", () => {
    expect(noteBookForId("42")).toBe("serviced_note");
    expect(noteBookForId("11111111-2222-3333-4444-555555555555")).toBe("acquired_note");
  });
  it("anything else is neither book", () => {
    expect(noteBookForId("note-42")).toBeNull();
    expect(noteBookForId("")).toBeNull();
    expect(noteBookForId("4.2")).toBeNull();
  });
});

describe("N-1 payoff letter — figures are the recorded quote row's, verbatim", () => {
  const artifact = buildPayoffLetter({
    quote: quoteFixture(),
    lenderName: "Acme Note Fund LLC",
    borrowerName: null,
    propertyAddress: "12 Oak St, Austin, TX 78701",
    paymentInstructions: null,
  });

  it("renders the quote's own total, per-diem and dates", () => {
    expect(artifact.html).toContain("$120,556.00");
    expect(artifact.html).toContain("$27.95");
    expect(artifact.html).toContain("2026-11-20");
    expect(artifact.html).toContain("Pat Borrower"); // falls back to the quote's recorded payer
    expect(artifact.html).toContain("N-1042");
  });

  it("shows each breakdown line from the row, including the late fees", () => {
    expect(artifact.html).toContain("$120,000.00"); // principal
    expect(artifact.html).toContain("$531.00"); // accrued interest
    expect(artifact.html).toContain("$25.00"); // late fees
  });

  it("states the no-custody line when the lender supplied no instructions", () => {
    expect(artifact.html).toContain("AcreOS does not receive or hold payoff funds");
  });

  it("uses the lender's own instructions verbatim when supplied", () => {
    const withInstructions = buildPayoffLetter({
      quote: quoteFixture(),
      lenderName: "Acme Note Fund LLC",
      borrowerName: "Pat Borrower",
      propertyAddress: null,
      paymentInstructions: "Wire to Acme Note Fund, account on file with escrow.",
    });
    expect(withInstructions.html).toContain("Wire to Acme Note Fund, account on file with escrow.");
    expect(withInstructions.html).not.toContain("AcreOS does not receive or hold payoff funds");
  });

  it("produces a real PDF artifact named for the note + quote", () => {
    expect(artifact.pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(artifact.filename).toBe("payoff-letter-42-11111111-2222-3333-4444-555555555555.pdf");
    expect(artifact.kind).toBe("payoff_letter");
  });
});

describe("N-2 lien release — the satisfaction paper", () => {
  const artifact = buildLienRelease({
    lenderName: "Acme Note Fund LLC",
    borrowerName: "Pat Borrower",
    propertyAddress: "12 Oak St, Austin, TX 78701",
    legalDescription: "Lot 4, Block B, Oak Hills",
    county: "Travis",
    state: "TX",
    originalInstrumentNumber: "2021-0044177",
    originalRecordingDate: "2021-03-04",
    noteDate: "2021-03-01",
    payoffDate: "2026-11-20",
  });

  it("names the parties, the property and the original instrument", () => {
    expect(artifact.html).toContain("Pat Borrower");
    expect(artifact.html).toContain("Acme Note Fund LLC");
    expect(artifact.html).toContain("2021-0044177");
    expect(artifact.html).toContain("Travis County");
    expect(artifact.html).toContain("Lot 4, Block B, Oak Hills");
  });

  it("carries the satisfaction + release language and the payoff date", () => {
    expect(artifact.html).toContain("SATISFIED IN FULL");
    expect(artifact.html).toContain("RELEASED");
    expect(artifact.html).toContain("2026-11-20");
  });

  it("is a PDF artifact", () => {
    expect(artifact.pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("the shared vocabulary is exactly the two built kinds", () => {
    // Generator coverage of this vocabulary is enforced at module load in
    // documents.ts (it throws if a kind has no generator) — importing the
    // builders above already exercised that check.
    expect([...RAIL_DOCUMENT_KINDS].sort()).toEqual(["lien_release", "payoff_letter"]);
  });
});

describe("S-2 recording transitions", () => {
  it("admits the workflow and refuses the shortcuts", () => {
    expect(recordingTransitionAllowed("prepared", "sent_for_recording")).toBe(true);
    expect(recordingTransitionAllowed("prepared", "recorded")).toBe(true);
    expect(recordingTransitionAllowed("sent_for_recording", "recorded")).toBe(true);
    expect(recordingTransitionAllowed("sent_for_recording", "rejected")).toBe(true);
    expect(recordingTransitionAllowed("rejected", "prepared")).toBe(true);
    expect(recordingTransitionAllowed("prepared", "rejected")).toBe(false);
    expect(recordingTransitionAllowed("rejected", "recorded")).toBe(false);
  });
  it("recorded is terminal", () => {
    for (const to of ["prepared", "sent_for_recording", "recorded", "rejected"] as const) {
      expect(recordingTransitionAllowed("recorded", to)).toBe(false);
    }
  });
});

describe("S-3 money-event variance", () => {
  it("is received minus expected, and null with nothing to reconcile against", () => {
    expect(moneyEventVarianceCents({ amountCents: 9_600, expectedAmountCents: 10_000 })).toBe(-400);
    expect(moneyEventVarianceCents({ amountCents: 10_000, expectedAmountCents: 10_000 })).toBe(0);
    expect(moneyEventVarianceCents({ amountCents: 10_000, expectedAmountCents: null })).toBeNull();
  });
});

describe("S-1 certified mail pricing shape", () => {
  it("a letter with certified keeps its base key and reads the surcharge table", () => {
    const spec = { kind: "letter", color: false, pages: 1, extraService: "certified" } as const;
    expect(houseMailBaseKey(spec)).toBe("letter_bw");
    expect(houseMailExtraService(spec)).toBe("certified");
    expect(HOUSE_MAIL_EXTRA_SERVICE_COST_CENTS.certified).toBe(695);
    expect(HOUSE_MAIL_EXTRA_SERVICE_COST_CENTS.registered).toBe(2450);
  });
  it("a postcard with an extra service is still refused (null base key)", () => {
    expect(houseMailBaseKey({ kind: "postcard", size: "4x6", extraService: "certified" })).toBeNull();
  });
  it("an unknown extra service is not priced", () => {
    expect(houseMailExtraService({ kind: "letter", extraService: "express" })).toBeNull();
    expect(houseMailBaseKey({ kind: "letter", extraService: "express" })).toBeNull();
  });
});

describe("L-2 mergeMailCopy price merge", () => {
  const copy = "Dear {firstName}, we will pay {offerPrice} for your land in {city}, {state}.";
  it("merges the piece's own price when one is passed", () => {
    const merged = mergeMailCopy(copy, { name: "Pat Borrower", city: "Austin", state: "TX", price: "$12,500" }, { html: true });
    expect(merged).toContain("$12,500");
    expect(merged).not.toContain("{offerPrice}");
    expect(merged).toContain("Austin, TX");
  });
  it("leaves the price tokens untouched for callers that pass no price (unchanged behaviour)", () => {
    const merged = mergeMailCopy(copy, { name: "Pat Borrower", city: "Austin", state: "TX" }, { html: true });
    expect(merged).toContain("{offerPrice}");
  });
});
