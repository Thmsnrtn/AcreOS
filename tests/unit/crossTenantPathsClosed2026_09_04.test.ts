/**
 * Four cross-tenant paths, found by triaging the tenancy lint's debt register
 * and confirmed against an adversarial reader that was told to refute them.
 *
 * They are pinned together because they share one lesson and it is not
 * "remember the WHERE clause". In every case the handler DID scope the thing
 * it looked like it was scoping. What leaked was one step to the side:
 *
 *   1. A child keyed on an id the CALLER chose (maintenance tickets).
 *   2. A row shipped whole when only half of it was public (investor
 *      directory).
 *   3. A guard that is vacuous in exactly the state the system creates most
 *      often (title-order webhook).
 *   4. A lookup keyed on the wrong NAMESPACE, against a client-settable
 *      column (borrower session).
 *
 * Each block below states the concrete request that used to work.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

/** Strip comments so prose describing a defect never reads as the defect. */
function code(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

/** The text of one query chain, from `.from(<table>)` to the terminating `;`. */
function chainsFrom(src: string, table: string): string[] {
  const out: string[] = [];
  const marker = `.from(${table})`;
  let at = src.indexOf(marker);
  while (at !== -1) {
    const end = src.indexOf(";", at);
    out.push(src.slice(at, end === -1 ? src.length : end));
    at = src.indexOf(marker, at + marker.length);
  }
  return out;
}

describe("a body-supplied contractor id cannot reach another tenant", () => {
  // WAS: POST /api/maintenance-tickets/<own ticket>/dispatch with
  // {"contractorId": "<uuid of another org's contractor>"} stored the id
  // unchecked (assigned_contractor_id is a SOFT FK, so the database did not
  // object), and GET /api/maintenance-tickets/<same ticket> then returned that
  // contractor's name, businessName, email, phone and trades.
  const src = code("server/routes-maintenance-tickets.ts");

  it("the dispatch route verifies the contractor is in the caller's org before storing it", () => {
    const at = src.indexOf("assignedContractorId: parsed.data.contractorId");
    expect(at, "the dispatch write is gone or renamed — re-point this test").toBeGreaterThan(-1);
    const before = src.slice(0, at);
    expect(
      before,
      "the dispatch route stores a body-supplied contractorId without ever " +
        "loading that contractor and checking its organization",
    ).toMatch(/\.from\(contractors\)[\s\S]{0,400}eq\(contractors\.organizationId, orgId\)/);
    // And it must REFUSE, not warn and continue.
    expect(src.slice(0, at)).toMatch(/if \(!contractor\) return Errors\.notFound/);
  });

  it("every read of contractors in this file names the organization", () => {
    const chains = chainsFrom(src, "contractors");
    expect(chains.length, "no contractor reads found — the derivation is broken").toBeGreaterThan(0);
    const unscoped = chains.filter((c) => !/eq\(contractors\.organizationId,/.test(c));
    expect(
      unscoped,
      "a contractor read carries no organization predicate:\n" + unscoped.join("\n---\n"),
    ).toEqual([]);
  });
});

describe("the investor directory ships the public half of the row, not the row", () => {
  // WAS: `select()` with no projection, so every authenticated user of every
  // org received `verificationDocuments` — the identity-verification document
  // URLs written by POST /api/investor-profiles/verify — plus organizationId
  // and lastActiveAt. A cross-org directory of verified investors IS the
  // feature; shipping the verification block with it was not.
  const src = code("server/routes-misc.ts");
  const at = src.indexOf('"/api/investor-profiles/directory"');
  const handler = src.slice(at, at + 2500);

  it("the route exists and this test is looking at it (vacuity guard)", () => {
    expect(at, "the directory route is gone — re-point or delete this test").toBeGreaterThan(-1);
    expect(handler).toContain(".from(investorProfiles)");
  });

  it("the query projects columns rather than selecting the whole row", () => {
    expect(
      handler,
      "the directory selects the entire investor_profiles row again",
    ).not.toMatch(/\.select\(\)\s*\.from\(investorProfiles\)/);
    expect(handler).toMatch(/\.select\(\{[\s\S]*?\}\)\s*\.from\(investorProfiles\)/);
  });

  it("the private columns are not among them", () => {
    const projection = /\.select\(\{([\s\S]*?)\}\)\s*\.from\(investorProfiles\)/.exec(handler);
    expect(projection, "the projection could not be read").not.toBeNull();
    for (const column of ["verificationDocuments", "organizationId", "lastActiveAt"]) {
      expect(
        projection![1],
        `"${column}" is back in the cross-org directory response. Adding a ` +
          "column to investor_profiles must not add it here — that is why the " +
          "columns are named one by one.",
      ).not.toContain(column);
    }
    // And the public half is still actually served, so the fix is not "return nothing".
    expect(projection![1]).toContain("displayName");
    expect(projection![1]).toContain("reliabilityScore");
  });
});

describe("an unassigned title order cannot be claimed across organizations", () => {
  // WAS: the assignment guard read `if (order.titlePartnerId && …)`, which is
  // vacuous whenever titlePartnerId IS NULL — the state POST /api/title-orders
  // writes every time routeTitleOrder() finds no territory match. The handler
  // then auto-claimed the order for whichever partner called. Any holder of
  // ANY active partner key could walk integer order ids and take over another
  // organization's pending order, writing its status and all three document
  // S3 keys. The HMAC is verified with the CALLER's own secret, so it proves
  // who is calling and nothing about what they may touch.
  const src = code("server/routes-title-partners.ts");

  it("the auto-claim is guarded by the partner's organization scope", () => {
    const claimAt = src.indexOf("updates.titlePartnerId = partner.id");
    expect(claimAt, "the auto-claim is gone — re-point this test").toBeGreaterThan(-1);
    const before = src.slice(0, claimAt);
    expect(
      before,
      "an unassigned order is auto-claimed with no check that the calling " +
        "partner may serve that order's organization",
    ).toMatch(
      /!order\.titlePartnerId[\s\S]{0,200}partner\.organizationId !== order\.organizationId/,
    );
  });

  it("the guard refuses rather than logging", () => {
    const guardAt = src.indexOf("partner.organizationId !== order.organizationId");
    expect(src.slice(guardAt, guardAt + 400)).toContain("Errors.forbidden(res");
  });

  it("it is the same eligibility rule routeTitleOrder uses to choose a partner", () => {
    // A partner with a NULL organizationId is platform-wide; one scoped to an
    // org serves only that org. If the routing rule changes, this claim rule
    // must change with it — two different answers to "may this partner serve
    // this order" is how the hole reopens.
    const routing = src.slice(src.indexOf("async function routeTitleOrder"), src.indexOf("async function routeTitleOrder") + 1500);
    expect(routing).toContain("isNull(titlePartners.organizationId)");
    expect(routing).toContain("eq(titlePartners.organizationId, organizationId)");
    const guardAt = src.indexOf("partner.organizationId !== order.organizationId");
    expect(
      src.slice(Math.max(0, guardAt - 200), guardAt + 80),
      "the claim guard no longer exempts platform-wide partners, so it has " +
        "drifted from the routing rule it mirrors",
    ).toContain("partner.organizationId != null");
  });
});

describe("the borrower session loads its note by id, inside its own tenant", () => {
  // WAS: `storage.getNoteByAccessToken(session.noteId.toString())` — the
  // session's NUMERIC note id passed to a lookup keyed on notes.access_token,
  // an opaque per-note secret with NO organization predicate. access_token is
  // client-settable (insertNoteSchema omits only id/createdAt/updatedAt and
  // createNote honours it verbatim) and globally unique, so any self-serve
  // signup could POST /api/notes with {"accessToken":"42"} and own that token.
  // A legitimate borrower of a DIFFERENT organization's note #42 was then
  // served the attacker's loan — balance, payment history, linked property and
  // borrower name — on a Reg-Z consumer surface. It also defeated the org-pin
  // that validateBorrowerSession performs, which only covers notes.id lookups.
  const src = code("server/routes-borrower.ts");

  it("the session route no longer looks a note up by access token", () => {
    const at = src.indexOf('"/api/borrower/session"');
    expect(at, "the session route is gone — re-point this test").toBeGreaterThan(-1);
    const handler = src.slice(at, at + 2500);
    expect(
      handler,
      "the borrower session resolves its note through notes.access_token " +
        "again. A note id is not an access token, and access_token is a value " +
        "any signup can choose.",
    ).not.toContain("getNoteByAccessToken");
  });

  it("it loads by id AND the session's own organization snapshot", () => {
    const at = src.indexOf('"/api/borrower/session"');
    const handler = src.slice(at, at + 2500);
    expect(handler).toMatch(/eq\(notes\.id, session\.noteId\)/);
    expect(
      handler,
      "the read is not pinned to the organization the session was minted in",
    ).toMatch(/eq\(notes\.organizationId, session\.organizationId\)/);
  });

  it("the token lookup survives where a token really is the credential", () => {
    // The fix is not "delete getNoteByAccessToken". The magic-link routes pass
    // a genuine opaque token, which IS the bearer credential there — this test
    // exists so a later cleanup does not remove the legitimate callers along
    // with the illegitimate one.
    const legitimate = [...src.matchAll(/getNoteByAccessToken\((\w+)\)/g)].map((m) => m[1]);
    expect(legitimate.length, "every caller vanished — that is not the fix").toBeGreaterThanOrEqual(2);
    for (const arg of legitimate) {
      expect(
        arg,
        `getNoteByAccessToken is being called with "${arg}" — it takes an ` +
          "opaque access token, never an id from another namespace",
      ).toBe("accessToken");
    }
  });
});
