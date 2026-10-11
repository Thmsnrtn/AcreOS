/**
 * FAIR-HOUSING GUARD (W5b): the language outreach to a landowner is written in
 * is chosen ONLY by the customer (per lead or per campaign) or from what the
 * owner said — never inferred from a name, surname or place, which is a
 * national-origin proxy (42 U.S.C. §3604).
 *
 * Four proofs, each against the governed behaviour rather than a symbol:
 *   1. Behaviour — leads that differ ONLY in name and place resolve to the
 *      same language; Spanish-surnamed owners in border counties with no
 *      stated preference resolve to English.
 *   2. Reads — the lead adapter touches no field but the two language
 *      columns (a Proxy records every property it reads). An "improvement"
 *      that peeks at lastName or county fails here, however it is spelled.
 *   3. Writers — every `.set({...})` / `.values({...})` that assigns the lead
 *      language columns, anywhere in server/, shared/ and client/src, is in
 *      the one writer file, and that writer's values come from the request
 *      only. The generic lead schemas omit the columns, so a lead create or
 *      update cannot carry one in.
 *   4. Imports — no import target, preset or header heuristic maps a
 *      "language" column (vendors commonly derive it from surname).
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });
import { outreachLanguageForLead } from "../../shared/outreach/outreachLanguage";

// The resolver's inputs, through the one adapter production calls.
const resolveOutreachLanguage = (i: { lead?: { language: string | null; source: string | null } | null; campaignLanguage?: string | null }) =>
  outreachLanguageForLead(i.lead ? { outreachLanguage: i.lead.language, outreachLanguageSource: i.lead.source } : null, { language: i.campaignLanguage ?? null });
import { CSV_IMPORT_TARGET_FIELDS, suggestMapping } from "../../shared/leads/csvImportMapping";
import { IMPORT_FORMAT_PRESETS } from "../../shared/leads/importFormats";

const ROOT = path.resolve(__dirname, "../..");

const PEOPLE = [
  { firstName: "José", lastName: "Hernández", address: "101 Calle Real", city: "Laredo", state: "TX", county: "Webb", zip: "78040", latitude: "27.53", longitude: "-99.48" },
  { firstName: "María", lastName: "García-López", address: "9 Ocean Dr", city: "Miami", state: "FL", county: "Miami-Dade", zip: "33139", latitude: "25.78", longitude: "-80.13" },
  { firstName: "Nguyen", lastName: "Tran", address: "5 Bolsa Ave", city: "Westminster", state: "CA", county: "Orange", zip: "92683", latitude: "33.75", longitude: "-117.99" },
  { firstName: "John", lastName: "Smith", address: "1 Main St", city: "Des Moines", state: "IA", county: "Polk", zip: "50309", latitude: "41.59", longitude: "-93.62" },
  { firstName: "", lastName: "ESTATE OF RAMIREZ", address: "PO Box 1", city: "San Juan", state: "PR", county: "San Juan", zip: "00901", latitude: "18.46", longitude: "-66.1" },
];

describe("1 · behaviour: name and place never change the language", () => {
  it("no stated or chosen language → English, whoever and wherever the owner is", () => {
    for (const p of PEOPLE) {
      expect(outreachLanguageForLead({ ...p, outreachLanguage: null, outreachLanguageSource: null })).toEqual({ language: "en", basis: "default" });
    }
  });

  it("the same stated language resolves identically across names and places", () => {
    const verdicts = PEOPLE.map((p) =>
      outreachLanguageForLead({ ...p, outreachLanguage: "es", outreachLanguageSource: "owner_stated" }),
    );
    expect(new Set(verdicts.map((v) => JSON.stringify(v))).size).toBe(1);
    expect(verdicts[0]).toEqual({ language: "es", basis: "owner_stated" });
  });

  it("only the three lawful sources decide, in order: owner stated > customer per lead > campaign > English", () => {
    expect(resolveOutreachLanguage({ lead: { language: "en", source: "owner_stated" }, campaignLanguage: "es" })).toEqual({ language: "en", basis: "owner_stated" });
    expect(resolveOutreachLanguage({ lead: { language: "es", source: "customer_choice" }, campaignLanguage: "en" })).toEqual({ language: "es", basis: "customer_choice" });
    expect(resolveOutreachLanguage({ lead: null, campaignLanguage: "es" })).toEqual({ language: "es", basis: "campaign" });
    expect(resolveOutreachLanguage({})).toEqual({ language: "en", basis: "default" });
  });

  it("a stored language with no lawful source on it is not honoured", () => {
    expect(resolveOutreachLanguage({ lead: { language: "es", source: "inferred_from_surname" } })).toEqual({ language: "en", basis: "default" });
    expect(resolveOutreachLanguage({ lead: { language: "es", source: null } })).toEqual({ language: "en", basis: "default" });
  });
});

describe("2 · reads: the lead adapter looks at the language columns and nothing else", () => {
  it("every property read on the lead row is a language column", () => {
    for (const p of PEOPLE) {
      const read = new Set<string>();
      const row = new Proxy(
        { ...p, outreachLanguage: null as string | null, outreachLanguageSource: null as string | null, notes: "habla español" },
        {
          get(target, key, recv) {
            if (typeof key === "string") read.add(key);
            return Reflect.get(target, key, recv);
          },
        },
      );
      outreachLanguageForLead(row);
      expect([...read].sort()).toEqual(["outreachLanguage", "outreachLanguageSource"]);
    }
  });
});

// ── 3 · writers ─────────────────────────────────────────────────────────────

const LANGUAGE_COLUMNS = new Set(["outreachLanguage", "outreachLanguageSource", "outreachLanguageSetAt", "outreach_language", "outreach_language_source"]);
/** The one place allowed to WRITE the lead's language columns. */
const WRITER_FILES = new Set(["server/routes-growth.ts"]);

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
}

interface WriteSite {
  file: string;
  /** The enclosing call (`set`, `values`, `push`…) or "object" — any object literal counts. */
  call: string;
  initializers: string[];
}

function languageWrites(file: string): WriteSite[] {
  const src = fs.readFileSync(file, "utf8");
  if (!/outreach_?[Ll]anguage/.test(src)) return [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: WriteSite[] = [];
  const visit = (n: ts.Node) => {
    // EVERY object literal, not only `.set()` / `.values()` arguments: a row
    // built into an array and inserted later (`toInsert.push({...})`) is a
    // write all the same. Three shapes are not writes and are skipped by what
    // they ARE, not where they sit: a select projection whose value is the
    // column itself (`outreachLanguage: leads.outreachLanguage`), the
    // schema's `.omit({ outreachLanguage: true })`, and the pgTable column definition.
    if (ts.isObjectLiteralExpression(n)) {
      const hits = n.properties.filter(
        (p): p is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
          (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && LANGUAGE_COLUMNS.has(p.name.getText(sf).replace(/["']/g, "")),
      );
      const writes = hits.filter((h) => {
        if (!ts.isPropertyAssignment(h)) return true;
        const init = h.initializer.getText(sf);
        if (/^leads\.outreachLanguage(Source|SetAt)?$/.test(init)) return false; // a read projection
        if (/^(text|timestamp)\("outreach_language/.test(init)) return false; // the column definition
        if (init === "true" && /\.omit\(\s*$/.test(src.slice(0, n.getStart(sf)))) return false; // the schema omit
        return true;
      });
      if (writes.length) {
        const parent = n.parent;
        const call =
          ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) ? parent.expression.name.text : "object";
        out.push({
          file: path.relative(ROOT, file),
          call,
          initializers: writes.map((h) => (ts.isPropertyAssignment(h) ? h.initializer.getText(sf) : h.name.getText(sf))),
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("3 · writers: one writer, fed only by the request", () => {
  const files: string[] = [];
  for (const d of ["server", "shared", "client/src"]) walk(path.join(ROOT, d), files);
  const writes = files.flatMap(languageWrites);

  it("the scan read the source tree (vacuity floor)", () => {
    expect(files.length).toBeGreaterThan(1500);
    expect(files.some((f) => f.endsWith(path.join("server", "routes-growth.ts")))).toBe(true);
  });

  it("the writer is found (a parser that stops matching reads as 'no writers')", () => {
    expect(writes.filter((w) => WRITER_FILES.has(w.file)).length).toBeGreaterThan(0);
  });

  it("no other file writes the lead's language columns", () => {
    const strays = writes.filter((w) => !WRITER_FILES.has(w.file));
    expect(strays, JSON.stringify(strays, null, 2)).toEqual([]);
  });

  it("the writer's values come from the parsed request, never from the lead's name or place", () => {
    const FORBIDDEN = /\b(firstName|lastName|ownerName|address|city|county|state|zip|latitude|longitude|propertyAddress|surname|lead\.|existing\.)\b/;
    for (const w of writes.filter((x) => WRITER_FILES.has(x.file))) {
      for (const init of w.initializers) expect(init, `${w.file}: ${init}`).not.toMatch(FORBIDDEN);
    }
  });

  it("the generic lead create/update schema cannot carry a language in", async () => {
    const { insertLeadSchema } = await import("../../shared/schema");
    const parsed = insertLeadSchema.partial().parse({
      lastName: "Hernández",
      outreachLanguage: "es",
      outreachLanguageSource: "owner_stated",
    } as Record<string, unknown>) as Record<string, unknown>;
    expect(parsed.outreachLanguage).toBeUndefined();
    expect(parsed.outreachLanguageSource).toBeUndefined();
  });
}, REPO_SWEEP_TIMEOUT_MS);

// ── 3b · writers whose payload is built elsewhere ───────────────────────────
//
// The object-literal scan above sees a write only when the column is NAMED at
// the write site. A payload assembled from arbitrary keys — a workflow's
// `update_record` action passes `config.updates` (any keys, trigger
// conditionable on county) into storage.updateLead — never names the column
// and so was invisible to it (W5b audit). The population of such writers is
// enumerated here: every `.update(leads).set(X)` / `.insert(leads).values(X)`
// in server/ whose X is not a closed object literal. A new one fails until it
// is read and registered; the repository's own must route through the
// language strip, and that strip is exercised against the real repository.

/** file → number of open-payload lead writes, each read and found to build its payload from a closed key set. */
const OPEN_PAYLOAD_LEAD_WRITERS: Record<string, { count: number; why: string }> = {
  "server/storage/leadRepo.ts": { count: 4, why: "createLead/createLeadsBatch via leadInsertRow, updateLead/bulkUpdateLeads via leadUpdatePayload — both strip the language keys (asserted below)" },
  "server/api-v1/leads.ts": { count: 2, why: "mapCreateInput / mapUpdateInput copy a fixed list of snake_case fields; no language field" },
  "server/routes-bulk.ts": { count: 1, why: "allowedUpdates = status / assignedTo / tags only" },
  "server/routes-leads.ts": { count: 1, why: "csv-import row: explicit fields plus a DNC-flag spread of fixed keys" },
  "server/services/leadEnrichment.ts": { count: 1, why: "parcelCols: propertyAddress / county / apn copied from the linked property" },
  "server/services/onboardingEnhancements.ts": { count: 1, why: "fixed sample fixtures" },
  "server/services/taxDelinquentPipeline.ts": { count: 1, why: "chunk of object literals built in the same file (covered by the literal scan)" },
  "server/services/voiceCallAI.ts": { count: 1, why: "updateData = status / tags / updatedAt only" },
  "server/storage/auditRepo.ts": { count: 1, why: "consent fields built in updateLeadConsent" },
};

function openPayloadLeadWrites(file: string): Array<{ file: string; arg: string }> {
  const src = fs.readFileSync(file, "utf8");
  if (!/\.(update|insert)\(\s*leads\s*\)/.test(src)) return [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Array<{ file: string; arg: string }> = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      (n.expression.name.text === "update" || n.expression.name.text === "insert") &&
      n.arguments.length === 1 &&
      n.arguments[0].getText(sf) === "leads"
    ) {
      let p: ts.Node = n;
      let target: ts.CallExpression | null = null;
      while (p.parent && !ts.isStatement(p)) {
        p = p.parent;
        if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && (p.expression.name.text === "set" || p.expression.name.text === "values")) {
          target = p;
          break;
        }
      }
      // A write whose payload call can't be located is COUNTED, never skipped.
      const arg = target?.arguments[0];
      let inner: ts.Expression | undefined = arg;
      while (inner && (ts.isAsExpression(inner) || ts.isParenthesizedExpression(inner))) inner = inner.expression;
      const closed = !!inner && ts.isObjectLiteralExpression(inner) && !inner.properties.some((q) => ts.isSpreadAssignment(q));
      if (!closed) out.push({ file: path.relative(ROOT, file), arg: arg ? arg.getText(sf) : "<payload not located>" });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("3b · writers whose payload is built elsewhere cannot carry a language", () => {
  const files: string[] = [];
  walk(path.join(ROOT, "server"), files);
  const open = files.flatMap(openPayloadLeadWrites);

  it("every open-payload lead writer in server/ is registered, with its exact count", () => {
    const counts: Record<string, number> = {};
    for (const w of open) counts[w.file] = (counts[w.file] ?? 0) + 1;
    const expected = Object.fromEntries(Object.entries(OPEN_PAYLOAD_LEAD_WRITERS).map(([f, v]) => [f, v.count]));
    expect(counts, JSON.stringify(open, null, 2)).toEqual(expected);
  });

  it("the repository's open writes all pass through the language strip", () => {
    const repo = open.filter((w) => w.file === "server/storage/leadRepo.ts");
    expect(repo.length).toBe(4);
    for (const w of repo) expect(w.arg, w.arg).toMatch(/\b(leadInsertRow|leadUpdatePayload)\(/);
  });

  it("the real repository drops a language from every create and update (a workflow's update_record lands here)", async () => {
    const captured: unknown[] = [];
    vi.doMock("../../server/db", () => {
      const chain = (rows: unknown) => ({ where: () => chain(rows), returning: async () => rows, then: (r: (v: unknown) => unknown) => r(rows) });
      return {
        db: {
          update: () => ({ set: (p: unknown) => { captured.push(p); return chain([{ id: 1 }]); } }),
          insert: () => ({ values: (v: unknown) => { captured.push(v); const rows = (Array.isArray(v) ? v : [v]).map((r, i) => ({ ...(r as object), id: i + 1 })); return { returning: async () => rows, then: (r: (x: unknown) => unknown) => r(rows) }; } }),
        },
      };
    });
    const { leadRepo } = await import("../../server/storage/leadRepo");
    const self = { logActivity: async () => undefined } as never;
    const lang = { outreachLanguage: "es", outreachLanguageSource: "owner_stated", outreachLanguageSetAt: new Date() };
    await leadRepo.updateLead.call(self, 1, { status: "contacted", ...lang } as never, 9);
    await leadRepo.bulkUpdateLeads.call(self, 9, [1, 2], { tags: ["x"], ...lang } as never);
    await leadRepo.createLead.call(self, { organizationId: 9, type: "seller", firstName: "José", lastName: "Hernández", ...lang } as never);
    await leadRepo.createLeadsBatch.call(self, [{ organizationId: 9, type: "seller", firstName: "A", lastName: "B", ...lang }] as never);
    vi.doUnmock("../../server/db");
    const rows = captured.flatMap((c) => (Array.isArray(c) ? c : [c])) as Array<Record<string, unknown>>;
    const leadRows = rows.filter((r) => "status" in r || "tags" in r || "firstName" in r);
    expect(leadRows.length).toBe(4);
    for (const r of leadRows) {
      expect(r.outreachLanguage).toBeUndefined();
      expect(r.outreachLanguageSource).toBeUndefined();
      expect(r.outreachLanguageSetAt).toBeUndefined();
    }
  });
}, REPO_SWEEP_TIMEOUT_MS);

describe("4 · imports never map a language column", () => {
  it("no import target is a language", () => {
    expect(CSV_IMPORT_TARGET_FIELDS.map((f) => `${f.id} ${f.label}`).join(" ")).not.toMatch(/lang|idioma|ethnic/i);
  });
  it("the header heuristic skips language columns", () => {
    const m = suggestMapping(["Owner Name", "Language", "Preferred Language", "Lang", "Idioma", "Ethnicity Code"]);
    for (const h of ["Language", "Preferred Language", "Lang", "Idioma", "Ethnicity Code"]) expect(m[h], h).toBe("skip");
  });
  it("no verified preset maps one", () => {
    for (const p of IMPORT_FORMAT_PRESETS) {
      for (const k of Object.keys(p.columns)) expect(k, `${p.id}.${k}`).not.toMatch(/lang|idioma|ethnic/i);
    }
  });
  it("the importer source does not reference the language columns", () => {
    for (const f of ["server/services/importExport.ts", "server/routes-leads.ts", "server/services/migrationJobs.ts", "shared/leads/csvImportMapping.ts"]) {
      const src = stripComments(fs.readFileSync(path.join(ROOT, f), "utf8"));
      expect(src, f).not.toMatch(/outreachLanguage|outreach_language/);
    }
  });
});
