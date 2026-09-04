/**
 * MobileLeadList — phone-shaped /leads.
 *
 * The desktop /leads is a wide table with filterable columns. On a
 * phone we render a card per lead:
 *   - Name, status pill, score
 *   - Address line
 *   - "x days since contact" badge
 *   - Inline Call / Text chips (tel: / sms:)
 *
 * A top filter row scopes the list to all / hot / new / responded,
 * and a search box matches name + phone + address client-side. The
 * page calls into the same `useLeads()` flat-list hook the desktop
 * uses, so caches stay shared.
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Search,
  Phone,
  MessageSquare,
  Flame,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useLeads } from "@/hooks/use-leads";
import { cn } from "@/lib/utils";
import { VirtualList } from "@/components/virtual-list";
import { apiRequest } from "@/lib/queryClient";
import PostCallSheet, { setPendingContactEvent } from "@/components/mobile/PostCallSheet";

type FilterKey = "all" | "hot" | "new" | "responded";

interface MobileLead {
  id: number;
  firstName: string;
  lastName: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  status?: string | null;
  nurturingStage?: string | null;
  score?: number | null;
  lastContactedAt?: string | null;
}

function StatusPill({ status }: { status?: string | null }) {
  const s = (status ?? "new").toLowerCase();
  const tone =
    s === "dead" ? "bg-acr-neg-soft text-acr-neg-soft-ink"
    : s === "closed" ? "bg-acr-pos-soft text-acr-pos-soft-ink"
    : s === "accepted" || s === "under_contract" || s === "qualified"
      ? "bg-acr-warn-soft text-acr-warn-soft-ink"
      : s === "responded" || s === "negotiating" || s === "interested" || s === "contacted"
        ? "bg-primary/15 text-primary"
        : "bg-muted text-foreground";
  return (
    <span
      className={`uppercase tracking-wide text-micro font-semibold px-1.5 py-0.5 rounded ${tone}`}
    >
      {s.replace(/_/g, " ")}
    </span>
  );
}

/**
 * Fire-and-forget POST for tap-to-call/text. Returns immediately so
 * the dialer hand-off feels native; on failure we keep a console.warn
 * (server-side logger.warn is also emitted) and do NOT block the call.
 */
function logContactEvent(leadId: number, channel: "phone" | "sms"): void {
  apiRequest("POST", `/api/leads/${leadId}/contact-event`, {
    channel,
    method: "tap",
  }).catch(() => {
    // Best-effort. Don't surface a toast — the user is mid-dial.
  });
}

function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}

// Card render for one lead. Pulled out of MobileLeadList so the
// virtualized list can call it as a stable per-row renderer.
function MobileLeadRow({
  lead: l,
  onOpen,
}: {
  lead: MobileLead;
  onOpen: () => void;
}) {
  const fullName =
    [l.firstName, l.lastName].filter(Boolean).join(" ").trim() ||
    `Lead #${l.id}`;
  const where = [l.city, l.state].filter(Boolean).join(", ");
  const d = daysSince(l.lastContactedAt);
  return (
    <div className="pb-2">
      <Card className="p-3 active:bg-muted/50">
        <div
          role="button"
          tabIndex={0}
          onClick={onOpen}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen();
            }
          }}
          aria-label={`Open lead ${fullName}`}
          className="flex items-start justify-between gap-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{fullName}</span>
              <StatusPill status={l.status} />
            </div>
            <div className="text-xs text-muted-foreground truncate mt-0.5">
              {[l.address, where].filter(Boolean).join(" · ") || "—"}
            </div>
            {d != null && (
              <div
                className={cn(
                  "text-micro mt-1 inline-block px-1.5 py-0.5 rounded",
                  d >= 21
                    ? "bg-acr-neg-soft text-acr-neg-soft-ink"
                    : d >= 7
                      ? "bg-acr-warn-soft text-acr-warn-soft-ink"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {d === 0 ? "Contacted today" : `${d}d since contact`}
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-xl font-semibold tabular-nums">
              {l.score ?? 0}
            </div>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
              score
            </div>
          </div>
        </div>
        {l.phone && (
          <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-border/60">
            <a
              href={`tel:${l.phone}`}
              onClick={(e) => {
                e.stopPropagation();
                // Optimistic, fire-and-forget. Do NOT await — the dial
                // must feel instant. The server bumps lastContactedAt
                // + appends a leadActivities row before we ever come
                // back to the app. The post-call sheet enriches with
                // an outcome on return.
                logContactEvent(l.id, "phone");
                setPendingContactEvent({
                  leadId: l.id,
                  leadName:
                    [l.firstName, l.lastName].filter(Boolean).join(" ").trim() ||
                    `Lead #${l.id}`,
                  channel: "phone",
                  startedAt: Date.now(),
                });
              }}
              className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-md bg-primary/10 text-primary text-sm font-medium active:bg-primary/20"
              data-testid={`mobile-lead-call-${l.id}`}
            >
              <Phone className="h-3.5 w-3.5" /> Call
            </a>
            <a
              href={`sms:${l.phone}`}
              onClick={(e) => {
                e.stopPropagation();
                logContactEvent(l.id, "sms");
                setPendingContactEvent({
                  leadId: l.id,
                  leadName:
                    [l.firstName, l.lastName].filter(Boolean).join(" ").trim() ||
                    `Lead #${l.id}`,
                  channel: "sms",
                  startedAt: Date.now(),
                });
              }}
              className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-md bg-muted text-foreground text-sm font-medium active:bg-muted/70"
              data-testid={`mobile-lead-sms-${l.id}`}
            >
              <MessageSquare className="h-3.5 w-3.5" /> Text
            </a>
          </div>
        )}
      </Card>
    </div>
  );
}

// Row height for the virtualized list. Phone cards have an extra
// Call/Text button row (taller); name-only cards are shorter. We size
// to the worst case so the windowing math is stable — at 1,000 leads
// the visible window is ~5 cards, so a few px of bottom whitespace on
// short cards is invisible noise. The previous `slice(0, 200)` cap
// silently hid leads #201+; the virtualized list renders every lead
// the legacy useLeads() hook returns.
const ROW_HEIGHT = 156;
// Reserve space for the in-page chrome above the list (search bar,
// filter chips, page padding, bottom nav). Tuned by eye on a 14-Pro;
// the exact value isn't critical — there's pad room in both directions.
const VIEWPORT_CHROME_OFFSET = 260;

function useMobileListHeight(): number {
  // Window-relative height that re-measures on rotate/resize. Default
  // for SSR is a safe phone-ish 600 — VirtualList tolerates that and
  // re-renders on the effect's first paint.
  const [h, setH] = useState<number>(() =>
    typeof window === "undefined" ? 600 : Math.max(320, window.innerHeight - VIEWPORT_CHROME_OFFSET)
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const measure = () =>
      setH(Math.max(320, window.innerHeight - VIEWPORT_CHROME_OFFSET));
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);
  return h;
}

export function MobileLeadList() {
  const [, setLocation] = useLocation();
  const { data, isLoading, error, refetch } = useLeads();
  const leads: MobileLead[] = Array.isArray(data) ? (data as MobileLead[]) : [];

  const [filter, setFilter] = useState<FilterKey>("all");
  const [q, setQ] = useState("");
  const listHeight = useMobileListHeight();

  const filtered = useMemo(() => {
    let xs = leads;
    if (filter === "hot") {
      xs = xs.filter((l) => (l.score ?? 0) >= 70 || (l.nurturingStage ?? "") === "hot");
    } else if (filter === "new") {
      xs = xs.filter((l) => (l.status ?? "").toLowerCase() === "new");
    } else if (filter === "responded") {
      xs = xs.filter((l) =>
        ["responded", "interested", "negotiating", "contacted"].includes(
          (l.status ?? "").toLowerCase(),
        ),
      );
    }
    const term = q.trim().toLowerCase();
    if (term) {
      xs = xs.filter((l) => {
        const name = `${l.firstName ?? ""} ${l.lastName ?? ""}`.toLowerCase();
        const phone = (l.phone ?? "").toLowerCase();
        const addr = [l.address, l.city, l.state].filter(Boolean).join(" ").toLowerCase();
        return (
          name.includes(term) ||
          phone.includes(term) ||
          addr.includes(term)
        );
      });
    }
    // Sort: score desc, then most recently touched first.
    return [...xs].sort((a, b) => {
      const sa = a.score ?? 0, sb = b.score ?? 0;
      if (sb !== sa) return sb - sa;
      const ta = a.lastContactedAt ? new Date(a.lastContactedAt).getTime() : 0;
      const tb = b.lastContactedAt ? new Date(b.lastContactedAt).getTime() : 0;
      return tb - ta;
    });
  }, [leads, filter, q]);

  return (
    <div className="space-y-3" data-testid="mobile-lead-list">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
        <Input
          aria-label="Search leads by name, phone or address"
          type="search"
          inputMode="search"
          placeholder="Search name, phone, address…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9 pr-9 h-11"
          data-testid="mobile-lead-search"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground active:bg-muted/60"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1 scrollbar-hide" role="tablist">
        {(
          [
            { id: "all", label: "All" },
            { id: "hot", label: "Hot", icon: <Flame className="h-3 w-3" /> },
            { id: "new", label: "New" },
            { id: "responded", label: "Responded" },
          ] as Array<{ id: FilterKey; label: string; icon?: React.ReactNode }>
        ).map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "h-8 px-3 rounded-full text-xs font-medium whitespace-nowrap flex items-center gap-1 transition-colors",
              filter === f.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground/80 active:bg-muted/70",
            )}
            data-testid={`mobile-lead-filter-${f.id}`}
          >
            {f.icon}
            {f.label}
          </button>
        ))}
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <Card className="p-8 text-center">
          <div className="text-sm font-medium">Couldn't load leads</div>
          <div className="text-xs text-muted-foreground mt-1">
            Network or session issue. Pull down or try again.
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => refetch()}
            data-testid="mobile-lead-list-retry"
          >
            Try again
          </Button>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="text-sm font-medium">
            {leads.length === 0 ? "No leads yet" : "No leads match"}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {q || filter !== "all"
              ? "Clear the search or change the filter."
              : "Capture your first lead with the Quick add button below."}
          </div>
          {(q || filter !== "all") && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => { setQ(""); setFilter("all"); }}
              data-testid="mobile-lead-list-clear-filters"
            >
              Clear filters
            </Button>
          )}
        </Card>
      ) : (
        <VirtualList
          items={filtered}
          itemHeight={ROW_HEIGHT}
          containerHeight={listHeight}
          overscan={6}
          className="-mx-1 px-1"
          renderItem={(l) => (
            <MobileLeadRow
              lead={l}
              onOpen={() => setLocation(`/leads/${l.id}`)}
            />
          )}
        />
      )}

      {/* Post-call follow-up sheet — listens for visibilitychange + a
          pending event flag and pops the outcome picker once. */}
      <PostCallSheet />
    </div>
  );
}

export default MobileLeadList;
