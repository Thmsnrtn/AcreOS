/**
 * Governance evidence packet (Foundry move #5).
 *
 * Assembles AcreOS's governance posture for a period into ONE hash-sealed,
 * exportable artifact — EU-AI-Act-Art.12-shaped (a verifiable record of
 * automated decision-making + oversight). It is both AcreOS's own founder-trust
 * surface AND the literal sellable Foundry product: "here is provable evidence
 * the autonomy was governed."
 *
 * It composes EXISTING durable governance records — it builds nothing new:
 *   • the per-org tamper-evident audit-log hash chain (compliance/auditChain),
 *   • the witnessed-send audit (pax_sends — every human-approved outward action),
 *   • the earned-autonomy Trust Ledger (per-domain levels + clean-cycle counts),
 *   • the constitution version + content hash (proofReceipt's anchor).
 * The whole packet is then sealed with the same canonical sha256 the
 * proof-receipts use, and `verifyEvidencePacket` re-derives it to detect
 * tampering.
 *
 * This is a COMPOSITION layer (it reads app/DB sources), deliberately NOT kernel
 * — like cognitionContext, it wires the kernel primitives to live data.
 */

import { and, eq, gte } from "drizzle-orm";
import { db } from "../../db";
import { paxSends } from "@shared/schema";
import {
  hashPayload,
  CONSTITUTION_VERSION,
  CONSTITUTION_VERSION_HASH,
} from "../autopilot/proofReceipt";
import { describeScope, orgScope, type TenantScope } from "../autopilot/tenantScope";
import { logger } from "../../utils/logger";

export interface GovernanceEvidencePacket {
  v: 1;
  scope: string;
  periodDays: number;
  generatedAt: string;
  constitution: { version: string; versionHash: string };
  auditChain: { verified: boolean; note: string };
  witnessedSends: { total: number; byChannel: Record<string, number> };
  autonomy: Array<{ domain: string; level: string; cleanCycleCount: number }>;
  /** Canonical sha256 over every field above — the integrity seal. */
  packetHash: string;
}

export interface EvidenceInputs {
  scope: TenantScope;
  periodDays: number;
  generatedAt: string;
  auditChainVerified: boolean;
  witnessedSends: { total: number; byChannel: Record<string, number> };
  autonomy: Array<{ domain: string; level: string; cleanCycleCount: number }>;
}

const AUDIT_OK_NOTE =
  "audit-log hash chain verified end-to-end (tamper-evidence, not legal proof)";
const AUDIT_FAIL_NOTE =
  "audit-log hash chain verification FAILED or was unavailable — treat with suspicion";

/** Pure: assemble + seal an evidence packet. `generatedAt` injected for tests. */
export function assembleEvidencePacket(inp: EvidenceInputs): GovernanceEvidencePacket {
  const body = {
    v: 1 as const,
    scope: describeScope(inp.scope),
    periodDays: inp.periodDays,
    generatedAt: inp.generatedAt,
    constitution: { version: CONSTITUTION_VERSION, versionHash: CONSTITUTION_VERSION_HASH },
    auditChain: {
      verified: inp.auditChainVerified,
      note: inp.auditChainVerified ? AUDIT_OK_NOTE : AUDIT_FAIL_NOTE,
    },
    witnessedSends: inp.witnessedSends,
    autonomy: inp.autonomy,
  };
  return { ...body, packetHash: hashPayload(body) };
}

/** Pure: re-derive the seal to confirm the packet wasn't altered after export. */
export function verifyEvidencePacket(packet: GovernanceEvidencePacket): {
  valid: boolean;
  reason?: string;
} {
  const { packetHash, ...body } = packet;
  if (!packetHash) return { valid: false, reason: "missing packetHash" };
  return hashPayload(body) === packetHash
    ? { valid: true }
    : { valid: false, reason: "packetHash mismatch — the packet was altered after export" };
}

/**
 * Gather a per-org governance evidence packet from the live durable records.
 * Best-effort on each source (a single unavailable source degrades that field,
 * never throws the whole packet) — the packet always seals what it could read.
 */
export async function gatherGovernanceEvidence(
  orgId: number,
  periodDays = 30,
  generatedAt: string = new Date().toISOString(),
): Promise<GovernanceEvidencePacket> {
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  // 1. Audit-log hash-chain verification (tamper-evidence).
  let auditChainVerified = false;
  try {
    const { verifyAuditChain } = await import("../compliance/auditChain");
    auditChainVerified = (await verifyAuditChain(orgId)).ok;
  } catch (err) {
    logger.warn("[governance/evidence] audit-chain verify failed", err instanceof Error ? err : undefined);
  }

  // 2. Witnessed-send audit (every human-approved outward action this period).
  const witnessedSends = { total: 0, byChannel: {} as Record<string, number> };
  try {
    const rows = await db
      .select({ channel: paxSends.channel })
      .from(paxSends)
      .where(and(eq(paxSends.organizationId, orgId), gte(paxSends.sentAt, since)));
    witnessedSends.total = rows.length;
    for (const r of rows) {
      const ch = r.channel ?? "other";
      witnessedSends.byChannel[ch] = (witnessedSends.byChannel[ch] ?? 0) + 1;
    }
  } catch (err) {
    logger.warn("[governance/evidence] witnessed-send read failed", err instanceof Error ? err : undefined);
  }

  // 3. Earned-autonomy Trust Ledger (per-domain standing).
  let autonomy: GovernanceEvidencePacket["autonomy"] = [];
  try {
    const { getTrustLedger } = await import("../autopilot/domainAutonomy");
    autonomy = (await getTrustLedger()).map((e) => ({
      domain: e.domain,
      level: e.level,
      cleanCycleCount: e.cleanCycleCount,
    }));
  } catch (err) {
    logger.warn("[governance/evidence] trust-ledger read failed", err instanceof Error ? err : undefined);
  }

  return assembleEvidencePacket({
    scope: orgScope(orgId),
    periodDays,
    generatedAt,
    auditChainVerified,
    witnessedSends,
    autonomy,
  });
}
