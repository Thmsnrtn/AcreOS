/**
 * Approve-above-threshold — the Today queue's batch affordance over
 * "Pax would handle" rows (Wave 1.3, handoff P1 §4.1 move 3).
 *
 * PURE module by design: it names no server routes and owns no transport.
 * The page injects the per-item mutation (today.tsx passes the SAME
 * per-item PATCH /api/today/queue/:id call the row-level Done button
 * uses), and this module only sequences it — one call per item, in
 * order, collecting per-item results. There is deliberately no bulk
 * endpoint anywhere in this flow: batch-approve is a human tapping the
 * existing per-item action N times, so every item passes exactly the
 * same server-side path it always did. tests/unit/doorInteractions.test.tsx
 * pins both halves (per-item sequencing here; no new route strings in the
 * Today door's source).
 *
 * Honesty boundary (refuse-not-fabricate): "approving" a queue row marks
 * it done through the per-item resolution ledger — it does NOT execute or
 * send anything on the operator's behalf. The confirm dialog says so in
 * as many words; keep the copy and this comment in agreement.
 */

export interface ThresholdItemLike {
  id: string;
  /** Queue source — only Pax-sourced rows carry a meaningful confidence. */
  source: string;
  /** Pax model confidence (0..1); absent/null on non-Pax rows. */
  confidence?: number | null;
}

/**
 * True when a queue item gets the "Pax would handle" treatment: a
 * Pax-sourced row whose confidence meets/exceeds the user's autonomy
 * threshold. Single source of truth — DecisionQueue's row styling and the
 * batch affordance both call this, so they can never disagree about which
 * rows are "above threshold".
 */
export function isAboveThreshold(item: ThresholdItemLike, threshold: number): boolean {
  return (
    item.source.startsWith("pax-") &&
    typeof item.confidence === "number" &&
    item.confidence >= threshold
  );
}

/** The exact rows a batch approve would touch, in queue order. */
export function qualifyingApprovals<T extends ThresholdItemLike>(
  items: readonly T[],
  threshold: number,
): T[] {
  return items.filter((item) => isAboveThreshold(item, threshold));
}

export interface BatchApproveResult {
  /** Ids whose per-item mutation succeeded, in the order attempted. */
  approved: string[];
  /** Per-item failures — these rows stay in the queue. */
  failed: Array<{ id: string; error: string }>;
}

/**
 * Run the injected per-item mutation once per item, SEQUENTIALLY (never a
 * parallel burst — the server sees the same cadence as N human taps), and
 * keep going past individual failures so one flaky row doesn't strand the
 * rest. Reports progress after each item for the confirm dialog's
 * "Approving n of N…" readout.
 */
export async function approveItemsSequentially(
  items: ReadonlyArray<{ id: string }>,
  approveItem: (id: string) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
): Promise<BatchApproveResult> {
  const approved: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  let done = 0;
  for (const item of items) {
    try {
      await approveItem(item.id);
      approved.push(item.id);
    } catch (err) {
      failed.push({
        id: item.id,
        error: err instanceof Error ? err.message : "Failed to approve",
      });
    }
    done += 1;
    onProgress?.(done, items.length);
  }
  return { approved, failed };
}
