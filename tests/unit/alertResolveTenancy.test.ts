/**
 * Org A may not resolve — or rewrite the metadata of — org B's system alert.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `proactiveMonitor.autoResolveAlert` mutated `system_alerts` by primary key
 * and nothing else:
 *
 *     await db.update(systemAlerts)
 *       .set({ status: 'resolved', resolvedAt: new Date(),
 *              metadata: { resolvedBy, resolutionDetails: details } })
 *       .where(eq(systemAlerts.id, alertId));           // <- no org predicate
 *
 * `system_alerts.organization_id` exists (shared/schema.ts) and alert ids are
 * sequential serials, so the id was trivially enumerable. Two of the three ways
 * in supply a CALLER-CHOSEN id:
 *
 *   • `POST /api/monitor/alerts/:id/resolve` (server/routes-admin.ts) — guarded
 *     by `isAuthenticated` + `getOrCreateOrg` ONLY, and the handler never
 *     fetched the alert to compare organizations. The SAME TABLE's siblings
 *     `PUT /api/admin/alerts/:id/{acknowledge,resolve}` sit behind
 *     `isFounderAdmin` — one table, two doors, one of them ungated.
 *   • the Pax tool `resolve_alert` (server/ai/supportAgent.ts), whose
 *     `alert_id` comes out of a model tool call.
 *
 * So an authenticated member of any org could flip another org's alert to
 * `resolved` (silencing it) AND overwrite that alert's `metadata` jsonb with
 * their own `details` string. A cross-tenant WRITE plus an attacker-controlled
 * overwrite, needing no discovery.
 *
 * The third caller — the internal `autoResolveAlertsByMetadata` health sweep —
 * is genuinely all-org and resolves rows IT selected itself. The fix must keep
 * that lane working, including for platform-global alerts whose
 * `organization_id` IS NULL, which is why the last two cases below exist.
 *
 * ── WHAT THIS FILE PROVES ───────────────────────────────────────────────────
 * Behaviour, not vocabulary. The fake `db` below is an HONEST postgres: it holds
 * alert rows for two organizations plus one platform-global row, and answers an
 * UPDATE by EVALUATING the drizzle predicate it was handed against those rows —
 * equalities AND `IS NULL`. A predicate that binds nothing therefore matches the
 * whole table, exactly as production did, and the cross-tenant assertions fail.
 *
 * Asserting that the source contains the string `organizationId` would pass
 * against a predicate built on the wrong value; a storage double that filtered
 * by org for free would pass against no predicate at all. Both were rejected.
 *
 * FALSIFICATION (run before this file was committed): restoring
 * `.where(eq(systemAlerts.id, alertId))` in autoResolveAlert makes the
 * cross-tenant, metadata-overwrite and global-alert cases below fail while the
 * vacuity guard and both sweep cases stay green.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { systemAlerts } from "@shared/schema";

const ROOT = path.resolve(__dirname, "../..");

const VICTIM_ORG = 7;
const ATTACKER_ORG = 42;

const VICTIM_ALERT_ID = 1;
const ATTACKER_ALERT_ID = 2;
const GLOBAL_ALERT_ID = 3;

type Row = Record<string, unknown>;

/**
 * Flatten a drizzle predicate into the constraints it binds.
 *
 * `eq(col, v)` emits [Column, StringChunk " = ", Param]; `isNull(col)` emits
 * [Column, StringChunk " is null"] with NO param — which is precisely why this
 * walker keeps the string chunks instead of collapsing to column/param pairs
 * the way the sibling tenancy tests do. A walker that dropped them would read
 * `IS NULL` as "no constraint at all" and would then agree that a global-scope
 * query may hit a tenant's row.
 */
type Constraint = { column: string; kind: "eq"; value: unknown } | { column: string; kind: "isNull" };

function constraints(node: unknown): Constraint[] {
  const tokens: Array<{ kind: "col" | "op" | "param"; v: unknown }> = [];
  const walk = (n: any): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n.name === "string" && n.table !== undefined) { tokens.push({ kind: "col", v: n.name }); return; }
    if ("encoder" in n && "value" in n) { tokens.push({ kind: "param", v: n.value }); return; }
    if (Array.isArray(n.value)) { tokens.push({ kind: "op", v: n.value.join("") }); return; }
    if (Array.isArray(n.queryChunks)) { n.queryChunks.forEach(walk); return; }
  };
  walk(node);

  const out: Constraint[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== "col") continue;
    const column = String(tokens[i].v);
    const op = tokens[i + 1];
    if (!op || op.kind !== "op") continue;
    if (/is null/i.test(String(op.v))) { out.push({ column, kind: "isNull" }); continue; }
    const param = tokens[i + 2];
    if (op.v === " = " && param && param.kind === "param") {
      out.push({ column, kind: "eq", value: param.v });
    }
  }
  return out;
}

/**
 * Honest row matching: a row is returned when it satisfies EVERY constraint the
 * predicate binds — what postgres does with `WHERE a = $1 AND b IS NULL`. A
 * predicate binding nothing matches the whole table, which is the point: an
 * unscoped UPDATE reaches other tenants' rows here exactly as it did in prod.
 */
const COLUMN_TO_KEY: Record<string, string> = {
  id: "id",
  organization_id: "organizationId",
  alert_type: "alertType",
  status: "status",
  title: "title",
};

function rowMatches(row: Row, predicate: unknown): boolean {
  return constraints(predicate).every((c) => {
    const key = COLUMN_TO_KEY[c.column];
    if (!key) return false;
    if (c.kind === "isNull") return row[key] === null || row[key] === undefined;
    return String(row[key]) === String(c.value);
  });
}

interface Harness {
  rows: Row[];
  updatePredicates: unknown[];
  selectPredicates: unknown[];
}

function makeHarness(): Harness {
  return {
    rows: [
      {
        id: VICTIM_ALERT_ID, organizationId: VICTIM_ORG, alertType: "service_degraded",
        status: "new", resolvedAt: null, title: "Twilio degraded",
        metadata: { serviceName: "twilio", secret: "victim-only" },
      },
      {
        id: ATTACKER_ALERT_ID, organizationId: ATTACKER_ORG, alertType: "service_degraded",
        status: "new", resolvedAt: null, title: "Twilio degraded",
        metadata: { serviceName: "twilio" },
      },
      {
        id: GLOBAL_ALERT_ID, organizationId: null, alertType: "service_degraded",
        status: "new", resolvedAt: null, title: "Twilio degraded (platform)",
        metadata: { serviceName: "twilio" },
      },
    ],
    updatePredicates: [],
    selectPredicates: [],
  };
}

/** A `db` shaped like drizzle's, backed by `h.rows`. */
function makeDb(h: Harness) {
  return {
    update(_table: unknown) {
      let patch: Row = {};
      const self: any = {
        set(p: Row) { patch = p; return self; },
        where(predicate: unknown) {
          h.updatePredicates.push(predicate);
          const apply = () => {
            const hit = h.rows.filter((r) => rowMatches(r, predicate));
            for (const r of hit) Object.assign(r, patch);
            return hit.map((r) => ({ id: r.id }));
          };
          return {
            returning: async () => apply(),
            // A `.where(...)` that is awaited directly (the pre-fix shape) must
            // still mutate, so removing `.returning()` cannot make this suite
            // pass by never running the UPDATE.
            then(resolve: (v: unknown) => void) { resolve(apply()); },
          };
        },
      };
      return self;
    },
    select() {
      let predicate: unknown = undefined;
      const self: any = {
        from(_t: unknown) { return self; },
        where(p: unknown) { predicate = p; return self; },
        orderBy() { return self; },
        limit() { return self; },
        then(resolve: (v: unknown) => void) {
          h.selectPredicates.push(predicate);
          resolve(h.rows.filter((r) => rowMatches(r, predicate)).map((r) => ({ ...r })));
        },
      };
      return self;
    },
  };
}

async function monitorWith(h: Harness) {
  vi.resetModules();
  vi.doMock("../../server/db", () => ({ db: makeDb(h) }));
  const { proactiveMonitor } = await import("../../server/services/proactiveMonitor");
  return proactiveMonitor;
}

const alert = (h: Harness, id: number) => h.rows.find((r) => r.id === id)!;

beforeEach(() => vi.resetModules());

describe("proactiveMonitor.autoResolveAlert scopes the alert it mutates", () => {
  it("THE OWNING ORG STILL RESOLVES ITS OWN ALERT — vacuity guard", async () => {
    // Without this, an implementation that resolved NOTHING would satisfy every
    // cross-tenant assertion below while the feature was dead.
    const h = makeHarness();
    const monitor = await monitorWith(h);

    const ok = await monitor.autoResolveAlert(ATTACKER_ALERT_ID, "fixed it", "user", {
      organizationId: ATTACKER_ORG,
    });

    expect(ok, "an org can no longer resolve its own alert").toBe(true);
    expect(alert(h, ATTACKER_ALERT_ID).status).toBe("resolved");
    expect(alert(h, ATTACKER_ALERT_ID).resolvedAt).toBeInstanceOf(Date);
  });

  it("ANOTHER ORG'S ALERT IS NOT RESOLVED — the cross-tenant write", async () => {
    const h = makeHarness();
    const monitor = await monitorWith(h);
    const before = { ...alert(h, VICTIM_ALERT_ID) };

    // Exactly what POST /api/monitor/alerts/:id/resolve accepts: the caller's
    // own org, someone else's sequential alert id.
    const ok = await monitor.autoResolveAlert(VICTIM_ALERT_ID, "resolved by org 42", "user", {
      organizationId: ATTACKER_ORG,
    });

    expect(ok, "the call reported success over a row it must not touch").toBe(false);
    expect(alert(h, VICTIM_ALERT_ID).status, "org B's alert was silenced by org A").toBe(before.status);
    expect(alert(h, VICTIM_ALERT_ID).resolvedAt, "org B's alert was stamped resolved by org A").toBeNull();
  });

  it("ANOTHER ORG'S metadata IS NOT OVERWRITTEN — the attacker-controlled blob", async () => {
    // The second half of the defect: `set({ metadata: { resolvedBy,
    // resolutionDetails: details } })` REPLACES the victim's metadata, so the
    // request body chose what org B's alert record says about itself.
    const h = makeHarness();
    const monitor = await monitorWith(h);

    await monitor.autoResolveAlert(VICTIM_ALERT_ID, "attacker-controlled text", "user", {
      organizationId: ATTACKER_ORG,
    });

    expect(
      alert(h, VICTIM_ALERT_ID).metadata,
      "org A rewrote org B's alert metadata",
    ).toEqual({ serviceName: "twilio", secret: "victim-only" });
  });

  it("A PLATFORM-GLOBAL ALERT IS NOT REACHABLE FROM A TENANT SCOPE", async () => {
    // organization_id IS NULL rows belong to the platform (createGlobalAlert).
    // A tenant-scoped caller must miss them rather than resolve them.
    const h = makeHarness();
    const monitor = await monitorWith(h);

    const ok = await monitor.autoResolveAlert(GLOBAL_ALERT_ID, "not yours", "user", {
      organizationId: ATTACKER_ORG,
    });

    expect(ok).toBe(false);
    expect(alert(h, GLOBAL_ALERT_ID).status, "a tenant resolved a platform-wide alert").toBe("new");
  });

  it("A TENANT'S ALERT IS NOT REACHABLE FROM THE GLOBAL SCOPE EITHER", async () => {
    // The mirror image: `{ organizationId: null }` means IS NULL, not "any org".
    // If it were compiled away, the null lane would be a universal skeleton key.
    const h = makeHarness();
    const monitor = await monitorWith(h);

    const ok = await monitor.autoResolveAlert(VICTIM_ALERT_ID, "sweeping", "auto", {
      organizationId: null,
    });

    expect(ok).toBe(false);
    expect(alert(h, VICTIM_ALERT_ID).status, "the global lane reached a tenant row").toBe("new");
  });

  it("THE UPDATE IT EMITS ALWAYS BINDS organization_id", async () => {
    // The clause itself, pinned against the predicate drizzle actually receives
    // — so a future edit cannot satisfy the behavioural cases by filtering in
    // JavaScript after an unscoped UPDATE has already run.
    const h = makeHarness();
    const monitor = await monitorWith(h);
    await monitor.autoResolveAlert(ATTACKER_ALERT_ID, "fixed it", "user", { organizationId: ATTACKER_ORG });
    await monitor.autoResolveAlert(GLOBAL_ALERT_ID, "fixed it", "auto", { organizationId: null });

    expect(h.updatePredicates, "the UPDATE never ran").toHaveLength(2);

    const [tenant, global] = h.updatePredicates.map((p) => constraints(p));
    expect(tenant).toContainEqual({ column: "organization_id", kind: "eq", value: ATTACKER_ORG });
    expect(tenant).toContainEqual({ column: "id", kind: "eq", value: ATTACKER_ALERT_ID });
    expect(global).toContainEqual({ column: "organization_id", kind: "isNull" });
  });
});

describe("the internal health sweep still resolves the rows it selected", () => {
  // autoResolveAlertsByMetadata is the one caller that is legitimately all-org:
  // it reads the rows itself and hands each row's OWN organization down. If the
  // fix had made the scope a caller-chosen argument with no row to derive it
  // from, this lane would have gone silently dead — service_degraded alerts
  // would never clear again — which no cross-tenant assertion above would show.
  const sweep = async (h: Harness) => {
    const monitor = await monitorWith(h);
    return (monitor as any).autoResolveAlertsByMetadata("service_degraded", { serviceName: "twilio" });
  };

  it("clears every matching TENANT alert, whichever org owns it", async () => {
    const h = makeHarness();
    const count = await sweep(h);

    expect(count, "the health sweep stopped resolving anything").toBeGreaterThanOrEqual(2);
    expect(alert(h, VICTIM_ALERT_ID).status).toBe("resolved");
    expect(alert(h, ATTACKER_ALERT_ID).status).toBe("resolved");
  });

  it("clears the platform-global alert too (organization_id IS NULL)", async () => {
    const h = makeHarness();
    await sweep(h);

    expect(
      alert(h, GLOBAL_ALERT_ID).status,
      "the null-org lane broke, so platform alerts can never auto-clear",
    ).toBe("resolved");
  });
});

describe("both caller-chosen doors hand it their own org", () => {
  // DEFENCE IN DEPTH, not the enforcement. The enforcement is the TYPE: `scope`
  // is a required parameter with no default, so a call site that supplies no
  // organization does not compile (`npm run check`). These assertions exist so
  // that a call site which supplies the WRONG organization — one read out of
  // the request rather than out of the session — is loud too.
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

  it("the monitor route scopes to the authenticated org, not to the URL", () => {
    const src = read("server/routes-admin.ts");
    const at = src.indexOf('api.post("/api/monitor/alerts/:id/resolve"');
    expect(at, "the alert-resolve route moved or was renamed").toBeGreaterThan(-1);
    const handler = src.slice(at, at + 1600);

    expect(handler, "the handler no longer resolves the caller's organization").toContain(
      "getOrganization(req)",
    );
    expect(handler, "the handler stopped passing an organization scope").toMatch(
      /organizationId:\s*org\.id/,
    );
    // The tenant key must not come from anything the caller controls.
    expect(handler).not.toMatch(/organizationId:\s*(?:Number\()?req\.(?:body|params|query)/);
  });

  it("the Pax resolve_alert tool scopes to the org it is answering for", () => {
    const src = read("server/ai/supportAgent.ts");
    const at = src.indexOf('case "resolve_alert":');
    expect(at, "the Pax resolve_alert tool moved or was renamed").toBeGreaterThan(-1);
    const handler = src.slice(at, at + 1200);

    expect(handler, "Pax stopped passing an organization scope").toMatch(/organizationId:\s*org\.id/);
    expect(handler).not.toMatch(/organizationId:\s*(?:Number\()?(?:args|alert)/);
  });
});
