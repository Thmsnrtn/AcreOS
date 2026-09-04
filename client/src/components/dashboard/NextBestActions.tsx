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
      return <Phone className="w-4 h-4" aria-hidden="true" />;
    case "send_mail":
      return <Mail className="w-4 h-4" aria-hidden="true" />;
    case "review_offer":
      return <FileText className="w-4 h-4" aria-hidden="true" />;
    case "schedule_call":
      return <Calendar className="w-4 h-4" aria-hidden="true" />;
    default:
      return <Clock className="w-4 h-4" aria-hidden="true" />;
  }
}

function getPriorityStyle(priority: string) {
  switch (priority) {
    case "high":
      return "bg-acr-neg-soft text-acr-neg-soft-ink dark:bg-acr-neg-soft/30 dark:text-acr-neg-soft-ink border-acr-neg-soft dark:border-acr-neg-soft";
    case "medium":
      return "bg-acr-warn-soft text-acr-warn-soft-ink dark:bg-acr-warn-soft/30 dark:text-acr-warn-soft-ink border-acr-warn-soft dark:border-acr-warn-soft";
    default:
      return "bg-acr-accent text-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent border-acr-accent dark:border-acr-accent";
  }
}

export function NextBestActions({ actions, isLoading }: NextBestActionsProps) {
  if (isLoading) {
    return (
      <Card 
        className="relative overflow-visible bg-gradient-to-br from-acr-pos/50 to-acr-pos/30 dark:from-acr-pos/20 dark:to-acr-pos/10"
        data-testid="dashboard-next-actions"
      >
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Lightbulb className="w-5 h-5 text-acr-pos" aria-hidden="true" />
            Next best actions
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
        className="relative overflow-visible bg-gradient-to-br from-acr-pos/50 to-acr-pos/30 dark:from-acr-pos/20 dark:to-acr-pos/10"
        data-testid="dashboard-next-actions"
      >
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Lightbulb className="w-5 h-5 text-acr-pos" aria-hidden="true" />
            Next best actions
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
      className="relative overflow-visible bg-gradient-to-br from-acr-pos/50 to-acr-pos/30 dark:from-acr-pos/20 dark:to-acr-pos/10"
      data-testid="dashboard-next-actions"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Lightbulb className="w-5 h-5 text-acr-pos" aria-hidden="true" />
          Next best actions
          <Badge variant="outline" className="ml-2 text-xs tabular-nums">
            {actions.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul aria-label="Recommended actions" className="space-y-3 list-none p-0 m-0">
          {actions.slice(0, 5).map((action, index) => (
            <li
              key={action.id}
              className="p-3 rounded-md bg-background/60 border border-border/50"
              data-testid={`action-card-${index}`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 p-2 rounded-md bg-muted/50" aria-hidden="true">
                  {getActionIcon(action.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{action.title}</p>
                    <Badge
                      variant="outline"
                      className={`text-xs ${getPriorityStyle(action.priority)}`}
                      aria-label={`${action.priority} priority`}
                    >
                      {action.priority}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{action.description}</p>
                  {action.dueInfo && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Clock className="w-3 h-3" aria-hidden="true" />
                      {action.dueInfo}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <Button asChild size="sm" data-testid={`action-button-${index}`}>
                  <Link href={action.actionUrl} aria-label={`${action.actionLabel}: ${action.title}`}>
                    {action.actionLabel}
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {actions.length > 5 && (
          <p className="text-center text-sm text-muted-foreground py-2">
            +{actions.length - 5} more actions
          </p>
        )}
      </CardContent>
    </Card>
  );
}
