/**
 * Imports never grant consent. Neither does a client that NAMES an import.
 *
 * Doctrine (constitution `imports-never-grant-consent`): a list — a CSV, a
 * migration, a vendor file — is not the lead's own express opt-in. The merged
 * money-compliance work still let a client name "imported" as a grant source
 * (`consentStamp.ts` CLIENT_GRANT_SOURCES), and the batch-import insert stamped
 * any row carrying `tcpaConsent: true` as a grant with source "imported".
 *
 * The gate is behavioural at every chokepoint a grant can pass through:
 *   - the consent stamp (insert and update), for every list-level spelling;
 *   - the batch insert that every import uses (leadRepo.createLeadsBatch), fed
 *     rows that claim consent with EVERY source string, express ones included;
 *   - the import service's per-row fallback (taken when a batch fails);
 *   - the consent PATCH's storage method (auditRepo.updateLeadConsent).
 * And structurally over the population: every caller of the batch insert is
 * an import (enumerated, with a floor), and no server object literal names a
 * list-level consent source.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import ts from "typescript";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const H = vi.hoisted(() => ({
  inserted: [] as any[],
  updated: [] as any[],
  storageCreates: [] as any[],
  batchFails: false,
}));

vi.mock("../../server/db", () => {
  const returning = async () => H.inserted.map((r, i) => ({ id: i + 1, ...r }));
  return {
    db: {
      insert: () => ({
        values: (v: any) => {
          H.inserted.push(...(Array.isArray(v) ? v : [v]));
          return { returning, onConflictDoNothing: () => ({ returning }) };
        },
      }),
      update: () => ({
        set: (v: any) => {
          H.updated.push(v);
          return { where: () => ({ returning: async () => [{ id: 1, ...v }] }) };
        },
      }),
      select: () => ({ from: () => ({ where: async () => [] }) }),
    },
  };
});
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/storage", () => ({
  storage: {
    findDuplicateLeads: vi.fn(async () => []),
    getTeamMemberByEmail: vi.fn(async () => null),
    createLeadsBatch: vi.fn(async (rows: any[]) => {
      if (H.batchFails) throw new Error("batch failed");
      H.storageCreates.push(...rows);
      return rows.map((r, i) => ({ id: 100 + i, ...r }));
    }),
    createLead: vi.fn(async (r: any) => {
      // The real createLead runs the insert stamp; reproduce it exactly.
      const { stampConsentForInsert, DEFAULT_GRANT_SOURCE } = await import("../../server/services/consentStamp");
      const row = stampConsentForInsert(r, DEFAULT_GRANT_SOURCE);
      H.storageCreates.push(row);
      return { id: 99, ...row };
    }),
  },
}));
vi.mock("../../server/services/leadEvents", () => ({ emitLeadCreated: vi.fn(), emitLeadCreatedDurably: vi.fn() }));

import {
  LIST_LEVEL_SOURCES,
  stampConsentForInsert,
  stampConsentForUpdate,
  stripConsentForImport,
  DEFAULT_GRANT_SOURCE,
} from "../../server/services/consentStamp";

const ROOT = path.resolve(__dirname, "../..");

// Every spelling a caller could use for a list-level grant: the canonical set
// plus the case/whitespace variants a normaliser must not let through.
const LIST_SPELLINGS = [...LIST_LEVEL_SOURCES].flatMap((s) => [s, s.toUpperCase(), ` ${s} `]);
// Every source string a row might carry — list-level AND express. An import
// grants with NONE of them.
const ALL_SOURCES = [
  ...LIST_SPELLINGS,
  "website", "phone_ivr", "written", "admin_manual", "manual", "sms_double_optin", "verbal", undefined, null, "",
];

beforeEach(() => {
  H.inserted.length = 0;
  H.updated.length = 0;
  H.storageCreates.length = 0;
  H.batchFails = false;
});

describe("the consent stamp refuses a grant that names a list", () => {
  it("the list-level vocabulary is non-trivial and includes 'imported'", () => {
    expect(LIST_LEVEL_SOURCES.has("imported")).toBe(true);
    expect(LIST_LEVEL_SOURCES.size).toBeGreaterThanOrEqual(5);
  });

  it.each(LIST_SPELLINGS)("insert: %j carries no grant at all (not a downgraded one)", (src) => {
    const row: any = stampConsentForInsert({ tcpaConsent: true, consentSource: src, firstName: "A" }, DEFAULT_GRANT_SOURCE);
    expect(row.tcpaConsent).toBeUndefined();
    expect(row.consentDate).toBeUndefined();
    expect(row.consentSource).toBeUndefined();
    expect(row.firstName).toBe("A");
  });

  it.each(LIST_SPELLINGS)("update: %j carries no grant at all", (src) => {
    const row: any = stampConsentForUpdate({ tcpaConsent: true, consentSource: src }, DEFAULT_GRANT_SOURCE);
    expect(row.tcpaConsent).toBeUndefined();
    expect(row.consentDate).toBeUndefined();
    expect(row.consentSource).toBeUndefined();
  });

  it("control: an express source still grants (the refusal is not a blanket no)", () => {
    const row: any = stampConsentForInsert({ tcpaConsent: true, consentSource: "written" }, DEFAULT_GRANT_SOURCE);
    expect(row.tcpaConsent).toBe(true);
    expect(row.consentSource).toBe("written");
    expect(row.consentDate).toBeInstanceOf(Date);
  });

  it("stripConsentForImport drops every consent field and keeps do-not-contact", () => {
    const row: any = stripConsentForImport({ tcpaConsent: true, consentDate: new Date(0), consentSource: "website", doNotContact: true });
    expect(row).toEqual({ doNotContact: true });
  });
});

describe("the batch insert every import uses grants nothing, whatever the row claims", () => {
  it.each(ALL_SOURCES)("source %j", async (src) => {
    const { leadRepo } = await import("../../server/storage/leadRepo");
    const self: any = { logActivity: async () => undefined, createActivityLogBatch: async () => undefined };
    self.createAuditLogsBatch = async () => undefined;
    await (leadRepo.createLeadsBatch as any).call(
      new Proxy(self, { get: (t, p) => (p in t ? t[p] : async () => undefined) }),
      [{ organizationId: 7, firstName: "A", lastName: "B", type: "seller", status: "new", tcpaConsent: true, consentSource: src, consentDate: new Date(0) }],
    );
    expect(H.inserted.length).toBeGreaterThan(0);
    for (const row of H.inserted) {
      expect(row.tcpaConsent).not.toBe(true);
      expect(row.consentDate).toBeUndefined();
      expect(row.consentSource).toBeUndefined();
    }
  });
});

describe("the import service's per-row fallback grants nothing either", () => {
  it("a failed batch falls back row by row, and no row is consented", async () => {
    H.batchFails = true;
    const { importLeads } = await import("../../server/services/importExport");
    const res: any = await importLeads(
      [{ firstName: "Bo", lastName: "Ray", tcpa_consent: "yes", consent_source: "website" }],
      7,
      { fieldMap: { tcpa_consent: "tcpaConsent", consent_source: "consentSource" } } as any,
    );
    expect(res.successCount).toBe(1);
    expect(H.storageCreates).toHaveLength(1);
    expect(H.storageCreates[0].tcpaConsent).not.toBe(true);
    expect(H.storageCreates[0].consentSource).toBeUndefined();
  });
});

describe("the consent PATCH's storage method refuses a list-level grant", () => {
  it.each(["imported", "list_vendor"])("%s throws and writes nothing", async (src) => {
    const { auditRepo } = await import("../../server/storage/auditRepo");
    await expect((auditRepo as any).updateLeadConsent.call({}, 1, { tcpaConsent: true, consentSource: src }, 7)).rejects.toThrow(/list-level/);
    expect(H.updated).toHaveLength(0);
  });
});

describe("population: every import path is the batch insert, and nothing names a list-level grant", () => {
  const files = execSync("git ls-files server shared", { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

  // The callers of the batch insert, all of which are imports. A new caller
  // must be added here deliberately — and is then covered by the behavioural
  // batch test above, because the strip lives in the batch insert itself.
  const BATCH_CALLERS = ["server/routes-leads.ts", "server/services/importExport.ts"];

  it("reads the server and shared trees (floor)", () => {
    expect(files.length).toBeGreaterThan(1500);
  });

  it("the batch insert's callers are exactly the enumerated imports", () => {
    const callers = files.filter((f) => /\.createLeadsBatch\(/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
    expect(callers.sort()).toEqual([...BATCH_CALLERS].sort());
  });

  /** Object-literal properties `consentSource` / `source` whose value is a list-level string literal. */
  function listLevelGrants(file: string, text: string): string[] {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const out: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "consentSource") {
        const v = n.initializer;
        if (ts.isStringLiteralLike(v) && LIST_LEVEL_SOURCES.has(v.text.trim().toLowerCase())) {
          out.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} consentSource: "${v.text}"`);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  }

  it("canary: the walker sees a list-level consentSource literal (and ignores comments)", () => {
    expect(listLevelGrants("f.ts", `const a = { consentSource: "imported" };`)).toHaveLength(1);
    expect(listLevelGrants("f.ts", `const a = { consentSource: "Imported " };`)).toHaveLength(1);
    expect(listLevelGrants("f.ts", `// consentSource: "imported"\nconst a = { consentSource: "website" };`)).toHaveLength(0);
  });

  it("no server or shared object literal names a list-level consent source", () => {
    const found = files.flatMap((f) => listLevelGrants(f, fs.readFileSync(path.join(ROOT, f), "utf8")));
    expect(found, found.join("\n")).toEqual([]);
  });
});
