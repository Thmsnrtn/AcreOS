/**
 * DEFECT-0134 — a founder's cancel either stops the action or says it did not.
 *
 * The executor read the preview's status ('pending') and then executed. A
 * cancel landing in between updated the row to 'cancelled', the route
 * answered { ok: true }, the UI said "cancelled before it committed" — and
 * the action ran, after which recordResult overwrote 'cancelled' with
 * 'committed'. The executor now CLAIMS the row (pending → executing) in one
 * statement, cancel reports whether it changed anything, and a result is
 * written only onto the claimed row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

type Cond = { op: "eq"; col: { name: string }; val: unknown } | { op: "and"; c: Cond[] };
const h = vi.hoisted(() => ({ rows: new Map<number, Record<string, unknown>>(), nextId: 1 }));

vi.mock("drizzle-orm", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  eq: (col: { name: string }, val: unknown) => ({ op: "eq", col, val }),
  and: (...c: Cond[]) => ({ op: "and", c }),
}));

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (cond.op === "and") return cond.c.every((x) => matches(row, x));
  const key = cond.col.name === "id" ? "id" : cond.col.name;
  return row[key] === cond.val;
}

vi.mock("../../server/db", () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          const id = h.nextId++;
          h.rows.set(id, { ...v, id });
          return [{ id }];
        },
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: Cond) => {
          const apply = () => {
            const hit: Array<{ id: number }> = [];
            for (const row of h.rows.values()) {
              if (matches(row, cond)) {
                Object.assign(row, patch);
                hit.push({ id: row.id as number });
              }
            }
            return hit;
          };
          const p = { returning: async () => apply(), then: (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve(apply()).then(f, r) };
          return p;
        },
      }),
    }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  },
}));
vi.mock("../../server/services/founderSettings", () => ({ getNumberSetting: async () => 0 }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { beginActionPreview, cancelPreview } from "../../server/services/actionPreview";

const input = { decisionId: 1, agentCodename: "exec", itemType: "critical_alert", actionSummary: "ack" };

beforeEach(() => {
  h.rows.clear();
  h.nextId = 1;
});

describe("DEFECT-0134 — the preview cancel race", () => {
  it("a cancel after the executor claimed the action is refused, and the result stands", async () => {
    const p = await beginActionPreview(input);
    expect(await p.shouldProceed()).toBe(true);
    expect(await cancelPreview(p.previewId, "founder")).toBe(false);
    expect(h.rows.get(p.previewId)!.status).toBe("executing");
    await p.recordResult("committed", "done");
    expect(h.rows.get(p.previewId)!.status).toBe("committed");
  });

  it("a cancel before the claim wins: the executor does not proceed and the row stays cancelled", async () => {
    const p = await beginActionPreview(input);
    expect(await cancelPreview(p.previewId, "founder")).toBe(true);
    expect(await p.shouldProceed()).toBe(false);
    await p.recordResult("failed", "cancelled by founder");
    expect(h.rows.get(p.previewId)!.status).toBe("cancelled");
  });

  it("the route answers 409 when the cancel changed nothing", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/routes-founder-intelligence.ts"), "utf8"));
    const at = src.indexOf('"/action-previews/:id/cancel"');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, at + 1200);
    expect(body).toMatch(/const cancelled = await cancelPreview\(/);
    expect(body).toMatch(/if \(!cancelled\)[\s\S]{0,80}409/);
  });
});
