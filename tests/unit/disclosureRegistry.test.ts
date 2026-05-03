/**
 * Disclosure Registry — unit tests
 *
 * Audit refs: Cesar §1, Marguerite §3.2, Cordelia §2.1.
 *
 * Verifies the per-state legal disclosure gate that blocks AcreOS from
 * dispatching state-regulated documents (e.g. TX contract-for-deed) for
 * signature when the statutory disclosure block is missing.
 */

import { describe, it, expect } from "vitest";
import {
  checkDisclosure,
  findDisclosureRequirement,
  buildDisclosureMissingPayload,
  DISCLOSURE_REQUIREMENTS,
} from "../../server/services/disclosureRegistry";

const TX_FULL_DISCLOSURE = `
SELLER'S DISCLOSURE OF PROPERTY CONDITION AS REQUIRED BY TEXAS PROPERTY CODE SECTION 5.069

Pursuant to TEXAS PROPERTY CODE SECTION 5.069, the seller has provided the
buyer with a current survey of the property, together with a written notice of
all liens, restrictions, and easements of record affecting the property, a
written statement listing any known defects, and a tax certificate from the
collector for each taxing unit that collects taxes due on the property.

WARNING: THIS DOCUMENT CREATES A LIEN ON THE PROPERTY. IF YOU DO NOT MAKE
THE PAYMENTS REQUIRED BY THIS CONTRACT, YOU CAN LOSE THE PROPERTY AND ALL
PAYMENTS YOU HAVE MADE.
`;

describe("disclosureRegistry", () => {
  describe("findDisclosureRequirement", () => {
    it("matches TX contract_for_deed by exact key", () => {
      const r = findDisclosureRequirement("TX", "contract_for_deed");
      expect(r).toBeDefined();
      expect(r?.statuteCitation).toContain("5.069");
    });

    it("normalizes state casing and docType separators", () => {
      const r = findDisclosureRequirement("tx", "Contract-For-Deed");
      expect(r).toBeDefined();
      expect(r?.state).toBe("TX");
    });

    it("returns undefined for unregistered (state, docType) pairs", () => {
      const r = findDisclosureRequirement("CA", "grant_deed");
      expect(r).toBeUndefined();
    });
  });

  describe("checkDisclosure — TX § 5.069", () => {
    it("rejects a TX contract_for_deed missing the required heading", () => {
      const content =
        "This is a generic land contract with no disclosure block whatsoever.";
      const result = checkDisclosure("TX", "contract_for_deed", content);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.missing.statuteCitation).toContain("5.069");
      expect(result.missingHeading).toBe(true);
      expect(result.missingPhrases.length).toBeGreaterThan(0);
    });

    it("rejects when the heading is present but key body phrases are missing", () => {
      const content = `
        SELLER'S DISCLOSURE OF PROPERTY CONDITION AS REQUIRED BY TEXAS PROPERTY CODE SECTION 5.069
        (body text intentionally incomplete)
      `;
      const result = checkDisclosure("TX", "contract_for_deed", content);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.missingHeading).toBe(false);
      expect(result.missingPhrases).toContain("current survey");
      expect(result.missingPhrases).toContain("known defects");
    });

    it("passes when the heading and all required body phrases are present", () => {
      const result = checkDisclosure(
        "TX",
        "contract_for_deed",
        TX_FULL_DISCLOSURE
      );
      expect(result.ok).toBe(true);
    });

    it("is case-insensitive for matching", () => {
      const result = checkDisclosure(
        "tx",
        "contract_for_deed",
        TX_FULL_DISCLOSURE.toLowerCase()
      );
      // Heading text lowercased still contains the WORDS, just lowercased.
      // The matcher uppercases both sides so this should pass.
      expect(result.ok).toBe(true);
    });

    it("ignores docTypes that have no registered requirement", () => {
      const result = checkDisclosure(
        "TX",
        "general_warranty_deed",
        "any content"
      );
      expect(result.ok).toBe(true);
    });
  });

  describe("checkDisclosure — NY § 3-307 fail-closed", () => {
    it("throws on unverified registry entry rather than passing", () => {
      expect(() =>
        checkDisclosure("NY", "note_dispatch", "any content")
      ).toThrow(/NY § 307 disclosure registry incomplete/);
    });
  });

  describe("buildDisclosureMissingPayload", () => {
    it("produces a structured client-friendly payload", () => {
      const result = checkDisclosure(
        "TX",
        "contract_for_deed",
        "no disclosure here"
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const payload = buildDisclosureMissingPayload(result);
      expect(payload.code).toBe("DISCLOSURE_MISSING");
      expect(payload.state).toBe("TX");
      expect(payload.docType).toBe("contract_for_deed");
      expect(payload.statute).toContain("5.069");
      expect(payload.requiredHeading).toContain("TEXAS PROPERTY CODE SECTION 5.069");
      expect(payload.missingHeading).toBe(true);
      expect(Array.isArray(payload.missingPhrases)).toBe(true);
      expect(payload.friendlyName).toContain("Texas");
    });
  });

  describe("registry shape", () => {
    it("contains both TX and NY entries", () => {
      const states = DISCLOSURE_REQUIREMENTS.map((r) => `${r.state}:${r.docType}`);
      expect(states).toContain("TX:contract_for_deed");
      expect(states).toContain("NY:note_dispatch");
    });
  });
});
