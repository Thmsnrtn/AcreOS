/**
 * usePaxNeedsYou — the ONE client read of "Waiting for your tap"
 * (the Pax controls spec §3c, §4.5; frozen wave-1 contract 4).
 *
 * Every badge and every PaxAskCard host reads the queue through here, so the
 * sidebar door, the mobile door, the /ai strip, Today's queue and the chat
 * cards cannot disagree about what is waiting:
 *
 *   usePaxNeedsYou()        → the server-formatted items (GET /api/pax/needs-you)
 *   usePaxNeedsYouCount()   → { count } (GET /api/pax/needs-you/count); null
 *                             until the first read lands — never a fabricated 0
 *   usePaxAskById(id)       → one item from the list, remembered once seen so
 *                             a card can keep rendering after its row leaves
 *                             the queue (approved / rejected / revised)
 *   usePaxAskActions()      → approve / reject / revise, each posting to the
 *                             approval routes and settling both queries
 *   usePaxPaused()          → whether the org is paused (GET /api/pax/controls)
 *
 * Live: the server broadcasts `pax.needs_you` { count } on the org channel
 * from propose / approve / reject / revise / the expiry sweep. On receipt the
 * count is written straight from the payload and the list is refetched. The
 * 5-minute poll is the fallback for a disconnected socket — the same pattern
 * as the inbox badge in layout-sidebar.tsx.
 *
 * No formatting happens here. The verb / to / from / text / why / origin
 * lines are server truth (server/services/paxAskSummary.ts); the client only
 * carries them to the card.
 */

import { useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useWebSocketChannel } from "@/hooks/use-websocket-channel";
import { useOrganization } from "@/hooks/use-organization";
import type { PaxAskOrigin, PaxAskSourceRef, PaxToolGroup } from "@shared/pax-controls";

export const NEEDS_YOU_KEY = ["/api/pax/needs-you"] as const;
export const NEEDS_YOU_COUNT_KEY = ["/api/pax/needs-you/count"] as const;
export const PAX_CONTROLS_KEY = ["/api/pax/controls"] as const;

/** The websocket event the server emits with the new count. */
export const PAX_NEEDS_YOU_EVENT = "pax.needs_you";

/** Poll fallback for a disconnected socket. */
const POLL_FALLBACK_MS = 5 * 60 * 1000;

/**
 * One item of GET /api/pax/needs-you — server/services/paxAskSummary.ts's
 * AskSummary plus the row fields the route adds. Mirrored here rather than
 * imported because the client bundle must not pull the server module graph.
 */
export interface PaxAskItem {
  id: number;
  toolName: string;
  group: PaxToolGroup | null;
  groupLabel: string | null;
  /** "Text Bill Thompson", "Mark lead #12 as hot", "Retry the failed payment". */
  verb: string;
  to: string | null;
  from: string | null;
  /** The full frozen message text, when the tool carries one. */
  text: string | null;
  /** before → after for a record write; null for anything else. */
  change: { before: unknown; after: Record<string, unknown> } | null;
  /** Pax's explanation, verbatim; null when none was recorded. Never a number. */
  why: string | null;
  whyLabel: string;
  origin: PaxAskOrigin | null;
  originPhrase: string | null;
  sourceRef: PaxAskSourceRef | null;
  expiresAt: string | null;
  expiresLine: string | null;
  parked: boolean;
  expired: boolean;
  expiredLine: string | null;
  alwaysAsks: boolean;
  waitingBecause: string;
  standingLine: string;
  status: "pending" | "expired";
  createdAt?: string | null;
  /**
   * The frozen args, when the route includes them. Edit → revise needs the
   * whole frozen object to send a faithful revision; a card without them
   * offers no Edit (it will not guess).
   */
  args?: Record<string, unknown>;
}

interface NeedsYouResponse {
  items: PaxAskItem[];
}

interface NeedsYouCountResponse {
  count: number;
}

/**
 * Subscribe this consumer to the org's live queue events. Shares the app's
 * single WebSocket (useWebSocketChannel wraps useRealtime); multiple mounted
 * consumers are fine.
 */
function useNeedsYouLive() {
  const queryClient = useQueryClient();
  const { data: organization } = useOrganization();
  useWebSocketChannel(organization?.id ? `org:${organization.id}` : "", (event) => {
    if (event.type !== PAX_NEEDS_YOU_EVENT) return;
    const count = (event.payload as { count?: unknown } | undefined)?.count;
    if (typeof count === "number" && Number.isFinite(count)) {
      queryClient.setQueryData<NeedsYouCountResponse>([...NEEDS_YOU_COUNT_KEY], { count });
    } else {
      queryClient.invalidateQueries({ queryKey: [...NEEDS_YOU_COUNT_KEY] });
    }
    queryClient.invalidateQueries({ queryKey: [...NEEDS_YOU_KEY] });
  });
}

/** The queue: pending rows soonest-expiring first, then the last 7 days of expired. */
export function usePaxNeedsYou() {
  useNeedsYouLive();
  const query = useQuery<NeedsYouResponse>({
    queryKey: [...NEEDS_YOU_KEY],
    refetchInterval: POLL_FALLBACK_MS,
  });
  const items = query.data?.items ?? [];
  return {
    items,
    pending: items.filter((i) => i.status === "pending"),
    expired: items.filter((i) => i.status === "expired"),
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isFetching: query.isFetching,
  };
}

/** The badge number. `null` until the server has answered once — a badge must not invent 0. */
export function usePaxNeedsYouCount(): { count: number | null; isLoading: boolean } {
  useNeedsYouLive();
  const query = useQuery<NeedsYouCountResponse>({
    queryKey: [...NEEDS_YOU_COUNT_KEY],
    refetchInterval: POLL_FALLBACK_MS,
  });
  const count = typeof query.data?.count === "number" ? query.data.count : null;
  return { count, isLoading: query.isLoading };
}

/**
 * One ask by id, for a host that learned the id from the chat stream. The
 * row is remembered once seen so the card survives its own approval (the
 * list drops executed rows; the chat message must not blank).
 */
export function usePaxAskById(pendingActionId: number | null | undefined): {
  ask: PaxAskItem | null;
  /** True only while the first list read is still in flight. */
  isLoading: boolean;
} {
  const { items, isLoading } = usePaxNeedsYou();
  const rememberedRef = useRef<PaxAskItem | null>(null);
  const live = pendingActionId != null ? items.find((i) => i.id === pendingActionId) ?? null : null;
  if (live) rememberedRef.current = live;
  return { ask: live ?? rememberedRef.current, isLoading: isLoading && !rememberedRef.current };
}

export type PaxAskDecisionOutcome =
  | { ok: true; note?: string; newId?: number }
  | { ok: false; note: string };

function noteFromError(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) return message;
  }
  return fallback;
}

/**
 * The three taps. Each posts to the approval route that owns the frozen row
 * (POST /api/pax/pending-actions/:id/{approve,reject,revise}) and then
 * settles both queue queries so every badge and host re-reads. Nothing is
 * executed client-side; a failed request reports the server's own message.
 */
export function usePaxAskActions() {
  const queryClient = useQueryClient();

  const settle = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [...NEEDS_YOU_KEY] });
    queryClient.invalidateQueries({ queryKey: [...NEEDS_YOU_COUNT_KEY] });
  }, [queryClient]);

  const approve = useCallback(
    async (pendingActionId: number): Promise<PaxAskDecisionOutcome> => {
      try {
        const res = await apiRequest("POST", `/api/pax/pending-actions/${pendingActionId}/approve`, {});
        const body = (await res.json().catch(() => null)) as
          | { alreadyExecuted?: boolean; inFlight?: boolean; executed?: boolean }
          | null;
        settle();
        if (body?.inFlight) return { ok: true, note: "Already on its way from an earlier tap." };
        if (body?.alreadyExecuted) return { ok: true, note: "Already done — an earlier tap handled this." };
        return { ok: true };
      } catch (error) {
        settle();
        return { ok: false, note: noteFromError(error, "This wasn't done. Ask Pax to draft it again.") };
      }
    },
    [settle],
  );

  const reject = useCallback(
    async (pendingActionId: number): Promise<PaxAskDecisionOutcome> => {
      try {
        await apiRequest("POST", `/api/pax/pending-actions/${pendingActionId}/reject`, {});
        settle();
        return { ok: true };
      } catch (error) {
        settle();
        return { ok: false, note: noteFromError(error, "Couldn't reject this — try again.") };
      }
    },
    [settle],
  );

  const revise = useCallback(
    async (pendingActionId: number, args: Record<string, unknown>): Promise<PaxAskDecisionOutcome> => {
      try {
        const res = await apiRequest("POST", `/api/pax/pending-actions/${pendingActionId}/revise`, { args });
        const body = (await res.json().catch(() => null)) as { id?: number } | null;
        settle();
        return { ok: true, newId: typeof body?.id === "number" ? body.id : undefined };
      } catch (error) {
        settle();
        return { ok: false, note: noteFromError(error, "Couldn't save your edit — the original is still waiting.") };
      }
    },
    [settle],
  );

  return { approve, reject, revise };
}

interface PaxControlsPausedSlice {
  paused: boolean;
  checkFailed?: boolean;
}

/** Whether the org is paused — read from the one controls route, never from the caller's prefs. */
export function usePaxPaused(): { paused: boolean | null } {
  const query = useQuery<PaxControlsPausedSlice>({
    queryKey: [...PAX_CONTROLS_KEY],
    staleTime: 60 * 1000,
  });
  return { paused: typeof query.data?.paused === "boolean" ? query.data.paused : null };
}
