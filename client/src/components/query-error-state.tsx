import { AlertCircle, RefreshCw, WifiOff, ServerCrash, Database, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { motion } from "framer-motion";

type ErrorType = "network" | "server" | "auth" | "notFound" | "generic";

interface QueryErrorStateProps {
  error: Error | null;
  onRetry?: () => void;
  isRetrying?: boolean;
  title?: string;
  description?: string;
  className?: string;
  compact?: boolean;
  testId?: string;
}

function getErrorType(error: Error | null): ErrorType {
  if (!error) return "generic";
  
  const message = error.message.toLowerCase();
  
  if (message.includes("network") || message.includes("fetch") || message.includes("failed to fetch")) {
    return "network";
  }
  if (message.includes("401") || message.includes("403") || message.includes("unauthorized") || message.includes("forbidden")) {
    return "auth";
  }
  if (message.includes("404") || message.includes("not found")) {
    return "notFound";
  }
  if (message.includes("500") || message.includes("502") || message.includes("503") || message.includes("server")) {
    return "server";
  }
  
  return "generic";
}

function getErrorConfig(type: ErrorType, error: Error | null) {
  switch (type) {
    case "network":
      return {
        icon: WifiOff,
        title: "Connection Problem",
        description: "Unable to connect to the server. Please check your internet connection and try again.",
        iconColor: "text-yellow-600",
        bgColor: "from-yellow-500/20 to-yellow-500/5",
      };
    case "server":
      return {
        icon: ServerCrash,
        title: "Server Error",
        description: "Our servers are experiencing issues. Please try again in a moment.",
        iconColor: "text-red-600",
        bgColor: "from-red-500/20 to-red-500/5",
      };
    case "auth":
      return {
        icon: Shield,
        title: "Authentication Required",
        description: "Your session may have expired. Please sign in again to continue.",
        iconColor: "text-orange-600",
        bgColor: "from-orange-500/20 to-orange-500/5",
      };
    case "notFound":
      return {
        icon: Database,
        title: "Data Not Found",
        description: "The requested data could not be found. It may have been moved or deleted.",
        iconColor: "text-slate-600",
        bgColor: "from-slate-500/20 to-slate-500/5",
      };
    default:
      return {
        icon: AlertCircle,
        title: "Something Went Wrong",
        description: error?.message || "An unexpected error occurred. Please try again.",
        iconColor: "text-destructive",
        bgColor: "from-destructive/20 to-destructive/5",
      };
  }
}

export function QueryErrorState({
  error,
  onRetry,
  isRetrying = false,
  title,
  description,
  className = "",
  compact = false,
  testId = "query-error-state",
}: QueryErrorStateProps) {
  const errorType = getErrorType(error);
  const config = getErrorConfig(errorType, error);
  const Icon = config.icon;

  if (compact) {
    return (
      <Card className={`border-destructive/30 ${className}`} data-testid={testId}>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full bg-gradient-to-br ${config.bgColor}`}>
              <Icon className={`w-5 h-5 ${config.iconColor}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium" data-testid={`${testId}-title`}>
                {title || config.title}
              </p>
              <p className="text-xs text-muted-foreground truncate" data-testid={`${testId}-description`}>
                {description || config.description}
              </p>
            </div>
            {onRetry && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                disabled={isRetrying}
                className="shrink-0"
                data-testid={`${testId}-retry-button`}
              >
                <RefreshCw className={`w-4 h-4 ${isRetrying ? "animate-spin" : ""}`} />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`flex flex-col items-center justify-center py-12 px-4 ${className}`}
      data-testid={testId}
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
        className={`w-20 h-20 rounded-full bg-gradient-to-br ${config.bgColor} flex items-center justify-center mb-6`}
      >
        <Icon className={`w-10 h-10 ${config.iconColor}`} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="text-center max-w-md"
      >
        <h3 className="text-xl font-semibold mb-2" data-testid={`${testId}-title`}>
          {title || config.title}
        </h3>
        <p className="text-muted-foreground mb-6" data-testid={`${testId}-description`}>
          {description || config.description}
        </p>

        {onRetry && (
          <Button
            onClick={onRetry}
            disabled={isRetrying}
            className="min-h-[44px] md:min-h-9"
            data-testid={`${testId}-retry-button`}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRetrying ? "animate-spin" : ""}`} />
            {isRetrying ? "Retrying..." : "Try Again"}
          </Button>
        )}

        {import.meta.env.DEV && error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-6 p-3 rounded-lg bg-muted/50 text-left"
            data-testid={`${testId}-debug`}
          >
            <p className="text-xs font-mono text-muted-foreground break-all">
              <span className="font-semibold text-foreground">Debug:</span> {error.message}
            </p>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}
