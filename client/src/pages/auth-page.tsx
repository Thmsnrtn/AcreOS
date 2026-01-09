import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, AlertTriangle, Moon, Sun, RefreshCw } from "lucide-react";
import { useMemo, useState, useEffect, useCallback } from "react";
import { useTheme } from "@/contexts/theme-context";

import earth1 from "@assets/stock_images/aerial_view_earth_la_ebbb258b.jpg";
import earth2 from "@assets/stock_images/aerial_view_earth_la_61c8b979.jpg";
import earth3 from "@assets/stock_images/aerial_view_earth_la_d6daf7fc.jpg";
import earth4 from "@assets/stock_images/aerial_view_earth_la_e6027f79.jpg";
import earth5 from "@assets/stock_images/aerial_view_earth_la_1032d15d.jpg";
import coast1 from "@assets/stock_images/aerial_view_coastlin_7795e651.jpg";
import coast2 from "@assets/stock_images/aerial_view_coastlin_b90c3dc1.jpg";
import coast3 from "@assets/stock_images/aerial_view_coastlin_c6b40269.jpg";
import coast4 from "@assets/stock_images/aerial_view_coastlin_e0e1413a.jpg";
import coast5 from "@assets/stock_images/aerial_view_coastlin_e5546ed2.jpg";
import farm1 from "@assets/stock_images/aerial_view_farmland_488b10bb.jpg";
import farm2 from "@assets/stock_images/aerial_view_farmland_7a839a84.jpg";
import farm3 from "@assets/stock_images/aerial_view_farmland_dd0949a9.jpg";
import farm4 from "@assets/stock_images/aerial_view_farmland_7eb11372.jpg";
import farm5 from "@assets/stock_images/aerial_view_farmland_be764c5d.jpg";
import river1 from "@assets/stock_images/aerial_view_river_de_2bfec7d9.jpg";
import river2 from "@assets/stock_images/aerial_view_river_de_40f28854.jpg";
import river3 from "@assets/stock_images/aerial_view_river_de_ac8981ce.jpg";
import river4 from "@assets/stock_images/aerial_view_river_de_f5ebb64d.jpg";
import river5 from "@assets/stock_images/aerial_view_river_de_a2bbef0b.jpg";
import forest1 from "@assets/stock_images/aerial_view_forest_w_acbc4b43.jpg";
import forest2 from "@assets/stock_images/aerial_view_forest_w_20580d10.jpg";
import forest3 from "@assets/stock_images/aerial_view_forest_w_88e7e04f.jpg";
import forest4 from "@assets/stock_images/aerial_view_forest_w_403b4f9f.jpg";
import forest5 from "@assets/stock_images/aerial_view_forest_w_04e65f84.jpg";

const AERIAL_IMAGES = [
  earth1, earth2, earth3, earth4, earth5,
  coast1, coast2, coast3, coast4, coast5,
  farm1, farm2, farm3, farm4, farm5,
  river1, river2, river3, river4, river5,
  forest1, forest2, forest3, forest4, forest5,
];

const getRandomImage = () => {
  return AERIAL_IMAGES[Math.floor(Math.random() * AERIAL_IMAGES.length)];
};

export default function AuthPage() {
  const { user, isLoading } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [imageUrl, setImageUrl] = useState<string>("");
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  
  const isSafari = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium');
  }, []);

  const refreshImage = useCallback(() => {
    setImageLoaded(false);
    setImageError(false);
    setImageUrl(getRandomImage());
  }, []);

  useEffect(() => {
    setImageUrl(getRandomImage());
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
          data-testid="button-refresh-earth-view"
          title="Load new Earth View"
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
        <CardContent className="p-8 text-center space-y-6">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent mb-2">
              AcreOS
            </h1>
            <p className="text-white/80 text-lg">
              An Operating System for Land Investors
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
