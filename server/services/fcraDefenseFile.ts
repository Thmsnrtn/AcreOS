/**
 * FCRA defense file — a PURE assembler (R-6, P2-5).
 *
 * Turns the org's purpose-ledger rows and FCRA attestation rows into the
 * attestation trail AcreOS keeps for it. No db import and no import of
 * fcraAttestation.ts (that module loads ../db, which route unit tests keep
 * out of the load graph) — rows and the current attestation version are
 * passed in, mirroring purposeLedger.ts.
 *
 * Data discipline: purpose metadata only. The ledger `metadata` column is
 * internal and is NEVER projected; no contact data lives in these tables and
 * only the fields named in DefenseFileEntry are copied.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Attestation TTL — the same 365-day window the gate enforces. */
const ATTESTATION_TTL_DAYS = 365;

export interface DefenseFileLedgerRow {
  id: number;
  createdAt: Date;
  actorUserId: string;
  surface: string;
  purposeCode: string;
  justification: string | null;
  attestationVersion: string | null;
  leadId: number | null;
  skipTraceId: number | null;
  apid: string | null;
  meteringRef: string | null;
}

export interface DefenseFileAttestationRow {
  userId: string;
  attestationVersion: string;
  attestedAt: Date;
}

export interface FcraDefenseFileInput {
  organizationId: number;
  generatedAt: Date;
  currentAttestationVersion: string;
  entries: DefenseFileLedgerRow[];
  attestations: DefenseFileAttestationRow[];
  truncated: boolean;
}

export interface DefenseFileEntry {
  id: number;
  createdAt: string;
  actorUserId: string;
  surface: string;
  purposeCode: string;
  justification: string | null;
  attestationVersion: string | null;
  leadId: number | null;
  skipTraceId: number | null;
  apid: string | null;
  meteringRef: string | null;
}

export interface DefenseFileAttestation {
  userId: string;
  attestationVersion: string;
  attestedAt: string;
  expiresAt: string;
  status: "current" | "stale";
}

export interface FcraDefenseFile {
  organizationId: number;
  generatedAt: string;
  currentAttestationVersion: string;
  attestations: DefenseFileAttestation[];
  coverage: {
    totalEntries: number;
    byPurposeCode: Record<string, number>;
    bySurface: Record<string, number>;
    distinctActors: number;
    firstEntryAt: string | null;
    lastEntryAt: string | null;
    truncated: boolean;
  };
  entries: DefenseFileEntry[];
}

/** CSV columns, in projection order. */
const ENTRY_FIELDS = [
  "id",
  "createdAt",
  "actorUserId",
  "surface",
  "purposeCode",
  "justification",
  "attestationVersion",
  "leadId",
  "skipTraceId",
  "apid",
  "meteringRef",
] as const satisfies ReadonlyArray<keyof DefenseFileEntry>;

export function buildFcraDefenseFile(input: FcraDefenseFileInput): FcraDefenseFile {
  // Per-user LATEST attestation (order-independent).
  const latest = new Map<string, DefenseFileAttestationRow>();
  for (const a of input.attestations) {
    const prev = latest.get(a.userId);
    if (!prev || a.attestedAt.getTime() > prev.attestedAt.getTime()) latest.set(a.userId, a);
  }
  const attestations: DefenseFileAttestation[] = [...latest.values()].map((a) => {
    const ageMs = input.generatedAt.getTime() - a.attestedAt.getTime();
    const stale =
      a.attestationVersion !== input.currentAttestationVersion || ageMs > ATTESTATION_TTL_DAYS * DAY_MS;
    return {
      userId: a.userId,
      attestationVersion: a.attestationVersion,
      attestedAt: a.attestedAt.toISOString(),
      expiresAt: new Date(a.attestedAt.getTime() + ATTESTATION_TTL_DAYS * DAY_MS).toISOString(),
      status: stale ? "stale" : "current",
    };
  });

  const byPurposeCode: Record<string, number> = {};
  const bySurface: Record<string, number> = {};
  const actors = new Set<string>();
  let first: number | null = null;
  let last: number | null = null;
  for (const e of input.entries) {
    byPurposeCode[e.purposeCode] = (byPurposeCode[e.purposeCode] ?? 0) + 1;
    bySurface[e.surface] = (bySurface[e.surface] ?? 0) + 1;
    actors.add(e.actorUserId);
    const t = e.createdAt.getTime();
    if (first === null || t < first) first = t;
    if (last === null || t > last) last = t;
  }

  const entries: DefenseFileEntry[] = input.entries.map((e) => ({
    id: e.id,
    createdAt: e.createdAt.toISOString(),
    actorUserId: e.actorUserId,
    surface: e.surface,
    purposeCode: e.purposeCode,
    justification: e.justification,
    attestationVersion: e.attestationVersion,
    leadId: e.leadId,
    skipTraceId: e.skipTraceId,
    apid: e.apid,
    meteringRef: e.meteringRef,
  }));

  return {
    organizationId: input.organizationId,
    generatedAt: input.generatedAt.toISOString(),
    currentAttestationVersion: input.currentAttestationVersion,
    attestations,
    coverage: {
      totalEntries: input.entries.length,
      byPurposeCode,
      bySurface,
      distinctActors: actors.size,
      firstEntryAt: first === null ? null : new Date(first).toISOString(),
      lastEntryAt: last === null ? null : new Date(last).toISOString(),
      truncated: input.truncated,
    },
    entries,
  };
}

function csvField(value: string | number | null): string {
  if (value === null) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC-4180 CSV of the entries (CRLF line endings). */
export function fcraDefenseFileToCsv(file: FcraDefenseFile): string {
  const lines = [ENTRY_FIELDS.join(",")];
  for (const e of file.entries) {
    lines.push(ENTRY_FIELDS.map((f) => csvField(e[f])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
