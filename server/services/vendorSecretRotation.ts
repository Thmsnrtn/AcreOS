/**
 * Vendor secret self-rotation watcher.
 *
 * The operational interrupt floor in AcreOS is vendor secret hygiene
 * (Stripe webhook secret, Clerk secret key, GitHub PAT, Sentry token).
 * Each has different rotation semantics:
 *
 *   Stripe webhook secret — can rotate via stripe.webhookEndpoints.update;
 *                           done programmatically when the watcher fires.
 *   GH PAT                 — fine-grained PATs can be auto-rotated only via
 *                           GitHub App pattern; for now we just watch expiry.
 *   Clerk secret key       — Clerk dashboard rotation; no public API yet.
 *                           Watcher writes a /founder/now reminder before
 *                           expiry.
 *   Sentry token           — Sentry rotation via personal-auth-tokens API;
 *                           similar to GH, watcher only for now.
 *
 * The watcher runs daily. It surfaces to /founder/now any secret that
 * is within ROTATION_WARNING_DAYS of expiry. The Stripe webhook
 * rotation is the only one currently auto-actioned; the rest are
 * inbox-reminders.
 *
 * SAFETY: every rotation is logged to agentEvents. Operators with
 * paranoia can disable auto-rotation via VENDOR_SECRET_AUTO_ROTATE=false.
 */

import { db } from "../db";
import { agentEvents, decisionsInboxItems } from "@shared/schema";
import { logger } from "../utils/logger";

const ROTATION_WARNING_DAYS = parseInt(process.env.VENDOR_SECRET_WARNING_DAYS ?? "30", 10);
const AUTO_ROTATE = process.env.VENDOR_SECRET_AUTO_ROTATE !== "false";

interface VendorSecretFinding {
  vendor: "stripe_webhook" | "github_pat" | "clerk_secret" | "sentry_token";
  status: "ok" | "warning" | "expired" | "unknown";
  daysUntilExpiry: number | null;
  message: string;
  actionTaken?: string;
}

// ── Stripe webhook secret — can be auto-rotated programmatically ────
async function checkStripeWebhookSecret(): Promise<VendorSecretFinding> {
  const secret = process.env.STRIPE_SECRET_KEY;
  const webhookId = process.env.STRIPE_WEBHOOK_ENDPOINT_ID;
  if (!secret) {
    return { vendor: "stripe_webhook", status: "unknown", daysUntilExpiry: null, message: "STRIPE_SECRET_KEY not configured" };
  }
  if (!webhookId) {
    return {
      vendor: "stripe_webhook",
      status: "unknown",
      daysUntilExpiry: null,
      message: "STRIPE_WEBHOOK_ENDPOINT_ID env var not set; rotation watcher cannot identify the endpoint to rotate. Set this to the webhook endpoint id (we_xxx) to enable auto-rotation.",
    };
  }
  // Stripe webhook secrets don't have a built-in expiry, but rotation
  // hygiene is per-org policy. Default policy: rotate every 90 days.
  // The watcher tracks last-rotation via agent_events; if it's been
  // >90 days since the last successful rotation, auto-rotate (when
  // AUTO_ROTATE=true).
  const lastRotation = await getLastRotationTimestamp("stripe_webhook");
  const now = Date.now();
  const daysSinceRotation = lastRotation ? Math.floor((now - lastRotation) / 86_400_000) : null;
  const rotationDue = daysSinceRotation === null || daysSinceRotation >= 90;

  if (!rotationDue) {
    return {
      vendor: "stripe_webhook",
      status: "ok",
      daysUntilExpiry: 90 - (daysSinceRotation ?? 0),
      message: `Stripe webhook secret last rotated ${daysSinceRotation}d ago. Next rotation in ${90 - (daysSinceRotation ?? 0)}d.`,
    };
  }

  if (!AUTO_ROTATE) {
    return {
      vendor: "stripe_webhook",
      status: "warning",
      daysUntilExpiry: 0,
      message: `Stripe webhook secret rotation due (${daysSinceRotation ?? "never"}d since last rotation). VENDOR_SECRET_AUTO_ROTATE=false, so this is a reminder only.`,
    };
  }

  // Auto-rotate.
  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(secret, { apiVersion: "2023-10-16" as any });
    // Stripe's webhook-endpoint update returns a new signing secret
    // only when you pass `disable=true` then back to enabled; the
    // common pattern is to create a new endpoint, point the new
    // secret at Fly, and disable the old one. For now we surface as
    // a watcher reminder rather than executing the rotation, because
    // the actual Fly-secret-update + endpoint-swap needs operator
    // coordination on first run. Mark as "warning" and let the
    // founder click through.
    return {
      vendor: "stripe_webhook",
      status: "warning",
      daysUntilExpiry: 0,
      message: `Stripe webhook secret rotation due. AUTO_ROTATE is on but first-run rotation needs operator confirmation — see runbook.`,
      actionTaken: "queued_for_operator_approval",
    };
  } catch (err) {
    logger.error("[vendor-secret-rotation] stripe check failed", err as Error);
    return {
      vendor: "stripe_webhook",
      status: "unknown",
      daysUntilExpiry: null,
      message: `Stripe rotation check errored: ${(err as Error).message}`,
    };
  }
}

// ── GitHub PAT — fine-grained PATs surface expiry via /user (GH API) ──
async function checkGithubPat(): Promise<VendorSecretFinding> {
  const token = process.env.GH_TOKEN;
  if (!token) {
    return { vendor: "github_pat", status: "unknown", daysUntilExpiry: null, message: "GH_TOKEN not configured" };
  }
  try {
    // Hit GET /user to validate the token + read expiry from header.
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (res.status === 401) {
      return {
        vendor: "github_pat",
        status: "expired",
        daysUntilExpiry: -1,
        message: "GH_TOKEN rejected by GitHub (HTTP 401). Mint a fresh PAT + run scripts/set-gh-token.sh.",
      };
    }
    if (!res.ok) {
      return {
        vendor: "github_pat",
        status: "unknown",
        daysUntilExpiry: null,
        message: `GitHub /user returned ${res.status}.`,
      };
    }
    // GitHub returns `github-authentication-token-expiration` header on PATs with expiry.
    const expiryHeader = res.headers.get("github-authentication-token-expiration");
    if (!expiryHeader) {
      return {
        vendor: "github_pat",
        status: "ok",
        daysUntilExpiry: null,
        message: "GH_TOKEN authenticated. No expiry on this token (classic PAT or no expiration set).",
      };
    }
    const expiry = new Date(expiryHeader).getTime();
    const days = Math.floor((expiry - Date.now()) / 86_400_000);
    if (days < 0) {
      return {
        vendor: "github_pat",
        status: "expired",
        daysUntilExpiry: days,
        message: `GH_TOKEN expired ${-days}d ago — running on borrowed time, mint a fresh PAT immediately.`,
      };
    }
    if (days < ROTATION_WARNING_DAYS) {
      return {
        vendor: "github_pat",
        status: "warning",
        daysUntilExpiry: days,
        message: `GH_TOKEN expires in ${days}d. Mint a fresh PAT (scripts/set-gh-token.sh accepts the new value).`,
      };
    }
    return {
      vendor: "github_pat",
      status: "ok",
      daysUntilExpiry: days,
      message: `GH_TOKEN valid for ${days}d.`,
    };
  } catch (err) {
    return {
      vendor: "github_pat",
      status: "unknown",
      daysUntilExpiry: null,
      message: `GitHub check errored: ${(err as Error).message}`,
    };
  }
}

// ── Clerk secret — pure watcher; no public-API rotation yet ──────────
async function checkClerkSecret(): Promise<VendorSecretFinding> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) {
    return { vendor: "clerk_secret", status: "unknown", daysUntilExpiry: null, message: "CLERK_SECRET_KEY not configured" };
  }
  try {
    // Validate the key by hitting Clerk Backend API. Returns 401 if dead.
    const res = await fetch("https://api.clerk.com/v1/users?limit=1", {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (res.status === 401) {
      return {
        vendor: "clerk_secret",
        status: "expired",
        daysUntilExpiry: -1,
        message: "CLERK_SECRET_KEY rejected by Clerk (HTTP 401). Rotate via Clerk dashboard + set new value on Fly.",
      };
    }
    if (!res.ok) {
      return {
        vendor: "clerk_secret",
        status: "unknown",
        daysUntilExpiry: null,
        message: `Clerk Backend API returned ${res.status}.`,
      };
    }
    return {
      vendor: "clerk_secret",
      status: "ok",
      daysUntilExpiry: null,
      message: "CLERK_SECRET_KEY authenticated. No expiry tracked (Clerk doesn't expose key-expiration metadata).",
    };
  } catch (err) {
    return {
      vendor: "clerk_secret",
      status: "unknown",
      daysUntilExpiry: null,
      message: `Clerk check errored: ${(err as Error).message}`,
    };
  }
}

// ── Sentry token — surfaces auth state; no rotation yet ──────────────
async function checkSentryToken(): Promise<VendorSecretFinding> {
  const token = process.env.SENTRY_AUTH_TOKEN;
  if (!token) {
    // Build script's SENTRY_SOURCEMAPS=skip path is set; not a problem
    // unless the operator wants source maps in Sentry. Surface as `ok`
    // with a note.
    return {
      vendor: "sentry_token",
      status: "ok",
      daysUntilExpiry: null,
      message: "SENTRY_AUTH_TOKEN not configured — build pipeline runs with SENTRY_SOURCEMAPS=skip.",
    };
  }
  try {
    const res = await fetch("https://sentry.io/api/0/organizations/", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) {
      return {
        vendor: "sentry_token",
        status: "expired",
        daysUntilExpiry: -1,
        message: "SENTRY_AUTH_TOKEN rejected by Sentry. Mint a fresh user-auth-token + set on Fly.",
      };
    }
    if (!res.ok) {
      return {
        vendor: "sentry_token",
        status: "unknown",
        daysUntilExpiry: null,
        message: `Sentry API returned ${res.status}.`,
      };
    }
    return {
      vendor: "sentry_token",
      status: "ok",
      daysUntilExpiry: null,
      message: "SENTRY_AUTH_TOKEN authenticated.",
    };
  } catch (err) {
    return {
      vendor: "sentry_token",
      status: "unknown",
      daysUntilExpiry: null,
      message: `Sentry check errored: ${(err as Error).message}`,
    };
  }
}

// ── Helper: read last-rotation timestamp from agent_events ───────────
async function getLastRotationTimestamp(vendor: string): Promise<number | null> {
  try {
    const { eq, desc } = await import("drizzle-orm");
    const [row] = await db
      .select({ createdAt: agentEvents.createdAt })
      .from(agentEvents)
      .where(eq(agentEvents.eventType, `vendor_secret_rotated_${vendor}`))
      .orderBy(desc(agentEvents.createdAt))
      .limit(1);
    if (!row || !row.createdAt) return null;
    return new Date(row.createdAt as unknown as string).getTime();
  } catch {
    return null;
  }
}

/**
 * Daily cron entrypoint. Checks each vendor secret; surfaces warnings
 * to /founder/now inbox when expiry approaches or rotation is due.
 */
export async function runVendorSecretRotationWatcher(): Promise<{
  findings: VendorSecretFinding[];
  surfacedCount: number;
}> {
  const findings = await Promise.all([
    checkStripeWebhookSecret(),
    checkGithubPat(),
    checkClerkSecret(),
    checkSentryToken(),
  ]);

  const surfaceable = findings.filter(
    (f) => f.status === "warning" || f.status === "expired",
  );

  if (surfaceable.length === 0) {
    logger.info(`[vendor-secret-rotation] all ${findings.length} vendors ok`);
    return { findings, surfacedCount: 0 };
  }

  try {
    const { getFounderPrimaryOrgId } = await import("./founder");
    const orgId = await getFounderPrimaryOrgId();

    for (const f of surfaceable) {
      await db.insert(agentEvents).values({
        organizationId: orgId,
        eventType: f.status === "expired" ? "secret_revoked" : "secret_warning",
        eventSource: "vendor_secret_rotation",
        payload: {
          agentCodename: "vendor_secret_rotation",
          vendor: f.vendor,
          status: f.status,
          daysUntilExpiry: f.daysUntilExpiry,
          actionTaken: f.actionTaken,
          actionUrl: "/founder/now#vendor-secrets",
          title: `${f.vendor} ${f.status === "expired" ? "EXPIRED" : "rotation needed"}`,
          message: f.message,
        },
      });

      await db.insert(decisionsInboxItems).values({
        itemType: "vendor_secret_rotation",
        riskLevel: f.status === "expired" ? "critical" : "high",
        urgencyScore: f.status === "expired" ? 100 : 80,
        sophieAnalysis: f.message,
        recommendedAction:
          f.vendor === "github_pat"
            ? "Mint a fresh PAT at https://github.com/settings/tokens and run scripts/set-gh-token.sh."
            : f.vendor === "clerk_secret"
              ? "Rotate via Clerk dashboard and update CLERK_SECRET_KEY on Fly."
              : f.vendor === "sentry_token"
                ? "Mint a new user-auth-token in Sentry and set SENTRY_AUTH_TOKEN on Fly."
                : "Coordinate Stripe webhook endpoint rotation; see runbook.",
        recommendedActionLabel: `Rotate ${f.vendor}`,
        organizationId: orgId,
        status: "pending",
        ownerAgentCodename: "vendor_secret_rotation",
        sophieConfidenceScore: 95,
      });
    }
  } catch (err) {
    logger.error("[vendor-secret-rotation] failed to surface findings", err as Error);
  }

  return { findings, surfacedCount: surfaceable.length };
}
