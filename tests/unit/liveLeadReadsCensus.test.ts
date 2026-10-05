/**
 * Every production read of `leads` is live, or deliberately not (DEFECT-0273).
 *
 * The population is EVERY .ts file under server/ (tests excluded), read by
 * tests/support/leadCensus.ts. A statement that reads or writes `leads` must
 * carry the live-lead predicate (`liveLead()` from server/storage/liveLeads.ts,
 * an `isNull(<leads>.deletedAt)`, or raw `deleted_at IS NULL`), or use the
 * table under its deliberate name `leadsIncludingDeleted` — and a file may use
 * that name only if it is on the register below, with its reason.
 *
 * leadReadersSkipSoftDeleted.test.ts was the same rule over an explicit list
 * of nine files; this is the rule over the population the defect names.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { leadStatements, leadTableNames } from "../support/leadCensus";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

/**
 * Files that deliberately read deleted leads, and why. Down-only in spirit:
 * an entry needs a reason a reviewer can check, and the rot test below fails
 * when a file no longer uses the deliberate name.
 */
const INCLUDING_DELETED: Readonly<Record<string, string>> = {
  "server/jobs/autonomousDealMachine.ts":
    "The Deal Hunter's source-tracking lookup guards creation, so a scraped parcel cannot re-mint a contactable lead for someone deleted or opted out.",
  "server/jobs/runScheduledJobs.ts":
    "The founder-only pre-churn ladder measures an org's last activity, and a lead created then deleted was still activity.",
  "server/routes-buyer-blasts.ts":
    "A blast's recipient list is the record of who WAS emailed; a buyer whose lead was deleted since still received it (the send path itself is live).",
  "server/routes-doc-system.ts":
    "Seller and buyer named on a generated legal document (deed, contract) are the parties of record; a deed does not lose its grantor because the CRM lead was deleted.",
  "server/routes-leads.ts":
    "The soft-delete and restore writers must address deleted rows, and the two import parcel dedupes guard creation so a re-import cannot mint a fresh contactable row for someone who revoked consent.",
  "server/routes-lifecycle.ts":
    "Founder-only platform activity: a lead the customer later deleted was still real activity, and excluding it would mark an active org silent and fire a pre-churn rung.",
  "server/routes-organization.ts":
    "The shadow-org emptiness check guards a cascading hard org delete; a soft-deleted lead, and its opt-out, is still data that delete would destroy, so it counts as not-empty.",
  "server/services/autopilot/hands/counterpartyMatch.ts":
    "The cross-org counterparty hard stop on autopilot email must match any address that was ever a customer's counterparty; filtering deleted leads would let a send through a fail-closed guard.",
  "server/services/dataPortability.ts":
    "The full data export returns every row the org owns, soft-deleted ones included.",
  "server/services/form1098Batch.ts":
    "A 1098 is a legal filing for interest actually received; the borrower's identity must resolve after the borrower lead is soft-deleted.",
  "server/services/gdprService.ts":
    "GDPR export and erasure must cover soft-deleted leads too, or the person's data survives erasure.",
  "server/services/importExport.ts":
    "The CSV import's parcel dedupe guards creation: a re-import must not mint a contactable row for someone who revoked consent on a now-deleted lead (pinned in leadReadersSkipSoftDeleted.test.ts).",
  "server/services/inboundEmailService.ts":
    "An inbound reply must still match and be recorded against a deleted lead; the status update that follows is live.",
  "server/services/noteEvents.ts":
    "The balloon-approaching notice goes to the borrower of record on a note still being serviced, even after the CRM lead was soft-deleted.",
  "server/services/smsService.ts":
    "A STOP must opt out every row at the number, deleted ones included; inbound matching follows the consent rule (live rows are preferred when both exist).",
  "server/services/taxDelinquentPipeline.ts":
    "The tax-delinquent import's (state, county, apn) duplicate check guards creation, the same rule as the pinned CSV parcel dedupe.",
  "server/services/tcpaCompliance.ts":
    "STOP and START keyword writes must reach every row at the number, so a restored lead comes back with its consent state correct.",
  "server/services/trendAnalyzer.ts":
    "The founder-only platform week-over-week New Leads trend counts leads created that week; a lead deleted later was still created.",
  "server/storage/auditRepo.ts":
    "The retention purge must reach soft-deleted dead leads, and a consent/opt-out write must land on a deleted row too (its only caller checks the lead is live first, so consent cannot be GRANTED to a deleted lead). The TCPA opt-out record lists deleted leads too: their opt-out still binds the number.",
  "server/storage/listBuilderRepo.ts":
    "The county list builder's (state, county, APN) parcel dedupe guards creation: a parcel whose only lead was deleted (and may carry an opt-out) is suppressed, never linked or re-created.",
  "server/storage/leadRepo.ts":
    "The soft-delete, restore, trash-list and erasure writers address deleted rows by definition; the inbound-SMS phone match (includeDeleted) must reach them so a STOP still opts out; findDuplicateLeads guards creation so a re-import cannot mint a contactable row for someone who revoked consent.",
};

function productionFiles(): string[] {
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

const files = productionFiles();
const census = files
  .map((file) => ({ file, statements: leadStatements(fs.readFileSync(path.join(ROOT, file), "utf8")) }))
  .filter((f) => f.statements.length > 0);

describe("the live-lead census", () => {
  it("vacuity: the population is the server, and it reads leads in the shapes the parser knows", () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(census.length).toBeGreaterThanOrEqual(100);
    const kinds = new Set(census.flatMap((f) => f.statements.map((s) => s.kind)));
    for (const k of ["builder", "raw"] as const) expect(kinds, k).toContain(k);
    expect(fs.existsSync(path.join(ROOT, "server/storage/liveLeads.ts"))).toBe(true);
  });

  it("every statement that reads or writes leads is live — or uses the deliberate name", () => {
    const offenders = census.flatMap((f) =>
      f.statements
        .filter((s) => s.kind !== "deliberate" && !s.live)
        .map((s) => `${f.file}: ${s.text.replace(/\s+/g, " ").slice(0, 110)}`),
    );
    expect(
      offenders,
      "a statement reads `leads` without liveLead(). Add the predicate, or — if it must see deleted " +
        "leads (consent, creation dedupe, delete/restore, export/erasure) — use leadsIncludingDeleted " +
        "and register the file with its reason.",
    ).toEqual([]);
  });

  it("only registered files read deleted leads on purpose", () => {
    const users = census.filter((f) => f.statements.some((s) => s.kind === "deliberate")).map((f) => f.file);
    expect(users.filter((f) => !Object.hasOwn(INCLUDING_DELETED, f))).toEqual([]);
  });

  it("the register cannot rot, and every reason is a sentence", () => {
    const users = new Set(census.filter((f) => f.statements.some((s) => s.kind === "deliberate")).map((f) => f.file));
    for (const [file, reason] of Object.entries(INCLUDING_DELETED)) {
      expect(users.has(file), `${file} no longer reads deleted leads — remove its entry`).toBe(true);
      expect(reason.length, file).toBeGreaterThan(30);
    }
  });
});

describe("canaries — each shape the census relies on", () => {
  const imp = `import { leads } from "@shared/schema";\n`;
  const live = (src: string) => leadStatements(src).map((s) => s.live);

  it("a plain builder read without the predicate is caught; with it, passes", () => {
    expect(live(`${imp}const r = await db.select().from(leads).where(eq(leads.organizationId, o));`)).toEqual([false]);
    expect(live(`${imp}const r = await db.select().from(leads).where(and(eq(leads.organizationId, o), liveLead()));`)).toEqual([true]);
    expect(live(`${imp}const r = await db.select().from(leads).where(isNull(leads.deletedAt));`)).toEqual([true]);
  });

  it("the opposite filter is not the predicate", () => {
    expect(live(`${imp}const r = await db.select().from(leads).where(isNotNull(leads.deletedAt));`)).toEqual([false]);
  });

  it("an `as` alias, a namespace import and an awaited import are all read", () => {
    expect(leadTableNames(`import { leads as leadsTable, deals } from "@shared/schema";`)).toEqual(["leadsTable"]);
    expect(live(`import { leads as L } from "@shared/schema";\nawait db.update(L).set({ a: 1 }).where(eq(L.id, 1));`)).toEqual([false]);
    expect(live(`import * as schema from "@shared/schema";\nawait db.select().from(schema.leads);`)).toEqual([false]);
    expect(live(`const { leads } = await import("@shared/schema");\nawait db.delete(leads).where(eq(leads.id, 1));`)).toEqual([false]);
  });

  it("the relational API and raw SQL are read", () => {
    expect(live(`await db.query.leads.findMany({ where: eq(leads.organizationId, o) });`)).toEqual([false]);
    expect(live("await db.execute(sql`SELECT count(*) FROM leads WHERE organization_id = ${o}`);")).toEqual([false]);
    expect(live("await db.execute(sql`SELECT count(*) FROM leads l WHERE l.deleted_at IS NULL`);")).toEqual([true]);
  });

  it("prose that says 'from leads' is not a query; SQL inside sql`` is", () => {
    expect(leadStatements(`const help = "Pax can read threads from leads and sellers";`)).toEqual([]);
    expect(live("const q = sql`select id from leads where org = ${o}`;")).toEqual([false]);
  });

  it("a sibling query cannot lend its predicate", () => {
    const src = `${imp}await Promise.all([db.select().from(leads).where(eq(leads.id, 1)), db.select().from(deals).where(liveLead())]);`;
    expect(live(src)).toEqual([false]);
  });

  it("a comment naming the predicate is not the predicate", () => {
    expect(live(`${imp}// liveLead()\nconst r = await db.select().from(leads);`)).toEqual([false]);
  });

  it("the deliberate name is seen under any import alias", () => {
    const src = `import { leadsIncludingDeleted as everyLead } from "../storage/liveLeads";\nawait db.select().from(everyLead).where(eq(x, 1));`;
    expect(leadStatements(src)).toEqual([expect.objectContaining({ kind: "deliberate" })]);
  });

  it("an inner join on leads is read; a left join is not", () => {
    expect(live(`${imp}await db.select().from(seqs).innerJoin(leads, eq(seqs.leadId, leads.id)).where(eq(seqs.status, "active"));`)).toEqual([false]);
    expect(live(`${imp}await db.select().from(seqs).innerJoin(leads, and(eq(seqs.leadId, leads.id), liveLead()));`)).toEqual([true]);
    expect(leadStatements(`${imp}await db.select().from(deals).leftJoin(leads, eq(deals.leadId, leads.id));`)).toEqual([]);
  });

  it("a sibling on a differently named handle cannot lend its predicate either", () => {
    const src = `${imp}await Promise.all([db.select().from(leads).where(eq(leads.id, 1)), replicaDb.select().from(deals).where(liveLead())]);`;
    expect(live(src)).toEqual([false]);
  });

  it("the deliberate name is seen as deliberate, never as live", () => {
    expect(leadStatements(`await db.select().from(leadsIncludingDeleted).where(eq(x, 1));`)).toEqual([
      expect.objectContaining({ kind: "deliberate", live: false }),
    ]);
  });
});
