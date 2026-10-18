import { describe, expect, it } from "vitest"
import {
  generationReceipt,
  projectGenerationJob,
  type GenerationJobRow,
} from "../../shared/cmo/generationProgress"
const row = (id: number, status: string, receipt?: unknown): GenerationJobRow => ({
  id,
  status,
  createdAt: "2026-10-13",
  payload: { intent: "Parcel research", generationReceipt: receipt },
})
const generated = { scriptsGenerated: 2, renderJobsQueued: 2, totalCostCents: 15 }
describe("durable generation progress", () => {
  it("retains queued/running truth and never invents legacy completion", () => {
    expect(projectGenerationJob(row(1, "pending"), []).state).toBe("queued")
    expect(projectGenerationJob(row(1, "running"), []).state).toBe("running")
    expect(projectGenerationJob(row(1, "sent"), []).state).toBe("legacy_unverified")
  })
  it("distinguishes budget refusal, rejected scripts, and failed workers", () => {
    expect(
      projectGenerationJob(row(1, "sent", { blockedBy: "daily_budget_exceeded" }), []).state
    ).toBe("blocked")
    expect(projectGenerationJob(row(1, "sent", { renderJobsQueued: 0 }), []).state).toBe(
      "no_render_qualified"
    )
    expect(projectGenerationJob(row(1, "failed"), []).state).toBe("failed")
  })
  it("preserves partial work and missing child records across reloads", () => {
    const root = row(1, "sent", generated)
    expect(projectGenerationJob(root, [row(2, "sent"), row(3, "failed")]).state).toBe(
      "partially_completed"
    )
    expect(projectGenerationJob(root, [row(2, "sent")]).state).toBe("progress_unavailable")
    expect(projectGenerationJob(root, [row(2, "sent"), row(3, "running")]).state).toBe("rendering")
  })
  it("retains a failed aspect ratio even when its render job finished", () => {
    const result = projectGenerationJob(row(1, "sent", { renderJobsQueued: 1 }), [
      row(2, "sent", { renderCount: 2, requestedRenderCount: 3, decisionsInboxItemId: 8 }),
    ])
    expect(result.state).toBe("partially_completed")
    expect(result.reviewIds).toEqual([8])
  })
  it("only names review creation with a worker receipt and never implies delivery", () => {
    const result = projectGenerationJob(row(1, "sent", generated), [
      row(2, "sent", { decisionsInboxItemId: 8 }),
      row(3, "sent", { decisionsInboxItemId: 9 }),
    ])
    expect(result.state).toBe("review_created")
    expect(result.reviewIds).toEqual([8, 9])
    expect(
      projectGenerationJob(row(1, "sent", generated), [row(2, "sent"), row(3, "sent")]).state
    ).toBe("render_processed")
  })
  it("whitelists receipt fields and excludes secrets and malformed measurements", () => {
    expect(
      generationReceipt({
        totalCostCents: -1,
        renderJobsQueued: 1.5,
        token: "secret",
        error: "secret",
      })
    ).toBeNull()
    expect(
      generationReceipt({ scriptsGenerated: 1, secret: "token", blockedBy: "arbitrary error" })
    ).toEqual({ scriptsGenerated: 1 })
  })
})
