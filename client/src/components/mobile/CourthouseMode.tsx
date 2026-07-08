/**
 * CourthouseMode — Tax-Delinquent persona leapfrog.
 *
 * Per the 12-agent audit (2026-05-26), Tax-Delinquent is the persona
 * with the weakest competitive field and clearest missing journey:
 *   "Make the Tax-Delinquent buyer the mobile-first power user:
 *    live redemption countdown alerts + courthouse-mode auction
 *    worksheet (one column, big buttons) + 3-click quiet-title case
 *    dashboard, all synced offline so courthouse runs require zero
 *    connectivity."
 *
 * This component is the courthouse-mode auction surface — designed for
 * one-handed use while you're standing in front of an auctioneer with
 * spotty 2G. Single-listing card at a time, four giant action buttons,
 * tap to next, no scrolling required. Replaces the `dayOfMode` table
 * row in `auction-worksheet.tsx` when on mobile.
 *
 * Offline strategy (v1): action mutations are fire-and-forget into
 * react-query's mutation queue; offline writes get retried by the SW
 * background-sync layer when connectivity returns. Bid log mutation
 * already exists at /api/auction-listings/:id/log-bid.
 *
 * Future: prefetch comp data for each listing on entry so the comp
 * lookup is offline-available. Out of scope for v1 scaffold.
 */

import { useState, useMemo, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  HandIcon,
  SkipForward,
  WifiOff,
  Wifi,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface CourthouseListing {
  id: number;
  apn: string;
  address?: string | null;
  county: string;
  state: string;
  minimumBid?: string | number | null;
  assessedValue?: string | number | null;
  maxBidCents?: number | null;
  walkAwayAboveCents?: number | null;
  status: "available" | "watching" | "won" | "lost" | "passed" | string;
}

interface CourthouseModeProps {
  listings: CourthouseListing[];
  /** Called after a status-changing action so the parent can refetch / advance. */
  onAdvance?: () => void;
}

type BidAction = "won" | "outbid" | "pass" | "skip";

function fmtUsd(v: number | string | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtCentsUsd(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

export function CourthouseMode({ listings, onAdvance }: CourthouseModeProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [index, setIndex] = useState(0);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  // Track online state so the user knows when actions are queued vs sent.
  // Lens 6 (Marcus, 2026-05-27): this was `useMemo`, which doesn't run
  // for side effects and never attached the listeners — so the offline
  // banner was frozen at the value `navigator.onLine` happened to have
  // at mount time. The whole point of CourthouseMode is to be useful
  // when the cell signal drops mid-auction; without a real listener,
  // we couldn't tell the user their bid log was queued vs. sent.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const actionable = useMemo(
    () => listings.filter((l) => l.status !== "won" && l.status !== "lost"),
    [listings],
  );

  const current = actionable[index];

  const mutation = useMutation({
    mutationFn: async (vars: { listingId: number; action: BidAction }) => {
      // Map UI actions to server-side terms. The auction-worksheet's
      // existing bid log accepts these as the status update.
      const statusByAction: Record<BidAction, string> = {
        won: "won",
        outbid: "lost",
        pass: "passed",
        skip: "watching",
      };
      const status = statusByAction[vars.action];
      await apiRequest("POST", `/api/auction-listings/${vars.listingId}/log-bid`, {
        action: vars.action,
        status,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/auction-listings"] });
      onAdvance?.();
    },
    onError: (err: any) => {
      // Don't block at-courthouse use on a network error — toast and
      // advance anyway. The mutation persists in react-query's cache
      // for the offline retry path.
      toast({
        title: "Action queued",
        description:
          (err?.message ?? "Network issue") +
          " — we'll sync this bid when you're back online.",
      });
    },
  });

  const commit = (action: BidAction) => {
    if (!current) return;
    mutation.mutate({ listingId: current.id, action });
    // Optimistically advance — the user is moving fast.
    setIndex((i) => Math.min(actionable.length, i + 1));
  };

  if (actionable.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-20 px-6">
        <div className="rounded-full bg-acr-pos-soft text-acr-pos p-4 mb-4">
          <Check className="h-8 w-8" />
        </div>
        <h2 className="text-base font-semibold mb-1">Auction complete</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          You've logged every listing on the worksheet.
        </p>
      </div>
    );
  }

  if (index >= actionable.length) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-20 px-6">
        <div className="rounded-full bg-acr-pos-soft text-acr-pos p-4 mb-4">
          <Check className="h-8 w-8" />
        </div>
        <h2 className="text-base font-semibold mb-1">Worksheet cleared</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          All {actionable.length} listings logged. {!online && "Pending bids will sync when online."}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-6"
          onClick={() => setIndex(0)}
        >
          Review again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Status header — connection state + progress */}
      <div className="flex items-center justify-between text-caption uppercase tracking-wide">
        <span
          className={cn(
            "flex items-center gap-1.5",
            online ? "text-acr-pos" : "text-acr-warn",
          )}
        >
          {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {online ? "Online" : "Offline — bids will sync"}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {index + 1} / {actionable.length}
        </span>
      </div>

      {/* Single-listing card with prev/next */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={current.id}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.18 }}
        >
          <Card className="p-5 space-y-4">
            <div>
              <div className="font-mono text-2xl font-semibold leading-tight">
                {current.apn}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {current.county}, {current.state}
              </div>
              {current.address && (
                <div className="text-sm mt-1">{current.address}</div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <Kv label="Min bid" value={fmtUsd(current.minimumBid)} />
              <Kv label="Assessed" value={fmtUsd(current.assessedValue)} />
              <Kv
                label="My max"
                value={fmtCentsUsd(current.maxBidCents)}
                highlight={!!current.maxBidCents}
              />
              <Kv
                label="Walk-away >"
                value={fmtCentsUsd(current.walkAwayAboveCents)}
              />
            </div>
          </Card>
        </motion.div>
      </AnimatePresence>

      {/* Four giant action buttons — thumb-zone optimized */}
      <div className="grid grid-cols-2 gap-3 mt-2">
        <ActionButton
          tone="positive"
          icon={<Check className="h-6 w-6" aria-hidden />}
          label="Won"
          onClick={() => commit("won")}
        />
        <ActionButton
          tone="negative"
          icon={<X className="h-6 w-6" aria-hidden />}
          label="Outbid"
          onClick={() => commit("outbid")}
        />
        <ActionButton
          tone="muted"
          icon={<HandIcon className="h-6 w-6" aria-hidden />}
          label="Pass"
          onClick={() => commit("pass")}
        />
        <ActionButton
          tone="muted"
          icon={<SkipForward className="h-6 w-6" aria-hidden />}
          label="Skip"
          onClick={() => commit("skip")}
        />
      </div>

      {/* Prev / Next nav — small links for reviewing earlier listings */}
      <div className="flex items-center justify-between mt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          aria-label="Previous listing"
        >
          <ChevronLeft className="h-4 w-4" />
          Prev
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIndex((i) => Math.min(actionable.length, i + 1))}
          aria-label="Next listing"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function Kv({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-micro uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "font-mono text-base tabular-nums mt-0.5",
          highlight && "text-primary font-semibold",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ActionButton({
  tone,
  icon,
  label,
  onClick,
}: {
  tone: "positive" | "negative" | "muted";
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`courthouse-action-${label.toLowerCase()}`}
      aria-label={label}
      className={cn(
        "min-h-[88px] rounded-2xl flex flex-col items-center justify-center gap-1.5 font-semibold text-base active:scale-95 transition-transform",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tone === "positive" && "bg-acr-pos-soft text-acr-pos",
        tone === "negative" && "bg-acr-neg-soft text-acr-neg",
        tone === "muted" && "bg-muted text-foreground hover:bg-muted/80",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export default CourthouseMode;
