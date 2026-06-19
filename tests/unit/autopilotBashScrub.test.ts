import { describe, it, expect } from "vitest";
import { scrubSecretsFromEnv } from "../../server/services/solene/dispatchToolExecutor";

describe("scrubSecretsFromEnv — autonomous bash gets no prod credentials (elite-audit P0)", () => {
  it("strips every credential-shaped variable but keeps PATH/HOME so git/node still work", () => {
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
    } as NodeJS.ProcessEnv;
    const out = scrubSecretsFromEnv(env);
    // kept (non-secret, needed for tooling)
    expect(out.PATH).toBe("/usr/bin");
    expect(out.HOME).toBe("/home/x");
    expect(out.LANG).toBe("en_US.UTF-8");
    expect(out.NODE_ENV).toBe("production");
    // stripped (every secret — closes the deploy/exfil/money-via-creds paths)
    for (const k of ["DATABASE_URL", "STRIPE_SECRET_KEY", "ANTHROPIC_API_KEY", "ENCRYPTION_KEY", "DEPLOY_BOT_TOKEN", "SESSION_SECRET", "AWS_SECRET_ACCESS_KEY", "TWILIO_AUTH_TOKEN", "SENTRY_DSN"]) {
      expect(out[k], `${k} must be stripped`).toBeUndefined();
    }
  });
});
