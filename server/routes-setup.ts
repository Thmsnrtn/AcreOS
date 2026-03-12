// @ts-nocheck
/**
 * Founder Setup API — Interactive Platform Configuration
 *
 * Lets the founder input, validate, and store all platform credentials
 * through the setup wizard UI. Credentials are encrypted in the DB and
 * patched into process.env so all existing services pick them up immediately.
 *
 * Endpoints:
 *   GET  /api/founder/setup/status            — all credential statuses
 *   POST /api/founder/setup/save              — save one or more credentials
 *   POST /api/founder/setup/validate/:service — validate credentials for a service
 *   POST /api/founder/setup/wire/:service     — auto-wire service (webhooks, etc.)
 *   POST /api/founder/setup/generate/:type    — generate SESSION_SECRET, ENCRYPTION_KEY, etc.
 *   GET  /api/founder/setup/readiness         — overall readiness score (0-100)
 */

import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import {
  getConfigStatus,
  saveCredential,
  deleteCredential,
  markValidated,
  CREDENTIAL_DEFINITIONS,
  SERVICE_GROUPS,
} from "./services/configManager";
import { isFounderEmail } from "./services/founder";

const router = Router();

// ── Auth guard ────────────────────────────────────────────────────────────────

function requireFounder(req: any, res: any, next: any) {
  const email = req.user?.email || req.user?.claims?.email;
  if (!isFounderEmail(email)) {
    return res.status(403).json({ error: "Founder access required" });
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/founder/setup/status
// Returns full credential status + per-service summaries
// ─────────────────────────────────────────────────────────────────────────────

router.get("/status", requireFounder, async (req: Request, res: Response) => {
  try {
    const entries = await getConfigStatus();

    const byService: Record<string, { configured: number; total: number; requiredMissing: string[] }> = {};
    for (const entry of entries) {
      if (!byService[entry.service]) {
        byService[entry.service] = { configured: 0, total: 0, requiredMissing: [] };
      }
      byService[entry.service].total++;
      if (entry.hasValue) byService[entry.service].configured++;
      if (entry.isRequired && !entry.hasValue) {
        byService[entry.service].requiredMissing.push(entry.key);
      }
    }

    // Compute overall readiness score
    const required = entries.filter(e => e.isRequired);
    const configuredRequired = required.filter(e => e.hasValue);
    const optional = entries.filter(e => !e.isRequired);
    const configuredOptional = optional.filter(e => e.hasValue);

    const requiredScore = required.length > 0 ? (configuredRequired.length / required.length) * 70 : 70;
    const optionalScore = optional.length > 0 ? (configuredOptional.length / optional.length) * 30 : 30;
    const readinessScore = Math.round(requiredScore + optionalScore);

    const serviceGroups = SERVICE_GROUPS.map(sg => ({
      ...sg,
      ...byService[sg.service],
      allConfigured: (byService[sg.service]?.requiredMissing?.length ?? 0) === 0
        && (byService[sg.service]?.configured ?? 0) > 0,
    }));

    res.json({
      credentials: entries,
      serviceGroups,
      readinessScore,
      isLaunchReady: readinessScore >= 70,
      summary: {
        total: entries.length,
        configured: entries.filter(e => e.hasValue).length,
        requiredTotal: required.length,
        requiredConfigured: configuredRequired.length,
        missingRequired: required.filter(e => !e.hasValue).map(e => e.key),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/founder/setup/save
// Body: { credentials: { KEY: "value", ... } }
// ─────────────────────────────────────────────────────────────────────────────

router.post("/save", requireFounder, async (req: Request, res: Response) => {
  try {
    const { credentials } = req.body as { credentials: Record<string, string> };
    if (!credentials || typeof credentials !== "object") {
      return res.status(400).json({ error: "credentials object required" });
    }

    const defMap = new Map(CREDENTIAL_DEFINITIONS.map(d => [d.key, d]));
    const saved: string[] = [];
    const errors: string[] = [];

    for (const [key, value] of Object.entries(credentials)) {
      if (!value || typeof value !== "string") continue;
      const def = defMap.get(key);
      if (!def) {
        errors.push(`Unknown credential key: ${key}`);
        continue;
      }
      try {
        await saveCredential(key, value.trim(), {
          service: def.service,
          label: def.label,
          isSecret: def.isSecret,
          isRequired: def.isRequired,
        });
        saved.push(key);
      } catch (e: any) {
        errors.push(`${key}: ${e.message}`);
      }
    }

    res.json({ saved, errors });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/founder/setup/delete
// Body: { key: "CREDENTIAL_KEY" }
// ─────────────────────────────────────────────────────────────────────────────

router.post("/delete", requireFounder, async (req: Request, res: Response) => {
  try {
    const { key } = req.body as { key: string };
    if (!key) return res.status(400).json({ error: "key required" });
    await deleteCredential(key);
    res.json({ deleted: key });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/founder/setup/generate/:type
// Generates secure random values for SESSION_SECRET, FIELD_ENCRYPTION_KEY, MCP_API_KEY
// ─────────────────────────────────────────────────────────────────────────────

router.post("/generate/:type", requireFounder, async (req: Request, res: Response) => {
  try {
    const { type } = req.params;
    let value: string;
    let key: string;

    switch (type) {
      case "session-secret":
        value = crypto.randomBytes(48).toString("base64url"); // 64+ chars
        key = "SESSION_SECRET";
        break;
      case "encryption-key":
        value = crypto.randomBytes(32).toString("hex"); // exactly 64 hex chars
        key = "FIELD_ENCRYPTION_KEY";
        break;
      case "mcp-key":
        value = crypto.randomBytes(32).toString("base64url");
        key = "MCP_API_KEY";
        break;
      default:
        return res.status(400).json({ error: `Unknown type: ${type}` });
    }

    res.json({ key, value });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/founder/setup/validate/:service
// Tests credentials for a specific service by making a real API call
// ─────────────────────────────────────────────────────────────────────────────

router.post("/validate/:service", requireFounder, async (req: Request, res: Response) => {
  const { service } = req.params;

  try {
    switch (service) {
      case "stripe": {
        const key = process.env.STRIPE_SECRET_KEY;
        if (!key) return res.json({ status: "error", message: "STRIPE_SECRET_KEY not configured" });
        try {
          const { default: Stripe } = await import("stripe");
          const stripe = new Stripe(key, { apiVersion: "2025-01-27.acacia" });
          const account = await stripe.accounts.retrieve();
          await markValidated("STRIPE_SECRET_KEY", "ok", `Connected: ${account.email || account.id}`);
          const isLive = key.startsWith("sk_live_");
          return res.json({
            status: "ok",
            message: `Stripe connected${isLive ? " (LIVE mode)" : " (TEST mode)"}`,
            details: { email: account.email, id: account.id, livemode: isLive },
          });
        } catch (e: any) {
          await markValidated("STRIPE_SECRET_KEY", "error", e.message);
          return res.json({ status: "error", message: `Stripe: ${e.message}` });
        }
      }

      case "openrouter": {
        const key = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
        if (!key) return res.json({ status: "error", message: "AI_INTEGRATIONS_OPENROUTER_API_KEY not configured" });
        try {
          const resp = await fetch("https://openrouter.ai/api/v1/auth/key", {
            headers: { Authorization: `Bearer ${key}` },
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = await resp.json() as any;
          await markValidated("AI_INTEGRATIONS_OPENROUTER_API_KEY", "ok", `Credits: $${(data.data?.limit_remaining ?? "?")}`);
          return res.json({ status: "ok", message: "OpenRouter key valid", details: data.data });
        } catch (e: any) {
          await markValidated("AI_INTEGRATIONS_OPENROUTER_API_KEY", "error", e.message);
          return res.json({ status: "error", message: `OpenRouter: ${e.message}` });
        }
      }

      case "openai": {
        const key = process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
        if (!key) return res.json({ status: "error", message: "OPENAI_API_KEY not configured" });
        try {
          const resp = await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${key}` },
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          await markValidated("OPENAI_API_KEY", "ok", "Key valid");
          return res.json({ status: "ok", message: "OpenAI key valid" });
        } catch (e: any) {
          await markValidated("OPENAI_API_KEY", "error", e.message);
          return res.json({ status: "error", message: `OpenAI: ${e.message}` });
        }
      }

      case "aws": {
        const id = process.env.AWS_ACCESS_KEY_ID;
        const secret = process.env.AWS_SECRET_ACCESS_KEY;
        const region = process.env.AWS_REGION || "us-east-1";
        if (!id || !secret) return res.json({ status: "error", message: "AWS credentials not configured" });
        // SES identity list — minimal IAM permission required
        try {
          const { SESClient, ListIdentitiesCommand } = await import("@aws-sdk/client-ses");
          const ses = new SESClient({ region, credentials: { accessKeyId: id, secretAccessKey: secret } });
          const result = await ses.send(new ListIdentitiesCommand({ IdentityType: "Domain", MaxItems: 1 }));
          await markValidated("AWS_ACCESS_KEY_ID", "ok", "SES credentials valid");
          return res.json({ status: "ok", message: "AWS SES credentials valid", details: { identities: result.Identities } });
        } catch (e: any) {
          await markValidated("AWS_ACCESS_KEY_ID", "error", e.message);
          return res.json({ status: "error", message: `AWS SES: ${e.message}` });
        }
      }

      case "mapbox": {
        const token = process.env.VITE_MAPBOX_ACCESS_TOKEN || process.env.MAPBOX_PUBLIC_TOKEN;
        if (!token) return res.json({ status: "error", message: "Mapbox token not configured" });
        try {
          const resp = await fetch(`https://api.mapbox.com/tokens/v2?access_token=${token}`);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          await markValidated("VITE_MAPBOX_ACCESS_TOKEN", "ok", "Token valid");
          return res.json({ status: "ok", message: "Mapbox token valid" });
        } catch (e: any) {
          await markValidated("VITE_MAPBOX_ACCESS_TOKEN", "error", e.message);
          return res.json({ status: "error", message: `Mapbox: ${e.message}` });
        }
      }

      case "lob": {
        const key = process.env.LOB_API_KEY;
        if (!key) return res.json({ status: "error", message: "LOB_API_KEY not configured" });
        try {
          const resp = await fetch("https://api.lob.com/v1/accounts", {
            headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          await markValidated("LOB_API_KEY", "ok", "Lob key valid");
          return res.json({ status: "ok", message: "Lob API key valid" });
        } catch (e: any) {
          await markValidated("LOB_API_KEY", "error", e.message);
          return res.json({ status: "error", message: `Lob: ${e.message}` });
        }
      }

      case "twilio": {
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const token = process.env.TWILIO_AUTH_TOKEN;
        if (!sid || !token) return res.json({ status: "error", message: "Twilio credentials not configured" });
        try {
          const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
            headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = await resp.json() as any;
          await markValidated("TWILIO_ACCOUNT_SID", "ok", `Account: ${data.friendly_name}`);
          return res.json({ status: "ok", message: `Twilio: ${data.friendly_name}`, details: { status: data.status } });
        } catch (e: any) {
          await markValidated("TWILIO_ACCOUNT_SID", "error", e.message);
          return res.json({ status: "error", message: `Twilio: ${e.message}` });
        }
      }

      case "redis": {
        const url = process.env.REDIS_URL;
        if (!url) return res.json({ status: "warn", message: "REDIS_URL not configured — background jobs will run in-process" });
        try {
          const { createClient } = await import("redis");
          const client = createClient({ url });
          await client.connect();
          await client.ping();
          await client.disconnect();
          await markValidated("REDIS_URL", "ok", "Redis ping OK");
          return res.json({ status: "ok", message: "Redis connected" });
        } catch (e: any) {
          await markValidated("REDIS_URL", "error", e.message);
          return res.json({ status: "error", message: `Redis: ${e.message}` });
        }
      }

      default:
        return res.status(400).json({ error: `Unknown service: ${service}` });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/founder/setup/wire/:service
// Auto-wires a service (e.g. creates Stripe webhook pointing to this app)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/wire/:service", requireFounder, async (req: Request, res: Response) => {
  const { service } = req.params;

  try {
    switch (service) {
      case "stripe": {
        const key = process.env.STRIPE_SECRET_KEY;
        const appUrl = process.env.APP_URL;
        if (!key) return res.json({ status: "error", message: "STRIPE_SECRET_KEY not configured" });
        if (!appUrl) return res.json({ status: "error", message: "APP_URL not configured — needed to register webhook URL" });

        try {
          const { default: Stripe } = await import("stripe");
          const stripe = new Stripe(key, { apiVersion: "2025-01-27.acacia" });
          const webhookUrl = `${appUrl}/api/stripe/connect/webhook`;

          // Check if webhook already exists
          const existing = await stripe.webhookEndpoints.list({ limit: 20 });
          const alreadyExists = existing.data.find(w => w.url === webhookUrl);
          if (alreadyExists) {
            return res.json({
              status: "ok",
              message: "Stripe webhook already registered",
              details: { id: alreadyExists.id, url: webhookUrl },
            });
          }

          const webhook = await stripe.webhookEndpoints.create({
            url: webhookUrl,
            enabled_events: [
              "customer.subscription.created",
              "customer.subscription.updated",
              "customer.subscription.deleted",
              "invoice.payment_succeeded",
              "invoice.payment_failed",
              "payment_intent.succeeded",
              "payment_intent.payment_failed",
              "charge.dispute.created",
            ],
          });

          // Save the webhook secret to config
          if (webhook.secret) {
            await saveCredential("STRIPE_WEBHOOK_SECRET", webhook.secret, {
              service: "stripe",
              label: "Stripe Webhook Secret",
              isSecret: true,
              isRequired: true,
            });
          }

          return res.json({
            status: "ok",
            message: "Stripe webhook created and secret saved",
            details: { id: webhook.id, url: webhookUrl, secret: webhook.secret ? "saved" : "not returned" },
          });
        } catch (e: any) {
          return res.json({ status: "error", message: `Stripe wiring failed: ${e.message}` });
        }
      }

      default:
        return res.status(400).json({ error: `Auto-wiring not available for: ${service}` });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/founder/setup/readiness
// Returns readiness score 0-100 with per-service breakdown
// ─────────────────────────────────────────────────────────────────────────────

router.get("/readiness", requireFounder, async (req: Request, res: Response) => {
  try {
    const entries = await getConfigStatus();

    const required = entries.filter(e => e.isRequired);
    const configuredRequired = required.filter(e => e.hasValue);
    const optional = entries.filter(e => !e.isRequired);
    const configuredOptional = optional.filter(e => e.hasValue);

    const requiredScore = required.length > 0 ? (configuredRequired.length / required.length) * 70 : 70;
    const optionalScore = optional.length > 0 ? (configuredOptional.length / optional.length) * 30 : 30;
    const score = Math.round(requiredScore + optionalScore);

    const missingRequired = required.filter(e => !e.hasValue).map(e => ({ key: e.key, label: e.label, service: e.service }));
    const missingOptional = optional.filter(e => !e.hasValue).map(e => ({ key: e.key, label: e.label, service: e.service }));

    res.json({
      score,
      isLaunchReady: score >= 70,
      requiredConfigured: configuredRequired.length,
      requiredTotal: required.length,
      optionalConfigured: configuredOptional.length,
      optionalTotal: optional.length,
      missingRequired,
      missingOptional,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
