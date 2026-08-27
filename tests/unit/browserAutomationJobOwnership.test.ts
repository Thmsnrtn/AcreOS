/**
 * createJob verifies template ownership AT THE WRITE.
 *
 * POST /api/browser-automation/jobs passes req.body.templateId straight into
 * createJob, and executeJob loads whatever template the STORED id names. The
 * queue processor is unwired today, which made an unverified id a stored
 * cross-org template execution waiting for someone to wire it (rule-1 service
 * wave, 2026-08-27). This drives the REAL createJob against a mocked db: a
 * foreign org's template is refused, a system template (organizationId null)
 * and the caller's own template are accepted, and the no-template job shape
 * stays legal. If the ownership check is deleted, the foreign case inserts
 * and this file goes red.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  templateRows: [] as Array<{ id: number; organizationId: number | null }>,
  // What the mocked WHERE returns. The real query now carries the ownership
  // predicate (org null OR caller's org), so the mock emulates it in
  // matchingRows() rather than returning templateRows verbatim.
  callerOrg: 1,
  inserted: [] as any[],
  matchingRows() {
    return state.templateRows.filter(
      (t) => t.organizationId === null || t.organizationId === state.callerOrg,
    );
  },
}));

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => state.matchingRows(),
      }),
    }),
    insert: () => ({
      values: (v: any) => ({
        returning: async () => {
          state.inserted.push(v);
          return [{ id: 999, ...v }];
        },
      }),
    }),
  },
}));

vi.mock("puppeteer-core", () => ({ default: {} }));

import { createJob } from "../../server/services/browserAutomation";

describe("createJob template ownership", () => {
  beforeEach(() => {
    state.templateRows = [];
    state.inserted = [];
  });

  it("refuses another org's template and writes nothing", async () => {
    state.templateRows = [{ id: 7, organizationId: 2 }];
    await expect(
      createJob(1, { templateId: 7, name: "steal" }),
    ).rejects.toThrow("Template not found");
    expect(state.inserted).toHaveLength(0);
  });

  it("refuses a template id that does not exist and writes nothing", async () => {
    state.templateRows = [];
    await expect(
      createJob(1, { templateId: 404, name: "ghost" }),
    ).rejects.toThrow("Template not found");
    expect(state.inserted).toHaveLength(0);
  });

  it("accepts a system template (organizationId null)", async () => {
    state.templateRows = [{ id: 7, organizationId: null }];
    const job = await createJob(1, { templateId: 7, name: "system ok" });
    expect(job.id).toBe(999);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0].templateId).toBe(7);
  });

  it("accepts the caller's own template", async () => {
    state.templateRows = [{ id: 7, organizationId: 1 }];
    const job = await createJob(1, { templateId: 7, name: "own ok" });
    expect(job.id).toBe(999);
    expect(state.inserted).toHaveLength(1);
  });

  it("still allows a job with no template at all", async () => {
    const job = await createJob(1, { name: "ad-hoc" });
    expect(job.id).toBe(999);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0].templateId).toBeUndefined();
  });
});
