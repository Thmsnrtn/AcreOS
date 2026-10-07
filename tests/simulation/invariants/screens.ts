/**
 * How a screen becomes an invariant observation — ONE definition, used by the
 * year harness (on the live Letter) and by the unit test that pins the Letter's
 * composer (letterNumbersHaveFields.test.ts), so the two cannot disagree about
 * what "a number with a source" means.
 */
import type { ScreenEvent } from "./types";

const PROSE_KEYS = /^(theWord|neededLine|focusLine|calibrationLine|line|greeting|modelChangeNotice)$/;

/** Every number a structured payload carries, with the renderings a sentence may use (rounded, percent). */
export function sourcedNumbersOf(...payloads: unknown[]): number[] {
  const nums: number[] = [];
  const walk = (o: unknown, key = "") => {
    if (typeof o === "number" && Number.isFinite(o)) { nums.push(o, Math.round(o), Math.round(o * 100), Math.round(o * 10) / 10, Math.round(o * 1000) / 10); return; }
    if (typeof o === "string" && PROSE_KEYS.test(key)) return;
    if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, k);
  };
  for (const p of payloads) walk(p);
  return nums;
}

/** The founder's Letter (GET /api/founder/solene/brief → brief) as a screen. */
export function letterScreen(brief: any, ...sources: unknown[]): ScreenEvent {
  const texts = [brief.theWord, brief.neededLine, brief.focusLine, brief.calibrationLine, brief.modelChangeNotice, ...(brief.learningLines ?? []), ...(brief.trackRecord ?? []).map((t: any) => t.line), ...(brief.misses ?? []).map((m: any) => m.line)]
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  return { surface: "letter", texts, sourcedNumbers: sourcedNumbersOf(brief, ...sources) };
}
