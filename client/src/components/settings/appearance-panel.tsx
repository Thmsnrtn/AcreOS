import {
  useTheme,
  type ThemeId,
  type ThemeMode,
  type FontPairing,
  type Density,
  type MotionPreference,
} from "@/contexts/theme-context";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Sun, Moon, Monitor } from "lucide-react";

/**
 * Settings → Appearance — the trust surface (design-system §14).
 *
 * Five sections in one calm panel: Theme, Mode, Font Pairing, Density,
 * Motion. Distinct from `theme-settings.tsx` (the top-bar quick picker
 * dialog), which only carries theme + mode for fast switching. The full
 * panel is fuller, calmer, with font pairing previews rendered in each
 * pairing's actual display + body fonts so the user can read the
 * personality before picking.
 */

type ThemeSwatch = {
  id: ThemeId;
  label: string;
  tagline: string;
  light: { bg: string; brand: string; ink: string };
  dark: { bg: string };
};

const THEMES: ThemeSwatch[] = [
  { id: "homestead", label: "Homestead", tagline: "Warm earth, terracotta, cream",
    light: { bg: "#FAF4E8", brand: "#C2531C", ink: "#241607" }, dark: { bg: "#1A120A" } },
  { id: "quarry", label: "Quarry", tagline: "Editorial stone, ink, one red",
    light: { bg: "#F3F0EA", brand: "#C8241C", ink: "#0C0C0A" }, dark: { bg: "#121210" } },
  { id: "nocturne", label: "Nocturne", tagline: "Operator dark, single signal",
    light: { bg: "#FAFAF9", brand: "#D63A2D", ink: "#0A0A0A" }, dark: { bg: "#0A0A0A" } },
  { id: "meadow", label: "Meadow", tagline: "Sage, honey, daylight",
    light: { bg: "#F5F6EE", brand: "#3D6B2F", ink: "#132010" }, dark: { bg: "#141A10" } },
  { id: "slate", label: "Slate", tagline: "Clinical blue-grey, data-dense",
    light: { bg: "#F1F4F8", brand: "#1E4FCC", ink: "#0B1220" }, dark: { bg: "#0A1018" } },
];

const MODES: { id: ThemeMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "auto", label: "Auto", icon: Monitor },
];

// Each pairing previews itself by setting font-family inline so the card
// renders in the pairing's actual faces (display + body). Fonts.css declares
// every face up-front, so referenced families resolve immediately.
type PairingDef = {
  id: FontPairing;
  label: string;
  description: string;
  display: string;
  body: string;
};

const PAIRINGS: PairingDef[] = [
  {
    id: "editorial",
    label: "Editorial",
    description: "Fraunces · Inter — house default, warm editorial display",
    display: "'Fraunces', Georgia, serif",
    body: "'Inter', -apple-system, sans-serif",
  },
  {
    id: "modern",
    label: "Modern",
    description: "Inter Tight · Inter — crisp, neutral, tech-forward",
    display: "'Inter Tight', -apple-system, sans-serif",
    body: "'Inter', -apple-system, sans-serif",
  },
  {
    id: "classic",
    label: "Classic",
    description: "Source Serif · Inter — warm editorial with stronger serif voice",
    display: "'Source Serif 4', Georgia, serif",
    body: "'Inter', -apple-system, sans-serif",
  },
  {
    id: "native",
    label: "Native",
    description: "System fonts — SF Pro on Apple, native everywhere else",
    display: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif",
    body: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
  },
  {
    id: "refined",
    label: "Refined",
    description: "Newsreader · Inter — soft editorial register, premium feel",
    display: "'Newsreader', Georgia, serif",
    body: "'Inter', -apple-system, sans-serif",
  },
];

const SAMPLE_TEXT = "AcreOS · the work is its own reward";

const DENSITY_OPTIONS: { value: Density; label: string; description: string }[] = [
  { value: "compact", label: "Compact", description: "Tight rhythm — for long lists and dense tables" },
  { value: "comfortable", label: "Comfortable", description: "Default — breathing room on most surfaces" },
  { value: "adaptive", label: "Adaptive", description: "Compact in CRM, comfortable elsewhere — recommended" },
];

export function AppearancePanel() {
  const { themeConfig, setThemeConfig, resolvedMode } = useTheme();

  return (
    <div className="space-y-6">
      {/* Theme */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Theme</CardTitle>
          <CardDescription>
            Five aesthetic personalities, each with light + dark. Currently showing{" "}
            <strong>{resolvedMode}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setThemeConfig({ theme: t.id })}
                aria-pressed={themeConfig.theme === t.id}
                aria-label={`Theme: ${t.label}`}
                data-testid={`theme-card-${t.id}`}
                className={cn(
                  "flex flex-col items-start rounded-card border p-3 text-left transition-colors min-h-[112px]",
                  themeConfig.theme === t.id
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:border-primary/50",
                )}
              >
                <div className="grid grid-cols-4 gap-1 mb-2 w-full h-6 rounded-md overflow-hidden">
                  <div style={{ backgroundColor: t.light.bg }} />
                  <div style={{ backgroundColor: t.light.brand }} />
                  <div style={{ backgroundColor: t.light.ink }} />
                  <div style={{ backgroundColor: t.dark.bg }} />
                </div>
                <span className="text-sm font-semibold leading-tight">{t.label}</span>
                <span className="text-xs text-muted-foreground leading-snug mt-1">
                  {t.tagline}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Mode */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mode</CardTitle>
          <CardDescription>
            Auto follows your system. A manual pick stays put until you choose Auto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="inline-flex rounded-md border border-border p-1 bg-muted/40">
            {MODES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setThemeConfig({ mode: id })}
                aria-pressed={themeConfig.mode === id}
                data-testid={`mode-button-${id}`}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  themeConfig.mode === id
                    ? "bg-background text-foreground shadow-level-1"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Font Pairing */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Type</CardTitle>
          <CardDescription>
            Five curated pairings. Pick the personality that fits how you read.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PAIRINGS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setThemeConfig({ fontPairing: p.id })}
                aria-pressed={themeConfig.fontPairing === p.id}
                data-testid={`pairing-card-${p.id}`}
                className={cn(
                  "flex flex-col items-start rounded-card border p-4 text-left transition-colors",
                  themeConfig.fontPairing === p.id
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:border-primary/50",
                )}
              >
                {/* Sample text in the actual pairing fonts so personality is visible. */}
                <span
                  className="text-2xl leading-tight tracking-tight"
                  style={{ fontFamily: p.display, fontWeight: 600 }}
                >
                  {SAMPLE_TEXT}
                </span>
                <span
                  className="text-sm mt-2 text-muted-foreground"
                  style={{ fontFamily: p.body }}
                >
                  {SAMPLE_TEXT}
                </span>
                <div className="flex items-baseline gap-2 mt-3 w-full">
                  <span className="text-sm font-semibold">{p.label}</span>
                  <span className="text-xs text-muted-foreground leading-tight">
                    {p.description}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Density */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Density</CardTitle>
          <CardDescription>
            How tightly information packs on a page. Adaptive lets each surface decide.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={themeConfig.density}
            onValueChange={(v) => setThemeConfig({ density: v as Density })}
          >
            <SelectTrigger className="w-full max-w-sm" data-testid="select-density">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DENSITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} data-testid={`density-option-${opt.value}`}>
                  <div className="flex flex-col">
                    <span>{opt.label}</span>
                    <span className="text-xs text-muted-foreground">{opt.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Motion */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Motion</CardTitle>
          <CardDescription>
            Reduce the duration and softness of transitions across the app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <Label htmlFor="motion-toggle" className="text-sm font-medium">
                Reduce motion
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Honors your system preference by default. Toggle to override.
              </p>
            </div>
            <Switch
              id="motion-toggle"
              checked={themeConfig.motion === "reduced"}
              onCheckedChange={(checked) =>
                setThemeConfig({ motion: (checked ? "reduced" : "full") as MotionPreference })
              }
              data-testid="switch-motion"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
