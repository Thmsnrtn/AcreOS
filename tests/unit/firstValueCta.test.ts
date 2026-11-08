/**
 * D11 front-door fix 2 — who is presented Today's first-value CTA, and what
 * it says. The browser proof (it is on the first screen, it opens the
 * note-tape import, it leaves once a note exists) is
 * tests/e2e-mobile/today-first-value-cta.spec.ts; this pins the decision.
 */
import { describe, expect, it } from "vitest";
import { FIRST_TAPE_CTA, firstValueCtaFor } from "../../client/src/components/today/FirstValueCta";

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
