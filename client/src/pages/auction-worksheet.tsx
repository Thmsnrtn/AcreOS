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
 *
 * ── Wave D client surface (2026-07-30) ──────────────────────────────────
 * The three chains this page now exposes, all against endpoints that already
 * existed server-side with no way in:
 *
 *   1. SALE + SESSION BUDGET. `tax_sale_auctions` had no insert path from any
 *      UI, so day-of mode (`?auctionId=`) was unreachable and the budget
 *      column was never set. The sale bar creates a sale, sets the capital
 *      allocated to it, and shows remaining capital live while bidding.
 *   2. CSV LOT-LIST IMPORT. Column mapping is confirmed by the operator (a
 *      guess presented as a fact is the same defect as a fabricated number),
 *      every row is previewed before anything is written, and rejected rows
 *      are shown in full with the offending value quoted back. No row is ever
 *      silently dropped — the server's `assertNoRowLost` invariant is
 *      mirrored on screen as "rows in file = imported + rejected".
 *   3. WON → CERTIFICATE. A win records the bid and creates the certificate
 *      from the lot, with zero re-typing. When the state's redemption rule is
 *      not encoded the server REFUSES to invent a deadline; the dialog then
 *      asks the operator for it and records the date as operator-supplied.
 *      Every deadline shown carries its basis sentence and the
 *      not-attorney-reviewed caveat.
 *
 * MONEY POSTURE (founder ruling #15 — be the rail, not the provider): the
 * session budget and deposit figures are a notebook. AcreOS never holds,
 * routes or moves auction deposits or purchase money; those move between the
 * operator and the county on the operator's own rails.
 */

import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch, Link } from "wouter";
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
  Upload,
  Wallet,
  ShieldAlert,
  FileWarning,
  ScrollText,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useIsMobile } from "@/hooks/use-mobile";
import { CourthouseMode } from "@/components/mobile/CourthouseMode";
import { Verbs } from "@/lib/labels";
import { staggerContainer, staggerItem } from "@/lib/animations";

type AcquisitionSource = "auction" | "otc" | "pre_sale_list" | "private";

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
  acquisitionSource: AcquisitionSource | null;
  notes: string | null;
}

// Marcus / Lens 17 ordering: highest-margin first. The filter chips render
// in this order so OTC + private inventory leads the eye.
const ACQUISITION_SOURCE_OPTIONS: Array<{ value: AcquisitionSource | "all"; label: string }> = [
  { value: "all", label: "All sources" },
  { value: "private", label: "Private" },
  { value: "otc", label: "OTC" },
  { value: "pre_sale_list", label: "Pre-sale list" },
  { value: "auction", label: "Auction" },
];

const SOURCE_LABEL: Record<AcquisitionSource, string> = {
  auction: "Auction",
  otc: "OTC",
  pre_sale_list: "Pre-sale list",
  private: "Private",
};

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

/**
 * Integer-cents → "$1,234.56" with no float rounding: the dollars and the
 * cents are formatted separately from the integer, so a figure an operator
 * reads back to a county clerk is exact to the cent.
 */
function centsExact(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}

function csrfHeaders(): Record<string, string> {
  const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
  return {
    "Content-Type": "application/json",
    "x-csrf-token": decodeURIComponent(csrfToken),
  };
}

/** POST JSON and surface the server's own message on failure. */
async function apiPost<T>(url: string, body: unknown, method: "POST" | "PATCH" = "POST"): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: csrfHeaders(),
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (parsed && typeof parsed.message === "string" && parsed.message) ||
      (parsed && typeof parsed.error === "string" && parsed.error) ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return parsed as T;
}

// ── Sale (auction) + session budget ─────────────────────────────────────────

interface Auction {
  id: number;
  county: string;
  state: string;
  auctionType: "lien" | "deed" | "redeemable_deed";
  auctionDate: string;
  auctionFormat: string;
  status: string;
  venueName: string | null;
  depositRequiredCents: number | null;
  sessionBudgetCents: number | null;
  lotCount: number;
  ruleCoverage: "computational" | "reference_only" | "not_encoded";
  redemptionMathEncoded: boolean;
  attorneyReviewed: boolean;
  citation: string | null;
  caveat: string;
}

interface SessionBudget {
  auctionId: number;
  budgetCents: number | null;
  committedCents: number;
  winsWithUnknownAmount: number;
  wonCount: number;
  remainingCents: number | null;
  overBudget: boolean;
  remainingIsUpperBound: boolean;
  /** Verbatim from the API — AcreOS custodies nothing. */
  moneyCustody: string;
}

// ── CSV lot-list import ─────────────────────────────────────────────────────

interface LotField {
  key: string;
  label: string;
  required: boolean;
  kind: string;
  help?: string;
}

interface RowRejection {
  /** 1-based row number in the FILE (header is row 1). */
  fileRow: number;
  raw: string[];
  errors: Array<{ field: string; column: string | null; value: string; message: string }>;
}

interface ImportSummary {
  totalRows: number;
  validCount: number;
  rejectedCount: number;
  jurisdictions: Array<{ state: string; county: string; count: number }>;
  totalTaxOwedCents: number;
  minimumBidTotalCents: number;
}

interface ImportPreview {
  committed: false;
  headers: string[];
  fields: LotField[];
  mapping: Record<string, number | null>;
  suggestedMapping: Record<string, number | null>;
  ignoredColumns: Array<{ index: number; header: string }>;
  unmappedRequired: string[];
  summary: ImportSummary;
  sampleValid: Array<Record<string, unknown>>;
  rejected: RowRejection[];
  rejectedTruncated: boolean;
  caveat: string;
}

interface ImportCommit {
  committed: true;
  summary: ImportSummary & { insertedCount: number };
  insertedIds: number[];
  rejected: RowRejection[];
  rejectedTruncated: boolean;
  caveat: string;
}

// ── Won → certificate handoff ───────────────────────────────────────────────

type CertHandoff =
  | {
      status: "created";
      certificateId: string;
      redemptionDeadline: string;
      deadlineSource: "derived_preliminary" | "operator_supplied";
      deadlineBasis: string;
      citation: string | null;
      attorneyReviewed: false;
      caveat: string;
    }
  | { status: "existing"; certificateId: string; redemptionDeadline: string }
  | {
      status: "blocked";
      code: string;
      message: string;
      state: string;
      ruleCoverage: string;
      needsRedemptionDeadline: boolean;
    };

export default function AuctionWorksheetPage() {
  useDocumentTitle("Auction worksheet — AcreOS");
  const [, navigate] = useLocation();
  // wouter v3's useLocation() returns the PATHNAME only — the query string
  // lives behind useSearch(). Reading `?auctionId=` off useLocation() (as this
  // page did) always yielded null, so day-of mode and the session budget were
  // unreachable no matter what URL the operator opened.
  const search = useSearch();
  const auctionId = new URLSearchParams(search).get("auctionId");
  const dayOfMode = !!auctionId;
  // 2026-05-26: mobile courthouse-mode leapfrog. When the user is on
  // mobile AND in day-of mode (?auctionId=…), swap the row-based table
  // for the single-card CourthouseMode component — single-handed,
  // big-button, offline-tolerant. See components/mobile/CourthouseMode.tsx.
  const { isMobile } = useIsMobile();
  const courthouseMode = isMobile && dayOfMode;

  // Marcus / Lens 17 — acquisition-source filter. Defaults to "all" because
  // most users have only auction inventory; the filter shows up when OTC /
  // private rows exist.
  const [sourceFilter, setSourceFilter] = useState<AcquisitionSource | "all">("all");

  const { data, isLoading } = useQuery<{ listings: Listing[] }>({
    queryKey: ["/api/tax-researcher/auction-worksheet", auctionId, sourceFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (auctionId) params.set("auctionId", auctionId);
      if (sourceFilter !== "all") params.set("acquisitionSource", sourceFilter);
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
              ? "Day-of bid log. Tap an action per parcel as you go through the auction. A win records the bid and creates the certificate from the lot — no re-typing."
              : "Pre-auction worksheet. Import the county lot list, then set max bid, walk-away condition, and partner-split rules per parcel before sale day."}
          </p>
        </div>
      </div>

      {/* Which sale, how much capital is left. Always visible — the operator
          mid-auction needs the remaining figure more than anything else. */}
      <SaleBar
        selectedAuctionId={auctionId ? Number(auctionId) : null}
        onSelectAuction={(id) =>
          navigate(id === null ? "/auction-worksheet" : `/auction-worksheet?auctionId=${id}`)
        }
        compact={courthouseMode}
      />

      {/* CSV lot-list import. Above the empty state on purpose: with no lots
          on the worksheet, importing the county list IS the next action. */}
      {!courthouseMode && (
        <LotListImportCard defaultAuctionId={auctionId ? Number(auctionId) : null} />
      )}

      {/* Source filter chips — high-margin sources lead. Hidden in
          courthouse mode (the operator is mid-auction; no time to retoggle). */}
      {!courthouseMode && (
        <div
          role="group"
          aria-label="Filter by acquisition source"
          className="flex flex-wrap gap-2 mb-4"
        >
          {ACQUISITION_SOURCE_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              variant={sourceFilter === opt.value ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs"
              aria-pressed={sourceFilter === opt.value}
              onClick={() => setSourceFilter(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      )}

      {isLoading ? (
        <Card><div className="p-5 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div></Card>
      ) : listings.length === 0 ? (
        <EmptyState
          icon={Gavel}
          headline="No listings on the worksheet"
          subtitle="Tax-sale listings flow in from your target counties. Open a county to review its auction schedule and delinquent inventory, then come back to set max bids and walk-away rules before sale day."
          cta={{
            label: "Open your counties",
            href: "/counties",
            "data-testid": "auction-worksheet-empty-counties",
          }}
          secondaryCta={{
            label: "Review state rules",
            href: "/state-rules",
            "data-testid": "auction-worksheet-empty-state-rules",
          }}
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
            <ListingRow
              key={l.id}
              listing={l}
              dayOfMode={dayOfMode}
              auctionId={auctionId ? Number(auctionId) : null}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function ListingRow({
  listing,
  dayOfMode,
  auctionId,
}: {
  listing: Listing;
  dayOfMode: boolean;
  auctionId: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  // The Won dialog lives on the ROW, not on the action buttons: recording a win
  // flips the listing to `won`, which hides the action buttons. Mounting the
  // dialog under them meant the certificate confirmation — and the "AcreOS
  // won't invent the deadline, give me the date" prompt — vanished the instant
  // the win was recorded, which is precisely when the operator needs it.
  const [wonOpen, setWonOpen] = useState(false);
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
                {listing.acquisitionSource && listing.acquisitionSource !== "auction" && (
                  <span
                    className={`inline-block rounded-md px-2 py-0.5 text-xs ${
                      listing.acquisitionSource === "private"
                        ? "bg-acr-pos/10 text-acr-pos"
                        : listing.acquisitionSource === "otc"
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                    }`}
                    title="Acquisition source"
                  >
                    {SOURCE_LABEL[listing.acquisitionSource]}
                  </span>
                )}
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
              <BidActionsRow listing={listing} onWon={() => setWonOpen(true)} />
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
      <WonBidDialog
        listing={listing}
        auctionId={auctionId}
        open={wonOpen}
        onOpenChange={setWonOpen}
      />
    </Card>
  );
}

function KV({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-micro uppercase tracking-wide text-muted-foreground">{label}</div>
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
        <Button variant="ghost" size="sm" onClick={onClose}>{Verbs.CANCEL}</Button>
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

function BidActionsRow({ listing, onWon }: { listing: Listing; onWon: () => void }) {
  const { toast } = useToast();
  const listingId = listing.id;

  const log = useMutation({
    mutationFn: async (input: { action: "passed" | "bid" | "outbid"; amountCents?: number }) =>
      apiPost<{ entry: BidLogEntry }>(`/api/tax-researcher/listings/${listingId}/bid-log`, input),
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
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => log.mutate({ action: "bid", amountCents: listing.maxBidCents ?? undefined })}>
        <Target className="w-3 h-3 mr-1" aria-hidden="true" /> Bid
      </Button>
      {/* Won opens the handoff dialog: the amount actually paid is a fact only
          the operator has, and it becomes the certificate's purchase amount. */}
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs text-acr-pos"
        onClick={onWon}
        data-testid={`button-won-${listingId}`}
      >
        <Trophy className="w-3 h-3 mr-1" aria-hidden="true" /> Won
      </Button>
      <Button variant="outline" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => log.mutate({ action: "outbid" })}>
        <ArrowDown className="w-3 h-3 mr-1" aria-hidden="true" /> Outbid
      </Button>
    </div>
  );
}

/**
 * Won → certificate. One tap records the win AND creates the certificate from
 * the lot's own fields; the operator types one number (what they paid).
 *
 * The bid log is written first and independently, so a refusal on the
 * certificate NEVER loses the record of what happened in the room. When the
 * state's redemption rule is not encoded the server refuses to invent a
 * deadline and this dialog asks for it, then records it as operator-supplied.
 */
function WonBidDialog({
  listing,
  auctionId,
  open,
  onOpenChange,
}: {
  listing: Listing;
  auctionId: number | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState(listing.maxBidCents ? String(listing.maxBidCents / 100) : "");
  const [ownerOccupied, setOwnerOccupied] = useState(false);
  const [deadline, setDeadline] = useState("");
  const [handoff, setHandoff] = useState<CertHandoff | null>(null);

  const budget = useQuery<SessionBudget>({
    queryKey: ["/api/tax-researcher/auctions", auctionId, "session-budget"],
    enabled: open && auctionId !== null,
    queryFn: async () => {
      const res = await fetch(`/api/tax-researcher/auctions/${auctionId}/session-budget`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const amountCents = dollarsToCents(amount);
  const remaining = budget.data?.remainingCents ?? null;
  const overBudget = amountCents !== null && remaining !== null && amountCents > remaining;
  const overMax =
    amountCents !== null && listing.maxBidCents !== null && amountCents > listing.maxBidCents;

  const recordWin = useMutation({
    mutationFn: async () => {
      if (amountCents === null || amountCents <= 0) {
        throw new Error("Enter what you actually paid — the certificate records this figure.");
      }
      return apiPost<{ entry: BidLogEntry; certificate: CertHandoff | null }>(
        `/api/tax-researcher/listings/${listing.id}/bid-log`,
        { action: "won", amountCents },
      );
    },
    onSuccess: (data) => {
      setHandoff(data.certificate ?? null);
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/auction-worksheet"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/tax-researcher/listings", listing.id, "bid-log"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/auctions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-certificates"] });
      if (data.certificate?.status === "created") {
        toast({ title: "Win recorded · certificate created" });
      } else if (data.certificate?.status === "existing") {
        toast({ title: "Win recorded · certificate already existed" });
      } else {
        toast({
          title: "Win recorded",
          description: "The certificate needs one more detail before AcreOS can create it.",
        });
      }
    },
    onError: (err: any) =>
      toast({ title: "Couldn't record the win", description: err.message, variant: "destructive" }),
  });

  const supplyDeadline = useMutation({
    mutationFn: async () => {
      if (amountCents === null || amountCents <= 0) {
        throw new Error("Enter what you actually paid.");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
        throw new Error("Enter the statutory redemption deadline as YYYY-MM-DD.");
      }
      const res = await apiPost<{ certificate: CertHandoff }>(
        `/api/tax-researcher/listings/${listing.id}/won-certificate`,
        {
          wonAmountCents: amountCents,
          redemptionDeadline: deadline,
          ownerOccupiedAtSale: ownerOccupied,
        },
      );
      return res.certificate;
    },
    onSuccess: (cert) => {
      setHandoff(cert);
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/auction-worksheet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-certificates"] });
      toast({ title: "Certificate created with your deadline" });
    },
    onError: (err: any) =>
      toast({ title: "Couldn't create the certificate", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Won — {listing.apn} · {listing.county}, {listing.state}
          </DialogTitle>
          <DialogDescription>
            The certificate is built from this lot: parcel, county, state, sale type, sale date and
            the amount below. Nothing is re-typed.
          </DialogDescription>
        </DialogHeader>

        {handoff === null ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor={`won-amount-${listing.id}`}>Winning bid — what you paid ($)</Label>
              <Input
                id={`won-amount-${listing.id}`}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="5000.00"
                data-testid={`input-won-amount-${listing.id}`}
              />
              {/* Exact to the cent here: these two numbers decide the bid. */}
              <p className="text-xs text-muted-foreground">
                Minimum bid {centsExact(dollarsToCents(listing.minimumBid ?? ""))} · your walk-away
                max {centsExact(listing.maxBidCents)}
              </p>
            </div>

            {overMax && (
              <p className="text-xs text-acr-warning" role="status">
                This is above your pre-auction walk-away max of {centsExact(listing.maxBidCents)}. It
                will be recorded, and the certificate will note it.
              </p>
            )}
            {overBudget && (
              <p className="text-xs text-acr-warning" role="status" data-testid="text-over-budget">
                {centsExact(amountCents)} exceeds the {centsExact(Math.max(0, remaining ?? 0))} left
                in this session's budget
                {budget.data?.remainingIsUpperBound
                  ? " (and that figure is an upper bound — some wins have no amount recorded)"
                  : ""}
                . AcreOS will still record what actually happened.
              </p>
            )}
            {remaining !== null && !overBudget && (
              <p className="text-xs text-muted-foreground">
                Session budget remaining: {centsExact(remaining)}.
              </p>
            )}

            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <Checkbox
                checked={ownerOccupied}
                onCheckedChange={(v) => setOwnerOccupied(v === true)}
                aria-label="Parcel was owner-occupied at the sale"
              />
              <span className="text-muted-foreground">
                Owner-occupied at the sale (several states run a different redemption period).
              </span>
            </label>

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {Verbs.CANCEL}
              </Button>
              <Button
                onClick={() => recordWin.mutate()}
                disabled={recordWin.isPending || amountCents === null || amountCents <= 0}
                data-testid={`button-confirm-won-${listing.id}`}
              >
                <Trophy className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                {recordWin.isPending ? "Recording…" : `Record win of ${centsExact(amountCents)}`}
              </Button>
            </DialogFooter>
          </div>
        ) : handoff.status === "blocked" ? (
          <div className="space-y-3" data-testid={`cert-blocked-${listing.id}`}>
            <div className="flex items-start gap-2 rounded-md border border-acr-warning/40 bg-acr-warning/5 p-3">
              <ShieldAlert className="w-4 h-4 text-acr-warning shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-xs space-y-1">
                <p className="font-semibold">
                  The win is recorded. AcreOS will not invent the redemption deadline.
                </p>
                <p className="text-muted-foreground">{handoff.message}</p>
              </div>
            </div>
            {handoff.needsRedemptionDeadline && (
              <>
                <div className="space-y-1">
                  <Label htmlFor={`won-deadline-${listing.id}`}>
                    Statutory redemption deadline (YYYY-MM-DD)
                  </Label>
                  <Input
                    id={`won-deadline-${listing.id}`}
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    data-testid={`input-redemption-deadline-${listing.id}`}
                  />
                  <p className="text-xs text-muted-foreground">
                    Recorded as operator-supplied. AcreOS did not derive this date.
                  </p>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => onOpenChange(false)}>
                    Close
                  </Button>
                  <Button onClick={() => supplyDeadline.mutate()} disabled={supplyDeadline.isPending}>
                    {supplyDeadline.isPending ? "Creating…" : "Create certificate"}
                  </Button>
                </DialogFooter>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3" data-testid={`cert-created-${listing.id}`}>
            <div className="flex items-start gap-2 rounded-md border border-acr-pos/40 bg-acr-pos/5 p-3">
              <ScrollText className="w-4 h-4 text-acr-pos shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-xs space-y-1">
                <p className="font-semibold">
                  {handoff.status === "created"
                    ? "Certificate created from this lot."
                    : "A certificate already existed for this lot — no duplicate was created."}
                </p>
                <p className="text-muted-foreground">
                  Redemption deadline{" "}
                  <span className="font-mono">{handoff.redemptionDeadline}</span>
                  {handoff.status === "created" && (
                    <>
                      {" "}
                      ·{" "}
                      {handoff.deadlineSource === "operator_supplied"
                        ? "you supplied this date"
                        : "derived by AcreOS — preliminary"}
                    </>
                  )}
                </p>
              </div>
            </div>
            {handoff.status === "created" && (
              <div className="text-xs text-muted-foreground space-y-1">
                <p>
                  <span className="text-foreground font-medium">Basis: </span>
                  {handoff.deadlineBasis}
                </p>
                {handoff.citation && (
                  <p>
                    <span className="text-foreground font-medium">Citation: </span>
                    {handoff.citation}
                  </p>
                )}
                <p className="text-acr-warning">{handoff.caveat}</p>
              </div>
            )}
            <DialogFooter>
              <Link href="/redemption-clock">
                <Button variant="outline" size="sm">
                  Open the redemption clock
                </Button>
              </Link>
              <Button size="sm" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Which sale, and how much capital is left in it.
 *
 * `tax_sale_auctions` had no UI insert path, so this is also the only place a
 * sale gets created. The budget is TRACKING ONLY — see the money-posture note
 * at the top of this file.
 */
function SaleBar({
  selectedAuctionId,
  onSelectAuction,
  compact,
}: {
  selectedAuctionId: number | null;
  onSelectAuction: (id: number | null) => void;
  compact: boolean;
}) {
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState("");
  const [editingBudget, setEditingBudget] = useState(false);

  const auctions = useQuery<{ auctions: Auction[]; isEmpty: boolean }>({
    queryKey: ["/api/tax-researcher/auctions"],
    queryFn: async () => {
      const res = await fetch("/api/tax-researcher/auctions", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const selected =
    auctions.data?.auctions.find((a) => a.id === selectedAuctionId) ?? null;

  const budget = useQuery<SessionBudget>({
    queryKey: ["/api/tax-researcher/auctions", selectedAuctionId, "session-budget"],
    enabled: selectedAuctionId !== null,
    queryFn: async () => {
      const res = await fetch(`/api/tax-researcher/auctions/${selectedAuctionId}/session-budget`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  useEffect(() => {
    if (selected?.sessionBudgetCents != null) {
      setBudgetDraft(String(selected.sessionBudgetCents / 100));
    }
  }, [selected?.id, selected?.sessionBudgetCents]);

  const saveBudget = useMutation({
    mutationFn: async () => {
      const cents = dollarsToCents(budgetDraft);
      if (cents === null || cents < 0) throw new Error("Enter the capital allocated to this sale.");
      return apiPost<{ auction: Auction }>(
        `/api/tax-researcher/auctions/${selectedAuctionId}`,
        { sessionBudgetCents: cents },
        "PATCH",
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/auctions"] });
      setEditingBudget(false);
      toast({ title: "Session budget set" });
    },
    onError: (err: any) =>
      toast({ title: "Couldn't set the budget", description: err.message, variant: "destructive" }),
  });

  if (compact) {
    // Courthouse mode: the remaining figure and nothing else.
    return (
      <Card className="p-3 mb-3" data-testid="session-budget-compact">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-muted-foreground">Capital left in this session</span>
          <span
            className={`text-xl font-semibold tabular-nums ${
              budget.data?.overBudget ? "text-acr-neg" : ""
            }`}
          >
            {budget.data?.remainingCents === null || budget.data === undefined
              ? "Not set"
              : centsExact(budget.data.remainingCents)}
          </span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 mb-4">
      <div className="flex flex-col md:flex-row md:items-end gap-3">
        <div className="space-y-1 md:w-80">
          <Label htmlFor="sale-select" className="text-xs">
            Sale
          </Label>
          <Select
            value={selectedAuctionId === null ? "all" : String(selectedAuctionId)}
            onValueChange={(v) => onSelectAuction(v === "all" ? null : Number(v))}
          >
            <SelectTrigger id="sale-select" className="h-9" data-testid="select-sale">
              <SelectValue placeholder="All lots" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All lots (no sale selected)</SelectItem>
              {(auctions.data?.auctions ?? []).map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.county}, {a.state} · {String(a.auctionDate).slice(0, 10)} · {a.lotCount} lots
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCreating((v) => !v)}
          data-testid="button-new-sale"
        >
          {creating ? "Cancel" : "New sale"}
        </Button>
      </div>

      {creating && (
        <NewSaleForm
          onDone={(id) => {
            setCreating(false);
            onSelectAuction(id);
          }}
        />
      )}

      {selected && (
        <>
          <Separator className="my-4" />
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-primary" aria-hidden="true" />
              <div>
                <div className="text-xs text-muted-foreground">Session budget</div>
                <div className="text-sm">
                  {selected.county}, {selected.state} · {selected.auctionType.replace(/_/g, " ")} sale
                </div>
              </div>
            </div>
            {budget.isLoading ? (
              <Skeleton className="h-14 w-64" />
            ) : (
              <div className="grid grid-cols-3 gap-4 text-right" data-testid="session-budget">
                <div>
                  <div className="text-micro uppercase tracking-wide text-muted-foreground">
                    Allocated
                  </div>
                  <div className="font-mono tabular-nums text-sm">
                    {budget.data?.budgetCents === null || budget.data === undefined
                      ? "Not set"
                      : centsExact(budget.data.budgetCents)}
                  </div>
                </div>
                <div>
                  <div className="text-micro uppercase tracking-wide text-muted-foreground">
                    Committed
                  </div>
                  <div className="font-mono tabular-nums text-sm" data-testid="text-budget-committed">
                    {centsExact(budget.data?.committedCents ?? 0)}
                  </div>
                  <div className="text-micro text-muted-foreground">
                    {budget.data?.wonCount ?? 0} won
                  </div>
                </div>
                <div>
                  <div className="text-micro uppercase tracking-wide text-muted-foreground">
                    Remaining
                  </div>
                  <div
                    className={`font-mono tabular-nums text-lg font-semibold ${
                      budget.data?.overBudget ? "text-acr-neg" : "text-acr-pos"
                    }`}
                    data-testid="text-budget-remaining"
                  >
                    {budget.data?.remainingCents === null || budget.data === undefined
                      ? "Not set"
                      : centsExact(budget.data.remainingCents)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {budget.data?.remainingIsUpperBound && (
            <p className="text-xs text-acr-warning mt-2">
              {budget.data.winsWithUnknownAmount} win
              {budget.data.winsWithUnknownAmount === 1 ? "" : "s"} have no amount recorded, so
              "remaining" is an upper bound, not a fact.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-3">
            {editingBudget ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="budget-input" className="text-xs">
                    Capital allocated to this sale ($)
                  </Label>
                  <Input
                    id="budget-input"
                    inputMode="decimal"
                    value={budgetDraft}
                    onChange={(e) => setBudgetDraft(e.target.value)}
                    className="h-8 w-40"
                    data-testid="input-session-budget"
                  />
                </div>
                <Button size="sm" onClick={() => saveBudget.mutate()} disabled={saveBudget.isPending}>
                  {saveBudget.isPending ? "Saving…" : "Save"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingBudget(false)}>
                  {Verbs.CANCEL}
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditingBudget(true)}>
                  {budget.data?.budgetCents === null ? "Set session budget" : "Edit session budget"}
                </Button>
                <Link href={`/auction-worksheet?auctionId=${selected.id}`}>
                  <Button size="sm" variant="ghost">
                    Open day-of bid log
                  </Button>
                </Link>
              </>
            )}
          </div>

          <p className="text-xs text-muted-foreground mt-3">
            {budget.data?.moneyCustody
              ? `Money custody: ${budget.data.moneyCustody}.`
              : "AcreOS tracks this figure only — deposits and certificate purchases move between you and the county on your own rails."}
          </p>
          {!selected.attorneyReviewed && (
            <p className="text-xs text-acr-warning mt-1">
              {selected.state} rules: {selected.ruleCoverage.replace(/_/g, " ")}. {selected.caveat}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function NewSaleForm({ onDone }: { onDone: (id: number) => void }) {
  const { toast } = useToast();
  const [county, setCounty] = useState("");
  const [state, setState] = useState("");
  const [auctionType, setAuctionType] = useState<"lien" | "deed" | "redeemable_deed">("lien");
  const [auctionDate, setAuctionDate] = useState("");
  const [budget, setBudget] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      if (!county.trim()) throw new Error("County is required.");
      if (!/^[A-Za-z]{2}$/.test(state.trim())) throw new Error("State must be a 2-letter code.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(auctionDate)) throw new Error("Sale date is required.");
      return apiPost<{ auction: Auction }>("/api/tax-researcher/auctions", {
        county: county.trim(),
        state: state.trim().toUpperCase(),
        auctionType,
        auctionDate,
        sessionBudgetCents: dollarsToCents(budget),
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/auctions"] });
      toast({ title: "Sale created" });
      onDone(data.auction.id);
    },
    onError: (err: any) =>
      toast({ title: "Couldn't create the sale", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
      <div className="space-y-1">
        <Label htmlFor="new-sale-county" className="text-xs">
          County
        </Label>
        <Input
          id="new-sale-county"
          value={county}
          onChange={(e) => setCounty(e.target.value)}
          className="h-8"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="new-sale-state" className="text-xs">
          State
        </Label>
        <Input
          id="new-sale-state"
          value={state}
          maxLength={2}
          onChange={(e) => setState(e.target.value.toUpperCase())}
          className="h-8 uppercase"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="new-sale-type" className="text-xs">
          Sale type
        </Label>
        <Select value={auctionType} onValueChange={(v) => setAuctionType(v as typeof auctionType)}>
          <SelectTrigger id="new-sale-type" className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lien">Lien</SelectItem>
            <SelectItem value="deed">Deed</SelectItem>
            <SelectItem value="redeemable_deed">Redeemable deed</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="new-sale-date" className="text-xs">
          Sale date
        </Label>
        <Input
          id="new-sale-date"
          type="date"
          value={auctionDate}
          onChange={(e) => setAuctionDate(e.target.value)}
          className="h-8"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="new-sale-budget" className="text-xs">
          Budget ($, optional)
        </Label>
        <Input
          id="new-sale-budget"
          inputMode="decimal"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          className="h-8"
        />
      </div>
      <div className="col-span-2 md:col-span-5 flex justify-end">
        <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create sale"}
        </Button>
      </div>
    </div>
  );
}

/**
 * CSV lot-list import: map → preview → commit.
 *
 * Three-step on purpose. `/preview` never writes; `/commit` writes only rows
 * the operator has already seen validated; rejected rows are rendered in full,
 * with the offending value quoted, so a 500-row file never reports "412
 * imported" and leaves the operator to guess about 88 parcels.
 */
function LotListImportCard({ defaultAuctionId }: { defaultAuctionId: number | null }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState("");
  const [auctionId, setAuctionId] = useState<number | null>(defaultAuctionId);
  const [mapping, setMapping] = useState<Record<string, number | null> | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportCommit | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  const auctions = useQuery<{ auctions: Auction[] }>({
    queryKey: ["/api/tax-researcher/auctions"],
    enabled: open,
    queryFn: async () => {
      const res = await fetch("/api/tax-researcher/auctions", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const reset = () => {
    setFileName(null);
    setCsv("");
    setMapping(null);
    setPreview(null);
    setResult(null);
    setReadError(null);
  };

  // allow-no-invalidation: /preview writes nothing by design — it validates the
  // file and returns the mapping + rejections. There is no server state to
  // invalidate until /commit runs (which does invalidate).
  const runPreview = useMutation({
    mutationFn: async (input: { csv: string; mapping: Record<string, number | null> | null }) =>
      apiPost<ImportPreview>("/api/tax-researcher/imports/lot-list/preview", {
        csv: input.csv,
        auctionId,
        ...(input.mapping ? { mapping: input.mapping } : {}),
      }),
    onSuccess: (data) => {
      setPreview(data);
      setMapping(data.mapping);
      setResult(null);
      // No cache to invalidate: /preview writes nothing by design.
    },
    onError: (err: any) => {
      setPreview(null);
      setReadError(err.message);
    },
  });

  const commit = useMutation({
    mutationFn: async () =>
      apiPost<ImportCommit>("/api/tax-researcher/imports/lot-list/commit", {
        csv,
        auctionId,
        ...(mapping ? { mapping } : {}),
      }),
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/auction-worksheet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/auctions"] });
      toast({
        title: `${data.summary.insertedCount} lot${data.summary.insertedCount === 1 ? "" : "s"} imported`,
        description:
          data.summary.rejectedCount > 0
            ? `${data.summary.rejectedCount} row${data.summary.rejectedCount === 1 ? "" : "s"} were rejected and NOT imported — the list below says why.`
            : undefined,
      });
    },
    onError: (err: any) =>
      toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  const onFile = async (file: File | null) => {
    if (!file) return;
    setReadError(null);
    setResult(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      setCsv(text);
      setMapping(null);
      runPreview.mutate({ csv: text, mapping: null });
    } catch {
      setReadError("That file could not be read as text. Save the county list as CSV and retry.");
    }
  };

  const unmappedRequired = preview?.unmappedRequired ?? [];

  return (
    <Card className="mb-4">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Upload className="w-4 h-4 text-primary" aria-hidden="true" />
              Import a county lot list (CSV)
            </h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
              Your own county list — the published PDF or XLS saved as CSV. AcreOS maps the columns
              you confirm, shows you every row it would import, and reports every row it will not.
              Nothing is scraped, nothing is guessed, and no row is silently dropped.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            data-testid="button-toggle-import"
          >
            {open ? "Hide" : "Import CSV"}
          </Button>
        </div>

        {open && (
          <div className="mt-4 space-y-4">
            {/* Step 1 — the file + which sale it belongs to. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="lot-csv-file" className="text-xs">
                  Lot-list file (.csv, .tsv, .txt)
                </Label>
                <Input
                  id="lot-csv-file"
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/plain"
                  onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                  className="h-9"
                  data-testid="input-lot-csv"
                />
                {fileName && (
                  <p className="text-xs text-muted-foreground">
                    {fileName}
                    {preview ? ` · ${preview.summary.totalRows} data rows` : ""}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="import-sale" className="text-xs">
                  Attach to sale
                </Label>
                <Select
                  value={auctionId === null ? "none" : String(auctionId)}
                  onValueChange={(v) => setAuctionId(v === "none" ? null : Number(v))}
                >
                  <SelectTrigger id="import-sale" className="h-9" data-testid="select-import-sale">
                    <SelectValue placeholder="No sale" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No sale (unattached lots)</SelectItem>
                    {(auctions.data?.auctions ?? []).map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.county}, {a.state} · {String(a.auctionDate).slice(0, 10)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Lots attached to a sale count against that sale's session budget.
                </p>
              </div>
            </div>

            {readError && (
              <div
                className="flex items-start gap-2 rounded-md border border-acr-neg/40 bg-acr-neg/5 p-3"
                role="alert"
                data-testid="text-import-read-error"
              >
                <FileWarning className="w-4 h-4 text-acr-neg shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-xs">{readError}</p>
              </div>
            )}

            {runPreview.isPending && <Skeleton className="h-24" />}

            {/* Step 2 — confirm the mapping. A guess is never presented as a fact. */}
            {preview && (
              <>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Confirm the column mapping
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {preview.fields.map((f) => {
                      const current = mapping?.[f.key];
                      const missing = f.required && (current === null || current === undefined);
                      return (
                        <div key={f.key} className="space-y-1">
                          <Label htmlFor={`map-${f.key}`} className="text-xs">
                            {f.label}
                            {f.required && <span className="text-acr-neg"> *</span>}
                          </Label>
                          <Select
                            value={current === null || current === undefined ? "none" : String(current)}
                            onValueChange={(v) =>
                              setMapping((m) => ({
                                ...(m ?? {}),
                                [f.key]: v === "none" ? null : Number(v),
                              }))
                            }
                          >
                            <SelectTrigger
                              id={`map-${f.key}`}
                              className={`h-8 text-xs ${missing ? "border-acr-neg" : ""}`}
                              data-testid={`select-map-${f.key}`}
                            >
                              <SelectValue placeholder="Not mapped" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Not mapped</SelectItem>
                              {preview.headers.map((h, i) => (
                                <SelectItem key={`${h}-${i}`} value={String(i)}>
                                  {h || `column ${i + 1}`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {f.help && <p className="text-micro text-muted-foreground">{f.help}</p>}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runPreview.mutate({ csv, mapping })}
                      disabled={runPreview.isPending}
                      data-testid="button-recheck-mapping"
                    >
                      {runPreview.isPending ? "Checking…" : "Re-check with this mapping"}
                    </Button>
                    {preview.ignoredColumns.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        Ignored columns: {preview.ignoredColumns.map((c) => c.header).join(", ")}
                      </span>
                    )}
                  </div>
                  {unmappedRequired.length > 0 && (
                    <p className="text-xs text-acr-neg mt-2" role="alert">
                      Map every required column before importing. Still unmapped:{" "}
                      {unmappedRequired.join(", ")}.
                    </p>
                  )}
                </div>

                <Separator />

                {/* Step 3 — the preview. Counts always reconcile. */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card className="p-3">
                    <div className="text-xs text-muted-foreground">Rows in file</div>
                    <div className="text-xl font-semibold tabular-nums" data-testid="text-rows-in-file">
                      {preview.summary.totalRows}
                    </div>
                  </Card>
                  <Card className="p-3">
                    <div className="text-xs text-muted-foreground">Will import</div>
                    <div
                      className="text-xl font-semibold tabular-nums text-acr-pos"
                      data-testid="text-rows-valid"
                    >
                      {preview.summary.validCount}
                    </div>
                  </Card>
                  <Card className="p-3">
                    <div className="text-xs text-muted-foreground">Rejected</div>
                    <div
                      className={`text-xl font-semibold tabular-nums ${
                        preview.summary.rejectedCount > 0 ? "text-acr-neg" : ""
                      }`}
                      data-testid="text-rows-rejected"
                    >
                      {preview.summary.rejectedCount}
                    </div>
                  </Card>
                  <Card className="p-3">
                    <div className="text-xs text-muted-foreground">Tax owed (valid rows)</div>
                    <div className="text-lg font-mono tabular-nums">
                      {centsExact(preview.summary.totalTaxOwedCents)}
                    </div>
                  </Card>
                </div>

                {preview.summary.jurisdictions.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Jurisdictions:{" "}
                    {preview.summary.jurisdictions
                      .map((j) => `${j.county}, ${j.state} (${j.count})`)
                      .join(" · ")}
                  </p>
                )}

                {preview.rejected.length > 0 && (
                  <RejectedRows
                    rejected={preview.rejected}
                    truncated={preview.rejectedTruncated}
                    committed={false}
                  />
                )}

                {preview.sampleValid.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                      Preview the first {preview.sampleValid.length} valid row
                      {preview.sampleValid.length === 1 ? "" : "s"}
                    </summary>
                    <div className="overflow-x-auto mt-2">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground border-b border-border">
                            <th className="px-2 py-1 text-left font-medium">File row</th>
                            <th className="px-2 py-1 text-left font-medium">APN</th>
                            <th className="px-2 py-1 text-left font-medium">County / state</th>
                            <th className="px-2 py-1 text-left font-medium">Sale type</th>
                            <th className="px-2 py-1 text-right font-medium">Tax owed</th>
                            <th className="px-2 py-1 text-right font-medium">Min bid</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.sampleValid.map((row, i) => (
                            <tr key={i} className="border-b border-border/40">
                              <td className="px-2 py-1 tabular-nums">{String(row.fileRow ?? "")}</td>
                              <td className="px-2 py-1 font-mono">{String(row.apn ?? "")}</td>
                              <td className="px-2 py-1">
                                {String(row.county ?? "")}, {String(row.state ?? "")}
                              </td>
                              <td className="px-2 py-1">{String(row.saleType ?? "")}</td>
                              <td className="px-2 py-1 text-right font-mono">
                                {centsExact(row.totalTaxOwedCents as number | null)}
                              </td>
                              <td className="px-2 py-1 text-right font-mono">
                                {centsExact((row.minimumBidCents as number | null) ?? null)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}

                <p className="text-xs text-acr-warning">{preview.caveat}</p>

                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={reset}>
                    Start over
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => commit.mutate()}
                    disabled={
                      commit.isPending ||
                      unmappedRequired.length > 0 ||
                      preview.summary.validCount === 0
                    }
                    data-testid="button-commit-import"
                  >
                    {commit.isPending
                      ? "Importing…"
                      : `Import ${preview.summary.validCount} lot${preview.summary.validCount === 1 ? "" : "s"}`}
                  </Button>
                </div>
              </>
            )}

            {/* Result — the rejected rows survive the commit, so they can be
                fixed and re-imported rather than forgotten. */}
            {result && (
              <div className="space-y-3" data-testid="import-result">
                <div className="rounded-md border border-border p-3 text-xs space-y-1">
                  <p className="font-semibold">
                    {result.summary.insertedCount} of {result.summary.totalRows} rows imported.
                  </p>
                  <p className="text-muted-foreground">
                    {result.summary.rejectedCount} rejected and NOT imported ·{" "}
                    {result.summary.insertedCount + result.summary.rejectedCount} of{" "}
                    {result.summary.totalRows} rows accounted for.
                  </p>
                </div>
                {result.rejected.length > 0 && (
                  <RejectedRows
                    rejected={result.rejected}
                    truncated={result.rejectedTruncated}
                    committed
                  />
                )}
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={reset}>
                    Import another list
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Rejected rows, in full, with the offending value quoted back. */
function RejectedRows({
  rejected,
  truncated,
  committed,
}: {
  rejected: RowRejection[];
  truncated: boolean;
  committed: boolean;
}) {
  return (
    <div className="rounded-md border border-acr-neg/40 bg-acr-neg/5 p-3">
      <div className="flex items-center gap-2 mb-2">
        <FileWarning className="w-4 h-4 text-acr-neg" aria-hidden="true" />
        <h3 className="text-xs font-semibold">
          {committed
            ? `${rejected.length} row${rejected.length === 1 ? "" : "s"} rejected — not imported`
            : `${rejected.length} row${rejected.length === 1 ? "" : "s"} will not be imported`}
        </h3>
      </div>
      <motion.ul
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-2 max-h-72 overflow-y-auto"
        data-testid="list-rejected-rows"
      >
        {rejected.map((r) => (
          <motion.li
            key={r.fileRow}
            variants={staggerItem}
            className="text-xs border-b border-border/40 pb-2 last:border-0"
            data-testid={`rejected-row-${r.fileRow}`}
          >
            <div className="font-medium">File row {r.fileRow}</div>
            <ul className="mt-0.5 space-y-0.5">
              {r.errors.map((e, i) => (
                <li key={i} className="text-muted-foreground">
                  <span className="text-foreground">{e.column ?? e.field}</span>
                  {e.value !== "" && <> — “{e.value}”</>}: {e.message}
                </li>
              ))}
            </ul>
          </motion.li>
        ))}
      </motion.ul>
      {truncated && (
        <p className="text-xs text-muted-foreground mt-2">
          Only the first 500 rejected rows are listed; the counts above are exact.
        </p>
      )}
      <p className="text-xs text-muted-foreground mt-2">
        Fix these rows in the file and re-import — AcreOS will reject the parcels it already has
        rather than double-count them.
      </p>
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
