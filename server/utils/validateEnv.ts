import { logger } from "./logger";
/**
 * Validates required environment variables at startup.
 * Call this at the very top of server/index.ts before any other initialization.
 * Exits with code 1 and a clear error message if any required variable is missing or invalid.
 */
export function validateEnv(): void {
  const errors: string[] = [];

  if (!process.env.DATABASE_URL) {
    errors.push("DATABASE_URL is required (e.g. postgresql://user:pass@host:5432/dbname)");
  }

  if (!process.env.CLERK_SECRET_KEY) {
    errors.push("CLERK_SECRET_KEY is required — get it from clerk.com dashboard");
  }

  if (!process.env.ENCRYPTION_KEY) {
    errors.push(
      "ENCRYPTION_KEY is required — generate with: openssl rand -hex 32  (used for AES-256-GCM credential encryption)"
    );
  }

  if (errors.length > 0) {
    // Separate hard errors from soft warnings (optional services)
    const hardErrorKeys = ["DATABASE_URL", "CLERK_SECRET_KEY"];
    const hardErrors = errors.filter(e => hardErrorKeys.some(k => e.includes(k)));
    const warnings = errors.filter(e => !hardErrorKeys.some(k => e.includes(k)));

    if (warnings.length > 0) {
      logger.warn("\n[startup] ⚠️  Missing recommended environment variables:\n" +
          warnings.map((e) => `  • ${e}`).join("\n") +
          "\n");
    }

    if (hardErrors.length > 0) {
      logger.error("\n[startup] ❌ Environment validation failed — fix the following before starting the server:\n" +
          hardErrors.map((e) => `  • ${e}`).join("\n") +
          "\n");
      process.exit(1);
    }
  }
}
