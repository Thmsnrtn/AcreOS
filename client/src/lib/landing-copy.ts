/**
 * The public landing page's copy, served as data.
 *
 * The ONE source of truth stays client/src/pages/landing/copy.ts
 * (LANDING_COPY) — the claims audit (scripts/audit-public-claims.ts)
 * reads that module from disk and the landing suites import it
 * synchronously. The client no longer bundles it: the data ships as
 * /landing-copy.json (generated verbatim from the module;
 * tests/unit/staticDataServedAsData.test.ts pins the asset deep-equal
 * to the module and byte-identical to the generator's output), and
 * the landing page loads it ONCE through the shared static-data
 * loader and threads each section its slice as a prop.
 *
 * Shape guard (the #716 D-2 mandate): the loaded value is validated
 * at this boundary before any section sees it. A wrong-shape 200 —
 * a truncated deploy, a stale asset, a hand-edited JSON — flows into
 * the same visible load-error path as a failed fetch, never into a
 * section render that would crash on a missing field.
 *
 * Regenerate the asset after editing copy.ts:
 *   npx tsx -e 'import {LANDING_COPY} from "./client/src/pages/landing/copy";
 *   import fs from "node:fs"; fs.writeFileSync("client/public/landing-copy.json", JSON.stringify(LANDING_COPY,null,2)+"\n")'
 */

import { useEffect, useState } from "react"
import type { LandingCopy } from "@/pages/landing/copy"
import { LANDING_COPY_URL, loadStaticData, type StaticDataState } from "@/lib/static-data"

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === "string"
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr)

/** Every named field of a section is a string. */
function sectionWithStrings(v: unknown, fields: readonly string[]): v is Record<string, unknown> {
  return isRecord(v) && fields.every((f) => isStr(v[f]))
}

function isStepArray(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.every((s) => isRecord(s) && typeof s.n === "number" && isStr(s.t) && isStr(s.b))
  )
}

function isSourceArray(v: unknown): boolean {
  return Array.isArray(v) && v.every((s) => isRecord(s) && isStr(s.agency) && isStr(s.what))
}

function isDimensionArray(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.every((d) => isRecord(d) && isStr(d.name) && typeof d.weight === "number" && isStr(d.what))
  )
}

/**
 * The boundary check for the served landing copy: all thirteen
 * top-level sections present and well-formed (every string the
 * sections render is a string; every list they map is a list of the
 * right element shape). Anything else is a load error.
 */
export function isLandingCopy(v: unknown): v is LandingCopy {
  if (!isRecord(v)) return false
  return (
    sectionWithStrings(v.hero, [
      "eyebrow",
      "wedge",
      "cta1",
      "cta2",
      "ctaSub",
      "proof",
      "agenciesLabel",
    ]) &&
    isRecord(v.hero) &&
    isStrArray(v.hero.title) &&
    isStrArray(v.hero.agencies) &&
    sectionWithStrings(v.productShots, ["eyebrow", "title", "sub", "proofCta"]) &&
    sectionWithStrings(v.positioning, ["primary", "inProduct", "roadmap"]) &&
    sectionWithStrings(v.how, ["eyebrow", "title"]) &&
    isRecord(v.how) &&
    isStepArray(v.how.steps) &&
    sectionWithStrings(v.agents, ["eyebrow", "title", "sub"]) &&
    sectionWithStrings(v.day, ["eyebrow", "title", "sub"]) &&
    sectionWithStrings(v.features, ["eyebrow", "title", "sub"]) &&
    sectionWithStrings(v.data, ["eyebrow", "title", "sub", "promise", "proofCta"]) &&
    isRecord(v.data) &&
    isSourceArray(v.data.sources) &&
    sectionWithStrings(v.quotes, ["eyebrow", "title"]) &&
    sectionWithStrings(v.pricing, ["eyebrow", "title", "sub"]) &&
    sectionWithStrings(v.faq, ["eyebrow", "title"]) &&
    sectionWithStrings(v.cta, ["eyebrow", "title", "sub", "cta1", "cta2"]) &&
    sectionWithStrings(v.landCreditScore, [
      "eyebrow",
      "title",
      "sub",
      "scaleNote",
      "dimensionsTitle",
      "dimensionsSub",
      "methodologyNote",
      "sampleLabel",
      "honestTitle",
      "cta1",
      "cta2",
    ]) &&
    isRecord(v.landCreditScore) &&
    isDimensionArray(v.landCreditScore.dimensions) &&
    isStrArray(v.landCreditScore.honest)
  )
}

/**
 * The landing copy for a page surface: `data` is null while the asset
 * is in flight; `error` is true on a failed fetch OR a wrong-shape
 * asset — consumers render their shell plus a visible error line,
 * never silently-empty sections (the static-data discipline).
 */
export function useLandingCopy(): StaticDataState<LandingCopy> {
  const [state, setState] = useState<StaticDataState<LandingCopy>>({
    data: null,
    error: false,
  })
  useEffect(() => {
    let live = true
    loadStaticData<unknown>(LANDING_COPY_URL).then(
      (raw) => {
        if (!live) return
        if (isLandingCopy(raw)) {
          setState({ data: raw, error: false })
        } else {
          setState({ data: null, error: true })
        }
      },
      () => {
        if (live) setState({ data: null, error: true })
      }
    )
    return () => {
      live = false
    }
  }, [])
  return state
}
