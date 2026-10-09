/**
 * trialEngine reads no schema column at import time.
 *
 * shared/schema.ts and shared/schema/*.ts import each other, and a module that
 * imports the schema while another chain is still evaluating it receives the
 * partial exports. trialEngine built its trial predicates as module-level
 * constants, so in that window it threw at import ("Cannot read properties of
 * undefined (reading 'subscriptionStatus')") — the CI failure of
 * billingLifecycleLookups on 2026-10-09. The predicates are now built per run.
 * This test hands trialEngine a schema with no tables at all: the import must
 * succeed, and only running the cycle may need the columns.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@shared/schema", () => ({}));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

describe("trialEngine import", () => {
  it("evaluates no schema column at module load", async () => {
    const mod = await import("../../server/services/trialEngine");
    expect(typeof mod.runTrialExpiryCycle).toBe("function");
  });
});
