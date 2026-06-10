/**
 * T0-6 (elevation blueprint 2026-06-10): approval is bound to the exact draft
 * and is idempotent.
 *
 * The approve-and-send endpoint used to accept client-resupplied
 * subject/message (the human's tap blessed whatever the client sent) and a
 * double-tap sent twice. paxDraftService is the fix:
 *
 *   - upsertPendingDraft persists the draft at generation time (and reuses an
 *     identical pending row instead of minting a new approval target).
 *   - claimDraftForSend verifies draftId + content hash against the STORED
 *     row and atomically transitions pending→sent (WHERE status='pending') —
 *     exactly one approval wins; the second tap gets "already_sent" with the
 *     first result.
 *   - recordDraftSendResult releases the claim on send failure so a failed
 *     send doesn't eat the draft.
 *
 * The db is a hand-rolled in-memory pax_drafts table (no pglite/pg-mem dep in
 * this repo): drizzle WHERE expressions are rendered to SQL via PgDialect and
 * interpreted as column/param equality pairs — enough to faithfully execute
 * every query shape paxDraftService emits, including the guarded UPDATE.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── In-memory pax_drafts table ───────────────────────────────────────────────

const mem = vi.hoisted(() => ({
  rows: [] as any[],
  nextId: 1,
}));

vi.mock("../../server/db", async () => {
  // (Async factory + local import: vi.mock factories are hoisted above the
  // module's imports, so nothing from the top level may be referenced here.)
  const { PgDialect } = await import("drizzle-orm/pg-core");

  const COLUMN_TO_PROP: Record<string, string> = {
    id: "id",
    organization_id: "organizationId",
    lead_id: "leadId",
    channel: "channel",
    to_address: "toAddress",
    subject: "subject",
    message: "message",
    content_hash: "contentHash",
    status: "status",
    sent_at: "sentAt",
    sent_message_id: "sentMessageId",
    created_at: "createdAt",
  };

  // Render a drizzle WHERE expression and interpret it as ANDed equality
  // pairs ("col" = $n). paxDraftService only ever emits that shape.
  const matcher = (expr: unknown) => {
    const dialect = new PgDialect();
    const { sql, params } = dialect.sqlToQuery(expr as any);
    const conds: Array<{ prop: string; value: unknown }> = [];
    const re = /"([a-z_]+)" = \$(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const prop = COLUMN_TO_PROP[m[1]];
      if (!prop) throw new Error(`paxDraftApproval mock: unmapped column ${m[1]}`);
      conds.push({ prop, value: params[Number(m[2]) - 1] });
    }
    if (conds.length === 0) throw new Error(`paxDraftApproval mock: no eq conditions in: ${sql}`);
    return (row: any) => conds.every((c) => row[c.prop] === c.value);
  };

  const db = {
    select: () => ({
      from: () => ({
        where: (expr: unknown) => {
          const pred = matcher(expr);
          const result = mem.rows.filter(pred).map((r) => ({ ...r }));
          return Object.assign(Promise.resolve(result), {
            limit: async (n: number) => result.slice(0, n),
          });
        },
      }),
    }),
    insert: () => ({
      values: (vals: any) => ({
        returning: async () => {
          const row = {
            channel: "email",
            subject: "",
            status: "pending",
            sentAt: null,
            sentMessageId: null,
            createdAt: new Date(),
            ...vals,
            id: mem.nextId++,
          };
          mem.rows.push(row);
          return [{ ...row }];
        },
      }),
    }),
    update: () => ({
      set: (vals: any) => ({
        where: (expr: unknown) => {
          const pred = matcher(expr);
          // Apply exactly once whether the chain ends at .where() (awaited
          // thenable, like recordDraftSendResult) or at .returning() (like
          // the guarded claim).
          let applied: any[] | null = null;
          const apply = () => {
            if (applied) return applied;
            applied = [];
            for (const row of mem.rows) {
              if (pred(row)) {
                Object.assign(row, vals);
                applied.push({ ...row });
              }
            }
            return applied;
          };
          return Object.assign(
            Promise.resolve().then(apply),
            { returning: async () => apply() },
          );
        },
      }),
    }),
  };
  return { db };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  draftContentHash,
  upsertPendingDraft,
  claimDraftForSend,
  recordDraftSendResult,
} from "../../server/services/paxDraftService";

const ORG = 7;

const draftParams = {
  organizationId: ORG,
  leadId: 42,
  channel: "email" as const,
  toAddress: "stale.lead@example.com",
  subject: "Following up on your land",
  message: "Hi Stale, just checking in.",
};

beforeEach(() => {
  mem.rows = [];
  mem.nextId = 1;
});

describe("upsertPendingDraft — one approval target per identical draft", () => {
  it("persists the draft with its content hash", async () => {
    const draft = await upsertPendingDraft(draftParams);
    expect(draft.id).toBe(1);
    expect(draft.status).toBe("pending");
    expect(draft.contentHash).toBe(
      draftContentHash(draftParams.subject, draftParams.message),
    );
  });

  it("reuses an identical pending draft instead of minting a new one", async () => {
    const first = await upsertPendingDraft(draftParams);
    const second = await upsertPendingDraft(draftParams);
    expect(second.id).toBe(first.id);
    expect(mem.rows).toHaveLength(1);
  });
});

describe("claimDraftForSend — approval bound to the exact draft", () => {
  it("rejects a hash that doesn't match the stored draft", async () => {
    const draft = await upsertPendingDraft(draftParams);
    const tampered = draftContentHash("Different subject", "Different body");

    const claim = await claimDraftForSend(ORG, draft.id, tampered);
    expect(claim.outcome).toBe("hash_mismatch");
    // Nothing transitioned — the draft is still approvable.
    expect(mem.rows[0].status).toBe("pending");
  });

  it("returns not_found for another org's draft id", async () => {
    const draft = await upsertPendingDraft(draftParams);
    const claim = await claimDraftForSend(999, draft.id, draft.contentHash);
    expect(claim.outcome).toBe("not_found");
  });
});

describe("claimDraftForSend — double-approve sends once (idempotency)", () => {
  it("first tap claims; second tap gets already_sent with the first result", async () => {
    const draft = await upsertPendingDraft(draftParams);

    // Simulate the route flow for the double-tap: the route only ever calls
    // the sender when the claim outcome is "claimed".
    const sender = vi.fn(async () => ({ success: true, messageId: "msg_1" }));

    const tap = async () => {
      const claim = await claimDraftForSend(ORG, draft.id, draft.contentHash);
      if (claim.outcome !== "claimed") return claim;
      const result = await sender();
      await recordDraftSendResult(ORG, draft.id, result);
      return claim;
    };

    const first = await tap();
    const second = await tap();

    expect(first.outcome).toBe("claimed");
    expect(second.outcome).toBe("already_sent");
    // THE invariant: the send fired exactly once.
    expect(sender).toHaveBeenCalledTimes(1);
    // And the second tap can return the first result.
    expect((second as any).draft.sentMessageId).toBe("msg_1");
    expect(mem.rows[0].status).toBe("sent");
  });

  it("a failed send releases the claim so the human can retry", async () => {
    const draft = await upsertPendingDraft(draftParams);

    const first = await claimDraftForSend(ORG, draft.id, draft.contentHash);
    expect(first.outcome).toBe("claimed");
    await recordDraftSendResult(ORG, draft.id, { success: false });

    expect(mem.rows[0].status).toBe("pending");
    expect(mem.rows[0].sentAt).toBeNull();

    // Retry succeeds.
    const second = await claimDraftForSend(ORG, draft.id, draft.contentHash);
    expect(second.outcome).toBe("claimed");
  });
});
