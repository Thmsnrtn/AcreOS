/**
 * Tier 2D — incident lessonsLearned → auto-drafted failure-mode entry.
 *
 * Proves:
 *   - a resolved incident with lessonsLearned inserts a status='draft' row
 *     (NEVER 'published') with the mapped severity/category + idempotency keys
 *   - no lessons / non-final status → no insert
 *   - an existing row for the incident → no duplicate insert
 *   - a db error → structured error result, never a throw (fail-soft for the
 *     PATCH handler that triggers drafting)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const state: {
  existingRows: Array<{ id: number; slug: string }>;
  insertedValues: unknown[];
  insertShouldThrow: boolean;
} = {
  existingRows: [],
  insertedValues: [],
  insertShouldThrow: false,
};

vi.mock("../../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(state.existingRows),
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        if (state.insertShouldThrow) {
          return Promise.reject(new Error("insert blew up"));
        }
        state.insertedValues.push(v);
        return Promise.resolve();
      },
    }),
  },
}));

import {
  draftFailureModeFromIncident,
  incidentFailureModeSlug,
} from "./incidentFailureModeDraft";
import type { Incident } from "@shared/schema";

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "a1b2c3d4-e5f6-7890-abcd-ef0123456789",
    severity: "SEV-1",
    title: "Worker silently stopped processing scheduled jobs",
    summary: "The worker process group went dark for 6 hours.",
    status: "resolved",
    startedAt: new Date("2026-06-09T01:00:00Z"),
    detectedAt: new Date("2026-06-09T02:00:00Z"),
    mitigatedAt: new Date("2026-06-09T05:00:00Z"),
    resolvedAt: new Date("2026-06-09T07:00:00Z"),
    detectionSource: "monitor",
    rootCauseCategory: "code",
    rootCauseSummary: "Unhandled promise rejection killed the scheduler loop.",
    impactSummary: "Scheduled jobs delayed 6h.",
    affectedOrgCount: 3,
    estimatedRevenueImpactCents: 0,
    postMortemUrl: null,
    lessonsLearned:
      "Every long-lived loop needs a top-level catch + deadman heartbeat.",
    followupActions: null,
    createdAt: new Date("2026-06-09T01:30:00Z"),
    updatedAt: new Date("2026-06-09T07:00:00Z"),
    createdBy: "founder",
    ...overrides,
  } as Incident;
}

beforeEach(() => {
  state.existingRows = [];
  state.insertedValues = [];
  state.insertShouldThrow = false;
});

describe("draftFailureModeFromIncident", () => {
  it("drafts a status='draft' failure mode from a resolved incident with lessons", async () => {
    const incident = makeIncident();
    const result = await draftFailureModeFromIncident(incident);

    expect(result.drafted).toBe(true);
    expect(result.reason).toBe("drafted");
    expect(result.slug).toBe("incident-a1b2c3d4");

    expect(state.insertedValues).toHaveLength(1);
    const row = state.insertedValues[0] as Record<string, unknown>;
    // Draft, never auto-published.
    expect(row.status).toBe("draft");
    expect(row.slug).toBe("incident-a1b2c3d4");
    expect(row.sourceIncidentId).toBe(incident.id);
    // SEV-1 → critical; rootCauseCategory 'code' → regression_class.
    expect(row.severity).toBe("critical");
    expect(row.category).toBe("regression_class");
    // Lessons become the prevention guidance + appear in the description.
    expect(row.prevention).toBe(incident.lessonsLearned);
    expect(String(row.description)).toContain("Lessons learned");
    expect(String(row.description)).toContain("deadman heartbeat");
    expect(String(row.description)).toContain(incident.summary);
    expect(row.exampleIncidentRefs).toEqual([`incident:${incident.id}`]);
  });

  it("maps SEV-4 → low and unknown root cause → other", async () => {
    const result = await draftFailureModeFromIncident(
      makeIncident({
        severity: "SEV-4",
        rootCauseCategory: "provider",
        status: "post_mortem_done",
      }),
    );
    expect(result.drafted).toBe(true);
    const row = state.insertedValues[0] as Record<string, unknown>;
    expect(row.severity).toBe("low");
    expect(row.category).toBe("other");
  });

  it("does nothing when lessonsLearned is empty or whitespace", async () => {
    const r1 = await draftFailureModeFromIncident(
      makeIncident({ lessonsLearned: null }),
    );
    const r2 = await draftFailureModeFromIncident(
      makeIncident({ lessonsLearned: "   " }),
    );
    expect(r1.reason).toBe("no_lessons");
    expect(r2.reason).toBe("no_lessons");
    expect(state.insertedValues).toHaveLength(0);
  });

  it("does nothing when the incident is not in a final status", async () => {
    for (const status of ["open", "mitigated"]) {
      const result = await draftFailureModeFromIncident(
        makeIncident({ status: status as Incident["status"] }),
      );
      expect(result.drafted).toBe(false);
      expect(result.reason).toBe("status_not_final");
    }
    expect(state.insertedValues).toHaveLength(0);
  });

  it("is idempotent — an existing row for the incident skips the insert", async () => {
    state.existingRows = [{ id: 7, slug: "incident-a1b2c3d4" }];
    const result = await draftFailureModeFromIncident(makeIncident());
    expect(result.drafted).toBe(false);
    expect(result.reason).toBe("already_drafted");
    expect(result.slug).toBe("incident-a1b2c3d4");
    expect(state.insertedValues).toHaveLength(0);
  });

  it("never throws — a db error returns a structured 'error' result", async () => {
    state.insertShouldThrow = true;
    const result = await draftFailureModeFromIncident(makeIncident());
    expect(result.drafted).toBe(false);
    expect(result.reason).toBe("error");
  });
});

describe("incidentFailureModeSlug", () => {
  it("uses the first 8 chars of the incident uuid", () => {
    expect(incidentFailureModeSlug("deadbeef-0000-1111-2222-333344445555")).toBe(
      "incident-deadbeef",
    );
  });
});
