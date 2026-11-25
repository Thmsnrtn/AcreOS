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
 *
 * A direct writer is then read for every write shape that could carry a
 * parent reference into its update: object key (any spelling), shorthand,
 * property or element assignment, Object.assign, and any .set()/.values()
 * payload or spread that does not trace to a literal the file builds. One
 * canary fixture per shape pins that the walker still reads it.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { REPO_ROOT, listServerSources, parseSource, rel } from "../helpers/serverPopulation";

type Kind = "repository" | "via-repository" | "direct";

const WRITERS: Record<string, { kind: Kind; note: string }> = {
  "server/storage/propertyRepo.ts": { kind: "repository", note: "createProperty / updateProperty / bulkUpdateProperties resolve the parent in the organization" },
  "server/storage/dealRepo.ts": { kind: "direct", note: "deal close marks the parcel owned — status only, org-scoped conditional update; never names a parent (writer landed via #625, after #500's base; classified at bring-current)" },
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

const PARENT = "parentParcelId";

function unwrap(e: ts.Expression): ts.Expression {
  while (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) e = e.expression;
  return e;
}

function keyText(n: ts.PropertyName | ts.Expression): string | null {
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isComputedPropertyName(n)) return keyText(n.expression);
  return null;
}

/** A parent value a direct writer may write: null, or its resolved route parameter. */
function permittedParentValue(v: ts.Expression): boolean {
  const u = unwrap(v);
  return u.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(u) && u.text === "parentId");
}

/** The closest declaration of `name` in scope at `at`, by walking enclosing blocks. */
function declarationOf(name: string, at: ts.Node): ts.VariableDeclaration | undefined {
  for (let scope: ts.Node | undefined = at.parent; scope; scope = scope.parent) {
    if (!(ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope))) continue;
    let found: ts.VariableDeclaration | undefined;
    for (const st of scope.statements) {
      if (!ts.isVariableStatement(st) || st.pos > at.pos) continue;
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name) found = d;
    }
    if (found) return found;
  }
  return undefined;
}

/**
 * Reads every properties write in a direct writer and reports each way a
 * parent reference could reach it from outside the handler:
 *   - an object key (identifier, string literal or computed) or shorthand
 *     named parentParcelId whose value is not null / the route parameter;
 *   - an assignment to `x.parentParcelId` or `x["parentParcelId"]`;
 *   - a computed-key assignment or Object.assign into a write payload;
 *   - a .set()/.values() payload, or a spread inside one, that does not
 *     trace to an object literal the file builds (identifier, cast, .map()
 *     callback and array literal are followed).
 * A write whose payload cannot be located is COUNTED (located < writes),
 * never skipped.
 */
function directWriterViolations(fileName: string, text: string): { writes: number; located: number; violations: string[] } {
  const sf = parseSource(fileName, text);
  const { names, namespaces } = propertiesTableNames(sf);
  const isTable = (e: ts.Expression) =>
    (ts.isIdentifier(e) && names.has(e.text)) ||
    (ts.isPropertyAccessExpression(e) && e.name.text === "properties" && ts.isIdentifier(e.expression) && namespaces.has(e.expression.text));
  const violations: string[] = [];
  const at = (n: ts.Node) => `${fileName}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const payloadIds = new Set<string>();
  let writes = 0;
  let located = 0;

  // Does `e` trace to object literal(s) the file builds? Records spreads and
  // payload identifiers on the way.
  const traces = (e: ts.Expression, site: ts.Node, depth = 0): boolean => {
    const u = unwrap(e);
    if (depth > 6) return false;
    if (ts.isObjectLiteralExpression(u)) {
      let ok = true;
      for (const p of u.properties) {
        if (ts.isSpreadAssignment(p) && !traces(p.expression, site, depth + 1)) {
          violations.push(`${at(p)} spreads a value that does not trace to a literal into a properties write`);
          ok = false;
        }
      }
      return ok;
    }
    if (ts.isArrayLiteralExpression(u)) return u.elements.every((el) => traces(el as ts.Expression, site, depth + 1));
    if (ts.isIdentifier(u)) {
      const d = declarationOf(u.text, site);
      if (!d?.initializer) return false;
      payloadIds.add(u.text);
      return traces(d.initializer, d, depth + 1);
    }
    if (ts.isCallExpression(u) && ts.isPropertyAccessExpression(u.expression) && u.expression.name.text === "map" && u.arguments.length >= 1) {
      const cb = u.arguments[0];
      if (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) {
        if (!ts.isBlock(cb.body)) return traces(cb.body, cb.body, depth + 1);
        const rets: ts.ReturnStatement[] = [];
        const findRet = (n: ts.Node) => { if (ts.isReturnStatement(n)) rets.push(n); else if (!ts.isFunctionLike(n)) ts.forEachChild(n, findRet); };
        findRet(cb.body);
        return rets.length > 0 && rets.every((r) => !!r.expression && traces(r.expression, r, depth + 1));
      }
    }
    return false;
  };

  const visit = (node: ts.Node) => {
    // Writes and their payloads.
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const m = node.expression.name.text;
      if ((m === "insert" || m === "update") && node.arguments.length === 1 && isTable(node.arguments[0])) {
        writes++;
        const acc = node.parent;
        const call = acc?.parent;
        const want = m === "insert" ? "values" : "set";
        if (acc && ts.isPropertyAccessExpression(acc) && acc.name.text === want && call && ts.isCallExpression(call) && call.expression === acc && call.arguments.length >= 1) {
          located++;
          if (!traces(call.arguments[0], call)) violations.push(`${at(call)} passes a .${want}() payload that does not trace to an object literal`);
        }
      }
    }
    // Object keys named parentParcelId.
    if (ts.isPropertyAssignment(node) && keyText(node.name) === PARENT && !permittedParentValue(node.initializer)) {
      violations.push(`${at(node)} sets ${PARENT} from something other than null or the resolved route parameter`);
    }
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === PARENT) {
      violations.push(`${at(node)} sets ${PARENT} by shorthand from a local value`);
    }
    // Assignments.
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const l = node.left;
      if (ts.isPropertyAccessExpression(l) && l.name.text === PARENT && !permittedParentValue(node.right)) {
        violations.push(`${at(node)} assigns ${PARENT}`);
      }
      if (ts.isElementAccessExpression(l)) {
        const a = unwrap(l.argumentExpression);
        const k = ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) ? a.text : null;
        if (k === PARENT && !permittedParentValue(node.right)) violations.push(`${at(node)} assigns ${PARENT} by element access`);
        if (k === null) pendingComputed.push(l);
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "assign" &&
        ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Object") {
      pendingAssign.push(node);
    }
    ts.forEachChild(node, visit);
  };
  const pendingComputed: ts.ElementAccessExpression[] = [];
  const pendingAssign: ts.CallExpression[] = [];
  visit(sf);
  // These two need the full set of payload identifiers, known only after the walk.
  for (const l of pendingComputed) {
    const target = unwrap(l.expression);
    if (ts.isIdentifier(target) && payloadIds.has(target.text)) violations.push(`${at(l)} writes a computed key into a properties write payload`);
  }
  for (const c of pendingAssign) {
    const target = c.arguments[0] && unwrap(c.arguments[0]);
    if (target && ts.isIdentifier(target) && payloadIds.has(target.text)) violations.push(`${at(c)} Object.assigns into a properties write payload`);
  }
  return { writes, located, violations };
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

  it("no direct writer can carry a parent reference from outside the handler, in any write shape", () => {
    // A direct writer may name a parent only as its own route parameter
    // (resolved in the organization before the write) or as null; and every
    // payload it hands to a properties write must trace to an object literal
    // it builds itself, so nothing from the request rides in unread.
    for (const [f, w] of Object.entries(WRITERS)) {
      if (w.kind !== "direct") continue;
      const r = directWriterViolations(f, fs.readFileSync(path.join(REPO_ROOT, f), "utf8"));
      expect(r.writes, `${f}: no properties write found (vacuity)`).toBeGreaterThan(0);
      expect(r.located, `${f}: a properties write whose .set()/.values() payload could not be located`).toBe(r.writes);
      expect(r.violations, f).toEqual([]);
    }
  });

  describe("canaries: each write shape the walker relies on goes red when it carries a parent from the request", () => {
    const head = `import { properties } from "@shared/schema";\nimport { db } from "./db";\n`;
    const wrap = (body: string) => `${head}export async function h(req: any, parsed: any, parentId: number, orgId: number) {\n${body}\n}\n`;
    const RED: Record<string, string> = {
      "object key": `await db.update(properties).set({ parentParcelId: req.body.parentParcelId });`,
      "string-literal key": `await db.update(properties).set({ "parentParcelId": req.body.p });`,
      "shorthand key": `const parentParcelId = req.body.p;\nawait db.insert(properties).values({ organizationId: orgId, parentParcelId });`,
      "property assignment": `const updates: Record<string, unknown> = {};\nif (req.body.p !== undefined) updates.parentParcelId = req.body.p;\nawait db.update(properties).set(updates);`,
      "element assignment, literal key": `const updates: Record<string, unknown> = {};\nupdates["parentParcelId"] = req.body.p;\nawait db.update(properties).set(updates);`,
      "element assignment, computed key": `const updates: Record<string, unknown> = {};\nfor (const k of Object.keys(req.body)) updates[k] = req.body[k];\nawait db.update(properties).set(updates);`,
      "Object.assign into the payload": `const updates: Record<string, unknown> = {};\nObject.assign(updates, parsed.data);\nawait db.update(properties).set(updates);`,
      "spread of a validated body in .set()": `await db.update(properties).set({ ...parsed.data, updatedAt: new Date() });`,
      "spread of a validated body in .values()": `await db.insert(properties).values({ organizationId: orgId, ...parsed.data });`,
      "validated body passed whole": `await db.update(properties).set(parsed.data);`,
      "request body passed whole, behind a cast": `await db.update(properties).set(req.body as any);`,
      "identifier traced to the body": `const payload = parsed.data;\nawait db.update(properties).set(payload);`,
      "mapped rows spreading the body": `const rows = req.body.lots.map((l: any) => ({ organizationId: orgId, ...l }));\nawait db.insert(properties).values(rows);`,
      "write whose payload is out of the chain": `const q = db.update(properties);\nawait q.set({ status: "owned" });`,
    };
    const GREEN: Record<string, string> = {
      "allow-list assignment of other fields": `const updates: Record<string, unknown> = {};\nif (req.body.status) updates.status = req.body.status;\nawait db.update(properties).set(updates);`,
      "resolved route parameter in mapped rows": `const rows = req.body.lots.map((l: any) => ({ organizationId: orgId, parentParcelId: parentId, apn: l.apn }));\nawait db.insert(properties).values(rows);`,
      "detach to null": `await db.update(properties).set({ parentParcelId: null, updatedAt: new Date() });`,
      "literal behind a cast, spread of a local literal": `const base = { status: "owned" };\nawait db.update(properties).set({ ...base, aiInsights: 1 } as any);`,
      "array of literals": `await db.insert(properties).values([{ organizationId: orgId, apn: "a" }]);`,
    };
    for (const [shape, body] of Object.entries(RED)) {
      it(`red: ${shape}`, () => {
        const r = directWriterViolations("canary.ts", wrap(body));
        expect(r.writes, "the canary's write was not found").toBe(1);
        expect(r.violations.length + (r.writes - r.located), shape).toBeGreaterThan(0);
      });
    }
    for (const [shape, body] of Object.entries(GREEN)) {
      it(`green: ${shape}`, () => {
        const r = directWriterViolations("canary.ts", wrap(body));
        expect(r.writes, "the canary's write was not found").toBe(1);
        expect(r.located).toBe(1);
        expect(r.violations).toEqual([]);
      });
    }
  });
});
