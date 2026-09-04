import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Activity,
  Users,
  Map,
  GitBranch,
  DollarSign,
  FileText,
  Clock,
  ChevronRight
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { relative } from "@/lib/format";
import { Link } from "wouter";
import type { ActivityLogEntry } from "@shared/schema";

const entityTypeIcons: Record<string, any> = {
  lead: Users,
  property: Map,
  deal: GitBranch,
  payment: DollarSign,
  note: FileText,
  task: Clock,
};

const entityTypeColors: Record<string, string> = {
  lead: "bg-acr-accent text-acr-accent dark:bg-acr-accent dark:text-acr-accent",
  property: "bg-acr-pos-soft text-acr-pos-soft-ink dark:bg-acr-pos-soft dark:text-acr-pos-soft-ink",
  deal: "bg-acr-brand-soft text-acr-brand-soft-ink dark:bg-acr-brand-soft dark:text-acr-brand-soft-ink",
  payment: "bg-acr-warn-soft text-acr-warn-soft-ink dark:bg-acr-warn-soft dark:text-acr-warn-soft-ink",
  note: "bg-muted text-foreground dark:bg-acr-bg-sunken dark:text-muted-foreground",
  task: "bg-acr-neg-soft text-acr-neg-soft-ink dark:bg-acr-neg-soft dark:text-acr-neg-soft-ink",
};

const entityTypeRoutes: Record<string, string> = {
  lead: "/leads",
  property: "/properties",
  deal: "/deals",
  payment: "/finance",
  note: "/finance",
  task: "/tasks",
};

export function ActivityContent() {
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [limit, setLimit] = useState(50);

  const queryParams = new URLSearchParams();
  if (entityFilter !== "all") queryParams.set("entityType", entityFilter);
  queryParams.set("limit", String(limit));

  // Default queryFn joins parts with "/", so without an explicit queryFn
  // this fired GET /api/activity-feed/limit=50 → 404 on every mount. Build
  // the URL with "?" instead. Surfaced via the route-sweep on /analytics.
  const { data: activities, isLoading } = useQuery<ActivityLogEntry[]>({
    queryKey: ["/api/activity-feed", queryParams.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/activity-feed?${queryParams.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return res.json();
    },
  });

  const loadMore = () => {
    setLimit(prev => prev + 50);
  };

  return (
    <div className="space-y-6" data-testid="activity-content">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl md:text-2xl font-bold" data-testid="text-activity-subtitle">Activity Feed</h2>
          <p className="text-muted-foreground">Track all actions and events across your organization</p>
        </div>
        
        <Select value={entityFilter} onValueChange={setEntityFilter}>
          <SelectTrigger className="w-40" data-testid="select-activity-filter">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Activity</SelectItem>
            <SelectItem value="lead">Leads</SelectItem>
            <SelectItem value="property">Properties</SelectItem>
            <SelectItem value="deal">Deals</SelectItem>
            <SelectItem value="payment">Payments</SelectItem>
            <SelectItem value="task">Tasks</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div role="status" aria-busy="true" aria-live="polite" className="space-y-1">
              <span className="sr-only">Loading recent activity</span>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-start gap-4 p-3">
                  <Skeleton announce={false} className="h-8 w-8 rounded-card shrink-0" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <Skeleton announce={false} className="h-4 w-1/3 max-w-48" />
                    <Skeleton announce={false} className="h-3 w-2/3 max-w-72" />
                    <Skeleton announce={false} className="h-3 w-24" />
                  </div>
                </div>
              ))}
            </div>
          ) : activities && activities.length > 0 ? (
            <div className="space-y-1">
              {activities.map((activity, index) => {
                const Icon = entityTypeIcons[activity.entityType] || Activity;
                const colorClass = entityTypeColors[activity.entityType] || "bg-muted text-muted-foreground";
                const route = entityTypeRoutes[activity.entityType];
                
                return (
                  <div 
                    key={activity.id || index} 
                    className="flex items-start gap-4 p-3 rounded-card hover:bg-muted/50 transition-colors"
                    data-testid={`activity-item-${activity.id}`}
                  >
                    <div className={`p-2 rounded-card ${colorClass}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary" className="text-xs">
                          {activity.entityType}
                        </Badge>
                        <span className="text-sm font-medium">{activity.action}</span>
                      </div>
                      
                      {activity.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {activity.description}
                        </p>
                      )}
                      
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {activity.createdAt && relative(activity.createdAt)}
                        </span>
                        {activity.userId && (
                          <span>by {activity.userId}</span>
                        )}
                      </div>
                    </div>
                    
                    {route && activity.entityId && (
                      <Button asChild variant="ghost" size="icon" data-testid={`button-activity-nav-${activity.id}`}>
                        <Link href={route} aria-label={`View ${activity.entityType} details`}>
                          <ChevronRight className="w-4 h-4" aria-hidden="true" />
                        </Link>
                      </Button>
                    )}
                  </div>
                );
              })}
              
              {activities.length >= limit && (
                <div className="flex justify-center pt-4">
                  <Button variant="outline" onClick={loadMore} data-testid="button-load-more-activity">
                    Load More
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              icon={Activity}
              headline="No activity yet"
              subtitle="Activity will appear here as you use the platform"
              // TODO(cta): activity log is system-generated — no direct user action creates entries
              cta={{ label: "", _noOp: true }}
              testId="empty-state-activity"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
