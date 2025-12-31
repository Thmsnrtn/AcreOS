import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function AuthPage() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4">
      <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1500382017468-9049fed747ef?q=80&w=2500&auto=format&fit=crop')] opacity-10 bg-cover bg-center mix-blend-overlay" />
      
      <Card className="w-full max-w-md relative z-10 border-white/10 bg-black/40 backdrop-blur-xl shadow-2xl">
        <CardContent className="p-8 text-center space-y-6">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent mb-2">
              Dirt Rich AI
            </h1>
            <p className="text-slate-300 text-lg">
              Automate your land investing empire.
            </p>
          </div>

          <div className="space-y-4 pt-4">
            <Button 
              size="lg" 
              className="w-full bg-white text-slate-900 hover:bg-slate-100 font-bold"
              onClick={handleLogin}
            >
              Sign In with Replit
            </Button>
            <p className="text-xs text-slate-400">
              Secure authentication powered by Replit.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
