import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { useAccessibility } from "@/contexts/accessibility-context";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Eye, Type, Clock, Image as ImageIcon, Hand, Brain, Wind, ChevronDown, Accessibility } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Accessibility & comfort settings — Wave B accommodations.
 *
 * Exposes the user-facing toggles backed by AccessibilityProvider:
 *   • Lexend pairing + reading density (Beck §2-§4)
 *   • Cognitive a11y mode (Tobias §1)
 *   • Larger taps mode (Mavis §1)
 *   • Picture-first parcel cards (Earl §1)
 *   • Focus mode + quiet hours (Yelena §1)
 *   • Reduce motion (moved here from Appearance, 2026-10-18 — follows the
 *     device setting unless switched on)
 *
 * Mounted under Settings → Account as the "Accessibility & comfort"
 * disclosure (AccessibilityComfortSection below), separate from Appearance.
 */

/** True when the person has changed any accommodation from its default. */
function hasCustomAccommodations(p: ReturnType<typeof useAccessibility>["prefs"]): boolean {
  return (
    p.fontFamily !== "system" ||
    p.readingDensity !== "comfortable" ||
    p.cognitiveA11yMode ||
    p.largerTapsMode ||
    p.pictureFirstParcels ||
    p.focusMode ||
    p.quietHours.enabled ||
    p.reduceMotion === true
  );
}

/**
 * The Accessibility & comfort section: collapsed by default so Appearance
 * stays two simple choices, but open on arrival when the person already uses
 * an accommodation (so they can always see what is on) or followed a link to
 * #accessibility.
 */
export function AccessibilityComfortSection() {
  const { prefs } = useAccessibility();
  const [open, setOpen] = useState<boolean>(
    () => hasCustomAccommodations(prefs) || (typeof window !== "undefined" && window.location.hash === "#accessibility"),
  );
  return (
    <section id="accessibility" aria-labelledby="accessibility-comfort-heading" data-testid="accessibility-comfort">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          className="flex w-full items-center justify-between gap-3 rounded-card border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent/50 active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[56px]"
          data-testid="accessibility-comfort-toggle"
        >
          <span className="flex items-center gap-3 min-w-0">
            <Accessibility className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0">
              <span id="accessibility-comfort-heading" className="block text-sm font-semibold">
                Accessibility &amp; comfort
              </span>
              <span className="block text-xs text-muted-foreground">
                Reading font and size, larger taps, reduced motion, focus mode and quiet hours
              </span>
            </span>
          </span>
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4">
          <AccessibilityPanel />
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
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

      {/* Motion — follows the device unless switched on here. */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Wind className="h-5 w-5 text-acr-info" aria-hidden="true" />
            <CardTitle>Motion</CardTitle>
          </div>
          <CardDescription>
            AcreOS follows your device's reduce-motion setting automatically. Switch this on to
            reduce motion here regardless of the device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="reduce-motion" className="text-sm">Reduce motion</Label>
            <Switch
              id="reduce-motion"
              checked={prefs.reduceMotion === true}
              onCheckedChange={(v) => setPrefs({ reduceMotion: v ? true : "system" })}
              data-testid="switch-reduce-motion"
            />
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
