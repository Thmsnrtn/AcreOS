/**
 * The Pax hallucination guard checks what the REPLY claims, by entity type,
 * and holds counts to a source read this turn.
 *
 * Two recorded failures from the 2026-10-06 oracle pass, replayed from the
 * real tool results (tests/fixtures/pax/oracle-2026-10-06-guard.json):
 *
 *   D6  "Show me leads that opted out." Pax read the six leads, found Owner1 on
 *       do-not-contact, and drafted a correct answer. The guard threw it away
 *       TWICE: lead rows carry an `apn` column, so it typed every lead id as a
 *       PROPERTY id, looked them up in `properties`, found none, and replaced
 *       the answer with "want me to run that lookup?" — after the lookup ran.
 *
 *   H2  "Why didn't my email campaign get any replies?" Pax stated "6 leads
 *       have phone numbers but no email addresses" — a count about the
 *       customer's records. The guard let it through.
 *
 * The D6 shape must PASS, the H2 shape must be CAUGHT. The database is a
 * recorder that finds NOTHING for any id, so any id the guard sends to the
 * database fails: D6 can only pass if every id it names is grounded by type in
 * this turn's tool results.
 *
 * Mutations recorded (each turned this file red, then was reverted):
 *   M1  paxSourceExtraction.entityForTool → always null (no typing by tool):
 *       "D6 draft passes" fails — lead 39225 is no longer grounded and goes to
 *       the database.
 *   M2  looksLikeProperty back to `"apn" in obj`: "a lead row is never a
 *       property" fails.
 *   M3  findUngroundedCounts: `if (ctx.toolResultCount === 0) return true` →
 *       `return false`: "H2 is caught" fails.
 *   M4  buildPaxGuardContext passes the TOOL ids as claims (the old wiring):
 *       "a lead id claimed as a property" fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const lookups: Array<{ table: string; ids: unknown }> = [];

vi.mock("../../server/db", () => {
  const select = () => {
    const chain: any = {
      _table: "?",
      from(t: any) {
        chain._table = t?.[Symbol.for("drizzle:Name")] ?? "?";
        return chain;
      },
      where(cond: unknown) {
        lookups.push({ table: chain._table, ids: cond });
        return Promise.resolve([]); // nothing exists — every DB-checked id fails
      },
    };
    return chain;
  };
  return { db: { select } };
});

import { guardPaxOutput } from "../../server/services/paxHallucinationGuard";
import {
  buildPaxGuardContext,
  extractClaimedEntityRefs,
  extractSourceContext,
  findUngroundedCounts,
  buildCountGroundingContext,
} from "../../server/ai/paxSourceExtraction";

const FIX = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../fixtures/pax/oracle-2026-10-06-guard.json"), "utf8"),
);
const ORG = 166;

async function guard(output: string, toolCalls: any[], userText: string) {
  return guardPaxOutput({
    organizationId: ORG,
    output,
    ...buildPaxGuardContext({ output, toolCallsExecuted: toolCalls, userText }),
  });
}

beforeEach(() => {
  lookups.length = 0;
});

describe("D6 — a correct DNC answer over lead ids is not thrown away", () => {
  it("vacuity: the fixture is the recorded turn (7 tool calls, 2 rejected drafts)", () => {
    expect(FIX.D6.toolsCalled.length).toBe(7);
    expect(FIX.D6.rejectedDrafts.length).toBe(2);
    expect(FIX.D6.rejectedDrafts[0]).toContain("lead 39225");
  });

  it.each([0, 1])("rejected draft %i now passes, and nothing is looked up as a property", async (i) => {
    const result = await guard(FIX.D6.rejectedDrafts[i], FIX.D6.toolsCalled, FIX.D6.question);
    expect(result.warnings).toEqual([]);
    expect(result.safe).toBe(true);
    expect(lookups, "the guard sent a grounded id to the database").toEqual([]);
  });

  it("a lead row is never a property, even with an apn column", () => {
    const ctx = extractSourceContext(FIX.D6.toolsCalled);
    expect(ctx.claimedPropertyIds).toEqual([]);
    expect(ctx.claimedLeadIds).toEqual(expect.arrayContaining([39224, 39225, 39226, 39227, 39228, 39229]));
  });

  it("a lead id claimed AS A PROPERTY is still checked — and fails — against properties", async () => {
    const wrong = "Property #39225 is on do-not-contact.";
    const result = await guard(wrong, FIX.D6.toolsCalled, FIX.D6.question);
    expect(result.safe).toBe(false);
    expect(result.warnings.map((w) => w.kind)).toContain("entity_not_in_org");
    expect(result.warnings.map((w) => w.detail).join(" ")).toContain("property #39225");
  });

  it("an id no tool returned is checked against its own type's table", async () => {
    const result = await guard("Lead 99999 replied yesterday.", FIX.D6.toolsCalled, FIX.D6.question);
    expect(result.safe).toBe(false);
    expect(result.warnings[0].detail).toContain("lead #99999");
  });
});

describe("H2 — a count with nothing read this turn is caught", () => {
  it("the H2 shape (a count stated with no tool result in the turn) is unsafe", async () => {
    const result = await guard("Your 6 leads have phone numbers but no email addresses on file.", [], "Why didn't my email campaign get any replies?");
    expect(result.safe).toBe(false);
    expect(result.warnings.map((w) => w.kind)).toEqual(["ungrounded_count"]);
    expect(result.warnings[0].detail).toContain("nothing was read");
  });

  it("a count larger than anything read this turn is caught", async () => {
    const calls = [{ name: "get_campaigns", result: { success: true, data: { totalReturned: 0, campaigns: [], mailPiecesSentByMonth: [] } } }];
    const result = await guard("You sent 40 emails last week.", calls, "How did my emails do?");
    expect(result.safe).toBe(false);
    expect(result.warnings[0].kind).toBe("ungrounded_count");
  });

  it("the recorded H2 reply is held to its source: every count it states was read", () => {
    // Honest about the limit: the recorded reply's "6 leads" WAS in the turn
    // (get_system_context: Total 6 leads), so a count check alone cannot see
    // that the "no email" qualifier went beyond the read. This pins that the
    // grounding is computed from the real result, not assumed.
    const ctx = buildCountGroundingContext(FIX.H2.toolsCalled, FIX.H2.question);
    expect(ctx.toolResultCount).toBe(1);
    expect(ctx.sourceCounts).toContain(6);
    expect(findUngroundedCounts(FIX.H2.shippedReply, ctx)).toEqual([]);
  });

  it("counts the customer named, counts that were read, and subsets of a read list all stand", async () => {
    const leads = { name: "get_leads", result: { success: true, data: [1, 2, 3, 4, 5, 6].map((id) => ({ id, firstName: "A", lastName: "B", doNotContact: id === 2 })) } };
    expect((await guard("500 postcards at $0.75 each is $375.00.", [], "What will 500 postcards cost?")).safe).toBe(true);
    expect((await guard("You have 6 leads; 1 of your 6 leads is on do-not-contact and 5 leads are not.", [leads], "Show me opted out leads")).safe).toBe(true);
  });

  it("dollar amounts, ids and measurements are not counts", () => {
    const ctx = buildCountGroundingContext([], "");
    expect(findUngroundedCounts("Fines run $500 to $1,500 per text. Lead #3 owns 5 acres.", ctx)).toEqual([]);
    expect(extractClaimedEntityRefs("Property 5 acres in Cochise").propertyIds).toEqual([]);
  });
});
