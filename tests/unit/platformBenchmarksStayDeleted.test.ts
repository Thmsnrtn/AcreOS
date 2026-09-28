/**
 * DEFECT-0156 — no cross-org deal average without a contributor floor.
 *
 * GET /api/platform/benchmarks averaged every organization's closed deals,
 * the caller's own included, gated only on "at least 25 organizations exist"
 * (every signup is one). With a single other operator closing deals, a caller
 * could subtract its own and recover that operator's profit per deal. No
 * client called it; it is deleted, and its return is pinned.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

describe("DEFECT-0156", () => {
  it("the unfloored platform benchmark route stays deleted", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/routes-platform-features.ts"), "utf8"));
    expect(src).not.toMatch(/\/api\/platform\/benchmarks/);
    expect(src).toMatch(/app\.(get|post)\(/); // the file is still read
  });
});
