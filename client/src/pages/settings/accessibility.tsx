/**
 * Accessibility settings — user-controlled toggles for read-aloud (Phase 1)
 * and other accessibility affordances.
 *
 * Phase 1 of read-aloud (browser speechSynthesis). Phase 2 (Week 19-20)
 * will swap to streaming TTS via ElevenLabs / OpenAI tts-1 — same
 * preferences surface, different engine under the hood.
 *
 * Persistence: localStorage today (read-aloud:* keys). When a server-backed
 * UserPreference table lands, this page can mirror writes there too.
 */
import { Volume2 } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useReadAloud } from "@/hooks/useReadAloud";
import { useReadAloudPrefs } from "@/hooks/useReadAloud.prefs";

const SAMPLE_TEXT =
  "AcreOS will read Pax responses and legal documents aloud at this rate and voice. Adjust the controls to your preference.";

export default function AccessibilitySettingsPage() {
  useDocumentTitle("Accessibility — Settings");
  const {
    speak,
    stop,
    isSpeaking,
    isAvailable,
    voices,
    preferredRate,
    preferredVoice,
    setPreferredRate,
    setPreferredVoice,
  } = useReadAloud();
  const { showButtons, autoReadPax, setShowButtons, setAutoReadPax } =
    useReadAloudPrefs();

  return (
    <PageShell label="Accessibility settings">
      <div>
        <h1 className="text-2xl font-bold">Accessibility</h1>
        <p className="text-muted-foreground text-sm">
          Customize how AcreOS adapts to the way you work.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div
              className="p-2 rounded-md bg-primary/10 text-primary"
              aria-hidden="true"
            >
              <Volume2 className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-lg">Read aloud</CardTitle>
              <CardDescription>
                Have Pax responses and legal documents read out loud using your
                browser's built-in voice.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {!isAvailable && (
            <div
              role="alert"
              className="rounded-md border border-acr-warn bg-acr-warn-soft px-4 py-3 text-sm text-acr-warn-soft-ink dark:border-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn-soft-ink"
            >
              Your browser doesn't expose text-to-speech. Read-aloud controls
              will appear once you switch to a browser that supports the Web
              Speech API.
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="show-read-aloud-buttons" className="text-sm font-medium">
                Show read-aloud buttons
              </Label>
              <p className="text-xs text-muted-foreground">
                Display a small speaker icon next to Pax responses and on legal
                documents.
              </p>
            </div>
            <Switch
              id="show-read-aloud-buttons"
              checked={showButtons}
              onCheckedChange={setShowButtons}
              aria-label="Show read-aloud buttons"
              data-testid="switch-show-read-aloud"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="auto-read-pax" className="text-sm font-medium">
                Auto-read new Pax responses
              </Label>
              <p className="text-xs text-muted-foreground">
                Speak each Pax answer aloud as soon as it finishes streaming.
              </p>
            </div>
            <Switch
              id="auto-read-pax"
              checked={autoReadPax}
              onCheckedChange={setAutoReadPax}
              disabled={!isAvailable}
              aria-label="Auto-read new Pax responses"
              data-testid="switch-auto-read-pax"
            />
          </div>

          {isAvailable && (
            <>
              <div className="space-y-2">
                <Label htmlFor="read-aloud-voice" className="text-sm font-medium">
                  Voice
                </Label>
                <Select
                  value={preferredVoice ?? "__default__"}
                  onValueChange={(v) =>
                    setPreferredVoice(v === "__default__" ? null : v)
                  }
                >
                  <SelectTrigger
                    id="read-aloud-voice"
                    aria-label="Select read-aloud voice"
                    data-testid="select-read-aloud-voice"
                  >
                    <SelectValue placeholder="System default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">System default</SelectItem>
                    {voices.map((v) => (
                      <SelectItem key={v.voiceURI} value={v.voiceURI}>
                        {v.name} ({v.lang})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {voices.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Loading available voices…
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="read-aloud-rate" className="text-sm font-medium">
                    Speaking rate
                  </Label>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {preferredRate.toFixed(2)}×
                  </span>
                </div>
                <Slider
                  id="read-aloud-rate"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={[preferredRate]}
                  onValueChange={(vals) => setPreferredRate(vals[0] ?? 1)}
                  aria-label="Speaking rate"
                  data-testid="slider-read-aloud-rate"
                />
                <div className="flex justify-between text-micro text-muted-foreground">
                  <span>Slower</span>
                  <span>Default</span>
                  <span>Faster</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => speak(SAMPLE_TEXT)}
                  disabled={isSpeaking}
                  aria-label="Preview the current voice and rate"
                  data-testid="button-preview-voice"
                >
                  Preview
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={stop}
                  disabled={!isSpeaking}
                  aria-label="Stop preview"
                  data-testid="button-stop-preview"
                >
                  Stop
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
