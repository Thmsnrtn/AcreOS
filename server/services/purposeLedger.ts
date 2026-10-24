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
 * Entity-graph person-edge reads (LLC → member/officer/agent): this codebase
 * has NO entity graph — no table or function holds person edges — so there is
 * no surface to wire. ENTITY_GRAPH_PERSON_EDGE_SURFACES is empty on purpose and
 * pinned by a test: the first such surface must be added here.
 *
 * Metering. A paid door (the two /api/skip-tracing routes) debits the credit
 * pool first and then writes the ledger row carrying the debit's event id and
 * ledger row; if the ledger write fails the debit is refunded and the lookup
 * refused. (Moving the debit into the ledger's own transaction would change a
 * metering path — held for the founder/COO, see the D2 report.) POST
 * /api/skip-traces and the result reads have no customer debit to join.
 *
 * The purpose taxonomy is the conservative default already collected at every
 * skip-trace door (the FCRA purposes, server/services/fcraAttestation.ts). It
 * is an attorney-review input at LLC / first customer, not a compliance
 * declaration.
 */

import { purposeLedger } from "@shared/schema";

export const PURPOSE_SURFACES = ["skip_trace_call", "skip_trace_result_read", "owner_contact_lookup"] as const;
export type PurposeSurface = (typeof PURPOSE_SURFACES)[number];

/** Entity-graph person-edge read surfaces. None exist in this codebase (see module doc). */
export const ENTITY_GRAPH_PERSON_EDGE_SURFACES: readonly PurposeSurface[] = [];

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
  return { ledgerId: row.id, surface: e.surface };
}

/** A receipt a chokepoint will accept: a real ledger row id on a known surface. */
export function isReceipt(r: unknown): r is PurposeReceipt {
  return !!r && typeof (r as PurposeReceipt).ledgerId === "number" && (r as PurposeReceipt).ledgerId > 0 && (PURPOSE_SURFACES as readonly string[]).includes((r as PurposeReceipt).surface);
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

export const WITHHELD_NO_PURPOSE =
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
