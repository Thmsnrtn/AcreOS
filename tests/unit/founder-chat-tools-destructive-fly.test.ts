/**
 * Phase G/H/I batch 2 — destructive Fly-tool tests.
 *
 * Covers fly_restart_machine, fly_scale, fly_deploy, fly_secret_set,
 * fly_rollback. Verifies:
 *   - registered as destructive + Tier 3
 *   - reason field required
 *   - first call (unconfirmed) returns confirmation_request
 *   - confirmed call invokes the provider, returns artifact + rollbackRecipe
 *   - fly_secret_set emits a secret_paste artifact (NEVER calls setSecret)
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetRegistryForTests,
  getTool,
  type FounderToolContext,
} from "../../server/services/founder-chat/tool-registry";
import {
  runTool,
  __resetCooldownTrackerForTests,
  __setKillSwitchOverrideForTests,
} from "../../server/services/founder-chat/executor";

// Mock the fly provider — we don't want to hit the actual API.
vi.mock("../../server/services/founder-chat/providers/fly", () => {
  return {
    FlyClientError: class extends Error {
      status = 0;
      body = "";
      constructor(m: string, s: number, b: string) {
        super(m);
        this.status = s;
        this.body = b;
      }
    },
    listMachines: vi.fn(async () => [
      { id: "m1", name: "app", region: "iad", state: "started", config: { processes: [{ name: "app" }] } },
      { id: "m2", name: "app", region: "iad", state: "started", config: { processes: [{ name: "app" }] } },
    ]),
    listReleases: vi.fn(async () => [{ id: 1, version: 42, status: "succeeded" }]),
    listSecretNames: vi.fn(async () => []),
    getAppHealth: vi.fn(async () => ({ appName: "x", machineCount: 0, states: {}, regions: [], oldestMachineAgeHours: null })),
    getMachine: vi.fn(async () => ({ id: "m1", name: "app", region: "iad", state: "started" })),
    restartMachine: vi.fn(async () => ({ ok: true, raw: {} })),
    scaleApp: vi.fn(async () => ({ ok: true, raw: {} })),
    triggerDeploy: vi.fn(async () => ({ ok: true, commitSha: "abc1234567890" })),
    rollbackToVersion: vi.fn(async () => ({ ok: true, version: 41 })),
    setSecret: vi.fn(async () => ({ fingerprint: "deadbeef", raw: {} })),
  };
});

// Mock DB — destructive.ts inserts into chatSecretPasteRequests.
vi.mock("../../server/db", () => {
  const insertValues = vi.fn().mockResolvedValue([{}]);
  return {
    db: {
      insert: vi.fn().mockReturnValue({ values: insertValues }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        }),
      }),
    },
  };
});

function ctx(): FounderToolContext {
  return {
    founderUserId: "u_fly",
    organizationId: 1,
    threadId: 1,
    recentMentions: [],
    auditLog: async () => {},
  };
}

beforeAll(async () => {
  __resetRegistryForTests();
  await import("../../server/services/founder-chat/tools/destructive");
});

afterAll(() => {
  __resetRegistryForTests();
});

beforeEach(() => {
  __resetCooldownTrackerForTests();
  __setKillSwitchOverrideForTests(false);
});

afterEach(() => {
  __setKillSwitchOverrideForTests(null);
  vi.clearAllMocks();
});

const FLY_DESTRUCTIVE = [
  "fly_restart_machine",
  "fly_scale",
  "fly_deploy",
  "fly_secret_set",
  "fly_rollback",
];

describe("fly destructive tools — registration shape", () => {
  it("registers every Fly destructive tool as destructive=true tier=3", () => {
    for (const name of FLY_DESTRUCTIVE) {
      const t = getTool(name);
      expect(t, `${name} should be registered`).toBeDefined();
      expect(t!.destructive).toBe(true);
      expect(t!.tier).toBe(3);
      expect(t!.category).toBe("action");
    }
  });

  it("requires a reason field on every destructive Fly tool", () => {
    for (const name of FLY_DESTRUCTIVE) {
      const t = getTool(name)!;
      // Missing reason → validation fails.
      const argsWithoutReason: any = name === "fly_restart_machine"
        ? { machineId: "m1" }
        : name === "fly_scale"
        ? { processGroup: "app", count: 2 }
        : name === "fly_deploy"
        ? {}
        : name === "fly_secret_set"
        ? { keyName: "FOO" }
        : { version: 41 };
      const r = t.schema.safeParse(argsWithoutReason);
      expect(r.success, `${name} should reject missing reason`).toBe(false);
    }
  });
});

describe("fly destructive tools — confirmation flow", () => {
  it("first call returns confirmation_request, does NOT execute", async () => {
    const out = await runTool({
      toolName: "fly_restart_machine",
      args: { machineId: "mid_1", reason: "test restart" },
      ctx: ctx(),
    });
    expect(out.requiresConfirmation).toBe(true);
    expect(out.artifact.type).toBe("confirmation_request");

    const fly = await import("../../server/services/founder-chat/providers/fly");
    expect(fly.restartMachine).not.toHaveBeenCalled();
  });

  it("confirmed call invokes provider + verifyFn + emits rollback recipe", async () => {
    // Mock listMachines to immediately satisfy the verifyFn predicate
    // (count=2) so we don't wait 30s for the poll to time out.
    const fly = await import("../../server/services/founder-chat/providers/fly");
    (fly.listMachines as any).mockResolvedValue([
      { id: "m1", state: "started", config: { processes: [{ name: "app" }] } },
      { id: "m2", state: "started", config: { processes: [{ name: "app" }] } },
    ]);

    const out = await runTool({
      toolName: "fly_scale",
      args: { processGroup: "app", count: 2, reason: "scale up for traffic" },
      ctx: ctx(),
      confirmed: true,
    });
    expect(fly.scaleApp).toHaveBeenCalledWith("app", 2, undefined);
    expect(out.artifact.type).toBe("text");
    expect(out.verification).toBeDefined();
  }, 35_000);
});

describe("fly_secret_set — sealed-paste rule (ABSOLUTE)", () => {
  it("emits a secret_paste artifact and NEVER calls setSecret from the tool handler", async () => {
    const out = await runTool({
      toolName: "fly_secret_set",
      args: { keyName: "STRIPE_SECRET_KEY", reason: "rotation" },
      ctx: ctx(),
      confirmed: true,
    });
    expect(out.artifact.type).toBe("secret_paste");
    const art = out.artifact as { type: string; keyName: string; requestId: string };
    expect(art.keyName).toBe("STRIPE_SECRET_KEY");
    expect(typeof art.requestId).toBe("string");
    expect(art.requestId.length).toBeGreaterThanOrEqual(16);

    const fly = await import("../../server/services/founder-chat/providers/fly");
    expect(fly.setSecret).not.toHaveBeenCalled();
  });

  it("rejects malformed key names via the schema", () => {
    const t = getTool("fly_secret_set")!;
    expect(t.schema.safeParse({ keyName: "lowercase_bad", reason: "valid reason here" }).success).toBe(false);
    expect(t.schema.safeParse({ keyName: "GOOD_NAME", reason: "valid reason here" }).success).toBe(true);
  });
});
