import { useState, useEffect } from "react";
import { usePWA } from "@/hooks/use-pwa";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, X, Share, Plus } from "lucide-react";

export function PWAInstallPrompt() {
  const { canInstall, isInstalled, isIOS, promptInstall } = usePWA();
  const [showPrompt, setShowPrompt] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Hide while the cookie-consent banner is up — same gating the FAB uses
  // (see floating-action-button.tsx). On mobile both surfaces compete for
  // the bottom of the viewport and the PWA prompt would steal the banner's
  // tap targets.
  const [cookieBannerVisible, setCookieBannerVisible] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("acreos_cookie_consent") === null;
  });

  useEffect(() => {
    const recheck = () => {
      setCookieBannerVisible(localStorage.getItem("acreos_cookie_consent") === null);
    };
    window.addEventListener("acreos:cookieconsent", recheck);
    window.addEventListener("storage", recheck);
    return () => {
      window.removeEventListener("acreos:cookieconsent", recheck);
      window.removeEventListener("storage", recheck);
    };
  }, []);

  useEffect(() => {
    const wasDismissed = localStorage.getItem("pwa-install-dismissed");
    if (wasDismissed) {
      const dismissedTime = parseInt(wasDismissed);
      const daysSinceDismissed = (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);
      if (daysSinceDismissed < 7) {
        setDismissed(true);
      }
    }
  }, []);

  useEffect(() => {
    if ((canInstall || isIOS) && !isInstalled && !dismissed) {
      const timer = setTimeout(() => setShowPrompt(true), 3000);
      return () => clearTimeout(timer);
    }
  }, [canInstall, isIOS, isInstalled, dismissed]);

  const handleDismiss = () => {
    setShowPrompt(false);
    setDismissed(true);
    localStorage.setItem("pwa-install-dismissed", Date.now().toString());
  };

  const handleInstall = async () => {
    const installed = await promptInstall();
    if (installed) {
      setShowPrompt(false);
    }
  };

  if (!showPrompt || isInstalled || cookieBannerVisible) return null;

  if (isIOS) {
    return (
      <aside
        aria-label="Install AcreOS"
        className="fixed bottom-[88px] md:bottom-4 left-4 right-4 z-floating md:left-auto md:right-4 md:w-96"
      >
        <Card className="border-primary/20 shadow-lg">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-card bg-primary/10">
                <Download className="h-5 w-5 text-primary" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm">Install AcreOS</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Tap the <Share className="inline h-3 w-3" aria-label="Share" role="img" /> Share button then "Add to Home Screen" <Plus className="inline h-3 w-3" aria-hidden="true" />
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="shrink-0"
                onClick={handleDismiss}
                aria-label="Dismiss install prompt"
                data-testid="button-dismiss-pwa"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Install AcreOS"
      className="fixed bottom-[140px] md:bottom-4 left-4 right-4 z-floating md:left-auto md:right-4 md:w-96"
    >
      <Card className="border-primary/20 shadow-lg">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-card bg-primary/10">
              <Download className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm">Install AcreOS</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Get the full app experience with offline access.
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="shrink-0"
              onClick={handleDismiss}
              aria-label="Dismiss install prompt"
              data-testid="button-dismiss-pwa"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={handleDismiss}
              data-testid="button-not-now-pwa"
            >
              Not now
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={handleInstall}
              data-testid="button-install-pwa"
            >
              Install
            </Button>
          </div>
        </CardContent>
      </Card>
    </aside>
  );
}
