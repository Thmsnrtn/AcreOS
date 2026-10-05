/**
 * W10.3 — the owner-type classifier the county list builder filters with
 * (shared/parcel/ownerName.ts). County layers carry one owner-name string and
 * no type column, so the type is READ from the name; the rule must never
 * disagree with splitOwnerName about whether an owner is a person.
 */
import { describe, expect, it } from "vitest";
import { OWNER_TYPES, classifyOwnerType, splitOwnerName } from "@shared/parcel/ownerName";

describe("classifyOwnerType", () => {
  it.each([
    ["JOHN SMITH", "individual"],
    ["SMITH, JOHN", "individual"],
    ["SMITH JOHN ET AL", "individual"],
    ["BOB & ANN LEE", "individual"],
    ["SMITH FAMILY TRUST", "trust"],
    ["JOHN DOE TR", "trust"],
    ["JONES TRUSTEES", "trust"],
    ["ESTATE OF MARY JONES", "estate"],
    ["JONES MARY EST", "estate"],
    ["HEIRS OF R LOPEZ", "estate"],
    ["ACME LAND LLC", "entity"],
    ["FIRST TRUST CO", "entity"],
    ["REAL ESTATE HOLDINGS INC", "entity"],
    ["COUNTY OF HARRIS", "entity"],
    ["DOUBLE R RANCH", "entity"],
    ["SMITH RANCH TRUST", "trust"],
  ] as const)("%s → %s", (name, type) => {
    expect(classifyOwnerType(name)).toBe(type);
  });

  it.each([
    // Trailing punctuation per word, and dotted abbreviations.
    ["ACME LAND LLC.", "entity"],
    ["ACME LAND L.L.C", "entity"],
    ["ACME LAND L.L.C.", "entity"],
    ["ACME LAND, LLC", "entity"],
    ["BIG SKY INC.,", "entity"],
    ["ROCKY RIDGE L.P.", "entity"],
    ["JOHN DOE TR.", "trust"],
    ["MARY JONES EST.", "estate"],
    // Trustee tokens.
    ["JOHN DOE TTEE", "trust"],
    ["DOE JOHN & JANE TTEES", "trust"],
    ["JOHN DOE TRS", "trust"],
    ["JANE DOE CO-TRUSTEE", "trust"],
    ["JOHN AND JANE DOE CO-TRUSTEES", "trust"],
    // Government and institutions.
    ["USA", "entity"],
    ["UNITED STATES OF AMERICA", "entity"],
    ["TEXAS DEPT OF TRANSPORTATION", "entity"],
    ["DEPARTMENT OF NATURAL RESOURCES", "entity"],
    ["TOWN OF FAIRVIEW", "entity"],
    ["VILLAGE OF OAK PARK", "entity"],
    ["BOROUGH OF STATE COLLEGE", "entity"],
    ["COUNTY OF TRAVIS", "entity"],
    ["STATE OF TEXAS", "entity"],
    ["CITY OF AUSTIN", "entity"],
    ["TEXAS A&M UNIVERSITY", "entity"],
    ["LAKE TRAVIS SCHOOL DIST", "entity"],
    ["GAME AND FISH COMMISSION", "entity"],
    ["BOARD OF REGENTS", "entity"],
    // A surname that merely CONTAINS a token is still a person.
    ["JOHN TOWNSEND", "individual"],
    ["MARY BOARDMAN", "individual"],
    ["SAM USADA", "individual"],
  ] as const)("%s → %s", (name, type) => {
    expect(classifyOwnerType(name)).toBe(type);
  });

  it("every new non-person token also gets no first name from splitOwnerName (the two rules agree)", () => {
    for (const n of [
      "ACME LAND LLC.", "ACME LAND L.L.C", "JOHN DOE TTEE", "JANE DOE CO-TRUSTEE", "JOHN DOE TRS", "USA",
      "UNITED STATES OF AMERICA", "TEXAS DEPT OF TRANSPORTATION", "TOWN OF FAIRVIEW", "VILLAGE OF OAK PARK",
      "BOROUGH OF STATE COLLEGE", "TEXAS A&M UNIVERSITY", "LAKE TRAVIS SCHOOL DIST", "GAME AND FISH COMMISSION",
      "BOARD OF REGENTS",
    ]) {
      expect(classifyOwnerType(n), n).not.toBe("individual");
      expect(splitOwnerName(n).firstName, n).toBe("");
    }
  });

  it("an empty owner is unknown — never an individual", () => {
    for (const blank of ["", "   ", null, undefined]) expect(classifyOwnerType(blank)).toBeNull();
  });

  it("every type it returns is in the vocabulary", () => {
    for (const n of ["A B", "X TRUST", "X ESTATE", "X LLC"]) expect(OWNER_TYPES).toContain(classifyOwnerType(n));
  });

  it("agrees with splitOwnerName: a non-individual owner never gets a first name", () => {
    const names = [
      "SMITH FAMILY TRUST", "ESTATE OF MARY JONES", "ACME LAND LLC", "DOUBLE R RANCH", "COUNTY OF HARRIS",
      "JOHN DOE TR", "HEIRS OF R LOPEZ", "FIRST BANK", "GRACE CHURCH",
    ];
    for (const n of names) {
      expect(classifyOwnerType(n), n).not.toBe("individual");
      expect(splitOwnerName(n).firstName, n).toBe("");
    }
  });
});
