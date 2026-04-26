/**
 * Preferences card — Settings → Appearance.
 *
 * Houses the two prototype-mandated user-level preferences that aren't
 * theme/color:
 * 1. Sound effects toggle (HANDOFF §9 Tweaks "Sound on" → real setting,
 *    off by default per founder decisions)
 * 2. Replay guided tour button (HANDOFF §9 Tweaks "Replay guided tour"
 *    → real setting; per HANDOFF §7 wired to useTour().restart())
 *
 * Both consume the existing useSound() / useTour() hooks. When server
 * persistence lands behind those hooks (currently localStorage), this
 * card needs no change.
 */
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useSound } from "@/hooks/use-sound";
import { useTour } from "@/hooks/use-tour";
import { Volume2, VolumeX, RotateCcw, AlertCircle } from "lucide-react";

export function PreferencesCard() {
  const { enabled, reducedMotion, setEnabled } = useSound();
  const tour = useTour();

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
                <span className="block mt-1 inline-flex items-center gap-1 text-amber-600">
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

        <div className="border-t pt-6">
          {/* Replay tour */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <Label className="text-sm font-medium">Guided tour</Label>
              <p className="text-xs text-muted-foreground mt-1">
                {tour.dismissed || tour.stepsSeen.length > 0
                  ? `You've seen ${tour.stepsSeen.length} of ${tour.stepIds.length} steps. Replay anytime.`
                  : "A 60-second walkthrough of the daily-driver loop."}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => tour.restart()}
              data-testid="button-replay-tour"
              className="shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
              {tour.stepsSeen.length > 0 ? "Replay tour" : "Start tour"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
