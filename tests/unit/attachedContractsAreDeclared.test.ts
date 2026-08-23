/**
 * A property the code attaches and depends on belongs in the type.
 *
 * ── WHY THESE TWO ARE TOGETHER ──────────────────────────────────────────────
 * Both were among the largest `(x as any).prop` clusters in the ghost-field
 * backlog, and NEITHER was a ghost. They are the opposite failure: a real
 * contract carried outside the type system, which made them indistinguishable
 * from the reads that hid `auditOrgUsury`'s Texas fallback.
 *
 *   jobQueue.Job._dbId          attached at four sites, read at two, always
 *                               through `(job as any)._dbId`. It carries the
 *                               background_jobs row id for an in-memory job.
 *                               Entirely real, entirely undeclared.
 *
 *   customDomainRouter storage.redis
 *                               probed six times as `(storage as any).redis`.
 *                               `redis` is NOT a member of DatabaseStorage and
 *                               is assigned nowhere in the repository, so the
 *                               probe always failed: the tier has never cached
 *                               anything.
 *
 * ── THE REDIS ONE IS NOT A BUG, AND THAT IS THE POINT ───────────────────────
 * The header calls it "optional, best-effort". There is a working in-memory
 * localCache in front of it and a database lookup behind it, and every path
 * degrades correctly. Nothing is broken. What was wrong is that "optional" was
 * indistinguishable from "impossible" — the capability was probed through a cast
 * on an undeclared property, so no reader and no gate could tell a designed
 * degradation from a defect.
 *
 * Declaring the seam states the truth: the tier accepts a client, and nothing
 * currently provides one. Whether to attach one is an infrastructure decision,
 * which is why this declares the socket rather than wiring something into it.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const JOBQUEUE = "server/services/jobQueue.ts";
const ROUTER = "server/middleware/customDomainRouter.ts";

describe("Job._dbId is part of the Job type", () => {
  it("VACUITY: the Job interface is found and non-trivial", () => {
    const src = read(JOBQUEUE);
    const i = src.indexOf("export interface Job {");
    expect(i, "the Job interface moved — re-anchor this file").toBeGreaterThan(-1);
    const body = src.slice(i, src.indexOf("\n}", i));
    expect(body.split("\n").length).toBeGreaterThan(5);
  });

  it("declares _dbId", () => {
    const src = read(JOBQUEUE);
    const body = src.slice(src.indexOf("export interface Job {"));
    expect(body.slice(0, body.indexOf("\n}"))).toMatch(/_dbId\?:\s*number/);
  });

  it("no longer casts the job to reach it", () => {
    expect(
      code(JOBQUEUE),
      "an attached property the code depends on is being read through a cast again — " +
        "that is what made it indistinguishable from a ghost",
    ).not.toMatch(/job as any\)\._dbId/);
  });
});

describe("the optional domain cache declares its client", () => {
  it("VACUITY: the Redis tier still exists and is still optional", () => {
    // The fix must not have quietly deleted a designed degradation tier.
    const c = code(ROUTER);
    expect(c).toMatch(/async function redisGet/);
    expect(c).toMatch(/async function redisSet/);
    expect(c).toMatch(/localCache/); // the tier in front of it survives too
  });

  it("probes a declared seam rather than an undeclared property", () => {
    const c = code(ROUTER);
    expect(c).toMatch(/interface DomainCacheRedis/);
    expect(c).toMatch(/function domainCacheRedis\(/);
    expect(
      c,
      "storage is being cast to probe .redis again — an undeclared capability check " +
        "cannot be told apart from a read of a field that does not exist",
    ).not.toMatch(/storage as any\)\.redis/);
  });

  it("requires ALL THREE operations before using the client", () => {
    // get, setex AND del. A client with `get` but no `setex` serves reads from a
    // cache nothing writes; one without `del` cannot be invalidated, and a
    // domain-routing table that cannot be invalidated is worse than no cache —
    // a revoked custom domain would keep resolving.
    //
    // The original probed each operation independently at its own call site,
    // which is exactly how the `del` site was missed when this seam was first
    // extracted: two of the three were converted and the third kept its cast.
    // This asserts the operations, not one spelling of the condition.
    const c = code(ROUTER);
    const guard = /function domainCacheRedis\([\s\S]*?\n\}/.exec(c)?.[0] ?? "";
    expect(guard, "the seam resolver was not found").not.toBe("");
    for (const op of ["get", "setex", "del"]) {
      expect(guard, `the resolver does not require ${op}`).toContain(`candidate?.${op}`);
    }
  });

  it("still degrades rather than throwing when no client is attached", () => {
    const c = code(ROUTER);
    expect(c).toMatch(/if \(!redis\) return undefined;/);
    expect(c).toMatch(/if \(!redis\) return;/);
  });
});
