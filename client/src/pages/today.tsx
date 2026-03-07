import { useEffect } from "react";
import { PageShell } from "@/components/page-shell";
import { StatCard } from "@/components/stat-card";
import { useOrganization, useDashboardStats } from "@/hooks/use-organization";
import { useLeads } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  Map,
  Banknote,
  GitBranch,
  ArrowRight,
  Sun,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";
import { format } from "date-fns";

interface NextBestAction {
  id: string;
  type: string;
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  actionLabel: string;
  actionUrl: string;
}

interface DashboardIntelligence {
  actions: NextBestAction[];
}

const priorityColors: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  low: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
};

export default function TodayPage() {
  const { data: organization } = useOrganization();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: leads = [] } = useLeads();
  const { data: properties = [] } = useProperties();
  const { data: intelligence, isLoading: intelligenceLoading } =
    useQuery<DashboardIntelligence>({
      queryKey: ["/api/dashboard/intelligence"],
      staleTime: 5 * 60 * 1000,
    });

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  };

  const actions = intelligence?.actions?.slice(0, 5) ?? [];

  return (
    <PageShell>
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Sun className="w-5 h-5 text-amber-500" />
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-today-title">
            {greeting()}{organization?.name ? `, ${organization.name}` : ""}
          </h1>
        </div>
        <p className="text-muted-foreground text-sm">
          {format(new Date(), "EEEE, MMMM d, yyyy")} — here's what needs your attention today.
        </p>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5" data-testid="stats-grid">
        <StatCard
          title="Active Leads"
          value={statsLoading ? "-" : stats?.activeLeads ?? leads.length}
          icon={Users}
          trend={`${leads.filter((l) => l.status === "new").length} new`}
          color="terracotta"
          data-testid="stat-active-leads"
        />
        <StatCard
          title="Properties"
          value={statsLoading ? "-" : stats?.activeProperties ?? properties.length}
          icon={Map}
          trend={`${properties.filter((p) => p.status === "owned").length} owned`}
          color="sage"
          data-testid="stat-properties"
        />
        <StatCard
          title="Active Notes"
          value={statsLoading ? "-" : stats?.activeNotes ?? 0}
          icon={Banknote}
          color="terracotta"
          data-testid="stat-active-notes"
        />
        <StatCard
          title="Open Deals"
          value={statsLoading ? "-" : stats?.activeDeals ?? 0}
          icon={GitBranch}
          color="sage"
          data-testid="stat-open-deals"
        />
      </div>

      {/* Action Queue */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Action Queue</h2>
          <Link href="/pipeline">
            <Button variant="ghost" size="sm" className="gap-1 text-xs">
              View Pipeline <ArrowRight className="w-3 h-3" />
            </Button>
          </Link>
        </div>

        {intelligenceLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : actions.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
              <CheckCircle2 className="w-10 h-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">You're all caught up! No actions needed right now.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {actions.map((action) => (
              <Card key={action.id} className="hover:shadow-md transition-shadow">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm truncate">{action.title}</span>
                      <Badge
                        variant="secondary"
                        className={priorityColors[action.priority]}
                      >
                        {action.priority}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{action.description}</p>
                  </div>
                  <Button asChild size="sm" variant="outline" className="shrink-0">
                    <Link href={action.actionUrl}>{action.actionLabel}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Quick Navigation */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Quick Access</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Pipeline", href: "/pipeline", icon: GitBranch, description: "Deals & leads" },
            { label: "Money", href: "/money", icon: Banknote, description: "Notes & finance" },
            { label: "Atlas AI", href: "/atlas", icon: Users, description: "AI assistant" },
            { label: "Settings", href: "/settings", icon: Clock, description: "Account" },
          ].map((item) => (
            <Link key={item.href} href={item.href}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardContent className="flex flex-col items-center justify-center py-6 gap-2 text-center">
                  <item.icon className="w-6 h-6 text-muted-foreground" />
                  <span className="font-medium text-sm">{item.label}</span>
                  <span className="text-xs text-muted-foreground">{item.description}</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
