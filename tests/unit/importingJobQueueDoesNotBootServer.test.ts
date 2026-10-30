/**
 * `importing jobQueue does not boot the server` (scheduler double-boot fix,
 * 2026-10).
 *
 * The defect: `server/services/jobQueue.ts` and `server/jobs/dbBackup.ts`
 * imported `log` from `server/index.ts`. Evaluating index.ts fires its
 * top-level IIFE — Express app, registerRoutes, httpServer.listen on :5000,
 * and a second runScheduledJobs() — so the WORKER (which imports jobQueue via
 * runScheduledJobs) silently became a web server with a second scheduler.
 *
 * This runs the import in a FRESH process and observes what happened, rather
 * than grepping for the import line: a forbidden import reintroduced through
 * any equivalent path (a re-export, a new module that imports index) makes the
 * child create an http server / fail validateEnv, and this goes red.
 */
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function probe(modulePath: string): Promise<{ out: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "tests/helpers/importProbe.mts", path.join(ROOT, modulePath)],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          NODE_ENV: "test",
          // Dummies so a regression gets far enough to bind a server rather
          // than dying early in validateEnv. Never contacted: pools are lazy.
          DATABASE_URL: "postgres://probe:probe@127.0.0.1:1/probe",
          CLERK_SECRET_KEY: "sk_test_probe",
          FIELD_ENCRYPTION_KEY: "0".repeat(64),
        },
      },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ out, code }));
  });
}

describe("importing jobQueue does not boot the server", () => {
  for (const mod of ["server/services/jobQueue.ts", "server/jobs/dbBackup.ts"]) {
    it(`${mod}: no HTTP server, no listener, no background loop`, async () => {
      const { out, code } = await probe(mod);
      const line = out.split("\n").find((l) => l.startsWith("PROBE "));
      // The probe line only prints if the module imported AND the process was
      // still alive after the entrypoint's async boot window.
      expect(line, `probe produced no result (exit ${code}):\n${out.slice(-1500)}`).toBeDefined();
      expect(JSON.parse(line!.slice("PROBE ".length))).toEqual({
        httpServersCreated: 0,
        listenCalls: 0,
        backgroundIntervals: 0,
      });
    }, 90_000);
  }
});
