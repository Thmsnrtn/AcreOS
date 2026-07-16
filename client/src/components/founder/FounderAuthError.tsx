/**
 * FounderAuthError — the honest failure state for a founder door whose data
 * call was rejected by the server (401).
 *
 * The old behavior was a blank page or a cryptic "Failed to load … (401)".
 * That hid a real, fixable production condition: the SPA is signed in (client
 * Clerk is fine) but the SERVER can't verify the session — usually a missing
 * or malformed CLERK_JWT_KEY on the proxy-fallback path, or a live-vs-test
 * key mismatch. See server/services/authConfigDiagnostic.ts.
 *
 * For a NON-auth error this delegates to the standard QueryErrorState so
 * callers can use it as a drop-in. For an auth error it:
 *   1. says plainly that the session couldn't be verified,
 *   2. offers the two real fixes — retry, and sign out + back in (clears a
 *      stale cookie, the most common cause), and
 *   3. pulls the secret-free /api/health/auth-config diagnostic and, when it
 *      names a likely cause, shows the exact Fly secret to fix.
 */
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, RefreshCw, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { QueryErrorState } from "@/components/query-error-state";
import { useAuth } from "@/hooks/use-auth";

interface AuthConfigResponse {
  available: boolean;
  likelyCause?:
    | "none"
    | "secret_key_missing"
    | "mode_mismatch"
    | "jwt_key_missing"
    | "jwt_key_malformed";
  hint?: string;
}

function isAuthError(error: Error | null): boolean {
  if (!error) return false;
  const m = error.message.toLowerCase();
  return m.includes("401") || m.includes("unauthorized") || m.includes("no valid session");
}

interface FounderAuthErrorProps {
  error: Error | null;
  onRetry?: () => void;
  isRetrying?: boolean;
  /** Title for the non-auth (delegated) path. */
  title?: string;
  testId?: string;
}

export function FounderAuthError({
  error,
  onRetry,
  isRetrying = false,
  title,
  testId = "founder-auth-error",
}: FounderAuthErrorProps) {
  const { logout } = useAuth();

  // Only fetch the diagnostic when we're actually staring at an auth failure.
  const diag = useQuery<AuthConfigResponse>({
    queryKey: ["/api/health/auth-config"],
    queryFn: async () => {
      const res = await fetch("/api/health/auth-config", { credentials: "include" });
      if (!res.ok) throw new Error(`auth-config ${res.status}`);
      return res.json();
    },
    enabled: isAuthError(error),
    staleTime: 30_000,
    retry: false,
  });

  if (!isAuthError(error)) {
    return (
      <QueryErrorState error={error} onRetry={onRetry} isRetrying={isRetrying} title={title} />
    );
  }

  const cause = diag.data?.available ? diag.data.likelyCause : undefined;
  const hint = diag.data?.available ? diag.data.hint : undefined;
  const hasActionableCause = Boolean(cause && cause !== "none" && hint);

  return (
    <Card
      className="border-acr-warn/40 bg-acr-warn-soft/40 max-w-xl mx-auto"
      data-testid={testId}
      role="alert"
      aria-live="assertive"
    >
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 rounded-full bg-acr-warn/15 p-2" aria-hidden="true">
            <ShieldAlert className="h-5 w-5 text-acr-warn" />
          </span>
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-foreground" data-testid={`${testId}-title`}>
              We couldn't verify your session
            </h3>
            <p className="text-sm text-muted-foreground" data-testid={`${testId}-body`}>
              You're signed in on this device, but the server rejected the request. Your data is
              safe — nothing was lost. Try again, or sign out and back in to refresh the session.
            </p>
          </div>
        </div>

        {hasActionableCause && (
          <div
            className="rounded-card border border-acr-warn/30 bg-background/60 p-3 text-xs text-muted-foreground"
            data-testid={`${testId}-diagnostic`}
          >
            <span className="font-semibold text-foreground">Likely cause:</span> {hint}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {onRetry && (
            <Button
              onClick={onRetry}
              disabled={isRetrying}
              className="min-h-[44px] pointer-fine:md:min-h-9"
              data-testid={`${testId}-retry`}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${isRetrying ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {isRetrying ? "Retrying…" : "Try again"}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => void logout()}
            className="min-h-[44px] pointer-fine:md:min-h-9"
            data-testid={`${testId}-signout`}
          >
            <LogOut className="h-4 w-4 mr-2" aria-hidden="true" />
            Sign out &amp; back in
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
