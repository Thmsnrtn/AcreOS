/**
 * One router, two gates, and the split ran along the URL parameter.
 *
 * `routes-due-diligence.ts` mounted eleven handlers. Seven carried
 * `isAuthenticated, getOrCreateOrg` and passed `org.id`. Four carried
 * `isAuthenticated` and **nothing else** — so `req.organization` was undefined
 * and they could not have scoped even if they had tried:
 *
 *   GET  /dossier/:id                  read any org's dossier
 *   GET  /dossier/:id/summary          its executive summary
 *   GET  /dossier/:id/recommendation   its go/no-go investment recommendation
 *   POST /:id/run                      RUN the research pod on it
 *
 * The line between the two groups is which parameter the URL carries: handlers
 * keyed by `:propertyId` were gated, handlers keyed by a dossier `:id` were not.
 * Nothing about that distinction is meaningful — both ids come from the caller.
 *
 * AND THE GATED SEVEN LEAKED TOO. `researchTitle(propertyId)` and its six
 * siblings had `getOrCreateOrg` in front of them and did not pass `org.id` to
 * the service, which resolved the property by primary key. Having the org and
 * not using it is the same defect as not having it, and it is harder to see.
 *
 * THIS ONE SPENDS MONEY. Every research method starts at `getPropertyData` and
 * then calls `dataSourceBroker.lookup(...)` — the provider registry, which
 * deducts credits on paid lookups. An unscoped property fetch was not only a
 * read of another org's parcel; it was a paid lookup performed against it.
 * `POST /:id/run` fans out to all seven at once.
 *
 * WHAT MAKES THIS WORTH READING TWICE. `researchOwner` scopes its lead join by
 * `property.organizationId` — the org of the row it just fetched. That reads as
 * careful, and it is exactly what hides the bug: **deriving the tenant from an
 * unscoped fetch inherits whatever the first query got wrong**, and the code
 * downstream looks more rigorous than the code upstream.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// THIS FILE SWEEPS THE WHOLE REPOSITORY. Stripping comments correctly means
// parsing, ~2.7ms a file, and under the coverage run's instrumentation a
// sweep does not fit the suite's 30s default. Killing it does not make the
// suite faster — it makes this gate stop reporting. Declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

const routes = stripComments(
  fs.readFileSync(path.join(ROOT, "server/routes-due-diligence.ts"), "utf8"),
);
const service = stripComments(
  fs.readFileSync(path.join(ROOT, "server/services/dueDiligencePods.ts"), "utf8"),
);

/** Every `router.<verb>("<path>", …middleware, handler)` registration line. */
function registrations(): Array<{ path: string; line: string }> {
  const out: Array<{ path: string; line: string }> = [];
  const re = /router\.(get|post|patch|delete)\(\s*["']([^"']+)["']([^\n]*)/g;
  for (const m of routes.matchAll(re)) out.push({ path: m[2], line: m[0] });
  return out;
}

const RESEARCH = ["Title", "Tax", "Environmental", "Zoning", "Access", "Comps", "Owner"];

describe("every authenticated handler can see an organization", () => {
  const regs = registrations();

  it("finds the handlers (vacuity guard)", () => {
    expect(regs.length, "no route registrations parsed").toBeGreaterThan(10);
    expect(regs.map((r) => r.path)).toContain("/dossier/:id");
    expect(regs.map((r) => r.path)).toContain("/:id/run");
  });

  it("no authenticated handler is missing getOrCreateOrg", () => {
    // The public lead-magnet preview is deliberately unauthenticated and has no
    // org — it is excluded by the isAuthenticated test itself, not by name, so
    // a new public endpoint is not silently exempted.
    const offenders = regs.filter(
      (r) => /isAuthenticated/.test(r.line) && !/getOrCreateOrg/.test(r.line),
    );
    expect(
      offenders.map((r) => r.path).join(", "),
      "an authenticated handler has no organization middleware, so " +
        "req.organization is undefined and it CANNOT scope its lookup. Four " +
        "handlers were in this state while seven others in the same file were " +
        "gated — the split ran along whether the URL carried :propertyId or a " +
        "dossier :id.",
    ).toBe("");
  });

  it("the dossier-keyed handlers pass the caller's org", () => {
    for (const call of ["getDossier(id,", "runDossierPod(id,"]) {
      const at = routes.indexOf(call);
      expect(at, `${call} is gone — renamed?`).toBeGreaterThan(-1);
    }
    // Only calls that pass an ID need the org. `aggregateToExecutiveSummary`
    // and `generateRecommendation` take an already-fetched dossier (or its
    // scores and findings), so the tenant question was answered before they
    // were reached — adding an org argument to them would let a caller name an
    // org the row is not in, which is the opposite of a scope check. The first
    // draft of this assertion flagged both, and the refinement is the same one
    // unit 58's recipient allowlist needed: a checker that cannot tell the two
    // apart makes the honest shape look like the broken one.
    const calls = routes.match(/dueDiligencePodService\.\w+\([^;]*?\)/gs) ?? [];
    expect(calls.length, "no service calls found").toBeGreaterThan(8);
    const byId = calls.filter((c) => /\((id|propertyId)\b/.test(c));
    expect(byId.length, "no id-keyed service calls found — did the router move?")
      .toBeGreaterThan(8);
    const missing = byId.filter((c) => !/getOrganizationId\(req\)|org\.id/.test(c));
    expect(
      missing.join("\n---\n"),
      "a handler passes an id to the due-diligence service with no organization",
    ).toBe("");
  });

  it("EVERY caller of the service passes an org, in every file", () => {
    // The assertion this file was missing, and it cost a real leak. The first
    // version read `routes-due-diligence.ts` alone, and a SECOND router —
    // `routes-ai-operations.ts`, via a dynamic import — served
    // GET /api/ai-operations/due-diligence/:id from the same unscoped
    // getDossier. It had getOrCreateOrg and did not use it, so nothing about
    // the route registration looked wrong either.
    //
    // Scoping a service is not finished when its own router is fixed. The
    // repo-wide sweep is the only version of this check that means anything.
    const callers: Array<{ file: string; call: string }> = [];
    const serverDir = path.join(ROOT, "server");
    const stack = [serverDir];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) { stack.push(full); continue; }
        if (!entry.endsWith(".ts") || /\.test\.|\.spec\./.test(entry)) continue;
        if (full.endsWith("services/dueDiligencePods.ts")) continue; // its own internals
        const src = stripComments(fs.readFileSync(full, "utf8"));
        for (const m of src.matchAll(/dueDiligencePodService\.(\w+)\([^;]*?\)/gs)) {
          callers.push({ file: path.relative(ROOT, full), call: m[0] });
        }
      }
    }
    expect(callers.length, "no callers found — did the service get renamed?")
      .toBeGreaterThan(10);
    expect(
      new Set(callers.map((c) => c.file)).size,
      "only one file calls this service now — if a caller was deleted that is " +
        "fine, but check it was not simply moved somewhere this sweep misses",
    ).toBeGreaterThan(1);

    const byId = callers.filter((c) => /\((id|propertyId|dossierId)\b/.test(c.call));
    const missing = byId.filter((c) => !/getOrganizationId\(req\)|org\.id|organizationId/.test(c.call));
    expect(
      missing.map((c) => `${c.file}: ${c.call.split("\n")[0]}`).join("\n"),
      "a file passes an id to the due-diligence service without an organization",
    ).toBe("");
  });

  it("all seven research endpoints pass it too", () => {
    // These HAD getOrCreateOrg and did not use it — the harder half to notice.
    for (const name of RESEARCH) {
      expect(
        routes,
        `research${name} is called without the caller's organization`,
      ).toContain(`research${name}(propertyId, getOrganizationId(req))`);
    }
  });
});

describe("the service filters on the organization", () => {
  it("no query resolves a dossier or property by id alone", () => {
    const lone =
      service.match(
        /where\(\s*eq\((dueDiligenceDossiers|properties)\.id\s*,[^)]*\)\s*,?\s*\)/g,
      ) ?? [];
    expect(
      lone.join(" | "),
      "a query resolves a dossier or property by id with no organization " +
        "predicate. Writes count too: runDossierPod updates status, findings " +
        "and scores on the row it just read.",
    ).toBe("");
  });

  it("getPropertyData is scoped — the entry point every research method uses", () => {
    const at = service.indexOf("private async getPropertyData(");
    expect(at, "getPropertyData is gone").toBeGreaterThan(-1);
    const sig = service.slice(at, service.indexOf(")", at));
    expect(sig, "getPropertyData no longer takes an organization").toContain("organizationId");
    const body = service.slice(at, service.indexOf("\n  }", at));
    expect(body).toContain("eq(properties.organizationId, organizationId)");
  });

  it("every research method takes an organization", () => {
    for (const name of RESEARCH) {
      expect(
        service,
        `research${name} lost its organization parameter`,
      ).toContain(`async research${name}(propertyId: number, organizationId: number`);
    }
  });

  it("the paid-lookup claim is still true (why the scope matters)", () => {
    // If the research methods stopped calling the provider broker, the "this
    // one spends money" framing above would be stale — worth failing on, so the
    // reasoning in this file cannot quietly become wrong.
    expect(service).toContain("dataSourceBroker.lookup(");
  });

  it("aggregateToExecutiveSummary uses the dossier's own org, not a parameter", () => {
    // It receives the whole row. An org argument would let a caller pass one the
    // dossier is not in — the opposite of a scope check.
    const at = service.indexOf("async aggregateToExecutiveSummary(");
    const body = service.slice(at, at + 500);
    expect(body).toContain("getPropertyData(dossier.propertyId, dossier.organizationId)");
  });
});

describe("a foreign id is answered as absent", () => {
  it("the refusal is 404, not 403", () => {
    expect(routes).toContain("DueDiligenceNotInOrgError");
    const at = routes.indexOf("function refuse(");
    expect(at, "the refusal helper is gone").toBeGreaterThan(-1);
    const body = routes.slice(at, routes.indexOf("\n}", at));
    expect(body).toContain("Errors.notFound(");
    expect(body).not.toContain("Errors.forbidden(");
  });

  it("the run endpoint routes its error through the refusal", () => {
    // It is the only method here that throws on a foreign id. Its catch used
    // `Errors.badRequest(res, err.message)`, which would have answered 400 with
    // the words "not found in this organization" — a refusal that announces
    // itself is not much better than no refusal.
    const at = routes.indexOf('"/:id/run"');
    expect(at).toBeGreaterThan(-1);
    // Bounded at the NEXT registration, not at the first `});` — the handler
    // body contains `res.json({ dossier });`, so the naive bound cut the window
    // before the catch block and the assertion read an empty tail.
    const next = routes.indexOf("router.", at);
    const handler = routes.slice(at, next === -1 ? at + 900 : next);
    expect(handler).toContain("refuse(res, err");
  });

  it("runDossierPod throws the tenant-aware error", () => {
    const at = service.indexOf("async runDossierPod(");
    const body = service.slice(at, at + 900);
    expect(body).toContain("DueDiligenceNotInOrgError");
  });
});
