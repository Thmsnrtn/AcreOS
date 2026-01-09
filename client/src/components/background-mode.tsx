import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Action, ActionResult, ActionExecutor } from "@/lib/action-executor";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface BackgroundModeProps {
  actions: Action[];
  taskName: string;
  onComplete?: (results: ActionResult[]) => void;
  onError?: (error: string) => void;
  isActive: boolean;
}

export function BackgroundMode({ 
  actions, 
  taskName, 
  onComplete, 
  onError,
  isActive 
}: BackgroundModeProps) {
  const [progress, setProgress] = useState(0);
  const [isExecuting, setIsExecuting] = useState(false);
  const executorRef = useRef<ActionExecutor | null>(null);
  const { toast } = useToast();

  const handleActionComplete = useCallback((result: ActionResult) => {
    const idx = actions.findIndex(a => a.id === result.action.id);
    if (idx !== -1) {
      setProgress(((idx + 1) / actions.length) * 100);
    }
  }, [actions]);

  useEffect(() => {
    if (!isActive || actions.length === 0) return;

    const executor = new ActionExecutor({
      speed: 2,
      onActionComplete: handleActionComplete,
    });

    executorRef.current = executor;
    setIsExecuting(true);
    setProgress(0);

    toast({
      title: "Task Started",
      description: `Running: ${taskName}`,
      duration: 3000,
    });

    executor.executeActions(actions).then((results) => {
      setIsExecuting(false);
      
      const failed = results.find(r => !r.success);
      
      if (failed) {
        toast({
          title: "Task Failed",
          description: failed.error || "An error occurred during execution",
          variant: "destructive",
          duration: 5000,
        });
        onError?.(failed.error || "Unknown error");
      } else {
        toast({
          title: "Task Completed",
          description: `Successfully completed: ${taskName}`,
          duration: 3000,
        });
        onComplete?.(results);
      }
    });

    return () => {
      executor.cancel();
    };
  }, [isActive, actions, taskName, handleActionComplete, onComplete, onError, toast]);

  if (!isActive || !isExecuting) return null;

  return (
    <div
      className={cn(
        "fixed bottom-24 right-6 z-[9999]",
        "bg-background/95 backdrop-blur-md",
        "border border-border rounded-xl shadow-lg",
        "p-3 min-w-[200px] max-w-[280px]"
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        <span className="text-sm font-medium truncate">{taskName}</span>
      </div>
      
      <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
        <div 
          className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      
      <div className="flex justify-between mt-1.5">
        <span className="text-xs text-muted-foreground">Running in background</span>
        <span className="text-xs text-muted-foreground">{Math.round(progress)}%</span>
      </div>
    </div>
  );
}

interface BackgroundTaskNotificationProps {
  type: "success" | "error" | "progress";
  title: string;
  description?: string;
  progress?: number;
}

export function BackgroundTaskNotification({
  type,
  title,
  description,
  progress,
}: BackgroundTaskNotificationProps) {
  const Icon = type === "success" 
    ? CheckCircle2 
    : type === "error" 
    ? XCircle 
    : Loader2;
  
  const iconColor = type === "success" 
    ? "text-green-500" 
    : type === "error" 
    ? "text-destructive" 
    : "text-primary";

  return (
    <div
      className={cn(
        "fixed bottom-24 right-6 z-[9999]",
        "bg-background/95 backdrop-blur-md",
        "border border-border rounded-xl shadow-lg",
        "p-3 min-w-[200px] max-w-[280px]",
        "animate-in slide-in-from-right-4 fade-in duration-200"
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className={cn("w-5 h-5 mt-0.5 shrink-0", iconColor, type === "progress" && "animate-spin")} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{title}</p>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
          {type === "progress" && typeof progress === "number" && (
            <div className="mt-2">
              <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
                <div 
                  className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground mt-1">{Math.round(progress)}%</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
