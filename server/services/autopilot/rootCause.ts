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
