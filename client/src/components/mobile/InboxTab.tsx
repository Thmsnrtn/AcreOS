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
import { motion, useMotionValue, useTransform, type PanInfo, AnimatePresence } from "framer-motion";
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
import { apiRequest, fetchJsonArray } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
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

const SWIPE_THRESHOLD = 120; // px — distance past which we commit the action
const SWIPE_VELOCITY_THRESHOLD = 500; // px/s — fast flick also commits

interface InboxCardProps {
  conversation: Conversation;
  onAction: (action: "contacted" | "dismissed") => void;
  onOpen: () => void;
}

function InboxCard({ conversation: c, onAction, onOpen }: InboxCardProps) {
  const x = useMotionValue(0);
  const opacity = useTransform(x, [-200, 0, 200], [0.3, 1, 0.3]);
  // Background reveal — green from the left (contacted), red from the right (dismiss).
  const bgRightOpacity = useTransform(x, [0, 80, 200], [0, 0.6, 1]); // swipe right → contacted background
  const bgLeftOpacity = useTransform(x, [-200, -80, 0], [1, 0.6, 0]);  // swipe left → dismiss background

  const handleDragEnd = (_e: unknown, info: PanInfo) => {
    const passed =
      Math.abs(info.offset.x) > SWIPE_THRESHOLD ||
      Math.abs(info.velocity.x) > SWIPE_VELOCITY_THRESHOLD;
    if (passed) {
      onAction(info.offset.x > 0 ? "contacted" : "dismissed");
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Action backgrounds — only visible during a swipe. */}
      <motion.div
        aria-hidden
        className="absolute inset-0 flex items-center justify-start pl-6 rounded-2xl bg-emerald-500/90 text-white"
        style={{ opacity: bgRightOpacity }}
      >
        <Check className="h-6 w-6" />
        <span className="ml-2 text-sm font-medium">Contacted</span>
      </motion.div>
      <motion.div
        aria-hidden
        className="absolute inset-0 flex items-center justify-end pr-6 rounded-2xl bg-rose-500/90 text-white"
        style={{ opacity: bgLeftOpacity }}
      >
        <span className="mr-2 text-sm font-medium">Snooze 24h</span>
        <X className="h-6 w-6" />
      </motion.div>

      {/* The card itself — drag horizontally. */}
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.5}
        onDragEnd={handleDragEnd}
        style={{ x, opacity }}
        whileTap={{ scale: 0.98 }}
        className="relative"
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
                <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
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
      </motion.div>
    </div>
  );
}

export function InboxTab() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());

  const { data: conversations = [], isLoading } = useQuery<Conversation[]>({
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
        onError: () => {
          // Restore — swipe didn't commit.
          setDismissedIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
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

  if (visible.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16 px-6">
        <div className="rounded-full bg-muted p-4 mb-4">
          <InboxIcon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        </div>
        <h2 className="text-base font-semibold mb-1">Inbox zero</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          No inbound responses to triage. New replies to your outreach show
          up here automatically.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-6"
          onClick={() => setLocation("/campaigns")}
        >
          View outreach
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground px-1">
        Swipe right · Contacted &nbsp;·&nbsp; Swipe left · Snooze
      </p>
      <AnimatePresence initial={false}>
        {visible.map((c) => (
          <motion.div
            key={c.id}
            layout
            initial={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.18 }}
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
