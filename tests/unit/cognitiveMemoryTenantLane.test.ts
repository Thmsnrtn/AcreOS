/**
 * A semantic fact's org tag is part of its IDENTITY, not a filter over it.
 *
 * `agent_semantic_memory.org_id` is nullable and BOTH values mean something:
 * `feedbackLoopV14` writes facts carrying the org whose founder produced an
 * override, while `trustAuthorityEscalation` writes an agent's own promotion
 * with no org at all — a platform fact about a globally-named agent.
 *
 * `extractFact` deduped on (codename, category, fact) alone. The fact TEXT
 * carries no tenant: `synthesizeRule` produces
 *
 *     Founder consistently overrides ${agent} in category "${c}": replaces …
 *
 * and agent codenames are global platform identities. So two orgs whose
 * founders overrode the same agent the same way produced BYTE-IDENTICAL text,
 * matched each other's row, and the "reinforce" path merged org B's source
 * episode ids into a row tagged org A, bumped org A's confidence, and returned
 * org A's row to org B's caller — whose id org B then persisted in
 * `feedbackLearnings.appliedToMemory`. `queryFacts` had no org parameter at
 * all, so the verification read that follows the write was satisfied by ANY
 * org's fact and reported `verified: true` off another tenant's row.
 *
 * The rule this pins: **null matches only null.** A missing lane is never a
 * wildcard — that is the assumption that turns a nullable tag into a leak.
 *
 * The predicates are read out of the drizzle SQL the service actually built,
 * not grepped from its source, so a lane spelled a different way still counts
 * and a lane removed still fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const captured: unknown[] = [];
let selectRows: Array<Record<string, unknown>> = [];

function capture(where: unknown) {
  captured.push(where);
}

vi.mock("../../server/db", () => {
  const insertChain = () => ({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 1, factId: "f", confidence: 50 }]),
    }),
  });
  return {
    db: {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation((w: unknown) => {
            capture(w);
            const rows = selectRows;
            const chain: any = {
              limit: vi.fn().mockResolvedValue(rows),
              orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }),
            };
            return chain;
          }),
        }),
      })),
      insert: vi.fn().mockImplementation(insertChain),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation((w: unknown) => {
            capture(w);
            return { returning: vi.fn().mockResolvedValue([{ id: 1 }]) };
          }),
        }),
      })),
    },
  };
});

import { cognitiveMemoryService } from "../../server/services/cognitiveMemoryV13";

/** Columns and literal SQL fragments inside a drizzle predicate, at any depth. */
function readPredicate(node: any, cols: string[] = [], frags: string[] = []): { cols: string[]; sql: string } {
  if (node && typeof node === "object") {
    // Column names and SQL fragments are separate chunk kinds; both are pushed
    // onto ONE ordered stream so `org_id is null` reads as adjacent text rather
    // than as a column in one list and an operator in another.
    if (typeof node.name === "string" && node.table) {
      cols.push(node.name);
      frags.push(node.name);
    }
    if (Array.isArray(node.value)) frags.push(...node.value.filter((v: unknown) => typeof v === "string"));
    if (Array.isArray(node.queryChunks)) node.queryChunks.forEach((c: any) => readPredicate(c, cols, frags));
  }
  return { cols, sql: frags.join("") };
}

function allPredicates() {
  return captured.map((c) => readPredicate(c));
}

beforeEach(() => {
  captured.length = 0;
  selectRows = [];
});

describe("cognitive memory: the org tag is part of a fact's identity", () => {
  it("extractFact dedupes within one org's lane", async () => {
    await cognitiveMemoryService.extractFact("atlas", {
      fact: "same text in every tenant", category: "founder_feedback",
      sourceEpisodes: [], orgId: 7,
    });

    const [lookup] = allPredicates();
    expect(lookup, "extractFact issued no lookup").toBeTruthy();
    // Vacuity: the reader must see the terms that were always there, else a
    // missing org_id is indistinguishable from a predicate it failed to parse.
    expect(lookup.cols).toContain("agent_codename");
    expect(lookup.cols).toContain("fact");
    expect(lookup.cols).toContain("org_id");
    expect(lookup.sql).toContain("org_id");
  });

  it("a platform fact (no org) matches ONLY other platform facts — null is not a wildcard", async () => {
    await cognitiveMemoryService.extractFact("atlas", {
      fact: "Promoted to Operator", category: "authority", sourceEpisodes: [],
    });

    const [lookup] = allPredicates();
    expect(lookup.cols).toContain("org_id");
    // `is null`, not an omitted term and not `= undefined`.
    expect(lookup.sql).toMatch(/org_id.*is null/s);
  });

  it("the reinforce UPDATE carries the lane too, not just the row id", async () => {
    selectRows = [{
      id: 99, reinforcementCount: 1, confidence: 50, sourceEpisodes: [],
    }];
    await cognitiveMemoryService.extractFact("atlas", {
      fact: "reinforced", category: "founder_feedback", sourceEpisodes: ["e1"], orgId: 7,
    });

    // Lookup, then the update — the update's predicate is the last one.
    const preds = allPredicates();
    expect(preds.length).toBeGreaterThanOrEqual(2);
    const update = preds[preds.length - 1];
    expect(update.cols).toContain("id");
    expect(update.cols).toContain("org_id");
  });

  it("queryFacts reads one lane, and requires the caller to say which", async () => {
    await cognitiveMemoryService.queryFacts("atlas", { orgId: 7, category: "founder_feedback", limit: 1 });
    const [read] = allPredicates();
    expect(read.cols).toContain("agent_codename");
    expect(read.cols).toContain("org_id");
  });

  it("queryFacts on the platform lane matches only null-tagged facts", async () => {
    await cognitiveMemoryService.queryFacts("atlas", { orgId: null, limit: 1 });
    const [read] = allPredicates();
    expect(read.sql).toMatch(/org_id.*is null/s);
  });

  it("the shared-fact branch is lane-scoped as well — sharing is between agents, not tenants", async () => {
    await cognitiveMemoryService.queryFacts("atlas", { orgId: 7, includeShared: true, limit: 1 });
    const preds = allPredicates();
    expect(preds.length, "the shared branch issued no second read").toBeGreaterThanOrEqual(2);
    for (const p of preds) expect(p.cols).toContain("org_id");
  });
});
