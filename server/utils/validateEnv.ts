import { logger } from "./logger";

/**
 * Beatrice / compliance-debt §3 — throwing guard for the field-encryption key.
 *
 * Hard-requires FIELD_ENCRYPTION_KEY (or legacy ENCRYPTION_KEY) for any process
 * that can reach encrypted prod data, INDEPENDENT of NODE_ENV. Unlike
 * validateEnv() (which calls process.exit), this throws so it is unit-testable
 * and so non-server entrypoints (workers, migrate, scheduled jobs) can fail
 * loudly at boot. Never logs the key value — only checks presence.
 */
export function requireEncryptionKey(): void {
  if (!process.env.FIELD_ENCRYPTION_KEY && !process.env.ENCRYPTION_KEY) {
    throw new Error(
      "FIELD_ENCRYPTION_KEY (or legacy ENCRYPTION_KEY) is required for any process " +
      "that touches encrypted columns (founder-vault / skip-trace PII / BYOK secrets). " +
      "Generate with: openssl rand -hex 32. This requirement holds regardless of NODE_ENV.",
    );
  }
}

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

  // Beatrice / compliance-debt §3 — the field-encryption key is HARD-REQUIRED
  // for every process that can reach prod data, independent of NODE_ENV. Any
  // process touching the encrypted columns (founder vault, skip-trace PII, BYOK
  // secrets) — web, worker, migrate, scheduled jobs — must boot with a real
  // key. Without it, fieldEncryption falls back to an ephemeral per-boot key
  // and previously-written ciphertext becomes undecryptable. We accept either
  // FIELD_ENCRYPTION_KEY (canonical) or ENCRYPTION_KEY (legacy). We never log
  // the value; we only check presence.
  if (!process.env.FIELD_ENCRYPTION_KEY && !process.env.ENCRYPTION_KEY) {
    errors.push(
      "FIELD_ENCRYPTION_KEY (or legacy ENCRYPTION_KEY) is required — generate with: openssl rand -hex 32  (used for AES-256-GCM encryption of founder-vault / skip-trace PII / BYOK secrets). Required on every process that can reach prod data, regardless of NODE_ENV."
    );
  }

  if (errors.length > 0) {
    // Separate hard errors from soft warnings (optional services).
    // FIELD_ENCRYPTION_KEY/ENCRYPTION_KEY are now HARD errors: a process
    // without them must refuse to boot rather than silently use the ephemeral
    // dev key against prod data.
    const hardErrorKeys = ["DATABASE_URL", "CLERK_SECRET_KEY", "FIELD_ENCRYPTION_KEY", "ENCRYPTION_KEY"];
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
