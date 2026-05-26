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

import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Search,
  Phone,
  MessageSquare,
  Flame,
  Loader2,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLeads } from "@/hooks/use-leads";
import { cn } from "@/lib/utils";

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
    s === "dead" ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
    : s === "closed" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
    : s === "accepted" || s === "under_contract" || s === "qualified"
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
      : s === "responded" || s === "negotiating" || s === "interested" || s === "contacted"
        ? "bg-primary/15 text-primary"
        : "bg-muted text-foreground";
  return (
    <span
      className={`uppercase tracking-wide text-[10px] font-semibold px-1.5 py-0.5 rounded ${tone}`}
    >
      {s.replace(/_/g, " ")}
    </span>
  );
}

function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}

export function MobileLeadList() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useLeads();
  const leads: MobileLead[] = Array.isArray(data) ? data : [];

  const [filter, setFilter] = useState<FilterKey>("all");
  const [q, setQ] = useState("");

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
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="text-sm font-medium">No leads match</div>
          <div className="text-xs text-muted-foreground mt-1">
            {q
              ? "Clear the search or change the filter."
              : "Capture one with the Quick Add button below."}
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.slice(0, 200).map((l) => {
            const fullName =
              [l.firstName, l.lastName].filter(Boolean).join(" ").trim() ||
              `Lead #${l.id}`;
            const where = [l.city, l.state].filter(Boolean).join(", ");
            const d = daysSince(l.lastContactedAt);
            return (
              <Card key={l.id} className="p-3 active:bg-muted/50">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setLocation(`/leads/${l.id}`)}
                  className="flex items-start justify-between gap-3 cursor-pointer"
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
                          "text-[10px] mt-1 inline-block px-1.5 py-0.5 rounded",
                          d >= 21
                            ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                            : d >= 7
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
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
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-md bg-primary/10 text-primary text-sm font-medium active:bg-primary/20"
                      data-testid={`mobile-lead-call-${l.id}`}
                    >
                      <Phone className="h-3.5 w-3.5" /> Call
                    </a>
                    <a
                      href={`sms:${l.phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-md bg-muted text-foreground text-sm font-medium active:bg-muted/70"
                      data-testid={`mobile-lead-sms-${l.id}`}
                    >
                      <MessageSquare className="h-3.5 w-3.5" /> Text
                    </a>
                  </div>
                )}
              </Card>
            );
          })}
          {filtered.length > 200 && (
            <Badge variant="secondary" className="block text-center w-full py-2">
              Showing first 200 — open desktop for the full list
            </Badge>
          )}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin mr-1" /> Loading…
        </div>
      )}
    </div>
  );
}

export default MobileLeadList;
