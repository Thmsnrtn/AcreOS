/**
 * A repository that takes the tenant key as an OPTIONAL parameter is a footgun,
 * and this pins the shape of the six times it went off.
 *
 * ── THE DEFECT CLASS ────────────────────────────────────────────────────────
 * 93 methods under `server/storage/` are declared like this:
 *
 *     async updateCampaign(id: number, updates: Partial<InsertCampaign>,
 *                          organizationId?: number) {
 *       const conditions = [eq(campaigns.id, id)];
 *       if (organizationId) conditions.push(eq(campaigns.organizationId, organizationId));
 *       ...
 *
 * The predicate is real, the comment above it is often earnest, and the method
 * is completely safe — IF the caller passes the key. Omit it and the same
 * method silently becomes `WHERE id = $1`, addressable across every tenant by
 * guessing an integer. The type system is content either way: the parameter is
 * optional, so omitting it is not an error anywhere.
 *
 * On 2026-09-04 an independent review found six live instances, each behind
 * `isAuthenticated, getOrCreateOrg` and reachable by any signed-in customer:
 *
 *   1. GET  /api/onboarding/instant-deal-hunt   — selected whole `leads` rows
 *      filtered on state + county ALONE. Owner names, mailing addresses and
 *      phone numbers from every organization holding a lead in that county.
 *   2. GET  /api/custom-fields/values/:entityType/:entityId — the repo method
 *      took no tenant key at all.
 *   3. PUT  /api/campaigns/:id — no ownership check AND `updateCampaignSchema`
 *      accepted `organizationId` (`insertCampaignSchema` omits only
 *      id/createdAt/updatedAt), so a caller could edit another org's campaign
 *      *and reassign it into their own*.
 *   4. POST /api/va/briefings/:id/read — flipped and returned another org's row.
 *   5. PUT  /api/notifications/:id/read — the repo had grown BOTH an org and a
 *      user predicate in two prior audits (F-23-4, F-17-1) and documented them;
 *      this call site never passed either. The fix was built and left unwired,
 *      which is this codebase's most common defect applied to tenancy.
 *      `server/routes-sovereign-integration.ts:158` passes all three, so the
 *      correct form existed in-repo the whole time.
 *   6. POST /api/ai/nudges/:id/dismiss — keyed on id alone; a caller could
 *      silence every other tenant's Pax nudges by walking the id space.
 *
 * ── WHY A COUNT, AND WHY TWO OF THEM ────────────────────────────────────────
 * 111 call sites omit the key. They are NOT 111 vulnerabilities: most are
 * "fetch-then-act" — `getSequence(org.id, id)` with a null check, then
 * `updateSequence(id, …)`. Safe today, fragile forever: the safety lives in a
 * different statement, and deleting that statement is a silent tenancy
 * regression. So the total is a DEBT REGISTER that may only shrink.
 *
 * The security property is the second number. Every one of the six was in a
 * handler that never named the organization AT ALL — nothing in scope could
 * have scoped it. That is decidable, so it is held at an explicit allowlist and
 * anything new fails.
 *
 * ── THE THIRD LAW ───────────────────────────────────────────────────────────
 * The population is enumerated from the declarations themselves rather than
 * from a hand-written list of method names, so adding a 94th optional-tenant
 * method puts it in scope automatically. Both numbers carry vacuity floors: a
 * parse that silently stops matching reads exactly like a clean repo.
 */

import { describe, it, expect, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const ROOT = path.resolve(__dirname, "../..");

/** Total call sites that omit an optional tenant key. Strictly down-only. */
const OMISSION_BASELINE = 111;

/**
 * Call sites whose enclosing function never names an organization, so nothing
 * in scope could have scoped the call. Each is allowlisted with a reason; the
 * set may only shrink. None is customer-reachable by a guessed id.
 */
const UNGUARDED_ALLOWLIST: Record<string, string> = {
  "server/ai/vaService.ts": "VA action bookkeeping inside the service that just created the action; the row is the one it is holding, not one addressed by request input.",
  "server/routes-admin.ts": "Platform support desk. Mounted behind isAuthenticated + requireClerkMFA on /api/admin and operates across tenants by design.",
  "server/services/notificationDispatcher.ts": "Marks the notification the dispatcher itself just delivered, by the id it minted.",
  "server/services/supportBrain.ts": "Support-case triage, platform-ops lane (same authority as routes-admin).",
  "server/services/task-runner.ts": "Updates the scheduled task the runner is currently executing, by the id it was handed.",
};

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "dist"].includes(entry.name)) continue;
      yield* walk(full);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      yield full;
    }
  }
}

const rel = (f: string) => f.replace(ROOT + "/", "");

/** Every `server/storage` method with an optional `organizationId`, and its position. */
function optionalTenantMethods(): Map<string, number> {
  const found = new Map<string, number>();
  for (const file of walk(path.join(ROOT, "server/storage"))) {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      const fn =
        ts.isPropertyAssignment(n) && n.initializer && ts.isFunctionExpression(n.initializer)
          ? n.initializer
          : (n as ts.SignatureDeclaration);
      const named = n as ts.NamedDeclaration;
      if (fn && (fn as ts.SignatureDeclaration).parameters && named.name && ts.isIdentifier(named.name)) {
        const params = (fn as ts.SignatureDeclaration).parameters.filter((p) => p.name.getText() !== "this");
        const idx = params.findIndex((p) => p.name.getText() === "organizationId" && p.questionToken);
        if (idx >= 0) found.set(named.name.text, idx);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return found;
}

/** A handler that names the org in any form could have scoped the call. */
const ORG_IN_SCOPE = /\borg\.id\b|\borgId\b|\borganizationId\b|getOrganizationId\(|req\.organization/;

interface Omission {
  file: string;
  line: number;
  method: string;
  guarded: boolean;
}

function omissions(methods: Map<string, number>): { hits: Omission[]; filesScanned: number; callsSeen: number } {
  const hits: Omission[] = [];
  let filesScanned = 0;
  let callsSeen = 0;
  for (const file of walk(path.join(ROOT, "server"))) {
    const src = fs.readFileSync(file, "utf8");
    filesScanned++;
    if (!src.includes("storage.")) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const method = n.expression.name.text;
        const receiver = n.expression.expression.getText(sf);
        const idx = methods.get(method);
        if (idx !== undefined && /(^|\.)storage$/.test(receiver)) {
          callsSeen++;
          if (n.arguments.length <= idx) {
            let fn: ts.Node | undefined = n;
            while (
              fn &&
              !ts.isFunctionDeclaration(fn) &&
              !ts.isFunctionExpression(fn) &&
              !ts.isArrowFunction(fn) &&
              !ts.isMethodDeclaration(fn)
            ) {
              fn = fn.parent;
            }
            hits.push({
              file: rel(file),
              line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
              method,
              guarded: fn ? ORG_IN_SCOPE.test(fn.getText(sf)) : false,
            });
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { hits, filesScanned, callsSeen };
}

const METHODS = optionalTenantMethods();
const { hits, filesScanned, callsSeen } = omissions(METHODS);

describe("the scan is real (vacuity floors)", () => {
  it("finds the optional-tenant declarations it is built to reason about", () => {
    // 93 at the time of writing. A parser that stops matching reads exactly
    // like a repo that fixed them all.
    expect(METHODS.size).toBeGreaterThan(70);
    expect(METHODS.get("updateCampaign")).toBe(2);
    expect(METHODS.get("markNotificationRead")).toBe(1);
  });

  it("walks the whole server tree and sees real call sites", () => {
    expect(filesScanned).toBeGreaterThan(200);
    expect(callsSeen).toBeGreaterThan(120);
  });
});

describe("no handler can address another tenant's row by a guessed id", () => {
  it("every call site that omits the tenant key is in a function that at least names the org", () => {
    const unguarded = hits.filter((h) => !h.guarded);
    const unexpected = unguarded.filter((h) => !(h.file in UNGUARDED_ALLOWLIST));
    expect(
      unexpected.map((h) => `${h.file}:${h.line} storage.${h.method}()`),
      "These call sites omit an OPTIONAL organizationId and their enclosing function never names an " +
        "organization, so nothing in scope could have scoped them. Either pass the tenant key, or add " +
        "the file to UNGUARDED_ALLOWLIST with a reason that says why it is not addressable by request input.",
    ).toEqual([]);
  });

  it("every allowlisted file still has a hit (a stale exemption is removed, not left to rot)", () => {
    const files = new Set(hits.filter((h) => !h.guarded).map((h) => h.file));
    const stale = Object.keys(UNGUARDED_ALLOWLIST).filter((f) => !files.has(f));
    expect(stale, "these exemptions no longer describe anything — delete them").toEqual([]);
  });
});

describe("the debt register shrinks", () => {
  it(`no more than ${OMISSION_BASELINE} call sites omit an optional tenant key`, () => {
    expect(
      hits.length,
      "A new call site omits an optional organizationId. Pass it — the parameter being optional is a " +
        "property of the repository's signature, not permission to leave it out.",
    ).toBeLessThanOrEqual(OMISSION_BASELINE);
  });

  it("the baseline is not stale-high (a drop must be locked in by the commit that earned it)", () => {
    expect(hits.length, `lower OMISSION_BASELINE to ${hits.length}`).toBe(OMISSION_BASELINE);
  });
});

describe("the routes that were live", () => {
  const source = (r: string) => fs.readFileSync(path.join(ROOT, r), "utf8");

  it("instant-deal-hunt scopes its lead pull to the caller's organization", () => {
    const src = source("server/routes-onboarding.ts");
    const at = src.indexOf('router.get("/instant-deal-hunt"');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, at + 3000);
    expect(body).toContain("eq(leads.organizationId, organizationId)");
  });

  it("custom-field values cannot be read without a tenant key", () => {
    // Required, not optional: the signature itself refuses the unscoped call.
    expect(source("server/storage/customizationRepo.ts")).toMatch(
      /getCustomFieldValues\([^)]*organizationId: number\s*\)/,
    );
    expect(source("server/routes-integrations.ts")).toContain(
      "storage.getCustomFieldValues(entityType, entityId, getOrganizationId(",
    );
  });

  it("a campaign cannot be edited across tenants, nor reassigned into one", () => {
    const src = source("server/routes-campaigns.ts");
    expect(src).toContain("insertCampaignSchema.partial().omit({ organizationId: true })");
    const at = src.indexOf('api.put("/api/campaigns/:id"');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 900)).toContain("getOrganizationId(");
  });

  it("marking a VA briefing read is tenant-scoped", () => {
    expect(source("server/routes-ai.ts")).toMatch(/markBriefingRead\(\s*briefingId,\s*getOrganizationId\(/);
  });

  it("marking a notification read is tenant- AND user-scoped", () => {
    const src = source("server/routes-analytics.ts");
    const at = src.indexOf("storage.markNotificationRead(");
    expect(at).toBeGreaterThan(-1);
    const call = src.slice(at, at + 260);
    expect(call).toContain("getOrganizationId(");
    expect(call).toContain("getUserId(");
  });

  it("a generated document cannot lift another org's seller or buyer", () => {
    // Found 2026-09-04 by widening the tenancy lint's population to the whole
    // server. `from(leads).where(eq(leads.id, prop.sellerId))` carried no
    // tenant term, and the id is a foreign key on a property row that
    // PUT /api/properties/:id spreads req.body into — so a customer could
    // point their OWN property at another organization's lead and render its
    // name, email and phone into a document. Two steps, both available to any
    // signed-in customer.
    const src = source("server/routes-doc-system.ts");
    // Anchor on the QUERY, not on `prop.sellerId)` — that substring also
    // appears in the `if (prop.sellerId)` guard a few lines above, and
    // anchoring there measured the wrong window entirely.
    const reads = [...src.matchAll(/\.from\(leads\)[\s\S]{0,320}?\.limit\(1\)/g)].map((m) => m[0]);
    expect(reads.length, "the seller/buyer lead reads were not found").toBe(2);
    for (const read of reads) {
      expect(read, "a lead read in the document context is not tenant-scoped").toContain(
        "eq(leads.organizationId, prop.organizationId)",
      );
    }
  });

  it("an investor profile cannot be filed under, or moved to, another organization", () => {
    // The insert spread `...body` AFTER `organizationId: org.id`, so a request
    // carrying organizationId overrode the server's own value. Same class as
    // the campaign-reassignment hole above.
    const src = source("server/routes-misc.ts");
    const at = src.indexOf('api.post("/api/investor-profiles"');
    expect(at).toBeGreaterThan(-1);
    const handler = src.slice(at, at + 2600);
    // The protected keys are stripped from the body before it is spread...
    expect(handler).toMatch(/organizationId: _ignoredOrgId[\s\S]*?\.\.\.safeBody/);
    // ...and the server's own value is written after the spread, not before.
    const spreadAt = handler.indexOf("...safeBody,\n            organizationId: org.id");
    expect(spreadAt, "server-owned fields must come after the spread").toBeGreaterThan(-1);
    // The update is tenant-scoped too.
    expect(handler).toContain("eq(investorProfiles.organizationId, org.id)");
  });

  it("dismissing a Pax nudge is tenant-scoped", () => {
    const src = source("server/routes-ai.ts");
    const at = src.indexOf('api.post("/api/ai/nudges/:id/dismiss"');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 900)).toContain("paxNudges.organizationId");
  });
});
