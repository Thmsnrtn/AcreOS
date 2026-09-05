/**
 * A credential lookup keyed only on service name is a secret waiting to cross a tenant.
 *
 * `integration_credentials.org_id` is nullable with no foreign key — a TAG, not
 * a tenant key — and `service_name` carries no unique constraint, so two rows
 * can share one name. Every read in the v12 integration executor was
 *
 *     .where(eq(integrationCredentials.serviceName, serviceName)).limit(1)
 *
 * with no `orderBy`. That is not "the platform credential"; it is an ARBITRARY
 * row among however many share the name. `execute` then base64-decodes
 * `encryptedValue` and sends it as `Authorization: Bearer` to a caller-supplied
 * absolute endpoint — so the first per-org credential ever registered makes a
 * cross-tenant secret disclosure a coin flip.
 *
 * LATENT, NOT LIVE, and the distinction is why this is scoped rather than left
 * alone: every row today is a founder-registered platform credential. But
 * `registerCredential` IS wired — `POST /api/founder/v12/integrations`, taking
 * `req.body` unvalidated — so `orgId` can be set today and the column is not
 * guaranteed null. A register note claiming otherwise named a function
 * (`createCredential`) that does not exist in this file.
 *
 * The rule this pins:
 *   READS  an org sees its OWN credential and the platform fallback, in that
 *          order, and never another org's.
 *   WRITES take the lane EXACTLY — no fallback. `resetCircuitBreaker` cleared
 *          every row sharing the service name, in every lane.
 *
 * The predicates are read out of the drizzle SQL the service actually built,
 * not grepped from its source.
 *
 * ── AND THE FIRST VERSION OF THIS SUITE WAS BLIND TO THE WORST CASE ─────────
 * It pinned the write-lane rule at `resetCircuitBreaker`'s FRONT DOOR only.
 * Meanwhile `execute` calls it too — on cooldown expiry — and omitted the lane,
 * so the callee's `orgId: number | null = null` DEFAULT silently sent the
 * auto-reset to the platform lane. With `credentialLane` admitting an org's own
 * credential and `LANE_ORDER` ranking it FIRST, that cleared the SHARED row
 * every other tenant falls back to while the org's own breaker stayed open
 * forever and kept climbing.
 *
 * The suite could not see it: `beforeEach` sets `credRow = null`, so every
 * `execute` case returned at `if (!cred)` long before the breaker branch. The
 * one production call site that omitted the lane was outside the population
 * these tests read — the third law, on this file. The default parameter is gone
 * (the type system now demands the lane at every call site) and the breaker
 * branch is driven for real below.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

interface Captured { where: unknown; ordered: boolean; kind: "select" | "update" }
const captured: Captured[] = [];
let credRow: Record<string, unknown> | null = null;

vi.mock("../../server/db", () => {
  const selectChain = () => {
    const st: Captured = { where: null, ordered: false, kind: "select" };
    const api: any = {
      from: () => api,
      where: (w: unknown) => { st.where = w; return api; },
      orderBy: () => { st.ordered = true; return api; },
      limit: () => { captured.push(st); return Promise.resolve(credRow ? [credRow] : []); },
      then: (res: any, rej: any) => { captured.push(st); return Promise.resolve(credRow ? [credRow] : []).then(res, rej); },
    };
    return api;
  };
  return {
    db: {
      select: selectChain,
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) }),
      update: () => ({
        set: () => ({
          where: (w: unknown) => {
            captured.push({ where: w, ordered: false, kind: "update" });
            return Promise.resolve([]);
          },
        }),
      }),
    },
  };
});
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { integrationFrameworkService } from "../../server/services/integrationFrameworkV12";

/** Column names and SQL fragments in one ordered stream, so `org_id is null` reads as text. */
function readPredicate(node: any, out: string[] = []): string {
  if (node && typeof node === "object") {
    if (typeof node.name === "string" && node.table) out.push(node.name);
    if (Array.isArray(node.value)) out.push(...node.value.filter((v: unknown) => typeof v === "string"));
    if (Array.isArray(node.queryChunks)) node.queryChunks.forEach((c: any) => readPredicate(c, out));
  }
  return out.join("");
}

beforeEach(() => {
  captured.length = 0;
  credRow = null;
});

/** A credential row that is OPEN with an expired cooldown — the auto-reset path. */
function openBreakerRow(orgId: number | null) {
  return {
    id: 7,
    serviceName: "stripe",
    orgId,
    encryptedValue: Buffer.from("sk_test").toString("base64"),
    allowedAgents: ["atlas"],
    rateLimitPerMinute: 60,
    rateLimitUsed: 0,
    rateLimitResetAt: new Date(Date.now() + 60_000),
    circuitBreakerOpen: true,
    circuitBreakerFailures: 5,
    circuitBreakerThreshold: 5,
    // In the PAST, so `execute` takes the "cooldown expired — auto-reset" arm.
    circuitBreakerResetAt: new Date(Date.now() - 60_000),
  };
}

describe("v12 integration credentials: a service name is not a lane", () => {
  it("a platform call matches ONLY platform credentials", async () => {
    await integrationFrameworkService.execute("atlas", "stripe", "GET", "https://x.test/y");
    const read = captured.find((c) => c.kind === "select");
    expect(read, "execute issued no credential read").toBeTruthy();
    const sql = readPredicate(read!.where);
    // Vacuity: the term that was always there must be visible to the reader.
    expect(sql).toContain("service_name");
    expect(sql).toMatch(/org_id.*is null/s);
  });

  it("an org call matches its own credential OR the platform one — never a third org's", async () => {
    await integrationFrameworkService.execute("atlas", "stripe", "GET", "https://x.test/y", { orgId: 5 });
    const sql = readPredicate(captured.find((c) => c.kind === "select")!.where);
    expect(sql).toContain("service_name");
    // Both arms present: the org's own row, and the platform fallback.
    expect(sql.match(/org_id/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("is null");
  });

  it("orders the lane, so which row wins is a decision and not an accident", async () => {
    await integrationFrameworkService.execute("atlas", "stripe", "GET", "https://x.test/y", { orgId: 5 });
    expect(
      captured.find((c) => c.kind === "select")!.ordered,
      "`.limit(1)` with no `orderBy` picks an arbitrary row among rows sharing " +
        "a service name — which is the whole defect, not a tidiness point",
    ).toBe(true);
  });

  it("a WRITE takes the lane exactly, with no platform fallback", async () => {
    await integrationFrameworkService.resetCircuitBreaker("stripe", 5);
    const write = captured.find((c) => c.kind === "update");
    expect(write, "resetCircuitBreaker issued no update").toBeTruthy();
    const sql = readPredicate(write!.where);
    expect(sql).toContain("service_name");
    expect(sql).toContain("org_id");
    // Reading may fall back to the shared credential; clearing a breaker must
    // not reach across to a row the caller did not name.
    expect(sql).not.toContain("is null");
  });

  it("resetCircuitBreaker on the platform lane clears only the platform row", async () => {
    await integrationFrameworkService.resetCircuitBreaker("stripe", null);
    const sql = readPredicate(captured.find((c) => c.kind === "update")!.where);
    expect(sql).toMatch(/org_id.*is null/s);
  });

  // ── the auto-reset path, which the front-door cases never reached ──────────

  it("execute's cooldown auto-reset clears THE ORG'S row, not the platform row", async () => {
    credRow = openBreakerRow(5);
    await integrationFrameworkService.execute("atlas", "stripe", "GET", "https://x.test/y", {
      orgId: 5,
    });

    const writes = captured.filter((c) => c.kind === "update");
    expect(writes.length, "no breaker reset was issued at all").toBeGreaterThan(0);
    const sql = readPredicate(writes[0].where);
    expect(sql).toContain("service_name");
    expect(sql).toContain("org_id");
    // The whole defect in one assertion: the platform lane is `org_id IS NULL`,
    // and clearing it from an ORG-lane credential wipes the shared fallback row
    // every other tenant resolves to.
    expect(sql).not.toContain("is null");
  });

  it("execute's auto-reset stays on the platform lane for a platform credential", async () => {
    credRow = openBreakerRow(null);
    await integrationFrameworkService.execute("atlas", "stripe", "GET", "https://x.test/y");

    const writes = captured.filter((c) => c.kind === "update");
    expect(writes.length, "no breaker reset was issued at all").toBeGreaterThan(0);
    expect(readPredicate(writes[0].where)).toMatch(/org_id.*is null/s);
  });
});
