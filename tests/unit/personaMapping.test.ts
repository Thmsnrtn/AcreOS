import { describe, it, expect } from "vitest";
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_TO_PERSONA,
  BUSINESS_TYPE_TO_INVESTOR_TYPE,
  PERSONA_TO_BUSINESS_TYPE,
  derivePersona,
  personaToInvestorType,
  isBusinessType,
  type BusinessType,
} from "@shared/models/persona-mapping";
import type { Persona } from "@shared/models/auth";

const ALL_PERSONAS: Persona[] = [
  "land_investor",
  "note_investor",
  "note_originator",
  "note_servicer",
  "tax_delinquent",
  "wholesaler",
  "subdivider",
  "fix_flipper",
  "landlord",
];

describe("persona-mapping (shared source of truth)", () => {
  it("every businessType maps to a persona and an investorType", () => {
    expect(BUSINESS_TYPES).toHaveLength(15);
    for (const bt of BUSINESS_TYPES) {
      expect(BUSINESS_TYPE_TO_PERSONA[bt], `persona for ${bt}`).toBeDefined();
      expect(BUSINESS_TYPE_TO_INVESTOR_TYPE[bt], `investorType for ${bt}`).toBeDefined();
    }
  });

  it("every persona has a representative businessType that resolves back consistently", () => {
    for (const p of ALL_PERSONAS) {
      const bt = PERSONA_TO_BUSINESS_TYPE[p];
      expect(bt, `representative businessType for ${p}`).toBeDefined();
      const back = BUSINESS_TYPE_TO_PERSONA[bt];
      // note_* personas all share the single note_investor businessType (the
      // fine note-role distinction lives in users.persona, not businessType).
      if (p.startsWith("note_")) {
        expect(back).toBe("note_investor");
      } else {
        expect(back).toBe(p);
      }
    }
  });

  it("investorType fork: only hybrid is 'both', note_investor is 'notes', rest are 'land'", () => {
    expect(BUSINESS_TYPE_TO_INVESTOR_TYPE.hybrid).toBe("both");
    expect(BUSINESS_TYPE_TO_INVESTOR_TYPE.note_investor).toBe("notes");
    expect(BUSINESS_TYPE_TO_INVESTOR_TYPE.land_flipper).toBe("land");
    expect(BUSINESS_TYPE_TO_INVESTOR_TYPE.fix_and_flip).toBe("land");
  });

  it("derivePersona applies the note-role fork", () => {
    expect(derivePersona("note_investor", "notes", "invest")).toBe("note_investor");
    expect(derivePersona("note_investor", "notes", "originate")).toBe("note_originator");
    expect(derivePersona("note_investor", "notes", "service")).toBe("note_servicer");
    // note vertical wins off investorType even without note_investor businessType
    expect(derivePersona("land_flipper", "notes", "service")).toBe("note_servicer");
  });

  it("derivePersona maps non-note businessTypes and falls back safely", () => {
    expect(derivePersona("fix_and_flip")).toBe("fix_flipper");
    expect(derivePersona("buy_and_hold")).toBe("landlord");
    expect(derivePersona("subdivider")).toBe("subdivider");
    expect(derivePersona("short_term_rental")).toBe("landlord");
    expect(derivePersona(undefined)).toBe("land_investor");
    expect(derivePersona("garbage_value")).toBe("land_investor");
  });

  it("personaToInvestorType: note personas → notes, everything else → land", () => {
    expect(personaToInvestorType("note_investor")).toBe("notes");
    expect(personaToInvestorType("note_originator")).toBe("notes");
    expect(personaToInvestorType("note_servicer")).toBe("notes");
    expect(personaToInvestorType("land_investor")).toBe("land");
    expect(personaToInvestorType("fix_flipper")).toBe("land");
  });

  it("isBusinessType guards correctly", () => {
    expect(isBusinessType("fix_and_flip")).toBe(true);
    expect(isBusinessType("subdivider")).toBe(true);
    expect(isBusinessType("vacation_rental")).toBe(false); // the old drifted value
    expect(isBusinessType(undefined)).toBe(false);
    expect(isBusinessType(null)).toBe(false);
  });

  it("the non-clobber rule preserves a specific businessType that already matches the persona", () => {
    // Simulates the persona-PUT settings path: onboarding set short_term_rental
    // (persona landlord); a later persona change to landlord must NOT coarsen it
    // to buy_and_hold, because short_term_rental already collapses to landlord.
    const current: BusinessType = "short_term_rental";
    const persona: Persona = "landlord";
    const shouldPreserve = BUSINESS_TYPE_TO_PERSONA[current] === persona;
    expect(shouldPreserve).toBe(true);
  });
});
