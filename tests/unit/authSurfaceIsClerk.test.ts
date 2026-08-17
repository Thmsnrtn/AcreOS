/**
 * The app shipped, documented and hardened a password-auth flow it does not have.
 *
 * Authentication is **Clerk**: `pages/auth-page.tsx` renders `<SignIn>` /
 * `<SignUp>` from `@clerk/react`, and `users.clerkUserId` links the record.
 * Sign-in, password reset and email verification all happen on Clerk's
 * infrastructure — **AcreOS never receives a credential.**
 *
 * Four separate surfaces said otherwise, in four different registers:
 *
 *  1. **Two client pages, bundled and unreachable.** `forgot-password.tsx` and
 *     `reset-password.tsx` were lazy-imported in App.tsx and **never routed** —
 *     the only two of 211 lazy page imports in that state. They posted to
 *     `/api/auth/forgot-password` and `/api/auth/reset-password`, neither of
 *     which has a handler. `reset-password.tsx` even rendered a *"Request new
 *     link"* button pointing at `/forgot-password`, a route that does not exist
 *     either — the dead link inside the dead page.
 *  2. **Four dead-mounted rate limiters.** `/api/login`,
 *     `/api/auth/password-reset`, `/api/auth/forgot-password`,
 *     `/api/auth/resend-verification` and `/api/auth/verify-email` have no
 *     handler; each mount rate-limited a 404 while reading, to anyone auditing
 *     `server/index.ts`, as though the credential paths were hardened.
 *
 *     **THAT EXACT FIX WAS ALREADY MADE IN THAT FILE ONCE.** Twenty lines below,
 *     for `/api/register` on 2026-06-02: *"those middleware were dead-mounted
 *     (correct logic, never invoked)"*, with the real protection moved into
 *     `getOrCreateOrg.provisionUser`. The note stayed; the reasoning was never
 *     applied to the neighbouring mounts. A rule applied to some surfaces and
 *     not others, with the rule written directly underneath.
 *  3. **A public API contract for a nonexistent endpoint.** The OpenAPI spec —
 *     served at `/api/docs` — documented `POST /auth/login` taking
 *     `{ email, password }`, and `/auth/me`, whose handler is actually
 *     `GET /api/auth/user`.
 *  4. **A security report naming the wrong mechanism.**
 *     `permanentSovereignty.ts` reported *"Authentication: Passport.js with
 *     bcrypt, 2FA available"*. That is the sentence someone quotes in a security
 *     questionnaire.
 *
 * NOTHING WAS BROKEN FOR A USER, and that is why it survived: Clerk's own reset
 * flow works, so no support ticket ever pointed here. What was wrong is that
 * four surfaces described a system that does not exist — and one of them
 * described it to the outside world.
 *
 * WHAT WAS KEPT. The limiters themselves remain in
 * `middleware/authPathLimits.ts` with their tests. They are correct, they are
 * the right shape for these lanes, and they are what a future first-party
 * credential path would mount. Deleting a working limiter because nothing
 * currently needs it is the opposite mistake.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/**
 * Strip comments before scanning source.
 *
 * The eighth time in this program that prose has tripped a check meant for
 * code: this file's own fix left a comment reading
 * `app.use("/api/login", authAttemptLimiter)` — quoting the line it removed —
 * and the mount check matched it. Removing comments first is now the default
 * for every source scan here, not an afterthought.
 */
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

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const app = read("client/src/App.tsx");
const index = stripComments(read("server/index.ts"));
/** Raw, for the assertions that read the PRECEDENT recorded in comments. */
const indexRaw = read("server/index.ts");

describe("no page is bundled without a way to reach it", () => {
  /**
   * ABSOLUTE, with no register — there were exactly two offenders out of 211
   * lazy page imports, and two is a bug that was fixed rather than a debt.
   *
   * A lazily-imported page with no `<Route>` costs a chunk in the build and
   * cannot be opened by anyone. More usefully, it is the shape a deleted
   * FEATURE leaves behind when only its route is removed.
   */
  it("every lazy-imported page component is referenced by a route", () => {
    const lazy = [
      ...app.matchAll(/const (\w+)\s*=\s*(?:React\.)?lazy\(\(\)\s*=>\s*import\("([^"]+)"\)\)/g),
    ].map((m) => ({ name: m[1], from: m[2] }));

    expect(lazy.length, "no lazy page imports parsed — did App.tsx change shape?")
      .toBeGreaterThan(150);

    // Any mention of the identifier outside its own declaration counts as use:
    // `component={X}`, `<X />`, and the `{() => <X …>}` render-prop form.
    const unrouted = lazy.filter(({ name }) => {
      const uses = [...app.matchAll(new RegExp(`\\b${name}\\b`, "g"))].length;
      return uses <= 1;
    });

    expect(
      unrouted.map((u) => `${u.name} (${u.from})`).join("\n"),
      "a page is lazy-imported but never routed — it ships in the build and " +
        "nobody can open it. Either give it a route or delete it; this is the " +
        "shape a deleted feature leaves behind when only its route is removed.",
    ).toBe("");
  });

  it("the two deleted password pages stay deleted", () => {
    for (const gone of [
      "client/src/pages/forgot-password.tsx",
      "client/src/pages/reset-password.tsx",
    ]) {
      expect(
        fs.existsSync(path.join(ROOT, gone)),
        `${gone} is back. Auth is Clerk and Clerk owns password reset; these ` +
          `pages posted to /api/auth/forgot-password and /api/auth/reset-password, ` +
          `neither of which has a handler.`,
      ).toBe(false);
    }
  });
});

describe("nothing guards a credential path that does not exist", () => {
  it("the dead-mounted limiters are gone", () => {
    // The five paths have no handler. A limiter on each rate-limited a 404
    // while reading as hardening.
    for (const dead of [
      '"/api/login"',
      '"/api/auth/password-reset"',
      '"/api/auth/forgot-password"',
      '"/api/auth/resend-verification"',
      '"/api/auth/verify-email"',
    ]) {
      const mount = new RegExp(`app\\.use\\(\\s*${dead.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}`);
      expect(
        mount.test(index),
        `${dead} is mounted again. It has no handler — auth is Clerk — so the ` +
          `middleware rate-limits a 404 while reading as though the credential ` +
          `path were hardened. See the /api/register note in the same file.`,
      ).toBe(false);
    }
  });

  it("the limiters themselves are kept, with their tests", () => {
    // The other direction, stated so a later sweep does not "finish the job" by
    // deleting correct, tested middleware that a first-party credential path
    // would need.
    const limits = read("server/middleware/authPathLimits.ts");
    for (const name of ["loginLimiter", "passwordResetLimiter", "emailVerifyLimiter"]) {
      expect(limits, `${name} was deleted along with its dead mount`).toContain(name);
    }
    expect(
      fs.existsSync(path.join(ROOT, "server/middleware/authPathLimits.test.ts")),
      "the limiter tests went with the mounts",
    ).toBe(true);
  });

  it("the /api/register precedent that this follows is still recorded", () => {
    // The reasoning's anchor. If that note is ever removed, the deletions above
    // lose the precedent they were argued from and should be re-argued.
    expect(indexRaw).toContain("/api/register has NO handler");
    expect(indexRaw).toContain("provisionUser");
  });
});

describe("the documented and reported auth surface matches the real one", () => {
  const spec = read("server/openapi-spec.ts");

  it("the public spec does not document a login endpoint", () => {
    // Served at /api/docs. A documented `{ email, password }` POST is a public
    // contract for something that has no handler and never could.
    expect(
      spec.includes("'/auth/login':"),
      "the OpenAPI spec documents /auth/login again. Auth is Clerk; AcreOS " +
        "never receives a credential, and there is no handler.",
    ).toBe(false);
  });

  it("the documented current-user path is the one that exists", () => {
    expect(spec, "/auth/me is documented again — the handler is /api/auth/user")
      .not.toContain("'/auth/me':");
    expect(spec).toContain("'/auth/user':");
    const routes = read("server/auth/routes.ts");
    expect(routes, "GET /api/auth/user is gone — re-point the spec").toContain(
      '"/api/auth/user"',
    );
  });

  it("the security report names Clerk, not a stack this app does not run", () => {
    // "Passport.js with bcrypt, 2FA available" was the previous answer. A
    // security report that names the wrong mechanism is worse than one that
    // says nothing — it is the sentence someone quotes in a questionnaire.
    const sov = read("server/services/permanentSovereignty.ts");
    const at = sov.indexOf('area: "Authentication"');
    expect(at, "the Authentication finding is gone").toBeGreaterThan(-1);
    const line = sov.slice(at, sov.indexOf("\n", at));
    expect(line, "the report claims Passport.js again").not.toMatch(/passport/i);
    expect(line).toMatch(/Clerk/);
  });

  it("Clerk really is the auth provider (the premise)", () => {
    // Everything above rests on this. If the app ever grows a first-party
    // credential path, these deletions are wrong rather than merely stale.
    const authPage = read("client/src/pages/auth-page.tsx");
    expect(authPage).toContain("@clerk/react");
    expect(authPage).toMatch(/SignIn/);
  });
});
