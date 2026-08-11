import { logger } from "../utils/logger";
/**
 * T15 — Secrets Management Validation
 *
 * Validates required environment variables at startup.
 * Logs clear warnings for missing or obviously-insecure values.
 * In production, refuses to start if critical secrets are absent.
 *
 * Call validateSecrets() early in server/index.ts before any routes are
 * registered so failures are obvious and not buried in request logs.
 */

interface SecretSpec {
  key: string;
  required: boolean;
  minLength?: number;
  description: string;
  productionOnly?: boolean;
}

const SECRETS: SecretSpec[] = [
  // Critical — app will not function without these
  { key: "DATABASE_URL", required: true, description: "PostgreSQL connection string" },
  // SESSION_SECRET should be long but 32+ is cryptographically sufficient
  { key: "SESSION_SECRET", required: true, minLength: 32, description: "Express session secret (32+ random chars)" },
  { key: "APP_URL", required: false, description: "Public app URL (no trailing slash, e.g. https://app.example.com)", productionOnly: true },

  // Founder access
  { key: "FOUNDER_EMAIL", required: false, description: "Comma-separated founder email(s) for admin access" },

  // Task #21: Field encryption key — required in production (AES-256 key = 32 bytes = 64 hex chars)
  // R3 (skip-trace PII at-rest encryption) flipped this to required: the app
  // refuses to boot in production without a stable key. Without it, every
  // restart would either re-derive a new key from SESSION_SECRET (and silently
  // make existing skip_traces / tax-id ciphertexts undecryptable) or run with
  // a known-insecure dev fallback.
  // Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  { key: "FIELD_ENCRYPTION_KEY", required: true, minLength: 64, description: "AES-256 field encryption key (64 hex chars = 32 bytes)", productionOnly: true },

  // AI — OpenRouter is the SOLE chat/completion provider for the platform.
  // The tiered router in services/aiRouter.ts maps complexity → model
  // (SIMPLE→DeepSeek, MODERATE→Haiku, COMPLEX→Sonnet, CRITICAL→Opus) which
  // keeps cost as low as the task allows. OPENAI_API_KEY is retained for
  // Whisper transcription only (routes-field-scout.ts) —
  // OpenRouter doesn't proxy /v1/audio so audio callers hit OpenAI directly.
  { key: "AI_INTEGRATIONS_OPENROUTER_API_KEY", required: false, description: "OpenRouter API key — sole chat/completion provider", productionOnly: true },
  { key: "OPENAI_API_KEY", required: false, description: "OpenAI key for Whisper audio transcription only (no longer used for chat)" },

  // Email
  { key: "AWS_ACCESS_KEY_ID", required: false, description: "AWS access key for SES email sending" },
  { key: "AWS_SECRET_ACCESS_KEY", required: false, description: "AWS secret for SES" },
  { key: "AWS_REGION", required: false, description: "AWS region (e.g. us-east-1)" },

  // Payments
  { key: "STRIPE_SECRET_KEY", required: false, description: "Stripe secret key for billing" },
  { key: "STRIPE_WEBHOOK_SECRET", required: false, description: "Stripe webhook signature secret", productionOnly: true },

  // Maps
  { key: "VITE_MAPBOX_ACCESS_TOKEN", required: false, description: "Mapbox public token for map rendering" },

  // Comms
  { key: "TWILIO_ACCOUNT_SID", required: false, description: "Twilio account SID for SMS/voice" },
  { key: "TWILIO_AUTH_TOKEN", required: false, description: "Twilio auth token" },

  // MCP — no secrets. Founder ruling R-1 (2026-08-11) retired MCP_API_KEY and
  // its MCP_ORG_ID binding along with the `/mcp` endpoint they authenticated.
  // POST /api/mcp authenticates per-org api_keys rows, which carry their own
  // org AND scopes, so there is no MCP env secret left to validate.

  // Error tracking
  { key: "SENTRY_DSN", required: false, description: "Sentry DSN for error tracking", productionOnly: true },

  // Redis
  { key: "REDIS_URL", required: false, description: "Redis URL for BullMQ + caching (required in production for job durability)", productionOnly: true },

  // Cryptographic secrets — DEFECT-0034: must not use hardcoded fallbacks in production
  { key: "DOCUMENT_SIGNING_SECRET", required: false, minLength: 32, description: "HMAC secret for deal-room document signed URLs", productionOnly: true },
  { key: "CERT_SECRET", required: false, minLength: 32, description: "Secret for course-completion certificate verification hashes", productionOnly: true },
  { key: "INBOUND_EMAIL_HMAC_SECRET", required: false, minLength: 32, description: "HMAC secret for inbound email reply-to address verification", productionOnly: true },
  // F2 — Inbound email webhook signature secret (required when not using SNS-only mode).
  // The route handler itself (server/middleware/inboundEmailSignature.ts) throws
  // at boot if neither this secret nor INBOUND_EMAIL_SNS_ONLY=1 is configured
  // in production; this entry just surfaces the warning early.
  { key: "INBOUND_EMAIL_WEBHOOK_SECRET", required: false, minLength: 32, description: "HMAC-SHA256 secret for inbound email webhook signing (or set INBOUND_EMAIL_SNS_ONLY=1 to require AWS SNS)", productionOnly: true },
];

export function validateSecrets(): void {
  const isProduction = process.env.NODE_ENV === "production";
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const spec of SECRETS) {
    const value = process.env[spec.key];

    if (!value) {
      if (spec.required) {
        errors.push(`MISSING REQUIRED: ${spec.key} — ${spec.description}`);
      } else if (spec.productionOnly && isProduction) {
        warnings.push(`MISSING (production): ${spec.key} — ${spec.description}`);
      }
      continue;
    }

    // Check minimum length for secrets that should be long
    if (spec.minLength && value.length < spec.minLength) {
      const msg = `WEAK: ${spec.key} is only ${value.length} chars (min ${spec.minLength}) — ${spec.description}`;
      if (spec.required && isProduction) {
        errors.push(msg);
      } else {
        warnings.push(msg);
      }
    }

    // Detect placeholder values
    const placeholders = ["changeme", "your-secret", "xxx", "todo", "placeholder", "example"];
    if (placeholders.some((p) => value.toLowerCase().includes(p))) {
      warnings.push(`PLACEHOLDER DETECTED: ${spec.key} looks like a placeholder value`);
    }
  }

  // Hessam §2.4 — Twilio webhook signature validation must never silently
  // bypass. If a Twilio account is configured (TWILIO_ACCOUNT_SID present)
  // we MUST also have TWILIO_AUTH_TOKEN, otherwise the signature middleware
  // would reject every inbound webhook at runtime. Throw on boot instead.
  if (process.env.TWILIO_ACCOUNT_SID && !process.env.TWILIO_AUTH_TOKEN) {
    errors.push(
      "MISSING REQUIRED: TWILIO_AUTH_TOKEN — needed to validate Twilio webhook signatures (TWILIO_ACCOUNT_SID is set, so SMS is in use)"
    );
  }

  // Log warnings
  if (warnings.length > 0) {
    logger.warn("\n⚠️  [secrets] Configuration warnings:");
    warnings.forEach((w) => logger.warn(`   ${w}`));
    logger.warn("");
  }

  // Fail hard on errors in production
  if (errors.length > 0) {
    logger.error("\n🚨 [secrets] FATAL: Missing required environment variables:");
    errors.forEach((e) => logger.error(`   ${e}`));
    if (isProduction) {
      logger.error("\nServer cannot start in production with missing required secrets.\n");
      process.exit(1);
    } else {
      logger.error("\n(Running in development — continuing with warnings)\n");
    }
  }

  if (errors.length === 0 && warnings.length === 0) {
    logger.info("[secrets] All required environment variables validated ✓");
  }
}
