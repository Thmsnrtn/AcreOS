/**
 * The sub-processor list, served as data (bundle diet).
 *
 * The ONE source of truth stays client/src/data/sub-processors.ts —
 * the test suites import that module synchronously. The client pages
 * (/security, /legal/sub-processors, the privacy policy's Section 8
 * table) no longer bundle the list: it ships as /sub-processors.json
 * (generated verbatim from the module; tests/unit/
 * staticDataServedAsData.test.ts pins the asset deep-equal to the
 * module and byte-identical to the generator's output), and each page
 * loads it through the shared static-data loader. The privacy page's
 * rows are still built by the module's own subProcessorRowsHtml, run
 * over the loaded list — the markup is the module's, not a copy.
 *
 * Shape guard (the #716 D-2 mandate): the loaded value is validated
 * at this boundary before any consumer sees it. A wrong-shape 200 —
 * a truncated deploy, a stale asset, a hand-edited JSON — flows into
 * the same visible load-error path as a failed fetch, never into a
 * render that would crash on a missing field.
 *
 * Regenerate the asset after editing sub-processors.ts:
 *   npx tsx -e 'import {SUB_PROCESSORS, SUB_PROCESSORS_LAST_UPDATED} from "./client/src/data/sub-processors"; import fs from "node:fs"; fs.writeFileSync("client/public/sub-processors.json", JSON.stringify({lastUpdated: SUB_PROCESSORS_LAST_UPDATED, processors: SUB_PROCESSORS}, null, 2)+"\n")'
 */

import type { SubProcessor } from "@/data/sub-processors";
import {
  SUB_PROCESSORS_URL,
  useStaticData,
  type StaticDataState,
} from "@/lib/static-data";

export interface SubProcessorsData {
  lastUpdated: string;
  processors: SubProcessor[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isOptStr = (v: unknown): boolean => v === undefined || isStr(v);

function isSubProcessor(v: unknown): v is SubProcessor {
  return (
    isRecord(v) &&
    isStr(v.vendor) &&
    isStr(v.purpose) &&
    Array.isArray(v.dataCategories) &&
    v.dataCategories.every(isStr) &&
    isStr(v.region) &&
    isOptStr(v.dpaUrl) &&
    isOptStr(v.effectiveDate) &&
    (v.optional === undefined || typeof v.optional === "boolean") &&
    isStr(v.evidence)
  );
}

/**
 * The boundary check for the served list: a non-empty processors
 * array of well-formed rows plus the version stamp. Anything else
 * is a load error.
 */
export function isSubProcessorsData(v: unknown): v is SubProcessorsData {
  return (
    isRecord(v) &&
    isStr(v.lastUpdated) &&
    Array.isArray(v.processors) &&
    v.processors.length > 0 &&
    v.processors.every(isSubProcessor)
  );
}

/**
 * The sub-processor list for a page surface: `data` is null while the
 * asset is in flight; `error` is true on a failed fetch OR a
 * wrong-shape asset — consumers render their shell plus a visible
 * error line, never a silently-shorter list (the static-data
 * discipline; for the privacy page, never a silently shorter legal
 * document).
 */
export function useSubProcessors(): StaticDataState<SubProcessorsData> {
  const { data, error } = useStaticData<unknown>(SUB_PROCESSORS_URL);
  if (error) return { data: null, error: true };
  if (data === null) return { data: null, error: false };
  if (!isSubProcessorsData(data)) return { data: null, error: true };
  return { data, error: false };
}
