/**
 * The support-tool switch may not read or write another organization's rows.
 *
 * ── HOW THIS WENT UNNOTICED ─────────────────────────────────────────────────
 * `executeSupportTool` in server/ai/supportAgent.ts is a 91-case dispatch a
 * model drives while resolving a paying customer's ticket. It is reachable by
 * any authenticated org member: `POST /api/support/tickets/:id/pax-resolve`
 * sits behind `isAuthenticated, getOrCreateOrg` and runs the ticket end-to-end
 * through `paxSupportResolver`, which calls the switch directly.
 *
 * The repository's tenancy lint (`scripts/check-org-scoped-fetch.mjs`) had
 * NEVER read this function. Its bracket walkers tracked quotes and nothing
 * else, so a nested template literal in the same file desynchronised them and
 * the declaration could not be closed — and the failure was an unlogged
 * `continue`, so the gate reported a healthy count and said nothing. The
 * function was outside the population entirely, which is CLAUDE.md's third law
 * with the population failing at the TOKENIZER rather than at the file list.
 *
 * ── WHAT READING IT FOUND ───────────────────────────────────────────────────
 * Four tools read `support_resolution_history` with no organization predicate.
 * Three of them return `resolutionApproach` and `lessonLearned` — free text an
 * AI wrote about ONE organization's ticket, which can name that org, its
 * people, its properties — into the context of a model that is at that moment
 * talking to a DIFFERENT paying customer. The fourth returns platform-wide
 * volumes and success rates, which are AcreOS's numbers and not the customer's.
 *
 * Separately, three cases read and write `support_tickets` keyed on nothing but
 * the `ticketId` parameter. Nothing was live — all three call sites happen to
 * check ownership first — but that was a property of the CALLERS, and this
 * function is the confused-deputy chokepoint.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 *   1. Every read of `support_resolution_history` in this file names an
 *      organization. The population is DERIVED from the source, so a fifth
 *      tool added without a predicate fails here.
 *   2. The ticket-ownership check exists, runs before the dispatch switch,
 *      refuses rather than logs, and exempts founders — the same rule the
 *      pax-resolve route applies at its own door.
 *   3. Every caller of the switch still passes an org, so the check has
 *      something to check against.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const AGENT = "server/ai/supportAgent.ts";

/** Strip comments so prose naming a symbol never reads as code using it. */
function code(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

const src = code(AGENT);

/**
 * Every query chain that reads a table, as the text from `.from(<table>)` to
 * the statement's terminating semicolon.
 */
function readsOf(table: string): string[] {
  const chains: string[] = [];
  const marker = `.from(${table})`;
  let at = src.indexOf(marker);
  while (at !== -1) {
    const end = src.indexOf(";", at);
    chains.push(src.slice(at, end === -1 ? src.length : end));
    at = src.indexOf(marker, at + marker.length);
  }
  return chains;
}

describe("support_resolution_history is never read across tenants", () => {
  const chains = readsOf("supportResolutionHistory");

  it("finds the reads at all (vacuity guard)", () => {
    // Four at the time of writing. A marker that stops matching reads exactly
    // like a file with no cross-tenant reads left in it.
    expect(
      chains.length,
      "no reads of support_resolution_history were found — the derivation is " +
        "broken, and this file then certifies nothing",
    ).toBeGreaterThanOrEqual(4);
  });

  it("every read names the organization", () => {
    const unscoped = chains.filter(
      (c) => !/eq\(\s*supportResolutionHistory\.organizationId\s*,/.test(c),
    );
    expect(
      unscoped,
      "A read of support_resolution_history carries no organization predicate. " +
        "These rows hold resolutionApproach and lessonLearned — free text " +
        "written about one organization's ticket — and this switch feeds them " +
        "to a model that is talking to a different paying customer. Scope the " +
        "query; a cross-org support knowledge base is a product decision with " +
        "de-identification attached, not a missing WHERE clause:\n" +
        unscoped.join("\n---\n"),
    ).toEqual([]);
  });

  it("the predicate is in the query, not only in a variable the reader must chase", () => {
    // Three of the four build their conditions in a local array. The org
    // predicate sits in the `.where(...)` itself so that reading the query
    // tells you it is scoped — and so the repository's chain-level lint can
    // see it, which is how the fifth one will be caught.
    for (const chain of chains) {
      expect(
        chain,
        `this chain hides its scope from the query text:\n${chain}`,
      ).toMatch(/\.where\(\s*and\(\s*eq\(\s*supportResolutionHistory\.organizationId/);
    }
  });
});

describe("a ticket from another organization is refused at the chokepoint", () => {
  it("the ownership check exists and reads the ticket's real owner", () => {
    expect(src).toContain("select({ organizationId: supportTickets.organizationId })");
    expect(src).toMatch(/owner\.organizationId !== org\.id/);
  });

  it("it runs BEFORE the dispatch switch — a check after dispatch has already run the tool", () => {
    const checkAt = src.indexOf("owner.organizationId !== org.id");
    const switchAt = src.indexOf("switch (toolName) {", checkAt);
    expect(checkAt, "the ownership check is gone").toBeGreaterThan(-1);
    expect(switchAt, "the ownership check no longer precedes the switch").toBeGreaterThan(checkAt);
  });

  it("it refuses, rather than logging and continuing", () => {
    // Anchored on the guard's OPENING condition, not on the comparison inside
    // it — a window that starts mid-condition cannot see the `!owner` half and
    // would pass whether or not the missing-ticket case refuses.
    const checkAt = src.indexOf("if (!owner ||");
    expect(checkAt, "the guard no longer refuses a ticket that does not exist").toBeGreaterThan(-1);
    const block = src.slice(checkAt, checkAt + 700);
    expect(block).toContain("owner.organizationId !== org.id");
    expect(block).toMatch(/return \{\s*success: false/);
  });

  it("founders keep cross-org access, matching the rule the resolver route applies", () => {
    const checkAt = src.lastIndexOf("if (typeof ticketId === \"number\"");
    expect(checkAt).toBeGreaterThan(-1);
    expect(src.slice(checkAt, checkAt + 120)).toContain("!org.isFounder");
    // And that IS the route's rule, so the two doors cannot drift apart.
    expect(code("server/routes-support-tickets.ts")).toMatch(
      /ticket\.organizationId !== org\.id && !org\.isFounder/,
    );
  });
});

describe("every caller gives the check something to check", () => {
  it("all three call sites pass an organization", () => {
    const callers = [
      "server/ai/supportAgent.ts",
      "server/ai/paxSupportResolver.ts",
      "server/services/paxAskExecutors.ts",
    ];
    let found = 0;
    for (const rel of callers) {
      const s = code(rel);
      const re = /executeSupportTool\(([^;]*?)\)/gs;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) {
        if (/^\s*$/.test(m[1])) continue;
        found += 1;
        expect(
          m[1],
          `a call to executeSupportTool in ${rel} passes no organization, so the ` +
            "ownership check has nothing to compare against",
        ).toMatch(/\borg\b|\bctx\.org\b/);
      }
    }
    expect(found, "no call sites were found — the derivation is broken").toBeGreaterThanOrEqual(3);
  });
});
