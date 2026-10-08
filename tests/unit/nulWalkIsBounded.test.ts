/**
 * The NUL refusal (server/middleware/bodyParsing.ts) runs synchronously on
 * every parsed body before any route or auth, so its cost must stay linear in
 * the body and bounded:
 *
 *   - paths are built only for a value that actually holds a NUL (each walk
 *     frame points at its parent), not copied per node — a per-node copy is
 *     nodes × depth;
 *   - nesting past a fixed depth, or more than a fixed number of values, is
 *     refused with 422 `body_too_complex` instead of walked.
 *
 * Driven through `installBodyParsers`, the function server/index.ts installs.
 */
import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { installBodyParsers } from "../../server/middleware/bodyParsing";

function app() {
  const a = express();
  installBodyParsers(a);
  a.post("/echo", (_req, res) => res.json({ ok: true }));
  return a;
}

/** `{"a":{"a":…{"leaf":[1,1,…]}}}` — `depth` objects deep, `leaves` numbers at the bottom. */
function deepWide(depth: number, leaves: number, bottom = "1"): string {
  const items = new Array(leaves).fill("1");
  if (bottom !== "1") items[leaves - 1] = bottom;
  return '{"a":'.repeat(depth) + `{"leaf":[${items.join(",")}]}` + "}".repeat(depth);
}

describe("the NUL walk is bounded and linear", () => {
  it("a ~500 KB body with 240k values at depth 120 is walked well inside the budget", async () => {
    const body = deepWide(120, 240_000);
    expect(body.length).toBeGreaterThan(450_000);
    const t0 = performance.now();
    const res = await request(app()).post("/echo").set("Content-Type", "application/json").send(body);
    const ms = performance.now() - t0;
    expect(res.status).toBe(200);
    // Includes supertest + JSON.parse; the walk itself is a fraction of this.
    expect(ms, `took ${Math.round(ms)} ms`).toBeLessThan(500);
  });

  it("a NUL at the bottom of that body is still reported, with its full path", async () => {
    const body = deepWide(120, 240_000, JSON.stringify("x\u0000y"));
    const res = await request(app()).post("/echo").set("Content-Type", "application/json").send(body);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("VALIDATION_FAILED");
    const path = res.body.details[0].path as Array<string | number>;
    expect(path.length).toBe(122);
    expect(path.slice(0, 3)).toEqual(["a", "a", "a"]);
    expect(path.slice(-2)).toEqual(["leaf", 239_999]);
  });

  it("a 1 MB body nested 500k levels deep is refused quickly with body_too_complex", async () => {
    const n = 500_000;
    const body = "[".repeat(n) + "]".repeat(n);
    const t0 = performance.now();
    const res = await request(app()).post("/echo").set("Content-Type", "application/json").send(body);
    const ms = performance.now() - t0;
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "UNPROCESSABLE", statusCode: 422, details: { reason: "body_too_complex" } });
    expect(ms, `took ${Math.round(ms)} ms`).toBeLessThan(1_000);
  });

  it("too many values is refused too", async () => {
    const body = `[${new Array(300_000).fill("1").join(",")}]`;
    const res = await request(app()).post("/echo").set("Content-Type", "application/json").send(body);
    expect(res.status).toBe(422);
    expect(res.body.details).toMatchObject({ reason: "body_too_complex" });
  });

  it("an ordinary body passes untouched", async () => {
    const res = await request(app()).post("/echo").send({ firstName: "Ann", tags: ["a", "b"], nested: { x: 1 } });
    expect(res.status).toBe(200);
  });
});
