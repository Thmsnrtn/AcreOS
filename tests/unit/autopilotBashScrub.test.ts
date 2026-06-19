import { describe, it, expect } from "vitest";
import { scrubSecretsFromEnv, executeDispatchTool } from "../../server/services/solene/dispatchToolExecutor";

describe("scrubSecretsFromEnv — autonomous bash gets ONLY an allowlist (elite-audit P0, re-audit it.2)", () => {
  it("keeps the operational allowlist but strips everything else (default-deny)", () => {
    const env = {
      PATH: "/usr/bin",
      HOME: "/home/x",
      LANG: "en_US.UTF-8",
      NODE_ENV: "production",
      DATABASE_URL: "postgres://secret",
      STRIPE_SECRET_KEY: "sk_live_x",
      ANTHROPIC_API_KEY: "ant_x",
      ENCRYPTION_KEY: "k",
      DEPLOY_BOT_TOKEN: "ghp_x",
      SESSION_SECRET: "s",
      AWS_SECRET_ACCESS_KEY: "a",
      TWILIO_AUTH_TOKEN: "t",
      SENTRY_DSN: "https://dsn",
      // re-audit it.2: the denylist MISSED these — allowlist must still drop them.
      DATABASE_REPLICA_URL: "postgres://replica",
      REDIS_URL: "redis://secret",
      OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer xyz",
      // a brand-new secret under a name no pattern anticipated — allowlist drops it.
      ACME_FROBNICATOR_APIKEY: "leak",
      MAPBOX_ACCESS_TOKEN: "pk.x",
    } as NodeJS.ProcessEnv;
    const out = scrubSecretsFromEnv(env);
    // kept (non-secret, needed for tooling)
    expect(out.PATH).toBe("/usr/bin");
    expect(out.HOME).toBe("/home/x");
    expect(out.LANG).toBe("en_US.UTF-8");
    expect(out.NODE_ENV).toBe("production");
    // stripped — every secret, including the ones the old denylist missed AND a
    // never-seen-before var name (the whole point of default-deny).
    for (const k of [
      "DATABASE_URL", "STRIPE_SECRET_KEY", "ANTHROPIC_API_KEY", "ENCRYPTION_KEY",
      "DEPLOY_BOT_TOKEN", "SESSION_SECRET", "AWS_SECRET_ACCESS_KEY", "TWILIO_AUTH_TOKEN",
      "SENTRY_DSN", "DATABASE_REPLICA_URL", "REDIS_URL", "OTEL_EXPORTER_OTLP_HEADERS",
      "ACME_FROBNICATOR_APIKEY", "MAPBOX_ACCESS_TOKEN",
    ]) {
      expect(out[k], `${k} must be stripped`).toBeUndefined();
    }
  });
});

describe("file_read — raw secret files are refused unconditionally (re-audit it.2 file_read bypass)", () => {
  it("refuses .env / .env.local / *.pem / credentials.json (closes the scrub bypass + chat auto-allow leak)", async () => {
    for (const p of [".env", ".env.local", ".env.production", "config/secrets.json", "deploy/key.pem", "x/credentials.json", "home/.npmrc"]) {
      const r = await executeDispatchTool("file_read", { path: p });
      expect(r.success, `${p} must be refused`).toBe(false);
      expect(r.output, `${p}`).toMatch(/REFUSED|secret-shaped/i);
    }
  });

  it("still reads an ordinary source file", async () => {
    const r = await executeDispatchTool("file_read", { path: "package.json" });
    expect(r.success).toBe(true);
    expect(r.output).toContain("\"name\"");
  });
});
