import { useAuth } from "@/hooks/use-auth";
import { Redirect, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Moon, Sun, RefreshCw, AlertCircle, CheckCircle } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useTheme } from "@/contexts/theme-context";
import { getRandomImage } from "@/lib/aerial-images";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Mode = "login" | "register" | "forgot" | "reset";

function getInitialMode(): Mode {
  const params = new URLSearchParams(window.location.search);
  if (params.get("mode") === "reset" && params.get("token")) return "reset";
  if (params.get("mode") === "register") return "register";
  return "login";
}

function getResetToken(): string {
  return new URLSearchParams(window.location.search).get("token") || "";
}

export default function AuthPage() {
  const { user, isLoading, login, register, loginError, registerError, isLoggingIn, isRegistering } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>(getInitialMode);
  const [imageUrl, setImageUrl] = useState<string>("");
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const refreshImage = useCallback(() => {
    setImageLoaded(false);
    setImageError(false);
    setImageUrl(getRandomImage());
  }, []);

  useEffect(() => {
    setImageUrl(getRandomImage());
  }, []);

  const forgotMutation = useMutation({
    mutationFn: (data: { email: string }) =>
      apiRequest("POST", "/api/auth/forgot-password", data).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Check your email", description: "If that address is registered, a reset link is on its way." });
      setMode("login");
    },
    onError: () => {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: (data: { token: string; password: string }) =>
      apiRequest("POST", "/api/auth/reset-password", data).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "Password updated", description: "You can now sign in with your new password." });
      window.history.replaceState({}, "", "/auth");
      setMode("login");
    },
    onError: (err: any) => {
      toast({ title: "Reset failed", description: err?.message || "This link may be invalid or expired.", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background desert-gradient">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (user) {
    return <Redirect to="/" />;
  }

  const handleLoginRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "login") {
      login({ email, password });
    } else {
      const referralCode = localStorage.getItem("acreos_ref") || undefined;
      register({ email, password, firstName, lastName, agreedToTerms, referralCode });
    }
  };

  const handleForgotSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    forgotMutation.mutate({ email });
  };

  const handleResetSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    resetMutation.mutate({ token: getResetToken(), password: newPassword });
  };

  const error = mode === "login" ? loginError : mode === "register" ? registerError : null;
  const isPending = mode === "login" ? isLoggingIn : mode === "register" ? isRegistering : false;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-950 to-slate-800" />
      {imageUrl && !imageError && (
        <img
          src={imageUrl}
          alt="Aerial landscape"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${
            imageLoaded ? "opacity-100" : "opacity-0"
          }`}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
          data-testid="image-aerial-background"
        />
      )}
      {!imageLoaded && !imageError && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-white/50" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/40 to-black/20" />

      <div className="absolute top-4 right-4 z-20 flex gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={refreshImage}
          className="bg-black/30 backdrop-blur-sm border border-white/20 text-white hover:bg-white/20"
          data-testid="button-refresh-image"
          title="Load new image"
        >
          <RefreshCw className="w-5 h-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="bg-black/30 backdrop-blur-sm border border-white/20 text-white hover:bg-white/20"
          data-testid="button-theme-toggle-auth"
        >
          {theme === "dark" ? (
            <Sun className="w-5 h-5" />
          ) : (
            <Moon className="w-5 h-5" />
          )}
        </Button>
      </div>

      <Card className="w-full max-w-md relative z-10 floating-window border-white/20 bg-black/40 backdrop-blur-2xl">
        <CardContent className="p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent mb-2">
              AcreOS
            </h1>
            <p className="text-white/80 text-lg">
              {mode === "forgot"
                ? "Reset your password"
                : mode === "reset"
                ? "Choose a new password"
                : "An Operating System for Land Investors"}
            </p>
          </div>

          {error && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-md p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-200">{(error as any)?.message || "Something went wrong"}</p>
            </div>
          )}

          {/* ── Login / Register form ── */}
          {(mode === "login" || mode === "register") && (
            <form onSubmit={handleLoginRegisterSubmit} className="space-y-4">
              {mode === "register" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="firstName" className="text-white/70 text-sm">First Name</Label>
                    <Input
                      id="firstName"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="John"
                      className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lastName" className="text-white/70 text-sm">Last Name</Label>
                    <Input
                      id="lastName"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Doe"
                      className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-white/70 text-sm">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                  autoComplete="email"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-white/70 text-sm">Password</Label>
                  {mode === "login" && (
                    <button
                      type="button"
                      onClick={() => setMode("forgot")}
                      className="text-xs text-white/50 hover:text-primary hover:underline"
                      data-testid="link-forgot-password"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "register" ? "At least 8 characters" : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
                  minLength={mode === "register" ? 8 : undefined}
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                />
              </div>

              {mode === "register" && (
                <div className="flex items-start gap-2.5 pt-1">
                  <Checkbox
                    id="terms"
                    checked={agreedToTerms}
                    onCheckedChange={(v) => setAgreedToTerms(!!v)}
                    className="mt-0.5 border-white/40 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    data-testid="checkbox-terms"
                  />
                  <Label htmlFor="terms" className="text-sm text-white/60 leading-relaxed cursor-pointer">
                    I agree to the{" "}
                    <Link href="/terms" className="text-primary hover:underline">
                      Terms of Service
                    </Link>{" "}
                    and{" "}
                    <Link href="/privacy" className="text-primary hover:underline">
                      Privacy Policy
                    </Link>
                  </Label>
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                className="w-full font-bold"
                disabled={isPending || (mode === "register" && !agreedToTerms)}
                data-testid="button-auth-submit"
              >
                {isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                {mode === "login" ? "Sign In" : "Create Account"}
              </Button>
            </form>
          )}

          {/* ── Forgot password form ── */}
          {mode === "forgot" && (
            <form onSubmit={handleForgotSubmit} className="space-y-4">
              <p className="text-sm text-white/60">
                Enter your email and we'll send you a link to reset your password.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="forgot-email" className="text-white/70 text-sm">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                  autoComplete="email"
                />
              </div>
              <Button
                type="submit"
                size="lg"
                className="w-full font-bold"
                disabled={forgotMutation.isPending}
                data-testid="button-send-reset"
              >
                {forgotMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Send Reset Link
              </Button>
            </form>
          )}

          {/* ── Reset password form ── */}
          {mode === "reset" && (
            <form onSubmit={handleResetSubmit} className="space-y-4">
              <p className="text-sm text-white/60">Enter your new password below.</p>
              <div className="space-y-1.5">
                <Label htmlFor="new-password" className="text-white/70 text-sm">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                  autoComplete="new-password"
                />
              </div>
              <Button
                type="submit"
                size="lg"
                className="w-full font-bold"
                disabled={resetMutation.isPending}
                data-testid="button-reset-password"
              >
                {resetMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Set New Password
              </Button>
            </form>
          )}

          {/* ── Mode toggle links ── */}
          <div className="text-center space-y-2">
            {mode === "login" && (
              <p className="text-sm text-white/50">
                Don't have an account?{" "}
                <button
                  type="button"
                  onClick={() => setMode("register")}
                  className="text-primary hover:underline font-medium"
                >
                  Sign up
                </button>
              </p>
            )}
            {mode === "register" && (
              <p className="text-sm text-white/50">
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className="text-primary hover:underline font-medium"
                >
                  Sign in
                </button>
              </p>
            )}
            {(mode === "forgot" || mode === "reset") && (
              <button
                type="button"
                onClick={() => setMode("login")}
                className="text-sm text-white/50 hover:text-primary hover:underline"
              >
                Back to sign in
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
