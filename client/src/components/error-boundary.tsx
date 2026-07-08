import { Component, type ReactNode } from "react";
import { RefreshCcw } from "lucide-react";
import { Sentry } from "@/lib/sentry";
import { ServerErrorPage } from "@/pages/coverage-page";
import { clientLogger } from "@/lib/clientLogger";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  // F-D12: when this value changes (typically wouter's `location`), the
  // boundary clears its error state so a crash on one page doesn't trap
  // the user on the 500 page for every subsequent navigation.
  resetKey?: string;
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

  // Forward to Solene's customer-surface trip ledger (fire-and-forget).
  // Surfaces in GET /api/founder/error-boundary-trips/recent + Solene's
  // morning-brief / daily-pulse aggregator. Failures here are swallowed —
  // the boundary's primary job is to render the fallback UI, not block on
  // telemetry. See server/services/customer-surface/errorBoundaryAggregator.ts.
  try {
    const routePath =
      typeof window !== "undefined" ? window.location.pathname : "/";
    const viewport =
      typeof window !== "undefined"
        ? { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }
        : null;
    void fetch("/api/client/error-boundary-trip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
      body: JSON.stringify({
        errorId,
        errorName: error.name || "Error",
        errorMessageExcerpt: (error.message || "").slice(0, 500),
        routePath,
        componentStackExcerpt: (errorInfo.componentStack || "").slice(0, 2000),
        clientMeta: {
          userAgent: errorReport.userAgent,
          url: errorReport.url,
          viewport,
        },
      }),
    }).catch(() => {
      // Fired-and-forget — boundary already logged via clientLogger + Sentry.
    });
  } catch {
    // window/fetch unavailable in SSR / test envs — swallow silently.
  }

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
    // F-D17: chunk-load failures (post-deploy stale lazy imports) surface
    // as React render-time errors and get caught here BEFORE the global
    // unhandledrejection listener in main.tsx can act on them. Reload once
    // per 10s window so a real user mid-deploy gets the new bundle instead
    // of being trapped on the 500 page.
    const msg = String(error?.message || "");
    if (/Failed to fetch dynamically imported module|Loading (?:CSS )?chunk|Importing a module script failed|MIME type of "text\/html"/i.test(msg)) {
      try {
        const key = "acreos:chunk-reloaded-at";
        const last = Number(sessionStorage.getItem(key) || 0);
        if (Date.now() - last > 10_000) {
          sessionStorage.setItem(key, String(Date.now()));
          window.location.reload();
          return;
        }
      } catch { /* sessionStorage unavailable — fall through to normal error UI */ }
    }

    const errorId = logErrorToService(error, errorInfo);
    this.setState({ errorId });

    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  componentDidUpdate(prevProps: Props) {
    // F-D12: route changed (resetKey moved) → clear the trapped error so
    // the next page renders normally. Without this, a single page crash
    // shows the 500 page on every route until the user hard-refreshes.
    if (this.state.hasError && this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false, error: null, errorId: null });
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
                  className="mt-2 inline-flex min-h-11 items-center gap-1 px-2 -mx-2 -my-2 underline-offset-2 hover:underline active:opacity-70"
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
