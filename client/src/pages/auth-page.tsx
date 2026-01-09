import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, AlertTriangle, Moon, Sun, RefreshCw } from "lucide-react";
import { useMemo, useState, useEffect, useCallback } from "react";
import { useTheme } from "@/contexts/theme-context";

const EARTH_VIEW_IDS = [
  1003, 1004, 1006, 1008, 1012, 1018, 1019, 1028, 1030, 1031,
  1036, 1038, 1040, 1048, 1049, 1054, 1055, 1060, 1065, 1067,
  1069, 1071, 1090, 1096, 1108, 1110, 1116, 1120, 1127, 1140,
  1150, 1172, 1182, 1186, 1201, 1202, 1206, 1211, 1222, 1247,
  1260, 1278, 1290, 1295, 1323, 1341, 1347, 1375, 1376, 1387,
  1419, 1451, 1478, 1492, 1504, 1507, 1514, 1525, 1541, 1574,
  1595, 1605, 1623, 1643, 1680, 1705, 1732, 1759, 1775, 1798,
  1824, 1858, 1861, 1878, 1907, 1916, 1941, 1975, 2000, 2007,
  5765, 5826, 5856, 5967, 6000, 6015, 6068, 6175, 6225, 6296,
  6335, 6442, 6489, 6541, 6612, 6686, 6713, 6785, 6804, 6871
];

const getRandomEarthViewUrl = () => {
  const randomId = EARTH_VIEW_IDS[Math.floor(Math.random() * EARTH_VIEW_IDS.length)];
  return `https://earthview.withgoogle.com/download/${randomId}.jpg`;
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
    setImageUrl(getRandomEarthViewUrl());
  }, []);

  useEffect(() => {
    setImageUrl(getRandomEarthViewUrl());
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
          alt="Earth View satellite imagery"
          crossOrigin="anonymous"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${
            imageLoaded ? "opacity-100" : "opacity-0"
          }`}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
          data-testid="image-earth-view-background"
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
