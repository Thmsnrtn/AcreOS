/**
 * An expression that falls back to itself, and the sweep that nearly ate 70 files.
 *
 * Unit 94 removed an `as any` from `complianceGate`'s audit write and found the
 * line underneath it read `userId: user?.id || user?.id` — the same expression on
 * both sides of the operator. That write is the EVIDENCE half of strict mode, so
 * the question "what was the second operand, and when did it go?" was worth
 * asking.
 *
 * THE ANSWER, and it is the opposite of the suspicion. Nothing was lost. Every
 * one of these was born as `user?.id || user?.claims?.sub` under Replit OIDC,
 * where the id genuinely arrived two ways. The Clerk migration removed the second
 * source — correctly; `authSurfaceIsClerk.test.ts` pins Clerk as the only auth
 * surface — and left the operator standing with nothing on its right. The residue
 * is inert: `v || v === v` for every v, truthy or falsy.
 *
 * So the honest outcome is a MEASUREMENT, not a rewrite. Per Section I, an audit
 * recommendation whose premise is no longer true does not get implemented; the
 * premise here was mine, and it did not survive contact with the git history.
 *
 * WHAT DID GET FIXED — one site, and only one. `getUserPermissionContext` read
 * `user?.id || user.id` on the line directly above `if (!userId) return null`.
 * The optional chain and the null-return both say *this function tolerates an
 * absent user*; the fallback dereferences that same user unguarded, so when it IS
 * absent the left side is falsy and the right side throws a TypeError before
 * either guard can act. **The only thing the fallback could ever contribute was
 * the crash the `?.` was written to prevent.** Latent rather than live — both
 * callers guard — and recorded as latent rather than dressed up.
 *
 * AND ONE COMMENT. `getUserId` in `server/types/request.ts`, the single source of
 * truth for identity extraction, promised it handled "both direct id and claims
 * patterns". The claims half went with Replit. Stale prose asserting a capability
 * on the identity chokepoint is the same defect class this program has been
 * chasing all session — a definite claim standing in for something unknown or
 * gone — and it is one line to retire.
 *
 * THE NEAR-MISS, which is the part worth keeping. The first attempt at this unit
 * was a codemod rewriting all ~140 sites. It reported 194 occurrences across 70
 * files, a plausible-looking number with a plausible-looking file distribution.
 * Reading the diff before believing it showed:
 *
 *     - if (!data.results || data.results.length === 0) {
 *     + if (!data.results.length === 0) {
 *
 * — a semantic inversion AND a null-dereference, thirty-odd times over, in files
 * spanning mail compose, lead import, dunning and the approval kernel. The cause
 * was not a subtle regex bug. It was that **the sweep that measured the
 * population and the sweep that rewrote it were different regexes.** The measuring
 * one required a terminator after the right operand, which is exactly what
 * excludes `X.p || X.p.length`; the rewriting one, written later from memory,
 * did not. 141 measured, 194 rewritten, and the gap was entirely composed of
 * boolean guards that the measurement had never counted.
 *
 * *Measure and mutate with the same predicate, or you have not measured what you
 * changed.* This file is where that lesson is kept, which is why the assertions
 * below run the RATCHET'S OWN pattern — read out of the JSON, not retyped — over
 * both the shape it must catch and the shape that broke the codemod.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/** Comments stripped: a note describing this defect must not trip the check. */
function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    let s = line;
    if (inBlock) {
      const end = s.indexOf("*/");
      if (end === -1) { out.push(""); continue; }
      s = s.slice(end + 2);
      inBlock = false;
    }
    const open = s.indexOf("/*");
    if (open > -1) {
      const close = s.indexOf("*/", open + 2);
      if (close > -1) s = s.slice(0, open) + s.slice(close + 2);
      else if (/^\s*\{?\s*\/\*/.test(s)) { s = s.slice(0, open); inBlock = true; }
    }
    out.push(s.replace(/(^|[^:])\/\/.*$/, "$1"));
  }
  if (inBlock) throw new Error("stripComments ran away — assertions would be meaningless.");
  return out.join("\n");
}

const config = JSON.parse(
  fs.readFileSync(path.join(ROOT, "scripts/ratchets/self-fallback.json"), "utf8"),
) as { pattern: string; baselineCount: number; direction: string; globs: string[] };

/** The gate's own regex, never a retyped copy — that gap is what this unit is about. */
const rx = () => new RegExp(config.pattern, "g");

describe("the self-fallback ratchet catches the shape it names", () => {
  it("matches a fallback to the same expression", () => {
    // Every form the Replit→Clerk collapse actually left behind.
    for (const sample of [
      "userId: user?.id || user?.id,",
      "const id = user?.id ?? user?.id;",
      "const uid = req.user?.id || req.user?.id || null;",
      "email: req.user?.email || req.user?.email,",
      "const o = req.organization || req.organization;",
    ]) {
      expect(sample, `the ratchet stopped matching: ${sample}`).toMatch(rx());
    }
  });

  it("matches the guarded-then-UNGUARDED form too", () => {
    // `X?.p || X.p` is the strictly-worse member: redundant wherever the guard
    // holds, and a TypeError wherever it does not. The gate must count it, or
    // the one shape with a failure mode would be the one it lets grow.
    for (const sample of ["const userId = user?.id || user.id;", "user.email || user?.email"]) {
      expect(sample).toMatch(rx());
    }
  });
});

describe("the ratchet does NOT match the shape that broke the codemod", () => {
  it("leaves `!X.p || X.p.<something>` alone", () => {
    // THE REGRESSION TEST FOR THE NEAR-MISS. Each of these is a correct
    // null-guard-then-inspect. A pattern that matches them would, applied as a
    // rewrite, delete the guard and leave the dereference — which is precisely
    // what the first attempt did, 30-odd times, before the diff was read.
    for (const sample of [
      "if (!data.results || data.results.length === 0) {",
      "if (!lead.address || lead.address.trim() === \"\") {",
      "if (!org || !org.dunningStage || org.dunningStage === \"none\") return;",
      "if (!action.expiresAt || action.expiresAt.getTime() <= now) {",
      "if (!opts.caseIds || opts.caseIds.includes(c.id))",
      "if (!entry.queryTokens || entry.queryTokens.size === 0) continue;",
    ]) {
      expect(sample, `the ratchet would now count a null-guard: ${sample}`).not.toMatch(rx());
    }
  });

  it("leaves a fallback whose right operand EXTENDS the left alone", () => {
    // The second over-matching trap, and the one that actually bites: a real
    // fallback where the second property NAME BEGINS WITH THE FIRST. Without the
    // trailing lookahead, `err.status || err.statusCode` matches on the `err.status`
    // prefix of `err.statusCode` and reads as a self-reference — and a rewrite
    // would collapse a genuine two-source read to one source.
    //
    // These are real lines from the repo, not invented ones. Eleven sites depend
    // on this exclusion, so an over-broad pattern would not merely miscount: it
    // would nominate correct code for deletion.
    for (const sample of [
      "const status = err.status || err.statusCode || 500;",
      "const email = fields.email || fields.email_address || \"\";",
      "const dateStr = props.saledt || props.saledt2;",
      "const drainage = data.drainage ?? data.drainageClass ?? null;",
      "const phone = lead.phone || lead.phoneNormalized;",
      "const hasOwnerData = parcelData?.owner || parcelData?.ownerAddress;",
      "results: data.results || data.resultsPreview || [],",
      // Zero occurrences in the repo today — the pattern's `|\?\.` alternative
      // guards an empty input space, and unit 74 catalogued that as a kind of
      // no-op change worth naming rather than hiding. Kept because the shape is
      // a genuine two-source read (`a.b` and `a.b?.c` are different values), and
      // tested so the guard is a decision rather than a speculation.
      "const v = obj.data || obj.data?.items;",
    ]) {
      expect(sample, `the ratchet over-matched a real two-source read: ${sample}`)
        .not.toMatch(rx());
    }
  });

  it("leaves genuinely different operands alone", () => {
    // The plain case: different objects, different properties, or a real chain.
    for (const sample of [
      "apn: props.parcel_number || props.apn || apn,",
      "const parcelLat = props.lat || lat;",
      "variant: context.variant || variant,",
      "userId: user?.id || \"anonymous\",",
      "decisionsTotal: metrics?.decisionsTotal + totalDecisions || totalDecisions,",
    ]) {
      expect(sample, `the ratchet over-matched: ${sample}`).not.toMatch(rx());
    }
  });
});

describe("the ratchet is wired and may only shrink", () => {
  it("lives where the factory reads every config", () => {
    // scripts/ratchet.mjs walks scripts/ratchets/*.json, so presence IS wiring —
    // but presence is worth asserting, since a config moved out of that directory
    // becomes a file nothing runs.
    const dir = fs.readdirSync(path.join(ROOT, "scripts/ratchets"));
    expect(dir).toContain("self-fallback.json");
  });

  it("is counted by the factory, not delegated away", () => {
    // The quiet evasion path. A config carrying `"mode": "external"` makes
    // ratchet.mjs print DELEGATED and skip it — the gate keeps appearing in the
    // output, and stops gating. This one has no external evaluator to delegate
    // to, so the mode must be absent.
    expect(
      (config as { mode?: string }).mode,
      "self-fallback declared an external mode — the factory would print " +
        "DELEGATED and count nothing, leaving a gate that only looks like one",
    ).toBeUndefined();
  });

  it("counts down, never up", () => {
    expect(config.direction).toBe("down");
    expect(config.baselineCount).toBeGreaterThan(0);
  });

  it("covers client and shared, not only server", () => {
    // Every measured occurrence is in `server/` today — client and shared are at
    // zero. The globs there are prophylactic ON PURPOSE: the population came from
    // a repo-wide codemod, and a server-only gate would leave the next one free
    // to land everywhere the first one did not. Pinned as an exact SET, because
    // dropping `client/src/**/*.ts` while leaving `client/src/**/*.tsx` still
    // reads as "client is covered" to any looser assertion.
    expect([...config.globs].sort()).toEqual([
      "client/src/**/*.ts",
      "client/src/**/*.tsx",
      "server/**/*.ts",
      "server/**/*.tsx",
      "shared/**/*.ts",
    ]);
  });
});

describe("the one site with a failure mode is fixed", () => {
  const permissions = stripComments(
    fs.readFileSync(path.join(ROOT, "server/utils/permissions.ts"), "utf8"),
  );

  it("getUserPermissionContext no longer defeats its own guard", () => {
    expect(
      permissions,
      "`user?.id || user.id` is back above `if (!userId) return null`. When `user` " +
        "is nullish the left side is falsy, so the unguarded right side runs and " +
        "throws — the fallback's only possible contribution is the crash the " +
        "optional chain exists to prevent.",
    ).not.toMatch(/user\?\.id\s*\|\|\s*user\.id/);
  });

  it("and still returns null rather than throwing on an absent user", () => {
    // Vacuity guard. Removing the fallback is only a fix if the tolerance it
    // defeated is still there to be tolerated.
    expect(permissions).toContain("const userId = user?.id;");
    const at = permissions.indexOf("const userId = user?.id;");
    expect(permissions.slice(at, at + 120)).toContain("if (!userId) return null;");
  });
});

describe("the identity chokepoint no longer advertises a subsystem that is gone", () => {
  const requestTs = fs.readFileSync(path.join(ROOT, "server/types/request.ts"), "utf8");

  it("getUserId does not promise a claims pattern", () => {
    // Read from the RAW source on purpose: the claim being retired IS a comment,
    // so stripping comments would make this pass vacuously.
    expect(
      requestTs,
      "`getUserId` claims to handle a claims pattern again. There is one source, " +
        "`req.user.id`; `user.claims.sub` went with Replit OIDC. A reader coding " +
        "against that sentence writes handling for a shape no request carries.",
    ).not.toMatch(/handling both direct id and claims patterns/);
  });

  it("and the body really does read one source", () => {
    const body = stripComments(requestTs);
    const at = body.indexOf("export function getUserId");
    expect(at).toBeGreaterThan(-1);
    const fn = body.slice(at, body.indexOf("\n}", at));
    expect(fn).toContain("user?.id");
    expect(fn, "a second identity source reappeared without the comment saying so")
      .not.toMatch(/claims/);
  });
});
