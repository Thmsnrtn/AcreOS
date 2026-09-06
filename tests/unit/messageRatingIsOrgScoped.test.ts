/**
 * Rating an assistant message may not reach another organization's conversation.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `PATCH /api/ai/messages/:id/rating`, behind `isAuthenticated, getOrCreateOrg`:
 *
 *     await db.update(aiMessages).set({ rating }).where(eq(aiMessages.id, msgId));
 *
 * No organization predicate. Any authenticated user could rate ANY
 * organization's assistant message by passing its id — a cross-tenant WRITE into
 * another tenant's conversation, from a thumbs-up button.
 *
 * Then the async learning hook made it worse. `learnFromRating` re-read the
 * message by bare id and wrote a `pax_memory` row with
 * `organizationId: (msg as any).organizationId ?? 0`. `aiMessages` has NO
 * organizationId column — it belongs to an org through its conversation — so
 * that read was ALWAYS undefined and every rating filed a learning row under
 * **organization 0**, a tenant key invented from nothing in a column that is a
 * NOT NULL foreign key.
 *
 * ── WHY THREE TENANCY ADJUDICATIONS MISSED IT ───────────────────────────────
 * `check-org-scoped-fetch` walks `server/storage*` and `server/services/**`.
 * **Route files are outside its population entirely**, and this route touches
 * `db` directly rather than going through a storage method. Rules 1, 2 and 3
 * were each adjudicated to completion over a population that never included it.
 *
 * That is the third law again, and the measurement is worth recording: 81 route
 * files use `db` directly; 163 of those statements touch an org-scoped table
 * inside a file that HAS org context; **64 never name the organization, 28 of
 * them writes.** Not all are defects — many resolve an id already verified by an
 * org-scoped read above them — but none has ever been examined.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const code = (rel: string) =>
  stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));

const ROUTE = "server/routes-ai.ts";
const LEARNING = "server/services/paxLearning.ts";

/** The `rating` route handler body. */
function ratingHandler(): string {
  const src = code(ROUTE);
  const at = src.indexOf('api.patch("/api/ai/messages/:id/rating"');
  expect(at, "the rating route moved — re-anchor this file").toBeGreaterThan(-1);
  return src.slice(at, src.indexOf("\n  api.", at + 10));
}

describe("the rating write is scoped to the caller's organization", () => {
  it("VACUITY: the handler still updates aiMessages", () => {
    // Without this, the assertions below pass against a route that no longer
    // writes at all.
    expect(ratingHandler()).toMatch(/db\.update\(aiMessages\)/);
  });

  it("constrains the UPDATE STATEMENT ITSELF, not merely the surrounding handler", () => {
    // The first version of this case asserted that the handler slice CONTAINED
    // `organizationId`, `aiConversations` and the org comparison. It passed
    // against a mutation that reverted the update to
    // `.where(_eq(aiMessages.id, msgId))` — because the now-unused `scopedToOrg`
    // const was still declared above it, so every string was still present while
    // the write was wide open again.
    //
    // Proving the symbol where the property is semantic is this repo's first
    // law, and the falsification pass is what caught it. The assertion now reads
    // the WHERE of the update statement.
    const h = ratingHandler();
    const at = h.indexOf("db.update(aiMessages)");
    expect(at, "the update statement moved").toBeGreaterThan(-1);
    const stmt = h.slice(at, h.indexOf(";", at));
    const where = /\.where\(([^)]*(?:\([^)]*\))*[^)]*)\)/.exec(stmt)?.[1] ?? "";
    expect(where, "the update has no WHERE at all").not.toBe("");
    expect(
      where,
      `the rating update is constrained by "${where}" — an id with no organization, so any ` +
        "authenticated user can rate any tenant's message",
    ).not.toMatch(/^\s*_?eq\(\s*aiMessages\.id/);

    // And the predicate it DOES use must genuinely reach the org, through the
    // conversation, since aiMessages carries no org column of its own.
    const scope = /const scopedToOrg = ([\s\S]*?\n      \);)/.exec(h)?.[1] ?? "";
    expect(scope, "scopedToOrg is not declared").not.toBe("");
    expect(where.trim()).toBe("scopedToOrg");
    expect(scope).toMatch(/aiConversations\.organizationId,\s*org\.id/);
  });

  it("404s instead of silently succeeding when nothing was in scope", () => {
    // A scoped UPDATE that matches nothing returns 0 rows. Reporting success
    // would tell the caller their rating landed on a message they cannot see.
    const h = ratingHandler();
    expect(h).toMatch(/\.returning\(/);
    expect(h).toMatch(/updated\.length === 0/);
    expect(h).toMatch(/Errors\.notFound/);
  });
});

describe("learning never files a row under an invented tenant", () => {
  it("resolves the organization from the conversation", () => {
    const c = code(LEARNING);
    expect(c).toMatch(/innerJoin\(\s*aiConversations/);
    expect(c).toMatch(/organizationId: aiConversations\.organizationId/);
  });

  it("writes no literal organization id, and 0 least of all", () => {
    // Value-level: `?? 0`, `|| 0` or any literal in the org slot fails here,
    // whatever the surrounding expression looks like.
    const c = code(LEARNING);
    expect(
      c,
      "an organizationId is being defaulted to a literal — a tenant key invented from " +
        "nothing is the shape this repo's tenancy rules exist to forbid",
    ).not.toMatch(/organizationId:\s*[^,\n]*(\?\?|\|\|)\s*\d+/);
    expect(c).not.toMatch(/msg as any/);
  });

  it("refuses rather than guessing when no organization resolves", () => {
    expect(code(LEARNING)).toMatch(/typeof msg\.organizationId !== "number"/);
  });
});
