import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function ResetPasswordPage() {
  useDocumentTitle("Set new password");
  const [, setLocation] = useLocation();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (t) setToken(t);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("The two passwords don't match. Please retype them.");
      return;
    }
    if (password.length < 8) {
      setError("Your new password must be at least 8 characters.");
      return;
    }

    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/auth/reset-password", { token, password });
      setSuccess(true);
      setTimeout(() => setLocation("/auth"), 3000);
    } catch (err: any) {
      setError(err?.message || "We couldn't reset your password. This link may have expired — request a new one.");
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center space-y-4" role="alert">
            <AlertCircle className="w-12 h-12 text-destructive mx-auto" aria-hidden="true" />
            <h1 className="text-xl font-bold">Invalid reset link</h1>
            <p className="text-muted-foreground text-sm">
              This password reset link is missing a token. It may have been copied incorrectly or expired.
            </p>
            <Button asChild variant="outline" className="min-h-11">
              <Link href="/forgot-password">Request new link</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md">
        <CardContent className="p-8 space-y-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">Set new password</h1>
            <p className="text-muted-foreground text-sm">
              Enter your new password below.
            </p>
          </div>

          {success ? (
            <div className="flex flex-col items-center gap-3 py-4" role="status" aria-live="polite">
              <CheckCircle className="w-12 h-12 text-emerald-500" aria-hidden="true" />
              <p className="text-center text-sm text-muted-foreground">
                Password reset successful. Redirecting to sign in…
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <p
                  id="reset-error"
                  className="text-sm text-destructive bg-destructive/10 rounded p-2"
                  role="alert"
                >
                  {error}
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  minLength={8}
                  autoComplete="new-password"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "reset-error" : undefined}
                  data-testid="input-new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input
                  id="confirm"
                  type="password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Retype your new password"
                  minLength={8}
                  autoComplete="new-password"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "reset-error" : undefined}
                  data-testid="input-confirm-password"
                />
              </div>
              <Button
                type="submit"
                className="w-full min-h-11"
                disabled={isLoading}
                data-testid="button-reset-submit"
              >
                {isLoading && <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" />}
                Reset password
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
