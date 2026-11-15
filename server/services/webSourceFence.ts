/**
 * PX-1 — the web-sourced-rows fence and the browse receipt (register P-4).
 *
 * THE DEFECT. Pax's `browse_web` could turn a page's text into property and
 * lead records with no licence check, no row cap and no receipt. The licensed-
 * data fence held by the model's good behaviour, not by a gate. Browse must
 * never become a side channel around the lookup gate and the licensing
 * dossiers (`statewideSourceRegistry.ts`: today no state is cleared).
 *
 * WHAT THIS MODULE IS, in three small parts:
 *
 *   1. TURN CORRELATION. `executeTool` carries an `ExecuteToolOptions.turnId`
 *      (minted once per Pax turn by the chat loops in server/ai/executive.ts).
 *      Nothing in the tool context identified a turn before this change.
 *   2. A per-turn BROWSE REGISTRY keyed `orgId:turnId` — which hosts this turn
 *      has read, and how many web-sourced rows it has already created. Records
 *      created later in the same turn are web-sourced and carry
 *      `web:<host>` provenance. In-process, bounded, expiring: it is a
 *      conversation-turn fact, not a record, so no table (and no migration).
 *   3. The FENCE. More than WEB_SOURCED_ROW_CAP web-sourced rows in one turn is
 *      refused — whole, never truncated — unless EVERY host the turn read is on
 *      the operator's cleared-source list, which is EMPTY by default
 *      (fail-closed; BROWSE_WEB_CLEARED_SOURCE_HOSTS, same env pattern as
 *      server/utils/browsePolicy.ts, extendable without a deploy).
 *
 * A turn with no `turnId` (a caller that never minted one) cannot be linked to
 * a browse; that is a known limit, recorded in BUILD-NOTES, and every Pax chat
 * lane (processChat / streamChat) does mint one.
 */

import { recordPaxEffect } from "./paxReceipts";
import { logger } from "../utils/logger";
import { clock } from "../utils/clock";
import type { PaxStance } from "@shared/pax-controls";

/**
 * The most web-sourced rows one turn may create unless every source host is
 * cleared. Five: enough for "add the few parcels on this listing page" typed
 * by a person who is looking at them, far below what a scraped table or an
 * extracted results page yields (a page of parcels is dozens). The fence is a
 * licence check against bulk harvesting, not a throttle on honest use.
 */
export const WEB_SOURCED_ROW_CAP = 5;

/** A turn's browse record is dropped this long after it was last touched. */
const BROWSE_TURN_TTL_MS = 60 * 60 * 1000;

/** Hard bound on tracked turns so a long-lived process cannot grow the map without limit. */
const MAX_TRACKED_TURNS = 5000;

/** The env var an operator sets (comma-separated host suffixes) to clear a source. */
export const CLEARED_SOURCE_ENV = "BROWSE_WEB_CLEARED_SOURCE_HOSTS";

interface TurnBrowse {
  hosts: Set<string>;
  /** Web-sourced rows this turn has already been allowed to create. */
  rows: number;
  touchedAt: number;
}

const turns = new Map<string, TurnBrowse>();

const keyOf = (orgId: number, turnId: string) => `${orgId}:${turnId}`;

function normalizeHost(hostname: string): string {
  return String(hostname ?? "").trim().toLowerCase().replace(/\.$/, "");
}

function sweep(now: number): void {
  for (const [k, v] of turns) {
    if (now - v.touchedAt > BROWSE_TURN_TTL_MS) turns.delete(k);
  }
  // Still over the bound (a burst inside the TTL): drop the oldest first.
  while (turns.size >= MAX_TRACKED_TURNS) {
    const oldest = turns.keys().next().value;
    if (oldest === undefined) break;
    turns.delete(oldest);
  }
}

/** Test seam: forget every turn. */
export function resetBrowseRegistryForTests(): void {
  turns.clear();
}

/** Record that this turn read a page on `hostname`. No turnId → nothing to key on; a no-op. */
export function noteBrowseInTurn(orgId: number, turnId: string | undefined | null, hostname: string, now: number = clock.nowMs()): void {
  if (!turnId) return;
  const host = normalizeHost(hostname);
  if (!host) return;
  const key = keyOf(orgId, turnId);
  let entry = turns.get(key);
  if (!entry) {
    sweep(now);
    entry = { hosts: new Set(), rows: 0, touchedAt: now };
    turns.set(key, entry);
  }
  entry.hosts.add(host);
  entry.touchedAt = now;
}

/** The hosts this turn has read, oldest first; empty when none (or no turn). */
function webHostsForTurn(orgId: number, turnId: string | undefined | null, now: number = clock.nowMs()): string[] {
  if (!turnId) return [];
  const entry = turns.get(keyOf(orgId, turnId));
  if (!entry) return [];
  if (now - entry.touchedAt > BROWSE_TURN_TTL_MS) {
    turns.delete(keyOf(orgId, turnId));
    return [];
  }
  return Array.from(entry.hosts);
}

/** `web:<host>` for each host, comma-joined when a turn read more than one. */
function webSourceTag(hosts: readonly string[]): string {
  return hosts.map((h) => `web:${h}`).join(",");
}

/** Operator list → lower-cased host suffixes. Same parsing as browsePolicy. */
function parseClearedSourceHosts(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^\.+/, ""))
    .filter((s) => s.length > 0);
}

function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** True only when the list is non-empty and every host matches one of its suffixes. */
function allHostsCleared(hosts: readonly string[], cleared: readonly string[]): boolean {
  if (hosts.length === 0 || cleared.length === 0) return false;
  return hosts.every((h) => cleared.some((d) => hostMatchesDomain(h, d)));
}

export type WebFenceVerdict =
  | { webSourced: false }
  | { webSourced: true; allowed: true; hosts: string[]; tag: string; cleared: boolean }
  | { webSourced: true; allowed: false; hosts: string[]; tag: string; cap: number; alreadyThisTurn: number; asked: number };

/**
 * Decide whether `rowCount` more rows may be created this turn.
 *
 * Not web-sourced (the turn read no page): the fence has nothing to say.
 * Web-sourced and every host cleared: allowed, still tagged. Otherwise the
 * turn's total web-sourced rows (including these) must stay within the cap.
 * Allowed rows are RESERVED against the turn here, so a model cannot slip past
 * the cap by calling a single-row create fifty times.
 */
export function checkWebSourcedRows(
  orgId: number,
  turnId: string | undefined | null,
  rowCount: number,
  opts: { clearedHosts?: readonly string[]; now?: number } = {},
): WebFenceVerdict {
  const now = opts.now ?? clock.nowMs();
  const hosts = webHostsForTurn(orgId, turnId, now);
  if (hosts.length === 0 || !turnId) return { webSourced: false };
  const tag = webSourceTag(hosts);
  const cleared = opts.clearedHosts ?? parseClearedSourceHosts(process.env[CLEARED_SOURCE_ENV]);
  if (allHostsCleared(hosts, cleared)) {
    return { webSourced: true, allowed: true, hosts, tag, cleared: true };
  }
  const entry = turns.get(keyOf(orgId, turnId))!;
  if (entry.rows + rowCount > WEB_SOURCED_ROW_CAP) {
    return { webSourced: true, allowed: false, hosts, tag, cap: WEB_SOURCED_ROW_CAP, alreadyThisTurn: entry.rows, asked: rowCount };
  }
  entry.rows += rowCount;
  entry.touchedAt = now;
  return { webSourced: true, allowed: true, hosts, tag, cleared: false };
}

/**
 * The receipt for a browse. The tool is pause-safe (a look, not an effect on
 * the customer's records), so the generic post-dispatch hook skips it; this
 * writes one on the browse path itself. Best-effort by contract: a receipt
 * failure never breaks the browse, but it is logged.
 *
 * URL query strings and fragments are dropped — they can carry tokens.
 */
export async function recordBrowseReceipt(input: {
  orgId: number;
  userId?: string | null;
  origin: Parameters<typeof recordPaxEffect>[0]["origin"];
  stance?: PaxStance | null;
  turnId?: string | null;
  url: string;
  outcome: "read" | "refused" | "failed";
}): Promise<{ written: boolean }> {
  try {
    let host = "";
    let where = input.url;
    try {
      const u = new URL(input.url);
      host = normalizeHost(u.hostname);
      where = `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
      host = "";
    }
    return await recordPaxEffect({
      orgId: input.orgId,
      actor: "pax",
      origin: input.origin,
      stance: input.stance ?? null,
      tool: "browse_web",
      action: "browse_web",
      entityType: "organization",
      entityId: input.orgId,
      description: `Read a web page on ${host || "an unknown site"}`,
      after: { host, url: where, turnId: input.turnId ?? null, outcome: input.outcome },
      witnessed: false,
      userId: input.userId ?? null,
    });
  } catch (err) {
    logger.error("[browse_web] Browse receipt failed — the page read stands, the record does not", err as Error, {
      orgId: input.orgId,
      metadata: { turnId: input.turnId ?? null },
    });
    return { written: false };
  }
}
