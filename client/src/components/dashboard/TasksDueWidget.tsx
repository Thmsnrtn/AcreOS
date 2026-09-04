import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  CheckCircle2, 
  Clock, 
  AlertTriangle,
  ListTodo,
  ArrowRight,
  Loader2
} from "lucide-react";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Task } from "@shared/schema";
import { relative } from "@/lib/format";

interface TasksDashboardSummary {
  overdue: Task[];
  dueToday: Task[];
  overdueCount: number;
  dueTodayCount: number;
}

const priorityStyles: Record<string, string> = {
  urgent: "bg-acr-neg-soft text-acr-neg-soft-ink dark:bg-acr-neg-soft/30 dark:text-acr-neg-soft-ink",
  high: "bg-acr-warn-soft text-acr-warn-soft-ink dark:bg-acr-warn-soft/30 dark:text-acr-warn-soft-ink",
  medium: "bg-acr-accent text-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent",
  low: "bg-muted text-foreground dark:bg-acr-bg-sunken dark:text-muted-foreground",
};

/**
 * The linked-entity detail route for a task. Naive `/${type}s/${id}`
 * produced "/propertys/:id" (mis-pluralized AND wrong base — the parcel
 * detail route is /parcels/:id). Map each entity type to its real route;
 * unknown types get no link rather than a 404.
 */
function entityHref(entityType: string, entityId: string | number): string | null {
  switch (entityType) {
    case "property":
      return `/parcels/${entityId}`;
    case "lead":
      return `/leads/${entityId}`;
    case "deal":
      return `/deals/${entityId}`;
    default:
      return null;
  }
}

function TaskItem({ task, onComplete, isCompleting }: {
  task: Task;
  onComplete: (id: number) => void;
  isCompleting: boolean;
}) {
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date(new Date().setHours(0, 0, 0, 0));

  return (
    <li
      className="flex items-center justify-between p-3 rounded-md bg-muted/50 hover:bg-muted/80 transition-colors"
      data-testid={`task-item-${task.id}`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          onClick={() => onComplete(task.id)}
          disabled={isCompleting}
          aria-busy={isCompleting}
          aria-label={`Complete task: ${task.title}`}
          data-testid={`complete-task-${task.id}`}
        >
          {isCompleting ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-muted-foreground hover:text-acr-pos" aria-hidden="true" />
          )}
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{task.title}</p>
          {task.dueDate && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" aria-hidden="true" />
              {isOverdue ? (
                <span className="text-acr-neg dark:text-acr-neg">
                  {relative(task.dueDate)}
                </span>
              ) : (
                relative(task.dueDate)
              )}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge
          variant="outline"
          className={`text-xs border-0 ${priorityStyles[task.priority] || priorityStyles.medium}`}
        >
          {task.priority}
        </Badge>
        {task.entityType && task.entityType !== "none" && task.entityId &&
          entityHref(task.entityType, task.entityId) && (
          <Button asChild size="icon" variant="ghost" className="h-7 w-7">
            <Link href={entityHref(task.entityType, task.entityId)!} aria-label={`View linked ${task.entityType}`}>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </Button>
        )}
      </div>
    </li>
  );
}

export function TasksDueWidget() {
  const { toast } = useToast();
  
  const { data, isLoading, error } = useQuery<TasksDashboardSummary>({
    queryKey: ["/api/tasks/dashboard-summary"],
    staleTime: 60 * 1000, // 1 minute
  });

  const completeMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/tasks/${id}/complete`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/dashboard-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/today-priorities"] });
      toast({ title: "Task completed", description: "Great job!" });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't mark task complete", description: `${error.message} — the task is still on your list.`, variant: "destructive" });
    },
  });

  // Loading state
  if (isLoading) {
    return (
      <Card className="floating-window" data-testid="tasks-due-widget">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ListTodo className="w-5 h-5 text-primary" aria-hidden="true" />
            Tasks due
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="floating-window border-acr-neg-soft dark:border-acr-neg-soft" data-testid="tasks-due-widget">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ListTodo className="w-5 h-5 text-primary" aria-hidden="true" />
            Tasks due
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p role="alert" className="text-sm text-acr-neg dark:text-acr-neg">
            Failed to load tasks. Please try again.
          </p>
        </CardContent>
      </Card>
    );
  }

  const hasOverdue = data && data.overdue.length > 0;
  const hasDueToday = data && data.dueToday.length > 0;
  const isEmpty = !hasOverdue && !hasDueToday;

  // Empty state
  if (isEmpty) {
    return (
      <Card className="floating-window" data-testid="tasks-due-widget">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ListTodo className="w-5 h-5 text-primary" aria-hidden="true" />
            Tasks due
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <CheckCircle2 className="w-10 h-10 text-acr-pos mb-3" aria-hidden="true" />
            <p className="text-sm font-medium">All caught up!</p>
            <p className="text-xs text-muted-foreground mt-1">No tasks due today or overdue.</p>
            <Button asChild variant="outline" size="sm" className="mt-4">
              <Link href="/tasks">View all tasks</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalCount = (data?.overdueCount || 0) + (data?.dueTodayCount || 0);

  return (
    <Card 
      className={`floating-window ${hasOverdue ? 'border-acr-neg-soft dark:border-acr-neg-soft' : ''}`}
      data-testid="tasks-due-widget"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ListTodo className="w-5 h-5 text-primary" />
          Tasks Due
          <Badge variant="outline" className="ml-2 text-xs tabular-nums" data-testid="tasks-due-count">
            {totalCount}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overdue Section */}
        {hasOverdue && (
          <section aria-labelledby="overdue-heading" data-testid="overdue-section">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-acr-neg" aria-hidden="true" />
              <span id="overdue-heading" className="text-sm font-medium text-acr-neg dark:text-acr-neg">
                Overdue (<span className="tabular-nums">{data.overdueCount}</span>)
              </span>
            </div>
            <ul className="space-y-2 list-none p-0 m-0">
              {data.overdue.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  onComplete={(id) => completeMutation.mutate(id)}
                  isCompleting={completeMutation.isPending && completeMutation.variables === task.id}
                />
              ))}
              {data.overdueCount > 10 && (
                <li className="list-none">
                  <Link href="/tasks?overdue=true" className="block text-center text-sm text-muted-foreground hover:text-foreground py-1">
                    +{data.overdueCount - 10} more overdue
                  </Link>
                </li>
              )}
            </ul>
          </section>
        )}

        {/* Due Today Section */}
        {hasDueToday && (
          <section aria-labelledby="due-today-heading" data-testid="due-today-section">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-acr-warn" aria-hidden="true" />
              <span id="due-today-heading" className="text-sm font-medium">
                Due today (<span className="tabular-nums">{data.dueTodayCount}</span>)
              </span>
            </div>
            <ul className="space-y-2 list-none p-0 m-0">
              {data.dueToday.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  onComplete={(id) => completeMutation.mutate(id)}
                  isCompleting={completeMutation.isPending && completeMutation.variables === task.id}
                />
              ))}
              {data.dueTodayCount > 10 && (
                <li className="list-none">
                  <Link href="/tasks?due_date=today" className="block text-center text-sm text-muted-foreground hover:text-foreground py-1">
                    +{data.dueTodayCount - 10} more today
                  </Link>
                </li>
              )}
            </ul>
          </section>
        )}

        {/* View All Link */}
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href="/tasks">View all tasks</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
