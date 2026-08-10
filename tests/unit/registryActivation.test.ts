/**
 * G1.1 — per-vertical activation registry, derived from source (never a
 * hardcoded list that can go stale — the workflowActionHonesty lesson).
 *
 * Three invariants:
 *   1. Every registered business type declares an `activationEvent`, and it is
 *      a canonical ACTIVATION_EVENTS member (shared/schema.ts). The
 *      relationship is already type-checked; this pins it at runtime so a
 *      widening cast can't smuggle a dangling name through.
 *   2. Every DECLARED activation event has at least one REAL
 *      recordActivationEvent(Async) call site under server/ — derived by
 *      reading the server tree, so a registry entry pointing at an event
 *      nothing emits ("built but unwired") fails here, not in production.
 *   3. Behavioral — the recorder refuses sample-marked entities (lead.source
 *      "sample_data" / a "SAMPLE-" apn, the sampleMarkers.ts contract the
 *      seeder writes). Clicking through seeded onboarding fixtures is not
 *      activation; a funnel that counted it would be fabricated.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const mem = vi.hoisted(() => ({
  rows: [] as Array<{
    organizationId: number;
    userId: string | null;
    eventName: string;
    eventValue: Record<string, unknown>;
  }>,
}));

vi.mock("../../server/db", () => ({
  db: {
    insert: (_table: unknown) => ({
      values: (vals: any) => ({
        onConflictDoNothing: async (_opts: unknown) => {
          // Honor the (organization_id, event_name) unique index.
          const dup = mem.rows.some(
            (r) =>
              r.organizationId === vals.organizationId &&
              r.eventName === vals.eventName,
          );
          if (!dup) mem.rows.push({ ...vals });
        },
      }),
    }),
  },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { recordActivationEvent } from "../../server/services/activation";
import {
  SAMPLE_APN_PREFIX,
  SAMPLE_LEAD_SOURCE,
  isSampleEntity,
} from "../../server/services/onboarding/sampleMarkers";
import { logger } from "../../server/utils/logger";
import { ACTIVATION_EVENTS } from "../../shared/schema";
import { BUSINESS_TYPES, BUSINESS_TYPE_IDS } from "../../shared/business-types";

const REPO_ROOT = resolve(__dirname, "..", "..");
const SERVER_ROOT = join(REPO_ROOT, "server");

/** Every non-test .ts file under server/, recursively. */
function* walkServer(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules") continue;
      yield* walkServer(p);
    } else if (/\.ts$/.test(name) && !/\.test\./.test(name)) {
      yield p;
    }
  }
}

/**
 * The set of event names with a REAL emitter: every string literal passed as
 * `eventName:` in a file that calls recordActivationEvent(Async). Derived, so
 * it cannot go stale against the code.
 */
function collectEmittedEventNames(): Set<string> {
  const emitted = new Set<string>();
  for (const file of walkServer(SERVER_ROOT)) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("recordActivationEvent")) continue;
    for (const m of src.matchAll(/eventName:\s*["']([^"']+)["']/g)) {
      emitted.add(m[1]);
    }
  }
  return emitted;
}

beforeEach(() => {
  mem.rows = [];
  vi.mocked(logger.warn).mockClear();
});

describe("per-vertical activationEvent registry (derived)", () => {
  it("every registered business type declares a canonical activation event", () => {
    for (const id of BUSINESS_TYPE_IDS) {
      const meta = BUSINESS_TYPES[id];
      expect(meta.activationEvent, `${id} must declare activationEvent`).toBeTruthy();
      expect(
        ACTIVATION_EVENTS,
        `${id} declares '${meta.activationEvent}' which is not a canonical ACTIVATION_EVENTS member`,
      ).toContain(meta.activationEvent);
    }
  });

  it("every DECLARED activation event has a real server-side emitter call site", () => {
    const emitted = collectEmittedEventNames();
    // Sanity: derivation actually found the known seams — if this ever goes
    // to zero the walker broke, and the assertions below would pass vacuously.
    expect(emitted.size).toBeGreaterThan(0);

    const declared = new Set(BUSINESS_TYPE_IDS.map((id) => BUSINESS_TYPES[id].activationEvent));
    for (const event of declared) {
      expect(
        emitted.has(event),
        `'${event}' is declared as a vertical's activationEvent but no ` +
          `recordActivationEvent call site under server/ emits it — wire the ` +
          `emitter or declare an event that actually fires`,
      ).toBe(true);
    }
  });

  it("the two G1.1 events are canonical members (rental family + tax auction)", () => {
    expect(ACTIVATION_EVENTS).toContain("first_rent_roll_reconciled");
    expect(ACTIVATION_EVENTS).toContain("first_worksheet_scored");
  });
});

describe("recorder refuses sample-marked entities (real entities only)", () => {
  it("refuses a seeded sample lead (source = sample_data) and logs the refusal", async () => {
    await recordActivationEvent({
      orgId: 5,
      userId: "user_1",
      eventName: "first_lead_added",
      eventValue: { leadId: 1 },
      entity: { source: SAMPLE_LEAD_SOURCE },
    });

    expect(mem.rows).toHaveLength(0);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("sample"),
      expect.anything(),
    );
  });

  it("refuses a seeded sample parcel (SAMPLE- apn)", async () => {
    await recordActivationEvent({
      orgId: 5,
      eventName: "first_rent_roll_reconciled",
      eventValue: { propertyId: 9 },
      entity: { apn: `${SAMPLE_APN_PREFIX}TX-001-0001` },
    });

    expect(mem.rows).toHaveLength(0);
  });

  it("records a real entity normally — the guard only bites on the markers", async () => {
    await recordActivationEvent({
      orgId: 6,
      userId: "user_2",
      eventName: "first_lead_added",
      eventValue: { leadId: 2 },
      entity: { source: "direct_mail", apn: "123-456-789" },
    });

    expect(mem.rows).toHaveLength(1);
    expect(mem.rows[0].eventName).toBe("first_lead_added");
    expect(mem.rows[0].organizationId).toBe(6);
  });

  it("records when no entity markers are in scope (org_created has no lead/property)", async () => {
    await recordActivationEvent({
      orgId: 7,
      eventName: "org_created",
    });

    expect(mem.rows).toHaveLength(1);
  });

  it("stays first-occurrence idempotent with the entity threaded through", async () => {
    await recordActivationEvent({
      orgId: 8,
      eventName: "first_worksheet_scored",
      entity: { apn: "REAL-APN-1" },
    });
    await recordActivationEvent({
      orgId: 8,
      eventName: "first_worksheet_scored",
      entity: { apn: "REAL-APN-2" },
    });

    expect(mem.rows.filter((r) => r.eventName === "first_worksheet_scored")).toHaveLength(1);
  });

  it("isSampleEntity mirrors the seeder's marker contract exactly", () => {
    expect(isSampleEntity({ source: SAMPLE_LEAD_SOURCE })).toBe(true);
    expect(isSampleEntity({ apn: `${SAMPLE_APN_PREFIX}X` })).toBe(true);
    expect(isSampleEntity({ source: "referral", apn: "001-002" })).toBe(false);
    expect(isSampleEntity({})).toBe(false);
    expect(isSampleEntity(undefined)).toBe(false);
    // The convention the seeder + clear flow key on (sampleSeeder.ts).
    expect(SAMPLE_LEAD_SOURCE).toBe("sample_data");
    expect(SAMPLE_APN_PREFIX).toBe("SAMPLE-");
  });
});
