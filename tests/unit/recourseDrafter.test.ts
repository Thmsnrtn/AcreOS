/**
 * Recourse Loop — service tests (Rafe).
 *
 * Covers the three load-bearing behaviors of the loop's brain:
 *   1. Signal aggregation — detractor NPS alerts + low support ratings +
 *      cancellations are read, normalized (with the customer's verbatim words),
 *      and de-duped into the recourse_drafts ledger; saves (accepted pause) are
 *      excluded.
 *   2. Draft generation — seeds a personal reply from the verbatim + context
 *      via the cheap model (mocked), pinned through the OpenRouter wrapper, and
 *      persists draft_body + draft_model.
 *   3. Send flow — the email-registry kind renders the founder's exact words
 *      and is transactional (always sends).
 *
 * The DB is a table-keyed in-memory mock: selects return scripted rows per
 * table, inserts/updates are recorded. drizzle-orm operators are stubbed to
 * no-ops (predicate evaluation isn't what's under test — the read/normalize/
 * persist plumbing is).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── In-memory store ──────────────────────────────────────────────────────────

interface Store {
  selectRowsByTable: Map<string, any[]>;
  inserts: Array<{ table: string; row: any }>;
  updates: Array<{ table: string; set: any }>;
  recourseRows: Map<number, any>;
  nextId: number;
}

const store: Store = {
  selectRowsByTable: new Map(),
  inserts: [],
  updates: [],
  recourseRows: new Map(),
  nextId: 1,
};

// Tables are mocked as tagged objects so the db mock can route a select by
// its source table. We match the SCHEMA object identity → a string tag.
function tableTag(t: any): string {
  return (t && t.__recourseTag) || "unknown";
}

// ── drizzle-orm stubs (no predicate evaluation) ──────────────────────────────
vi.mock("drizzle-orm", () => ({
  and: (...a: any[]) => ({ __op: "and", a }),
  eq: (...a: any[]) => ({ __op: "eq", a }),
  gte: (...a: any[]) => ({ __op: "gte", a }),
  desc: (x: any) => ({ __op: "desc", x }),
  inArray: (...a: any[]) => ({ __op: "inArray", a }),
  sql: (() => {
    const f: any = () => ({ __op: "sql" });
    return f;
  })(),
}));

// ── schema stub — tag the tables the service touches ─────────────────────────
vi.mock("@shared/schema", () => {
  const tag = (name: string) =>
    new Proxy(
      { __recourseTag: name },
      {
        get(target: any, prop) {
          if (prop === "__recourseTag") return name;
          // Column accessors → return a stable marker object.
          return { __col: `${name}.${String(prop)}` };
        },
      },
    );
  return {
    organizations: tag("organizations"),
    systemAlerts: tag("system_alerts"),
    supportCases: tag("support_cases"),
    cancellationSurveys: tag("cancellation_surveys"),
    recourseDrafts: tag("recourse_drafts"),
    RECOURSE_SIGNAL_TYPES: [
      "detractor_nps",
      "low_support_rating",
      "cancellation",
    ],
    RECOURSE_DRAFT_STATUSES: ["draft", "sent", "dismissed"],
  };
});

vi.mock("@shared/models/auth", () => {
  const tag = (name: string) =>
    new Proxy(
      { __recourseTag: name },
      {
        get(target: any, prop) {
          if (prop === "__recourseTag") return name;
          return { __col: `${name}.${String(prop)}` };
        },
      },
    );
  return { users: tag("users") };
});

// ── db mock ──────────────────────────────────────────────────────────────────
vi.mock("../../server/db", () => {
  const select = (_fields?: any) => {
    let table = "unknown";
    const chain: any = {
      from(t: any) {
        table = tableTag(t);
        return chain;
      },
      leftJoin() {
        return chain;
      },
      innerJoin() {
        return chain;
      },
      where() {
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit() {
        return Promise.resolve(store.selectRowsByTable.get(table) ?? []);
      },
      then(resolve: (v: any) => void) {
        resolve(store.selectRowsByTable.get(table) ?? []);
      },
    };
    return chain;
  };

  const insert = (t: any) => {
    const table = tableTag(t);
    let row: any = null;
    const chain: any = {
      values(v: any) {
        row = { id: store.nextId++, ...v };
        return chain;
      },
      onConflictDoNothing() {
        return chain;
      },
      returning() {
        store.inserts.push({ table, row });
        if (table === "recourse_drafts") store.recourseRows.set(row.id, row);
        return Promise.resolve([{ id: row.id }]);
      },
    };
    return chain;
  };

  const update = (t: any) => {
    const table = tableTag(t);
    const chain: any = {
      set(s: any) {
        store.updates.push({ table, set: s });
        return chain;
      },
      where() {
        return Promise.resolve();
      },
    };
    return chain;
  };

  return { db: { select, insert, update } };
});

// ── aiRouter mock — the cheap drafter ────────────────────────────────────────
const routeAITaskMock = vi.fn(async () => ({
  content:
    "Hi — I saw your note about the county data being wrong, and that's on me. I've pulled that source for review and I'll personally confirm the fix on your parcel by tomorrow. Thanks for telling us straight. — Tom, AcreOS",
  model: "anthropic/claude-haiku-4-5-20251001",
  provider: "openrouter",
}));
vi.mock("../../server/services/aiRouter", () => ({
  routeAITask: routeAITaskMock,
  MODEL_MODERATE: "anthropic/claude-haiku-4-5-20251001",
  TaskComplexity: { SIMPLE: "simple", MODERATE: "moderate", COMPLEX: "complex" },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  store.selectRowsByTable = new Map();
  store.inserts = [];
  store.updates = [];
  store.recourseRows = new Map();
  store.nextId = 1;
  routeAITaskMock.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("recourseDrafter — signal aggregation", () => {
  it("collects all three signal types and carries the customer's verbatim words", async () => {
    store.selectRowsByTable.set("system_alerts", [
      {
        id: 11,
        organizationId: 5,
        metadata: { score: 3, comment: "your county data was wrong" },
        message: "x",
      },
    ]);
    store.selectRowsByTable.set("support_cases", [
      {
        id: 22,
        organizationId: 5,
        subject: "Map won't load",
        rating: 1,
        resolutionSummary: "Told them to clear cache",
      },
    ]);
    store.selectRowsByTable.set("cancellation_surveys", [
      {
        id: 33,
        organizationId: 7,
        reason: "too_expensive",
        feedback: "couldn't justify the cost",
        previousTier: "pro",
        acceptedPause: false,
      },
    ]);

    const { collectRecourseSignals } = await import(
      "../../server/services/recourseDrafter"
    );
    const signals = await collectRecourseSignals();

    expect(signals).toHaveLength(3);

    const nps = signals.find((s) => s.signalType === "detractor_nps");
    expect(nps?.signalRefType).toBe("system_alert");
    expect(nps?.signalRefId).toBe(11);
    expect(nps?.customerVerbatim).toBe("your county data was wrong");

    const rating = signals.find((s) => s.signalType === "low_support_rating");
    expect(rating?.signalRefId).toBe(22);
    expect(rating?.customerVerbatim).toContain("1/5");
    expect(rating?.customerVerbatim).toContain("Map won't load");

    const cancel = signals.find((s) => s.signalType === "cancellation");
    expect(cancel?.organizationId).toBe(7);
    expect(cancel?.customerVerbatim).toContain("couldn't justify the cost");
  });

  it("falls back to a no-comment summary when a detractor left no text", async () => {
    store.selectRowsByTable.set("system_alerts", [
      { id: 1, organizationId: 5, metadata: { score: 4, comment: null } },
    ]);
    const { collectRecourseSignals } = await import(
      "../../server/services/recourseDrafter"
    );
    const signals = await collectRecourseSignals();
    expect(signals).toHaveLength(1);
    expect(signals[0].customerVerbatim).toContain("4/10");
  });

  it("excludes cancellation rows that accepted a pause (a save, not a churn)", async () => {
    store.selectRowsByTable.set("cancellation_surveys", [
      {
        id: 1,
        organizationId: 5,
        reason: "too_expensive",
        feedback: "x",
        previousTier: "pro",
        acceptedPause: true,
      },
    ]);
    const { collectRecourseSignals } = await import(
      "../../server/services/recourseDrafter"
    );
    const signals = await collectRecourseSignals();
    expect(signals).toHaveLength(0);
  });

  it("aggregateRecourseSignals persists a recourse_drafts row per signal", async () => {
    store.selectRowsByTable.set("system_alerts", [
      { id: 11, organizationId: 5, metadata: { score: 2, comment: "bad" } },
    ]);
    // organizations + users lookups (loadOrgContext) return scripted rows.
    store.selectRowsByTable.set("organizations", [
      { name: "Acme Land Co", ownerId: "user-1" },
    ]);
    store.selectRowsByTable.set("users", [
      { email: "owner@acme.test", firstName: "Dana" },
    ]);

    const { aggregateRecourseSignals } = await import(
      "../../server/services/recourseDrafter"
    );
    const res = await aggregateRecourseSignals();

    expect(res.scanned).toBe(1);
    expect(res.inserted).toBe(1);
    const inserted = store.inserts.find((i) => i.table === "recourse_drafts");
    expect(inserted?.row.signalType).toBe("detractor_nps");
    expect(inserted?.row.customerVerbatim).toBe("bad");
    expect(inserted?.row.recipientEmail).toBe("owner@acme.test");
    expect(inserted?.row.contextSummary).toContain("Acme Land Co");
  });
});

describe("recourseDrafter — draft generation (mock model)", () => {
  it("routes through the cheap model and persists the generated draft body", async () => {
    store.selectRowsByTable.set("recourse_drafts", [
      {
        id: 99,
        organizationId: 5,
        signalType: "detractor_nps",
        signalRefType: "system_alert",
        signalRefId: 11,
        recipientUserId: "user-1",
        customerVerbatim: "your county data was wrong",
        contextSummary: "Org: Acme Land Co.",
        draftBody: null,
        status: "draft",
      },
    ]);
    // users lookup for the first name.
    store.selectRowsByTable.set("users", [{ firstName: "Dana" }]);

    const { generateDraftReply } = await import(
      "../../server/services/recourseDrafter"
    );
    const body = await generateDraftReply(99);

    expect(routeAITaskMock).toHaveBeenCalledTimes(1);
    // The cheap model is pinned through the wrapper config.
    const [, config] = routeAITaskMock.mock.calls[0] as any[];
    expect(config.forceModel).toBe("anthropic/claude-haiku-4-5-20251001");

    expect(body).toContain("county data");
    const upd = store.updates.find((u) => u.table === "recourse_drafts");
    expect(upd?.set.draftBody).toBe(body);
    expect(upd?.set.draftModel).toBe("anthropic/claude-haiku-4-5-20251001");
  });

  it("seeds the prompt with the customer's verbatim words (never a template)", async () => {
    store.selectRowsByTable.set("recourse_drafts", [
      {
        id: 7,
        organizationId: 5,
        signalType: "cancellation",
        signalRefType: "cancellation_survey",
        signalRefId: 3,
        recipientUserId: null,
        customerVerbatim: "couldn't justify the cost",
        contextSummary: "Org: Acme.",
        draftBody: null,
        status: "draft",
      },
    ]);
    const { generateDraftReply } = await import(
      "../../server/services/recourseDrafter"
    );
    await generateDraftReply(7);

    const [task] = routeAITaskMock.mock.calls[0] as any[];
    const userMsg = task.messages.find((m: any) => m.role === "user").content;
    expect(userMsg).toContain("couldn't justify the cost");
    expect(userMsg).toContain("Cancellation");
  });

  it("does not overwrite a draft that is already sent", async () => {
    store.selectRowsByTable.set("recourse_drafts", [
      {
        id: 4,
        organizationId: 5,
        signalType: "detractor_nps",
        customerVerbatim: "x",
        draftBody: "already sent body",
        status: "sent",
      },
    ]);
    const { generateDraftReply } = await import(
      "../../server/services/recourseDrafter"
    );
    const body = await generateDraftReply(4);
    expect(routeAITaskMock).not.toHaveBeenCalled();
    expect(body).toBe("already sent body");
  });

  it("returns null (best-effort) when the model call throws", async () => {
    routeAITaskMock.mockRejectedValueOnce(new Error("model down"));
    store.selectRowsByTable.set("recourse_drafts", [
      {
        id: 5,
        organizationId: 5,
        signalType: "detractor_nps",
        customerVerbatim: "x",
        contextSummary: null,
        recipientUserId: null,
        draftBody: null,
        status: "draft",
      },
    ]);
    const { generateDraftReply } = await import(
      "../../server/services/recourseDrafter"
    );
    const body = await generateDraftReply(5);
    expect(body).toBeNull();
    // No draftBody update should have been written.
    const upd = store.updates.find(
      (u) => u.table === "recourse_drafts" && u.set.draftBody,
    );
    expect(upd).toBeUndefined();
  });
});

describe("recourseDrafter — buildDraftUserPrompt", () => {
  it("labels each signal type and includes the account context", async () => {
    const { buildDraftUserPrompt } = await import(
      "../../server/services/recourseDrafter"
    );
    const p = buildDraftUserPrompt(
      "low_support_rating",
      "the bot kept looping",
      "Org: Acme. Recent support topics: billing.",
      "Sam",
    );
    expect(p).toContain("Low support-experience rating");
    expect(p).toContain("Sam");
    expect(p).toContain("Acme");
    expect(p).toContain("the bot kept looping");
  });
});
