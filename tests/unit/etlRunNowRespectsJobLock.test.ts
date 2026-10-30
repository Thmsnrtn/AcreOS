/**
 * `run-now route respects the job lock` (scheduler double-boot fix, 2026-10).
 *
 * POST /api/founder/etl/jobs/:id/run used to call runJob(id) with no lock, so
 * a click could overlap a scheduled tick or another click. It now takes the
 * SAME lock the scheduled path takes (`etl:<jobName>`, 300s). The fake storage
 * below reproduces acquireJobLock's real semantics — free OR already held by
 * the SAME holder succeeds (re-extend) — because that is exactly why the route
 * must use a fresh holder id: with the process-wide id, a click would sail
 * through a tick running in the same process.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  locks: new Map<string, string>(),
  acquired: [] as Array<{ name: string; holder: string }>,
  runJob: undefined as undefined | ((id: number) => Promise<unknown>),
  runs: 0,
}));

vi.mock("../../server/storage", () => ({
  storage: {
    acquireJobLock: async (name: string, holder: string) => {
      const cur = state.locks.get(name);
      if (cur && cur !== holder) return false;
      state.locks.set(name, holder);
      state.acquired.push({ name, holder });
      return true;
    },
    releaseJobLock: async (name: string, holder: string) => {
      if (state.locks.get(name) === holder) state.locks.delete(name);
    },
  },
}));

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => [{ id: 7, jobName: "probe_job", providerName: "probe" }],
      }),
    }),
  },
}));

vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock("../../server/services/founder", () => ({ isFounderIdentity: () => true }));
vi.mock("../../server/types/request", () => ({ getClerkAuth: () => ({ userId: "founder" }) }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/etlOrchestrator", () => ({
  runJob: (id: number) => {
    state.runs += 1;
    return state.runJob!(id);
  },
  replayDlqRecord: vi.fn(),
}));

import { registerEtlRoutes } from "../../server/routes-etl";

type Handler = (req: any, res: any) => Promise<unknown>;
function getRunNowHandler(): Handler {
  let handler: Handler | undefined;
  registerEtlRoutes({
    get: () => {},
    post: (path: string, ...fns: Handler[]) => {
      if (path === "/api/founder/etl/jobs/:id/run") handler = fns[fns.length - 1];
    },
  } as any);
  if (!handler) throw new Error("run-now route not registered");
  return handler;
}

function call(handler: Handler, id = "7") {
  const out: { body?: any; status: number } = { status: 200 };
  const res: any = {
    status(c: number) {
      out.status = c;
      return res;
    },
    json(b: unknown) {
      out.body = b;
      return res;
    },
  };
  const done = handler({ params: { id } }, res).then(() => out);
  return done;
}

const okResult = { runId: 1, status: "success", stats: {}, watermarkBefore: null, watermarkAfter: null, observation: null };

describe("run-now route respects the job lock", () => {
  beforeEach(() => {
    state.locks.clear();
    state.acquired.length = 0;
    state.runs = 0;
    state.runJob = async () => okResult;
  });

  it("still runs on demand and releases the lock afterwards", async () => {
    const out = await call(getRunNowHandler());
    expect(out.body).toMatchObject({ status: "success", runId: 1 });
    expect(state.runs).toBe(1);
    expect(state.acquired[0].name).toBe("etl:probe_job"); // same name the scheduled path uses
    expect(state.locks.size).toBe(0);
  });

  it("two simultaneous calls: one executes, one is refused with the existing `skipped` shape", async () => {
    let finish!: () => void;
    state.runJob = () => new Promise((resolve) => (finish = () => resolve(okResult)));
    const handler = getRunNowHandler();

    const first = call(handler);
    await vi.waitFor(() => expect(state.runs).toBe(1)); // first holds the lock mid-run
    const second = await call(handler);

    expect(second.body).toMatchObject({ status: "skipped", reason: "locked", jobId: 7 });
    expect(state.runs).toBe(1); // the refused call never reached runJob

    finish();
    expect((await first).body).toMatchObject({ status: "success" });
    expect(state.locks.size).toBe(0);

    // Lock is free again: a later click runs.
    state.runJob = async () => okResult;
    expect((await call(handler)).body).toMatchObject({ status: "success" });
    expect(state.runs).toBe(2);
  });

  it("is refused while a scheduled tick holds the job's lock", async () => {
    state.locks.set("etl:probe_job", "scheduler-process-instance-id");
    const out = await call(getRunNowHandler());
    expect(out.body).toMatchObject({ status: "skipped", reason: "locked" });
    expect(state.runs).toBe(0);
    expect(state.locks.get("etl:probe_job")).toBe("scheduler-process-instance-id"); // not stolen/released
  });

  it("uses a fresh holder id per request, so it cannot self-own past a tick in the same process", async () => {
    const handler = getRunNowHandler();
    await call(handler);
    await call(handler);
    const holders = new Set(state.acquired.map((a) => a.holder));
    expect(holders.size).toBe(2);
  });

  it("releases the lock when the run throws", async () => {
    state.runJob = async () => {
      throw new Error("boom");
    };
    const out = await call(getRunNowHandler());
    expect(out.status).toBe(500); // Errors.internal
    expect(state.locks.size).toBe(0);
  });
});
