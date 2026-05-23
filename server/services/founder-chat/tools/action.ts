/**
 * Atlas action tools — destructive writes. Tier 2 or 3.
 *
 * Every tool here returns destructivePending=true (the executor wraps
 * this into a confirmation_request artifact before the actual write).
 * On confirmation, the handler runs and audit-logs through ctx.auditLog.
 * Each provides a verifyFn the executor invokes post-action.
 *
 * Tier 2: reversible org-level overrides + decision approve/reject.
 * Tier 3: bucket transfers, dial writes, BYOK revocation, org overrides
 * (these touch shared state with broader blast radius — get a 5 min
 * same-tool cooldown per Reliability Req 3B).
 */

import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import {
  financialLedger,
  founderAudit,
  founderSettings,
  byokCredentials,
  outbox,
  outboxDlq,
  decisionsInboxItems,
} from "@shared/schema";
import { db } from "../../../db";
import { registerTool } from "../tool-registry";

const REVENUE_TRIGGER_LADDER = [
  { thresholdId: "mrr-50",     thresholdCents:    5_000, action: "Re-enable Sentry Starter",                  costOneTimeCents:     0, costRecurringCents:  2_900 },
  { thresholdId: "mrr-200",    thresholdCents:   20_000, action: "Upgrade Fly app to shared-cpu-2x",          costOneTimeCents:     0, costRecurringCents:    800 },
  { thresholdId: "mrr-500",    thresholdCents:   50_000, action: "Add 2nd Fly app machine for redundancy",    costOneTimeCents:     0, costRecurringCents:  2_400 },
  { thresholdId: "mrr-1000a",  thresholdCents:  100_000, action: "Apply for USPS Mail.dat permit",            costOneTimeCents: 35_000, costRecurringCents:  2_900 },
  { thresholdId: "mrr-1000b",  thresholdCents:  100_000, action: "Re-enable ElevenLabs Pro",                  costOneTimeCents:     0, costRecurringCents:  2_200 },
  { thresholdId: "mrr-2000",   thresholdCents:  200_000, action: "Migrate Postgres off Neon free tier",       costOneTimeCents:     0, costRecurringCents:  8_500 },
  { thresholdId: "mrr-3000",   thresholdCents:  300_000, action: "Telnyx account + A2P 10DLC registration",   costOneTimeCents:  5_000, costRecurringCents:      0 },
  { thresholdId: "mrr-5000",   thresholdCents:  500_000, action: "Wire aggregation queue + presort partner",  costOneTimeCents:     0, costRecurringCents:      0 },
  { thresholdId: "mrr-10000",  thresholdCents: 1_000_000, action: "Right-size Fly to performance-2x",         costOneTimeCents:     0, costRecurringCents: 54_000 },
];

// ─── 1. approve_trigger (T2) ───────────────────────────────────────────────
registerTool({
  name: "approve_trigger",
  description: "Approve a scale-up revenue trigger (Sentry, Fly, USPS permit, etc.).",
  category: "action",
  destructive: true,
  tier: 2,
  schema: z.object({ threshold_id: z.string().min(1), note: z.string().max(2000).optional() }),
  async handler(args, ctx) {
    const trigger = REVENUE_TRIGGER_LADDER.find((t) => t.thresholdId === args.threshold_id);
    if (!trigger) {
      return { artifact: { type: "text", markdown: `Unknown trigger: ${args.threshold_id}` } };
    }
    await db.insert(founderAudit).values({
      founderId: ctx.founderUserId, area: "scale_up", action: "approve",
      targetType: "trigger", targetId: args.threshold_id,
      after: {
        threshold: trigger.thresholdCents, action: trigger.action,
        costOneTimeCents: trigger.costOneTimeCents, costRecurringCents: trigger.costRecurringCents,
      } as any,
      note: args.note ?? null,
    } as any);
    return {
      artifact: {
        type: "trigger_card",
        approved: trigger,
        markdown: `Approved trigger \`${args.threshold_id}\`: ${trigger.action}.`,
      },
      verifyFn: async () => {
        const [row] = await db.select().from(founderAudit)
          .where(and(eq(founderAudit.area, "scale_up"), eq(founderAudit.targetId, args.threshold_id)))
          .orderBy(desc(founderAudit.createdAt)).limit(1);
        return {
          ok: !!row && row.action === "approve",
          evidence: row ? `founder_audit#${row.id} action=${row.action} created=${row.createdAt}` : "no audit row found",
        };
      },
    };
  },
});

// ─── 2. defer_trigger (T2) ──────────────────────────────────────────────────
registerTool({
  name: "defer_trigger",
  description: "Defer a scale-up trigger for N days (default 7).",
  category: "action",
  destructive: true,
  tier: 2,
  schema: z.object({ threshold_id: z.string().min(1), days: z.number().int().positive().max(60).optional() }),
  async handler(args, ctx) {
    await db.insert(founderAudit).values({
      founderId: ctx.founderUserId, area: "scale_up", action: "defer",
      targetType: "trigger", targetId: args.threshold_id,
      after: { deferDays: args.days ?? 7 } as any,
    } as any);
    return {
      artifact: { type: "text", markdown: `Deferred \`${args.threshold_id}\` for ${args.days ?? 7} days.` },
      verifyFn: async () => {
        const [row] = await db.select().from(founderAudit)
          .where(and(eq(founderAudit.area, "scale_up"), eq(founderAudit.targetId, args.threshold_id)))
          .orderBy(desc(founderAudit.createdAt)).limit(1);
        return {
          ok: !!row && row.action === "defer",
          evidence: row ? `founder_audit#${row.id} action=${row.action}` : "no audit row",
        };
      },
    };
  },
});

// ─── 3. approve_decision (T2) ───────────────────────────────────────────────
registerTool({
  name: "approve_decision",
  description: "Approve a pending decisions_inbox item.",
  category: "action",
  destructive: true,
  tier: 2,
  schema: z.object({ item_id: z.number().int().positive(), note: z.string().max(2000).optional() }),
  async handler(args, ctx) {
    const { decisionsInboxService } = await import("../../decisionsInbox");
    await decisionsInboxService.approve(args.item_id);
    return {
      artifact: { type: "text", markdown: `Approved decision #${args.item_id}.` },
      verifyFn: async () => {
        const [row] = await db.select().from(decisionsInboxItems).where(eq(decisionsInboxItems.id, args.item_id)).limit(1);
        return {
          ok: !!row && row.status === "approved",
          evidence: row ? `decision#${row.id} status=${row.status}` : "decision not found",
        };
      },
    };
  },
});

// ─── 4. reject_decision (T2) ────────────────────────────────────────────────
registerTool({
  name: "reject_decision",
  description: "Reject a pending decisions_inbox item.",
  category: "action",
  destructive: true,
  tier: 2,
  schema: z.object({ item_id: z.number().int().positive(), reason: z.string().min(1).max(2000) }),
  async handler(args) {
    const { decisionsInboxService } = await import("../../decisionsInbox");
    await decisionsInboxService.reject(args.item_id, args.reason);
    return {
      artifact: { type: "text", markdown: `Rejected decision #${args.item_id}: ${args.reason}` },
      verifyFn: async () => {
        const [row] = await db.select().from(decisionsInboxItems).where(eq(decisionsInboxItems.id, args.item_id)).limit(1);
        return {
          ok: !!row && row.status === "rejected",
          evidence: row ? `decision#${row.id} status=${row.status}` : "decision not found",
        };
      },
    };
  },
});

// ─── 5. pause_channel_for_org (T2) ──────────────────────────────────────────
registerTool({
  name: "pause_channel_for_org",
  description: "Set a per-org founder_setting that pauses a specific channel (mail/sms/email/voice).",
  category: "action",
  destructive: true,
  tier: 2,
  schema: z.object({
    org_id: z.number().int().positive(),
    channel: z.string().min(1).max(50),
    reason: z.string().min(1).max(500),
  }),
  async handler(args, ctx) {
    const key = `channel.pause.org_${args.org_id}.${args.channel}`;
    await db.insert(founderSettings).values({
      key, value: "true", valueType: "boolean", category: "channel_overrides",
      description: args.reason, updatedBy: ctx.founderUserId,
    } as any).onConflictDoUpdate({
      target: founderSettings.key,
      set: { value: "true", description: args.reason, updatedBy: ctx.founderUserId, updatedAt: new Date() },
    });
    return {
      artifact: { type: "text", markdown: `Paused \`${args.channel}\` for org ${args.org_id}: ${args.reason}` },
      verifyFn: async () => {
        const [row] = await db.select().from(founderSettings).where(eq(founderSettings.key, key)).limit(1);
        return {
          ok: !!row && row.value === "true",
          evidence: row ? `founder_settings.${key}=${row.value}` : "setting not written",
        };
      },
    };
  },
});

// ─── 6. throttle_channel_for_org (T2) ───────────────────────────────────────
registerTool({
  name: "throttle_channel_for_org",
  description: "Set a daily cap on a channel for a specific org.",
  category: "action",
  destructive: true,
  tier: 2,
  schema: z.object({
    org_id: z.number().int().positive(),
    channel: z.string().min(1).max(50),
    daily_cap: z.number().int().nonnegative(),
  }),
  async handler(args, ctx) {
    const key = `channel.throttle.org_${args.org_id}.${args.channel}`;
    await db.insert(founderSettings).values({
      key, value: String(args.daily_cap), valueType: "number", category: "channel_overrides",
      description: `daily cap=${args.daily_cap}`, updatedBy: ctx.founderUserId,
    } as any).onConflictDoUpdate({
      target: founderSettings.key,
      set: { value: String(args.daily_cap), updatedBy: ctx.founderUserId, updatedAt: new Date() },
    });
    return {
      artifact: { type: "text", markdown: `Throttled \`${args.channel}\` to ${args.daily_cap}/day for org ${args.org_id}.` },
      verifyFn: async () => {
        const [row] = await db.select().from(founderSettings).where(eq(founderSettings.key, key)).limit(1);
        return {
          ok: !!row && row.value === String(args.daily_cap),
          evidence: row ? `${key}=${row.value}` : "setting not written",
        };
      },
    };
  },
});

// ─── 7. transfer_between_buckets (T3) ───────────────────────────────────────
registerTool({
  name: "transfer_between_buckets",
  description: "Paired counter-entries in financial_ledger moving cents between two buckets.",
  category: "action",
  destructive: true,
  tier: 3,
  schema: z.object({
    from: z.enum(["tax_reserve", "refund_reserve", "profit_reserve", "owner_draw", "opex_available"]),
    to: z.enum(["tax_reserve", "refund_reserve", "profit_reserve", "owner_draw", "opex_available"]),
    cents: z.number().int().positive(),
    note: z.string().max(2000).optional(),
  }),
  async handler(args, ctx) {
    if (args.from === args.to) {
      return { artifact: { type: "text", markdown: `Cannot transfer to the same bucket.` } };
    }
    const externalId = `atlas-transfer-${Date.now()}`;
    await db.insert(financialLedger).values([
      {
        organizationId: null, bucket: args.from, category: "manual_transfer",
        amountCents: -args.cents, feature: "bucket_transfer", provider: "atlas",
        externalEventId: `${externalId}:debit`, postedAt: new Date(),
        postedBy: `founder:${ctx.founderUserId}`, notes: args.note ?? null,
      } as any,
      {
        organizationId: null, bucket: args.to, category: "manual_transfer",
        amountCents: args.cents, feature: "bucket_transfer", provider: "atlas",
        externalEventId: `${externalId}:credit`, postedAt: new Date(),
        postedBy: `founder:${ctx.founderUserId}`, notes: args.note ?? null,
      } as any,
    ]);
    return {
      artifact: {
        type: "text",
        markdown: `Transferred ${args.cents}¢ from \`${args.from}\` to \`${args.to}\`${args.note ? ` (${args.note})` : ""}.`,
      },
      verifyFn: async () => {
        const rows = await db.select().from(financialLedger)
          .where(eq(financialLedger.externalEventId, `${externalId}:credit`)).limit(1);
        return {
          ok: rows.length === 1,
          evidence: rows[0] ? `financial_ledger#${rows[0].id} bucket=${rows[0].bucket}` : "no counter-entry found",
        };
      },
    };
  },
});

// ─── 8. set_dial (T3) ───────────────────────────────────────────────────────
registerTool({
  name: "set_dial",
  description: "Write a founder_settings dial (key/value). Key prefix routes to area.",
  category: "action",
  destructive: true,
  tier: 3,
  schema: z.object({
    key: z.string().min(1).max(200),
    value: z.union([z.string(), z.number(), z.boolean()]),
    note: z.string().max(2000).optional(),
  }),
  async handler(args, ctx) {
    const valueType = typeof args.value === "boolean" ? "boolean" : typeof args.value === "number" ? "number" : "string";
    await db.insert(founderSettings).values({
      key: args.key, value: String(args.value), valueType, category: "dial",
      description: args.note ?? null, updatedBy: ctx.founderUserId,
    } as any).onConflictDoUpdate({
      target: founderSettings.key,
      set: { value: String(args.value), valueType, updatedBy: ctx.founderUserId, updatedAt: new Date() },
    });
    return {
      artifact: { type: "text", markdown: `Set dial \`${args.key}\` = \`${String(args.value)}\`.` },
      verifyFn: async () => {
        const [row] = await db.select().from(founderSettings).where(eq(founderSettings.key, args.key)).limit(1);
        return {
          ok: !!row && row.value === String(args.value),
          evidence: row ? `${args.key}=${row.value}` : "setting not written",
        };
      },
    };
  },
});

// ─── 9. retry_dlq_item (T2) ─────────────────────────────────────────────────
registerTool({
  name: "retry_dlq_item",
  description: "Re-queue a DLQ row back into the outbox.",
  category: "action",
  destructive: true,
  tier: 2,
  schema: z.object({ id: z.number().int().positive() }),
  async handler(args) {
    const result = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(outboxDlq).where(eq(outboxDlq.id, args.id)).limit(1);
      if (!row) return null;
      const [ins] = await tx.insert(outbox).values({
        eventType: row.eventType, payload: row.payload, status: "pending", attempts: 0,
      } as any).returning({ id: outbox.id });
      await tx.delete(outboxDlq).where(eq(outboxDlq.id, args.id));
      return { newOutboxId: ins.id, eventType: row.eventType };
    });
    if (!result) return { artifact: { type: "text", markdown: `DLQ row ${args.id} not found.` } };
    return {
      artifact: { type: "text", markdown: `Re-queued DLQ row #${args.id} → outbox#${result.newOutboxId} (${result.eventType}).` },
      verifyFn: async () => {
        const [row] = await db.select().from(outbox).where(eq(outbox.id, result.newOutboxId)).limit(1);
        return {
          ok: !!row && row.status === "pending",
          evidence: row ? `outbox#${row.id} status=${row.status}` : "outbox row missing",
        };
      },
    };
  },
});

// ─── 10. discard_dlq_item (T2) ─────────────────────────────────────────────
registerTool({
  name: "discard_dlq_item",
  description: "Permanently discard a DLQ row.",
  category: "action",
  destructive: true,
  tier: 2,
  schema: z.object({ id: z.number().int().positive(), reason: z.string().min(1).max(500) }),
  async handler(args, ctx) {
    const [row] = await db.select().from(outboxDlq).where(eq(outboxDlq.id, args.id)).limit(1);
    if (!row) return { artifact: { type: "text", markdown: `DLQ row ${args.id} not found.` } };
    await db.delete(outboxDlq).where(eq(outboxDlq.id, args.id));
    await db.insert(founderAudit).values({
      founderId: ctx.founderUserId, area: "dlq.discard", action: "discard",
      targetType: "dlq_row", targetId: String(args.id),
      before: { eventType: row.eventType } as any,
      note: args.reason,
    } as any);
    return {
      artifact: { type: "text", markdown: `Discarded DLQ #${args.id} (${row.eventType}): ${args.reason}` },
      verifyFn: async () => {
        const rows = await db.select().from(outboxDlq).where(eq(outboxDlq.id, args.id)).limit(1);
        return { ok: rows.length === 0, evidence: rows.length === 0 ? "row deleted" : "row still present" };
      },
    };
  },
});

// ─── 11. revoke_byok_credential (T3) ────────────────────────────────────────
registerTool({
  name: "revoke_byok_credential",
  description: "Revoke a per-org BYOK credential for a channel.",
  category: "action",
  destructive: true,
  tier: 3,
  schema: z.object({ org_id: z.number().int().positive(), channel: z.string().min(1) }),
  async handler(args) {
    await db.update(byokCredentials)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(byokCredentials.organizationId, args.org_id),
        eq(byokCredentials.channel, args.channel),
      ));
    return {
      artifact: { type: "text", markdown: `Revoked BYOK ${args.channel} for org ${args.org_id}.` },
      verifyFn: async () => {
        const rows = await db.select().from(byokCredentials)
          .where(and(
            eq(byokCredentials.organizationId, args.org_id),
            eq(byokCredentials.channel, args.channel),
          ));
        const allRevoked = rows.every((r) => r.revokedAt != null);
        return {
          ok: allRevoked,
          evidence: `byok rows: ${rows.length}, all revoked=${allRevoked}`,
        };
      },
    };
  },
});

// ─── 12. set_org_override (T3) ──────────────────────────────────────────────
registerTool({
  name: "set_org_override",
  description: "Write a per-org founder_settings override (scope=org).",
  category: "action",
  destructive: true,
  tier: 3,
  schema: z.object({
    org_id: z.number().int().positive(),
    key: z.string().min(1).max(200),
    value: z.union([z.string(), z.number(), z.boolean()]),
    note: z.string().max(2000).optional(),
  }),
  async handler(args, ctx) {
    const key = `org_${args.org_id}.${args.key}`;
    const valueType = typeof args.value === "boolean" ? "boolean" : typeof args.value === "number" ? "number" : "string";
    await db.insert(founderSettings).values({
      key, value: String(args.value), valueType, category: "org_overrides",
      description: args.note ?? null, updatedBy: ctx.founderUserId,
    } as any).onConflictDoUpdate({
      target: founderSettings.key,
      set: { value: String(args.value), valueType, updatedBy: ctx.founderUserId, updatedAt: new Date() },
    });
    return {
      artifact: { type: "text", markdown: `Set org ${args.org_id} override \`${args.key}\` = \`${String(args.value)}\`.` },
      verifyFn: async () => {
        const [row] = await db.select().from(founderSettings).where(eq(founderSettings.key, key)).limit(1);
        return {
          ok: !!row && row.value === String(args.value),
          evidence: row ? `${key}=${row.value}` : "setting not written",
        };
      },
    };
  },
});

// ─── 12.5. switch_to_customer_mode (T1, non-destructive) ───────────────────
// Persona-mode switcher tool. Atlas calls this when the founder says
// things like "go back to my dashboard" or "show me my deals". The
// navigation artifact auto-fires wouter on render — no confirmation
// gate, no audit row (it's purely client-side navigation).
registerTool({
  name: "switch_to_customer_mode",
  description: "Navigate the founder out of /founder/* and back to the customer surface (/today).",
  category: "action",
  destructive: false,
  tier: 1,
  schema: z.object({}),
  artifactType: "navigation",
  slashAliases: ["customer", "exit-founder"],
  async handler() {
    return {
      artifact: { type: "navigation", target: "/today", label: "Switching to customer mode…" },
    };
  },
});

// ─── 12.6. switch_to_founder_mode (T1, non-destructive) ────────────────────
registerTool({
  name: "switch_to_founder_mode",
  description: "Navigate from any customer surface into the founder dashboard (/founder).",
  category: "action",
  destructive: false,
  tier: 1,
  schema: z.object({}),
  artifactType: "navigation",
  slashAliases: ["founder", "atlas"],
  async handler() {
    return {
      artifact: { type: "navigation", target: "/founder", label: "Switching to founder mode…" },
    };
  },
});

// ─── 13. run_ceo_command (T2) ───────────────────────────────────────────────
// CEO command bridge integration — Atlas decides when terse imperatives
// ("pause marketing", "show forecast") should route through the existing
// natural-language interpreter rather than picking a tool itself.
registerTool({
  name: "run_ceo_command",
  description: "Interpret a terse founder imperative through the CEO Command Bridge (pause/resume/forecast/etc.).",
  category: "action",
  destructive: true,
  tier: 2,
  schema: z.object({ text: z.string().min(1).max(1000) }),
  async handler(args) {
    const { processCEOCommand } = await import("../../ceoCommandBridge");
    const result = await processCEOCommand(args.text);
    return {
      artifact: {
        type: "text",
        markdown: result.understood
          ? `Command \`${result.action}\` → ${result.result}`
          : `Command not understood: "${args.text}"`,
        ceoCommand: result,
      },
      verifyFn: async () => ({
        ok: result.understood,
        evidence: `ceoCommandBridge action=${result.action} understood=${result.understood}`,
      }),
    };
  },
});
