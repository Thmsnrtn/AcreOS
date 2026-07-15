/**
 * dataByok — BYO-data-key resolver (R1d) unit tests.
 *
 * Proves the two questions the provider registry asks:
 *   - getConnectedDataProviders maps active credential CHANNELS back to the
 *     provider NAMES the registry keys on (and BatchData's skip-trace channel
 *     unlocks BatchData property lookups).
 *   - resolveDataProviderKey returns the customer key for a mapped provider,
 *     null for an unmapped (open-data) provider, and null when no key exists.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Minimal db mock: db.select({...}).from(table).where(cond) resolves to the
// configured rows. Only the shape getConnectedDataProviders uses.
let selectRows: Array<{ channel: string }> = [];
vi.mock("../../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => selectRows,
      }),
    }),
  },
}));

// key-vault is the decrypt boundary; stub it per test.
const getByokCredential = vi.fn();
vi.mock("./key-vault", () => ({
  getByokCredential: (...args: unknown[]) => getByokCredential(...args),
}));

describe("dataByok", () => {
  let mod: typeof import("./dataByok");

  beforeEach(async () => {
    vi.resetModules();
    selectRows = [];
    getByokCredential.mockReset();
    mod = await import("./dataByok");
  });

  describe("getConnectedDataProviders", () => {
    it("maps the batch_skiptracing channel to the batchdata provider", async () => {
      selectRows = [{ channel: "batch_skiptracing" }];
      const providers = await mod.getConnectedDataProviders(1);
      expect(providers.has("batchdata")).toBe(true);
      expect(providers.has("attom")).toBe(false);
    });

    it("maps attom and regrid channels to their providers", async () => {
      selectRows = [{ channel: "attom" }, { channel: "regrid" }];
      const providers = await mod.getConnectedDataProviders(1);
      expect(providers.has("attom")).toBe(true);
      expect(providers.has("regrid")).toBe(true);
    });

    it("returns an empty set when the org holds no data keys", async () => {
      selectRows = [];
      const providers = await mod.getConnectedDataProviders(1);
      expect(providers.size).toBe(0);
    });
  });

  describe("resolveDataProviderKey", () => {
    it("returns the customer key for a mapped provider", async () => {
      getByokCredential.mockResolvedValue("cust-attom-key");
      const key = await mod.resolveDataProviderKey(1, "attom");
      expect(key).toBe("cust-attom-key");
      expect(getByokCredential).toHaveBeenCalledWith({ organizationId: 1, channel: "attom" });
    });

    it("resolves BatchData property lookups from the batch_skiptracing channel", async () => {
      getByokCredential.mockResolvedValue("cust-batch-key");
      const key = await mod.resolveDataProviderKey(1, "batchdata");
      expect(key).toBe("cust-batch-key");
      expect(getByokCredential).toHaveBeenCalledWith({ organizationId: 1, channel: "batch_skiptracing" });
    });

    it("returns null for an unmapped (open-data) provider without decrypting", async () => {
      const key = await mod.resolveDataProviderKey(1, "open-data");
      expect(key).toBeNull();
      expect(getByokCredential).not.toHaveBeenCalled();
    });

    it("returns null (falls back to platform key) when no credential exists", async () => {
      getByokCredential.mockResolvedValue(null);
      const key = await mod.resolveDataProviderKey(1, "regrid");
      expect(key).toBeNull();
    });
  });
});
