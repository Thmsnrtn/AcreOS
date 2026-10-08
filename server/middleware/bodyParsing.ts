/**
 * The app's request-body parsers, installed in ONE place.
 *
 * server/index.ts calls `installBodyParsers(app)`; the tests that pin the NUL
 * refusal call the same function, so what they prove is what production runs.
 *
 * ── WHY A NUL REFUSAL LIVES HERE ─────────────────────────────────────────────
 * PostgreSQL text and jsonb cannot hold U+0000. A JSON body is free to carry
 * one ("\u0000" is valid JSON), so a NUL in any string field reached the
 * database and came back as `invalid byte sequence for encoding "UTF8": 0x00`
 * (22021) or `unsupported Unicode escape sequence` (22P05) — a 500 the caller
 * could do nothing about, on every route that writes text. Refusing per route
 * would mean a few thousand handlers each remembering; refusing once, after
 * the parsers and before any route, means none of them has to.
 *
 * The refusal is a 422 in the shared validation shape (`Errors.validationFailed`,
 * zod-style issues with a `path`), so a client renders it the same way it
 * renders every other field error. Object KEYS are checked as well as values:
 * a NUL in a key fails a jsonb write exactly as one in a value does.
 *
 * Bodies parsed later by a route's own parser (multer multipart fields, a
 * route-local express.raw) are outside this population — they are not parsed
 * yet when this runs.
 */
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { Errors } from "../utils/errors";

/** The body size limit for JSON and urlencoded bodies (Task #204). */
const BODY_LIMIT = "1mb";

/** At most this many offending paths are reported; the walk stops there. */
const MAX_REPORTED = 20;

interface NulIssue {
  code: "custom";
  path: Array<string | number>;
  message: string;
}

const NUL = "\u0000";
const MESSAGE = "Text cannot contain the NUL character (\\u0000). Remove it and try again.";

/**
 * Bounds on the walk. The body is already capped at BODY_LIMIT bytes; these
 * cap the WORK done on it, because this runs synchronously for every request
 * before any route or auth. Ordinary API bodies are far inside both.
 */
const NUL_WALK_MAX_DEPTH = 128;
const NUL_WALK_MAX_NODES = 250_000;

/** One step of the walk. Paths are NOT copied per node: each frame points at
 *  its parent, and a path is built only when a NUL is actually found — so
 *  the cost is linear in the number of nodes, not nodes × depth. */
interface Frame {
  v: unknown;
  parent: Frame | null;
  key: string | number | null;
  depth: number;
}

function pathOf(frame: Frame, lastKey?: string): Array<string | number> {
  const out: Array<string | number> = [];
  if (lastKey !== undefined) out.push(lastKey);
  for (let f: Frame | null = frame; f && f.key !== null; f = f.parent) out.push(f.key);
  return out.reverse();
}

type WalkResult = { kind: "ok"; issues: NulIssue[] } | { kind: "too_complex"; limit: "depth" | "nodes" };

/**
 * Every path in `value` whose string value — or object key — contains U+0000.
 * Iterative (no stack overflow) and bounded in depth and node count.
 */
function findNulIssues(value: unknown): WalkResult {
  const issues: NulIssue[] = [];
  const stack: Frame[] = [{ v: value, parent: null, key: null, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0 && issues.length < MAX_REPORTED) {
    const frame = stack.pop()!;
    const v = frame.v;
    if (++nodes > NUL_WALK_MAX_NODES) return { kind: "too_complex", limit: "nodes" };
    if (typeof v === "string") {
      if (v.includes(NUL)) issues.push({ code: "custom", path: pathOf(frame), message: MESSAGE });
      continue;
    }
    if (v === null || typeof v !== "object" || Buffer.isBuffer(v)) continue;
    if (frame.depth >= NUL_WALK_MAX_DEPTH) return { kind: "too_complex", limit: "depth" };
    const depth = frame.depth + 1;
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push({ v: v[i], parent: frame, key: i, depth });
      continue;
    }
    for (const key of Object.keys(v)) {
      if (key.includes(NUL)) {
        issues.push({ code: "custom", path: pathOf(frame, key), message: MESSAGE });
        if (issues.length >= MAX_REPORTED) break;
        continue;
      }
      stack.push({ v: (v as Record<string, unknown>)[key], parent: frame, key, depth });
    }
  }
  return { kind: "ok", issues };
}

/** Refuses (422) a parsed body that carries a NUL in a string or key, or that
 *  is past the walk's depth/node bounds. */
function rejectNulInBody(req: Request, res: Response, next: NextFunction): void {
  const result = findNulIssues(req.body);
  if (result.kind === "too_complex") {
    return Errors.unprocessable(
      res,
      result.limit === "depth"
        ? `The request body is nested more than ${NUL_WALK_MAX_DEPTH} levels deep.`
        : `The request body has more than ${NUL_WALK_MAX_NODES} values.`,
      { reason: "body_too_complex", maxDepth: NUL_WALK_MAX_DEPTH, maxNodes: NUL_WALK_MAX_NODES },
    );
  }
  if (result.issues.length === 0) return next();
  Errors.validationFailed(res, result.issues);
}

/**
 * JSON + urlencoded parsing for every route registered after this call, then
 * the NUL refusal. The raw body is kept for signature verification
 * (inboundEmailSignature, csrf).
 */
export function installBodyParsers(app: Express): void {
  app.use(
    express.json({
      limit: BODY_LIMIT,
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: unknown }).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: BODY_LIMIT }));
  app.use(rejectNulInBody);
}
