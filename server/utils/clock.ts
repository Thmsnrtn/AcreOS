/**
 * The one clock. Every "now" in server code reads it.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * Server code read the wall clock directly in ~4,000 places. That is invisible
 * in production and fatal in simulation: a simulated month cannot pass when
 * half the code asks the machine what time it is. Measured 2026-10-07: the
 * founder simulation's 30-day run produced 2 articles, not ~30, because the
 * autopilot's exactly-once effect key (`computeEffectKey`) bucketed on the
 * REAL clock — the whole compressed month fell into one or two 30-minute
 * buckets, so every later Writer dispatch deduplicated onto the first.
 *
 * ── PRODUCTION ──────────────────────────────────────────────────────────────
 * `clock.now()` is `new Date()` and `clock.nowMs()` is `Date.now()`. Nothing
 * else. There is no offset unless a simulation explicitly installs one.
 *
 * ── SIMULATION ──────────────────────────────────────────────────────────────
 * A simulation advances time by an OFFSET added to the wall clock, so time
 * still flows inside a step (timeouts, latency) but the calendar moves as fast
 * as the simulation wants. Two ways to install it:
 *
 *   - in-process: `setSimulatedClockOffset(ms)` (tests, in-process harnesses);
 *   - cross-process: `ACREOS_SIM_CLOCK_FILE=<path>` — a JSON file
 *     `{"offsetMs": <n>}` the harness rewrites; web and worker re-read it at
 *     most every 100 ms. The simulation database carries the SAME offset for
 *     SQL `now()` (tests/simulation/platform/simclock.sql), so JS and SQL agree.
 *
 * The file mechanism is refused on the production Fly app — a stray env var
 * must never be able to move production's calendar — and any nonzero offset
 * is visible to ops through `clockStatus()` (health check `clock_offset`).
 *
 * The `clockReads` ratchet (scripts/check-clock-reads.mjs) counts every direct
 * wall-clock read in server/ outside this file; it may only shrink.
 */
import { readFileSync, statSync } from "node:fs";

let inProcessOffsetMs = 0;

const FILE = process.env.ACREOS_SIM_CLOCK_FILE || "";
const PRODUCTION_APP = "acreos";
const fileRefused = !!FILE && process.env.FLY_APP_NAME === PRODUCTION_APP;
let fileOffsetMs = 0;
let fileCheckedAt = 0;
let fileMtimeMs = -1;

function readFileOffset(): number {
  if (!FILE || fileRefused) return 0;
  const wall = Date.now();
  if (wall - fileCheckedAt < 100) return fileOffsetMs;
  fileCheckedAt = wall;
  try {
    const st = statSync(FILE);
    if (st.mtimeMs !== fileMtimeMs) {
      fileMtimeMs = st.mtimeMs;
      const parsed = JSON.parse(readFileSync(FILE, "utf8")) as { offsetMs?: unknown };
      const n = Number(parsed.offsetMs);
      fileOffsetMs = Number.isFinite(n) ? n : 0;
    }
  } catch {
    // A half-written file keeps the last good offset; a missing one is zero.
  }
  return fileOffsetMs;
}

function offsetMs(): number {
  return inProcessOffsetMs + readFileOffset();
}

export const clock = {
  /** Milliseconds since the epoch, on the one clock. */
  nowMs(): number {
    return Date.now() + offsetMs();
  },
  /** A fresh Date for "now", on the one clock. */
  now(): Date {
    return new Date(Date.now() + offsetMs());
  },
};

/** In-process simulation hook. Production never calls this. */
export function setSimulatedClockOffset(ms: number): void {
  if (!Number.isFinite(ms)) throw new Error("clock offset must be a finite number of milliseconds");
  inProcessOffsetMs = ms;
}

/** What ops sees: is this process on the real calendar? */
export function clockStatus(): { offsetMs: number; source: "wall" | "simulated"; fileRefused: boolean } {
  const o = offsetMs();
  return { offsetMs: o, source: o === 0 ? "wall" : "simulated", fileRefused };
}
