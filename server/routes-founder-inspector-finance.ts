/**
 * /founder/inspector finance enrichments.
 *
 * Adds the cost-and-provenance lens to the existing inspector surface
 * (see server/routes-founder-inspector.ts for agent/decision/audit).
 * Three new endpoints + a small bag of emergency-override writers:
 *
 *   GET  /api/founder/inspector/org/:id/cost          — per-org cost tab feed
 *        (lifetime + windowed metrics, monthly contribution, BYOK status,
 *        cache-hit savings, recent cost events grouped by category).
 *   POST /api/founder/inspector/org/:id/pause-channel — write a per-org
 *        founder_setting that channel adapters consult before sending.
 *   POST /api/founder/inspector/org/:id/throttle      — set a per-org daily
 *        cap (count/day) for a specific channel.
 *   POST /api/founder/inspector/org/:id/draft-email   — stash a usage-email
 *        draft (no real send; returns a stub the founder copy-pastes).
 *
 *   GET  /api/founder/inspector/cost-event/:id        — per-ledger-row
 *        provenance: original action, router decision, alternatives,
 *        related-campaign rollup.
 *   GET  /api/founder/inspector/provider/:name        — per-provider audit:
 *        monthly spend trend, error rate, alternative pricing, last invoice
 *        reconciliation (best-effort when invoice ingestion lands).
 *
 * Provider → source-table mapping (used by /cost-event/:id provenance):
 *   twilio        → messages.externalId (Twilio MessageSid prefix-stripped)
 *                   or voice_calls.callSid
 *   telnyx        → messages.externalId
 *   lob | postgrid → mail_shipments.id (provider piece id lives on pieces)
 *   sendgrid | ses → lead_emails.externalId
 *   openrouter    → ai_call_log.id
 *   anthropic     → ai_call_log.id
 *   stripe        → financial_ledger.invoiceId (Stripe invoice id stored
 *                   as the externalEventId prefix `stripe:in_...`)
 *   elevenlabs    → voice_calls.callSid (best-effort)
 *   sentry | fly  → no per-event source; surfaces "platform infra" only.
 *
 * Founder-gated end-to-end via isAuthenticated + getOrCreateOrg + requireFounder.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, desc, eq, gte, sql, inArray } from "drizzle-orm";

import { db } from "./db";
import {
  financialLedger,
  organizations,
  founderAudit,
  founderSettings,
  byokCredentials,
  mailShipments,
  mailShipmentPieces,
  messages,
  aiCallLog,
  BYOK_CHANNELS,
} from "@shared/schema";

import { isAuthenticated, requireFounder } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { getCacheHitSavingsForOrg } from "./services/data-cache/lookup-cache";
import { getContributionMargin } from "./services/financial-ledger";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId } from "./types/request";

// ────────────────────────────────────────────────────────────────────────────
// Canonical provider → source-table mapping (single source of truth for the
// cost-event provenance lookup). Provider names are lowercase strings matching
// financial_ledger.provider.
// ────────────────────────────────────────────────────────────────────────────
const PROVIDER_SOURCES: Record<string, "messages" | "voice_calls" | "mail_shipments" | "ai_call_log" | "stripe" | "infra"> = {
  twilio: "messages",
  telnyx: "messages",
  bandwidth: "messages",
  sendgrid: "messages", // email through messages table when integrated; else infra
  ses: "messages",
  lob: "mail_shipments",
  postgrid: "mail_shipments",
  openrouter: "ai_call_log",
  anthropic: "ai_call_log",
  openai: "ai_call_log",
  elevenlabs: "voice_calls",
  stripe: "stripe",
  sentry: "infra",
  fly: "infra",
  neon: "infra",
};

const SUPPORTED_PROVIDERS = [
  "lob",
  "postgrid",
  "twilio",
  "telnyx",
  "sendgrid",
  "ses",
  "openrouter",
  "anthropic",
  "openai",
  "elevenlabs",
  "stripe",
  "sentry",
  "fly",
  "neon",
] as const;

// Provider quote heuristics (alternative-cost section). Kept in code rather
// than DB to avoid a migration; real values live in comms_provider_quotes
// once that table sees data.
const ALT_QUOTES_CENTS: Record<string, Array<{ name: string; perEventCents: number }>> = {
  lob: [
    { name: "lob", perEventCents: 85 },
    { name: "postgrid", perEventCents: 62 },
    { name: "lettrlabs", perEventCents: 58 },
    { name: "direct_presort", perEventCents: 32 },
  ],
  postgrid: [
    { name: "postgrid", perEventCents: 62 },
    { name: "lob", perEventCents: 85 },
    { name: "direct_presort", perEventCents: 32 },
  ],
  twilio: [
    { name: "twilio", perEventCents: 0.79 },
    { name: "telnyx", perEventCents: 0.4 },
    { name: "bandwidth", perEventCents: 0.45 },
  ],
  telnyx: [
    { name: "telnyx", perEventCents: 0.4 },
    { name: "twilio", perEventCents: 0.79 },
    { name: "bandwidth", perEventCents: 0.45 },
  ],
  sendgrid: [
    { name: "sendgrid", perEventCents: 0.04 },
    { name: "ses", perEventCents: 0.01 },
  ],
  ses: [
    { name: "ses", perEventCents: 0.01 },
    { name: "sendgrid", perEventCents: 0.04 },
  ],
  openrouter: [
    { name: "openrouter", perEventCents: 1.4 },
    { name: "anthropic_direct", perEventCents: 1.2 },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// Request schemas
// ────────────────────────────────────────────────────────────────────────────
const PAUSE_CHANNELS = [
  "lob",
  "postgrid",
  "twilio",
  "telnyx",
  "sendgrid",
  "ses",
  "openrouter",
  "anthropic",
  "elevenlabs",
] as const;

const pauseChannelSchema = z.object({
  channel: z.enum(PAUSE_CHANNELS),
  reason: z.string().min(1).max(2000),
  resume: z.boolean().optional(),
});

const throttleSchema = z.object({
  channel: z.enum(PAUSE_CHANNELS),
  dailyCap: z.number().int().min(0).max(10_000),
  reason: z.string().min(1).max(2000),
});

const draftEmailSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
  recipient: z.string().email().optional(),
});

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function parseDays(raw: unknown, def = 30, max = 365): number {
  const n = parseInt(String(raw ?? def), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(max, n));
}

function settingKeyForChannelPause(orgId: number, channel: string) {
  return `founder.org_${orgId}.channel_pause.${channel}`;
}

function settingKeyForChannelThrottle(orgId: number, channel: string) {
  return `founder.org_${orgId}.channel_throttle.${channel}`;
}

async function upsertFounderSetting(args: {
  key: string;
  value: unknown;
  valueType: "string" | "number" | "boolean" | "json";
  category: string;
  description?: string;
  founderId: string;
}) {
  const serialised = args.valueType === "json"
    ? JSON.stringify(args.value)
    : String(args.value);

  const [existing] = await db
    .select()
    .from(founderSettings)
    .where(eq(founderSettings.key, args.key))
    .limit(1);

  if (existing) {
    await db
      .update(founderSettings)
      .set({
        value: serialised,
        valueType: args.valueType,
        updatedAt: new Date(),
        updatedBy: args.founderId,
        description: args.description ?? existing.description,
        category: args.category,
      })
      .where(eq(founderSettings.id, existing.id));
    return { previousValue: existing.value, action: "update" as const };
  }

  await db.insert(founderSettings).values({
    key: args.key,
    value: serialised,
    valueType: args.valueType,
    description: args.description ?? null,
    category: args.category,
    updatedBy: args.founderId,
  });
  return { previousValue: null, action: "insert" as const };
}

async function writeFounderAudit(args: {
  founderId: string;
  area: string;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  note?: string;
}) {
  try {
    await db.insert(founderAudit).values({
      founderId: args.founderId,
      area: args.area,
      action: args.action,
      targetType: args.targetType ?? null,
      targetId: args.targetId ?? null,
      before: (args.before as unknown) ?? null,
      after: (args.after as unknown) ?? null,
      note: args.note ?? null,
    });
  } catch (err) {
    logger.error("[inspector-finance] founder_audit write failed", err instanceof Error ? err : undefined);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────────────────────
export function registerFounderInspectorFinanceRoutes(app: Express) {
  const guards = [isAuthenticated, getOrCreateOrg, requireFounder];

  // ── Per-org Cost tab feed ──────────────────────────────────────────────
  app.get(
    "/api/founder/inspector/org/:id/cost",
    ...guards,
    async (req, res: Response) => {
      try {
        const orgId = parseInt(req.params.id, 10);
        if (!Number.isFinite(orgId)) return Errors.badRequest(res, "invalid org id");
        const days = parseDays(req.query.days, 30, 365);
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const [org] = await db
          .select()
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1);
        if (!org) return Errors.notFound(res, "Organization");

        // ── Lifetime metrics ────────────────────────────────────────────
        const [lifetime] = await db
          .select({
            revenueCents: sql<number>`COALESCE(SUM(CASE WHEN ${financialLedger.category} = 'revenue' THEN ${financialLedger.amountCents} ELSE 0 END), 0)::bigint`,
            variableCostCents: sql<number>`COALESCE(SUM(CASE WHEN ${financialLedger.category} = 'opex_spent' THEN ${financialLedger.amountCents} ELSE 0 END), 0)::bigint`,
            refundCents: sql<number>`COALESCE(SUM(CASE WHEN ${financialLedger.category} = 'refund' THEN ${financialLedger.amountCents} ELSE 0 END), 0)::bigint`,
          })
          .from(financialLedger)
          .where(eq(financialLedger.organizationId, orgId));

        const lifetimeRevenue = Number(lifetime?.revenueCents ?? 0);
        const lifetimeVariableCost = -Number(lifetime?.variableCostCents ?? 0); // stored negative
        const lifetimeContributionMargin = lifetimeRevenue - lifetimeVariableCost;
        const cac = lifetimeVariableCost > 0 ? lifetimeRevenue / lifetimeVariableCost : null;

        // ── Windowed contribution margin ────────────────────────────────
        const window = await getContributionMargin(orgId, days);

        // ── Variable cost trend (per-day, last `days` days) ─────────────
        const trendRows = await db
          .select({
            day: sql<string>`to_char(date_trunc('day', ${financialLedger.postedAt}), 'YYYY-MM-DD')`,
            costCents: sql<number>`COALESCE(SUM(-${financialLedger.amountCents}), 0)::bigint`,
          })
          .from(financialLedger)
          .where(
            and(
              eq(financialLedger.organizationId, orgId),
              eq(financialLedger.category, "opex_spent"),
              gte(financialLedger.postedAt, since),
            ),
          )
          .groupBy(sql`date_trunc('day', ${financialLedger.postedAt})`)
          .orderBy(sql`date_trunc('day', ${financialLedger.postedAt})`);
        const trend = trendRows.map((r) => ({
          day: r.day,
          costCents: Number(r.costCents),
        }));

        // ── Cost per category (within window) ───────────────────────────
        const categoryRows = await db
          .select({
            feature: financialLedger.feature,
            costCents: sql<number>`COALESCE(SUM(-${financialLedger.amountCents}), 0)::bigint`,
            events: sql<number>`COUNT(*)::int`,
          })
          .from(financialLedger)
          .where(
            and(
              eq(financialLedger.organizationId, orgId),
              eq(financialLedger.category, "opex_spent"),
              gte(financialLedger.postedAt, since),
            ),
          )
          .groupBy(financialLedger.feature)
          .orderBy(sql`COALESCE(SUM(-${financialLedger.amountCents}), 0) DESC`);
        const categoryBreakdown = categoryRows.map((r) => ({
          feature: r.feature ?? "uncategorized",
          costCents: Number(r.costCents),
          events: Number(r.events),
        }));

        // ── Net contribution margin per month (last 6 months) ──────────
        const monthlyRows = await db
          .select({
            month: sql<string>`to_char(date_trunc('month', ${financialLedger.postedAt}), 'YYYY-MM')`,
            revenueCents: sql<number>`COALESCE(SUM(CASE WHEN ${financialLedger.category} = 'revenue' THEN ${financialLedger.amountCents} ELSE 0 END), 0)::bigint`,
            variableCostCents: sql<number>`COALESCE(SUM(CASE WHEN ${financialLedger.category} = 'opex_spent' THEN -${financialLedger.amountCents} ELSE 0 END), 0)::bigint`,
          })
          .from(financialLedger)
          .where(
            and(
              eq(financialLedger.organizationId, orgId),
              gte(financialLedger.postedAt, new Date(Date.now() - 190 * 24 * 60 * 60 * 1000)),
            ),
          )
          .groupBy(sql`date_trunc('month', ${financialLedger.postedAt})`)
          .orderBy(sql`date_trunc('month', ${financialLedger.postedAt})`);
        const monthly = monthlyRows.slice(-6).map((r) => {
          const revenue = Number(r.revenueCents);
          const variable = Number(r.variableCostCents);
          return {
            month: r.month,
            revenueCents: revenue,
            variableCostCents: variable,
            marginCents: revenue - variable,
            netNegative: revenue - variable < 0,
          };
        });

        // ── BYOK status per channel ────────────────────────────────────
        const credentialRows = await db
          .select({
            channel: byokCredentials.channel,
            lastUsedAt: byokCredentials.lastUsedAt,
            createdAt: byokCredentials.createdAt,
            revokedAt: byokCredentials.revokedAt,
            fingerprint: byokCredentials.credentialKeyFingerprint,
          })
          .from(byokCredentials)
          .where(eq(byokCredentials.organizationId, orgId));
        const credentialMap = new Map<string, (typeof credentialRows)[number]>();
        for (const row of credentialRows) {
          // Last-wins on the channel; revoked rows lose out to active.
          const existing = credentialMap.get(row.channel);
          if (!existing) credentialMap.set(row.channel, row);
          else if (existing.revokedAt && !row.revokedAt) credentialMap.set(row.channel, row);
        }
        const byok = BYOK_CHANNELS.map((channel) => {
          const row = credentialMap.get(channel);
          const active = !!row && row.revokedAt === null;
          return {
            channel,
            usingByok: active,
            fingerprint: active ? row?.fingerprint ?? null : null,
            lastUsedAt: active ? row?.lastUsedAt ?? null : null,
            createdAt: active ? row?.createdAt ?? null : null,
          };
        });

        // ── Cache-hit savings (this period) ────────────────────────────
        const cacheSavings = await getCacheHitSavingsForOrg(orgId, days);

        // ── Channel pause + throttle overrides currently in effect ─────
        const overrideRows = await db
          .select()
          .from(founderSettings)
          .where(
            inArray(
              founderSettings.key,
              [
                ...PAUSE_CHANNELS.map((c) => settingKeyForChannelPause(orgId, c)),
                ...PAUSE_CHANNELS.map((c) => settingKeyForChannelThrottle(orgId, c)),
              ],
            ),
          );
        const overrides = {
          pauses: PAUSE_CHANNELS.map((channel) => {
            const row = overrideRows.find((r) => r.key === settingKeyForChannelPause(orgId, channel));
            return {
              channel,
              paused: row?.value === "true",
              setAt: row?.updatedAt ?? null,
              setBy: row?.updatedBy ?? null,
              description: row?.description ?? null,
            };
          }),
          throttles: PAUSE_CHANNELS.map((channel) => {
            const row = overrideRows.find((r) => r.key === settingKeyForChannelThrottle(orgId, channel));
            const dailyCap = row ? Number(row.value) : null;
            return {
              channel,
              dailyCap: Number.isFinite(dailyCap as number) ? (dailyCap as number) : null,
              setAt: row?.updatedAt ?? null,
              setBy: row?.updatedBy ?? null,
              description: row?.description ?? null,
            };
          }),
        };

        // ── Recent cost events (linkable to /founder/inspector/cost-event/:id) ─
        const recentEvents = await db
          .select({
            id: financialLedger.id,
            amountCents: financialLedger.amountCents,
            feature: financialLedger.feature,
            provider: financialLedger.provider,
            externalEventId: financialLedger.externalEventId,
            postedAt: financialLedger.postedAt,
          })
          .from(financialLedger)
          .where(
            and(
              eq(financialLedger.organizationId, orgId),
              eq(financialLedger.category, "opex_spent"),
              gte(financialLedger.postedAt, since),
            ),
          )
          .orderBy(desc(financialLedger.postedAt))
          .limit(50);

        res.json({
          org: {
            id: org.id,
            name: org.name,
            slug: org.slug,
            subscriptionTier: org.subscriptionTier,
            subscriptionStatus: org.subscriptionStatus,
          },
          windowDays: days,
          lifetime: {
            revenueCents: lifetimeRevenue,
            variableCostCents: lifetimeVariableCost,
            contributionMarginCents: lifetimeContributionMargin,
            ltvToCacRatio: cac,
          },
          window: {
            revenueCents: window.revenueCents,
            variableCostCents: window.opexCents,
            marginCents: window.marginCents,
          },
          trend,
          categoryBreakdown,
          monthly,
          byok,
          cacheSavings,
          overrides,
          recentEvents: recentEvents.map((e) => ({
            id: Number(e.id),
            costCents: -Number(e.amountCents),
            feature: e.feature,
            provider: e.provider,
            externalEventId: e.externalEventId,
            postedAt: e.postedAt,
          })),
        });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // ── Emergency override: pause a channel for this org ──────────────────
  app.post(
    "/api/founder/inspector/org/:id/pause-channel",
    ...guards,
    async (req, res: Response) => {
      try {
        const orgId = parseInt(req.params.id, 10);
        if (!Number.isFinite(orgId)) return Errors.badRequest(res, "invalid org id");

        const parsed = pauseChannelSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        const founderId = getUserId(req as AuthenticatedRequest);
        const { channel, reason, resume } = parsed.data;
        const key = settingKeyForChannelPause(orgId, channel);

        const upserted = await upsertFounderSetting({
          key,
          value: resume ? false : true,
          valueType: "boolean",
          category: "channel_overrides",
          description: reason,
          founderId,
        });

        await writeFounderAudit({
          founderId,
          area: "inspector_finance",
          action: resume ? "channel.resume" : "channel.pause",
          targetType: "organization",
          targetId: String(orgId),
          before: upserted.previousValue,
          after: { paused: !resume, reason },
          note: reason,
        });

        res.json({ ok: true, key, paused: !resume });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // ── Emergency override: daily cap on a channel ────────────────────────
  app.post(
    "/api/founder/inspector/org/:id/throttle",
    ...guards,
    async (req, res: Response) => {
      try {
        const orgId = parseInt(req.params.id, 10);
        if (!Number.isFinite(orgId)) return Errors.badRequest(res, "invalid org id");

        const parsed = throttleSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        const founderId = getUserId(req as AuthenticatedRequest);
        const { channel, dailyCap, reason } = parsed.data;
        const key = settingKeyForChannelThrottle(orgId, channel);

        const upserted = await upsertFounderSetting({
          key,
          value: dailyCap,
          valueType: "number",
          category: "channel_overrides",
          description: reason,
          founderId,
        });

        await writeFounderAudit({
          founderId,
          area: "inspector_finance",
          action: "channel.throttle",
          targetType: "organization",
          targetId: String(orgId),
          before: upserted.previousValue,
          after: { dailyCap, channel, reason },
          note: reason,
        });

        res.json({ ok: true, key, dailyCap });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // ── Emergency override: draft a usage email (no send) ─────────────────
  app.post(
    "/api/founder/inspector/org/:id/draft-email",
    ...guards,
    async (req, res: Response) => {
      try {
        const orgId = parseInt(req.params.id, 10);
        if (!Number.isFinite(orgId)) return Errors.badRequest(res, "invalid org id");

        const parsed = draftEmailSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        const founderId = getUserId(req as AuthenticatedRequest);
        const { subject, body, recipient } = parsed.data;

        await writeFounderAudit({
          founderId,
          area: "inspector_finance",
          action: "email.draft",
          targetType: "organization",
          targetId: String(orgId),
          after: { subject, recipient: recipient ?? null, length: body.length },
          note: `Drafted usage email to org ${orgId}`,
        });

        // Stub draft response — the founder copy-pastes into their mail client.
        res.json({
          ok: true,
          draft: {
            subject,
            body,
            recipient: recipient ?? null,
            mailto: recipient
              ? `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
              : null,
          },
        });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // ── Per-event provenance ───────────────────────────────────────────────
  app.get(
    "/api/founder/inspector/cost-event/:id",
    ...guards,
    async (req, res: Response) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return Errors.badRequest(res, "invalid ledger id");

        const [row] = await db
          .select()
          .from(financialLedger)
          .where(eq(financialLedger.id, id))
          .limit(1);
        if (!row) return Errors.notFound(res, "Cost event");

        const providerKey = (row.provider ?? "").toLowerCase();
        const sourceTable = PROVIDER_SOURCES[providerKey] ?? "infra";

        let origin: Record<string, unknown> | null = null;
        const externalId = row.externalEventId ?? "";
        const strippedId = externalId.includes(":") ? externalId.split(":").slice(1).join(":") : externalId;

        // ── Origin lookup by provider family ───────────────────────────
        if (sourceTable === "messages") {
          const [m] = await db
            .select()
            .from(messages)
            .where(eq(messages.externalId, strippedId))
            .limit(1);
          if (m) {
            origin = {
              kind: "sms_or_email",
              source_table: "messages",
              direction: m.direction,
              sender: m.sender,
              status: m.status,
              externalId: m.externalId,
              conversationId: m.conversationId,
              createdAt: m.createdAt,
              contentPreview: m.content ? m.content.slice(0, 140) : null,
            };
          }
          // voice_calls fallback removed 2026-08-01: the table was dropped
          // with the Voice / AI voice kill (founder-authorized), so a callSid
          // could never match again.
        } else if (sourceTable === "mail_shipments") {
          // The provider piece id lives on mail_shipment_pieces; the
          // shipment id is sometimes encoded into externalEventId.
          const [piece] = await db
            .select({
              piece: mailShipmentPieces,
              shipment: mailShipments,
            })
            .from(mailShipmentPieces)
            .innerJoin(mailShipments, eq(mailShipmentPieces.shipmentId, mailShipments.id))
            .where(eq(mailShipmentPieces.providerPieceId, strippedId))
            .limit(1);
          if (piece) {
            origin = {
              kind: "mail",
              source_table: "mail_shipments",
              recipient: piece.piece.recipientName,
              addressLine1: piece.piece.addressLine1,
              city: piece.piece.city,
              state: piece.piece.state,
              zip: piece.piece.zip,
              pieceStatus: piece.piece.status,
              shipmentId: piece.shipment.id,
              shipmentLabel: piece.shipment.label,
              shipmentSpeed: piece.shipment.speed,
              shipmentProvider: piece.shipment.provider,
              campaignId: row.campaignId,
            };
          } else if (row.campaignId) {
            // Fallback: at least the shipment label
            const [shipment] = await db
              .select()
              .from(mailShipments)
              .where(eq(mailShipments.id, row.campaignId))
              .limit(1);
            if (shipment) {
              origin = {
                kind: "mail",
                source_table: "mail_shipments",
                shipmentId: shipment.id,
                shipmentLabel: shipment.label,
                shipmentSpeed: shipment.speed,
                shipmentProvider: shipment.provider,
                pieceCount: shipment.pieceCount,
              };
            }
          }
        } else if (sourceTable === "ai_call_log") {
          // ai_call_log doesn't carry the ledger externalId; best-effort
          // match on createdAt within a 60-second window when no id link.
          const numericId = parseInt(strippedId, 10);
          if (Number.isFinite(numericId)) {
            const [a] = await db
              .select()
              .from(aiCallLog)
              .where(eq(aiCallLog.id, numericId))
              .limit(1);
            if (a) {
              origin = {
                kind: "ai",
                source_table: "ai_call_log",
                model: a.model,
                complexityClass: a.complexityClass,
                feature: a.feature,
                promptTokens: a.promptTokens,
                cachedInputTokens: a.cachedInputTokens,
                completionTokens: a.completionTokens,
                cacheHit: a.cacheHit,
                latencyMs: a.latencyMs,
                errorClass: a.errorClass,
                createdAt: a.createdAt,
              };
            }
          }
        } else if (sourceTable === "stripe") {
          origin = {
            kind: "stripe",
            source_table: "financial_ledger.invoiceId",
            invoiceId: row.invoiceId,
            externalEventId: row.externalEventId,
          };
        } else {
          origin = {
            kind: "infra",
            source_table: "platform_infrastructure",
            note: "Platform-level cost — no per-event source row.",
          };
        }

        // ── Alternative providers (router second-guess section) ───────
        const alternatives = (ALT_QUOTES_CENTS[providerKey] ?? []).map((alt) => ({
          provider: alt.name,
          perEventCents: alt.perEventCents,
          deltaVsThisCents: Math.round(alt.perEventCents - -Number(row.amountCents)),
        }));

        // ── Related events from the same campaign/sequence ───────────
        let related: Array<{
          id: number;
          amountCents: number;
          feature: string | null;
          provider: string | null;
          postedAt: Date;
        }> = [];
        if (row.campaignId) {
          const rows = await db
            .select({
              id: financialLedger.id,
              amountCents: financialLedger.amountCents,
              feature: financialLedger.feature,
              provider: financialLedger.provider,
              postedAt: financialLedger.postedAt,
            })
            .from(financialLedger)
            .where(
              and(
                eq(financialLedger.campaignId, row.campaignId),
                eq(financialLedger.category, "opex_spent"),
              ),
            )
            .orderBy(desc(financialLedger.postedAt))
            .limit(25);
          related = rows
            .filter((r) => Number(r.id) !== Number(row.id))
            .map((r) => ({
              id: Number(r.id),
              amountCents: -Number(r.amountCents),
              feature: r.feature,
              provider: r.provider,
              postedAt: r.postedAt,
            }));
        }

        res.json({
          event: {
            id: Number(row.id),
            organizationId: row.organizationId,
            bucket: row.bucket,
            category: row.category,
            amountCents: Number(row.amountCents),
            costCents: -Number(row.amountCents),
            feature: row.feature,
            provider: row.provider,
            externalEventId: row.externalEventId,
            invoiceId: row.invoiceId,
            campaignId: row.campaignId,
            postedAt: row.postedAt,
            postedBy: row.postedBy,
            notes: row.notes,
          },
          origin,
          sourceTable,
          alternatives,
          related,
          routerDecision: null,
        });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // ── Per-provider audit page ────────────────────────────────────────────
  app.get(
    "/api/founder/inspector/provider/:name",
    ...guards,
    async (req, res: Response) => {
      try {
        const name = String(req.params.name ?? "").toLowerCase().trim();
        if (!SUPPORTED_PROVIDERS.includes(name as (typeof SUPPORTED_PROVIDERS)[number])) {
          return Errors.badRequest(res, `Unknown provider '${name}'`);
        }
        const days = parseDays(req.query.days, 30, 365);
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        // ── Monthly spend trend (6 months) ─────────────────────────────
        const monthlyRows = await db
          .select({
            month: sql<string>`to_char(date_trunc('month', ${financialLedger.postedAt}), 'YYYY-MM')`,
            costCents: sql<number>`COALESCE(SUM(-${financialLedger.amountCents}), 0)::bigint`,
            events: sql<number>`COUNT(*)::int`,
          })
          .from(financialLedger)
          .where(
            and(
              eq(financialLedger.provider, name),
              eq(financialLedger.category, "opex_spent"),
              gte(financialLedger.postedAt, new Date(Date.now() - 190 * 24 * 60 * 60 * 1000)),
            ),
          )
          .groupBy(sql`date_trunc('month', ${financialLedger.postedAt})`)
          .orderBy(sql`date_trunc('month', ${financialLedger.postedAt})`);

        // ── Cost-per-event distribution + totals (within window) ───────
        const [windowAgg] = await db
          .select({
            costCents: sql<number>`COALESCE(SUM(-${financialLedger.amountCents}), 0)::bigint`,
            events: sql<number>`COUNT(*)::int`,
            avgPerEventCents: sql<number>`COALESCE(AVG(-${financialLedger.amountCents}), 0)::numeric`,
            minPerEventCents: sql<number>`COALESCE(MIN(-${financialLedger.amountCents}), 0)::bigint`,
            maxPerEventCents: sql<number>`COALESCE(MAX(-${financialLedger.amountCents}), 0)::bigint`,
          })
          .from(financialLedger)
          .where(
            and(
              eq(financialLedger.provider, name),
              eq(financialLedger.category, "opex_spent"),
              gte(financialLedger.postedAt, since),
            ),
          );

        // ── Cost-per-event buckets for a tiny distribution chart ──────
        const distRows = await db
          .select({
            bucket: sql<number>`width_bucket(-${financialLedger.amountCents}, 0, 200, 10)`,
            count: sql<number>`COUNT(*)::int`,
          })
          .from(financialLedger)
          .where(
            and(
              eq(financialLedger.provider, name),
              eq(financialLedger.category, "opex_spent"),
              gte(financialLedger.postedAt, since),
            ),
          )
          .groupBy(sql`width_bucket(-${financialLedger.amountCents}, 0, 200, 10)`)
          .orderBy(sql`width_bucket(-${financialLedger.amountCents}, 0, 200, 10)`);

        // ── Top orgs by spend on this provider ─────────────────────────
        const topOrgRows = await db
          .select({
            organizationId: financialLedger.organizationId,
            costCents: sql<number>`COALESCE(SUM(-${financialLedger.amountCents}), 0)::bigint`,
            events: sql<number>`COUNT(*)::int`,
          })
          .from(financialLedger)
          .where(
            and(
              eq(financialLedger.provider, name),
              eq(financialLedger.category, "opex_spent"),
              gte(financialLedger.postedAt, since),
            ),
          )
          .groupBy(financialLedger.organizationId)
          .orderBy(sql`COALESCE(SUM(-${financialLedger.amountCents}), 0) DESC`)
          .limit(10);

        const orgIds = topOrgRows.map((r) => r.organizationId).filter((id): id is number => id !== null);
        const orgInfo = orgIds.length
          ? await db
              .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
              .from(organizations)
              .where(inArray(organizations.id, orgIds))
          : [];
        const orgMap = new Map(orgInfo.map((o) => [o.id, o]));
        const topOrgs = topOrgRows.map((r) => ({
          organizationId: r.organizationId,
          name: r.organizationId ? orgMap.get(r.organizationId)?.name ?? "Unknown" : "Unattributed",
          slug: r.organizationId ? orgMap.get(r.organizationId)?.slug ?? null : null,
          costCents: Number(r.costCents),
          events: Number(r.events),
        }));

        // ── Alternative providers recommendation ───────────────────────
        const alternatives = ALT_QUOTES_CENTS[name] ?? [];
        const avgPerEventCents = Number(windowAgg?.avgPerEventCents ?? 0);
        const recommendations = alternatives
          .filter((a) => a.name !== name && avgPerEventCents > 0 && a.perEventCents < avgPerEventCents)
          .map((a) => ({
            provider: a.name,
            perEventCents: a.perEventCents,
            savingsPerEventCents: Math.round((avgPerEventCents - a.perEventCents) * 100) / 100,
            savingsPct: Math.round(((avgPerEventCents - a.perEventCents) / avgPerEventCents) * 100),
          }));

        // ── Error rate + latency telemetry (best-effort) ───────────────
        let errorRate: { sample: number; errors: number; pct: number } | null = null;
        let latency: { avgMs: number | null; p50Ms: number | null; p95Ms: number | null } | null = null;
        if (name === "openrouter" || name === "anthropic" || name === "openai") {
          const [agg] = await db
            .select({
              total: sql<number>`COUNT(*)::int`,
              errors: sql<number>`SUM(CASE WHEN ${aiCallLog.errorClass} IS NOT NULL THEN 1 ELSE 0 END)::int`,
              avgMs: sql<number>`COALESCE(AVG(${aiCallLog.latencyMs}), 0)::int`,
              p50Ms: sql<number>`COALESCE(percentile_disc(0.5) WITHIN GROUP (ORDER BY ${aiCallLog.latencyMs}), 0)::int`,
              p95Ms: sql<number>`COALESCE(percentile_disc(0.95) WITHIN GROUP (ORDER BY ${aiCallLog.latencyMs}), 0)::int`,
            })
            .from(aiCallLog)
            .where(gte(aiCallLog.createdAt, since));
          const sample = Number(agg?.total ?? 0);
          const errors = Number(agg?.errors ?? 0);
          errorRate = { sample, errors, pct: sample > 0 ? Math.round((errors / sample) * 10000) / 100 : 0 };
          latency = {
            avgMs: Number(agg?.avgMs ?? 0),
            p50Ms: Number(agg?.p50Ms ?? 0),
            p95Ms: Number(agg?.p95Ms ?? 0),
          };
        }

        res.json({
          provider: name,
          windowDays: days,
          monthly: monthlyRows.map((r) => ({
            month: r.month,
            costCents: Number(r.costCents),
            events: Number(r.events),
          })),
          window: {
            costCents: Number(windowAgg?.costCents ?? 0),
            events: Number(windowAgg?.events ?? 0),
            avgPerEventCents,
            minPerEventCents: Number(windowAgg?.minPerEventCents ?? 0),
            maxPerEventCents: Number(windowAgg?.maxPerEventCents ?? 0),
          },
          distribution: distRows.map((r) => ({
            bucket: Number(r.bucket),
            count: Number(r.count),
          })),
          topOrgs,
          alternatives,
          recommendations,
          errorRate,
          latency,
          // Reconciliation placeholder — wired up once invoice ingestion lands.
          reconciliation: {
            ledgerSumCents: Number(windowAgg?.costCents ?? 0),
            invoiceSumCents: null,
            deltaCents: null,
            note: "Provider invoice ingestion not yet wired — showing ledger sum only.",
          },
        });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );
}
