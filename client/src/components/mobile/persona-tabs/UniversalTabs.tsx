/**
 * Universal mobile tabs — fallback for personas without persona-specific
 * content (Land Flipper, Fix & Flip, Subdivider, Buy-and-Hold). Renders
 * a productive surface so the user never sees a blank screen.
 *
 * Today    — stats row · hot leads · pipeline pulse · recent activity
 * Pipeline — deals condensed by stage
 * Portfolio — totals + a couple jump-tiles
 *
 * Everything taps through to the existing desktop routes. The intent
 * is "calm + scannable, jump to detail."
 */

import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Flame,
  ArrowRight,
  Users,
  Map as MapIcon,
  Briefcase,
  DollarSign,
  TrendingUp,
  Send,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { fetchJsonArray } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface DashboardStats {
  totalLeads: number;
  activeProperties: number;
  activeNotes: number;
  monthlyRevenue: number;
  recentActivity: Array<{
    id: number;
    action: string;
    entityType: string;
    description: string;
    createdAt: string;
  }>;
}

interface Lead {
  id: number;
  firstName: string;
  lastName: string;
  status: string;
  score?: number;
  nurturingStage?: string;
  phone?: string | null;
  city?: string;
  state?: string;
}

interface Deal {
  id: number;
  status: string;
  acceptedAmount?: string | null;
  offerAmount?: string | null;
}

function fmtMoney(v: number | string | null | undefined): string {
  if (v == null) return "$0";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtRelativeTime(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    const diff = Date.now() - t;
    const min = Math.floor(diff / 60_000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return "";
  }
}

export function UniversalToday() {
  const [, setLocation] = useLocation();

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
    staleTime: 60_000,
  });
  const { data: leads = [] } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
    queryFn: () => fetchJsonArray<Lead>("/api/leads?pageSize=50"),
    staleTime: 60_000,
  });
  const { data: deals = [] } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    queryFn: () => fetchJsonArray<Deal>("/api/deals?pageSize=50"),
    staleTime: 60_000,
  });

  if (statsLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    );
  }

  // Top scored leads — anything with a score, descending, top 3
  const hotLeads = [...leads]
    .filter((l) => typeof l.score === "number")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 3);

  const activeDeals = deals.filter(
    (d) =>
      !["closed", "cancelled", "rejected"].includes(d.status),
  );
  const dealValue = activeDeals.reduce(
    (s, d) => s + Number(d.acceptedAmount ?? d.offerAmount ?? 0),
    0,
  );

  const recentActivity = (stats?.recentActivity ?? []).slice(0, 4);

  return (
    <div className="space-y-5">
      {/* Stat tiles row */}
      <section className="grid grid-cols-2 gap-3">
        <StatTile
          icon={<Users className="h-4 w-4" />}
          label="Active leads"
          value={String(stats?.totalLeads ?? 0)}
          onClick={() => setLocation("/leads")}
        />
        <StatTile
          icon={<MapIcon className="h-4 w-4" />}
          label="Properties"
          value={String(stats?.activeProperties ?? 0)}
          onClick={() => setLocation("/properties")}
        />
        <StatTile
          icon={<Briefcase className="h-4 w-4" />}
          label="Active deals"
          value={String(activeDeals.length)}
          sub={`${fmtMoney(dealValue)} in pipeline`}
          onClick={() => setLocation("/deals")}
        />
        <StatTile
          icon={<DollarSign className="h-4 w-4" />}
          label="Monthly revenue"
          value={fmtMoney(stats?.monthlyRevenue ?? 0)}
          sub="recognized this month"
          onClick={() => setLocation("/money")}
        />
      </section>

      {/* Hot leads */}
      {hotLeads.length > 0 && (
        <section>
          <SectionHead icon={<Flame className="h-3.5 w-3.5 text-amber-500" />}>
            Hot leads
          </SectionHead>
          <div className="space-y-2">
            {hotLeads.map((l) => (
              <Card
                key={l.id}
                role="button"
                tabIndex={0}
                onClick={() => setLocation(`/leads/${l.id}`)}
                className="p-4 cursor-pointer active:bg-muted/50"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {l.firstName} {l.lastName}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {l.city ? `${l.city}, ` : ""}
                      {l.state ?? ""}
                      {l.status ? ` · ${l.status}` : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-semibold tabular-nums">
                      {l.score ?? 0}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      score
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Recent activity */}
      {recentActivity.length > 0 && (
        <section>
          <SectionHead icon={<TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />}>
            Recent activity
          </SectionHead>
          <Card>
            <ul className="divide-y divide-border/40">
              {recentActivity.map((a) => (
                <li
                  key={a.id}
                  className="px-4 py-3 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {a.description || a.action}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {a.entityType}
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                    {fmtRelativeTime(a.createdAt)}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {/* Quick jumps */}
      <section className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          className="h-12 justify-between"
          onClick={() => setLocation("/campaigns")}
        >
          <span className="flex items-center gap-2">
            <Send className="h-4 w-4" /> Outreach
          </span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          className="h-12 justify-between"
          onClick={() => setLocation("/ai")}
        >
          <span className="flex items-center gap-2">✨ Ask Pax</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </section>
    </div>
  );
}

export function UniversalPipeline() {
  const [, setLocation] = useLocation();
  const { data: deals = [], isLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    queryFn: () => fetchJsonArray<Deal>("/api/deals?pageSize=200"),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
      </div>
    );
  }

  // Group deals by stage
  const STAGES = [
    { id: "negotiating", label: "Negotiating" },
    { id: "offer_sent", label: "Offer sent" },
    { id: "countered", label: "Countered" },
    { id: "accepted", label: "Accepted" },
    { id: "in_escrow", label: "In escrow" },
    { id: "closed", label: "Closed" },
  ];
  const byStage = new Map<string, Deal[]>();
  for (const d of deals) {
    const arr = byStage.get(d.status) ?? [];
    arr.push(d);
    byStage.set(d.status, arr);
  }

  return (
    <div className="space-y-2">
      <SectionHead icon={<Briefcase className="h-3.5 w-3.5 text-muted-foreground" />}>
        Pipeline by stage
      </SectionHead>
      {STAGES.map((s) => {
        const stageDeals = byStage.get(s.id) ?? [];
        if (stageDeals.length === 0) return null;
        const stageValue = stageDeals.reduce(
          (sum, d) => sum + Number(d.acceptedAmount ?? d.offerAmount ?? 0),
          0,
        );
        return (
          <Card
            key={s.id}
            role="button"
            tabIndex={0}
            onClick={() => setLocation(`/deals?stage=${s.id}`)}
            className="p-4 cursor-pointer active:bg-muted/50"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{s.label}</div>
                <div className="text-xs text-muted-foreground">
                  {stageDeals.length} deal{stageDeals.length === 1 ? "" : "s"}
                  {stageValue > 0 ? ` · ${fmtMoney(stageValue)}` : ""}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Card>
        );
      })}
      {deals.length === 0 && (
        <Card>
          <div className="text-center py-10 px-4">
            <Briefcase className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <h2 className="text-base font-semibold">No deals yet</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Deals you create or accept will show up here.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setLocation("/deals")}
            >
              Open deals
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

export function UniversalPortfolio() {
  const [, setLocation] = useLocation();
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <section className="grid grid-cols-2 gap-3">
        <StatTile
          icon={<MapIcon className="h-4 w-4" />}
          label="Active properties"
          value={String(stats?.activeProperties ?? 0)}
          onClick={() => setLocation("/properties")}
        />
        <StatTile
          icon={<DollarSign className="h-4 w-4" />}
          label="Active notes"
          value={String(stats?.activeNotes ?? 0)}
          onClick={() => setLocation("/notes")}
        />
        <StatTile
          icon={<TrendingUp className="h-4 w-4" />}
          label="MTD revenue"
          value={fmtMoney(stats?.monthlyRevenue ?? 0)}
          onClick={() => setLocation("/money")}
        />
        <StatTile
          icon={<Briefcase className="h-4 w-4" />}
          label="Pipeline"
          value=""
          sub="Jump to deals"
          onClick={() => setLocation("/deals")}
        />
      </section>
      <Card
        role="button"
        tabIndex={0}
        onClick={() => setLocation("/portfolio")}
        className="p-4 cursor-pointer active:bg-muted/50"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Full portfolio view</div>
            <div className="text-xs text-muted-foreground mt-1">
              Cash flow · health · performance
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </Card>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function StatTile({
  icon,
  label,
  value,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  onClick?: () => void;
}) {
  const interactive = !!onClick;
  return (
    <Card
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      className={cn(
        "p-4",
        interactive && "cursor-pointer active:bg-muted/50",
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      {value && (
        <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
      )}
      {sub && (
        <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
      )}
    </Card>
  );
}

function SectionHead({
  children,
  icon,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 px-1 flex items-center gap-1.5">
      {icon}
      {children}
    </h2>
  );
}
