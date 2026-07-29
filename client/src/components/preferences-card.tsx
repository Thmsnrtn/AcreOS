/**
 * Preferences card — Settings → Appearance.
 *
 * Houses the prototype-mandated user-level preferences that aren't
 * theme/color:
 * 1. Sound effects toggle (HANDOFF §9 Tweaks "Sound on" → real setting,
 *    off by default per founder decisions)
 * 2. Add to Home Screen (PWA install path)
 *
 * The "Replay guided tour" row was removed 2026-07-29 with the use-tour
 * stub: the hook only wrote localStorage state and no overlay component
 * ever consumed it, so the button did nothing visible — a dead stub, not
 * a tour. Re-running onboarding lives in Settings → Help & Tips
 * ("Re-run onboarding"), which actually re-runs the setup wizard.
 */
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useSound } from "@/hooks/use-sound";
import { usePWA } from "@/hooks/use-pwa";
import { SHOW_INSTALL_EVENT } from "@/components/pwa-install-prompt";
import { Volume2, VolumeX, AlertCircle, Smartphone, CheckCircle2 } from "lucide-react";

export function PreferencesCard() {
  const { enabled, reducedMotion, setEnabled } = useSound();
  const { isInstalled, canInstall, isIOS } = usePWA();
  // Only surface the install row where install is actually possible: an app
  // already installed has nothing to offer, and desktop browsers without a
  // native prompt can't add to a home screen.
  const showInstallRow = !isInstalled && (canInstall || isIOS);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Preferences</CardTitle>
        <CardDescription>
          Small comforts. Off by default — turn on what helps.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Sound effects */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <Label
              htmlFor="pref-sound"
              className="text-sm font-medium flex items-center gap-2"
            >
              {enabled ? (
                <Volume2 className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              ) : (
                <VolumeX className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              )}
              Sound effects
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              Soft clicks on key actions and a chime when a deal closes.
              {reducedMotion && (
                <span className="block mt-1 inline-flex items-center gap-1 text-acr-warn">
                  <AlertCircle className="w-3 h-3" aria-hidden="true" />
                  Disabled while &ldquo;reduce motion&rdquo; is on at the OS level.
                </span>
              )}
            </p>
          </div>
          <Switch
            id="pref-sound"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={reducedMotion}
            data-testid="switch-sound-enabled"
            aria-label="Sound effects"
          />
        </div>

        {/* Add to Home Screen — the "get the app" path, always findable here
            even after the auto-prompt was dismissed. */}
        {(showInstallRow || isInstalled) && (
          <div className="border-t pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  Add to Home Screen
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  {isInstalled
                    ? "AcreOS is installed — it opens full-screen like an app."
                    : "Put AcreOS on your home screen so it opens full-screen and launches like an app. No App Store needed."}
                </p>
              </div>
              {isInstalled ? (
                <span className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-acr-success">
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  Installed
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.dispatchEvent(new CustomEvent(SHOW_INSTALL_EVENT))}
                  data-testid="button-add-to-home-screen"
                  className="shrink-0"
                >
                  <Smartphone className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
                  {isIOS ? "Show me how" : "Install app"}
                </Button>
              )}
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
