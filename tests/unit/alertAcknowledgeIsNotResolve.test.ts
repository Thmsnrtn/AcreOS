/**
 * DEFECT-0135 — an automated "acknowledge" does not close, reopen, or invent.
 *
 * The decision executor's acknowledgement wrote status "resolved" (closing an
 * alert nobody fixed) and a column system_alerts does not have (behind an
 * `as any`), and reported success on zero rows. The Atlas
 * `acknowledge_incident` executor — the path that actually fires, from
 * sentinel reactions and founder approvals — set "acknowledged" with no
 * status predicate, so it REOPENED resolved and dismissed alerts, and also
 * reported success for an id that matched nothing. Both now call
 * acknowledgeSystemAlert (server/services/alertAcknowledge.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

type Cond = { op: "eq"; col: { name: string }; val: unknown } | { op: "and"; c: Cond[] };
const h = vi.hoisted(() => ({ rows: new Map<number, Record<string, unknown>>() }));

vi.mock("drizzle-orm", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  eq: (col: { name: string }, val: unknown) => ({ op: "eq", col, val }),
  and: (...c: Cond[]) => ({ op: "and", c }),
}));
const matches = (row: Record<string, unknown>, c: Cond): boolean =>
  c.op === "and" ? c.c.every((x) => matches(row, x)) : row[c.col.name] === c.val;

vi.mock("../../server/db", () => ({
  db: {
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: Cond) => ({
          returning: async () => {
            const hit: Array<{ id: number }> = [];
            for (const row of h.rows.values()) {
              if (matches(row, cond)) {
                Object.assign(row, { status: patch.status, acknowledgedAt: patch.acknowledgedAt });
                hit.push({ id: row.id as number });
              }
            }
            return hit;
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: (cond: Cond) => ({
          limit: async () => [...h.rows.values()].filter((r) => matches(r, cond)).map((r) => ({ status: r.status })),
        }),
      }),
    }),
  },
}));

import { acknowledgeSystemAlert } from "../../server/services/alertAcknowledge";

beforeEach(() => {
  h.rows.clear();
  h.rows.set(1, { id: 1, status: "new" });
  h.rows.set(2, { id: 2, status: "resolved" });
});

describe("DEFECT-0135 — acknowledgeSystemAlert", () => {
  it("acknowledges a new alert and leaves it open", async () => {
    const r = await acknowledgeSystemAlert(1, "test");
    expect(r.success).toBe(true);
    expect(h.rows.get(1)!.status).toBe("acknowledged");
  });

  it("never reopens a resolved alert", async () => {
    const r = await acknowledgeSystemAlert(2, "test");
    expect(r.success).toBe(false);
    expect(r.detail).toMatch(/already resolved/);
    expect(h.rows.get(2)!.status).toBe("resolved");
  });

  it("does not report success for an alert that does not exist", async () => {
    const r = await acknowledgeSystemAlert(99, "test");
    expect(r.success).toBe(false);
    expect(r.detail).toMatch(/not found/);
  });
});

describe("DEFECT-0135 — every acknowledger goes through it", () => {
  const ACKNOWLEDGERS: Array<{ file: string; from: string; to: string }> = [
    { file: "server/services/autonomousDecisionExecutor.ts", from: "async function executeAlertAcknowledgement(", to: "async function executeFeatureRequestApproval(" },
    { file: "server/services/agentActionExecutors.ts", from: '"acknowledge_incident"', to: "Oracle Analytics Executors" },
    // The founder's manual acknowledge (independent audit, 2026-09-28).
    { file: "server/routes-admin.ts", from: '"/api/admin/alerts/:id/acknowledge"', to: '"/api/admin/alerts/:id/resolve"' },
  ];
  // POPULATION: every `update(systemAlerts)` in server/ that writes
  // "acknowledged" must carry the only-a-NEW-alert predicate. The three
  // named units above were the population until `acknowledgeAllAlerts` was
  // found reopening dismissed alerts through `ne(resolved) AND
  // ne(acknowledged)` — a writer no list named.
  it("every systemAlerts writer that acknowledges moves only a NEW alert", () => {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const files = execSync("git ls-files 'server/**/*.ts'", { cwd: resolve(__dirname, "../.."), encoding: "utf8" })
      .split("\n")
      .filter((f) => f && !f.includes(".test."));
    let writers = 0;
    let acknowledgers = 0;
    for (const f of files) {
      const src = stripComments(readFileSync(resolve(__dirname, "../..", f), "utf8"));
      let at = src.indexOf("update(systemAlerts)");
      while (at !== -1) {
        writers++;
        const end = src.indexOf(";", at);
        const chain = src.slice(at, end === -1 ? undefined : end);
        if (/status:\s*["']acknowledged["']/.test(chain)) {
          acknowledgers++;
          expect(chain, `${f}: acknowledges without eq(systemAlerts.status, "new")`).toMatch(
            /eq\(systemAlerts\.status,\s*["']new["']\)/,
          );
        }
        at = src.indexOf("update(systemAlerts)", at + 1);
      }
    }
    // Vacuity floors: the scan found the writers, and at least the shared
    // helper and acknowledge-all among them.
    expect(writers).toBeGreaterThanOrEqual(8);
    expect(acknowledgers).toBeGreaterThanOrEqual(2);
  }, REPO_SWEEP_TIMEOUT_MS);

  for (const a of ACKNOWLEDGERS) {
    it(`${a.file} delegates and writes no alert status itself`, () => {
      const raw = readFileSync(resolve(__dirname, "../..", a.file), "utf8");
      const start = raw.indexOf(a.from);
      const end = raw.indexOf(a.to, start);
      expect(start, "unit not found (vacuity)").toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const body = stripComments(raw.slice(start, end));
      expect(body).toMatch(/acknowledgeSystemAlert\(/);
      expect(body).not.toMatch(/update\(systemAlerts\)|"resolved"|resolutionNotes/);
    });
  }
});
