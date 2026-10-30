/**
 * The worker no longer inherits `server/index.ts` by accident, so what it needs
 * from it must be requested explicitly (scheduler double-boot fix, 2026-10).
 * Pins the bootstrap that replaces the accident: provider registry, the
 * realtime-alert bridge (Redis publisher), env/secret validation, PII console
 * mask, test-auth guard — and DB-stored credentials loaded BEFORE jobs read env.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const { calls, mark } = vi.hoisted(() => {
  const calls: string[] = [];
  return { calls, mark: (n: string) => () => void calls.push(n) };
});

vi.mock("../../server/utils/validateEnv", () => ({ validateEnv: mark("validateEnv") }));
vi.mock("../../server/auth/testAuth", () => ({ assertTestAuthSafe: mark("assertTestAuthSafe") }));
vi.mock("../../server/middleware/secretsValidation", () => ({ validateSecrets: mark("validateSecrets") }));
vi.mock("../../server/services/integrationReadiness", () => ({ logIntegrationReadiness: mark("logIntegrationReadiness") }));
vi.mock("../../server/middleware/piiMasking", () => ({ installConsoleInterceptor: mark("installConsoleInterceptor") }));
vi.mock("../../server/providers-init", () => ({ initializeProviders: mark("initializeProviders") }));
vi.mock("../../server/websocket", () => ({ wsServer: { initialize: mark("WS_INITIALIZE_BINDS_A_PORT") } }));
vi.mock("../../server/services/realtimeAlerts", () => ({
  realtimeAlertsService: { setWebSocketServer: mark("setWebSocketServer") },
}));
vi.mock("../../server/tracing", () => ({ initTracing: async () => void calls.push("initTracing") }));
vi.mock("../../server/services/configManager", () => ({
  loadConfigToEnv: async () => void calls.push("loadConfigToEnv"),
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { bootWorkerRuntimeSync, bootWorkerRuntimeAsync } from "../../server/workerBoot";

describe("worker bootstrap names the index.ts side effects it needs", () => {
  it("runs providers, alert bridge, validation and PII mask — and never binds a port", async () => {
    bootWorkerRuntimeSync();
    expect(calls).toEqual(
      expect.arrayContaining([
        "validateEnv",
        "assertTestAuthSafe",
        "validateSecrets",
        "installConsoleInterceptor",
        "initializeProviders",
        "setWebSocketServer",
      ]),
    );
    expect(calls).not.toContain("WS_INITIALIZE_BINDS_A_PORT");
  });

  it("loads DB-stored credentials into env", async () => {
    calls.length = 0;
    await bootWorkerRuntimeAsync();
    expect(calls).toContain("loadConfigToEnv");
  });

  it("worker.ts actually calls the bootstrap and waits for it before the scheduler (not built-but-unwired)", () => {
    const src = stripComments(readFileSync(path.resolve(__dirname, "../../server/worker.ts"), "utf8"));
    expect(src).toMatch(/bootWorkerRuntimeSync\(\)/);
    const ready = src.indexOf("await workerRuntimeReady");
    const sched = src.indexOf("runScheduledJobs()");
    expect(ready).toBeGreaterThan(-1);
    expect(sched).toBeGreaterThan(ready);
  });
  it("neither worker.ts nor workerBoot.ts imports the server entrypoint", () => {
    for (const f of ["worker.ts", "workerBoot.ts"]) {
      const src = stripComments(readFileSync(path.resolve(__dirname, "../../server", f), "utf8"));
      expect(src).not.toMatch(/from\s+["']\.\/index(\.js|\.ts)?["']/);
    }
  });
});
