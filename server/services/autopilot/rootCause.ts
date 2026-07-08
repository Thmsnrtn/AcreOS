/**
 * Founder Autopilot — root-cause investigation helpers (Elite Vision H2).
 *
 * When an error spikes (Sentry / logs), the immune system dispatches an
 * investigator agent. These are the PURE helpers around that: normalize raw
 * error messages into stable signatures so the same bug isn't investigated
 * twice, rank the loudest signatures, and compose the investigation brief the
 * agent runs. The investigation itself is a model dispatch; this is the
 * deterministic, testable scaffolding around it.
 */

export interface ErrorSample {
  message: string;
  /** Optional first stack frame (file:line) to disambiguate same-message errors. */
  frame?: string;
}

export interface ErrorGroup {
  signature: string;
  count: number;
  sample: string;
}

/**
 * Normalize an error message to a stable signature: strip the volatile parts
 * (numbers, hex ids, uuids, quoted values, absolute paths) so "user 4821 not
 * found" and "user 9930 not found" share one signature. Pure + deterministic.
 */
export function errorSignature(message: string, frame?: string): string {
  let s = (message ?? "").trim();
  s = s.replace(/0x[0-9a-fA-F]+/g, "0xHEX");
  s = s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "UUID");
  s = s.replace(/\/[\w./-]+/g, "PATH"); // absolute-ish paths
  s = s.replace(/["'`][^"'`]*["'`]/g, "STR"); // quoted values
  s = s.replace(/\b\d+\b/g, "N"); // any remaining numbers
  s = s.replace(/\s+/g, " ").trim().toLowerCase();
  const base = s.slice(0, 200);
  return frame ? `${base} @ ${frame.replace(/:\d+$/, "")}` : base;
}

/** Group raw error samples by signature, ranked by frequency (loudest first). */
export function topErrorSignatures(errors: ErrorSample[], k = 5): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  for (const e of errors) {
    const sig = errorSignature(e.message, e.frame);
    const cur = groups.get(sig);
    if (cur) cur.count += 1;
    else groups.set(sig, { signature: sig, count: 1, sample: e.message });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, k);
}

/** Compose the investigation brief handed to the investigator dispatch. */
export function investigationBrief(group: ErrorGroup): string {
  return [
    `Autopilot incident investigation — root cause.`,
    `An error is recurring (${group.count}× in window). Signature: ${group.signature}`,
    `Sample: ${group.sample}`,
    ``,
    `Your task (investigate ONLY — propose, do not deploy):`,
    `1. Locate the code path that raises this. Read the relevant files.`,
    `2. Reproduce the failure mode in reasoning (what input/state triggers it).`,
    `3. Identify the root cause — not the symptom.`,
    `4. Propose the smallest correct fix, as a unified diff, with a one-line rationale.`,
    `5. State the risk class honestly (is this a safe, reversible, well-tested fix, or does it need the founder's judgment?).`,
    ``,
    `Do not push, merge, or deploy. Your output is a proposal that will be gated by codeChangeGate + the founder.`,
  ].join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Impure orchestration — autonomous incident triage (wire-for-real: rootCause
// was dead). Reads recent UNRESOLVED system_error alerts, finds the loudest
// recurring signature, and enqueues ONE investigation dispatch whose brief
// forbids deploy. The investigator (worker, untrusted — no free-form bash, but
// file_read + git_commit) reads the code and proposes a fix as a LOCAL commit /
// unified diff for founder review. It CANNOT push, merge, or deploy — enforced
// by: (1) the brief instruction, (2) the untrusted deny-regex blocking
// git push / fly deploy, and (3) structurally — the worker's env is scrubbed of
// all tokens (allowlist default-deny) and HOME is isolated, so origin (HTTPS)
// has no credential to authenticate a push. (NOTE: codeChangeGate is NOT on
// this wire — it gates only selfPatch's dependency-bump PR path. The no-deploy
// guarantee here rests on the env-scrub + deny-regex, not the gate.) Gated
// behind the dispatch master switch; deduped so a signature isn't re-investigated.
// ────────────────────────────────────────────────────────────────────────────

/** Minimum recurrence before an error is worth an autonomous investigation. */
export const TRIAGE_MIN_COUNT = 3;

export async function runIncidentTriage(opts?: {
  windowHours?: number;
}): Promise<{ enqueued: boolean; signature?: string; dispatchId?: number; reason?: string }> {
  try {
    const { isDispatchEnabled } = await import("./settings");
    if (!(await isDispatchEnabled())) return { enqueued: false, reason: "dispatch disabled" };

    const { db } = await import("../../db");
    const { systemAlerts, soleneDispatchQueue } = await import("@shared/schema");
    const { and, eq, gte, desc } = await import("drizzle-orm");
    const windowHours = opts?.windowHours ?? 24;
    const since = new Date(Date.now() - windowHours * 3_600_000);

    const rows = await db
      .select({ title: systemAlerts.title, message: systemAlerts.message })
      .from(systemAlerts)
      .where(
        and(
          eq(systemAlerts.alertType, "system_error"),
          eq(systemAlerts.status, "new"),
          gte(systemAlerts.createdAt, since),
        ),
      )
      .orderBy(desc(systemAlerts.createdAt))
      .limit(500);

    const samples: ErrorSample[] = rows.map((r) => ({ message: `${r.title}: ${r.message}` }));
    const groups = topErrorSignatures(samples, 5);
    const top = groups.find((g) => g.count >= TRIAGE_MIN_COUNT);
    if (!top) return { enqueued: false, reason: "no signature above threshold" };

    // Dedupe: don't re-investigate a signature already dispatched in the window.
    const sourceId = `incident:${top.signature}`.slice(0, 200);
    const existing = await db
      .select({ id: soleneDispatchQueue.id })
      .from(soleneDispatchQueue)
      .where(and(eq(soleneDispatchQueue.sourceId, sourceId), gte(soleneDispatchQueue.queuedAt, since)))
      .limit(1);
    if (existing.length > 0) return { enqueued: false, signature: top.signature, reason: "already investigating" };

    const { enqueueDispatch } = await import("../solene/dispatchQueue");
    const dispatchId = await enqueueDispatch({
      sourceType: "detector",
      sourceId,
      agentRole: "iris",
      promptText: investigationBrief(top),
      maxCostUsd: 2,
      enqueuedBy: "incident-triage",
    });
    return { enqueued: true, signature: top.signature, dispatchId };
  } catch {
    return { enqueued: false, reason: "error (swallowed)" };
  }
}
