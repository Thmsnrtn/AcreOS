import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Lightbulb, Phone, Mail, FileText, Clock, Calendar } from "lucide-react";
import { Link } from "wouter";

interface RecommendedAction {
  id: string;
  type: "follow_up" | "review_offer" | "schedule_call" | "send_mail" | "close_deal";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  entityType: "lead" | "deal" | "property";
  entityId: number;
  dueInfo?: string;
  actionLabel: string;
  actionUrl: string;
}

interface NextBestActionsProps {
  actions: RecommendedAction[];
  isLoading?: boolean;
}

function getActionIcon(type: string) {
  switch (type) {
    case "follow_up":
      return <Phone className="w-4 h-4" />;
    case "send_mail":
      return <Mail className="w-4 h-4" />;
    case "review_offer":
      return <FileText className="w-4 h-4" />;
    case "schedule_call":
      return <Calendar className="w-4 h-4" />;
    default:
      return <Clock className="w-4 h-4" />;
  }
}

function getPriorityStyle(priority: string) {
  switch (priority) {
    case "high":
      return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800";
    case "medium":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800";
    default:
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800";
  }
}

export function NextBestActions({ actions, isLoading }: NextBestActionsProps) {
  if (isLoading) {
    return (
      <Card 
        className="relative overflow-visible bg-gradient-to-br from-green-50/50 to-emerald-50/30 dark:from-green-950/20 dark:to-emerald-950/10"
        data-testid="dashboard-next-actions"
      >
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Lightbulb className="w-5 h-5 text-green-500" />
            Next Best Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!actions || actions.length === 0) {
    return (
      <Card 
        className="relative overflow-visible bg-gradient-to-br from-green-50/50 to-emerald-50/30 dark:from-green-950/20 dark:to-emerald-950/10"
        data-testid="dashboard-next-actions"
      >
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Lightbulb className="w-5 h-5 text-green-500" />
            Next Best Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No recommended actions right now. Great job staying on top of things!</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card 
      className="relative overflow-visible bg-gradient-to-br from-green-50/50 to-emerald-50/30 dark:from-green-950/20 dark:to-emerald-950/10"
      data-testid="dashboard-next-actions"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Lightbulb className="w-5 h-5 text-green-500" />
          Next Best Actions
          <Badge variant="outline" className="ml-2 text-xs">
            {actions.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {actions.slice(0, 5).map((action, index) => (
          <div 
            key={action.id}
            className="p-3 rounded-md bg-background/60 border border-border/50"
            data-testid={`action-card-${index}`}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 p-2 rounded-md bg-muted/50">
                {getActionIcon(action.type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium">{action.title}</p>
                  <Badge 
                    variant="outline" 
                    className={`text-xs ${getPriorityStyle(action.priority)}`}
                  >
                    {action.priority}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{action.description}</p>
                {action.dueInfo && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {action.dueInfo}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <Link href={action.actionUrl}>
                <Button size="sm" data-testid={`action-button-${index}`}>
                  {action.actionLabel}
                </Button>
              </Link>
            </div>
          </div>
        ))}
        {actions.length > 5 && (
          <p className="text-center text-sm text-muted-foreground py-2">
            +{actions.length - 5} more actions
          </p>
        )}
      </CardContent>
    </Card>
  );
}
