/**
 * DEFECT-0104 — an inbound STOP / START reaches EVERY lead at the number.
 *
 * `processOptKeyword` (server/services/tcpaCompliance.ts) loaded every lead
 * in the org and `.find()`-ed the FIRST whose last ten digits matched. Two
 * leads sharing a number (spouses, a household landline, a duplicate import)
 * meant a STOP revoked consent on one row and left the other textable — the
 * next campaign would reach the person who had just said stop.
 *
 * The db double below answers the OLD full-org scan with the same two rows,
 * so this file is a fair red against the pre-change source: it recorded one
 * revocation. It now records two, through the shared org-scoped lookup.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/consentEvents", () => ({
  recordConsentRevoked: vi.fn(async () => undefined),
  recordConsentGranted: vi.fn(async () => undefined),
}));

const H = vi.hoisted(() => ({
  leads: [
    { id: 1, phone: "+1 (555) 123-4567" },
    { id: 2, phone: "5551234567" },
    { id: 3, phone: "5559990000" },
  ],
  auditRows: [] as Array<{ entityId: number; action: string }>,
  leadPatches: [] as Array<Record<string, unknown>>,
  lookups: [] as Array<{ orgId: number; phone: string; opts?: { includeDeleted?: boolean } }>,
}));

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: async () => H.leads }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          H.leadPatches.push(patch);
        },
      }),
    }),
    insert: () => ({
      values: async (v: { entityId: number; action: string }) => {
        H.auditRows.push({ entityId: v.entityId, action: v.action });
      },
    }),
  },
}));

vi.mock("../../server/storage", () => ({
  storage: {
    findLeadsByPhoneLast10: vi.fn(
      async (orgId: number, phone: string, opts?: { includeDeleted?: boolean }) => {
        H.lookups.push({ orgId, phone, opts });
        const want = phone.replace(/\D/g, "").slice(-10);
        return H.leads.filter((l) => l.phone.replace(/\D/g, "").slice(-10) === want);
      },
    ),
    getLead: vi.fn(async () => undefined),
  },
}));

import { processOptKeyword } from "../../server/services/tcpaCompliance";

beforeEach(() => {
  H.auditRows.length = 0;
  H.leadPatches.length = 0;
  H.lookups.length = 0;
});

describe("processOptKeyword — every lead at the number (DEFECT-0104)", () => {
  it("STOP revokes consent on BOTH leads that share the number, and no other", async () => {
    const r = await processOptKeyword(5, "+15551234567", "STOP", "SM_stop_1");
    expect(r.action).toBe("opt_out");
    expect(H.auditRows).toEqual([
      { entityId: 1, action: "tcpa_opt_out" },
      { entityId: 2, action: "tcpa_opt_out" },
    ]);
    expect(H.leadPatches).toHaveLength(2);
    for (const patch of H.leadPatches) {
      expect(patch.doNotContact).toBe(true);
      expect(patch.tcpaConsent).toBe(false);
    }
  });

  it("reads through the org-scoped lookup, including soft-deleted rows", async () => {
    await processOptKeyword(5, "+15551234567", "stop", "SM_stop_2");
    expect(H.lookups).toEqual([{ orgId: 5, phone: "+15551234567", opts: { includeDeleted: true } }]);
  });

  it("a number with no lead records nothing and still reports the keyword", async () => {
    const r = await processOptKeyword(5, "+15550000000", "STOP", "SM_stop_3");
    expect(r).toEqual({ action: "opt_out" });
    expect(H.auditRows).toHaveLength(0);
  });

  it("a non-keyword message touches nothing", async () => {
    const r = await processOptKeyword(5, "+15551234567", "is the lot still for sale?", "SM_x");
    expect(r).toEqual({ action: "none" });
    expect(H.lookups).toHaveLength(0);
  });
});
