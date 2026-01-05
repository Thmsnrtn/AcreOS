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
  Loader2,
  ChevronRight
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
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
  lead: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  property: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  deal: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  payment: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  note: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  task: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
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

  const { data: activities, isLoading } = useQuery<ActivityLogEntry[]>({
    queryKey: ["/api/activity-feed", queryParams.toString()],
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
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
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
                    className="flex items-start gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors"
                    data-testid={`activity-item-${activity.id}`}
                  >
                    <div className={`p-2 rounded-lg ${colorClass}`}>
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
                          {activity.createdAt && formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                        </span>
                        {activity.userId && (
                          <span>by {activity.userId}</span>
                        )}
                      </div>
                    </div>
                    
                    {route && activity.entityId && (
                      <Link href={route}>
                        <Button variant="ghost" size="icon" data-testid={`button-activity-nav-${activity.id}`}>
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </Link>
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
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Activity className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No activity yet</h3>
              <p className="text-muted-foreground">Activity will appear here as you use the platform</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
