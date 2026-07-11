/**
 * /api/founder/studio/* — the six "dial" sections of /founder/studio.
 *
 * Allocation policy, credit weights, revenue-trigger ladder, provider
 * routing, BYOK defaults, and the read-only infrastructure dashboard.
 *
 * Each mutation goes through `setSetting()` (so the change is picked up by
 * the rest of /founder/studio automatically) and also writes a row to
 * `founder_audit` with before/after JSON for the inspector timeline.
 *
 * All endpoints require founder access (isAuthenticated + getOrCreateOrg +
 * requireFounder). The legacy /founder/studio dial catalog is registered
 * separately by routes-founder-studio.ts; this file is purely additive.
 */

import type { Express, Response } from "express";
import { z } from "zod";

import { db } from "./db";
import { founderAudit } from "@shared/schema";
import { BYOK_CHANNELS, type ByokChannel } from "@shared/schema";
import { isAuthenticated, requireFounder } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import {
  getSetting,
  setSetting,
  SettingsValidationError,
} from "./services/settings";
import { CREDIT_WEIGHTS, type CreditAction } from "@shared/billing/credit-weights";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import type { AuthenticatedRequest } from "./types/request";

// ────────────────────────────────────────────────────────────────────────────
// Defaults — used as the seed value for a key the first time it's set, and
// as the fallback `getSetting()` returns when no row exists yet. Kept inline
// in this file so the studio surface is the canonical source for each shape
// (the settingsSeeder doesn't know about these "shaped" keys).
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_ALLOCATION = {
  taxReserve: 25,
  refundReserve: 10,
  profitReserve: 5,
  ownerDraw: 5,
  opexAvailable: 55,
} as const;

const DEFAULT_MAIL_ROUTING = {
  providerPriority: ["eddm", "presort", "postgrid", "lob", "lettrlabs"],
  eddmStates: ["TX", "FL", "AZ", "NM", "OK", "CO"],
  holdAndBatchHours: 0.5,
  coMarketingEnabled: false,
};

const DEFAULT_COMMS_ROUTING = {
  smsPriority: ["telnyx", "twilio"],
  carrierOverrides: "",
  trackingPoolSize: 50,
  byokWins: true,
};

const DEFAULT_DATA_ROUTING = {
  cacheTtlDays: {
    skip_trace: 90,
    parcel_ownership: 30,
    parcel_polygon: 365,
    avm: 30,
    flood_zone: 365,
    liens: 30,
  } as Record<string, number>,
  freeSourceFirst: true,
  fallbackOrder: ["regrid", "estated", "datatree"],
};

const DEFAULT_AI_ROUTING = {
  modelFloor: {
    classification: "claude-haiku-4-5",
    synthesis: "claude-sonnet-4-6",
    agent_tool: "claude-sonnet-4-6",
    other: "claude-sonnet-4-6",
  } as Record<string, string>,
  cacheTtlHoursByComplexity: {
    trivial: 24,
    simple: 12,
    moderate: 4,
    complex: 1,
  } as Record<string, number>,
  enforcePromptCache: true,
};

const DEFAULT_TRIGGERS = [
  { mrr: 50,    action: "Domain + brand polish",            oneTimeCost: 50,     recurringCost: 12,    status: "pending", autoApprove: true },
  { mrr: 200,   action: "Fly autoscale to 1x machine",      oneTimeCost: 0,      recurringCost: 30,    status: "pending", autoApprove: true },
  { mrr: 500,   action: "Sentry team tier + alerting",      oneTimeCost: 0,      recurringCost: 26,    status: "pending", autoApprove: true },
  { mrr: 1000,  action: "Postgres paid tier + replica",     oneTimeCost: 0,      recurringCost: 65,    status: "pending", autoApprove: false },
  { mrr: 2000,  action: "Stripe ACH + invoice billing",     oneTimeCost: 0,      recurringCost: 0,     status: "pending", autoApprove: false },
  { mrr: 3000,  action: "Cloudflare Pro + WAF",             oneTimeCost: 0,      recurringCost: 25,    status: "pending", autoApprove: false },
  { mrr: 5000,  action: "Anthropic enterprise + cache pool", oneTimeCost: 0,     recurringCost: 200,   status: "pending", autoApprove: false },
  { mrr: 10000, action: "Read-replica + analytics warehouse", oneTimeCost: 500,  recurringCost: 300,   status: "pending", autoApprove: false },
  { mrr: 25000, action: "Hire first eng / SRE on-call",     oneTimeCost: 5000,   recurringCost: 8000,  status: "pending", autoApprove: false },
];

const DEFAULT_BYOK_MIN_TIERS: Record<string, string> = {
  twilio: "starter",
  telnyx: "starter",
  sendgrid: "starter",
  ses: "starter",
  lob: "pro",
  postgrid: "pro",
  openrouter: "pro",
  anthropic: "pro",
  openai: "pro",
  batch_skiptracing: "pro",
  mapbox: "scale",
  s3: "scale",
};

// ────────────────────────────────────────────────────────────────────────────
// Setting keys this surface manages.
// ────────────────────────────────────────────────────────────────────────────

const KEY_ALLOCATION = "allocation.policy";
const KEY_TRIGGERS = "revenue.triggers";
const KEY_MAIL_ROUTING = "routing.mail";
const KEY_COMMS_ROUTING = "routing.comms";
const KEY_DATA_ROUTING = "routing.data";
const KEY_AI_ROUTING = "routing.ai";
const KEY_BYOK_TIER = (channel: string) => `byok.minTier.${channel}`;
const KEY_CREDIT = (action: string) => `credits.weight.${action}`;

// ────────────────────────────────────────────────────────────────────────────
// Zod schemas — keep mutation payloads tight so studio writes never produce
// shapes the rest of the platform can't read back.
// ────────────────────────────────────────────────────────────────────────────

const allocationSchema = z.object({
  taxReserve: z.number().min(0).max(100),
  refundReserve: z.number().min(0).max(100),
  profitReserve: z.number().min(0).max(100),
  ownerDraw: z.number().min(0).max(100),
  opexAvailable: z.number().min(0).max(100),
  note: z.string().optional(),
});

const creditWeightSchema = z.object({
  weight: z.number().min(0).max(10_000),
  note: z.string().optional(),
});

const triggerRowSchema = z.object({
  mrr: z.number().min(0),
  action: z.string().min(1),
  oneTimeCost: z.number().min(0).default(0),
  recurringCost: z.number().min(0).default(0),
  status: z.enum(["pending", "active", "skipped", "manual"]).default("pending"),
  autoApprove: z.boolean().default(false),
});

const triggersSchema = z.object({
  rows: z.array(triggerRowSchema).min(1),
  note: z.string().optional(),
});

const mailRoutingSchema = z.object({
  providerPriority: z.array(z.string()).min(1),
  eddmStates: z.array(z.string()),
  holdAndBatchHours: z.number().min(0).max(72),
  coMarketingEnabled: z.boolean(),
  note: z.string().optional(),
});

const commsRoutingSchema = z.object({
  smsPriority: z.array(z.string()).min(1),
  carrierOverrides: z.string(),
  trackingPoolSize: z.number().int().min(10).max(200),
  byokWins: z.boolean(),
  note: z.string().optional(),
});

const dataRoutingSchema = z.object({
  cacheTtlDays: z.record(z.string(), z.number().min(0).max(3650)),
  freeSourceFirst: z.boolean(),
  fallbackOrder: z.array(z.string()),
  note: z.string().optional(),
});

const aiRoutingSchema = z.object({
  modelFloor: z.record(z.string(), z.string()),
  cacheTtlHoursByComplexity: z.record(z.string(), z.number().min(0).max(8760)),
  enforcePromptCache: z.boolean(),
  note: z.string().optional(),
});

const byokSchema = z.object({
  channel: z.enum(BYOK_CHANNELS as unknown as [string, ...string[]]),
  minTier: z.enum(["free", "starter", "pro", "scale", "founder"]),
  note: z.string().optional(),
});

// ────────────────────────────────────────────────────────────────────────────
// Helpers.
// ────────────────────────────────────────────────────────────────────────────

function founderEmailOf(req: AuthenticatedRequest): string {
  return req.user?.email ?? "founder";
}

async function writeAudit(args: {
  founderId: string;
  action: string;
  targetType: string;
  targetId: string;
  before: unknown;
  after: unknown;
  note?: string;
}): Promise<void> {
  try {
    await db.insert(founderAudit).values({
      founderId: args.founderId,
      area: "studio.dials",
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId,
      before: args.before ?? null,
      after: args.after ?? null,
      note: args.note ?? null,
    });
  } catch (err) {
    // Audit-log failure should never bring down the dial write — log and
    // continue. The setSetting call has its own audit row already.
    logger.warn("[studio-dials] founder_audit insert failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function sumAllocation(a: { [K in keyof typeof DEFAULT_ALLOCATION]: number }): number {
  return a.taxReserve + a.refundReserve + a.profitReserve + a.ownerDraw + a.opexAvailable;
}

// ────────────────────────────────────────────────────────────────────────────
// Route registration.
// ────────────────────────────────────────────────────────────────────────────

export function registerFounderStudioDialRoutes(app: Express) {
  const guards = [isAuthenticated, getOrCreateOrg, requireFounder];

  // ── Allocation policy ──────────────────────────────────────────────────
  app.get("/api/founder/studio/allocation", ...guards, async (req, res: Response) => {
    try {
      const value = await getSetting(KEY_ALLOCATION, DEFAULT_ALLOCATION);
      res.json({ policy: value });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  app.post("/api/founder/studio/allocation", ...guards, async (req, res: Response) => {
    const parsed = allocationSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.flatten());
    }
    const { note, ...policy } = parsed.data;
    const total = sumAllocation(policy);
    if (Math.abs(total - 100) > 0.01) {
      return Errors.badRequest(res, `Allocation must sum to 100% (got ${total})`);
    }
    try {
      const before = await getSetting(KEY_ALLOCATION, DEFAULT_ALLOCATION);
      await setSetting({
        key: KEY_ALLOCATION,
        value: policy,
        founderId: founderEmailOf(req as AuthenticatedRequest),
        note,
      });
      await writeAudit({
        founderId: founderEmailOf(req as AuthenticatedRequest),
        action: "allocation.update",
        targetType: "setting",
        targetId: KEY_ALLOCATION,
        before,
        after: policy,
        note,
      });
      res.json({ policy });
    } catch (err) {
      if (err instanceof SettingsValidationError) {
        return Errors.validationFailed(res, err.message);
      }
      Errors.internal(res, err);
    }
  });

  // ── Credit weights ─────────────────────────────────────────────────────
  app.get("/api/founder/studio/credits", ...guards, async (_req, res: Response) => {
    try {
      const actions = Object.keys(CREDIT_WEIGHTS) as CreditAction[];
      const rows = await Promise.all(
        actions.map(async (action) => {
          const fallback = CREDIT_WEIGHTS[action];
          const weight = await getSetting<number>(KEY_CREDIT(action), fallback);
          return {
            action,
            weight: typeof weight === "number" ? weight : fallback,
            defaultWeight: fallback,
            // observedAvgCostCents: null — historic cost-attribution table
            // not yet wired into a credit_ledger. Surface as null so the UI
            // can render a placeholder; auto-calibrate ignores nulls.
            observedAvgCostCents: null as number | null,
            observedP90CostCents: null as number | null,
          };
        }),
      );
      res.json({ rows });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // calibrate — registered BEFORE /api/founder/studio/credits/:action so the literal path wins (2026-07-11 route-order sweep).
  app.post("/api/founder/studio/credits/calibrate", ...guards, async (req, res: Response) => {
    // No credit_ledger table yet — return a structured 422 so the UI can
    // disable the button with an explanation rather than silently saving
    // bogus weights. Once observed-cost data exists this becomes a real
    // p90 calculation across the last 30 days.
    return Errors.validationFailed(
      res,
      "Auto-calibration requires 30 days of credit_ledger data, which has not yet been collected.",
    );
  });

  app.post("/api/founder/studio/credits/:action", ...guards, async (req, res: Response) => {
    const action = req.params.action as CreditAction;
    if (!(action in CREDIT_WEIGHTS)) {
      return Errors.badRequest(res, `Unknown credit action '${action}'`);
    }
    const parsed = creditWeightSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.flatten());
    }
    try {
      const before = await getSetting<number>(KEY_CREDIT(action), CREDIT_WEIGHTS[action]);
      await setSetting({
        key: KEY_CREDIT(action),
        value: parsed.data.weight,
        founderId: founderEmailOf(req as AuthenticatedRequest),
        note: parsed.data.note,
      });
      await writeAudit({
        founderId: founderEmailOf(req as AuthenticatedRequest),
        action: "credit.weight.update",
        targetType: "credit_action",
        targetId: action,
        before,
        after: parsed.data.weight,
        note: parsed.data.note,
      });
      res.json({ action, weight: parsed.data.weight });
    } catch (err) {
      if (err instanceof SettingsValidationError) {
        return Errors.validationFailed(res, err.message);
      }
      Errors.internal(res, err);
    }
  });


  // ── Revenue trigger ladder ─────────────────────────────────────────────
  app.get("/api/founder/studio/triggers", ...guards, async (_req, res: Response) => {
    try {
      const rows = await getSetting(KEY_TRIGGERS, DEFAULT_TRIGGERS);
      // Best-effort MRR snapshot — pull from settings if any service has
      // written it, otherwise return null so the UI shows "—".
      const currentMrr = await getSetting<number | null>("revenue.mrr.current", null);
      const thresholds = Array.isArray(rows) ? rows : DEFAULT_TRIGGERS;
      const crossed = currentMrr === null
        ? null
        : thresholds.filter((r: any) => Number(r.mrr) <= Number(currentMrr)).length;
      res.json({ rows: thresholds, currentMrr, thresholdsCrossed: crossed });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  app.post("/api/founder/studio/triggers", ...guards, async (req, res: Response) => {
    const parsed = triggersSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.flatten());
    }
    try {
      const before = await getSetting(KEY_TRIGGERS, DEFAULT_TRIGGERS);
      await setSetting({
        key: KEY_TRIGGERS,
        value: parsed.data.rows,
        founderId: founderEmailOf(req as AuthenticatedRequest),
        note: parsed.data.note,
      });
      await writeAudit({
        founderId: founderEmailOf(req as AuthenticatedRequest),
        action: "triggers.replace",
        targetType: "setting",
        targetId: KEY_TRIGGERS,
        before,
        after: parsed.data.rows,
        note: parsed.data.note,
      });
      res.json({ rows: parsed.data.rows });
    } catch (err) {
      if (err instanceof SettingsValidationError) {
        return Errors.validationFailed(res, err.message);
      }
      Errors.internal(res, err);
    }
  });

  // ── Routing (mail / comms / data / ai) ─────────────────────────────────
  const routingRegistry = [
    { suffix: "mail", key: KEY_MAIL_ROUTING, schema: mailRoutingSchema, defaults: DEFAULT_MAIL_ROUTING },
    { suffix: "comms", key: KEY_COMMS_ROUTING, schema: commsRoutingSchema, defaults: DEFAULT_COMMS_ROUTING },
    { suffix: "data", key: KEY_DATA_ROUTING, schema: dataRoutingSchema, defaults: DEFAULT_DATA_ROUTING },
    { suffix: "ai", key: KEY_AI_ROUTING, schema: aiRoutingSchema, defaults: DEFAULT_AI_ROUTING },
  ] as const;

  for (const entry of routingRegistry) {
    app.get(`/api/founder/studio/routing/${entry.suffix}`, ...guards, async (_req, res: Response) => {
      try {
        const value = await getSetting(entry.key, entry.defaults);
        res.json({ routing: value });
      } catch (err) {
        Errors.internal(res, err);
      }
    });

    app.post(`/api/founder/studio/routing/${entry.suffix}`, ...guards, async (req, res: Response) => {
      const parsed = entry.schema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.flatten());
      }
      const { note, ...routing } = parsed.data as { note?: string; [k: string]: unknown };
      try {
        const before = await getSetting(entry.key, entry.defaults);
        await setSetting({
          key: entry.key,
          value: routing,
          founderId: founderEmailOf(req as AuthenticatedRequest),
          note,
        });
        await writeAudit({
          founderId: founderEmailOf(req as AuthenticatedRequest),
          action: `routing.${entry.suffix}.update`,
          targetType: "setting",
          targetId: entry.key,
          before,
          after: routing,
          note,
        });
        res.json({ routing });
      } catch (err) {
        if (err instanceof SettingsValidationError) {
          return Errors.validationFailed(res, err.message);
        }
        Errors.internal(res, err);
      }
    });
  }

  // ── BYOK defaults ──────────────────────────────────────────────────────
  app.get("/api/founder/studio/byok", ...guards, async (_req, res: Response) => {
    try {
      const channels = await Promise.all(
        BYOK_CHANNELS.map(async (channel) => {
          const minTier = await getSetting<string>(
            KEY_BYOK_TIER(channel),
            DEFAULT_BYOK_MIN_TIERS[channel] ?? "starter",
          );
          return {
            channel,
            minTier,
            // adoption: 0 — wired off byokCredentials count in a follow-up.
            adoption: 0,
          };
        }),
      );
      res.json({ channels });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  app.post("/api/founder/studio/byok", ...guards, async (req, res: Response) => {
    const parsed = byokSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.flatten());
    }
    const { channel, minTier, note } = parsed.data;
    try {
      const before = await getSetting<string>(
        KEY_BYOK_TIER(channel),
        DEFAULT_BYOK_MIN_TIERS[channel as ByokChannel] ?? "starter",
      );
      await setSetting({
        key: KEY_BYOK_TIER(channel),
        value: minTier,
        founderId: founderEmailOf(req as AuthenticatedRequest),
        note,
      });
      await writeAudit({
        founderId: founderEmailOf(req as AuthenticatedRequest),
        action: "byok.minTier.update",
        targetType: "byok_channel",
        targetId: channel,
        before,
        after: minTier,
        note,
      });
      res.json({ channel, minTier });
    } catch (err) {
      if (err instanceof SettingsValidationError) {
        return Errors.validationFailed(res, err.message);
      }
      Errors.internal(res, err);
    }
  });

  // ── Infrastructure read-only dashboard ─────────────────────────────────
  app.get("/api/founder/studio/infra", ...guards, async (_req, res: Response) => {
    try {
      // Each dial is "managed by revenue triggers" by default. Founder
      // overrides are stored under infra.override.* keys.
      const flySize = await getSetting<string>("infra.override.fly.size", "shared-cpu-4x");
      const flyMin = await getSetting<number>("infra.override.fly.minMachines", 0);
      const flyAutoStop = await getSetting<string>("infra.override.fly.autoStop", "suspend");

      // DATABASE_URL is host-detected — only the hostname is exposed (no
      // credentials).
      const dbUrl = process.env.DATABASE_URL ?? "";
      let pgProvider = "unknown";
      try {
        if (dbUrl) {
          const hostname = new URL(dbUrl).hostname;
          if (hostname.includes("neon")) pgProvider = "neon";
          else if (hostname.includes("fly.dev") || hostname.endsWith(".internal")) pgProvider = "fly";
          else if (hostname.includes("supabase")) pgProvider = "supabase";
          else if (hostname.includes("rds.amazonaws")) pgProvider = "aws-rds";
          else pgProvider = hostname.split(".").slice(-2).join(".");
        }
      } catch {
        pgProvider = "unknown";
      }

      const sentrySampleRate = await getSetting<number>("infra.override.sentry.sampleRate", 0.1);
      const sentryQuotaUsedPct = await getSetting<number | null>("infra.sentry.quotaUsedPct", null);
      const stripeAchEnabled = await getSetting<boolean>("infra.override.stripe.achEnabled", false);
      const readReplicaCategories = await getSetting<string[]>(
        "infra.override.readReplica.categories",
        [],
      );

      res.json({
        fly: { size: flySize, minMachines: flyMin, autoStop: flyAutoStop, revenueManaged: true },
        postgres: { provider: pgProvider, revenueManaged: true },
        sentry: { sampleRate: sentrySampleRate, quotaUsedPct: sentryQuotaUsedPct, revenueManaged: true },
        stripeAch: { enabled: stripeAchEnabled, revenueManaged: true },
        readReplica: { categories: readReplicaCategories, revenueManaged: true },
      });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // Manual override write — used only after the founder confirms the
  // "this breaks the revenue ladder" modal client-side.
  const infraOverrideSchema = z.object({
    key: z.enum([
      "infra.override.fly.size",
      "infra.override.fly.minMachines",
      "infra.override.fly.autoStop",
      "infra.override.sentry.sampleRate",
      "infra.override.stripe.achEnabled",
      "infra.override.readReplica.categories",
    ]),
    value: z.unknown(),
    note: z.string().optional(),
  });

  app.post("/api/founder/studio/infra/override", ...guards, async (req, res: Response) => {
    const parsed = infraOverrideSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.flatten());
    }
    try {
      const before = await getSetting(parsed.data.key, null);
      await setSetting({
        key: parsed.data.key,
        value: parsed.data.value,
        founderId: founderEmailOf(req as AuthenticatedRequest),
        note: parsed.data.note,
      });
      await writeAudit({
        founderId: founderEmailOf(req as AuthenticatedRequest),
        action: "infra.override",
        targetType: "setting",
        targetId: parsed.data.key,
        before,
        after: parsed.data.value,
        note: parsed.data.note,
      });
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof SettingsValidationError) {
        return Errors.validationFailed(res, err.message);
      }
      Errors.internal(res, err);
    }
  });
}
