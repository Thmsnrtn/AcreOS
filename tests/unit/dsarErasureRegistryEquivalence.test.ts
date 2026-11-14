/**
 * PKG-1 §4 equivalence pin (canonical-adoption law) — erasure ≡ registry.
 *
 * `shared/privacy/dsarDomains.ts` DECLARES, per subject kind, which domains
 * erasure anonymizes / deletes / retains. `eraseDsarSubject`
 * (server/services/gdprService.ts) is what actually runs. A registry that is
 * only tested against itself proves nothing about the product, so this runs
 * the REAL eraseDsarSubject over a mocked db that records every mutation
 * (table + operation), maps each mutated SQL table back to the registry
 * domain that declares it, and asserts:
 *   - acted-on domains (per subject kind) ≡ the registry's anonymize/delete
 *     domains for that kind — no undeclared table is touched, no declared
 *     anonymize/delete domain is skipped;
 *   - the operation matches the declaration (delete ↔ "delete",
 *     update ↔ "anonymize");
 *   - `retained` ≡ the registry's retain domains for that kind, reasons included.
 * And the refusal paths mutate nothing.
 *
 * The select mock is keyed by the SQL table read (getTableConfig), not by
 * call order, so a refactor that reorders reads does not break the pin —
 * only a change in WHAT erasure touches does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbState = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  mutationReturns: {} as Record<string, unknown[]>,
  mutations: [] as Array<{ op: "insert" | "update" | "delete"; table: string }>,
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/db", async () => {
  const { getTableConfig } = await import("drizzle-orm/pg-core");
  const nameOf = (t: unknown) => getTableConfig(t as Parameters<typeof getTableConfig>[0]).name;
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["where", "limit", "orderBy", "innerJoin", "leftJoin", "set", "values", "returning", "onConflictDoNothing"]) {
      c[m] = () => c;
    }
    c.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => Promise.resolve(rows).then(ok, err);
    c.catch = (err: (e: unknown) => unknown) => Promise.resolve(rows).catch(err);
    return c;
  };
  const mutate = (op: "insert" | "update" | "delete") => (t: unknown) => {
    const table = nameOf(t);
    dbState.mutations.push({ op, table });
    return chain(dbState.mutationReturns[table] ?? []);
  };
  return {
    db: {
      select: () => ({
        from: (t: unknown) => {
          const name = nameOf(t);
          const rows = dbState.rows[name];
          if (!rows) throw new Error(`erasure equivalence test: unscripted read of ${name}`);
          return chain(rows);
        },
      }),
      insert: mutate("insert"),
      update: mutate("update"),
      delete: mutate("delete"),
    },
  };
});

import { eraseDsarSubject, DsarErasureRefusedError } from "../../server/services/gdprService";
import { DSAR_DOMAINS, type DsarSubjectKind } from "@shared/privacy/dsarDomains";
import type { DsarSubject } from "../../server/services/privacy/dsarActionGate";

const USER_ID = "user-uuid-equiv-1";
const ORG = 5;
const LEAD = 7;

type ExportDecision = Extract<(typeof DSAR_DOMAINS)[number], { decision: "export" }>;

function exportDomains(kind: DsarSubjectKind): ExportDecision[] {
  return DSAR_DOMAINS.filter((d): d is ExportDecision => d.decision === "export" && d.subjectKind === kind);
}

/** The registry's view: domain → declared erasure action, for anonymize/delete only. */
function declaredActedOn(kind: DsarSubjectKind): Record<string, "anonymize" | "delete"> {
  const out: Record<string, "anonymize" | "delete"> = {};
  for (const d of exportDomains(kind)) {
    if (d.erasure.action === "anonymize" || d.erasure.action === "delete") out[d.domain] = d.erasure.action;
  }
  return out;
}

function declaredRetained(kind: DsarSubjectKind): Array<{ domain: string; reason: string }> {
  return exportDomains(kind)
    .filter((d) => d.erasure.action === "retain")
    .map((d) => ({ domain: d.domain, reason: d.erasure.reason ?? "" }));
}

/** What erasure DID: each mutated table mapped back to the domain declaring it. */
function observedActedOn(kind: DsarSubjectKind): Record<string, "anonymize" | "delete"> {
  const tableToDomain = new Map<string, string>();
  for (const d of exportDomains(kind)) for (const t of d.tables) tableToDomain.set(t, d.domain);
  const out: Record<string, "anonymize" | "delete"> = {};
  for (const m of dbState.mutations) {
    const domain = tableToDomain.get(m.table);
    if (!domain) throw new Error(`erasure (${kind}) mutated ${m.op}:${m.table}, which no ${kind} export domain declares`);
    if (m.op === "insert") throw new Error(`erasure (${kind}) INSERTED into ${m.table}`);
    out[domain] = m.op === "delete" ? "delete" : "anonymize";
  }
  return out;
}

const sortByDomain = <T extends { domain: string }>(xs: T[]) => [...xs].sort((a, b) => a.domain.localeCompare(b.domain));

beforeEach(() => {
  dbState.rows = {};
  dbState.mutationReturns = {};
  dbState.mutations = [];
});

describe("PKG-1 — eraseDsarSubject ≡ DSAR_DOMAINS", () => {
  it("user subject: acted-on domains ≡ registry anonymize/delete; retained ≡ registry retain", async () => {
    dbState.rows = {
      users: [{ id: USER_ID, email: "u+equiv@example.test" }],
      team_members: [{ orgId: ORG, organizationId: ORG }],
      legal_holds: [],
    };
    dbState.mutationReturns = {
      team_messages: [{ id: 1 }],
      support_tickets: [{ id: 2 }],
      ai_conversations: [{ id: 3 }],
    };
    const subject: DsarSubject = { kind: "user", userId: USER_ID, email: "u+equiv@example.test", organizationIds: [ORG] };
    const result = await eraseDsarSubject(subject);

    // Vacuity: the registry declares something for users, and erasure did something.
    expect(Object.keys(declaredActedOn("user")).length).toBeGreaterThan(0);
    expect(dbState.mutations.length).toBeGreaterThan(0);

    expect(observedActedOn("user")).toEqual(declaredActedOn("user"));
    expect(sortByDomain(result.retained)).toEqual(sortByDomain(declaredRetained("user")));
    // S-3 is surfaced, never silently skipped.
    expect(result.operatorFollowUps.join(" ")).toMatch(/Clerk/);
    // C-5: assigned leads/tasks are not the subject's — never touched.
    expect(dbState.mutations.map((m) => m.table)).not.toContain("leads");
    expect(dbState.mutations.map((m) => m.table)).not.toContain("tasks");
  });

  it("lead subject: acted-on domains ≡ registry anonymize/delete; retained ≡ registry retain", async () => {
    dbState.rows = {
      leads: [{ id: LEAD, email: "s+equiv@example.test" }],
      legal_holds: [],
      notes: [],
    };
    dbState.mutationReturns = { leads: [{ id: LEAD }] };
    const subject: DsarSubject = {
      kind: "lead", organizationId: ORG, leadId: LEAD, email: "s+equiv@example.test", isBorrower: false, noteIds: [],
    };
    const result = await eraseDsarSubject(subject);

    expect(Object.keys(declaredActedOn("lead")).length).toBeGreaterThan(0);
    expect(dbState.mutations.length).toBeGreaterThan(0);

    expect(observedActedOn("lead")).toEqual(declaredActedOn("lead"));
    expect(sortByDomain(result.retained)).toEqual(sortByDomain(declaredRetained("lead")));
    // The retained list is what the response shows the founder; the consent
    // exhibit and the S-2 communications gap are in it by name.
    expect(result.retained.map((r) => r.domain)).toEqual(expect.arrayContaining(["consent_records", "communications"]));
  });

  it("refusals mutate nothing: an already-erased user, an already-erased lead, a borrower lead (S-1)", async () => {
    dbState.rows = { users: [{ id: USER_ID, email: "deleted-user-abcd1234@gdpr-deleted.invalid" }], team_members: [], legal_holds: [] };
    await expect(
      eraseDsarSubject({ kind: "user", userId: USER_ID, email: "x", organizationIds: [] }),
    ).rejects.toMatchObject({ reason: "SUBJECT_ALREADY_ERASED" });
    expect(dbState.mutations).toEqual([]);

    dbState.rows = { leads: [{ id: LEAD, email: `deleted-${LEAD}@gdpr-deleted.invalid` }], legal_holds: [], notes: [] };
    await expect(
      eraseDsarSubject({ kind: "lead", organizationId: ORG, leadId: LEAD, email: "x", isBorrower: false, noteIds: [] }),
    ).rejects.toMatchObject({ reason: "SUBJECT_ALREADY_ERASED" });
    expect(dbState.mutations).toEqual([]);

    dbState.rows = { leads: [{ id: LEAD, email: "b+equiv@example.test" }], legal_holds: [], notes: [{ id: 99 }] };
    const err = await eraseDsarSubject({
      kind: "lead", organizationId: ORG, leadId: LEAD, email: "b+equiv@example.test", isBorrower: true, noteIds: [99],
    }).catch((e) => e);
    expect(err).toBeInstanceOf(DsarErasureRefusedError);
    expect(err).toMatchObject({ reason: "RETENTION_REQUIRED_LOAN_RECORDS", details: { noteIds: [99] } });
    expect(dbState.mutations).toEqual([]);
  });
});
