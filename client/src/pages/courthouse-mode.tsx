/**
 * /courthouse-mode page wrapper.
 *
 * Standalone route for the Tax-Delinquent persona's leapfrog mobile
 * surface. Fetches the current auction worksheet listings and mounts
 * CourthouseMode — the single-card, four-giant-button, offline-tolerant
 * bid-log component designed for one-handed use at a live auction.
 *
 * Accepts ?auctionId=<id> to scope the listing fetch. Without it, shows
 * all available (non-won, non-lost) listings so the user can still
 * reach the surface before locking in a specific auction event.
 *
 * Design note: this surface intentionally skips PageShell and the
 * sidebar — the same pattern as /drivemode. The operator is standing
 * in front of an auctioneer; chrome is noise.
 *
 * Linked from:
 *   - PersonaMapStrip (Tax-Delinquent persona — future strip CTA)
 *   - Auction worksheet "Go to courthouse mode" button (existing, on
 *     mobile with ?auctionId=… query param)
 *   - Any direct deep link / PWA shortcut
 *
 * Rafe B-2 fix — 2026-06-01.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, Gavel } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { CourthouseMode } from "@/components/mobile/CourthouseMode";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";

interface Listing {
  id: number;
  apn: string;
  address?: string | null;
  county: string;
  state: string;
  minimumBid?: string | number | null;
  assessedValue?: string | number | null;
  maxBidCents?: number | null;
  walkAwayAboveCents?: number | null;
  status: string;
}

export default function CourthouseModePage() {
  useDocumentTitle("Courthouse Mode — AcreOS");

  const [location, setLocation] = useLocation();
  const url = new URL(window.location.origin + location);
  const auctionId = url.searchParams.get("auctionId");

  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ listings: Listing[] }>({
    queryKey: ["/api/tax-researcher/auction-worksheet", auctionId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (auctionId) params.set("auctionId", auctionId);
      const res = await fetch(`/api/tax-researcher/auction-worksheet?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
      return res.json();
    },
  });

  const listings = data?.listings ?? [];

  return (
    <div
      className="min-h-[100dvh] bg-background text-foreground flex flex-col"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
      data-testid="courthouse-mode-page"
    >
      {/* Slim header — back button + title. Same pattern as DriveMode. */}
      <header className="flex items-center gap-2 px-4 h-12 border-b border-border bg-surface-chrome backdrop-blur-md">
        <button
          type="button"
          onClick={() => setLocation("/auction-worksheet")}
          aria-label="Exit Courthouse Mode"
          className="h-10 w-10 -ml-2 flex items-center justify-center rounded-full text-muted-foreground active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="courthouse-mode-back"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </button>
        <Gavel className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h1 className="font-semibold tracking-tight">Courthouse Mode</h1>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4">
        {isLoading ? (
          <div className="space-y-3" aria-label="Loading listings">
            <Skeleton className="h-40 w-full rounded-2xl" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
            </div>
          </div>
        ) : listings.length === 0 ? (
          <EmptyState
            icon={Gavel}
            headline="No listings on this worksheet"
            subtitle="Add listings to your auction worksheet first, then return here on auction day."
            cta={{
              label: "Go to Auction Worksheet",
              onClick: () => setLocation("/auction-worksheet"),
              "data-testid": "courthouse-go-to-worksheet",
            }}
            actionIcon={null}
            className="py-16"
          />
        ) : (
          <CourthouseMode
            listings={listings}
            onAdvance={() => {
              qc.invalidateQueries({ queryKey: ["/api/tax-researcher/auction-worksheet"] });
            }}
          />
        )}
      </main>
    </div>
  );
}
