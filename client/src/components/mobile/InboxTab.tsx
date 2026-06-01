/**
 * InboxTab — universal mobile triage feed.
 *
 * The single highest-leverage surface from the 12-agent audit: every
 * persona has inbound responses to outreach (callbacks, SMS replies,
 * email replies, mail-piece responses). Today these are scattered or
 * absent on mobile. This component pulls them into one vertical feed
 * with swipe gestures so a founder/operator can triage from their
 * thumb in under 30 seconds.
 *
 * Persona-agnostic — every customer profile sees this exact tab. The
 * conversation entries already carry channel + lead + last-message
 * metadata, so the surface doesn't need persona branches.
 *
 * Data source: `GET /api/conversations` (returns active conversations
 * across all channels for the org). Cached 30s; refetches on focus.
 *
 * Gestures:
 *   - Swipe right ≥ 40% width  → mark contacted (status = "closed")
 *   - Swipe left  ≥ 40% width  → dismiss / snooze 24h
 *   - Tap                      → open lead detail
 *
 * Updates are optimistic — the card animates off-screen before the
 * server confirms, with rollback on error.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useRespectfulTransition, DURATIONS } from "@/lib/motion-tokens";
import { useLocation } from "wouter";
import {
  Mail,
  MessageSquare,
  Phone,
  MessageCircle,
  Inbox as InboxIcon,
  Check,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { SwipeableCard } from "@/components/mobile/SwipeableCard";
import { QueryErrorState } from "@/components/query-error-state";
import { ClearedEmpty } from "@/components/empty-states";
import { apiRequest, fetchJsonArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { relative } from "@/lib/format";

interface Conversation {
  id: number;
  organizationId: number;
  leadId: number;
  propertyId: number | null;
  channel: "email" | "sms" | "phone" | "facebook" | "whatsapp" | string;
  externalId: string | null;
  status: "active" | "closed" | "escalated" | string;
  assignedAgentId: number | null;
  assignedHumanId: number | null;
  lastMessageAt: string | null;
  createdAt: string | null;
  // Enriched fields the API may include (defensive — handle when absent).
  leadName?: string;
  leadPhone?: string | null;
  lastMessagePreview?: string;
}

function ChannelIcon({ channel }: { channel: string }) {
  switch (channel.toLowerCase()) {
    case "email":
      return <Mail className="h-4 w-4" aria-label="Email" />;
    case "sms":
      return <MessageSquare className="h-4 w-4" aria-label="SMS" />;
    case "phone":
    case "voice":
    case "voicemail":
      return <Phone className="h-4 w-4" aria-label="Phone" />;
    case "facebook":
      return <MessageCircle className="h-4 w-4" aria-label="Facebook" />;
    case "whatsapp":
      return <MessageCircle className="h-4 w-4" aria-label="WhatsApp" />;
    default:
      return <MessageSquare className="h-4 w-4" aria-label={channel} />;
  }
}

interface InboxCardProps {
  conversation: Conversation;
  onAction: (action: "contacted" | "dismissed") => void;
  onOpen: () => void;
}

function InboxCard({ conversation: c, onAction, onOpen }: InboxCardProps) {
  return (
    <SwipeableCard
      leftAction={{
        icon: Check,
        label: "Contacted",
        tone: "pos",
        onAction: () => onAction("contacted"),
      }}
      rightAction={{
        icon: X,
        label: "Snooze 24h",
        tone: "neg",
        onAction: () => onAction("dismissed"),
      }}
    >
      <Card
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className="bg-card border-border p-4 active:bg-muted/50 cursor-pointer"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-muted p-2 text-foreground/80">
            <ChannelIcon channel={c.channel} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-medium text-foreground truncate">
                {c.leadName ?? `Lead #${c.leadId}`}
              </p>
              <span className="text-caption tabular-nums text-muted-foreground shrink-0">
                {c.lastMessageAt ? relative(c.lastMessageAt) : "—"}
              </span>
            </div>
            {c.lastMessagePreview ? (
              <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                {c.lastMessagePreview}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground italic">
                {c.channel} conversation · tap to view
              </p>
            )}
          </div>
        </div>
      </Card>
    </SwipeableCard>
  );
}

export function InboxTab() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
  // Respect prefers-reduced-motion for the swipe-card exit collapse.
  // DURATIONS.fast (0.15s) — exits run fast per SYSTEM-V1 §2.2 exit rule.
  const cardExitTransition = useRespectfulTransition({ duration: DURATIONS.fast });

  const {
    data: conversations = [],
    isLoading,
    error,
    refetch,
  } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
    queryFn: () => fetchJsonArray<Conversation>("/api/conversations"),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  // Optimistic action — patches local state immediately, posts to server.
  // On error, restore the card. Conversation goes to status="closed" for
  // "contacted"; "dismiss" snoozes via localStorage (24h) since the server
  // has no first-class "snoozed" status today.
  const actionMutation = useMutation({
    mutationFn: async (vars: { id: number; action: "contacted" | "dismissed" }) => {
      if (vars.action === "contacted") {
        await apiRequest("PATCH", `/api/conversations/${vars.id}`, { status: "closed" });
      } else {
        // No "snoozed" server status — defer locally for 24h.
        const key = `acreos-inbox-snooze-${vars.id}`;
        try {
          localStorage.setItem(key, String(Date.now() + 24 * 60 * 60 * 1000));
        } catch {
          /* private mode — ignore */
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/conversations"] }),
  });

  const onAction = (id: number, action: "contacted" | "dismissed") => {
    setDismissedIds((prev) => new Set(prev).add(id));
    actionMutation.mutate(
      { id, action },
      {
        onError: (err: unknown) => {
          // Restore — swipe didn't commit. Surface the failure so the
          // user knows the action didn't stick (silent rollback is
          // worse than a destructive toast for trust).
          setDismissedIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          toast({
            title: action === "contacted" ? "Couldn't mark contacted" : "Couldn't snooze",
            description: (err as Error)?.message ?? "Try again — the card is restored.",
            variant: "destructive",
          });
        },
      },
    );
  };

  // Filter: active conversations not locally dismissed, and not snoozed.
  const visible = (conversations ?? []).filter((c) => {
    if (c.status !== "active") return false;
    if (dismissedIds.has(c.id)) return false;
    try {
      const snoozedUntil = Number(localStorage.getItem(`acreos-inbox-snooze-${c.id}`) || 0);
      if (snoozedUntil && Date.now() < snoozedUntil) return false;
    } catch {
      /* ignore */
    }
    return true;
  });

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <QueryErrorState
        error={error as Error}
        onRetry={() => refetch()}
        title="Couldn't load inbox"
        description="Network or session issue. Try again to pull replies."
        testId="inbox-tab-error"
      />
    );
  }

  if (visible.length === 0) {
    // DATA-EMPTY (triage inbox): all active conversations have been swiped away
    // or there are none. ClearedEmpty is the right archetype — affirming, with an
    // escape-hatch CTA to campaigns ("View outreach") so the user can act.
    return (
      <ClearedEmpty
        headline="Inbox zero"
        subtitle="No inbound responses to triage. New replies to your outreach show up here automatically."
        onShowArchive={() => setLocation("/campaigns")}
        archiveLabel="View outreach"
        archiveCount={0}
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-caption uppercase tracking-wide text-muted-foreground px-1">
        Swipe right · Contacted &nbsp;·&nbsp; Swipe left · Snooze
      </p>
      <AnimatePresence initial={false}>
        {visible.map((c) => (
          <motion.div
            key={c.id}
            layout
            initial={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={cardExitTransition}
          >
            <InboxCard
              conversation={c}
              onAction={(action) => onAction(c.id, action)}
              onOpen={() => setLocation(`/leads/${c.leadId}`)}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export default InboxTab;
