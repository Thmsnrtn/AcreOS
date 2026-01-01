import { useState, useEffect } from "react";
import { usePWA } from "@/hooks/use-pwa";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, X, Share, Plus } from "lucide-react";

export function PWAInstallPrompt() {
  const { canInstall, isInstalled, isIOS, promptInstall } = usePWA();
  const [showPrompt, setShowPrompt] = useState(false);
  const [dismissed, setDismissed] = useState(false);

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

  if (!showPrompt || isInstalled) return null;

  if (isIOS) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-4 md:w-96">
        <Card className="border-primary/20 shadow-lg">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Download className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm">Install AcreOS</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Tap <Share className="inline h-3 w-3" /> then "Add to Home Screen" <Plus className="inline h-3 w-3" />
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="shrink-0"
                onClick={handleDismiss}
                data-testid="button-dismiss-pwa"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-4 md:w-96">
      <Card className="border-primary/20 shadow-lg">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Download className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm">Install AcreOS</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Get the full app experience with offline access
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="shrink-0"
              onClick={handleDismiss}
              data-testid="button-dismiss-pwa"
            >
              <X className="h-4 w-4" />
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
    </div>
  );
}
