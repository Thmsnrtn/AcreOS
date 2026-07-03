/**
 * Tests for the durable Stage-6 driver (step-away gap #6).
 *
 * Coverage:
 *  - a due deployed row is CLAIMED (due-time nulled via conditional update)
 *    before stage6 runs; a lost claim race skips the check
 *  - without GitHub credentials the PR poll never fires
 *  - a merged evolution PR flips pr_opened → deployed and stamps the due-time
 *  - a PR closed unmerged is abandoned (terminal, no check armed)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The module constructs an OpenAI client at import; neutralize it.
vi.mock("openai", () => ({ default: class { constructor(_o: unknown) {} } }));

// Queue-based db mock: each select/update-returning pops the next scripted
// response. update.set(patch) records every patch for assertions.
const SELECTS: any[][] = [];
const RETURNINGS: any[][] = [];
const SET_PATCHES: any[] = [];

vi.mock("../db", () => ({
  db: {
    select: (_proj?: unknown) => ({
      from: (_t: unknown) => {
        const exec = () => Promise.resolve(SELECTS.shift() ?? []);
        return {
          where: (_w: unknown) => {
            const p = exec();
            return Object.assign(p, {
              orderBy: () => ({ limit: () => p }),
              limit: () => p,
            });
          },
          orderBy: () => ({ limit: () => exec() }),
        };
      },
    }),
    update: (_t: unknown) => ({
      set: (patch: any) => {
        SET_PATCHES.push(patch);
        return {
          where: (_w: unknown) => {
            const p = Promise.resolve(undefined);
            return Object.assign(p, {
              returning: () => Promise.resolve(RETURNINGS.shift() ?? []),
            });
          },
        };
      },
    }),
  },
}));

const FETCH_CALLS: string[] = [];
let fetchResponse: { ok: boolean; body?: any } = { ok: false };
const originalFetch = globalThis.fetch;

import { scanDueRegressionChecks, REGRESSION_CHECK_DELAY_MS } from "./evolutionPipeline";

beforeEach(() => {
  SELECTS.length = 0;
  RETURNINGS.length = 0;
  SET_PATCHES.length = 0;
  FETCH_CALLS.length = 0;
  fetchResponse = { ok: false };
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_REPOSITORY;
  globalThis.fetch = vi.fn(async (url: any) => {
    FETCH_CALLS.push(String(url));
    return {
      ok: fetchResponse.ok,
      json: async () => fetchResponse.body ?? {},
    } as Response;
  }) as any;
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("scanDueRegressionChecks — due checks", () => {
  it("claims the due row (nulls the due-time) and runs stage6", async () => {
    SELECTS.push([{ id: 42 }]); // due rows
    RETURNINGS.push([{ id: 42 }]); // claim succeeds
    SELECTS.push([]); // stage6's history fetch — not found → clean exit
    const r = await scanDueRegressionChecks();
    expect(r.checked).toBe(1);
    // The claim patch nulled the due-time.
    expect(SET_PATCHES[0]).toMatchObject({ regressionCheckDueAt: null });
  });

  it("a lost claim race skips the check entirely", async () => {
    SELECTS.push([{ id: 42 }]); // due rows
    RETURNINGS.push([]); // another scanner claimed first
    const r = await scanDueRegressionChecks();
    expect(r.checked).toBe(0);
    // No stage6 history fetch happened — only the due scan consumed a select.
    expect(SELECTS.length).toBe(0);
  });

  it("no due rows → nothing runs", async () => {
    SELECTS.push([]);
    const r = await scanDueRegressionChecks();
    expect(r.checked).toBe(0);
    expect(SET_PATCHES).toHaveLength(0);
  });
});

describe("scanDueRegressionChecks — PR-mode merge detection", () => {
  it("never polls GitHub without credentials", async () => {
    SELECTS.push([]); // due rows
    const r = await scanDueRegressionChecks();
    expect(FETCH_CALLS).toHaveLength(0);
    expect(r.mergesDetected).toBe(0);
  });

  it("a merged PR flips to deployed and stamps the due-time", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    process.env.GITHUB_REPOSITORY = "acme/acreos";
    SELECTS.push([]); // due rows — none
    SELECTS.push([{ id: 7, prNumber: 123 }]); // pr_opened rows
    fetchResponse = { ok: true, body: { merged: true, state: "closed" } };
    const before = Date.now();
    const r = await scanDueRegressionChecks();
    expect(r.mergesDetected).toBe(1);
    expect(FETCH_CALLS[0]).toContain("/repos/acme/acreos/pulls/123");
    const patch = SET_PATCHES.find((p) => p.status === "deployed");
    expect(patch).toBeDefined();
    expect(patch.regressionCheckDueAt).toBeInstanceOf(Date);
    expect(patch.regressionCheckDueAt.getTime()).toBeGreaterThanOrEqual(
      before + REGRESSION_CHECK_DELAY_MS - 1000,
    );
  });

  it("a PR closed unmerged is abandoned", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    process.env.GITHUB_REPOSITORY = "acme/acreos";
    SELECTS.push([]); // due rows
    SELECTS.push([{ id: 8, prNumber: 99 }]); // pr_opened rows
    fetchResponse = { ok: true, body: { merged: false, state: "closed" } };
    const r = await scanDueRegressionChecks();
    expect(r.mergesDetected).toBe(0);
    expect(SET_PATCHES.find((p) => p.status === "abandoned")).toBeDefined();
  });
});
