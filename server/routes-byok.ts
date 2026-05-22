/**
 * /api/byok — Universal BYOK API.
 *
 * Pillar 5 cross-cutting (2026-05-22). Customer-facing surface for the
 * "bring-your-own-key" panel at /settings/byok.
 *
 *   GET    /api/byok          → list current org's credential metadata
 *                               (channel, fingerprint, lifecycle dates).
 *                               NEVER returns plaintext.
 *   POST   /api/byok          → set a credential. Body:
 *                               { channel, plaintext, requireValidation? }
 *                               Optionally calls the provider's whoami/account
 *                               endpoint to validate before storing.
 *   DELETE /api/byok/:channel → revoke the active credential.
 *
 * Tier gate: BYOK is a Pro+ feature. Free/Starter callers receive 403.
 * Customer-facing rationale: BYOK lanes are a support-heavy path — we
 * scope them to tiers where the unit economics justify the support
 * overhead.
 *
 * Audit: every mutation lands in founder_audit via key-vault helpers; the
 * route itself is intentionally thin.
 */

import { Router, type Response } from "express";
import { z } from "zod";
import {
  setByokCredential,
  revokeByokCredential,
  listByokCredentials,
} from "./services/byok/key-vault";
import { BYOK_CHANNELS, type ByokChannel } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getOrganization } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { tierForSubscriptionTier } from "@shared/billing/tier-pricing";

const router = Router();

/**
 * Tier gate — BYOK is Pro+ only. Founder bypass is automatic because
 * `req.isFounder` orgs are typically on a paid tier; if a founder org is
 * misconfigured we still let them through to dogfood the flow.
 */
function requirePro(req: AuthenticatedRequest, res: Response): boolean {
  if (req.isFounder) return true;
  const org = getOrganization(req);
  const tier = tierForSubscriptionTier(org.subscriptionTier);
  if (tier === "pro" || tier === "scale") return true;
  Errors.forbidden(
    res,
    "BYOK is available on the Pro plan and above. Upgrade to bring your own provider keys.",
  );
  return false;
}

const setBodySchema = z.object({
  channel: z.enum(BYOK_CHANNELS as unknown as [string, ...string[]]),
  plaintext: z.string().min(8, "credential too short").max(8192, "credential too long"),
  requireValidation: z.boolean().optional(),
}).strict();

/**
 * Best-effort credential validation. Calls the provider's "whoami" /
 * account-info endpoint to confirm the key authenticates. Soft-fails (we
 * don't reject the store on network errors), but throws when the
 * provider explicitly returns 401/403 so the UI can show "key rejected
 * by provider".
 */
async function validateCredential(channel: ByokChannel, plaintext: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    switch (channel) {
      case "anthropic": {
        // Cheap auth probe — list models endpoint requires only auth.
        const r = await fetch("https://api.anthropic.com/v1/models", {
          headers: { "x-api-key": plaintext, "anthropic-version": "2023-06-01" },
        });
        if (r.status === 401 || r.status === 403) return { ok: false, reason: "Anthropic rejected the key" };
        return { ok: true };
      }
      case "openai":
      case "openrouter": {
        const base = channel === "openai" ? "https://api.openai.com" : "https://openrouter.ai/api";
        const r = await fetch(`${base}/v1/models`, {
          headers: { Authorization: `Bearer ${plaintext}` },
        });
        if (r.status === 401 || r.status === 403) return { ok: false, reason: `${channel} rejected the key` };
        return { ok: true };
      }
      case "sendgrid": {
        const r = await fetch("https://api.sendgrid.com/v3/user/account", {
          headers: { Authorization: `Bearer ${plaintext}` },
        });
        if (r.status === 401 || r.status === 403) return { ok: false, reason: "SendGrid rejected the key" };
        return { ok: true };
      }
      case "lob": {
        // Lob uses Basic auth with the API key as the username.
        const auth = Buffer.from(`${plaintext}:`).toString("base64");
        const r = await fetch("https://api.lob.com/v1/addresses?limit=1", {
          headers: { Authorization: `Basic ${auth}` },
        });
        if (r.status === 401 || r.status === 403) return { ok: false, reason: "Lob rejected the key" };
        return { ok: true };
      }
      case "twilio": {
        // Expected format: "<accountSid>:<authToken>:<phoneNumber>".
        const parts = plaintext.split(":");
        if (parts.length !== 3) return { ok: false, reason: "Twilio key must be formatted accountSid:authToken:phoneNumber" };
        const [sid, token] = parts;
        const auth = Buffer.from(`${sid}:${token}`).toString("base64");
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
          headers: { Authorization: `Basic ${auth}` },
        });
        if (r.status === 401 || r.status === 403) return { ok: false, reason: "Twilio rejected the credentials" };
        return { ok: true };
      }
      case "mapbox": {
        const r = await fetch(`https://api.mapbox.com/tokens/v2?access_token=${encodeURIComponent(plaintext)}`);
        if (r.status === 401 || r.status === 403) return { ok: false, reason: "Mapbox rejected the token" };
        return { ok: true };
      }
      // batch_skiptracing, postgrid, ses, telnyx, s3 — no cheap auth-only
      // probe; skip validation, defer to first real use.
      default:
        return { ok: true };
    }
  } catch (err) {
    logger.warn(`[byok] validateCredential network error for ${channel} — accepting`, err instanceof Error ? err : undefined);
    return { ok: true };
  }
}

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!requirePro(req, res)) return;
    const organizationId = getOrganizationId(req);
    const credentials = await listByokCredentials(organizationId);
    // Derive a per-channel status snapshot so the UI can render one row
    // per supported channel without doing this client-side.
    const activeByChannel = new Map<string, typeof credentials[number]>();
    for (const c of credentials) {
      if (!c.revokedAt && !activeByChannel.has(c.channel)) {
        activeByChannel.set(c.channel, c);
      }
    }
    const channels = BYOK_CHANNELS.map((ch) => {
      const active = activeByChannel.get(ch) ?? null;
      return {
        channel: ch,
        status: active ? "byok" : "platform",
        fingerprint: active?.fingerprint ?? null,
        lastUsedAt: active?.lastUsedAt ?? null,
        createdAt: active?.createdAt ?? null,
      };
    });
    res.json({ channels, history: credentials });
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!requirePro(req, res)) return;
    const organizationId = getOrganizationId(req);
    const parsed = setBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const { channel, plaintext, requireValidation } = parsed.data;

    if (requireValidation) {
      const v = await validateCredential(channel as ByokChannel, plaintext);
      if (!v.ok) {
        return Errors.badRequest(res, v.reason ?? "Provider rejected the credential");
      }
    }

    const meta = await setByokCredential({
      organizationId,
      channel: channel as ByokChannel,
      plaintext,
    });
    res.json({ ok: true, credential: meta });
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.delete("/:channel", async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!requirePro(req, res)) return;
    const organizationId = getOrganizationId(req);
    const channel = req.params.channel;
    if (!BYOK_CHANNELS.includes(channel as ByokChannel)) {
      return Errors.badRequest(res, `Unknown channel: ${channel}`);
    }
    const revoked = await revokeByokCredential({
      organizationId,
      channel: channel as ByokChannel,
    });
    if (!revoked) {
      return Errors.notFound(res, "BYOK credential");
    }
    res.json({ ok: true, channel });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
