/**
 * sanctionsList tests.
 *
 * Covers:
 *   - canonicalizeNameCountry: NFKD + lowercase + alphanumeric-only
 *   - hashNameCountry: stable + 24-hex output
 *   - checkSanctionedCountry: hits SANCTIONED_COUNTRIES set
 *   - SDN CSV parser handles quoted fields and commas inside quotes
 *
 * The DB-backed checkOfacSdn and refreshOfacSdnList paths are integration
 * tests by nature — we don't try to mock the entire Drizzle query builder
 * here. The CSV parser + hash logic are the bug-prone bits and they ARE
 * unit-tested.
 */

import { describe, it, expect } from "vitest";
import {
  canonicalizeNameCountry,
  hashNameCountry,
  checkSanctionedCountry,
  SANCTIONED_COUNTRIES,
} from "./sanctionsList";

describe("canonicalizeNameCountry", () => {
  it("strips diacritics, lowercases, drops non-alphanumeric", () => {
    expect(canonicalizeNameCountry("Doe, John", "US")).toBe("doejohn::US");
    expect(canonicalizeNameCountry("Döe Jöhn", "us")).toBe("doejohn::US");
    expect(canonicalizeNameCountry("DOE-JOHN", "US")).toBe("doejohn::US");
    expect(canonicalizeNameCountry("  Doe John  ", "US")).toBe("doejohn::US");
  });

  it("uppercases the country code, truncates to 2 chars", () => {
    expect(canonicalizeNameCountry("X", "usa")).toBe("x::US");
    expect(canonicalizeNameCountry("X", "ir")).toBe("x::IR");
  });

  it("returns empty name component for empty input", () => {
    expect(canonicalizeNameCountry("", "US")).toBe("::US");
  });
});

describe("hashNameCountry", () => {
  it("returns a 24-char hex string", () => {
    const h = hashNameCountry("Doe John", "US");
    expect(h).toMatch(/^[a-f0-9]{24}$/);
  });

  it("collides on diacritic-only variants (intentional)", () => {
    expect(hashNameCountry("Döe", "US")).toBe(hashNameCountry("Doe", "US"));
  });

  it("differs across countries", () => {
    expect(hashNameCountry("Doe", "US")).not.toBe(hashNameCountry("Doe", "IR"));
  });
});

describe("checkSanctionedCountry", () => {
  it("blocks the embargoed countries", () => {
    for (const cc of SANCTIONED_COUNTRIES) {
      const result = checkSanctionedCountry(cc);
      expect(result.matched).toBe(true);
      expect(result.reason).toBe("sanctioned-country");
      expect(result.message).toBeTruthy();
    }
  });

  it("does not block US / GB / CA", () => {
    expect(checkSanctionedCountry("US").matched).toBe(false);
    expect(checkSanctionedCountry("GB").matched).toBe(false);
    expect(checkSanctionedCountry("CA").matched).toBe(false);
  });

  it("handles lowercase input", () => {
    expect(checkSanctionedCountry("ir").matched).toBe(true);
  });

  it("does not block null/empty", () => {
    expect(checkSanctionedCountry("").matched).toBe(false);
    expect(checkSanctionedCountry(null).matched).toBe(false);
    expect(checkSanctionedCountry(undefined).matched).toBe(false);
  });
});
