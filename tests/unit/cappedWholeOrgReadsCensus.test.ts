/**
 * No production caller computes a total, a claim or an action from the newest
 * 5,000 rows (DEFECT-0171, W10.2b).
 *
 * `storage.getLeads / getProperties / getDeals / getNotes` read an org's rows
 * newest-first and stop at LIST_READ_CAP (5,000), logging when they truncate
 * (server/storage/listCap.ts). That is honest for a screen that shows "your
 * newest rows". It is wrong for anything that COUNTS, SUMS, CLAIMS "every lead
 * already has…", or ACTS on the set: past 5,000 rows the oldest records are
 * silently missing from the answer. The census holds every production call to
 * those four getters to one of:
 *   - an SQL aggregate (server/storage/bookAggregates.ts, getDashboardStats,
 *     getLeadCount, getActiveNotesValue, getPipelineValue), a whole-book read
 *     (server/storage/wholeBookReads.ts), a paginated/cursor read, or a by-id
 *     lookup — in which case the call is gone;
 *   - or the register below, which names each file's remaining calls (by
 *     COUNT, so a new call in a registered file still fails) and why showing or
 *     using only the newest rows is the honest behaviour there.
 *
 * Population: every production .ts under server/, comment-stripped. The call
 * shape is receiver-agnostic — `x.getLeads(`, `x?.getLeads(`, `x.getLeads?.(`,
 * `x["getLeads"](`, `x.getLeads.call(`, and a destructured `{ getLeads } =` —
 * because the audit of the first draft (which named `storage.` / `this.`)
 * found every one of those spellings walked past it. A call on a receiver
 * that is NOT the capped storage getter is named in OTHER_RECEIVERS.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

/**
 * Any member REFERENCE to one of the four names — a call, `?.`, `!.`,
 * `["getLeads"]`, `.call/.apply/.bind`, or a detached `const read =
 * storage.getLeads` — not getLeadsPaginated, getLeadsByIds, etc. Counting
 * references rather than calls is what closes the detached-method and
 * `Reflect.apply(storage.getNotes, …)` spellings (W10.2b re-audit). Group 1
 * is the receiver's last identifier when there is one; group 2 the getter.
 */
const CAPPED_CALL =
  /(\w*)\s*(?:\?\.|!?\.|\[\s*["'`])\s*(getLeads|getProperties|getDeals|getNotes)(?:["'`]\s*\])?(?![\w$])/g;
/** `const { getLeads } = storage`, `const { getLeads }: Pick<…> = …`, `({ getDeals }: IStorage) =>`. */
const DESTRUCTURED = /\{[^{}]*\b(getLeads|getProperties|getDeals|getNotes)\b[^{}]*\}\s*[:=]/g;

/** Receivers whose method merely shares a name with a capped getter. */
const OTHER_RECEIVERS: Readonly<Record<string, string>> = {
  taxDelinquentPipeline:
    "the tax-delinquent pipeline's own paginated getLeads({ organizationId, limit ≤ 200, page }), not the storage getter",
  colsArg: "ts-morph's ObjectLiteralExpression.getProperties() in the schema drift detector — an AST call, not a read",
};

/** file → { calls, reason }. Filled from the W10.2b builders' reports. */
const NEWEST_ROWS_BY_DESIGN: Readonly<Record<string, { calls: number; reason: string }>> = {
  "server/routes-finance.ts": {
    calls: 1,
    reason:
      "GET /api/notes is the notes table's newest-first row payload. Book-wide note figures come from " +
      "GET /api/notes/book-figures (SQL over every active note) and the finance summaries (DEFECT-0170); the " +
      "client surfaces that once summed this list are pinned to the book figures by noteBookFigures.test.ts.",
  },
};

function serverFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.name.endsWith(".ts") && !e.name.includes(".test.") && !e.name.endsWith(".d.ts")) out.push(child);
    }
  };
  walk("server");
  return out;
}

function cappedCalls(src: string): string[] {
  return [
    ...[...src.matchAll(CAPPED_CALL)].filter((m) => !Object.hasOwn(OTHER_RECEIVERS, m[1])).map((m) => m[2]),
    ...[...src.matchAll(DESTRUCTURED)].map((m) => m[1]),
  ];
}

const counts = new Map<string, number>();
const receiversSeen = new Set<string>();
for (const file of serverFiles()) {
  const src = stripComments(fs.readFileSync(path.join(ROOT, file), "utf8"));
  for (const m of src.matchAll(CAPPED_CALL)) if (Object.hasOwn(OTHER_RECEIVERS, m[1])) receiversSeen.add(m[1]);
  const n = cappedCalls(src).length;
  if (n > 0) counts.set(file, n);
}

describe("capped whole-org reads", () => {
  it("vacuity: the getters exist and the population is the server", () => {
    const cap = fs.readFileSync(path.join(ROOT, "server/storage/listCap.ts"), "utf8");
    expect(cap).toMatch(/LIST_READ_CAP = 5000/);
    for (const repo of ["leadRepo", "propertyRepo", "dealRepo", "noteRepo"]) {
      expect(fs.readFileSync(path.join(ROOT, `server/storage/${repo}.ts`), "utf8")).toMatch(/capListRead\(/);
    }
  });

  it("no unregistered caller computes from the newest 5,000 rows", () => {
    const offenders = [...counts.entries()]
      .filter(([file, n]) => n > (NEWEST_ROWS_BY_DESIGN[file]?.calls ?? 0))
      .map(([file, n]) => `${file}: ${n} call(s), ${NEWEST_ROWS_BY_DESIGN[file]?.calls ?? 0} registered`);
    expect(
      offenders,
      "a production caller reads a capped whole-org list. Replace it with an SQL aggregate, a whole-book or " +
        "paginated read, or a by-id lookup — or register the file with why the newest rows are the honest answer.",
    ).toEqual([]);
  });

  it("the register only shrinks: a registered count above the real one is stale headroom", () => {
    const stale = Object.entries(NEWEST_ROWS_BY_DESIGN)
      .filter(([file, r]) => (counts.get(file) ?? 0) < r.calls)
      .map(([file, r]) => `${file}: registered ${r.calls}, now ${counts.get(file) ?? 0}`);
    expect(stale).toEqual([]);
    for (const [file, r] of Object.entries(NEWEST_ROWS_BY_DESIGN)) expect(r.reason.length, file).toBeGreaterThan(30);
  });

  it("every other-receiver exemption still names a live call", () => {
    for (const [receiver, reason] of Object.entries(OTHER_RECEIVERS)) {
      expect(receiversSeen.has(receiver), `${receiver} no longer calls a same-named method — remove its entry`).toBe(true);
      expect(reason.length, receiver).toBeGreaterThan(30);
    }
  });

  it("canary: the pattern sees the getters and not their whole-book siblings", () => {
    expect(cappedCalls("await storage.getLeads(orgId); this.getNotes(o); await storage.getDeals(org.id, f)")).toEqual(["getLeads", "getNotes", "getDeals"]);
    expect(cappedCalls("storage.getLeadsPaginated(o, p); storage.getLeadsByIds(o, ids); storage.getLead(o, 1); storage.getPropertiesBySellerIds(o, s)")).toEqual([]);
  });

  it("canary: every evasion spelling the audit tried is a call", () => {
    for (const spelling of [
      "(storage as any).getLeads(o)",
      "storage?.getLeads(o)",
      "storage.getLeads?.(o)",
      'storage["getLeads"](o)',
      "const s = storage; await s.getDeals(o)",
      "storage.getNotes.call(storage, o)",
      "repo.getProperties(o)",
      "(await import('./storage')).storage.getLeads(o)",
      "this.storage\n  .getNotes(o)",
    ]) {
      expect(cappedCalls(spelling), spelling).toHaveLength(1);
    }
    expect(cappedCalls("const { getLeads, getNote } = storage; await getLeads(o)")).toEqual(["getLeads"]);
  });

  it("canary: the spellings the re-audit found past the first widening", () => {
    for (const spelling of [
      'const { getLeads }: Pick<IStorage, "getLeads"> = storage;',
      "async function f({ getDeals }: IStorage) { return 1; }",
      "storage.getLeads!(o)",
      "const read = storage.getLeads; await read.call(storage, o)",
      "Reflect.apply(storage.getNotes, storage, [o])",
    ]) {
      expect(cappedCalls(spelling), spelling).toHaveLength(1);
    }
  });

  it("canary: a named other receiver is not counted, and only that receiver", () => {
    expect(cappedCalls("await taxDelinquentPipeline.getLeads({ organizationId: o })")).toEqual([]);
    expect(cappedCalls("await taxDelinquentPipelineV2.getLeads({ organizationId: o })")).toEqual(["getLeads"]);
  });
});
