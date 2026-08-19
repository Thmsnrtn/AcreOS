/**
 * Types for the shared comment stripper (`strip-comments.mjs`).
 *
 * The implementation is `.mjs` on purpose — it is consumed by the lint scripts,
 * which run under plain node with no build step. This declaration exists so a
 * TypeScript test can import the SAME module the gates run, rather than
 * restating its behaviour in a copy that would drift from it. Keep it in step
 * with the exports in the `.mjs`.
 */

/** Blanks comment bodies, preserving newlines so line numbers do not move. */
export function stripCommentsPreservingLines(src: string): string;

/** [input, expected] pairs the stripper must satisfy; compared line-trimmed. */
export const STRIPPER_CASES: ReadonlyArray<readonly [string, string]>;

/** Runs STRIPPER_CASES. Returns `[passed, total]`. */
export function verifyStripper(): [number, number];
