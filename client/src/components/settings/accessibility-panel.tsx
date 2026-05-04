import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { useAccessibility } from "@/contexts/accessibility-context";
import { Eye, Type, Clock, Image as ImageIcon, Hand, Brain } from "lucide-react";

/**
 * Accessibility & comfort settings — Wave B accommodations.
 *
 * Exposes the user-facing toggles backed by AccessibilityProvider:
 *   • Lexend pairing + reading density (Beck §2-§4)
 *   • Cognitive a11y mode (Tobias §1)
 *   • Larger taps mode (Mavis §1)
 *   • Picture-first parcel cards (Earl §1)
 *   • Focus mode + quiet hours (Yelena §1)
 *
 * Mounted under Settings → Accessibility.
 */
export function AccessibilityPanel() {
  const { prefs, setPrefs, reset } = useAccessibility();

  return (
    <div className="space-y-6">
      {/* Reading + Font (Beck) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Type className="h-5 w-5 text-acr-info" aria-hidden="true" />
            <CardTitle>Reading & font</CardTitle>
          </div>
          <CardDescription>
            Tune font and density for readability. Lexend is designed for dyslexia-friendly reading.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label className="text-sm font-medium">Font family</Label>
            <RadioGroup
              value={prefs.fontFamily}
              onValueChange={(v) => setPrefs({ fontFamily: v as "system" | "lexend" })}
              className="mt-2 flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="system" id="font-system" />
                <Label htmlFor="font-system" className="font-normal cursor-pointer">
                  System default
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="lexend" id="font-lexend" />
                <Label htmlFor="font-lexend" className="font-normal cursor-pointer">
                  Lexend (dyslexia-friendly)
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div>
            <Label className="text-sm font-medium">Reading density</Label>
            <RadioGroup
              value={prefs.readingDensity}
              onValueChange={(v) =>
                setPrefs({ readingDensity: v as "compact" | "comfortable" | "spacious" })
              }
              className="mt-2 flex flex-col gap-2 sm:flex-row sm:gap-4"
            >
              {[
                { v: "compact", label: "Compact", hint: "More on screen at once" },
                { v: "comfortable", label: "Comfortable", hint: "Default" },
                { v: "spacious", label: "Spacious", hint: "Larger text, more line spacing" },
              ].map((o) => (
                <div key={o.v} className="flex items-center gap-2">
                  <RadioGroupItem value={o.v} id={`density-${o.v}`} />
                  <Label htmlFor={`density-${o.v}`} className="font-normal cursor-pointer">
                    {o.label}
                    <span className="block text-xs text-muted-foreground">{o.hint}</span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        </CardContent>
      </Card>

      {/* Cognitive a11y (Tobias) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-acr-info" aria-hidden="true" />
            <CardTitle>More time, less density</CardTitle>
          </div>
          <CardDescription>
            Extends form-completion timeouts (5 min → 30 min) and hides secondary elements so the
            screen stays focused on what matters.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Label htmlFor="cognitive-a11y" className="text-sm">Enable cognitive accessibility mode</Label>
            <Switch
              id="cognitive-a11y"
              checked={prefs.cognitiveA11yMode}
              onCheckedChange={(v) => setPrefs({ cognitiveA11yMode: v })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Larger taps (Mavis) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Hand className="h-5 w-5 text-acr-info" aria-hidden="true" />
            <CardTitle>Larger taps</CardTitle>
          </div>
          <CardDescription>
            Buttons grow to 56px tall with bigger text and a subtle shadow on outline buttons so
            they look clearly pressable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Label htmlFor="larger-taps" className="text-sm">Enable larger taps</Label>
            <Switch
              id="larger-taps"
              checked={prefs.largerTapsMode}
              onCheckedChange={(v) => setPrefs({ largerTapsMode: v })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Picture-first (Earl) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-acr-info" aria-hidden="true" />
            <CardTitle>Picture-first parcel cards</CardTitle>
          </div>
          <CardDescription>
            Show parcel photos prominently above the data when available, instead of a small thumbnail.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Label htmlFor="picture-first" className="text-sm">Show photos first</Label>
            <Switch
              id="picture-first"
              checked={prefs.pictureFirstParcels}
              onCheckedChange={(v) => setPrefs({ pictureFirstParcels: v })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Focus mode + quiet hours (Yelena) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-acr-info" aria-hidden="true" />
            <CardTitle>Focus mode & quiet hours</CardTitle>
          </div>
          <CardDescription>
            Hide notifications, badges, and the Pax rail. Set quiet hours to suppress toasts, email,
            and SMS during a daily window.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="focus-mode" className="text-sm">Focus mode (until next break)</Label>
            <Switch
              id="focus-mode"
              checked={prefs.focusMode}
              onCheckedChange={(v) => setPrefs({ focusMode: v })}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="quiet-hours-enabled" className="text-sm">Enforced quiet hours</Label>
            <Switch
              id="quiet-hours-enabled"
              checked={prefs.quietHours.enabled}
              onCheckedChange={(v) =>
                setPrefs({ quietHours: { ...prefs.quietHours, enabled: v } })
              }
            />
          </div>

          {prefs.quietHours.enabled && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="quiet-start" className="text-xs text-muted-foreground">
                  Start
                </Label>
                <input
                  id="quiet-start"
                  type="time"
                  value={prefs.quietHours.start}
                  onChange={(e) =>
                    setPrefs({ quietHours: { ...prefs.quietHours, start: e.target.value } })
                  }
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <Label htmlFor="quiet-end" className="text-xs text-muted-foreground">
                  End
                </Label>
                <input
                  id="quiet-end"
                  type="time"
                  value={prefs.quietHours.end}
                  onChange={(e) =>
                    setPrefs({ quietHours: { ...prefs.quietHours, end: e.target.value } })
                  }
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={reset}>
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
