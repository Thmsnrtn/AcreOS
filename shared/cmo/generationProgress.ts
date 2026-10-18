/** Bounded worker receipts, stored with the existing outbox payload. No provider errors or secrets. */
export function generationReceipt(result: unknown): Record<string, number | string> | null {
  if (!result || typeof result !== "object") return null
  const input = result as Record<string, unknown>
  const receipt: Record<string, number | string> = {}
  for (const key of [
    "scriptsGenerated",
    "scriptsPassed",
    "scriptsRejectedPreRender",
    "renderJobsQueued",
    "totalCostCents",
    "renderCount",
    "requestedRenderCount",
    "renderCostCents",
    "decisionsInboxItemId",
  ]) {
    const value = input[key]
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) receipt[key] = value
  }
  if (["auto_generation_disabled", "daily_budget_exceeded", "operating_budget_unavailable"].includes(String(input.blockedBy)))
    receipt.blockedBy = String(input.blockedBy)
  if (typeof input.bundleId === "string" && input.bundleId.length <= 100)
    receipt.bundleId = input.bundleId
  return Object.keys(receipt).length ? receipt : null
}

export interface GenerationJobRow {
  id: number
  status: string
  payload: Record<string, unknown>
  createdAt: Date | string
}
export function projectGenerationJob(root: GenerationJobRow, children: GenerationJobRow[]) {
  const receipt = generationReceipt(root.payload.generationReceipt)
  const finished = children.filter((row) => row.status === "sent")
  const failed = children.filter((row) => row.status === "failed")
  const reviewIds = finished.flatMap((row) => {
    const id = generationReceipt(row.payload.generationReceipt)?.decisionsInboxItemId
    return typeof id === "number" && id > 0 ? [id] : []
  })
  const expected = typeof receipt?.renderJobsQueued === "number" ? receipt.renderJobsQueued : null
  let state = "unknown"
  if (root.status === "pending" || root.status === "retry") state = "queued"
  else if (root.status === "running") state = "running"
  else if (root.status === "failed") state = "failed"
  else if (root.status === "sent") {
    if (!receipt) state = "legacy_unverified"
    else if (receipt.blockedBy) state = "blocked"
    else if (failed.length) state = finished.length ? "partially_completed" : "failed"
    else if (
      finished.some((row) => {
        const child = generationReceipt(row.payload.generationReceipt)
        return (
          typeof child?.requestedRenderCount === "number" &&
          typeof child.renderCount === "number" &&
          child.renderCount < child.requestedRenderCount
        )
      })
    )
      state = "partially_completed"
    else if (expected !== null && children.length < expected) state = "progress_unavailable"
    else if (children.some((row) => row.status === "running")) state = "rendering"
    else if (children.some((row) => ["pending", "retry"].includes(row.status)))
      state = "render_queued"
    else if (expected === 0) state = "no_render_qualified"
    else if (expected !== null && finished.length === expected)
      state = reviewIds.length ? "review_created" : "render_processed"
  }
  return {
    id: root.id,
    createdAt: root.createdAt,
    intent:
      typeof root.payload.intent === "string"
        ? root.payload.intent.slice(0, 2000)
        : "Generation request",
    state,
    receipt,
    renderJobs: { expected, processed: finished.length, failed: failed.length },
    reviewIds: [...new Set(reviewIds)],
  }
}

export const generationProgressLabels: Record<string, string> = {
  queued: "Queued",
  running: "Generating",
  rendering: "Rendering",
  render_queued: "Render queued",
  failed: "Failed — inspect the record before retrying",
  blocked: "Blocked by operating settings or daily budget",
  partially_completed: "Some render jobs finished; others failed",
  progress_unavailable: "Some job records are unavailable",
  no_render_qualified: "No script qualified for rendering",
  review_created: "Review item created — inspect the videos before choosing destinations",
  render_processed: "Render worker finished; review status unverified",
  legacy_unverified: "Older job — completion details unavailable",
  unknown: "Progress unavailable",
}
