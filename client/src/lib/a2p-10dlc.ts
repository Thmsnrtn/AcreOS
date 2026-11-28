/**
 * The A2P 10DLC registration registry (shared/sms/a2p10dlc: A2P_STATUSES,
 * A2P_SOURCE_LABELS, A2P_10DLC_STEPS), served to the browser as data —
 * /a2p-10dlc.json — instead of being bundled into the JS (bundle diet BD-10).
 * The shared module stays the ONE source of truth: the server keeps importing
 * it synchronously; only the browser reads the copy, and a unit pin proves the
 * copy is the module's data verbatim (tests/unit/staticDataServedAsData.test.ts).
 *
 * Regenerate the copy after editing the module:
 *   npx tsx -e 'import {A2P_STATUSES, A2P_SOURCE_LABELS, A2P_10DLC_STEPS} from "./shared/sms/a2p10dlc"; import fs from "node:fs"; fs.writeFileSync("client/public/a2p-10dlc.json", JSON.stringify({statuses: A2P_STATUSES, sourceLabels: A2P_SOURCE_LABELS, steps: A2P_10DLC_STEPS}, null, 2)+"\n")'
 *
 * Shell-first like every static-data consumer: while the registry is in
 * flight the caller renders its shell plus a visible loading state; a failed
 * or wrong-shape load surfaces a visible error, never a silently empty
 * checklist.
 */
import type { A2pStatus, A2pStatusSource, A2pStep } from "@shared/sms/a2p10dlc";
import { A2P_10DLC_URL, useStaticData, type StaticDataState } from "./static-data";

export interface A2p10dlcData {
  statuses: readonly A2pStatus[];
  sourceLabels: Readonly<Record<A2pStatusSource, string>>;
  steps: readonly A2pStep[];
}

const A2P_STEP_REQUIRED: ReadonlySet<string> = new Set(["yes", "if_applicable", "optional"]);

/** Runtime shape check — a 200 that is not the registry must fail loudly. */
export function isA2p10dlcData(value: unknown): value is A2p10dlcData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.statuses) || data.statuses.length === 0 || !data.statuses.every((s) => typeof s === "string")) return false;
  if (typeof data.sourceLabels !== "object" || data.sourceLabels === null) return false;
  const labels = data.sourceLabels as Record<string, unknown>;
  if (typeof labels.provider_api !== "string" || typeof labels.self_reported !== "string") return false;
  if (!Array.isArray(data.steps) || data.steps.length === 0) return false;
  return data.steps.every((s) => {
    if (typeof s !== "object" || s === null) return false;
    const step = s as Record<string, unknown>;
    if (typeof step.id !== "string" || typeof step.title !== "string" || typeof step.why !== "string") return false;
    if (!Array.isArray(step.fields)) return false;
    return step.fields.every((f) => {
      if (typeof f !== "object" || f === null) return false;
      const field = f as Record<string, unknown>;
      return (
        typeof field.attribute === "string" &&
        typeof field.label === "string" &&
        typeof field.required === "string" && A2P_STEP_REQUIRED.has(field.required) &&
        (field.note === undefined || typeof field.note === "string")
      );
    });
  });
}

export function useA2p10dlc(): StaticDataState<A2p10dlcData> {
  const { data, error } = useStaticData<unknown>(A2P_10DLC_URL);
  if (error) return { data: null, error: true };
  if (data === null) return { data: null, error: false };
  if (!isA2p10dlcData(data)) return { data: null, error: true };
  return { data, error: false };
}
