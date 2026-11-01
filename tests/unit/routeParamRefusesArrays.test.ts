/**
 * Express 5 route parameters — `routeParam()` returns a named parameter's
 * string unchanged and REFUSES an array-valued one loudly.
 *
 *   - a string comes back byte-for-byte (no trimming, decoding or coercion);
 *   - an array — what Express 5 delivers for a wildcard segment — throws
 *     `RouteParamArrayError` (statusCode 400) and is logged; it never yields
 *     the first segment, a join, or any other invented string;
 *   - over real HTTP on an Express 5 router, a wildcard read through the
 *     helper is refused, and a named `:param` read through it is served as-is;
 *   - every `req.params` read in server code goes through the helper. The
 *     population is every non-test `.ts` file under server/, with a floor on
 *     the files and reads found, and a canary per forbidden shape so the
 *     scanner cannot silently stop matching one.
 */
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

const log = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: log.error, debug: vi.fn() } }));

import { routeParam } from "../../server/utils/routeParams";

describe("routeParam", () => {
  it("returns a string parameter unchanged", () => {
    for (const v of ["abc", "", " padded ", "0f8fad5b-d9cb-469f-a165-70867728950e", "a/b", "42"]) {
      expect(routeParam(v)).toBe(v);
    }
  });

  it("refuses an array loudly — no first element, no join", () => {
    for (const v of [["only"], ["a", "b"], []]) {
      log.error.mockClear();
      let thrown: unknown;
      try {
        routeParam(v);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown).toMatchObject({ name: "RouteParamArrayError", statusCode: 400, segments: v.length });
      expect(log.error).toHaveBeenCalledTimes(1);
    }
  });

  it("over HTTP: a wildcard read through the helper is refused; a named param is served as-is", async () => {
    const app = express();
    const seen: string[] = [];
    // Typed as a plain RequestHandler: path-literal param inference in
    // @types/express 4 does not know the Express 5 `*name` wildcard.
    const wildcard: express.RequestHandler = (req, res) => {
      seen.push(routeParam(req.params.rest));
      res.json({ ok: true });
    };
    app.get("/files/*rest", wildcard);
    app.get("/items/:id", (req, res) => {
      res.json({ id: routeParam(req.params.id) });
    });

    const refused = await request(app).get("/files/a/b/c");
    expect(refused.status).toBe(400);
    expect(seen).toEqual([]);

    const ok = await request(app).get("/items/a%20b-7");
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ id: "a b-7" });
  });
});

// ── Population gate: no raw req.params read in server code ─────────────────
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });
const ROOT = path.resolve(__dirname, "../..");
const SERVER = path.join(ROOT, "server");
// Measured 2026-10-30 when the codemod landed: 192 files, 1,256 helper reads.
const FILE_FLOOR = 190;
const READ_FLOOR = 1200;

/** Every `req.params` / `request.params` occurrence that is not a helper read. */
function rawParamReads(source: string): string[] {
  const code = stripComments(source);
  const out: string[] = [];
  const re = /\b(?:req|request)\s*\.\s*params\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const before = code.slice(Math.max(0, m.index - 12), m.index);
    const after = code.slice(m.index + m[0].length, m.index + m[0].length + 1);
    if (/(?:^|[^\w$])routeParam\($/.test(before) && (after === "." || after === "?" || after === "[")) continue;
    // The whole object handed to a validator (zod safeParse) is not a string read.
    if (/safeParse\($/.test(before) && after === ")") continue;
    // The one read that handles a non-string explicitly instead of refusing:
    // the borrower-portal rate-limit key falls back to the client IP.
    if (code.slice(m.index, m.index + 34) === "req.params?.accessToken || (req.bo") continue;
    out.push(code.slice(m.index, m.index + 40).split("\n")[0]);
  }
  return out;
}

function serverFiles(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) serverFiles(p, acc);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".d.ts")) acc.push(p);
  }
  return acc;
}

describe("every server req.params read goes through routeParam", () => {
  it("canaries: each forbidden shape is caught, and the allowed shapes are not", () => {
    expect(rawParamReads("const x = req.params.id;")).toHaveLength(1);
    expect(rawParamReads("const x = req.params?.id;")).toHaveLength(1);
    expect(rawParamReads('const x = req.params["id"];')).toHaveLength(1);
    expect(rawParamReads("const { id } = req.params;")).toHaveLength(1);
    expect(rawParamReads("const p = req.params; use(p.id);")).toHaveLength(1);
    expect(rawParamReads("f(request.params.id)")).toHaveLength(1);
    expect(rawParamReads("const x = fooRouteParam(req.params.id);")).toHaveLength(1);
    expect(rawParamReads("const x = myrouteParam(req.params.id);")).toHaveLength(1);
    expect(rawParamReads("const x = routeParam(req.params);")).toHaveLength(1);
    expect(rawParamReads("const x = routeParam(req.params.id);")).toHaveLength(0);
    expect(rawParamReads("const r = schema.safeParse(req.params);")).toHaveLength(0);
    expect(rawParamReads("// the old code read req.params.id here")).toHaveLength(0);
  });

  it("server code has no raw req.params read", () => {
    const offenders: string[] = [];
    let files = 0;
    let reads = 0;
    for (const f of serverFiles(SERVER)) {
      const src = fs.readFileSync(f, "utf8");
      const helperReads = (stripComments(src).match(/routeParam\((?:req|request)\.params/g) ?? []).length;
      if (helperReads > 0) {
        files++;
        reads += helperReads;
      }
      for (const r of rawParamReads(src)) offenders.push(`${path.relative(ROOT, f)}: ${r}`);
    }
    expect(offenders).toEqual([]);
    expect(files).toBeGreaterThanOrEqual(FILE_FLOOR);
    expect(reads).toBeGreaterThanOrEqual(READ_FLOOR);
  });
});
