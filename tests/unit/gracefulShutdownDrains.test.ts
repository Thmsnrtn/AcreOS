/**
 * SIGTERM drains the app: no new connections, in-flight requests finish
 * (bounded), schedulers stopped, DB closed, then exit.
 *
 * Driven against a REAL http.Server on an ephemeral port, with the handler
 * registered on process SIGTERM exactly as server/index.ts registers it.
 */
import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGracefulShutdown, drainTimeoutFrom } from "../../server/utils/gracefulShutdown";
import { stripComments } from "../helpers/stripComments";

type Got = { status: number; body: string; connection: string | undefined };

function get(port: number, path: string, agent?: http.Agent): Promise<Got> {
  return new Promise((resolveP, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path, agent }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolveP({ status: res.statusCode ?? 0, body, connection: res.headers.connection }));
    });
    req.on("error", reject);
  });
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

async function harness(opts: { drainTimeoutMs: number; slowMs: number; hangDb?: boolean }) {
  const order: string[] = [];
  let arrived!: () => void;
  const slowArrived = new Promise<void>((r) => (arrived = r));
  const app = express();
  app.get("/slow", (_req, res) => {
    arrived();
    setTimeout(() => res.send("finished"), opts.slowMs);
  });
  app.get("/fast", (_req, res) => res.send("ok"));
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  cleanups.push(() => server.closeAllConnections?.());

  let exited!: (code: number) => void;
  const exitCode = new Promise<number>((r) => (exited = r));
  const shutdown = createGracefulShutdown({
    server,
    stopSchedulers: () => order.push("stopSchedulers"),
    closeExtras: [() => order.push("closeExtras")],
    closeDb: async () => {
      order.push("closeDb");
      if (opts.hangDb) await new Promise(() => {});
    },
    drainTimeoutMs: opts.drainTimeoutMs,
    closeStepTimeoutMs: 200,
    exit: (code) => {
      order.push(`exit:${code}`);
      exited(code);
    },
    log: () => {},
  });
  // Emitting SIGTERM in a test worker must reach ONLY this handler: park the
  // runner's own listeners for the duration and put them back after.
  const parked = process.listeners("SIGTERM");
  process.removeAllListeners("SIGTERM");
  const onSigterm = () => void shutdown("SIGTERM");
  process.once("SIGTERM", onSigterm);
  cleanups.push(() => {
    process.removeListener("SIGTERM", onSigterm);
    for (const l of parked) process.on("SIGTERM", l as (...a: unknown[]) => void);
  });
  return { port, order, slowArrived, exitCode };
}

describe("graceful shutdown on SIGTERM", () => {
  it("refuses new connections, lets the in-flight request finish, then closes the DB and exits 0", async () => {
    const { port, order, slowArrived, exitCode } = await harness({ drainTimeoutMs: 5_000, slowMs: 400 });
    // A keep-alive agent: the in-flight request's socket must not carry
    // another request in after the drain starts.
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    cleanups.push(() => agent.destroy());
    expect((await get(port, "/fast", agent)).status).toBe(200); // warm a keep-alive socket

    const inFlight = get(port, "/slow", agent);
    await slowArrived;
    process.emit("SIGTERM");

    // New connections are refused while the slow request is still running.
    await expect(get(port, "/fast")).rejects.toMatchObject({ code: "ECONNREFUSED" });
    expect(order).not.toContain("closeDb");

    const done = await inFlight;
    expect(done).toEqual({ status: 200, body: "finished", connection: "close" });
    expect(await exitCode).toBe(0);
    expect(order).toEqual(["stopSchedulers", "closeExtras", "closeDb", "exit:0"]);
  });

  it("is bounded: a request that never finishes is cut at the timeout, and the DB still closes (exit 1)", async () => {
    const { port, order, slowArrived, exitCode } = await harness({ drainTimeoutMs: 250, slowMs: 60_000 });
    const hung = get(port, "/slow").catch((e: NodeJS.ErrnoException) => e.code);
    await slowArrived;
    const t0 = Date.now();
    process.emit("SIGTERM");
    expect(await exitCode).toBe(1);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(order).toEqual(["stopSchedulers", "closeExtras", "closeDb", "exit:1"]);
    expect(await hung).toBe("ECONNRESET");
  });

  it("a second signal does not start a second drain", async () => {
    const { order, exitCode } = await harness({ drainTimeoutMs: 1_000, slowMs: 0 });
    const handler = process.listeners("SIGTERM")[0] as () => void;
    process.emit("SIGTERM");
    handler();
    await exitCode;
    expect(order.filter((o) => o.startsWith("exit")).length).toBe(1);
  });
});

describe("every step is bounded", () => {
  it("a DB close that never returns still ends in exit (1), inside the step bound", async () => {
    const { exitCode, order } = await harness({ drainTimeoutMs: 1_000, slowMs: 0, hangDb: true });
    const t0 = Date.now();
    process.emit("SIGTERM");
    expect(await exitCode).toBe(1);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(order).toEqual(["stopSchedulers", "closeExtras", "closeDb", "exit:1"]);
  });

  it("SHUTDOWN_DRAIN_TIMEOUT_MS: NaN, 0, empty or negative fall back to 4 s", () => {
    for (const bad of [undefined, "", "abc", "0", "-5"]) expect(drainTimeoutFrom(bad), String(bad)).toBe(4_000);
    expect(drainTimeoutFrom("2500")).toBe(2_500);
  });
});

describe("server/index.ts uses this drain", () => {
  it("registers createGracefulShutdown on SIGTERM and cancels the self-rescheduling jobs", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/index.ts"), "utf8"));
    expect(src).toMatch(/createGracefulShutdown\(\{\s*server: httpServer,/);
    expect(src).toMatch(/process\.once\("SIGTERM", \(\) => void gracefulShutdown\("SIGTERM"\)\)/);
    expect(src).toMatch(/cancelAllScheduledJobs\(\)/);
    expect(src).toMatch(/pool\.end\(\), replicaPool\.end\(\)/);
    // The ESM-unsafe require and the post-drain fixed wait are gone.
    expect(src).not.toMatch(/require\("\.\/db"\)/);
  });
});

