/**
 * The purpose ledger — D2e (Amendment 2 §2.3). Mechanics only.
 *
 * Every person-adjacent lookup writes ONE append-only row (shared/schema/
 * purpose-ledger.ts; triggers in migration 0289) recording actor, org,
 * permissible-purpose code, context and the metering event it rode on.
 * FAIL CLOSED: no valid purpose code, no row — and no row, no read. The
 * enumerated surfaces and where each writes:
 *
 *   skip_trace_call        — every vendor skip-trace call. The chokepoint is
 *                            skipTracingService.trace(), which refuses to run
 *                            without a PurposeReceipt (the id of a ledger row
 *                            this request wrote). Doors: POST
 *                            /api/skip-tracing/trace/:leadId, POST
 *                            /api/skip-tracing/batch, POST /api/skip-traces.
 *   skip_trace_result_read — reading stored skip-trace RESULTS (phones,
 *                            emails, address history, relatives): GET
 *                            /api/skip-traces, /:id, /lead/:leadId. The purpose
 *                            is the one declared when the trace was run; a
 *                            stored trace with none has its results withheld.
 *   owner_contact_lookup   — provider-registry lookups in the person-adjacent
 *                            categories (owner_info, skip_trace). No production
 *                            caller asks for them today; the registry refuses
 *                            them without a purpose, so the first one cannot
 *                            arrive unrecorded.
 *
 * These three are the LEDGERED surfaces. Every other place person-adjacent
 * contact data leaves the server is derived from source and held, as debt
 * that may only shrink, by tests/unit/purposeLedgerCensus.test.ts
 * (docs/compliance/purpose-ledger-census.md).
 *
 * Entity-graph person-edge reads (LLC → member/officer/agent): this codebase
 * has NO entity graph — no table or function holds person edges — so there is
 * no surface to wire. A test pins that no person-edge table exists: the first
 * one must add its surface to PURPOSE_SURFACES.
 *
 * Metering (D2e Option B, approved 2026-10-25). Every paid skip-trace door —
 * the two /api/skip-tracing routes and POST /api/skip-traces — takes the
 * credit-pool debit and writes its purpose rows in ONE transaction
 * (server/services/skipTraceFunding.ts): a lookup that cannot be recorded is
 * never charged, because the debit rolls back with the row. A refund is only
 * for a lookup that ran and returned nothing. The result reads have no
 * customer debit to join.
 *
 * The purpose taxonomy is the conservative default already collected at every
 * skip-trace door (the FCRA purposes, server/services/fcraAttestation.ts). It
 * is an attorney-review input at LLC / first customer, not a compliance
 * declaration.
 */

import { purposeLedger } from "@shared/schema";

export const PURPOSE_SURFACES = ["skip_trace_call", "skip_trace_result_read", "owner_contact_lookup"] as const;
export type PurposeSurface = (typeof PURPOSE_SURFACES)[number];

/**
 * Conservative default taxonomy — attorney-review input, not a declaration.
 * The FCRA skip-trace purposes every door already collects; spelled out here
 * (fcraAttestation.ts loads the db module, which route unit tests keep out of
 * the load graph) and pinned equal to SKIP_TRACE_PURPOSES by a test.
 */
export const PURPOSE_CODES: readonly string[] = ["collection", "legitimate_business_need", "written_consent", "account_review"];

export class PurposeRequiredError extends Error {
  readonly code = "PURPOSE_REQUIRED" as const;
  constructor(message: string) {
    super(message);
    this.name = "PurposeRequiredError";
  }
}

export interface PurposeEntry {
  organizationId: number;
  actorUserId: string;
  surface: PurposeSurface;
  purposeCode: string | null | undefined;
  justification?: string | null;
  attestationVersion?: string | null;
  leadId?: number | null;
  skipTraceId?: number | null;
  apid?: string | null;
  meteringRef?: string | null;
  metadata?: Record<string, unknown>;
}

/** Proof a lookup was recorded — what skipTracingService.trace() requires. */
export interface PurposeReceipt {
  ledgerId: number;
  surface: PurposeSurface;
  /** The organization the row was written for — a receipt only opens that org's lookups. */
  organizationId: number;
}

type Inserter = { insert: (t: typeof purposeLedger) => { values: (v: Record<string, unknown>) => { returning: (r: { id: typeof purposeLedger.id }) => Promise<Array<{ id: number }>> } } };

/** The validation alone (pure): throws PurposeRequiredError on a missing or unknown code. */
export function assertPurpose(e: Pick<PurposeEntry, "purposeCode" | "actorUserId" | "surface" | "organizationId">): void {
  if (!(PURPOSE_SURFACES as readonly string[]).includes(e.surface)) throw new PurposeRequiredError(`unknown purpose-ledger surface "${e.surface}"`);
  if (!e.organizationId || !e.actorUserId) throw new PurposeRequiredError("a person-adjacent lookup needs an organization and an actor");
  if (!e.purposeCode || !PURPOSE_CODES.includes(e.purposeCode)) {
    throw new PurposeRequiredError(`a person-adjacent lookup needs a permissible-purpose code ∈ {${PURPOSE_CODES.join(", ")}} — no purpose, no read`);
  }
}

/**
 * Write the row (append-only) and return its receipt. Throws — and so refuses
 * the lookup — when the purpose is missing or the write fails. `tx` joins the
 * caller's transaction when there is one.
 */
export async function recordPurpose(e: PurposeEntry, tx?: unknown): Promise<PurposeReceipt> {
  assertPurpose(e);
  const conn = (tx ?? (await import("../db")).db) as unknown as Inserter;
  const [row] = await conn
    .insert(purposeLedger)
    .values({
      organizationId: e.organizationId,
      actorUserId: e.actorUserId,
      surface: e.surface,
      purposeCode: e.purposeCode,
      justification: e.justification ?? null,
      attestationVersion: e.attestationVersion ?? null,
      leadId: e.leadId ?? null,
      skipTraceId: e.skipTraceId ?? null,
      apid: e.apid ?? null,
      meteringRef: e.meteringRef ?? null,
      metadata: e.metadata ?? null,
    })
    .returning({ id: purposeLedger.id });
  if (!row) throw new PurposeRequiredError("the purpose ledger did not confirm the row — the lookup is refused");
  const receipt: PurposeReceipt = Object.freeze({ ledgerId: row.id, surface: e.surface, organizationId: e.organizationId });
  ISSUED.add(receipt);
  return receipt;
}

/**
 * Receipts recordPurpose issued in this process. A receipt is proof that a
 * row was written, not a shape: `{ ledgerId: 1, surface: "skip_trace_call" }`
 * typed by hand (or a spread copy of a real one) is refused at every
 * chokepoint, so no caller can reach a vendor by constructing one.
 */
const ISSUED = new WeakSet<object>();

/**
 * A receipt a chokepoint will accept: one recordPurpose issued, for a real row
 * on a known surface, written for `forOrganization` — another org's receipt,
 * or a lookup with no org named, is refused. (A receipt is not single-use: a
 * caller that re-uses one for a second lookup re-uses the same recorded
 * purpose; every door records one row per lookup.)
 */
export function isReceipt(r: unknown, forOrganization: number | undefined): r is PurposeReceipt {
  if (typeof r !== "object" || r === null || !ISSUED.has(r)) return false;
  const { ledgerId, surface, organizationId } = r as PurposeReceipt;
  return (
    typeof ledgerId === "number" &&
    ledgerId > 0 &&
    (PURPOSE_SURFACES as readonly string[]).includes(surface) &&
    forOrganization !== undefined &&
    organizationId === forOrganization
  );
}

/** The person-adjacent part of a stored skip trace. */
interface StoredTrace {
  id: number;
  leadId?: number | null;
  results?: unknown;
  purposeOfUse?: string | null;
  justification?: string | null;
  attestationVersion?: string | null;
}

const WITHHELD_NO_PURPOSE =
  "Results withheld: no permissible purpose was recorded when this trace was run. Run a new trace from a screen that asks for the purpose of use.";

/**
 * The skip_trace_result_read surface. Returns the traces with RESULTS released
 * only where a purpose was recorded for the trace, and writes one ledger row
 * per released result, all in one transaction BEFORE anything is returned. A
 * trace with no recorded purpose (or no results) writes nothing and has its
 * results withheld. A failed write throws — the read is refused, not served
 * unrecorded.
 */
export async function releaseSkipTraceResults<T extends StoredTrace>(
  organizationId: number,
  actorUserId: string,
  traces: T[],
  insertMany?: (rows: PurposeEntry[]) => Promise<number>,
): Promise<Array<T & { resultsWithheld?: string }>> {
  const toRecord: PurposeEntry[] = [];
  const out = traces.map((t) => {
    if (t.results == null) return t;
    if (!t.purposeOfUse || !PURPOSE_CODES.includes(t.purposeOfUse)) return { ...t, results: null, resultsWithheld: WITHHELD_NO_PURPOSE };
    toRecord.push({
      organizationId,
      actorUserId,
      surface: "skip_trace_result_read",
      purposeCode: t.purposeOfUse,
      justification: t.justification ?? null,
      attestationVersion: t.attestationVersion ?? null,
      leadId: t.leadId ?? null,
      skipTraceId: t.id,
    });
    return t;
  });
  if (toRecord.length === 0) return out;
  for (const e of toRecord) assertPurpose(e);
  const written = await (insertMany ?? insertPurposeRows)(toRecord);
  if (written !== toRecord.length) throw new PurposeRequiredError(`the purpose ledger confirmed ${written} of ${toRecord.length} rows — the read is refused`);
  return out;
}

async function insertPurposeRows(rows: PurposeEntry[]): Promise<number> {
  const { db } = await import("../db");
  const inserted = await db
    .insert(purposeLedger)
    .values(
      rows.map((e) => ({
        organizationId: e.organizationId,
        actorUserId: e.actorUserId,
        surface: e.surface,
        purposeCode: e.purposeCode as string,
        justification: e.justification ?? null,
        attestationVersion: e.attestationVersion ?? null,
        leadId: e.leadId ?? null,
        skipTraceId: e.skipTraceId ?? null,
        apid: e.apid ?? null,
        meteringRef: e.meteringRef ?? null,
        metadata: e.metadata ?? null,
      })),
    )
    .returning({ id: purposeLedger.id });
  return inserted.length;
}
