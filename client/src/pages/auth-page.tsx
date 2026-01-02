import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, AlertTriangle } from "lucide-react";
import { useMemo } from "react";

export default function AuthPage() {
  const { user, isLoading } = useAuth();
  
  const isSafari = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium');
  }, []);

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

  const handleLogin = () => {
    window.location.href = "/api/login";
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-[#8B4513] via-[#A0522D] to-[#CD853F]" />
      <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1500382017468-9049fed747ef?q=80&w=2500&auto=format&fit=crop')] opacity-20 bg-cover bg-center mix-blend-overlay" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
      
      <Card className="w-full max-w-md relative z-10 floating-window border-white/20 bg-black/40 backdrop-blur-2xl">
        <CardContent className="p-8 text-center space-y-6">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent mb-2">
              AcreOS
            </h1>
            <p className="text-white/80 text-lg">
              The Operating System for Land Investors.
            </p>
          </div>

          {isSafari && (
            <div className="bg-amber-500/20 border border-amber-500/50 rounded-md p-3 text-left">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-200">Safari Not Supported</p>
                  <p className="text-xs text-amber-200/70 mt-1">
                    Due to a known issue with Replit authentication in Safari, please use Chrome, Firefox, or Edge to sign in.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4 pt-4">
            <Button 
              size="lg" 
              className="w-full font-bold"
              onClick={handleLogin}
              data-testid="button-login"
              disabled={isSafari}
            >
              Sign In with Replit
            </Button>
            <p className="text-xs text-white/50">
              Secure authentication powered by Replit.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
