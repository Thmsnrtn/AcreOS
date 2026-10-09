/**
 * The VA role path: a VA reads and works only the leads assigned to them.
 *
 * Four rules, each pinned against the behaviour rather than a symbol:
 *
 *   1. ONE resolver decides the effective assigned-only flag
 *      (`resolveViewOnlyAssignedLeads`): a stored NULL means the role default
 *      (va → true), an explicit boolean wins, an owner is never restricted. And
 *      nothing else in server/ reads the stored column as the answer — the
 *      population of readers is enumerated, so a second computation fails here.
 *   2. `assertAssignedLeadWritable` compares the lead's assignee with the
 *      caller's TEAM MEMBER id (what `leads.assigned_to` stores), never the
 *      user id.
 *   3. The assigned-lead scope gate parses a lead id the way the handlers do
 *      (decoded, `Number` and `parseInt`), and refuses an unassigned lead.
 *   4. Every route registration under server/ that carries a lead id in its
 *      path is covered by the gate's prefixes and runs through getOrCreateOrg
 *      (where the gate is chained). The registrations are enumerated from the
 *      source, so a new lead-id route on an unrecognised prefix fails here.
 *
 * The end-to-end proof against a real database is
 * tests/integration/vaRolePath.db.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments, REPO_SWEEP_TIMEOUT_MS } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

const dbRows: { rows: Array<{ id: number; assignedTo: number | null }> } = { rows: [] };
vi.mock("../../server/db", () => {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: async () => dbRows.rows,
  };
  return { db: chain, withTransaction: async (fn: any) => fn(chain) };
});
vi.mock("../../server/storage", () => ({ storage: {}, db: {} }));

describe("1 — one resolver for the effective assigned-only flag", () => {
  it("NULL means the role default; an explicit value wins; an owner is never restricted", async () => {
    const { resolveViewOnlyAssignedLeads: r } = await import("../../server/utils/permissions");
    // The defect: a VA row written without the field. NULL → the va default.
    expect(r("va", null)).toBe(true);
    expect(r("va", undefined)).toBe(true);
    // An owner/admin chose "this VA may see the whole pool".
    expect(r("va", false)).toBe(false);
    expect(r("va", true)).toBe(true);
    for (const role of ["admin", "member", "acquisitions"]) {
      expect(r(role, null), role).toBe(false);
      expect(r(role, true), role).toBe(true);
    }
    expect(r("owner", null)).toBe(false);
    expect(r("owner", true)).toBe(false);
    // viewer keeps the role table's default (true), as migration 0054 backfilled.
    expect(r("viewer", null)).toBe(true);
  });

  it("getUserPermissionContext — what /api/me/permissions serialises — uses it", async () => {
    const { storage } = await import("../../server/storage");
    (storage as any).getTeamMember = async () => ({ id: 41, role: "va", isActive: true, viewOnlyAssignedLeads: null });
    const { getUserPermissionContext } = await import("../../server/utils/permissions");
    const ctx = await getUserPermissionContext({ id: "u-1" }, { id: 9 } as never);
    expect(ctx?.teamMemberId).toBe(41);
    expect(ctx?.permissions.viewOnlyAssignedLeads).toBe(true);
    (storage as any).getTeamMember = async () => ({ id: 42, role: "member", isActive: true, viewOnlyAssignedLeads: null });
    expect((await getUserPermissionContext({ id: "u-2" }, { id: 9 } as never))?.permissions.viewOnlyAssignedLeads).toBe(false);
  });

  it("/api/me/permissions serialises the enforcement context, it does not recompute it", () => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, "server/routes-organization.ts"), "utf8"));
    const at = src.indexOf('"/api/me/permissions"');
    expect(at, "GET /api/me/permissions not found — renamed?").toBeGreaterThan(-1);
    const handler = src.slice(at, src.indexOf("\n  });", at));
    expect(handler).toMatch(/await getUserPermissionContext\(req\.user, org\)/);
    expect(handler).toMatch(/permissions: context\.permissions/);
    expect(handler).not.toMatch(/getPermissionsForRole|viewOnlyAssignedLeads/);
  });

  /**
   * The population: every non-test source under server/, shared/, scripts/ and
   * client/src/, comment-stripped. EVERY occurrence of the column's name is
   * classified and must match this register exactly (count per file, shape and
   * receiver), so a new read in any shape — `x.f`, `x?.f`, `(x as any).f`,
   * `x["f"]`, `{ f } = x`, `{ f: y } = x`, raw SQL — fails until it is reviewed
   * here. Reads of `permissions.viewOnlyAssignedLeads` are the RESOLVED value
   * (the output of the resolver) and are allowed anywhere.
   */
  const REGISTER: Record<string, { n: number; why: string }> = {
    "server/utils/permissions.ts|member|teamMember": { n: 1, why: "effectivePermissions passes the stored override to the resolver" },
    "server/utils/permissions.ts|member|<expr>": { n: 1, why: "the resolver reads the role table default" },
    "server/utils/permissions.ts|key|-": { n: 8, why: "RolePermissions type, the role table, the effectivePermissions parameter and its result" },
    "server/routes-organization.ts|member|member": { n: 3, why: "withEffectiveViewOnly: resolver input, and the raw override echoed as viewOnlyAssignedLeadsOverride (also in the GET /api/team projection)" },
    "server/routes-organization.ts|member|effective": { n: 1, why: "GET /api/team serves withEffectiveViewOnly's resolved flag on top of the per-caller projection" },
    "server/routes-organization.ts|member|targetMember": { n: 2, why: "role change clears a stored false; audit 'before' records the stored override" },
    "server/routes-organization.ts|member|updates": { n: 1, why: "role change writes NULL" },
    "server/routes-organization.ts|member|data": { n: 2, why: "the toggle body is written and audited" },
    "server/routes-organization.ts|key|-": { n: 8, why: "projection type/output (incl. GET /api/team), toggle schema, writes, audit before/after, invite-accept NULL" },
    "server/services/paxAccountReads.ts|key|-": { n: 1, why: "Pax team read: the select projection key" },
    "server/services/paxAccountReads.ts|member|teamMembers": { n: 1, why: "Pax team read: the column in the select" },
    "server/services/paxAccountReads.ts|member|m": { n: 1, why: "Pax team read: resolver input (resolveViewOnlyAssignedLeads), never served raw" },
    "server/services/paxProductFacts.ts|member|p": { n: 1, why: "Pax role facts: the ROLE TABLE default from getPermissionsForRole — already a resolved value" },
    "server/routes-organization.ts|string|-": { n: 1, why: "audit `fields` name" },
    "shared/schema.ts|key|-": { n: 1, why: "column declaration" },
    "shared/schema.ts|sql|-": { n: 1, why: "column name" },
    "scripts/migrate.mjs|sql|-": { n: 3, why: "DDL: 0054 add, 0269 drop NOT NULL / drop default" },
    "scripts/data/reset-va-view-only-default.ts|sql|-": { n: 2, why: "founder-run reset: row type and SET" },
    "scripts/data/reset-va-view-only-default.ts|sql|tm": { n: 4, why: "founder-run reset: select and re-checked predicate" },
    "scripts/data/reset-va-view-only-default.ts|string|-": { n: 1, why: "audit `fields` lookup for owner-made choices" },
    "client/src/hooks/use-organization.ts|key|-": { n: 3, why: "client types: the EFFECTIVE flag from /api/me/permissions and /api/team, and the toggle input" },
    "client/src/hooks/use-organization.ts|shorthand|-": { n: 4, why: "toggle mutation: request body and optimistic patch" },
    "client/src/hooks/use-organization.ts|bare|-": { n: 2, why: "toggle mutation: optimistic patch reads its own argument" },
  };
  const RESOLVED = new Set(["member|permissions"]);

/**
 * Every occurrence of the column's name (camel or snake case) in a
 * comment-stripped source, classified by syntactic shape and receiver. A shape
 * the classifier does not recognise is reported as "bare", never dropped.
 */
function columnOccurrences(src: string): Array<{ shape: string; receiver: string }> {
  const out: Array<{ shape: string; receiver: string }> = [];
  for (const m of src.matchAll(/\bviewOnlyAssignedLeads\b|\bview_only_assigned_leads\b/g)) {
    const i = m.index!;
    const before = src.slice(Math.max(0, i - 80), i);
    const after = src.slice(i + m[0].length, i + m[0].length + 20);
    let r: RegExpExecArray | null;
    if (m[0] === "view_only_assigned_leads") {
      out.push({ shape: "sql", receiver: /(\w+)\s*\.\s*"?$/.exec(before)?.[1] ?? "-" });
    } else if ((r = /(\w+)\s*!?\s*\??\.\s*$/.exec(before))) {
      out.push({ shape: "member", receiver: r[1] });
    } else if ((r = /\(\s*(\w+)\s+as\s+[^()]*\)\s*!?\s*\??\.\s*$/.exec(before))) {
      out.push({ shape: "member", receiver: r[1] });
    } else if (/[)\]]\s*!?\s*\??\.\s*$/.test(before)) {
      out.push({ shape: "member", receiver: "<expr>" });
    } else if ((r = /(\w+|[)\]])\s*\??\.?\s*\[\s*["'`]$/.exec(before))) {
      out.push({ shape: "bracket", receiver: /\w/.test(r[1]) ? r[1] : "<expr>" });
    } else if (/["'`]$/.test(before)) {
      out.push({ shape: "string", receiver: "-" });
    } else if (/[{,]\s*$/.test(before) && /^\s*[,}=]/.test(after)) {
      out.push({ shape: "shorthand", receiver: "-" });
    } else if (/^\s*\??\s*:/.test(after)) {
      out.push({ shape: "key", receiver: "-" });
    } else {
      out.push({ shape: "bare", receiver: "-" });
    }
  }
  return out;
}

  function sourceFiles(): string[] {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (!/node_modules/.test(rel)) walk(rel);
        } else if (/\.(ts|tsx|mjs|js)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) files.push(rel);
      }
    };
    for (const d of ["server", "shared", "scripts", "client/src"]) walk(d);
    return files;
  }

  function tally(files: Array<[string, string]>): Map<string, number> {
    const counts = new Map<string, number>();
    for (const [f, raw] of files) {
      for (const o of columnOccurrences(stripComments(raw))) {
        if (RESOLVED.has(`${o.shape}|${o.receiver}`)) continue;
        const k = `${f}|${o.shape}|${o.receiver}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    return counts;
  }

  it("every occurrence of the stored column in server/, shared/, scripts/, client/src/ is in the register", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(2000);
    const counts = tally(files.map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf8")]));
    const unexpected = [...counts].filter(([k, n]) => REGISTER[k]?.n !== n).map(([k, n]) => `${k} ×${n}`);
    expect(unexpected).toEqual([]);
    // Per-member vacuity: every registered read is still really there.
    const missing = Object.keys(REGISTER).filter((k) => !counts.has(k));
    expect(missing).toEqual([]);
  });

  it.each([
    ["(m as any).viewOnlyAssignedLeads", "member|m"],
    ["m?.viewOnlyAssignedLeads", "member|m"],
    ["m!.viewOnlyAssignedLeads", "member|m"],
    ['m["viewOnlyAssignedLeads"]', "bracket|m"],
    ["const { viewOnlyAssignedLeads } = m;", "shorthand|-"],
    ["const { role, viewOnlyAssignedLeads: v } = m;", "key|-"],
    ["db.execute(sql`select view_only_assigned_leads from team_members`)", "sql|-"],
    ["return viewOnlyAssignedLeads;", "bare|-"],
  ])("canary — %s is caught", (code, key) => {
    const counts = tally([["server/canary.ts", `export function f(m: any) { ${code} }`]]);
    expect([...counts.keys()]).toEqual([`server/canary.ts|${key}`]);
    expect(REGISTER[`server/canary.ts|${key}`]).toBeUndefined();
  });

  it("canary — a comment naming the column is not an occurrence", () => {
    expect(tally([["server/canary.ts", "// m.viewOnlyAssignedLeads\n/* m['viewOnlyAssignedLeads'] */ export {};"]]).size).toBe(0);
  });
});

describe("2 — a write is checked against the caller's TEAM MEMBER id", () => {
  const req = (teamMemberId: number | undefined) =>
    ({
      user: { id: "3f2c9a8e-uuid" },
      permissionContext: { userId: "3f2c9a8e-uuid", teamMemberId, permissions: { viewOnlyAssignedLeads: true } },
    }) as never;
  const res = () => {
    const r: any = { statusCode: 0 };
    r.status = (c: number) => ((r.statusCode = c), r);
    r.json = () => r;
    return r;
  };

  it("a lead assigned to the caller's team member is writable; anyone else's is not", async () => {
    const { assertAssignedLeadWritable } = await import("../../server/utils/assignedLeadGate");
    expect(assertAssignedLeadWritable(req(7), res(), { assignedTo: 7 })).toBe(false);
    const other = res();
    expect(assertAssignedLeadWritable(req(7), other, { assignedTo: 8 })).toBe(true);
    expect(other.statusCode).toBe(403);
    expect(assertAssignedLeadWritable(req(7), res(), { assignedTo: null })).toBe(true);
    // No team-member id: identity unknown → not theirs.
    expect(assertAssignedLeadWritable(req(undefined), res(), { assignedTo: 7 })).toBe(true);
  });
});

describe("3 — the scope gate reads a lead id the way the handlers do", () => {
  it("decodes, and checks every integer Number() or parseInt() would yield", async () => {
    const { parseLeadIdSegment } = await import("../../server/middleware/assignedLeadScopeGate");
    const c = (p: string) => parseLeadIdSegment(p)?.ids ?? [];
    expect(c("/api/leads/12")).toEqual([12]);
    expect(c("/api/leads/12/activities")).toEqual([12]);
    expect(c("/API/Leads/12")).toEqual([12]);
    expect(c("/api/leads/%31%32")).toEqual([12]);
    expect(c("/api/leads/12abc")).toEqual([12]);
    expect(c("/api/leads/12%2Fx")).toEqual([12]);
    expect(c("/api/leads/1e3").sort()).toEqual([1, 1000]);
    expect(c("/api/seller-intent/12/urgency")).toEqual([12]);
    expect(c("/api/skip-traces/lead/5")).toEqual([5]);
    // Radix-less parseInt reads a "0x" prefix as hex: "0x1Fzz" is 31 to a
    // handler that calls parseInt(req.params.x).
    expect(c("/api/seller-intent/0x1Fzz")).toContain(31);
    // Literal siblings name no lead.
    for (const p of ["/api/leads", "/api/leads/", "/api/leads/export", "/api/leads/focus", "/api/leads/bulk-update", "/api/properties/12"]) {
      expect(c(p), p).toEqual([]);
    }
  });

  it("only ^[1-9]\\d*$ is canonical; anything else a parser reads as an integer is not", async () => {
    const { parseLeadIdSegment: p } = await import("../../server/middleware/assignedLeadScopeGate");
    expect(p("/api/leads/31")).toEqual({ ids: [31], canonical: true });
    for (const seg of ["0x1Fzz", "%2031", "31.0", "3.1e1", "0031", "31abc", "0x1F", "%2B31", "0"]) {
      const r = p(`/api/seller-intent/${seg}`);
      expect(r, seg).not.toBeNull();
      expect(r!.canonical, seg).toBe(false);
    }
    expect(p("/api/seller-intent/0x1Fzz")!.ids).toContain(31);
    expect(p("/api/leads/3.1e1")!.ids).toEqual(expect.arrayContaining([31, 3]));
  });

  const run = async (
    path: string,
    ctx: { teamMemberId: number; permissions: { viewOnlyAssignedLeads: boolean } },
    rows: Array<{ id: number; assignedTo: number | null }>,
  ) => {
    dbRows.rows = rows;
    const { assignedLeadScopeGate } = await import("../../server/middleware/assignedLeadScopeGate");
    const req: any = { baseUrl: "", path, method: "GET", user: { id: "u" }, organization: { id: 9 }, permissionContext: ctx };
    const res: any = { statusCode: 0 };
    res.status = (s: number) => ((res.statusCode = s), res);
    res.json = () => res;
    const next = vi.fn();
    await assignedLeadScopeGate(req, res, next);
    return { status: res.statusCode, passed: next.mock.calls.length === 1 };
  };
  const va = { teamMemberId: 7, permissions: { viewOnlyAssignedLeads: true } };

  it("an assigned-only caller gets 404 for a lead that is not theirs, and passes for their own", async () => {
    expect(await run("/api/leads/5", va, [{ id: 5, assignedTo: 8 }])).toEqual({ status: 404, passed: false });
    expect(await run("/api/leads/5/timeline", va, [{ id: 5, assignedTo: null }])).toEqual({ status: 404, passed: false });
    expect(await run("/api/leads/5", va, [{ id: 5, assignedTo: 7 }])).toEqual({ status: 0, passed: true });
    // A lead that does not exist in the org is the route's own 404 to give.
    expect(await run("/api/leads/5", va, [])).toEqual({ status: 0, passed: true });
  });

  it("an assigned-only caller gets 404 for ANY non-canonical id, before any read — even one that resolves to their own lead", async () => {
    for (const seg of ["0x7zz", "%207", "7.0", "0.7e1", "007"]) {
      // The row says the lead IS theirs; the refusal must not depend on it.
      expect(await run(`/api/seller-intent/${seg}`, va, [{ id: 7, assignedTo: 7 }]), seg).toEqual({ status: 404, passed: false });
    }
  });

  it("an unrestricted caller, and a path with no lead id, pass untouched", async () => {
    const member = { teamMemberId: 7, permissions: { viewOnlyAssignedLeads: false } };
    expect(await run("/api/leads/5", member, [{ id: 5, assignedTo: 8 }])).toEqual({ status: 0, passed: true });
    expect(await run("/api/leads/export", va, [{ id: 5, assignedTo: 8 }])).toEqual({ status: 0, passed: true });
    expect(await run("/api/seller-intent/0x5zz", member, [{ id: 5, assignedTo: 8 }])).toEqual({ status: 0, passed: true });
  });
});

describe("4 — every lead-id route is inside the gate's population", () => {
  // Which prefix a router file's relative paths sit under.
  const manifestSrc = fs.readFileSync(path.join(ROOT, "server/routeManifest.ts"), "utf8");
  const mountOf = new Map<string, string>();
  for (const m of manifestSrc.matchAll(/file:\s*"([^"]+)",\s*mountPath:\s*"([^"]+)",\s*kind:\s*"router"/g)) mountOf.set(m[1], m[2]);
  const routesTs = stripComments(fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8"));

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) files.push(rel);
    }
  };
  walk("server");

  interface Reg { file: string; receiver: string; isRouter: boolean; mount: string; method: string; rel: string; full: string; argText: string }
  const regs: Reg[] = [];
  const unreadable: string[] = [];
  const receivers = new Set<string>();
  let scannedRegistrations = 0;
  const esc = (x: string) => x.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
  // Mounts by router NAME across server/ (`app.use("/api/v1/leads", leadsV1Router)`
  // in another file than the router's own), for routers the manifest does not list.
  const mountByName = new Map<string, string>();
  for (const f of files) {
    const src = stripComments(fs.readFileSync(path.join(ROOT, f), "utf8"));
    for (const m of src.matchAll(/\bapp\.use\(\s*["'`]([^"'`]+)["'`][^)]*?\b([A-Za-z_$][\w$]*)\s*\)/g)) mountByName.set(m[2], m[1]);
  }
  for (const f of files) {
    const src = stripComments(fs.readFileSync(path.join(ROOT, f), "utf8"));
    const base = path.basename(f);
    // ANY receiver: `api.get`, `router.get`, `fieldScoutRouter.get`, … — the
    // receiver is derived from the registration, not from a fixed list.
    for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|all)\(\s*(["'`])(\/[^"'`]*)\3/g)) {
      scannedRegistrations++;
      const receiver = m[1];
      receivers.add(receiver);
      const rel = m[4];
      const declaredRouter = new RegExp(`\\b${esc(receiver)}\\s*(?::[^=]+)?=\\s*(?:express\\.)?(?:Router|createRouter)\\(`).test(src);
      const isRouter = declaredRouter || !["app", "api"].includes(receiver);
      const localMount =
        new RegExp(`\\bapp\\.use\\(\\s*["'\`]([^"'\`]+)["'\`][^)]*\\b${esc(receiver)}\\s*\\)`).exec(src)?.[1] ?? null;
      const mount = isRouter ? (mountOf.get(base) ?? localMount ?? mountByName.get(receiver) ?? null) : "";
      const full = mount === null ? null : `${mount === "/" ? "" : mount}${rel}`;
      const argText = src.slice(m.index!, src.indexOf("=>", m.index!) + 2);
      const looksLeadKeyed = /:leadId\b/.test(rel) || /(^|\/)leads\/:/.test(rel) || (full !== null && /\/leads\/:/.test(full));
      if (!looksLeadKeyed) continue;
      if (full === null || mount === null) {
        unreadable.push(`${f}: ${receiver}.${m[2]} ${rel} (router with no resolvable mount)`);
        continue;
      }
      regs.push({ file: f, receiver, isRouter, mount, method: m[2], rel, full, argText });
    }
  }

  it("reads the population it claims (floors, and no unresolvable router)", () => {
    expect(files.length).toBeGreaterThan(500);
    // Counted, never skipped: a lead-keyed route whose mount cannot be resolved
    // is a route this gate cannot be shown to cover.
    expect(unreadable).toEqual([]);
    // Measured 2026-10-07: 2,669 registrations from 8 receivers derived from the
    // source (api, app, router, fieldScoutRouter, leadsV1Router, …), of which 46
    // are lead-keyed.
    expect(scannedRegistrations).toBeGreaterThan(2400);
    expect(regs.length).toBeGreaterThanOrEqual(42);
    expect(receivers.size).toBeGreaterThanOrEqual(7);
    expect(receivers.has("fieldScoutRouter")).toBe(true);
    // Per-shape vacuity: each kind of registration the gate relies on is found.
    const has = (pred: (r: Reg) => boolean, what: string) => expect(regs.some(pred), what).toBe(true);
    has((r) => r.full === "/api/leads/:id" && r.method === "get", "GET /api/leads/:id");
    has((r) => r.receiver === "router" && r.full.startsWith("/api/seller-intent/"), "a mounted router (seller-intent)");
    has((r) => r.receiver === "fieldScoutRouter" && r.full === "/api/leads/:id/photos", "a router with its own name (field-scout)");
    has((r) => r.full.startsWith("/api/ai/intent/lead/"), "a register-style file with its own router (ai-operations)");
    has((r) => r.full === "/api/leads/:id/enrich", "a router mounted at /api/leads (lead-enrichment)");
    has((r) => r.full === "/api/leads/:id/contact-event", "a multi-line registration");
  });

  /**
   * Lead-keyed paths that read NO lead data, so there is nothing to scope. Each
   * entry is a decision with its reason; one that stops matching a real
   * registration fails below, so the list cannot rot into blanket cover.
   */
  const READS_NO_LEAD_DATA: Record<string, string> = {
    "GET /api/outreach-ab-tests/:id/variant/:leadId":
      "derives an A/B bucket from the number itself; no lead row is read or returned",
  };
  /**
   * Lead-keyed paths authenticated by an ORG API key rather than a team-member
   * session. Assigned-only access is a per-member restriction, and these
   * requests carry no member — so they are outside this gate by construction,
   * and listed so that is a decision, not an omission.
   */
  const ORG_API_KEY_ROUTES: Record<string, string> = {
    "GET /api/v1/leads/:id": "public API v1 (requireApiKey)",
    "PATCH /api/v1/leads/:id": "public API v1 (requireApiKey)",
  };
  const outsideGate = (r: Reg) => {
    const k = `${r.method.toUpperCase()} ${r.full}`;
    return k in READS_NO_LEAD_DATA || k in ORG_API_KEY_ROUTES;
  };

  it("every exemption names a registration that exists", () => {
    const keys = new Set(regs.map((r) => `${r.method.toUpperCase()} ${r.full}`));
    for (const k of [...Object.keys(READS_NO_LEAD_DATA), ...Object.keys(ORG_API_KEY_ROUTES)]) expect(keys.has(k), k).toBe(true);
    for (const k of Object.keys(ORG_API_KEY_ROUTES)) {
      const r = regs.find((x) => `${x.method.toUpperCase()} ${x.full}` === k)!;
      expect(r.argText, k).toMatch(/requireApiKey\(/);
    }
  });

  it("every lead-id path is recognised by the gate", async () => {
    const { parseLeadIdSegment } = await import("../../server/middleware/assignedLeadScopeGate");
      const leadIdCandidatesFromPath = (p: string) => parseLeadIdSegment(p)?.ids ?? [];
    const uncovered = regs
      .filter((r) => !outsideGate(r))
      .filter((r) => {
        const concrete = r.full.replace(/:leadId\b/, "4242").replace(/^(\/api\/leads\/):[A-Za-z_]+/, "$14242");
        return !leadIdCandidatesFromPath(concrete).includes(4242);
      })
      .map((r) => `${r.file}: ${r.method.toUpperCase()} ${r.full}`);
    expect(uncovered).toEqual([]);
  });

  it("every lead-id route runs through getOrCreateOrg, where the gate is chained", () => {
    const missing = regs
      .filter((r) => !outsideGate(r))
      .filter((r) => {
        if (/\bgetOrCreateOrg\b/.test(r.argText)) return false;
        if (!r.isRouter) return true;
        // The mount line that names THIS router (its import name in routes.ts,
        // or its own receiver for a file that mounts itself) must carry
        // getOrCreateOrg — not just any `app.use` on the same prefix.
        const base = path.basename(r.file, ".ts");
        const importName = new RegExp(`import\\s+(\\w+)\\s+from\\s+["']\\./${esc(base)}["']`).exec(routesTs)?.[1];
        const names = [importName, r.receiver].filter(Boolean).map((n) => esc(n!)).join("|");
        const mountLine = new RegExp(`app\\.use\\(\\s*["'\`]${esc(r.mount)}["'\`][^\\n]*\\bgetOrCreateOrg\\b[^\\n]*\\b(?:${names})\\b`);
        const src = stripComments(fs.readFileSync(path.join(ROOT, r.file), "utf8"));
        return !mountLine.test(routesTs) && !mountLine.test(src);
      })
      .map((r) => `${r.file}: ${r.method.toUpperCase()} ${r.full}`);
    expect(missing).toEqual([]);
    // Per-member vacuity for the mount path: field-scout is covered through its mount.
    expect(regs.some((r) => r.receiver === "fieldScoutRouter" && !/\bgetOrCreateOrg\b/.test(r.argText))).toBe(true);
    const chain = stripComments(fs.readFileSync(path.join(ROOT, "server/middleware/getOrCreateOrg.ts"), "utf8"));
    expect(chain).toMatch(/assignedLeadScopeGate\(req, res, next\)/);
  });
});
