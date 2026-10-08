/**
 * SIGTERM drain for the app process — extracted from server/index.ts so it can
 * be driven against a real http.Server in a test.
 *
 * Fly sends SIGTERM before replacing a machine (and SIGKILL after kill_timeout,
 * 5 s by default when fly.toml does not set one). The order:
 *
 *   1. stop job schedulers, so no new background work starts during the drain;
 *   2. `server.close()` — the listener stops accepting connections at once;
 *      idle keep-alive sockets are closed, and every response still in flight
 *      is sent with `Connection: close` so its socket ends when it finishes
 *      instead of carrying another request in;
 *   3. wait for in-flight requests, bounded by `drainTimeoutMs`; anything still
 *      open then is cut (`closeAllConnections`);
 *      (extra resources — the WebSocket server — are closed right after
 *      close(), because upgraded sockets would otherwise hold it open);
 *   4. close the DB pools;
 *   5. exit — 0 for a clean drain, 1 when the bound was hit.
 *
 * What it replaced: the inline handler cleared only `__bgIntervals`, so every
 * `scheduleSelfRescheduling` job kept ticking through the drain (the worker
 * already called cancelAllScheduledJobs; the app did not); it loaded the pool
 * with `require("./db")`, which throws under the ESM dev server; and it waited a
 * further fixed 5 s after the drain before exiting — past Fly's default
 * kill_timeout, so the pools were never seen to close in production.
 */
import type { Server, ServerResponse } from "node:http";

export interface GracefulShutdownDeps {
  server: Server;
  /** Stop every scheduler/interval from starting new work. */
  stopSchedulers: () => void;
  /** Close resources other than the DB (WebSocket server, …), right after close(). Best-effort. */
  closeExtras?: Array<() => unknown | Promise<unknown>>;
  /** End the DB pools. Best-effort; awaited before exit. */
  closeDb: () => Promise<unknown>;
  /** Upper bound on waiting for in-flight requests. */
  drainTimeoutMs: number;
  /** Bound on each resource close; defaults to 2 s. */
  closeStepTimeoutMs?: number;
  exit: (code: number) => void;
  log: (message: string) => void;
}

/**
 * Default drain bound. fly.toml sets no kill_timeout, so Fly's default (5 s)
 * applies and SIGKILL follows SIGTERM after 5 s: 4 s leaves room to close the
 * pools. Raise it only together with kill_timeout. Read from
 * SHUTDOWN_DRAIN_TIMEOUT_MS: a positive finite number of ms, else 4 s
 * (NaN, 0, negative, "" all fall back).
 */
export function drainTimeoutFrom(raw: string | undefined): number {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n > 0 ? n : 4_000;
}

/** Bound on each resource close (extras, DB) so a hung close cannot stall exit. */
const CLOSE_STEP_TIMEOUT_MS = 2_000;

async function bounded(step: () => unknown | Promise<unknown>, ms: number): Promise<"done" | "timeout"> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(step).then(() => "done" as const),
      new Promise<"timeout">((r) => {
        timer = setTimeout(() => r("timeout"), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Builds the handler; call it with the signal name. Re-entrant calls (a second
 * SIGTERM, or SIGINT after SIGTERM) return the same in-progress drain.
 */
export function createGracefulShutdown(deps: GracefulShutdownDeps): (signal: string) => Promise<void> {
  let draining: Promise<void> | null = null;
  let closing = false;

  // Once draining, every response not yet sent tells its client the connection
  // ends here, so a keep-alive socket cannot carry a new request in. Tracked
  // per response because most in-flight requests arrived BEFORE the signal.
  const open = new Set<ServerResponse>();
  const markClose = (res: ServerResponse) => {
    if (!res.headersSent) res.setHeader("Connection", "close");
  };
  deps.server.on("request", (_req, res) => {
    if (closing) return markClose(res);
    open.add(res);
    res.on("finish", () => open.delete(res));
    res.on("close", () => open.delete(res));
  });

  return (signal: string) => {
    if (draining) return draining;
    draining = (async () => {
      deps.log(`Received ${signal} — draining`);
      closing = true;
      const stepMs = deps.closeStepTimeoutMs ?? CLOSE_STEP_TIMEOUT_MS;
      // Last resort: whatever hangs below, the process still exits.
      const lastResort = setTimeout(() => {
        deps.log("shutdown exceeded its overall bound — exiting");
        deps.exit(1);
      }, deps.drainTimeoutMs + 2 * stepMs + 1_000);
      lastResort.unref?.();
      for (const res of open) markClose(res);
      try {
        deps.stopSchedulers();
      } catch (err) {
        deps.log(`scheduler stop failed: ${String(err)}`);
      }

      const closed = new Promise<void>((resolve) => {
        deps.server.close((err) => {
          if (err) deps.log(`HTTP server close: ${err.message}`);
          resolve();
        });
      });
      deps.server.closeIdleConnections?.();
      // Upgraded (WebSocket) sockets are still connections of this server, so
      // close() would wait on them for the whole bound — close them now.
      for (const close of deps.closeExtras ?? []) {
        try {
          if ((await bounded(close, stepMs)) === "timeout") deps.log(`resource close exceeded ${stepMs}ms — continuing`);
        } catch (err) {
          deps.log(`resource close failed: ${String(err)}`);
        }
      }

      let timer: NodeJS.Timeout | undefined;
      const timedOut = await Promise.race([
        closed.then(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(true), deps.drainTimeoutMs);
          timer.unref?.();
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (timedOut) {
        deps.log(`drain exceeded ${deps.drainTimeoutMs}ms — closing remaining connections`);
        deps.server.closeAllConnections?.();
      } else {
        deps.log("HTTP server closed — in-flight requests finished");
      }

      let dbTimedOut = false;
      try {
        dbTimedOut = (await bounded(deps.closeDb, stepMs)) === "timeout";
        deps.log(dbTimedOut ? `Database pool close exceeded ${stepMs}ms` : "Database pools closed");
      } catch (err) {
        deps.log(`Database pool close failed: ${String(err)}`);
      }
      clearTimeout(lastResort);
      deps.exit(timedOut || dbTimedOut ? 1 : 0);
    })();
    return draining;
  };
}
