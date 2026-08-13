/**
 * One authorization gate, one owner.
 *
 * `routes-beta.ts` carried its own founder check:
 *
 *     function isFounder(req, res, next) {
 *       const founderEmails = (process.env.FOUNDER_EMAILS || "").split(",")…
 *       if (!user || !founderEmails.includes(user.email?.toLowerCase()))
 *         return Errors.forbidden(res, "Founder access required");
 *       next();
 *     }
 *
 * It diverged from the canonical `requireFounder` in two ways, both wrong:
 *
 *  1. **403, not 404.** `routes-admin.ts` states the rule five separate times —
 *     *"Hide existence of founder-only surfaces from non-founders (404, not
 *     403)"* — and `clerkAuth.ts` implements it: *"Returns 404 to hide the
 *     existence of founder-only routes from non-founders."* A 403 saying
 *     "Founder access required" confirms both that the endpoint exists and that
 *     it is a founder surface, which is exactly what the convention withholds.
 *     Six endpoints advertised themselves.
 *  2. **One env var out of three.** Founder identity is `FOUNDER_EMAIL`
 *     (singular) or `FOUNDER_EMAILS` or `FOUNDER_USER_IDS` (Clerk id), resolved
 *     by `isFounderIdentity` in `services/founder.ts`. The shim read only the
 *     plural. A founder configured by user id — or by the singular variable —
 *     was refused by their own admin console. Fail-closed, and still broken.
 *
 * This was the ONLY place in `server/` computing founder identity to make an
 * access-control decision outside the canonical helper. The other
 * `FOUNDER_EMAIL` readers are jobs building recipient lists (`accessReview`,
 * `founderWeeklyDigest`, `costOptimizerWeeklyDigest`, `customerConcentration`)
 * — who to email, not who may act. That distinction is why this file asserts on
 * `server/routes-*.ts` and `server/middleware/**` rather than on all of
 * `server/`: widening it would flag four jobs that are doing nothing wrong, and
 * a checker that cries wolf gets deleted.
 *
 * NOT covered here, deliberately: the beta waitlist itself does not persist
 * (module-level arrays, no table) and its two PUBLIC endpoints fabricate a
 * queue position and answer an email-enumeration probe. That is BLOCKERS B15 —
 * the fix touches an unauthenticated surface that may be wired to a marketing
 * page outside this repository, which is the founder's call, not a test's.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Every router + middleware file — the surfaces that make authz decisions. */
function authzFiles(): string[] {
  const out: string[] = [];
  const serverDir = path.join(ROOT, "server");
  for (const entry of fs.readdirSync(serverDir)) {
    if (/^routes.*\.ts$/.test(entry) && !/\.test\.|\.spec\./.test(entry)) {
      out.push(`server/${entry}`);
    }
  }
  const mw = path.join(serverDir, "middleware");
  for (const entry of fs.readdirSync(mw)) {
    if (entry.endsWith(".ts") && !/\.test\.|\.spec\./.test(entry)) out.push(`server/middleware/${entry}`);
  }
  return out.sort();
}

describe("founder identity has exactly one implementation", () => {
  const files = authzFiles();

  it("finds the route surface at all (vacuity guard)", () => {
    expect(files.length, "no route/middleware files enumerated").toBeGreaterThan(50);
    expect(files, "routes-beta.ts is gone — was the beta surface deleted?").toContain(
      "server/routes-beta.ts",
    );
  });

  /**
   * Reads of FOUNDER_EMAIL that resolve a RECIPIENT — who to email — rather
   * than a permission. Listed rather than pattern-matched: the first draft of
   * this check flagged all five remaining reads, and three of them were doing
   * nothing wrong. A checker that cannot tell "who may act" from "who to
   * notify" cries wolf, and a checker that cries wolf gets deleted.
   */
  const RECIPIENT_READS: Record<string, string> = {
    "server/routes-founder-intelligence.ts":
      "Resolves the founder's ADDRESS for a pager fallback — Connections table " +
      "first, env second. A destination, not a permission.",
    "server/routes-marketplace.ts":
      "Fallback To: address when a seller org has no email on file.",
    "server/routes.ts":
      "Recipient of a non-blocking founder notification.",
  };

  it("no router or middleware re-implements founder IDENTITY", () => {
    // The canonical resolver is services/founder.ts (isFounderEmail /
    // isFounderIdentity) and requireFounder is the middleware over it. A local
    // re-implementation is how the 404 convention and two of the three identity
    // sources got dropped without anyone noticing — twice: routes-beta.ts's
    // shim, and getOrCreateOrg.ts's copy, whose own comment claimed it matched
    // services/founder.ts while knowing nothing of FOUNDER_USER_IDS.
    const offenders = files.filter((f) => {
      if (f in RECIPIENT_READS) return false;
      const src = read(f);
      // Code only — a comment explaining this rule must not trip it.
      const code = src
        .split("\n")
        .filter((l) => {
          const t = l.trim();
          return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
        })
        .join("\n");
      return /process\.env\.FOUNDER_EMAIL/.test(code);
    });
    expect(
      offenders.join(", "),
      "a route or middleware reads FOUNDER_EMAIL* in CODE to decide access. " +
        "Use requireFounder (or isFounderEmail / isFounderIdentity) — a second " +
        "copy drifts from the 404-not-403 convention and from FOUNDER_USER_IDS. " +
        "If the read resolves a RECIPIENT rather than a permission, add it to " +
        "RECIPIENT_READS above with the reason.",
    ).toBe("");
  });

  it("the recipient allowlist has not gone stale", () => {
    // An entry naming a file that no longer reads the var is a classification
    // nobody re-checked. Both directions, like every other register here.
    for (const [file, reason] of Object.entries(RECIPIENT_READS)) {
      expect(fs.existsSync(path.join(ROOT, file)), `${file} does not exist`).toBe(true);
      expect(
        /process\.env\.FOUNDER_EMAIL/.test(read(file)),
        `${file} no longer reads FOUNDER_EMAIL — drop its RECIPIENT_READS entry`,
      ).toBe(true);
      expect(reason.length, `${file} has a stub reason`).toBeGreaterThan(30);
    }
  });

  it("getOrCreateOrg uses the canonical helper, not a copy of it", () => {
    // The second copy, and the one that mattered more: this middleware runs
    // ahead of nearly every org-scoped request, and its local isFounderEmail
    // decided enterprise-tier and unlimited-usage treatment while missing
    // FOUNDER_USER_IDS entirely.
    const mw = read("server/middleware/getOrCreateOrg.ts");
    expect(mw).toContain('import { isFounderEmail } from "../services/founder"');
    expect(
      mw,
      "getOrCreateOrg defines its own isFounderEmail again",
    ).not.toMatch(/function isFounderEmail\s*\(/);
  });

  it("the beta admin endpoints use the canonical gate", () => {
    const beta = read("server/routes-beta.ts");
    const admin = beta.split("\n").filter((l) => /router\.(get|post)\("\/admin\//.test(l));
    expect(admin.length, "the beta admin endpoints are gone").toBe(6);
    for (const line of admin) {
      expect(line, `${line.trim()} is not founder-gated`).toContain("requireFounder");
    }
    expect(
      beta,
      "the local isFounder shim is back",
    ).not.toMatch(/function isFounder\s*\(/);
  });
});

describe("the 404-not-403 convention is what requireFounder implements", () => {
  it("requireFounder answers 404", () => {
    // The property the local shim broke. Asserted against the canonical
    // implementation so the convention has a home, not just five comments.
    const auth = read("server/auth/clerkAuth.ts");
    const at = auth.indexOf("export const requireFounder");
    expect(at, "requireFounder is gone").toBeGreaterThan(-1);
    const body = auth.slice(at, auth.indexOf("\n};", at));
    expect(body).toContain("status(404)");
    expect(
      body,
      "requireFounder answers 403, which tells a non-founder that the endpoint " +
        "exists and is a founder surface",
    ).not.toContain("status(403)");
  });

  it("it resolves identity through the canonical helper, not an env read", () => {
    const auth = read("server/auth/clerkAuth.ts");
    const at = auth.indexOf("export const requireFounder");
    const body = auth.slice(at, auth.indexOf("\n};", at));
    expect(body).toContain("isFounderIdentity(");
    expect(
      body,
      "requireFounder parses env itself now — the single owner moved, and " +
        "every caller inherits whatever it forgets",
    ).not.toContain("process.env.FOUNDER_EMAIL");
  });

  it("the canonical helper covers all three identity sources", () => {
    // FOUNDER_EMAIL (singular) was the one the beta shim missed, and
    // FOUNDER_USER_IDS is the one a Clerk-only founder depends on.
    const founder = read("server/services/founder.ts");
    for (const v of ["FOUNDER_EMAIL", "FOUNDER_EMAILS", "FOUNDER_USER_IDS"]) {
      expect(founder, `${v} is no longer honoured`).toContain(v);
    }
  });
});
