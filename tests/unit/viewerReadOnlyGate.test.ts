/**
 * The viewer role, actually made read-only.
 *
 * `roleGuard.ts` has documented `viewer — read-only across the CRM` since it was
 * written. It was not: `canEdit*` and `canCreate*` are FALSE for `viewer` and
 * TRUE for every other role, and **no server code enforced any of them on any
 * path**. A viewer could create and edit leads, properties, deals and notes.
 *
 * Intra-org, not cross-tenant — every route involved is already org-scoped. What
 * was unenforced is the org owner's own configuration, which is the entire
 * reason to invite somebody as a viewer rather than a member.
 *
 * These are BEHAVIOURAL tests, not source scans. The gate takes a request and
 * either calls `next()` or responds, so it can be driven directly with fakes —
 * and a security gate that has only ever been read is a security gate that has
 * never been tried.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

vi.mock("../../server/utils/permissions", () => ({
  getUserPermissionContext: vi.fn(),
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { getUserPermissionContext } = await import("../../server/utils/permissions");
const { viewerReadOnlyGate, VIEWER_WRITE_EXEMPT_PREFIXES } = await import(
  "../../server/middleware/viewerReadOnlyGate"
);

type Ctx = { role: string } | null;

function drive(
  opts: { method: string; path: string; role?: Ctx; user?: unknown; org?: unknown; throws?: boolean },
) {
  (getUserPermissionContext as unknown as ReturnType<typeof vi.fn>).mockReset();
  if (opts.throws) {
    (getUserPermissionContext as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("membership store down"),
    );
  } else {
    (getUserPermissionContext as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      opts.role === undefined ? { role: "member" } : opts.role,
    );
  }
  const req: Record<string, unknown> = {
    method: opts.method,
    path: opts.path,
    user: "user" in opts ? opts.user : { id: "u1" },
    organization: "org" in opts ? opts.org : { id: 7 },
  };
  const status = { code: 0, body: null as unknown };
  const res = {
    status(c: number) { status.code = c; return this; },
    json(b: unknown) { status.body = b; return this; },
  };
  const next = vi.fn();
  return { req, res, next, status, run: () => viewerReadOnlyGate(req as never, res as never, next) };
}

describe("it refuses a viewer's CRM writes", () => {
  it("refuses every mutating verb", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const d = drive({ method, path: "/api/leads/1", role: { role: "viewer" } });
      await d.run();
      expect(d.next, `${method} was allowed`).not.toHaveBeenCalled();
      expect(d.status.code, `${method}`).toBe(403);
    }
  });

  it("says why, in terms the person can act on", async () => {
    const d = drive({ method: "POST", path: "/api/leads", role: { role: "viewer" } });
    await d.run();
    const body = d.status.body as { message?: string };
    expect(JSON.stringify(body)).toMatch(/read-only/i);
    expect(JSON.stringify(body)).toMatch(/owner or admin/i);
  });
});

describe("it lets everything else through", () => {
  it("never touches reads", async () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const d = drive({ method, path: "/api/leads", role: { role: "viewer" } });
      await d.run();
      expect(d.next, `${method} was blocked`).toHaveBeenCalled();
    }
    // A read must not even resolve the role — reads are free.
    expect(getUserPermissionContext).not.toHaveBeenCalled();
  });

  it("does not touch any other role", async () => {
    // member and va keep every write they had. Their restrictions are the
    // per-resource permissions and the assigned-leads gate, enforced elsewhere.
    for (const role of ["owner", "admin", "member", "va"]) {
      const d = drive({ method: "POST", path: "/api/leads", role: { role } });
      await d.run();
      expect(d.next, `${role} was blocked`).toHaveBeenCalled();
    }
  });

  it("allows the small set of person-scoped writes", async () => {
    for (const prefix of VIEWER_WRITE_EXEMPT_PREFIXES) {
      const d = drive({ method: "POST", path: `${prefix}anything`, role: { role: "viewer" } });
      await d.run();
      expect(d.next, `${prefix} was blocked`).toHaveBeenCalled();
    }
  });

  it("the exempt list stays small — every entry is a hole in the guarantee", () => {
    // Not a style rule. Each prefix is a path a read-only account may write to,
    // and the list growing quietly is how "read-only" stops being true.
    expect(VIEWER_WRITE_EXEMPT_PREFIXES.length).toBeLessThanOrEqual(6);
    for (const p of VIEWER_WRITE_EXEMPT_PREFIXES) {
      expect(p.startsWith("/api/"), `${p} is not an API path`).toBe(true);
      // No entry may exempt a CRM resource.
      expect(p).not.toMatch(/leads|properties|deals|notes|offers|campaigns/);
    }
  });
});

describe("it cannot fail open", () => {
  it("resolves the role ITSELF rather than reading a context that is not there yet", async () => {
    // attachPermissionContext() and requirePermission() run per-route, AFTER
    // this chokepoint. A gate that read req.permissionContext here would find
    // undefined on every request and pass everything through while looking
    // correct.
    const d = drive({ method: "POST", path: "/api/leads", role: { role: "viewer" } });
    await d.run();
    expect(getUserPermissionContext).toHaveBeenCalled();
    expect(d.status.code).toBe(403);
  });

  it("caches the resolved context so requirePermission does not read twice", async () => {
    const d = drive({ method: "POST", path: "/api/leads", role: { role: "member" } });
    await d.run();
    expect((d.req as { permissionContext?: unknown }).permissionContext).toEqual({
      role: "member",
    });
  });

  it("FAILS CLOSED when the role cannot be resolved", async () => {
    // If the membership cannot be read we do not know whether this caller is
    // read-only, and a security gate that guesses is not a gate.
    const d = drive({ method: "POST", path: "/api/leads", throws: true });
    await d.run();
    expect(d.next).not.toHaveBeenCalled();
    expect(d.status.code).toBe(403);
  });

  it("defers when there is no user or no org, rather than guessing", async () => {
    for (const missing of [{ user: null }, { org: null }]) {
      const d = drive({ method: "POST", path: "/api/leads", ...missing });
      await d.run();
      expect(d.next).toHaveBeenCalled();
    }
  });

  it("a caller with no membership row is left to the route's own authorization", async () => {
    const d = drive({ method: "POST", path: "/api/leads", role: null });
    await d.run();
    expect(d.next).toHaveBeenCalled();
  });
});

describe("it runs at the one chokepoint", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "server/middleware/getOrCreateOrg.ts"),
    "utf8",
  );

  it("is chained from getOrCreateOrg, alongside the other mutation gates", () => {
    // A role-level rule belongs at the one place that resolves the org, not on
    // sixty handlers where the sixty-first would be open by default.
    expect(src).toContain("viewerReadOnlyGate(req, res, next)");
    expect(src).toContain("subscriptionPauseGate(req, res");
    expect(src).toContain("dunningAccessGate(req, res");
  });

  it("runs LAST of the three, so a paused org is refused for the pause reason", () => {
    // Ordering changes which message a caller sees, and the pause/dunning
    // reasons are more actionable than "your access is read-only".
    expect(src.indexOf("subscriptionPauseGate(req, res")).toBeLessThan(
      src.indexOf("viewerReadOnlyGate(req, res, next)"),
    );
    expect(src.indexOf("dunningAccessGate(req, res")).toBeLessThan(
      src.indexOf("viewerReadOnlyGate(req, res, next)"),
    );
  });

  it("the role table still denies viewers what this enforces", () => {
    // The gate matters only because the role table says viewers may not write.
    // If that changed, this would be enforcing a rule nobody holds.
    const perms = fs.readFileSync(path.join(ROOT, "server/utils/permissions.ts"), "utf8");
    const at = perms.indexOf("  viewer: {");
    expect(at).toBeGreaterThan(-1);
    const block = perms.slice(at, perms.indexOf("\n  },", at));
    for (const p of ["canEditLeads", "canCreateLeads", "canEditDeals", "canCreateDeals"]) {
      expect(block, `viewer.${p} is no longer restricted`).toContain(`${p}: false`);
    }
  });
});
