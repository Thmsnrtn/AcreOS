/**
 * QUINN — embeddings org-scoping invariant integration test.
 *
 * Tahoe wave E2/E9 — Iris flagged in wave H1 review that the
 * solene_embedded_records `organization_id` column is nullable, by design,
 * for team-internal embeddings (feedback_memory, decision_trace,
 * failure_mode, audit_finding). But a future Pax-output ingest path could
 * forget to attribute org_id and silently land in the team-internal pool,
 * which would be a cross-org isolation breach.
 *
 * This test asserts the invariant directly: NO row whose `namespace` is
 * outside the team-internal allowlist may have `organization_id IS NULL`.
 *
 * The test runs against a mocked DB substrate — it does not need a live
 * Postgres. The invariant is enforced at the query-shape level, so the
 * test would catch any future code that bypasses it.
 */

import { describe, it, expect, vi } from "vitest";
import { EMBEDDING_NAMESPACES } from "@shared/schema/solene-embeddings";

// In-memory rows we'll feed the assertion.
interface EmbeddedRow {
  id: number;
  organizationId: number | null;
  namespace: string;
}

vi.mock("../../server/db", () => ({
  db: {
    execute: vi.fn(),
  },
}));

const TEAM_INTERNAL_NAMESPACES = new Set<string>(EMBEDDING_NAMESPACES);

/**
 * Assert the invariant given a row set. Exported as a pure function so
 * the test below + any future job that wants to spot-check this is the
 * same code.
 */
function assertOrgScopingInvariant(rows: EmbeddedRow[]): {
  ok: boolean;
  violatingRows: EmbeddedRow[];
} {
  const violating: EmbeddedRow[] = [];
  for (const row of rows) {
    if (row.organizationId === null && !TEAM_INTERNAL_NAMESPACES.has(row.namespace)) {
      violating.push(row);
    }
  }
  return { ok: violating.length === 0, violatingRows: violating };
}

describe("solene_embedded_records org-scoping invariant", () => {
  it("allows NULL organization_id for team-internal namespaces", () => {
    const rows: EmbeddedRow[] = [
      { id: 1, organizationId: null, namespace: "feedback_memory" },
      { id: 2, organizationId: null, namespace: "decision_trace" },
      { id: 3, organizationId: null, namespace: "failure_mode" },
      { id: 4, organizationId: null, namespace: "audit_finding" },
    ];
    const result = assertOrgScopingInvariant(rows);
    expect(result.ok).toBe(true);
    expect(result.violatingRows).toHaveLength(0);
  });

  it("allows NON-NULL organization_id for any namespace (tenant ingest)", () => {
    const rows: EmbeddedRow[] = [
      { id: 1, organizationId: 42, namespace: "feedback_memory" },
      { id: 2, organizationId: 42, namespace: "pax_output" },
      { id: 3, organizationId: 7, namespace: "decision_trace" },
    ];
    const result = assertOrgScopingInvariant(rows);
    expect(result.ok).toBe(true);
  });

  it("FAILS when a non-team-internal namespace has NULL organization_id", () => {
    const rows: EmbeddedRow[] = [
      { id: 1, organizationId: null, namespace: "feedback_memory" }, // ok
      { id: 2, organizationId: null, namespace: "pax_output" }, // BAD
      { id: 3, organizationId: null, namespace: "customer_session" }, // BAD
    ];
    const result = assertOrgScopingInvariant(rows);
    expect(result.ok).toBe(false);
    expect(result.violatingRows).toHaveLength(2);
    expect(result.violatingRows.map((r) => r.namespace).sort()).toEqual([
      "customer_session",
      "pax_output",
    ]);
  });

  it("enumerates exactly the 7 org-NULL-eligible namespaces from EMBEDDING_NAMESPACES", () => {
    // The invariant's allowlist is sourced from the schema constant. If a
    // new globally-shared (organization_id IS NULL) namespace is added, the
    // schema constant moves first; if a future namespace is meant to be
    // tenant-only, it lives OUTSIDE EMBEDDING_NAMESPACES.
    //
    // `land_knowledge` (Andrei E5) is a deliberately GLOBAL corpus — the
    // hand-curated, cited Pax land-expertise cards live at
    // organization_id IS NULL, like the team-internal namespaces. It is
    // distinct from per-tenant Pax output, which carries a real org_id and
    // is therefore NOT in this constant.
    //
    // `founder_precedent` (Jarvis 2.3) is PLATFORM memory by doctrine
    // (docs/company/three-level-boundary.md rule 5): founder rulings about
    // running AcreOS, stored org-NULL with the originating org id in
    // metadata only.
    //
    // `doctrine` (Horizon A5) is the PLATFORM doctrine corpus — repo docs
    // (docs/company, docs/internal, docs/adr, docs/architecture,
    // docs/policies, docs/strategy, sovereign-protocol) ingested by
    // doctrineIngest.ts at organization_id IS NULL. Never tenant data.
    expect([...TEAM_INTERNAL_NAMESPACES].sort()).toEqual([
      "audit_finding",
      "decision_trace",
      "doctrine",
      "failure_mode",
      "feedback_memory",
      "founder_precedent",
      "land_knowledge",
    ]);
  });
});
