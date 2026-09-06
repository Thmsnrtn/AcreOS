/**
 * Breach-notification trigger wiring ratchet (founder ruling, picker,
 * 2026-08-16: "Wire breachNotificationTrigger only").
 *
 * `server/services/breachNotificationTrigger.ts` computes GLBA
 * 16 CFR 314.4(j), GDPR Art. 33 and state breach-notification deadlines.
 * It shipped with ZERO call sites — a regulated obligation built and never
 * wired, and worse than the usual "built but unwired" case because the
 * absence only manifests DURING a breach, which is exactly when nobody is
 * reading code. B19 classed it as class-1 (wire, do not delete).
 *
 * WHAT WAS ACTUALLY WIRED, and why it is not five separate hooks. The
 * module's header names five security events. A search of this repo found
 * NO automated emitter for any of them — nothing detects a leaked DB
 * credential, an externally-shared production backup, a sub-processor
 * compromise, a confirmed cross-tenant read, or a lost device. All five
 * are discovered by a human. The one mounted, human-driven surface where
 * a security event is DECLARED is the founder-only incident tracker, so
 * the trigger hangs there at both moments awareness can arrive:
 *
 *   POST  /api/founder/incidents      — known to be an exposure at open
 *   PATCH /api/founder/incidents/:id  — reclassified as one after triage
 *
 * This suite asserts the wiring EXISTS and BITES:
 *   1. VACUITY GUARD — the source scan must find files, and must find at
 *      least one production call site. A scan that finds nothing FAILS
 *      rather than passing quietly (the failure mode that let this module
 *      sit unwired while every gate stayed green).
 *   2. Both handlers really invoke the trigger — removing either one
 *      fails, because each is exercised through the registered handler.
 *   3. Operator-supplied inputs reach the module UNCHANGED. Nothing is
 *      defaulted or inferred: no exposure block means NO assessment, and
 *      `affectedOrgCount` (an ORG count) is never passed as
 *      `affectedDataSubjects` (a DATA-SUBJECT count).
 *   4. FAIL-SOFT — a throwing trigger must not break incident recording.
 *      A breach computation that 500s the incident write a founder is
 *      making during an incident is a self-inflicted outage.
 *   5. `dataExposure` is not a column on `incidents` and must never reach
 *      the UPDATE statement.
 *
 * idempotent: true — db and auth are mocked; no DATABASE_URL needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
const TRIGGER_REL = path.join("server", "services", "breachNotificationTrigger.ts");
const WIRED_REL = path.join("server", "routes-incidents.ts");

// ── db mock: record every insert/update, hand back a plausible row ──────────
const updates: Array<{ patch: any }> = [];
let insertedIncident: any = null;

vi.mock("../../server/db", () => {
  const insert = () => {
    const chain: any = {
      values(v: any) {
        chain._values = v;
        insertedIncident = v;
        return chain;
      },
      returning: () =>
        Promise.resolve([
          {
            id: "incident-uuid-1",
            detectedAt: new Date("2026-08-16T09:00:00.000Z"),
            impactSummary: null,
            ...chain._values,
          },
        ]),
      then: (r: (v: any) => void) => r(undefined),
    };
    return chain;
  };
  const update = () => {
    const chain: any = {
      set(p: any) {
        chain._patch = p;
        updates.push({ patch: p });
        return chain;
      },
      where: () => chain,
      returning: () =>
        Promise.resolve([
          {
            id: "incident-uuid-1",
            title: "Vendor notified us of a compromise",
            summary: "Sub-processor reported unauthorized access to their store.",
            detectedAt: new Date("2026-08-16T09:00:00.000Z"),
            impactSummary: null,
            status: "open",
            lessonsLearned: null,
            ...chain._patch,
          },
        ]),
      then: (r: (v: any) => void) => r(undefined),
    };
    return chain;
  };
  const select = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      groupBy: () => Promise.resolve([]),
      limit: () => Promise.resolve([]),
      then: (r: (v: any) => void) => r([]),
    };
    return chain;
  };
  return { db: { insert, update, select } };
});

// ── auth mock: the wiring test is about the trigger, not the gate ───────────
vi.mock("../../server/auth", () => ({
  isAuthenticated: (_req: any, _res: any, next: any) => next?.(),
  requireFounder: (_req: any, _res: any, next: any) => next?.(),
}));

// ── The subject: spy on the trigger, keep its REAL enums ────────────────────
// Keeping PERSONAL_DATA_CATEGORIES / EXPOSURE_KINDS real matters: the route
// validates operator input against the module's own vocabulary, so a category
// the module does not know cannot be smuggled past the schema.
const assessBreachNotification = vi.fn(async (input: any) => ({
  alertId: 7,
  discoveredAt: (input.discoveredAt ?? new Date()).toISOString(),
  gdpr72hDeadline: "2026-08-19T09:00:00.000Z",
  deadlines: [],
  triggeredJurisdictions: ["EU"],
  notificationRequired: true,
}));

vi.mock("../../server/services/breachNotificationTrigger", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    assessBreachNotification: (input: any) => assessBreachNotification(input),
  };
});

import { registerIncidentRoutes } from "../../server/routes-incidents";
import {
  EXPOSURE_KINDS,
  PERSONAL_DATA_CATEGORIES,
} from "../../server/services/breachNotificationTrigger";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


// ── Minimal Express double: capture the terminal handler per method+path ────
type Handler = (req: any, res: any) => Promise<unknown> | unknown;
const handlers = new Map<string, Handler>();

function makeApp() {
  const register = (method: string) => (routePath: string, ...mw: Handler[]) => {
    handlers.set(`${method} ${routePath}`, mw[mw.length - 1]);
  };
  return {
    get: register("GET"),
    post: register("POST"),
    patch: register("PATCH"),
    put: register("PUT"),
    delete: register("DELETE"),
  } as any;
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: any) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

registerIncidentRoutes(makeApp());

const CREATE = "POST /api/founder/incidents";
const UPDATE = "PATCH /api/founder/incidents/:id";

/** A real, operator-supplied exposure block. Every number comes from the
 *  caller — this suite never lets the route invent one. */
const REAL_EXPOSURE = {
  exposureKind: "vendor_compromise",
  affectedDataSubjects: 1240,
  categoriesExposed: ["name", "email", "ssn"],
  jurisdictions: ["EU", "US-CA"],
};

beforeEach(() => {
  assessBreachNotification.mockClear();
  updates.length = 0;
  insertedIncident = null;
});

// ─────────────────────────────────────────────────────────────────────────────
describe("breach-notification trigger — the call sites exist", () => {
  /**
   * Source scan with a vacuity guard. The defect this whole suite guards is
   * "built but unwired", so a scan that silently finds nothing is the single
   * most dangerous outcome — it would report success for an unwired module.
   */
  it("scans real files and finds at least one production call site", () => {
    const scanned: string[] = [];
    const callers: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist") continue;
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
        if (entry.name.includes(".test.") || entry.name.includes(".spec.")) continue;
        const rel = path.relative(ROOT, full);
        if (rel === TRIGGER_REL) continue; // the module is not its own caller
        scanned.push(rel);
        const src = fs.readFileSync(full, "utf-8");
        if (
          src.includes("breachNotificationTrigger") &&
          /\bassessBreachNotification\s*\(/.test(src)
        ) {
          callers.push(rel);
        }
      }
    };
    walk(path.join(ROOT, "server"));

    // VACUITY GUARD 1 — the scan actually looked at files. An empty walk
    // (wrong root, moved directory) must fail, not pass.
    expect(scanned.length).toBeGreaterThan(200);
    expect(scanned).toContain(WIRED_REL);

    // VACUITY GUARD 2 — the module has production callers. This is the
    // assertion that was false for the module's entire life before
    // 2026-08-16, and it must fail again the moment it becomes false.
    expect(
      callers.length,
      "breachNotificationTrigger has NO production call site — a regulated " +
        "obligation is built and unwired again. Statutory deadlines are " +
        "computed by code nothing runs.",
    ).toBeGreaterThan(0);
    expect(callers).toContain(WIRED_REL);
  });

  it("the wired route imports the trigger statically, so a broken wire fails at boot", () => {
    const src = fs.readFileSync(path.join(ROOT, WIRED_REL), "utf-8");
    expect(src).toMatch(
      /import\s*\{[^}]*assessBreachNotification[^}]*\}\s*from\s*["']\.\/services\/breachNotificationTrigger["']/s,
    );
  });

  it("the call site logs through the structured logger, never console.*", () => {
    const src = fs.readFileSync(path.join(ROOT, WIRED_REL), "utf-8");
    expect(src).not.toMatch(/\bconsole\.(log|warn|error|info|debug)\s*\(/);
    expect(src).toMatch(/logger\.(warn|error)\s*\(/);
  });

  it("the route handler uses AuthenticatedRequest and never `(req as any)`", () => {
    const src = fs.readFileSync(path.join(ROOT, WIRED_REL), "utf-8");
    expect(src).toContain("AuthenticatedRequest");
    expect(src).not.toMatch(/\(\s*req\s+as\s+any\s*\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("breach-notification trigger — the call sites BITE", () => {
  it("POST /api/founder/incidents fires the trigger when exposure is declared", async () => {
    const handler = handlers.get(CREATE);
    expect(handler, "create handler was never registered").toBeTypeOf("function");

    const res = makeRes();
    await handler!(
      {
        body: {
          severity: "SEV-1",
          title: "Sub-processor reported unauthorized access",
          summary: "Vendor disclosed an intrusion into a store holding our PII.",
          dataExposure: REAL_EXPOSURE,
        },
        user: { email: "founder@acreos.io" },
        params: {},
        query: {},
      },
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(assessBreachNotification).toHaveBeenCalledTimes(1);
    expect(res.body.breachAssessment).toBeTruthy();
    expect(res.body.breachAssessment.notificationRequired).toBe(true);
  });

  it("PATCH /api/founder/incidents/:id fires the trigger on reclassification", async () => {
    const handler = handlers.get(UPDATE);
    expect(handler, "update handler was never registered").toBeTypeOf("function");

    const res = makeRes();
    await handler!(
      { body: { dataExposure: REAL_EXPOSURE }, params: { id: "incident-uuid-1" }, query: {} },
      res,
    );

    expect(assessBreachNotification).toHaveBeenCalledTimes(1);
    expect(res.body.breachAssessment).toBeTruthy();
  });

  it("passes the operator's OWN numbers through, inventing nothing", async () => {
    const res = makeRes();
    await handlers.get(CREATE)!(
      {
        body: {
          severity: "SEV-2",
          title: "Backup snapshot shared with an outside contractor",
          summary: "A production dump was attached to an external thread.",
          // An ORG count. It must never be reused as a DATA-SUBJECT count.
          affectedOrgCount: 3,
          dataExposure: REAL_EXPOSURE,
        },
        user: { email: "founder@acreos.io" },
        params: {},
        query: {},
      },
      res,
    );

    const input = assessBreachNotification.mock.calls[0][0] as any;
    expect(input.affectedDataSubjects).toBe(1240);
    expect(input.affectedDataSubjects).not.toBe(3);
    expect(input.exposureKind).toBe("vendor_compromise");
    expect(input.categoriesExposed).toEqual(["name", "email", "ssn"]);
    expect(input.jurisdictions).toEqual(["EU", "US-CA"]);
    // Discovery time is the incident row's own detectedAt — on the create
    // path that is the moment of declaration, which the route stamps.
    expect((input.discoveredAt as Date).toISOString()).toBe(
      (insertedIncident.detectedAt as Date).toISOString(),
    );
  });

  it("takes discovery time from the STORED incident, not from `now`, on reclassification", async () => {
    // The reclassification path is where this matters: an incident detected
    // hours ago is only now understood to be a personal-data breach, and
    // GDPR Art. 33's 72 hours must not silently restart from the PATCH.
    await handlers.get(UPDATE)!(
      { body: { dataExposure: REAL_EXPOSURE }, params: { id: "incident-uuid-1" }, query: {} },
      makeRes(),
    );

    const input = assessBreachNotification.mock.calls[0][0] as any;
    expect((input.discoveredAt as Date).toISOString()).toBe("2026-08-16T09:00:00.000Z");
  });

  it("honours an explicitly supplied discoveredAt over the incident's own", async () => {
    await handlers.get(UPDATE)!(
      {
        body: {
          dataExposure: { ...REAL_EXPOSURE, discoveredAt: "2026-08-14T02:30:00.000Z" },
        },
        params: { id: "incident-uuid-1" },
        query: {},
      },
      makeRes(),
    );

    const input = assessBreachNotification.mock.calls[0][0] as any;
    expect((input.discoveredAt as Date).toISOString()).toBe("2026-08-14T02:30:00.000Z");
  });

  it("does NOT fire when no exposure was declared — an incident is not a breach", async () => {
    const res = makeRes();
    await handlers.get(CREATE)!(
      {
        body: {
          severity: "SEV-3",
          title: "Elevated 500s on the deals list",
          summary: "A slow query saturated the pool. No data left the platform.",
          affectedOrgCount: 12,
        },
        user: { email: "founder@acreos.io" },
        params: {},
        query: {},
      },
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(assessBreachNotification).not.toHaveBeenCalled();
    expect(res.body.breachAssessment).toBeNull();
  });

  it("is FAIL-SOFT — a throwing trigger never breaks incident recording", async () => {
    assessBreachNotification.mockRejectedValueOnce(new Error("deadline matrix blew up"));

    const res = makeRes();
    await handlers.get(CREATE)!(
      {
        body: {
          severity: "SEV-1",
          title: "Credential leak with row-level access",
          summary: "A DB credential appeared in a public paste.",
          dataExposure: { ...REAL_EXPOSURE, exposureKind: "credentials_leaked" },
        },
        user: { email: "founder@acreos.io" },
        params: {},
        query: {},
      },
      res,
    );

    // The incident still records. A breach-notification computation must
    // never be able to 500 the incident-response path it hangs off.
    expect(res.statusCode).toBe(201);
    expect(res.body.id).toBe("incident-uuid-1");
    expect(res.body.breachAssessment).toBeNull();
  });

  it("never writes `dataExposure` into the incidents UPDATE — it is not a column", async () => {
    await handlers.get(UPDATE)!(
      {
        body: { status: "mitigated", dataExposure: REAL_EXPOSURE },
        params: { id: "incident-uuid-1" },
        query: {},
      },
      makeRes(),
    );

    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0].patch)).not.toContain("dataExposure");
    expect(updates[0].patch.status).toBe("mitigated");
  });

  it("rejects exposure input the module's own vocabulary does not know", async () => {
    const res = makeRes();
    await handlers.get(CREATE)!(
      {
        body: {
          severity: "SEV-1",
          title: "Something happened",
          summary: "Operator picked a category the module cannot assess.",
          dataExposure: { ...REAL_EXPOSURE, categoriesExposed: ["favourite_colour"] },
        },
        user: { email: "founder@acreos.io" },
        params: {},
        query: {},
      },
      res,
    );

    expect(res.statusCode).toBe(422);
    expect(assessBreachNotification).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("breach-notification trigger — vocabulary covers the header's five events", () => {
  /**
   * The module header names five example events. Each maps onto an
   * ExposureKind, so a single declaration surface can express all five.
   * This is NOT a claim that five automated emitters exist — none do; it
   * is the check that the operator can name which one occurred.
   */
  it("every one of the five header events has an ExposureKind to declare it", () => {
    const header = fs.readFileSync(path.join(ROOT, TRIGGER_REL), "utf-8");
    for (const line of [
      "DB credential leak with row-level access",
      "Production backup with PII shared externally",
      "Compromised vendor (sub-processor) that holds AcreOS PII",
      "Unauthorized employee access to non-scoped tenants",
      "Lost laptop holding unencrypted PII",
    ]) {
      expect(header, `header no longer names: ${line}`).toContain(line);
    }

    for (const kind of [
      "credentials_leaked",
      "data_exfiltration",
      "vendor_compromise",
      "internal_misuse",
      "device_loss",
    ] as const) {
      expect(EXPOSURE_KINDS).toContain(kind);
    }
  });

  it("the runtime enums are non-empty, so the route's schema can never be vacuous", () => {
    expect(EXPOSURE_KINDS.length).toBeGreaterThan(0);
    expect(PERSONAL_DATA_CATEGORIES.length).toBeGreaterThan(0);
    expect(PERSONAL_DATA_CATEGORIES).toContain("ssn");
  });
});
