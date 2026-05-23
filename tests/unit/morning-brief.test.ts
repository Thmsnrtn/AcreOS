/**
 * Phase E — morning-brief composition + dedupe tests.
 *
 * Mocks `../../server/db` and the aiRouter so the composer runs end-to-
 * end with no Postgres + no OpenRouter calls. Tag-based dispatch lets a
 * single fake select stub route per-table.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeMessage {
  conversationId: number;
  role: string;
  content: string;
  toolCalls?: any[];
}

const fake = {
  defaultThreadId: 42 as number | null,
  existingTodayBriefs: [] as Array<{ id: number }>,
  buckets: {
    tax_reserve: 800_000,
    refund_reserve: 200_000,
    profit_reserve: 1_500_000,
    owner_draw: -500_000,
    opex_available: 250_000,
  } as Record<string, number>,
  mrr30dCents: 250_000,
  pendingDecisions: 3,
  unresolvedDlq: 2,
  perOrgRevenue: [] as Array<{ orgId: number; total: number }>,
  perOrgOpex: [] as Array<{ orgId: number; total: number }>,
  orgNames: [] as Array<{ id: number; name: string }>,
  founderUserIds: ["founder-a"],
  inserted: [] as FakeMessage[],
  // Sequence index for financialLedger calls (same table queried 4x).
  ledgerSeq: 0,
};

const LEDGER_SEQUENCE = [
  "financial_ledger:buckets",
  "financial_ledger:mrr",
  "financial_ledger:perOrgRevenue",
  "financial_ledger:perOrgOpex",
];

function rowsForTag(tag: string): any[] {
  switch (tag) {
    case "ai_conversations":
      return fake.defaultThreadId != null ? [{ id: fake.defaultThreadId }] : [];
    case "ai_messages":
      return fake.existingTodayBriefs;
    case "financial_ledger:buckets":
      return Object.entries(fake.buckets).map(([bucket, total]) => ({ bucket, total }));
    case "financial_ledger:mrr":
      return [{ total: fake.mrr30dCents }];
    case "financial_ledger:perOrgRevenue":
      return fake.perOrgRevenue;
    case "financial_ledger:perOrgOpex":
      return fake.perOrgOpex;
    case "organizations:byIds":
      return fake.orgNames;
    case "decisions_inbox_items":
      return Array.from({ length: fake.pendingDecisions }, (_, i) => ({ id: i + 1 }));
    case "outbox_dlq":
      return Array.from({ length: fake.unresolvedDlq }, (_, i) => ({ id: i + 1 }));
    case "founder_audit":
      return [];
    case "team_members_join":
      return fake.founderUserIds.map((u) => ({ userId: u }));
    default:
      return [];
  }
}

function makeChain(tag: string): any {
  const promise = (): Promise<any[]> => Promise.resolve(rowsForTag(tag));
  const chain: any = {
    where: () => chain,
    innerJoin: () => chain,
    orderBy: () => chain,
    groupBy: () => chain,
    limit: () => promise(),
    then: (resolve: any, reject?: any) => promise().then(resolve, reject),
    catch: (fn: any) => promise().catch(fn),
  };
  return chain;
}

function fakeFromTagged(table: any): any {
  return makeChain(table.__tag);
}

function fakeInsert(_table: any) {
  return {
    values(row: any) {
      const msg: FakeMessage = {
        conversationId: row.conversationId,
        role: row.role,
        content: row.content,
        toolCalls: row.toolCalls,
      };
      fake.inserted.push(msg);
      return {
        returning: () => Promise.resolve([{ id: 100 + fake.inserted.length }]),
        then: (fn: any) => Promise.resolve(fn(undefined)),
      };
    },
  };
}

function fakeUpdate(_table: any) {
  return { set: () => ({ where: () => Promise.resolve() }) };
}

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({ from: (t: any) => fakeFromTagged(t) }),
    selectDistinct: () => ({ from: (t: any) => fakeFromTagged(t) }),
    insert: (t: any) => fakeInsert(t),
    update: (t: any) => fakeUpdate(t),
  },
}));

vi.mock("@shared/schema", async () => {
  const actual: any = await vi.importActual("@shared/schema");
  function tag(name: string, base: any) {
    return new Proxy(base, {
      get(target, prop) {
        if (prop === "__tag") return name;
        return target[prop as keyof typeof target];
      },
    });
  }
  const ledgerProxy: any = new Proxy(actual.financialLedger, {
    get(target, prop) {
      if (prop === "__tag") {
        const t = LEDGER_SEQUENCE[Math.min(fake.ledgerSeq, LEDGER_SEQUENCE.length - 1)];
        fake.ledgerSeq += 1;
        return t;
      }
      return target[prop as keyof typeof target];
    },
  });
  return {
    ...actual,
    aiConversations: tag("ai_conversations", actual.aiConversations),
    aiMessages: tag("ai_messages", actual.aiMessages),
    decisionsInboxItems: tag("decisions_inbox_items", actual.decisionsInboxItems),
    outboxDlq: tag("outbox_dlq", actual.outboxDlq),
    financialLedger: ledgerProxy,
    founderAudit: tag("founder_audit", actual.founderAudit),
    organizations: tag("organizations:byIds", actual.organizations),
    teamMembers: tag("team_members_join", actual.teamMembers),
  };
});

vi.mock("../../server/services/aiRouter", () => ({
  routeAITask: vi.fn(async () => ({
    content:
      "Opex is thin at $2,500. Three decisions waiting, two DLQ rows. No net-negative orgs yet. Hit /buckets first.",
  })),
  TaskComplexity: { MODERATE: "moderate" },
}));

beforeEach(() => {
  fake.existingTodayBriefs = [];
  fake.inserted = [];
  fake.ledgerSeq = 0;
  fake.defaultThreadId = 42;
});

describe("morningBrief.runMorningBriefForFounder", () => {
  it("inserts a brief_card message with the five required sections", async () => {
    const mod = await import("../../server/jobs/morningBrief");
    const r = await mod.runMorningBriefForFounder("founder-a");

    expect(r.skipped).toBeUndefined();
    expect(r.threadId).toBe(42);
    expect(r.briefArtifact?.type).toBe("brief_card");

    const titles = r.briefArtifact?.sections.map((s) => s.title);
    expect(titles).toEqual([
      "Buckets",
      "Active triggers",
      "Decision queue",
      "DLQ",
      "Net-negative orgs",
    ]);

    for (const s of r.briefArtifact?.sections ?? []) {
      expect(typeof s.markdown).toBe("string");
      expect(typeof s.headline).toBe("string");
    }

    const buckets = r.briefArtifact?.sections.find((s) => s.title === "Buckets");
    expect(buckets?.headline).toContain("$");

    expect(fake.inserted.length).toBe(1);
    const persisted = fake.inserted[0];
    expect(persisted.role).toBe("assistant");
    expect(persisted.conversationId).toBe(42);
    expect(persisted.toolCalls?.[0]?.kind).toBe("morning_brief");
  });

  it("dedupes when a brief was already posted today", async () => {
    fake.existingTodayBriefs = [{ id: 999 }];
    const mod = await import("../../server/jobs/morningBrief");
    const r = await mod.runMorningBriefForFounder("founder-a");
    expect(r.skipped).toBe("already_posted_today");
    expect(fake.inserted.length).toBe(0);
  });

  it("returns skipped='no_default_thread' when no thread exists", async () => {
    fake.defaultThreadId = null;
    const mod = await import("../../server/jobs/morningBrief");
    const r = await mod.runMorningBriefForFounder("ghost");
    expect(r.skipped).toBe("no_default_thread");
    expect(fake.inserted.length).toBe(0);
  });

  it("force=true bypasses the dedupe", async () => {
    fake.existingTodayBriefs = [{ id: 999 }];
    const mod = await import("../../server/jobs/morningBrief");
    const r = await mod.runMorningBriefForFounder("founder-a", { force: true });
    expect(r.skipped).toBeUndefined();
    expect(fake.inserted.length).toBe(1);
  });
});
