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

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    errors.push("SESSION_SECRET is required — generate with: openssl rand -hex 64");
  } else if (secret.length < 32) {
    errors.push(`SESSION_SECRET is too short (${secret.length} chars) — must be at least 32 characters`);
  }

  if (process.env.NODE_ENV === "production") {
    if (!process.env.APP_URL) {
      errors.push(
        "APP_URL is required in production — it is used in password reset email links (e.g. https://app.yourdomain.com)"
      );
    }

    if (!process.env.AWS_SES_FROM_EMAIL) {
      errors.push(
        "AWS_SES_FROM_EMAIL is required in production — it is used as the sender address for all transactional emails"
      );
    }
  }

  if (errors.length > 0) {
    console.error(
      "\n[startup] ❌ Environment validation failed — fix the following before starting the server:\n" +
        errors.map((e) => `  • ${e}`).join("\n") +
        "\n"
    );
    process.exit(1);
  }
}
