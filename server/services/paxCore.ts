/**
 * Pax core — E2 slice 1, legs 1, 3 and 5 (package 2026-11-03).
 *
 * One module for the four things slice 1 adds on top of the Pax substrate:
 *
 *   MEMORY   pax_business_memory. The user creates, edits and deletes items.
 *            Pax adds one ONLY when the user approves a memory proposal
 *            (a packet). Pax never writes memory silently, and there is no
 *            other write path. Pax READS it as data — never as instructions.
 *   PACKETS  pax_packets. Reviewable prepared work, prepared → approved |
 *            dismissed. Approving a memory proposal saves the memory — a
 *            write the user could already make in the panel. Approval never
 *            executes a send, payment or signature: slice 1 has no packet
 *            kind that could, and a kind that would must freeze through the
 *            approval kernel (approvalKernel.proposePendingAction), never a
 *            second approval path.
 *   RAILS    pax_rails. What Pax may prepare WITHOUT being asked, keyed by a
 *            scope the server enforces (PAX_RAIL_SCOPES). The sentence is the
 *            user's, shown verbatim. A rail never authorizes execution.
 *   LEDGER   pax_trust_ledger, append-only (UPDATE refused by trigger).
 *            The preset and shadow mode are READ from it: the latest event
 *            wins, none = the D2 default (Prepare only, shadow off).
 *
 * THE CHOKE POINT is preparePacket(). Every packet and every shadow entry in
 * this slice is made there, and it decides in this order:
 *   1. Stand-down — the Pax Pause (paxPause.getPaxPauseState), the org-wide
 *      switch on Settings → Pax. While paused: nothing is prepared and NO
 *      shadow entry accrues. A failed pause read is treated as paused.
 *      Registered as UNATTENDED_PATHS "prepared_work".
 *   2. Settings — an unreadable ledger prepares nothing (fail closed).
 *   3. Preset + rail — Prepare only AND the rail in force → a packet.
 *      Otherwise, with shadow mode on, a shadow entry (never surfaced as
 *      prepared work, never executable); with it off, nothing.
 *
 * Every query is pinned to the organizationId the caller passes — the
 * session's org on routes, the tool loop's org on the chat path — never a
 * value a model supplied.
 */

import { and, desc, eq, gte, inArray } from "drizzle-orm";
import {
  activityLog,
  paxBusinessMemory,
  paxPackets,
  paxRails,
  paxTrustLedger,
  type PaxBusinessMemoryItem,
  type PaxMemoryCategory,
  type PaxPacket,
  type PaxPacketConcern,
  type PaxPacketKind,
  type PaxPacketPayload,
  type PaxPacketSection,
  PAX_MEMORY_CATEGORIES,
} from "@shared/schema";
import {
  PAX_DEFAULT_PRESET,
  PAX_LEDGER_RECEIPT_ACTIONS,
  PAX_MEMORY_CATEGORY_WORDS,
  PAX_RAIL_SCOPES,
  isSelectablePreset,
  type PaxLedgerEvent,
  type PaxPresetId,
} from "@shared/pax-core";
import { db } from "../db";
import { clock } from "../utils/clock";
import { logger } from "../utils/logger";
import { getPaxPauseState } from "./paxPause";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

// ── Ledger ──────────────────────────────────────────────────────────────────

export interface LedgerAppend {
  organizationId: number;
  event: PaxLedgerEvent;
  /** "pax", or the acting user's id. */
  actor: string;
  subjectType?: string | null;
  subjectId?: number | null;
  shadow?: boolean;
  detail: Record<string, unknown>;
}

async function appendLedger(entry: LedgerAppend, ex: Executor = db): Promise<number> {
  const [row] = await ex
    .insert(paxTrustLedger)
    .values({
      organizationId: entry.organizationId,
      event: entry.event,
      actor: entry.actor,
      subjectType: entry.subjectType ?? null,
      subjectId: entry.subjectId ?? null,
      shadow: entry.shadow ?? false,
      detail: entry.detail,
    })
    .returning({ id: paxTrustLedger.id });
  return row.id;
}

export interface AutonomySettings {
  preset: PaxPresetId;
  shadowMode: boolean;
  /** True when the ledger could not be read — callers prepare nothing. */
  readFailed: boolean;
}

/** The preset and shadow mode, from the latest ledger events (D2 default when none). */
export async function getAutonomySettings(organizationId: number): Promise<AutonomySettings> {
  try {
    const latest = async (events: PaxLedgerEvent[]) =>
      (
        await db
          .select({ event: paxTrustLedger.event, detail: paxTrustLedger.detail })
          .from(paxTrustLedger)
          .where(and(eq(paxTrustLedger.organizationId, organizationId), inArray(paxTrustLedger.event, events)))
          .orderBy(desc(paxTrustLedger.createdAt), desc(paxTrustLedger.id))
          .limit(1)
      )[0];
    const [presetRow, shadowRow] = await Promise.all([
      latest(["preset_changed"]),
      latest(["shadow_mode_on", "shadow_mode_off"]),
    ]);
    const to = presetRow?.detail?.to;
    return {
      preset: isSelectablePreset(to) ? to : PAX_DEFAULT_PRESET,
      shadowMode: shadowRow?.event === "shadow_mode_on",
      readFailed: false,
    };
  } catch (e) {
    logger.warn("[pax-core] autonomy settings read failed", { orgId: organizationId, error: (e as Error).message });
    return { preset: PAX_DEFAULT_PRESET, shadowMode: false, readFailed: true };
  }
}

export class PaxCoreRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaxCoreRefusal";
  }
}

export async function setPreset(organizationId: number, preset: unknown, userId: string): Promise<AutonomySettings> {
  if (!isSelectablePreset(preset)) {
    // Act-inside-rails and Custom are shown, never activatable, in slice 1.
    throw new PaxCoreRefusal("That preset is not available yet — it arrives with earned expansion.");
  }
  const before = await getAutonomySettings(organizationId);
  if (before.readFailed) throw new PaxCoreRefusal("Your current Pax settings could not be read; nothing was changed.");
  if (before.preset !== preset) {
    await appendLedger({
      organizationId,
      event: "preset_changed",
      actor: userId,
      detail: { from: before.preset, to: preset },
    });
  }
  return { ...before, preset };
}

export async function setShadowMode(organizationId: number, on: boolean, userId: string): Promise<AutonomySettings> {
  const before = await getAutonomySettings(organizationId);
  if (before.readFailed) throw new PaxCoreRefusal("Your current Pax settings could not be read; nothing was changed.");
  if (before.shadowMode !== on) {
    await appendLedger({ organizationId, event: on ? "shadow_mode_on" : "shadow_mode_off", actor: userId, detail: {} });
  }
  return { ...before, shadowMode: on };
}

export interface TimelineEntry {
  key: string;
  event: string;
  actor: string;
  shadow: boolean;
  subjectType: string | null;
  subjectId: number | null;
  detail: Record<string, unknown>;
  at: string;
  /** "ledger" (pax_trust_ledger) or "receipt" (activity_log — pause / resume / controls). */
  from: "ledger" | "receipt";
}

/**
 * The trust-ledger timeline: ledger entries plus the stand-down / controls
 * receipts activity_log already holds (reused, not copied), newest first.
 */
export async function listTimeline(organizationId: number, limit: number): Promise<TimelineEntry[]> {
  const [ledger, receipts] = await Promise.all([
    db
      .select()
      .from(paxTrustLedger)
      .where(eq(paxTrustLedger.organizationId, organizationId))
      .orderBy(desc(paxTrustLedger.createdAt), desc(paxTrustLedger.id))
      .limit(limit),
    db
      .select({
        id: activityLog.id,
        action: activityLog.action,
        userId: activityLog.userId,
        description: activityLog.description,
        createdAt: activityLog.createdAt,
      })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.organizationId, organizationId),
          eq(activityLog.agentType, "pax"),
          inArray(activityLog.action, [...PAX_LEDGER_RECEIPT_ACTIONS]),
        ),
      )
      .orderBy(desc(activityLog.createdAt))
      .limit(limit),
  ]);
  const out: TimelineEntry[] = [
    ...ledger.map((r) => ({
      key: `l-${r.id}`,
      event: r.event,
      actor: r.actor,
      shadow: r.shadow,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      detail: r.detail ?? {},
      at: r.createdAt.toISOString(),
      from: "ledger" as const,
    })),
    ...receipts.map((r) => ({
      key: `r-${r.id}`,
      event: r.action,
      actor: r.userId ?? "pax",
      shadow: false,
      subjectType: "organization",
      subjectId: organizationId,
      detail: { description: r.description ?? null },
      at: (r.createdAt ?? new Date(0)).toISOString(),
      from: "receipt" as const,
    })),
  ];
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.key < b.key ? 1 : -1)).slice(0, limit);
}

export interface PresetPreview {
  preset: PaxPresetId;
  windowDays: number;
  /** False when the ledger holds no preparation history in the window. */
  hasHistory: boolean;
  /** What happened in the window, from the ledger. */
  prepared: number;
  shadow: number;
  /** Under the previewed preset, the same history would have been: */
  wouldHavePrepared: number;
  wouldHaveBeenShadowOrSkipped: number;
}

const PREVIEW_WINDOW_DAYS = 30;

/** Last month's counts under a different preset — from the ledger, never synthetic. */
export async function previewPreset(organizationId: number, preset: unknown): Promise<PresetPreview> {
  if (!isSelectablePreset(preset)) throw new PaxCoreRefusal("There is no preview for a preset that is not available yet.");
  const since = new Date(clock.nowMs() - PREVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ event: paxTrustLedger.event, detail: paxTrustLedger.detail })
    .from(paxTrustLedger)
    .where(
      and(
        eq(paxTrustLedger.organizationId, organizationId),
        inArray(paxTrustLedger.event, ["packet_prepared", "shadow_recorded"]),
        gte(paxTrustLedger.createdAt, since),
      ),
    );
  const prepared = rows.filter((r) => r.event === "packet_prepared").length;
  const shadowRows = rows.filter((r) => r.event === "shadow_recorded");
  // Only work suppressed BY THE PRESET would change hands; a revoked rail
  // suppresses it under either preset.
  const suppressedByPreset = shadowRows.filter((r) => r.detail?.reason === "watch_only").length;
  const wouldHavePrepared = preset === "watch_only" ? 0 : prepared + suppressedByPreset;
  return {
    preset,
    windowDays: PREVIEW_WINDOW_DAYS,
    hasHistory: rows.length > 0,
    prepared,
    shadow: shadowRows.length,
    wouldHavePrepared,
    wouldHaveBeenShadowOrSkipped: prepared + shadowRows.length - wouldHavePrepared,
  };
}

// ── Rails ───────────────────────────────────────────────────────────────────

export interface RailView {
  key: string;
  text: string;
  active: boolean;
  governs: string;
  updatedAt: string | null;
}

/** Every rail scope, with the org's row where one exists (default sentence, in force, otherwise). */
export async function listRails(organizationId: number): Promise<RailView[]> {
  const rows = await db.select().from(paxRails).where(eq(paxRails.organizationId, organizationId));
  return PAX_RAIL_SCOPES.map((scope) => {
    const row = rows.find((r) => r.railKey === scope.key);
    return {
      key: scope.key,
      text: row?.text ?? scope.defaultText,
      active: row?.active ?? true,
      governs: scope.governs,
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    };
  });
}

function scopeOf(key: string) {
  const scope = PAX_RAIL_SCOPES.find((s) => s.key === key);
  if (!scope) throw new PaxCoreRefusal("There is no rail by that name.");
  return scope;
}

async function isRailActive(organizationId: number, key: string): Promise<boolean> {
  const [row] = await db
    .select({ active: paxRails.active })
    .from(paxRails)
    .where(and(eq(paxRails.organizationId, organizationId), eq(paxRails.railKey, key)))
    .limit(1);
  return row?.active ?? true;
}

async function upsertRail(
  organizationId: number,
  key: string,
  patch: { text?: string; active?: boolean },
  userId: string,
  tx: Tx,
): Promise<{ before: { text: string; active: boolean }; after: { text: string; active: boolean } }> {
  const scope = scopeOf(key);
  const [existing] = await tx
    .select()
    .from(paxRails)
    .where(and(eq(paxRails.organizationId, organizationId), eq(paxRails.railKey, key)))
    .limit(1);
  const before = { text: existing?.text ?? scope.defaultText, active: existing?.active ?? true };
  const after = { text: patch.text ?? before.text, active: patch.active ?? before.active };
  const now = clock.now();
  await tx
    .insert(paxRails)
    .values({ organizationId, railKey: key, text: after.text, active: after.active, updatedBy: userId, updatedAt: now })
    .onConflictDoUpdate({
      target: [paxRails.organizationId, paxRails.railKey],
      set: { text: after.text, active: after.active, updatedBy: userId, updatedAt: now },
    });
  return { before, after };
}

export async function editRail(organizationId: number, key: string, text: string, userId: string): Promise<RailView[]> {
  await db.transaction(async (tx) => {
    const { before, after } = await upsertRail(organizationId, key, { text }, userId, tx);
    if (before.text !== after.text) {
      await appendLedger(
        { organizationId, event: "rail_edited", actor: userId, detail: { railKey: key, from: before.text, to: after.text } },
        tx,
      );
    }
  });
  return listRails(organizationId);
}

export async function setRailActive(organizationId: number, key: string, active: boolean, userId: string): Promise<RailView[]> {
  await db.transaction(async (tx) => {
    const { before } = await upsertRail(organizationId, key, { active }, userId, tx);
    if (before.active !== active) {
      await appendLedger(
        { organizationId, event: active ? "rail_restored" : "rail_revoked", actor: userId, detail: { railKey: key } },
        tx,
      );
    }
  });
  return listRails(organizationId);
}

// ── The choke point: preparing work ─────────────────────────────────────────

export interface PrepareRequest<K extends PaxPacketKind = PaxPacketKind> {
  organizationId: number;
  railKey: string;
  kind: K;
  title: string;
  concerns: PaxPacketConcern[];
  sections: PaxPacketSection[];
  payload: PaxPacketPayload[K];
}

export type PrepareOutcome =
  | { status: "prepared"; packet: PaxPacket }
  | { status: "shadow"; ledgerId: number; reason: "watch_only" | "rail_revoked" }
  | { status: "not_prepared"; reason: "watch_only" | "rail_revoked" | "settings_unreadable" }
  | { status: "stood_down"; checkFailed: boolean };

function assertProvenance(sections: PaxPacketSection[]): void {
  if (sections.length === 0) throw new Error("A packet needs at least one section");
  for (const s of sections) {
    // The nano bar: a section without provenance is a bug, not a degraded packet.
    if (!s.source?.trim() || !s.asOf || Number.isNaN(Date.parse(s.asOf))) {
      throw new Error(`Packet section "${s.heading}" has no provenance`);
    }
  }
}

export async function preparePacket<K extends PaxPacketKind>(params: PrepareRequest<K>): Promise<PrepareOutcome> {
  // 1. Stand-down — FIRST: while Pax is paused nothing is prepared and no
  // shadow entry accrues. A failed read is treated as paused (fail closed).
  const pause = await getPaxPauseState(params.organizationId);
  if (pause.paused) return { status: "stood_down", checkFailed: pause.checkFailed };

  assertProvenance(params.sections);
  scopeOf(params.railKey);

  // 2. Settings — unreadable means nothing is prepared.
  const settings = await getAutonomySettings(params.organizationId);
  if (settings.readFailed) return { status: "not_prepared", reason: "settings_unreadable" };

  // 3. Preset + rail.
  const railActive = await isRailActive(params.organizationId, params.railKey);
  const suppressedBy: "watch_only" | "rail_revoked" | null =
    settings.preset !== "prepare_only" ? "watch_only" : !railActive ? "rail_revoked" : null;

  if (suppressedBy) {
    if (!settings.shadowMode) return { status: "not_prepared", reason: suppressedBy };
    const ledgerId = await appendLedger({
      organizationId: params.organizationId,
      event: "shadow_recorded",
      actor: "pax",
      shadow: true,
      detail: {
        reason: suppressedBy,
        railKey: params.railKey,
        kind: params.kind,
        title: params.title,
        concerns: params.concerns,
        sections: params.sections,
      },
    });
    return { status: "shadow", ledgerId, reason: suppressedBy };
  }

  const packet = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(paxPackets)
      .values({
        organizationId: params.organizationId,
        kind: params.kind,
        title: params.title,
        concerns: params.concerns,
        sections: params.sections,
        payload: params.payload,
        railKey: params.railKey,
      })
      .returning();
    await appendLedger(
      {
        organizationId: params.organizationId,
        event: "packet_prepared",
        actor: "pax",
        subjectType: "packet",
        subjectId: row.id,
        detail: { kind: row.kind, title: row.title, railKey: row.railKey },
      },
      tx,
    );
    return row;
  });
  return { status: "prepared", packet };
}

/** Map the chat tool's category words onto the memory categories. */
export function memoryCategoryFrom(raw: unknown): PaxMemoryCategory {
  return (PAX_MEMORY_CATEGORIES as readonly string[]).includes(String(raw)) ? (raw as PaxMemoryCategory) : "other";
}

const MEMORY_PROPOSAL_RAIL = "memory_proposals";

/**
 * The chat path's memory proposal (the remember_fact tool). Pax suggests; the
 * user approves. Nothing is saved here.
 */
export async function proposeMemoryFromChat(params: {
  organizationId: number;
  content: string;
  category: PaxMemoryCategory;
}): Promise<PrepareOutcome> {
  const content = params.content.trim();
  const words = PAX_MEMORY_CATEGORY_WORDS[params.category] ?? "Other";
  return preparePacket({
    organizationId: params.organizationId,
    railKey: MEMORY_PROPOSAL_RAIL,
    kind: "memory_proposal",
    title: `Remember: ${content.length > 80 ? `${content.slice(0, 77)}…` : content}`,
    concerns: [{ type: "memory", id: null, label: words, href: "/settings/pax#pax-memory" }],
    sections: [
      {
        heading: "What Pax would remember",
        body: content,
        source: "Your conversation with Pax",
        asOf: clock.now().toISOString(),
      },
      {
        heading: "If you approve",
        body: `It is saved to your business memory under "${words}". You can edit or delete it there at any time. Nothing else happens.`,
        source: "Pax memory rules",
        asOf: clock.now().toISOString(),
      },
    ],
    payload: { category: params.category, content },
  });
}

// ── Packets ─────────────────────────────────────────────────────────────────

export async function listPackets(organizationId: number, status: PaxPacket["status"] | "all", limit = 50): Promise<PaxPacket[]> {
  const where =
    status === "all"
      ? eq(paxPackets.organizationId, organizationId)
      : and(eq(paxPackets.organizationId, organizationId), eq(paxPackets.status, status));
  return db.select().from(paxPackets).where(where).orderBy(desc(paxPackets.createdAt), desc(paxPackets.id)).limit(limit);
}

export async function getPacket(organizationId: number, id: number): Promise<PaxPacket | null> {
  const [row] = await db
    .select()
    .from(paxPackets)
    .where(and(eq(paxPackets.id, id), eq(paxPackets.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export type DecideResult =
  | { status: "decided"; packet: PaxPacket; memory: PaxBusinessMemoryItem | null }
  | { status: "not_found" }
  | { status: "already_decided"; packet: PaxPacket };

/**
 * Approve or dismiss a prepared packet. A human tap — it runs while Pax is
 * paused, like an approval-kernel tap. Approval executes nothing beyond the
 * packet kind's own acceptance: a memory proposal is saved to memory.
 */
export async function decidePacket(
  organizationId: number,
  id: number,
  decision: "approve" | "dismiss",
  userId: string,
): Promise<DecideResult> {
  return db.transaction(async (tx) => {
    const now = clock.now();
    const [packet] = await tx
      .update(paxPackets)
      .set({ status: decision === "approve" ? "approved" : "dismissed", decidedAt: now, decidedBy: userId })
      .where(and(eq(paxPackets.id, id), eq(paxPackets.organizationId, organizationId), eq(paxPackets.status, "prepared")))
      .returning();
    if (!packet) {
      const [existing] = await tx
        .select()
        .from(paxPackets)
        .where(and(eq(paxPackets.id, id), eq(paxPackets.organizationId, organizationId)))
        .limit(1);
      return existing ? { status: "already_decided" as const, packet: existing } : { status: "not_found" as const };
    }

    let memory: PaxBusinessMemoryItem | null = null;
    if (decision === "approve" && packet.kind === "memory_proposal") {
      const payload = packet.payload as PaxPacketPayload["memory_proposal"];
      [memory] = await tx
        .insert(paxBusinessMemory)
        .values({
          organizationId,
          category: memoryCategoryFrom(payload.category),
          content: payload.content,
          source: "pax-proposed",
          packetId: packet.id,
          createdBy: userId,
        })
        .returning();
    }

    await appendLedger(
      {
        organizationId,
        event: decision === "approve" ? "packet_approved" : "packet_dismissed",
        actor: userId,
        subjectType: "packet",
        subjectId: packet.id,
        detail: { kind: packet.kind, title: packet.title, memoryId: memory?.id ?? null },
      },
      tx,
    );
    return { status: "decided" as const, packet, memory };
  });
}

// ── Memory ──────────────────────────────────────────────────────────────────

export async function listMemory(organizationId: number, limit = 200): Promise<PaxBusinessMemoryItem[]> {
  return db
    .select()
    .from(paxBusinessMemory)
    .where(eq(paxBusinessMemory.organizationId, organizationId))
    .orderBy(desc(paxBusinessMemory.updatedAt), desc(paxBusinessMemory.id))
    .limit(limit);
}

export async function createMemory(
  organizationId: number,
  input: { category: PaxMemoryCategory; content: string },
  userId: string,
): Promise<PaxBusinessMemoryItem> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(paxBusinessMemory)
      .values({ organizationId, category: input.category, content: input.content, source: "user", createdBy: userId })
      .returning();
    // The ledger records THAT memory changed, never a copy of what it says —
    // so deleting an item really deletes its words.
    await appendLedger(
      { organizationId, event: "memory_created", actor: userId, subjectType: "memory", subjectId: row.id, detail: { category: row.category } },
      tx,
    );
    return row;
  });
}

export async function updateMemory(
  organizationId: number,
  id: number,
  input: { category?: PaxMemoryCategory; content?: string },
  userId: string,
): Promise<PaxBusinessMemoryItem | null> {
  return db.transaction(async (tx) => {
    const set: Partial<typeof paxBusinessMemory.$inferInsert> = { updatedAt: clock.now() };
    if (input.category !== undefined) set.category = input.category;
    if (input.content !== undefined) set.content = input.content;
    const [row] = await tx
      .update(paxBusinessMemory)
      .set(set)
      .where(and(eq(paxBusinessMemory.id, id), eq(paxBusinessMemory.organizationId, organizationId)))
      .returning();
    if (!row) return null;
    await appendLedger(
      { organizationId, event: "memory_edited", actor: userId, subjectType: "memory", subjectId: row.id, detail: { category: row.category } },
      tx,
    );
    return row;
  });
}

export async function deleteMemory(organizationId: number, id: number, userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(paxBusinessMemory)
      .where(and(eq(paxBusinessMemory.id, id), eq(paxBusinessMemory.organizationId, organizationId)))
      .returning({ id: paxBusinessMemory.id, category: paxBusinessMemory.category });
    if (!row) return false;
    await appendLedger(
      { organizationId, event: "memory_deleted", actor: userId, subjectType: "memory", subjectId: row.id, detail: { category: row.category } },
      tx,
    );
    return true;
  });
}

/**
 * The org's memory as DATA for a model prompt — the one reader every prompt
 * uses. Each item is JSON-quoted on its own line, so no item can close the
 * fence or pose as part of the prompt; the caller must still say it is data,
 * not instructions. Memory never changes rails, presets or what Pax may do.
 * Null when there is none (or none in the asked-for categories).
 */
export async function memoryAsData(
  organizationId: number,
  opts: { categories?: readonly PaxMemoryCategory[]; limit?: number } = {},
): Promise<string | null> {
  const items = (await listMemory(organizationId, opts.limit ?? 40)).filter(
    (m) => !opts.categories || opts.categories.includes(m.category),
  );
  if (items.length === 0) return null;
  return items
    .map((m) => `- [${PAX_MEMORY_CATEGORY_WORDS[m.category] ?? "Other"}] ${JSON.stringify(m.content)}`)
    .join("\n");
}
