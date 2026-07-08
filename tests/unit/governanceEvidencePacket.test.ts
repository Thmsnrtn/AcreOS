import { describe, it, expect } from "vitest";
import {
  assembleEvidencePacket,
  verifyEvidencePacket,
  type EvidenceInputs,
} from "../../server/services/governance/evidencePacket";
import { orgScope, PLATFORM_SCOPE } from "../../server/services/autopilot/tenantScope";
import { CONSTITUTION_VERSION_HASH } from "../../server/services/autopilot/proofReceipt";

const GENERATED = "2026-06-24T12:00:00.000Z";

function inputs(over: Partial<EvidenceInputs> = {}): EvidenceInputs {
  return {
    scope: orgScope(7),
    periodDays: 30,
    generatedAt: GENERATED,
    auditChainVerified: true,
    witnessedSends: { total: 3, byChannel: { email: 2, sms: 1 } },
    autonomy: [{ domain: "growth", level: "observe", cleanCycleCount: 4 }],
    ...over,
  };
}

describe("assembleEvidencePacket — sealed governance artifact", () => {
  it("captures the posture and seals it, anchoring the constitution hash", () => {
    const p = assembleEvidencePacket(inputs());
    expect(p.v).toBe(1);
    expect(p.scope).toBe("org:7");
    expect(p.periodDays).toBe(30);
    expect(p.constitution.versionHash).toBe(CONSTITUTION_VERSION_HASH);
    expect(p.auditChain.verified).toBe(true);
    expect(p.auditChain.note).toMatch(/verified end-to-end/);
    expect(p.witnessedSends.total).toBe(3);
    expect(p.autonomy[0].domain).toBe("growth");
    expect(p.packetHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("notes a failed/unavailable audit chain honestly", () => {
    const p = assembleEvidencePacket(inputs({ auditChainVerified: false }));
    expect(p.auditChain.verified).toBe(false);
    expect(p.auditChain.note).toMatch(/FAILED or was unavailable/);
  });

  it("is deterministic and scope-aware (platform vs org seal differently)", () => {
    expect(assembleEvidencePacket(inputs()).packetHash).toBe(assembleEvidencePacket(inputs()).packetHash);
    const platform = assembleEvidencePacket(inputs({ scope: PLATFORM_SCOPE }));
    expect(platform.scope).toBe("platform");
    expect(platform.packetHash).not.toBe(assembleEvidencePacket(inputs()).packetHash);
  });
});

describe("verifyEvidencePacket — integrity of an exported packet", () => {
  it("accepts an untampered packet", () => {
    expect(verifyEvidencePacket(assembleEvidencePacket(inputs())).valid).toBe(true);
  });

  it("detects a tampered witnessed-send count (the seal no longer matches)", () => {
    const p = assembleEvidencePacket(inputs());
    const tampered = { ...p, witnessedSends: { total: 999, byChannel: { email: 999 } } };
    const v = verifyEvidencePacket(tampered);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/altered/i);
  });

  it("detects a downgraded audit-chain claim", () => {
    const p = assembleEvidencePacket(inputs({ auditChainVerified: false }));
    // forge a 'verified: true' claim without re-sealing
    const forged = { ...p, auditChain: { verified: true, note: "looks fine" } };
    expect(verifyEvidencePacket(forged).valid).toBe(false);
  });
});
