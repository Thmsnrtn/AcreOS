/**
 * /auction-worksheet — pre-auction worksheet + day-of mobile bid log.
 *
 * Marcus: "Before every sale I build a list with three numbers per parcel —
 * minimum opening bid, my walk-away max, and the assessed value. I do this
 * in Excel because nothing exists for it. […] I write it on a clipboard.
 * I would pay $20/mo just for that screen, on its own, if it synced back
 * to AcreOS."
 *
 * Single page, two phases:
 *   - Pre-auction (no ?auctionId): edit max-bid + walk-away + partner-split
 *     inline per row.
 *   - Day-of (with ?auctionId): each row exposes one-tap action buttons
 *     (Pass / Bid / Won / Outbid) that POST to the bid-log endpoint.
 *
 * Mobile-friendly: the table degrades to stacked cards on narrow screens.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Gavel,
  Save,
  Check,
  X,
  Trophy,
  ArrowDown,
  Target,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useIsMobile } from "@/hooks/use-mobile";
import { CourthouseMode } from "@/components/mobile/CourthouseMode";

interface Listing {
  id: number;
  apn: string;
  county: string;
  state: string;
  address: string | null;
  minimumBid: string | null;
  assessedValue: string | null;
  marketValue: string | null;
  acreage: string | null;
  status: string;
  // Worksheet fields (TD-4)
  maxBidCents: number | null;
  walkAwayAboveCents: number | null;
  walkAwayCondition: string | null;
  partnerSplit: Array<{ investorName: string; splitBps: number }> | null;
  notes: string | null;
}

interface BidLogEntry {
  id: string;
  listingId: number;
  action: "passed" | "bid" | "won" | "outbid" | "no_show";
  amountCents: number | null;
  performedAt: string;
  notes: string | null;
}

function fmtUsd(input: string | number | null | undefined): string {
  if (input === null || input === undefined || input === "") return "—";
  const n = typeof input === "string" ? parseFloat(input) : input;
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtCentsUsd(cents: number | null): string {
  if (cents === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function dollarsToCents(s: string): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/[$,\s]/g, ""));
  if (!isFinite(n)) return null;
  return Math.round(n * 100);
}

export default function AuctionWorksheetPage() {
  useDocumentTitle("Auction worksheet — AcreOS");
  const [location] = useLocation();
  const url = new URL(window.location.origin + location);
  const auctionId = url.searchParams.get("auctionId");
  const dayOfMode = !!auctionId;
  // 2026-05-26: mobile courthouse-mode leapfrog. When the user is on
  // mobile AND in day-of mode (?auctionId=…), swap the row-based table
  // for the single-card CourthouseMode component — single-handed,
  // big-button, offline-tolerant. See components/mobile/CourthouseMode.tsx.
  const { isMobile } = useIsMobile();
  const courthouseMode = isMobile && dayOfMode;

  const { data, isLoading } = useQuery<{ listings: Listing[] }>({
    queryKey: ["/api/tax-researcher/auction-worksheet", auctionId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (auctionId) params.set("auctionId", auctionId);
      const res = await fetch(`/api/tax-researcher/auction-worksheet?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const listings = data?.listings ?? [];

  return (
    <PageShell label="Auction worksheet">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Gavel className="w-6 h-6 text-primary" aria-hidden="true" />
            Auction worksheet
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            {dayOfMode
              ? "Day-of bid log. Tap an action per parcel as you go through the auction."
              : "Pre-auction worksheet. Set max bid, walk-away condition, and partner-split rules per parcel before sale day. Pass an ?auctionId=… for the mobile bid log."}
          </p>
        </div>
      </div>

      {isLoading ? (
        <Card><div className="p-5 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div></Card>
      ) : listings.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title="No listings on the worksheet"
          description="Add tax-sale listings to your watchlist via /tax-researcher, then return here to set max bids and walk-away rules before the sale."
        />
      ) : courthouseMode ? (
        <CourthouseMode
          listings={listings.map((l) => ({
            id: l.id,
            apn: l.apn,
            address: l.address,
            county: l.county,
            state: l.state,
            minimumBid: l.minimumBid,
            assessedValue: l.assessedValue,
            maxBidCents: l.maxBidCents,
            walkAwayAboveCents: l.walkAwayAboveCents,
            status: l.status,
          }))}
        />
      ) : (
        <div className="space-y-3">
          {listings.map((l) => (
            <ListingRow key={l.id} listing={l} dayOfMode={dayOfMode} />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function ListingRow({ listing, dayOfMode }: { listing: Listing; dayOfMode: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const isTerminal = listing.status === "won" || listing.status === "lost";

  return (
    <Card className={`p-4 ${isTerminal ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground hover:text-foreground mt-0.5"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm font-medium truncate">{listing.apn}</span>
                <span className="text-xs text-muted-foreground">{listing.county}, {listing.state}</span>
                {listing.status !== "available" && listing.status !== "watching" && (
                  <span className={`inline-block rounded-md px-2 py-0.5 text-xs ${
                    listing.status === "won" ? "bg-acr-pos/10 text-acr-pos" :
                    listing.status === "lost" ? "bg-muted text-muted-foreground" :
                    "bg-acr-warning/10 text-acr-warning"
                  }`}>{listing.status}</span>
                )}
              </div>
              {listing.address && (
                <div className="text-xs text-muted-foreground truncate mt-0.5">{listing.address}</div>
              )}
            </div>

            {dayOfMode && !isTerminal && (
              <BidActionsRow listingId={listing.id} maxBidCents={listing.maxBidCents} />
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
            <KV label="Min bid" value={fmtUsd(listing.minimumBid)} />
            <KV label="Assessed" value={fmtUsd(listing.assessedValue)} />
            <KV label="Max bid" value={fmtCentsUsd(listing.maxBidCents)} highlight={!!listing.maxBidCents} />
            <KV label="Walk away >" value={fmtCentsUsd(listing.walkAwayAboveCents)} />
          </div>

          {expanded && (
            <>
              <Separator className="my-3" />
              {!editing ? (
                <div className="space-y-2 text-xs">
                  {listing.walkAwayCondition && (
                    <div>
                      <span className="text-muted-foreground">Walk-away condition: </span>
                      <span className="italic">{listing.walkAwayCondition}</span>
                    </div>
                  )}
                  {listing.partnerSplit && listing.partnerSplit.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">Partner split: </span>
                      <span>{listing.partnerSplit.map((p) => `${p.investorName} ${p.splitBps / 100}%`).join(" / ")}</span>
                    </div>
                  )}
                  {listing.notes && (
                    <div className="text-muted-foreground italic whitespace-pre-wrap">{listing.notes}</div>
                  )}
                  <div className="flex justify-end pt-1">
                    <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="h-7 text-xs">
                      Edit worksheet
                    </Button>
                  </div>
                </div>
              ) : (
                <WorksheetEditor listing={listing} onClose={() => setEditing(false)} />
              )}

              <Separator className="my-3" />
              <BidLogPanel listingId={listing.id} />
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function KV({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-mono ${highlight ? "font-semibold text-primary" : ""}`}>{value}</div>
    </div>
  );
}

function WorksheetEditor({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  const { toast } = useToast();
  const [maxBid, setMaxBid] = useState(listing.maxBidCents ? String(listing.maxBidCents / 100) : "");
  const [walkAway, setWalkAway] = useState(listing.walkAwayAboveCents ? String(listing.walkAwayAboveCents / 100) : "");
  const [walkCondition, setWalkCondition] = useState(listing.walkAwayCondition ?? "");
  const [partners, setPartners] = useState<Array<{ investorName: string; splitBps: number }>>(listing.partnerSplit ?? []);
  const [notes, setNotes] = useState(listing.notes ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/tax-researcher/listings/${listing.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrfToken),
        },
        body: JSON.stringify({
          maxBidCents: dollarsToCents(maxBid),
          walkAwayAboveCents: dollarsToCents(walkAway),
          walkAwayCondition: walkCondition.trim() || null,
          partnerSplit: partners.length > 0 ? partners : null,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(typeof err.error === "string" ? err.error : "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/auction-worksheet"] });
      onClose();
    },
    onError: (err: any) => toast({ title: "Couldn't save", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`mb-${listing.id}`} className="text-xs">Max bid $</Label>
          <Input id={`mb-${listing.id}`} inputMode="decimal" placeholder="5000" value={maxBid} onChange={(e) => setMaxBid(e.target.value)} className="h-8" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`wa-${listing.id}`} className="text-xs">Walk away above $</Label>
          <Input id={`wa-${listing.id}`} inputMode="decimal" placeholder="6500" value={walkAway} onChange={(e) => setWalkAway(e.target.value)} className="h-8" />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`wc-${listing.id}`} className="text-xs">Walk-away condition (free text)</Label>
        <Input id={`wc-${listing.id}`} placeholder='e.g. "skip if anyone else over $5K"' value={walkCondition} onChange={(e) => setWalkCondition(e.target.value)} className="h-8" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Partner split</Label>
        <PartnerSplitEditor partners={partners} onChange={setPartners} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`n-${listing.id}`} className="text-xs">Notes</Label>
        <Textarea id={`n-${listing.id}`} value={notes} onChange={(e) => setNotes(e.target.value)} className="text-xs min-h-[60px]" />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function PartnerSplitEditor({
  partners,
  onChange,
}: {
  partners: Array<{ investorName: string; splitBps: number }>;
  onChange: (p: Array<{ investorName: string; splitBps: number }>) => void;
}) {
  const totalBps = partners.reduce((s, p) => s + p.splitBps, 0);
  const addRow = () => onChange([...partners, { investorName: "", splitBps: 0 }]);
  const updateRow = (i: number, patch: Partial<{ investorName: string; splitBps: number }>) => {
    const next = partners.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const removeRow = (i: number) => onChange(partners.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-1.5">
      {partners.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            placeholder="Investor name"
            value={p.investorName}
            onChange={(e) => updateRow(i, { investorName: e.target.value })}
            className="h-8 flex-1"
          />
          <Input
            placeholder="50.00"
            inputMode="decimal"
            value={p.splitBps ? String(p.splitBps / 100) : ""}
            onChange={(e) => updateRow(i, { splitBps: Math.round(parseFloat(e.target.value || "0") * 100) })}
            className="h-8 w-24"
          />
          <span className="text-xs text-muted-foreground">%</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeRow(i)} aria-label="Remove">
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={addRow} className="h-7 text-xs">+ Add partner</Button>
        {partners.length > 0 && (
          <span className={`text-xs ${totalBps === 10_000 ? "text-acr-pos" : "text-acr-warning"}`}>
            Total: {(totalBps / 100).toFixed(2)}%
          </span>
        )}
      </div>
    </div>
  );
}

function BidActionsRow({ listingId, maxBidCents }: { listingId: number; maxBidCents: number | null }) {
  const { toast } = useToast();

  const log = useMutation({
    mutationFn: async (input: { action: "passed" | "bid" | "won" | "outbid"; amountCents?: number }) => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/tax-researcher/listings/${listingId}/bid-log`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrfToken),
        },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(typeof err.error === "string" ? err.error : "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/auction-worksheet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/listings", listingId, "bid-log"] });
    },
    onError: (err: any) => toast({ title: "Log failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="flex items-center gap-1 shrink-0">
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => log.mutate({ action: "passed" })}>
        Pass
      </Button>
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => log.mutate({ action: "bid", amountCents: maxBidCents ?? undefined })}>
        <Target className="w-3 h-3 mr-1" aria-hidden="true" /> Bid
      </Button>
      <Button variant="outline" size="sm" className="h-7 text-xs text-acr-pos" onClick={() => log.mutate({ action: "won", amountCents: maxBidCents ?? undefined })}>
        <Trophy className="w-3 h-3 mr-1" aria-hidden="true" /> Won
      </Button>
      <Button variant="outline" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => log.mutate({ action: "outbid" })}>
        <ArrowDown className="w-3 h-3 mr-1" aria-hidden="true" /> Outbid
      </Button>
    </div>
  );
}

function BidLogPanel({ listingId }: { listingId: number }) {
  const { data } = useQuery<{ entries: BidLogEntry[] }>({
    queryKey: ["/api/tax-researcher/listings", listingId, "bid-log"],
    queryFn: async () => {
      const res = await fetch(`/api/tax-researcher/listings/${listingId}/bid-log`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });
  const entries = data?.entries ?? [];
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground italic">No bid actions logged yet.</p>;
  }
  return (
    <ul className="space-y-1 text-xs">
      {entries.map((e) => (
        <li key={e.id} className="flex items-center justify-between">
          <span className="capitalize">{e.action.replace("_", " ")}</span>
          <span className="text-muted-foreground">
            {e.amountCents ? `${fmtCentsUsd(e.amountCents)} · ` : ""}
            {new Date(e.performedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </span>
        </li>
      ))}
    </ul>
  );
}
