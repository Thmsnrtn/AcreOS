/**
 * The glossary registry, served as data (bundle diet Candidate 2).
 *
 * The ONE source of truth stays client/src/lib/glossary.ts (GLOSSARY) —
 * the server and the test suites import that module synchronously.
 * The client no longer bundles it: the data ships as /glossary.json
 * (generated verbatim from the module; tests/unit/
 * staticDataServedAsData.test.ts pins the asset deep-equal to the
 * module and byte-identical to the generator's output), and consumers
 * load it through the shared static-data loader.
 *
 * Shape guard (the #716 D-2 mandate): the loaded value is validated
 * at this boundary before any consumer sees it. A wrong-shape 200 —
 * a truncated deploy, a stale asset, a hand-edited JSON — flows into
 * the same visible load-error path as a failed fetch, never into a
 * render that would crash on a missing field.
 *
 * Regenerate the asset after editing glossary.ts:
 *   npx tsx -e 'import {GLOSSARY} from "./client/src/lib/glossary";
 *   import fs from "node:fs"; fs.writeFileSync("client/public/glossary.json", JSON.stringify(GLOSSARY,null,2)+"\n")'
 */

import { useEffect, useState } from "react";
import type { GlossaryEntry } from "@/lib/glossary";
import {
  GLOSSARY_URL,
  loadStaticData,
  type StaticDataState,
} from "@/lib/static-data";

export type GlossaryData = Record<string, GlossaryEntry>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function isGlossaryEntry(v: unknown): v is GlossaryEntry {
  return isRecord(v) && isStr(v.term) && isStr(v.definition);
}

/**
 * The boundary check for the served glossary: a non-empty plain
 * object whose every value is a well-formed { term, definition }
 * entry. Anything else is a load error.
 */
export function isGlossaryData(v: unknown): v is GlossaryData {
  if (!isRecord(v)) return false;
  const entries = Object.values(v);
  return entries.length > 0 && entries.every(isGlossaryEntry);
}

/**
 * Look up a glossary entry by slug in the LOADED data. Returns
 * undefined while the asset is in flight (data null), on load
 * failure, and for unknown slugs — the pre-extraction module
 * selector's semantics, with the data as the first argument (the
 * selectCampaignTemplates discipline).
 */
export function getGlossaryEntry(
  data: GlossaryData | null,
  slug: string,
): GlossaryEntry | undefined {
  return data?.[slug];
}

/**
 * The glossary for a page surface: `data` is null while the asset
 * is in flight; `error` is true on a failed fetch OR a wrong-shape
 * asset — consumers render their shell plus a visible error line,
 * never silently-empty sections (the static-data discipline).
 */
export function useGlossaryData(): StaticDataState<GlossaryData> {
  const [state, setState] = useState<StaticDataState<GlossaryData>>({
    data: null,
    error: false,
  });
  useEffect(() => {
    let live = true;
    loadStaticData<unknown>(GLOSSARY_URL).then(
      (raw) => {
        if (!live) return;
        if (isGlossaryData(raw)) {
          setState({ data: raw, error: false });
        } else {
          setState({ data: null, error: true });
        }
      },
      () => {
        if (live) setState({ data: null, error: true });
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
