/**
 * The population of property writers, enumerated.
 *
 * A property row can name a parent parcel (`properties.parent_parcel_id`).
 * The repository (server/storage/propertyRepo.ts) resolves a supplied parent
 * inside the writer's organization; tests/unit/parentParcelOrganizationScope
 * .realdb.test.ts proves that behaviour through the real handlers. This test
 * pins WHICH writers exist, so a new one cannot appear without being
 * classified here:
 *
 *   - "repository"      — the repository itself;
 *   - "via-repository"  — writes through storage.createProperty /
 *                         updateProperty / bulkUpdateProperties, so the
 *                         repository check applies;
 *   - "direct"          — writes the table directly with a payload it builds
 *                         itself; the note says where the parent column comes
 *                         from (never from the request).
 *
 * Population: every non-test .ts file under server/, parsed with the
 * TypeScript compiler (a parse never reads a comment). A write is a call
 * `x.insert(T)` / `x.update(T)` where T is the `properties` table imported
 * from @shared/schema (under any local name), or a call to one of the three
 * repository writers on any receiver. Floors and a per-file vacuity check pin
 * that the walker still finds what it found.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { REPO_ROOT, listServerSources, parseSource, rel } from "../helpers/serverPopulation";

type Kind = "repository" | "via-repository" | "direct";

const WRITERS: Record<string, { kind: Kind; note: string }> = {
  "server/storage/propertyRepo.ts": { kind: "repository", note: "createProperty / updateProperty / bulkUpdateProperties resolve the parent in the organization" },
  "server/routes-properties.ts": { kind: "via-repository", note: "POST, PUT, bulk-update, land-status, fetch-parcel" },
  "server/ai/tools.ts": { kind: "via-repository", note: "create_property / update_property / batch create" },
  "server/services/importExport.ts": { kind: "via-repository", note: "CSV import builds an explicit field list" },
  "server/services/propertyEnrichment.ts": { kind: "via-repository", note: "enrichment fields only" },
  "server/services/workflow-engine.ts": { kind: "via-repository", note: "update_record writes configured fields through the repository" },
  "server/services/onboarding/demoDataSeeder.ts": { kind: "via-repository", note: "static fixtures" },
  "server/services/onboarding/sampleSeeder.ts": { kind: "via-repository", note: "static fixtures" },
  "server/routes-subdivisions.ts": { kind: "direct", note: "lot creation takes the parent from the route, after resolving it in the organization; lot edit has no parent field; detach sets null" },
  "server/routes-lot-basis.ts": { kind: "direct", note: "sold status and price only" },
  "server/routes-lot-pricing.ts": { kind: "direct", note: "list price only" },
  "server/routes-bulk.ts": { kind: "direct", note: "status and assignee allow-list" },
  "server/jobs/featureEngineeringJob.ts": { kind: "direct", note: "aiInsights only" },
  "server/services/dueDiligence.ts": { kind: "direct", note: "parcel boundary fields only" },
  "server/services/tax/landExit.ts": { kind: "direct", note: "explicit fields from the tax certificate" },
  "server/services/leads/convertLeadToDeal.ts": { kind: "direct", note: "explicit fields from the lead" },
  "server/api-v1/properties.ts": { kind: "direct", note: "explicit field list" },
};

const REPO_WRITERS = new Set(["createProperty", "updateProperty", "bulkUpdateProperties"]);

function propertiesTableNames(sf: ts.SourceFile): { names: Set<string>; namespaces: Set<string> } {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!/^@shared\/schema(\.ts|\.js)?$|\/shared\/schema(\.ts|\.js)?$/.test(st.moduleSpecifier.text)) continue;
    const b = st.importClause?.namedBindings;
    if (!b) continue;
    if (ts.isNamespaceImport(b)) namespaces.add(b.name.text);
    else for (const el of b.elements) if ((el.propertyName ?? el.name).text === "properties") names.add(el.name.text);
  }
  return { names, namespaces };
}

function writesIn(file: string): number {
  const sf = parseSource(file, fs.readFileSync(file, "utf8"));
  const { names, namespaces } = propertiesTableNames(sf);
  let n = 0;
  const isTable = (e: ts.Expression) =>
    (ts.isIdentifier(e) && names.has(e.text)) ||
    (ts.isPropertyAccessExpression(e) && e.name.text === "properties" && ts.isIdentifier(e.expression) && namespaces.has(e.expression.text));
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const m = node.expression.name.text;
      if ((m === "insert" || m === "update") && node.arguments.length === 1 && isTable(node.arguments[0])) n++;
      else if (REPO_WRITERS.has(m)) n++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

describe("every property writer is classified", () => {
  const sources = listServerSources();
  const found = new Map<string, number>();
  for (const f of sources) {
    const c = writesIn(f);
    if (c > 0) found.set(rel(f), c);
  }

  it("reads the server tree (floors)", () => {
    expect(sources.length).toBeGreaterThan(1000);
    expect([...found.values()].reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(30);
  });

  it("the files that write properties are exactly the classified writers", () => {
    expect([...found.keys()].sort()).toEqual(Object.keys(WRITERS).sort());
  });

  it("every classified writer still writes (vacuity)", () => {
    for (const f of Object.keys(WRITERS)) expect(found.get(f) ?? 0, f).toBeGreaterThan(0);
  });

  it("no direct writer passes a parent reference from outside the handler", () => {
    // A direct writer may name a parent only as its own route parameter
    // (resolved in the organization before the write) or as null.
    for (const [f, w] of Object.entries(WRITERS)) {
      if (w.kind !== "direct") continue;
      const sf = parseSource(f, fs.readFileSync(path.join(REPO_ROOT, f), "utf8"));
      let named = false;
      const visit = (node: ts.Node) => {
        if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && ts.isIdentifier(node.name) && node.name.text === "parentParcelId") {
          const v = ts.isPropertyAssignment(node) ? node.initializer : node.name;
          const ok = v.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(v) && v.text === "parentId");
          if (!ok) named = true;
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      expect(named, `${f} sets parentParcelId from something other than its resolved route parameter`).toBe(false);
    }
  });
});
