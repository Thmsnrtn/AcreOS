/**
 * No tool a model can call may delete customer data.
 *
 * ── THE RULE IT ENFORCES ────────────────────────────────────────────────────
 * CLAUDE.md, the standing founder decisions: "Hard-stops stay founder-only
 * forever: pricing changes, legal signing, spends >$500, customer-data
 * deletion." A tool in `supportToolDefinitions` or `server/ai/tools.ts` is
 * reachable by a model mid-conversation with a customer. That is the opposite
 * of founder-only, so the intersection must be empty.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `repair_orphaned_records` was a support tool taking `{ module, dry_run }`,
 * where `dry_run: false` meant "delete orphaned records". It issued four
 * `db.delete(...)` calls, and THREE OF THEM CARRIED NO ORGANIZATION PREDICATE:
 *
 *     db.delete(leads).where(sql`${leads.organizationId} IS NULL`)
 *     db.delete(properties).where(sql`${properties.organizationId} IS NULL`)
 *     db.delete(deals).where(sql`${deals.propertyId} IS NULL`)
 *
 * The fourth, on `tasks`, was scoped to `org.id` — which is the tell. The
 * author scoped one of the four.
 *
 * ── THE SEVERITY, STATED HONESTLY ───────────────────────────────────────────
 * All three of those columns are `.notNull()` in `shared/schema.ts`, so the
 * predicates match zero rows and nothing was ever deleted. This test would be
 * dishonest if it implied otherwise. What it guards is that the safety was
 * COINCIDENTAL: it lived in a different file, and a migration making any one of
 * those columns nullable — a soft-delete flag, a staging import, a backfill —
 * would have converted a support tool into a platform-wide, tenant-blind
 * deleter with no code change at the call site and no gate anywhere to notice.
 *
 * Guarding "is it scoped?" would therefore be the wrong rule, because a
 * correctly-scoped delete is still a delete, and still founder-only. So the
 * rule is the categorical one: a model-callable handler performs no deletion.
 *
 * ── WHY THIS IS A SEPARATE FILE FROM paxToolsReportRealEffects ──────────────
 * That gate asks whether a handler does LESS than it claims. This one asks
 * whether it does MORE than it may. `repair_orphaned_records` was perfectly
 * honest — it deleted rows and said so — so no amount of strengthening the
 * honesty predicate would ever have surfaced it.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";

const ROOT = path.resolve(__dirname, "../..");

/**
 * Every dispatch switch a model's tool call can reach.
 *
 * Kept identical in spirit to `TOOL_SWITCHES` in paxToolsReportRealEffects:
 * the population is part of the claim, and a rule installed on one file is a
 * claim about that file. Adding a third dispatch switch without adding it here
 * is what the cross-check below is for.
 */
const TOOL_SWITCHES = ["server/ai/tools.ts", "server/ai/supportAgent.ts"] as const;

/**
 * Deletion, in every spelling this codebase uses.
 *
 * `db.delete(` is Drizzle's. `storage.delete*` is the repo layer. Raw
 * `DELETE FROM` covers a `sql` template that sidesteps both. Truncate is
 * included because it is deletion with a different name — the point of a
 * semantic gate is that renaming the mechanism does not evade it.
 */
const DELETION = [
  { label: "db.delete(", re: /\bdb\s*\.\s*delete\s*\(/ },
  { label: "tx.delete(", re: /\btx\s*\.\s*delete\s*\(/ },
  { label: "storage.delete*", re: /\bstorage\s*\.\s*delete[A-Z]\w*\s*\(/ },
  { label: "raw DELETE FROM", re: /\bDELETE\s+FROM\b/i },
  { label: "raw TRUNCATE", re: /\bTRUNCATE\b/i },
];

function switchCases(src: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /\n {6}case "([a-z_0-9]+)": \{\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") depth -= 1;
      i += 1;
    }
    out.push({ name: m[1], body: src.slice(m.index + m[0].length, i) });
  }
  return out;
}

const source = (rel: string) =>
  stripCommentsPreservingLines(fs.readFileSync(path.join(ROOT, rel), "utf8"));

function deletingHandlers(src: string): Array<{ name: string; how: string }> {
  const out: Array<{ name: string; how: string }> = [];
  for (const c of switchCases(src)) {
    for (const d of DELETION) {
      if (d.re.test(c.body)) out.push({ name: c.name, how: d.label });
    }
  }
  return out;
}

describe.each(TOOL_SWITCHES)("no model-callable tool deletes customer data: %s", (rel) => {
  it("vacuity: the switch parses and the matcher is live", () => {
    const cases = switchCases(source(rel));
    expect(cases.length, `only ${cases.length} cases parsed from ${rel}`).toBeGreaterThan(50);

    // If DELETION could not match anything, every assertion below is satisfied
    // by a broken regex rather than by clean code.
    const probe = 'await db.delete(leads).where(eq(leads.organizationId, org.id));';
    expect(DELETION.some((d) => d.re.test(probe)), "the deletion matcher matches nothing").toBe(
      true,
    );
  });

  it("performs no deletion", () => {
    expect(
      deletingHandlers(source(rel)),
      `${rel}: a tool a model can call mid-conversation performs a deletion. ` +
        "Customer-data deletion is a founder-only hard-stop (CLAUDE.md) — it is " +
        "founder-only at EVERY blast radius, so scoping the query to org.id does " +
        "not make this acceptable. Report the condition and escalate; let a human " +
        "with the authority do the deleting.",
    ).toEqual([]);
  });
});

describe("the rule is falsifiable", () => {
  it("FIRES on the unscoped delete that shipped", () => {
    // repair_orphaned_records' `deals` branch, exactly as it was.
    const src = source("server/ai/supportAgent.ts");
    const mutated = src.replace(
      '      case "get_account_summary": {',
      '      case "repair_orphaned_records": {\n' +
        "        const orphanedDeals = await db.select({ count: sql<number>`count(*)` })\n" +
        "          .from(deals).where(sql`${deals.propertyId} IS NULL`);\n" +
        "        const foundCount = Number(orphanedDeals[0]?.count || 0);\n" +
        "        if (!dry_run && foundCount > 0) {\n" +
        "          await db.delete(deals).where(sql`${deals.propertyId} IS NULL`);\n" +
        "        }\n" +
        "        return { success: true, data: { found: foundCount } };\n" +
        "      }\n\n" +
        '      case "get_account_summary": {',
    );
    expect(mutated, "the mutation did not apply — re-anchor it").not.toBe(src);
    expect(deletingHandlers(mutated).map((d) => d.name)).toContain("repair_orphaned_records");
  });

  it("FIRES even when the delete IS correctly org-scoped", () => {
    // The rule is categorical, not a scoping check. A gate that accepted this
    // would permit a model to delete a customer's data on request, which is
    // the hard-stop verbatim.
    const src = source("server/ai/supportAgent.ts");
    const mutated = src.replace(
      '      case "get_account_summary": {',
      '      case "__probe_scoped_delete__": {\n' +
        "        await db.delete(tasks).where(and(\n" +
        "          eq(tasks.organizationId, org.id),\n" +
        "          eq(tasks.status, \"cancelled\"),\n" +
        "        ));\n" +
        "        return { success: true, data: { purged: true } };\n" +
        "      }\n\n" +
        '      case "get_account_summary": {',
    );
    expect(mutated).not.toBe(src);
    expect(deletingHandlers(mutated).map((d) => d.name)).toContain("__probe_scoped_delete__");
  });

  it("FIRES on a raw-SQL delete that names no Drizzle method", () => {
    // Renaming the mechanism must not evade the rule.
    const src = source("server/ai/supportAgent.ts");
    const mutated = src.replace(
      '      case "get_account_summary": {',
      '      case "__probe_raw_delete__": {\n' +
        "        await db.execute(sql`DELETE FROM tasks WHERE organization_id = ${org.id}`);\n" +
        "        return { success: true, data: { purged: true } };\n" +
        "      }\n\n" +
        '      case "get_account_summary": {',
    );
    expect(mutated).not.toBe(src);
    expect(deletingHandlers(mutated).map((d) => d.name)).toContain("__probe_raw_delete__");
  });

  it("does NOT fire on an update, or on the word 'delete' in prose", () => {
    // The negative control. Support tools legitimately update rows, and
    // several return messages that talk about deletion.
    const src = source("server/ai/supportAgent.ts");
    const mutated = src.replace(
      '      case "get_account_summary": {',
      '      case "__probe_update_only__": {\n' +
        "        await db.update(tasks).set({ status: \"cancelled\" })\n" +
        "          .where(eq(tasks.organizationId, org.id));\n" +
        '        return { success: true, data: { note: "Records were not deleted." } };\n' +
        "      }\n\n" +
        '      case "get_account_summary": {',
    );
    expect(mutated).not.toBe(src);
    expect(deletingHandlers(mutated).map((d) => d.name)).not.toContain("__probe_update_only__");
  });
});

describe("the deleted tool left no residue", () => {
  it("repair_orphaned_records is not a definition, a case, or a recommendation", () => {
    // It was named in two `recommendation:` strings the model reads back to the
    // customer, which would have kept prescribing a tool that no longer exists.
    for (const rel of TOOL_SWITCHES) {
      expect(source(rel), `${rel} still references repair_orphaned_records`).not.toContain(
        "repair_orphaned_records",
      );
    }
  });

  it("its one non-vacuous check survived as a read-only survey", () => {
    // Deleting the tool must not cost the diagnostic. The orphaned-task check
    // was the only one of its four whose predicate can actually match rows.
    const src = source("server/ai/supportAgent.ts");
    const integrity = switchCases(src).find((c) => c.name === "check_data_integrity");
    expect(integrity, "check_data_integrity is gone").toBeDefined();
    expect(integrity!.body).toContain("NOT EXISTS");
    expect(integrity!.body).toMatch(/module === "tasks"/);
    // And it must be org-scoped and non-destructive, like the rest of it.
    expect(integrity!.body).toMatch(/eq\(tasks\.organizationId, org\.id\)/);
    expect(DELETION.some((d) => d.re.test(integrity!.body))).toBe(false);
  });
});
