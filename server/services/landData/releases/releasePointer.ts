/**
 * The release pointer (D2b) — which release is CURRENT, as an append-only
 * history. Promotion and rollback are both a new entry; nothing is ever
 * edited or removed, so "what was current at time t, who moved it and why"
 * is always answerable from the history alone.
 *
 *   promote   points at a release that has NEVER been current, and mints its
 *             permanent name (releaseName.ts) — first promotion is naming;
 *   rollback  points back at a release that WAS current before (by default
 *             the one current immediately before the current release was
 *             first promoted; or any earlier-current release named
 *             explicitly, which also covers rolling forward again). It
 *             reuses that release's name — a name is minted once.
 *
 * The current release is the last entry's. Every function takes a history
 * and returns a NEW frozen history whose prefix is the input's entries by
 * reference; the input is never touched. Every function first verifies the
 * history it was given and refuses to extend a corrupt one.
 *
 * Pure: the caller supplies the instant, the actor and the catalog of
 * releases that exist. Persistence is a proposal (docs/land-data/INTEGRATION-D2b.md).
 */

import { isReleaseId } from "./releaseManifest";
import { nextReleaseName } from "./releaseName";

export type PointerAction = "promote" | "rollback";

export interface PointerEntry {
  /** 1-based, contiguous. */
  seq: number;
  action: PointerAction;
  releaseId: string;
  /** The release's permanent name, minted at its first promotion. */
  releaseName: string;
  /** The release current before this entry; null only for the very first. */
  previousReleaseId: string | null;
  /** ISO instant; non-decreasing along the history. */
  at: string;
  actor: string;
  reason: string;
}

export type PointerHistory = readonly PointerEntry[];

export interface PointerMove {
  at: Date;
  actor: string;
  reason: string;
}

export interface PointerResult {
  history: PointerHistory;
  entry: PointerEntry;
}

export function currentRelease(h: PointerHistory): { releaseId: string; releaseName: string } | null {
  const last = h[h.length - 1];
  return last ? { releaseId: last.releaseId, releaseName: last.releaseName } : null;
}

/** Every rule a history must satisfy. Empty means valid. */
export function verifyPointerHistory(h: PointerHistory): string[] {
  const problems: string[] = [];
  const names: string[] = [];
  const nameOf = new Map<string, string>();
  let prevAt = -Infinity;
  h.forEach((e, i) => {
    const at = `entry ${i + 1}`;
    if (e.seq !== i + 1) problems.push(`${at}: seq is ${e.seq}, expected ${i + 1}`);
    if (!isReleaseId(e.releaseId)) problems.push(`${at}: ${JSON.stringify(e.releaseId)} is not a release id`);
    const expectedPrev = i === 0 ? null : h[i - 1].releaseId;
    if (e.previousReleaseId !== expectedPrev) problems.push(`${at}: previousReleaseId ${e.previousReleaseId} does not match the release then current (${expectedPrev})`);
    if (e.releaseId === expectedPrev) problems.push(`${at}: points at the release that was already current`);
    const t = Date.parse(e.at);
    if (Number.isNaN(t)) problems.push(`${at}: invalid instant ${JSON.stringify(e.at)}`);
    else if (t < prevAt) problems.push(`${at}: instant goes backwards`);
    else prevAt = t;
    if (!e.actor.trim()) problems.push(`${at}: no actor`);
    if (!e.reason.trim()) problems.push(`${at}: no reason`);
    const known = nameOf.get(e.releaseId);
    if (e.action === "promote") {
      if (known !== undefined) problems.push(`${at}: promotes ${e.releaseId}, which was current before — that is a rollback`);
      else if (!Number.isNaN(t)) {
        let expected: string | null = null;
        try {
          expected = nextReleaseName(names, new Date(t));
        } catch (err) {
          problems.push(`${at}: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (expected !== null && e.releaseName !== expected) problems.push(`${at}: name ${e.releaseName} should be ${expected}`);
      }
      names.push(e.releaseName);
      nameOf.set(e.releaseId, e.releaseName);
    } else if (e.action === "rollback") {
      if (known === undefined) problems.push(`${at}: rolls back to ${e.releaseId}, which was never current`);
      else if (e.releaseName !== known) problems.push(`${at}: rollback renames ${known} to ${e.releaseName}`);
    } else {
      problems.push(`${at}: unknown action ${JSON.stringify(e.action)}`);
    }
  });
  return problems;
}

function assertValid(h: PointerHistory): void {
  const problems = verifyPointerHistory(h);
  if (problems.length > 0) throw new Error(`refused: the pointer history is not valid (${problems.join("; ")})`);
}

function checkMove(h: PointerHistory, move: PointerMove): string {
  if (Number.isNaN(move.at.getTime())) throw new Error("refused: invalid instant");
  if (!move.actor.trim()) throw new Error("refused: a pointer move names who made it");
  if (!move.reason.trim()) throw new Error("refused: a pointer move says why");
  const last = h[h.length - 1];
  if (last && move.at.getTime() < Date.parse(last.at)) throw new Error("refused: a pointer move cannot predate the entry before it");
  return move.at.toISOString();
}

function append(h: PointerHistory, entry: PointerEntry): PointerResult {
  const frozen = Object.freeze({ ...entry });
  return { history: Object.freeze([...h, frozen]), entry: frozen };
}

/**
 * Point at a release that has never been current, minting its name.
 * `catalog` is the set of release ids that exist (immutable release rows).
 */
export function promote(h: PointerHistory, releaseId: string, move: PointerMove, catalog: ReadonlySet<string>): PointerResult {
  assertValid(h);
  const at = checkMove(h, move);
  if (!isReleaseId(releaseId)) throw new Error(`refused: ${JSON.stringify(releaseId)} is not a release id`);
  if (!catalog.has(releaseId)) throw new Error(`refused: ${releaseId} is not a known release — a pointer only ever names a stored release`);
  if (h.some((e) => e.releaseId === releaseId)) {
    throw new Error(`refused: ${releaseId} was current before — return to it with rollback, which keeps its name`);
  }
  const names = h.filter((e) => e.action === "promote").map((e) => e.releaseName);
  const releaseName = nextReleaseName(names, move.at);
  const last = h[h.length - 1];
  return append(h, {
    seq: h.length + 1,
    action: "promote",
    releaseId,
    releaseName,
    previousReleaseId: last ? last.releaseId : null,
    at,
    actor: move.actor,
    reason: move.reason,
  });
}

/**
 * Point back at a release that was current before. Without `toReleaseId`,
 * the target is the release current immediately before the current release
 * was first promoted — so repeated rollbacks walk back one version at a time.
 */
export function rollback(h: PointerHistory, move: PointerMove, toReleaseId?: string): PointerResult {
  assertValid(h);
  const at = checkMove(h, move);
  const cur = h[h.length - 1];
  if (!cur) throw new Error("refused: nothing has been promoted — there is nothing to roll back");
  let target = toReleaseId;
  if (target === undefined) {
    const firstPromotion = h.find((e) => e.action === "promote" && e.releaseId === cur.releaseId);
    target = firstPromotion?.previousReleaseId ?? undefined;
    if (!target) throw new Error(`refused: ${cur.releaseName} is the first release ever promoted — there is no earlier release to roll back to`);
  }
  if (target === cur.releaseId) throw new Error(`refused: ${cur.releaseName} is already current`);
  const earlier = h.find((e) => e.releaseId === target);
  if (!earlier) throw new Error(`refused: ${target} was never current — rollback only returns to a release that was`);
  return append(h, {
    seq: h.length + 1,
    action: "rollback",
    releaseId: target,
    releaseName: earlier.releaseName,
    previousReleaseId: cur.releaseId,
    at,
    actor: move.actor,
    reason: move.reason,
  });
}
