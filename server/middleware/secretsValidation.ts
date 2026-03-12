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
  // Task #3: SESSION_SECRET must be ≥64 chars in production to prevent brute-force of signed cookies
  { key: "SESSION_SECRET", required: true, minLength: 64, description: "Express session secret (64+ random chars)" },
  { key: "APP_URL", required: true, description: "Public app URL (no trailing slash, e.g. https://app.example.com)" },

  // Founder access
  { key: "FOUNDER_EMAIL", required: false, description: "Comma-separated founder email(s) for admin access" },

  // Task #21: Field encryption key — required in production (AES-256 key = 32 bytes = 64 hex chars)
  // Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  { key: "FIELD_ENCRYPTION_KEY", required: false, minLength: 64, description: "AES-256 field encryption key (64 hex chars = 32 bytes)", productionOnly: true },

  // AI — OpenRouter is the primary AI provider (routes to Claude, GPT-4o, DeepSeek)
  { key: "AI_INTEGRATIONS_OPENROUTER_API_KEY", required: false, description: "OpenRouter API key — primary AI provider (required for all AI features)", productionOnly: true },
  { key: "AI_INTEGRATIONS_OPENAI_API_KEY", required: false, description: "OpenAI API key — fallback AI provider" },
  { key: "OPENAI_API_KEY", required: false, description: "Fallback OpenAI API key (legacy)" },

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

  // MCP
  { key: "MCP_API_KEY", required: false, description: "Bearer token for MCP endpoint authentication", productionOnly: true },

  // Error tracking
  { key: "SENTRY_DSN", required: false, description: "Sentry DSN for error tracking", productionOnly: true },

  // Redis
  { key: "REDIS_URL", required: false, description: "Redis URL for BullMQ + caching (required in production for job durability)", productionOnly: true },
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

  // Log warnings
  if (warnings.length > 0) {
    console.warn("\n⚠️  [secrets] Configuration warnings:");
    warnings.forEach((w) => console.warn(`   ${w}`));
    console.warn("");
  }

  // Fail hard on errors in production
  if (errors.length > 0) {
    console.error("\n🚨 [secrets] FATAL: Missing required environment variables:");
    errors.forEach((e) => console.error(`   ${e}`));
    if (isProduction) {
      console.error("\nServer cannot start in production with missing required secrets.\n");
      process.exit(1);
    } else {
      console.error("\n(Running in development — continuing with warnings)\n");
    }
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log("[secrets] All required environment variables validated ✓");
  }
}
