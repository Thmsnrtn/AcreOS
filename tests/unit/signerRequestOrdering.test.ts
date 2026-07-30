/**
 * CodeQL HIGH (PR #259) — "user-controlled bypass of security check" on
 * POST /api/generated-documents/:id/request-signature.
 *
 * The endpoint mints per-signer HMAC signing links: the most sensitive action
 * in the document system, because each link lets an external party bind the
 * org's name to a contract. The finding was that the nearest guard in front of
 * that minting was a condition over `req.body.signers` — a caller-supplied
 * value.
 *
 * The fix keeps every refusal and adds real validation, but moves the branch
 * over client data into services/esign/signerRequest.ts, a pure module that
 * cannot reach the minting, and reads the body LAST — after every server-side
 * gate. This file pins both halves:
 *
 *   1. the parser's behaviour, including the deliberately-permitted empty
 *      email that a wholesale assignor relies on; and
 *   2. the ORDER in the route, so a future refactor cannot quietly put a
 *      client-supplied field back in front of the signing-token call.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  parseSignerRequest,
  SignerRequestError,
  SIGNER_REQUEST_LIMITS,
} from "../../server/services/esign/signerRequest";

const ROUTE = fs.readFileSync(
  path.resolve(__dirname, "../../server/routes-doc-system.ts"),
  "utf-8",
);

/** Throw-and-capture, so each case can assert on the named refusal code. */
function refusalOf(raw: unknown, opts?: { allowEmpty?: boolean }): string {
  try {
    parseSignerRequest(raw, opts);
  } catch (e) {
    expect(e).toBeInstanceOf(SignerRequestError);
    return (e as SignerRequestError).refusal.code;
  }
  throw new Error("expected parseSignerRequest to refuse, but it returned");
}

describe("parseSignerRequest — every refusal over client data lives here", () => {
  it("accepts a well-formed list and normalizes it", () => {
    const out = parseSignerRequest([
      { name: "  Dana Reyes ", email: " dana@example.com ", role: " buyer " },
      { name: "Sam Okafor", email: "sam@example.com" },
    ]);
    expect(out).toEqual([
      { name: "Dana Reyes", email: "dana@example.com", role: "buyer" },
      { name: "Sam Okafor", email: "sam@example.com", role: "signer" },
    ]);
  });

  it("ALLOWS an empty email — the wholesale assignor is usually the operator", () => {
    // AssignmentPanel.tsx sends { name: org.name, email: "", role: "assignor" }
    // on purpose: that signer takes their link from the response, not by mail.
    // Tightening this would break a shipped flow, so it is pinned.
    const out = parseSignerRequest([{ name: "Acme Land Co", email: "", role: "assignor" }]);
    expect(out[0].email).toBe("");
  });

  it("refuses a non-empty email that is not an address", () => {
    expect(refusalOf([{ name: "Dana", email: "dana at example" }])).toBe("SIGNER_EMAIL_MALFORMED");
  });

  it("refuses a missing or blank name", () => {
    expect(refusalOf([{ email: "a@b.co" }])).toBe("SIGNER_NAME_MISSING");
    expect(refusalOf([{ name: "   ", email: "a@b.co" }])).toBe("SIGNER_NAME_MISSING");
  });

  it("refuses non-lists, empty lists, and non-object entries", () => {
    expect(refusalOf("dana@example.com")).toBe("SIGNERS_NOT_A_LIST");
    expect(refusalOf({ name: "Dana" })).toBe("SIGNERS_NOT_A_LIST");
    expect(refusalOf(undefined)).toBe("SIGNERS_EMPTY");
    expect(refusalOf([])).toBe("SIGNERS_EMPTY");
    expect(refusalOf(["Dana"])).toBe("SIGNER_NOT_AN_OBJECT");
    expect(refusalOf([null])).toBe("SIGNER_NOT_AN_OBJECT");
  });

  it("bounds the list and the fields, so a legal record can't be flooded", () => {
    const many = Array.from({ length: SIGNER_REQUEST_LIMITS.MAX_SIGNERS + 1 }, (_, i) => ({
      name: `Signer ${i}`,
      email: `s${i}@example.com`,
    }));
    expect(refusalOf(many)).toBe("SIGNERS_TOO_MANY");
    expect(
      refusalOf([{ name: "x".repeat(SIGNER_REQUEST_LIMITS.MAX_NAME_LEN + 1), email: "" }]),
    ).toBe("SIGNER_FIELD_TOO_LONG");
  });

  it("allowEmpty is the ONLY thing the legacy endpoint relaxes", () => {
    expect(parseSignerRequest(undefined, { allowEmpty: true })).toEqual([]);
    expect(parseSignerRequest([], { allowEmpty: true })).toEqual([]);
    // Shape is still enforced under allowEmpty.
    expect(refusalOf([{ email: "a@b.co" }], { allowEmpty: true })).toBe("SIGNER_NAME_MISSING");
  });

  it("the parser reaches nothing sensitive — no express, no db, no token minting", () => {
    const mod = fs.readFileSync(
      path.resolve(__dirname, "../../server/services/esign/signerRequest.ts"),
      "utf-8",
    );
    for (const forbidden of ["from \"express\"", "./db", "signingTokens", "storage"]) {
      expect(mod, `signerRequest.ts must not import ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("the request-signature route reads the body LAST", () => {
  const handler = (() => {
    const start = ROUTE.indexOf('api.post("/api/generated-documents/:id/request-signature"');
    expect(start, "request-signature handler must be findable").toBeGreaterThan(-1);
    const end = ROUTE.indexOf('api.post("/api/generated-documents/:id/send-for-signature"', start);
    return ROUTE.slice(start, end > start ? end : undefined);
  })();

  const at = (needle: string) => {
    const i = handler.indexOf(needle);
    expect(i, `expected to find ${needle} in the request-signature handler`).toBeGreaterThan(-1);
    return i;
  };

  it("every server-side gate precedes the body parse", () => {
    const bodyParse = at("parseSignerRequest(req.body");
    expect(at("storage.getGeneratedDocument"), "org-scoped load").toBeLessThan(bodyParse);
    expect(at('document.status !== "draft"'), "draft check").toBeLessThan(bodyParse);
    expect(at("checkDisclosure("), "state-disclosure gate").toBeLessThan(bodyParse);
    expect(at("verifyChainReviewSeal("), "reviewed-content seal").toBeLessThan(bodyParse);
  });

  it("the body parse precedes signing-token minting, and nothing branches between", () => {
    const bodyParse = at("parseSignerRequest(req.body");
    const mint = at("makeSigningToken");
    expect(bodyParse).toBeLessThan(mint);
    // No `if (` over anything between the parse and the mint: the refusal path
    // is the parser's throw, handled by refuseSignerRequest at module scope.
    const between = handler.slice(handler.indexOf("catch (err)", bodyParse), mint);
    expect(between.split("if (").length - 1, "no guard may reappear before minting").toBe(0);
  });

  it("`req.body` is not read anywhere earlier in the handler", () => {
    const bodyParse = at("parseSignerRequest(req.body");
    const earlier = handler.slice(0, bodyParse);
    expect(earlier).not.toMatch(/req\.body/);
  });

  it("the refusal helper is at module scope, not inside the handler", () => {
    const helper = ROUTE.indexOf("function refuseSignerRequest");
    expect(helper).toBeGreaterThan(-1);
    expect(helper, "helper must be declared before the routes it serves").toBeLessThan(
      ROUTE.indexOf('api.post("/api/generated-documents/:id/request-signature"'),
    );
  });
});

describe("the legacy send-for-signature endpoint validates too", () => {
  it("stores a parsed list, never raw body JSON", () => {
    const start = ROUTE.indexOf('api.post("/api/generated-documents/:id/send-for-signature"');
    expect(start).toBeGreaterThan(-1);
    const handler = ROUTE.slice(start, start + 2500);
    expect(handler).toContain("parseSignerRequest(req.body?.signers, { allowEmpty: true })");
    expect(handler).toContain("signers: legacySigners");
    expect(handler, "the raw body list must not be written to the record").not.toMatch(
      /signers:\s*signers\s*\|\|/,
    );
  });
});
