import { Component, type ReactNode } from "react";
import { RefreshCcw } from "lucide-react";
import { Sentry } from "@/lib/sentry";
import { ServerErrorPage } from "@/pages/coverage-page";
import { clientLogger } from "@/lib/clientLogger";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

function logErrorToService(error: Error, errorInfo: React.ErrorInfo): string {
  const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const errorReport = {
    errorId,
    timestamp: new Date().toISOString(),
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    componentStack: errorInfo.componentStack,
    url: typeof window !== "undefined" ? window.location.href : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  };

  clientLogger.error("[ErrorBoundary] Error captured:", errorReport);

  // Forward to Sentry (no-op when VITE_SENTRY_DSN is unset)
  Sentry.captureException(error, {
    extra: {
      errorId,
      componentStack: errorInfo.componentStack,
      url: errorReport.url,
    },
  });

  return errorId;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorId: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const errorId = logErrorToService(error, errorInfo);
    this.setState({ errorId });
    
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleRefresh = () => {
    window.location.reload();
  };

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorId: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Use the homestead-styled ServerErrorPage for consistency with the
      // rest of the coverage pages (404 / 403 / maintenance). Voice per
      // HANDOFF §8: specific, no "Something went wrong."
      // Error ID + message are still shown via a debug strip below the
      // CTAs so engineering can trace incidents.
      return (
        <div data-testid="error-boundary" role="alert" aria-live="assertive">
          <ServerErrorPage onRetry={this.handleRetry} />
          {(this.state.errorId || this.state.error) && (
            <div
              className="max-w-md mx-auto -mt-8 mb-8 px-4"
              data-testid="error-boundary-debug"
            >
              <div
                className="rounded-md p-3 text-xs"
                style={{
                  background: "var(--acr-surface)",
                  border: "0.5px solid var(--acr-line)",
                  color: "var(--acr-ink-3)",
                  fontFamily: "var(--font-mono, monospace)",
                  textAlign: "left",
                }}
              >
                {this.state.errorId && (
                  <div data-testid="text-error-id">
                    <span style={{ fontWeight: 600 }}>Trace</span>:{" "}
                    {this.state.errorId}
                  </div>
                )}
                {this.state.error && (
                  <div className="mt-1 break-all" data-testid="text-error-details">
                    {this.state.error.message}
                  </div>
                )}
                <button
                  type="button"
                  onClick={this.handleRefresh}
                  className="mt-2 inline-flex items-center gap-1 underline-offset-2 hover:underline"
                  data-testid="button-error-refresh"
                  style={{ color: "var(--acr-ink-2)" }}
                >
                  <RefreshCcw className="w-3 h-3" aria-hidden="true" />
                  Hard refresh
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  fallback?: ReactNode
) {
  return function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary fallback={fallback}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  };
}
