/**
 * Worker runtime bootstrap — the `server/index.ts` side effects the worker
 * actually needs, made explicit.
 *
 * Until the `log` import cycle was broken, `server/worker.ts` evaluated
 * `server/index.ts` as a side effect of importing `jobQueue` (via
 * runScheduledJobs). That silently gave the worker everything below — and also
 * a web server on :5000 and a second `runScheduledJobs()`. With the cycle gone
 * the worker gets ONLY what it asks for, so each dependency is named here
 * instead of left to an accident of import order.
 *
 * Deliberately NOT here (app-only, nothing a scheduled job reads): the Express
 * app, `registerRoutes`, `httpServer.listen`, `wsServer.initialize(httpServer)`,
 * `secretColumnGuard`, the CMO/settings/tax-rule boot seeders (the app still
 * runs them; they are idempotent), and the app's own uncaught-exception
 * handlers (the worker installs a stricter crash-exit pair of its own).
 */
import { assertTestAuthSafe } from "./auth/testAuth";
import { validateEnv } from "./utils/validateEnv";
import { validateSecrets } from "./middleware/secretsValidation";
import { logIntegrationReadiness } from "./services/integrationReadiness";
import { installConsoleInterceptor } from "./middleware/piiMasking";
import { initializeProviders } from "./providers-init";
import { wsServer } from "./websocket";
import { realtimeAlertsService } from "./services/realtimeAlerts";
import { initTracing } from "./tracing";
import { logger } from "./utils/logger";

/**
 * Synchronous half: env/secret validation (exit on misconfiguration, as the
 * app does), the test-auth hard-exit guard, PII console masking, the data
 * provider registry (scheduled ETL/enrichment jobs resolve providers through
 * it), and the realtime-alert bridge. `setWebSocketServer(wsServer)` is what
 * opens the Redis publisher that carries alerts raised in the worker to app
 * machines; without it `publish` is skipped and worker-raised alerts vanish.
 * `wsServer.initialize(httpServer)` is intentionally not called — the worker
 * must not bind a port.
 */
export function bootWorkerRuntimeSync(): void {
  validateEnv();
  assertTestAuthSafe();
  validateSecrets();
  logIntegrationReadiness();
  installConsoleInterceptor();
  initializeProviders();
  realtimeAlertsService.setWebSocketServer(wsServer);
}

/**
 * Async half: tracing, and the founder-configured credentials stored in the DB
 * (`loadConfigToEnv` copies them into process.env — jobs read keys from env,
 * so scheduled jobs must not start before this settles). Non-fatal, as in the
 * app: a DB that is not ready logs and continues.
 */
export async function bootWorkerRuntimeAsync(): Promise<void> {
  try {
    await initTracing();
  } catch (e) {
    logger.warn(`[worker] tracing init skipped: ${(e as Error).message}`);
  }
  try {
    const { loadConfigToEnv } = await import("./services/configManager");
    await loadConfigToEnv();
  } catch (e) {
    logger.warn(`[worker] configManager load skipped: ${(e as Error).message}`);
  }
}
