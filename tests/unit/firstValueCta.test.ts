/**
 * D11 front-door fix 2 — who is presented Today's first-value CTA, and what
 * it says. The browser proof (it is on the first screen, it opens the
 * note-tape import, it leaves once a note exists) is
 * tests/e2e-mobile/today-first-value-cta.spec.ts; this pins the decision.
 */
import { describe, expect, it } from "vitest";
import { FIRST_OFFER_CTA, FIRST_TAPE_CTA, firstOfferCtaFor, firstValueCtaFor } from "../../client/src/components/today/FirstValueCta";

describe("firstValueCtaFor", () => {
  it("presents the pinned copy, verbatim, to a note investor with an empty book", () => {
    const cta = firstValueCtaFor("note_investor", 0);
    expect(cta).not.toBeNull();
    // Pinned by UI design §4.1 — a paraphrase here means the product copy drifted.
    expect(cta!.label).toBe("Import your first tape");
    // /notes?action=new opens NotesImportDialog with intent "acquired": the note-tape import.
    expect(cta!.href).toBe("/notes?action=new");
  });

  it("is gone once one acquired note is on the book", () => {
    expect(firstValueCtaFor("note_investor", 1)).toBeNull();
    expect(firstValueCtaFor("note_investor", 250)).toBeNull();
  });

  it("never flashes before the book's size is known", () => {
    expect(firstValueCtaFor("note_investor", undefined)).toBeNull();
    expect(firstValueCtaFor("note_investor", null)).toBeNull();
  });

  it("is not presented to any other persona", () => {
    for (const persona of [
      "land_investor",
      "land_flipper",
      "wholesaler",
      "subdivider",
      "note_originator",
      "note_servicer",
      "tax_delinquent",
      undefined,
      null,
    ]) {
      expect(firstValueCtaFor(persona as string | undefined, 0), String(persona)).toBeNull();
    }
  });

  it("makes no experience claim (D17) and names no send (D6)", () => {
    expect(FIRST_TAPE_CTA.label).not.toMatch(/investors like you|\d|success|send|email/i);
  });
});

describe("firstOfferCtaFor (land)", () => {
  it("presents the pinned copy and the wizard to a land flipper with no offer", () => {
    expect(firstOfferCtaFor("land_investor", "land_flipper", false)).toEqual({
      label: "Make your first offer",
      href: "/blind-offer-wizard",
    });
    expect(firstOfferCtaFor("land_investor", "hybrid", false)).toBe(FIRST_OFFER_CTA);
  });
  it("is gone once an offer exists, and never flashes before it is known", () => {
    expect(firstOfferCtaFor("land_investor", "land_flipper", true)).toBeNull();
    expect(firstOfferCtaFor("land_investor", "land_flipper", undefined)).toBeNull();
  });
  it("is not presented to other business types or personas", () => {
    for (const bt of ["note_investor", "residential_wholesaler", "commercial", "agent_investor", "fix_and_flip", undefined]) {
      expect(firstOfferCtaFor("land_investor", bt, false), String(bt)).toBeNull();
    }
    for (const persona of ["note_investor", "wholesaler", undefined]) {
      expect(firstOfferCtaFor(persona, "land_flipper", false), String(persona)).toBeNull();
    }
  });
});
