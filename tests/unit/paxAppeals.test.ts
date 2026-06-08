/**
 * Quinn (Chief of Alignment) + Rafe (CCO) — "appeal the AI" recourse loop.
 *
 * Covers the two load-bearing writes:
 *   1. Customer files an appeal (POST /api/pax/appeals) → one row in
 *      pax_decision_appeals linked to the refusal, status "open".
 *      Org scoping is enforced (a refusal in another org → 404).
 *      Re-appealing an already-appealed refusal → 400 (no dupes).
 *   2. Founder resolves an appeal (POST /api/founder/appeals/:id/resolve):
 *      - uphold + reverse both write the terminal status + reviewer + the
 *        customer-facing message, and fire the close-the-loop email.
 *      - a second resolve on an already-terminal appeal → 400 (no overwrite).
 *
 * The db is a hand-rolled chainable fake (mirrors routes-pax-disclosure.test.ts);
 * the email registry is mocked so we assert the loop closes without sending.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Auth + org middleware: pass-through stubs ─────────────────────────────────
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = req.user ?? { id: "user-1" };
    next();
  },
  requireFounder: (req: any, _res: any, next: any) => {
    req.isFounder = true;
    next();
  },
}));

vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organizationId = 1;
    req.organization = { id: 1, name: "Acme Land Co" };
    next();
  },
}));

// ── Email registry: capture sends without delivering ──────────────────────────
const sentEmails: Array<{ kind: string; props: any; options: any }> = [];
vi.mock("../../server/services/emailRegistry", () => ({
  sendRegisteredEmail: vi.fn(async (kind: string, props: any, options: any) => {
    sentEmails.push({ kind, props, options });
    return { success: true, kind, category: "transactional", attempts: 1 };
  }),
}));

// ── In-memory ledgers ─────────────────────────────────────────────────────────
interface RefusalRow {
  id: number;
  organizationId: number;
  conversationId: number | null;
  messageId: number | null;
  citedImmutableId: string;
  citedImmutableText: string | null;
  refusalText: string;
  severity: string;
  createdAt: Date;
}
interface AppealRow {
  id: number;
  organizationId: number;
  conversationId: number | null;
  messageId: number | null;
  refusalPayloadId: number;
  appealReason: string;
  appellantUserId: string | null;
  status: string;
  reviewerUserId: string | null;
  reviewNotes: string | null;
  customerMessage: string | null;
  reviewDecisionAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

let refusals: RefusalRow[] = [];
let appeals: AppealRow[] = [];
let nextAppealId = 1;

// Identify which table a drizzle table object refers to without importing the
// internal Symbol. We tag by a column we read off the select projection — but
// the route passes the table object itself to .from(); we discriminate by a
// best-effort name probe. Simpler: stash the last table handed to insert/from.
import { paxRefusalPayloads } from "../../shared/schema/pax-refusal-payloads";
import { paxDecisionAppeals } from "../../shared/schema/pax-decision-appeals";
import { organizations } from "../../shared/schema";
import { users } from "../../shared/models/auth";

function tableOf(t: any): "refusals" | "appeals" | "orgs" | "users" | "unknown" {
  if (t === paxRefusalPayloads) return "refusals";
  if (t === paxDecisionAppeals) return "appeals";
  if (t === organizations) return "orgs";
  if (t === users) return "users";
  return "unknown";
}

// A query plan captured across the chain, resolved on the terminal await.
vi.mock("../../server/db", () => {
  // SELECT builder — records the primary from-table + whether it's a join,
  // returns canned rows shaped loosely (the routes map fields by name).
  function makeSelect() {
    let fromTable: any = null;
    let isJoin = false;
    const builder: any = {
      from(t: any) {
        fromTable = t;
        return builder;
      },
      leftJoin() {
        isJoin = true;
        return builder;
      },
      innerJoin() {
        isJoin = true;
        return builder;
      },
      where() {
        return builder;
      },
      orderBy() {
        return builder;
      },
      limit() {
        return resolve();
      },
      then(onF: any, onR: any) {
        // Allow direct await without .limit() (org / user lookups use .limit,
        // but keep this defensive).
        return resolve().then(onF, onR);
      },
    };
    function resolve(): Promise<any[]> {
      const kind = tableOf(fromTable);
      if (kind === "refusals") {
        // GET /api/pax/refusals joins refusals → appeals.
        if (isJoin) {
          return Promise.resolve(
            refusals.map((r) => {
              const a = appeals.find((x) => x.refusalPayloadId === r.id) ?? null;
              return {
                refusalId: r.id,
                conversationId: r.conversationId,
                messageId: r.messageId,
                citedImmutableId: r.citedImmutableId,
                citedImmutableText: r.citedImmutableText,
                refusalText: r.refusalText,
                severity: r.severity,
                refusedAt: r.createdAt,
                appealId: a?.id ?? null,
                appealStatus: a?.status ?? null,
                appealReason: a?.appealReason ?? null,
                appealCustomerMessage: a?.customerMessage ?? null,
                appealResolvedAt: a?.reviewDecisionAt ?? null,
                appealCreatedAt: a?.createdAt ?? null,
              };
            }),
          );
        }
        // POST appeal: looks up a single refusal by id+org. The route's WHERE
        // is (id = ? AND organization_id = caller-org). The middleware stubs
        // the caller org to 1, so model that scoping here — a refusal in
        // another org must NOT be visible (the route then 404s).
        return Promise.resolve(
          refusals
            .filter((r) => r.organizationId === 1)
            .map((r) => ({
              id: r.id,
              conversationId: r.conversationId,
              messageId: r.messageId,
            })),
        );
      }
      if (kind === "appeals") {
        if (isJoin) {
          // GET /api/founder/appeals joins appeals → refusals (+org).
          return Promise.resolve(
            appeals.map((a) => {
              const r = refusals.find((x) => x.id === a.refusalPayloadId)!;
              return {
                appealId: a.id,
                organizationId: a.organizationId,
                orgName: "Acme Land Co",
                status: a.status,
                appealReason: a.appealReason,
                appellantUserId: a.appellantUserId,
                filedAt: a.createdAt,
                reviewNotes: a.reviewNotes,
                customerMessage: a.customerMessage,
                resolvedAt: a.reviewDecisionAt,
                refusalId: r.id,
                citedImmutableId: r.citedImmutableId,
                citedImmutableText: r.citedImmutableText,
                refusalText: r.refusalText,
                severity: r.severity,
                refusedAt: r.createdAt,
              };
            }),
          );
        }
        // Single appeal lookups: dupe-check (POST appeal) + resolve lookup.
        return Promise.resolve(
          appeals.map((a) => ({
            id: a.id,
            organizationId: a.organizationId,
            status: a.status,
            appellantUserId: a.appellantUserId,
          })),
        );
      }
      if (kind === "orgs") {
        return Promise.resolve([{ ownerId: "owner-1" }]);
      }
      if (kind === "users") {
        return Promise.resolve([
          { email: "buyer@example.com", firstName: "Jo" },
        ]);
      }
      return Promise.resolve([]);
    }
    return builder;
  }

  function makeInsert(table: any) {
    return {
      values(vals: any) {
        const kind = tableOf(table);
        if (kind === "appeals") {
          const row: AppealRow = {
            id: nextAppealId++,
            organizationId: vals.organizationId,
            conversationId: vals.conversationId ?? null,
            messageId: vals.messageId ?? null,
            refusalPayloadId: vals.refusalPayloadId,
            appealReason: vals.appealReason,
            appellantUserId: vals.appellantUserId ?? null,
            status: vals.status ?? "open",
            reviewerUserId: null,
            reviewNotes: null,
            customerMessage: null,
            reviewDecisionAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          appeals.push(row);
          const result: any = Promise.resolve(undefined);
          result.returning = () =>
            Promise.resolve([
              { id: row.id, status: row.status, createdAt: row.createdAt },
            ]);
          return result;
        }
        const result: any = Promise.resolve(undefined);
        result.returning = () => Promise.resolve([]);
        return result;
      },
    };
  }

  function makeUpdate(table: any) {
    return {
      set(vals: any) {
        return {
          where() {
            const kind = tableOf(table);
            if (kind === "appeals") {
              // Apply to the most recently created non-terminal appeal that
              // matches — the route guards status in WHERE; mirror that.
              for (const a of appeals) {
                if (a.status === "open" || a.status === "under_review") {
                  Object.assign(a, vals);
                }
              }
            }
            return Promise.resolve();
          },
        };
      },
    };
  }

  return {
    db: {
      select: () => makeSelect(),
      insert: (table: any) => makeInsert(table),
      update: (table: any) => makeUpdate(table),
    },
  };
});

// Import routes AFTER mocks.
import { registerPaxAppealRoutes } from "../../server/routes-pax-appeals";
import { registerFounderAppealRoutes } from "../../server/routes-founder-appeals";

function makeApp() {
  const app = express();
  app.use(express.json());
  registerPaxAppealRoutes(app);
  registerFounderAppealRoutes(app);
  return app;
}

function seedRefusal(over: Partial<RefusalRow> = {}): RefusalRow {
  const r: RefusalRow = {
    id: over.id ?? 100,
    organizationId: over.organizationId ?? 1,
    conversationId: over.conversationId ?? 7,
    messageId: over.messageId ?? 42,
    citedImmutableId: over.citedImmutableId ?? "customer:12",
    citedImmutableText:
      over.citedImmutableText ??
      "Pax is a tool, never a fiduciary advisor — it won't tell you whether to buy.",
    refusalText:
      over.refusalText ?? "I can't tell you whether to buy this parcel.",
    severity: over.severity ?? "warn",
    createdAt: over.createdAt ?? new Date(),
  };
  refusals.push(r);
  return r;
}

beforeEach(() => {
  refusals = [];
  appeals = [];
  nextAppealId = 1;
  sentEmails.length = 0;
});

describe("POST /api/pax/appeals (customer files an appeal)", () => {
  it("writes an open appeal linked to the refusal", async () => {
    seedRefusal({ id: 100 });
    const res = await request(makeApp())
      .post("/api/pax/appeals")
      .send({ refusalPayloadId: 100, appealReason: "I only asked for the data, not advice." });

    expect(res.status).toBe(201);
    expect(res.body.appeal).toMatchObject({ status: "open" });
    expect(appeals).toHaveLength(1);
    expect(appeals[0]).toMatchObject({
      refusalPayloadId: 100,
      organizationId: 1,
      appellantUserId: "user-1",
      status: "open",
      appealReason: "I only asked for the data, not advice.",
    });
  });

  it("rejects an empty appealReason (422)", async () => {
    seedRefusal({ id: 100 });
    const res = await request(makeApp())
      .post("/api/pax/appeals")
      .send({ refusalPayloadId: 100, appealReason: "   " });
    expect(res.status).toBe(422);
    expect(appeals).toHaveLength(0);
  });

  it("404s when the refusal is not in the caller's org", async () => {
    seedRefusal({ id: 100, organizationId: 999 });
    const res = await request(makeApp())
      .post("/api/pax/appeals")
      .send({ refusalPayloadId: 100, appealReason: "wrong call" });
    expect(res.status).toBe(404);
    expect(appeals).toHaveLength(0);
  });

  it("rejects a second appeal on the same refusal (400 — no dupes)", async () => {
    seedRefusal({ id: 100 });
    const app = makeApp();
    const first = await request(app)
      .post("/api/pax/appeals")
      .send({ refusalPayloadId: 100, appealReason: "first" });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/pax/appeals")
      .send({ refusalPayloadId: 100, appealReason: "again" });
    expect(second.status).toBe(400);
    expect(appeals).toHaveLength(1);
  });
});

describe("POST /api/founder/appeals/:id/resolve (uphold / reverse)", () => {
  function seedOpenAppeal() {
    const r = seedRefusal({ id: 100 });
    appeals.push({
      id: nextAppealId++,
      organizationId: 1,
      conversationId: r.conversationId,
      messageId: r.messageId,
      refusalPayloadId: r.id,
      appealReason: "I only wanted the data.",
      appellantUserId: "user-1",
      status: "open",
      reviewerUserId: null,
      reviewNotes: null,
      customerMessage: null,
      reviewDecisionAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return appeals[appeals.length - 1];
  }

  it("reverses an appeal, records the outcome, and closes the loop by email", async () => {
    const a = seedOpenAppeal();
    const res = await request(makeApp())
      .post(`/api/founder/appeals/${a.id}/resolve`)
      .send({
        decision: "reversed",
        reviewNotes: "Customer is right — Pax over-refused a pure data request.",
        customerMessage: "You were right. We've reversed this — ask again and Pax will pull the data.",
      });

    expect(res.status).toBe(200);
    expect(res.body.appeal.status).toBe("reversed");
    expect(res.body.notification.emailStatus).toBe("sent");

    // Ledger updated with the terminal status + reviewer + customer message.
    expect(a.status).toBe("reversed");
    expect(a.reviewerUserId).toBe("user-1");
    expect(a.customerMessage).toContain("reversed");
    expect(a.reviewDecisionAt).toBeInstanceOf(Date);

    // Loop closed via the registry with the appeal_outcome kind.
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].kind).toBe("appeal_outcome");
    expect(sentEmails[0].props.decision).toBe("reversed");
    expect(sentEmails[0].options.to).toBe("buyer@example.com");
  });

  it("upholds an appeal and still notifies the customer", async () => {
    const a = seedOpenAppeal();
    const res = await request(makeApp())
      .post(`/api/founder/appeals/${a.id}/resolve`)
      .send({
        decision: "upheld",
        reviewNotes: "Refusal was correct — this was an advice request.",
        customerMessage: "We looked again. Pax can't tell you whether to buy, but it can pull every comp.",
      });

    expect(res.status).toBe(200);
    expect(res.body.appeal.status).toBe("upheld");
    expect(a.status).toBe("upheld");
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].props.decision).toBe("upheld");
  });

  it("rejects resolving an already-terminal appeal (400 — no overwrite)", async () => {
    const a = seedOpenAppeal();
    a.status = "upheld";
    const res = await request(makeApp())
      .post(`/api/founder/appeals/${a.id}/resolve`)
      .send({
        decision: "reversed",
        reviewNotes: "trying to flip it",
        customerMessage: "changed my mind",
      });
    expect(res.status).toBe(400);
    expect(a.status).toBe("upheld"); // unchanged
    expect(sentEmails).toHaveLength(0);
  });

  it("requires both reviewNotes and customerMessage (422)", async () => {
    const a = seedOpenAppeal();
    const res = await request(makeApp())
      .post(`/api/founder/appeals/${a.id}/resolve`)
      .send({ decision: "reversed", reviewNotes: "", customerMessage: "" });
    expect(res.status).toBe(422);
    expect(a.status).toBe("open");
  });
});
