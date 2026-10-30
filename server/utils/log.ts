/**
 * Timestamped one-line logger shared by modules that must NOT import
 * `server/index.ts`.
 *
 * `log` used to be exported from `server/index.ts`. Importing it from there
 * evaluates the whole entrypoint — Express app, `registerRoutes`,
 * `httpServer.listen`, and a second `runScheduledJobs()` — so any process that
 * merely imported `jobQueue` (the worker, via runScheduledJobs) booted a web
 * server and a second scheduler. Keep this module free of imports from
 * `server/index.ts`; `importingJobQueueDoesNotBootServer.test.ts` pins it.
 */
import { logger } from "./logger";
import { clock } from "./clock";

export function log(message: string, source = "express") {
  const formattedTime = clock.now().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  logger.info(`${formattedTime} [${source}] ${message}`);
}
