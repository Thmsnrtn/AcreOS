import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function InlineError({ message, onRetry, testId }: { message: string; onRetry?: () => void; testId?: string }) {
  return (
    <div className="p-3 border rounded-md bg-destructive/5 border-destructive/30 flex items-center justify-between" data-testid={testId || "inline-error"}>
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="w-4 h-4" />
        <span className="text-sm">{message}</span>
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry} data-testid="button-inline-retry">
          <RefreshCw className="w-4 h-4 mr-2" /> Retry
        </Button>
      )}
    </div>
  );
}