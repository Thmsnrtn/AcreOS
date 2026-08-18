/**
 * A compliance alert is resolved, or the record does not say it was.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `PATCH /alerts/:id/resolve` called
 *
 *     complianceAI.resolveAlert(alertId, resolution)
 *
 * against a service signature of
 *
 *     resolveAlert(organizationId: number, alertId: string)
 *
 * Both slots accepted what was passed. `alertId` is a `parseInt` number and
 * fits `organizationId: number`; `resolution` comes off `req.body` as `any` and
 * fits `alertId: string`. So it type-checked cleanly, and the query became:
 *
 *     WHERE id = parseInt(<the resolution text>)   -- NaN
 *       AND organization_id = <the alert's id>
 *
 * The update matched nothing. The alert was never resolved. And the route then
 * wrote an audit-log entry recording `resolved: true` and answered
 * `{ success: true }` — a compliance record asserting an event that did not
 * happen, on the one surface whose whole job is to be trustworthy.
 *
 * This is the SECOND argument-order bug of this exact shape found in this
 * sweep; the first was `suggestOfferRange(leadId, propertyId)` against
 * `(propertyId, signals)`. Both were invisible because a positional signature
 * of compatible types accepts a swap, and `req.body` is `any`.
 *
 * ── THE FIX IS SHAPE, NOT CARE ──────────────────────────────────────────────
 * Two numbers in a row can always be swapped again by the next caller. The
 * argument is a named object, so a swap is a compile error rather than a
 * silent no-op. And `resolveAlert` returns whether a row was actually
 * resolved, because an update that matched nothing is not a resolution and the
 * caller has to be able to tell.
 */

import { describe, it, expect, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

function bound(node: unknown, column: string): unknown[] {
  const out: unknown[] = [];
  const tokens: Array<{ kind: "col" | "param"; v: unknown }> = [];
  const walk = (n: any): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n.name === "string" && n.table !== undefined) { tokens.push({ kind: "col", v: n.name }); return; }
    if ("encoder" in n && "value" in n) { tokens.push({ kind: "param", v: n.value }); return; }
    if (Array.isArray(n.queryChunks)) { n.queryChunks.forEach(walk); return; }
  };
  walk(node);
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].kind === "col" && tokens[i].v === column && tokens[i + 1].kind === "param") {
      out.push(tokens[i + 1].v);
    }
  }
  return out;
}

const OWNER = 7;

/** Answers the update only when it names the owning org AND a real alert id. */
async function resolve(args: { organizationId: number; alertId: number }) {
  vi.resetModules();
  let where: unknown;
  vi.doMock("../../server/db", () => ({
    db: {
      update: (t: any) => {
        const table = getTableName(t);
        const self: any = {
          set() { return self; },
          where(p: SQL) { where = p; return self; },
          returning() { return self; },
          then(res: (v: unknown) => void) {
            const orgs = bound(where, "organization_id");
            const ids = bound(where, "id");
            const hit = table === "compliance_alerts" && orgs.includes(OWNER) && ids.includes(55);
            res(hit ? [{ id: 55 }] : []);
          },
        };
        return self;
      },
    },
  }));
  const { complianceAI } = await import("../../server/services/complianceAI");
  const resolved = await complianceAI.resolveAlert(args);
  return { resolved, where };
}

describe("resolveAlert reports what it actually did", () => {
  it("RESOLVES the owning organization's alert and says so", async () => {
    const { resolved } = await resolve({ organizationId: OWNER, alertId: 55 });
    expect(resolved, "a real resolution reported failure").toBe(true);
  });

  it("RETURNS FALSE when nothing matched, rather than claiming success", async () => {
    // Another org's alert id: the update matches nothing. Before the fix the
    // caller could not tell this from a real resolution.
    const { resolved } = await resolve({ organizationId: 99, alertId: 55 });
    expect(resolved, "an update that matched nothing was reported as a resolution").toBe(false);
  });

  it("binds the organization AND the alert id — not one standing in for the other", async () => {
    const { where } = await resolve({ organizationId: OWNER, alertId: 55 });
    expect(bound(where, "organization_id")).toContain(OWNER);
    expect(bound(where, "id")).toContain(55);
    // The old bug put the alert id in the organization slot; assert it is not
    // there, or a swap that happened to use the same number would pass.
    expect(bound(where, "organization_id")).not.toContain(55);
  });
});

describe("the route cannot record a resolution that did not happen", () => {
  const SRC = fs.readFileSync(
    path.resolve(__dirname, "../../server/routes-compliance.ts"),
    "utf8",
  );
  const handler = (() => {
    const at = SRC.indexOf("'/alerts/:id/resolve'");
    return SRC.slice(at, at + 1600);
  })();

  it("the handler exists and is the one being checked", () => {
    // Vacuity guard: an empty slice would satisfy every `toMatch` below only if
    // they were negated, so pin that the real call is in here.
    expect(handler).toContain("complianceAI.resolveAlert");
  });

  it("CALLS resolveAlert with a named object, not two positional numbers", () => {
    // The structural half of the fix. A positional pair of compatible types is
    // what let the swap through in the first place.
    expect(handler).toMatch(/resolveAlert\(\{/);
    expect(handler).toMatch(/organizationId:\s*org\.id/);
    expect(handler).toMatch(/alertId,?/);
  });

  it("REFUSES before writing the audit entry when nothing was resolved", () => {
    const guardAt = handler.search(/if\s*\(!resolved\)/);
    const auditAt = handler.indexOf("createAuditLogEntry");
    expect(guardAt, "no guard on the resolution result").toBeGreaterThan(-1);
    expect(auditAt, "the audit write is gone — re-adjudicate").toBeGreaterThan(-1);
    expect(
      guardAt,
      "the audit entry is written before the resolution is confirmed, so a " +
        "no-op update still records `resolved: true`",
    ).toBeLessThan(auditAt);
  });
});
