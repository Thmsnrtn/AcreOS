import { useTheme, type ThemeId, type ThemeMode, THEME_IDS } from "@/contexts/theme-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Palette, Moon, Sun, Monitor } from "lucide-react";
import { clientLogger } from "@/lib/clientLogger";

/**
 * Quick theme picker dialog — surfaced from the top bar / palette for fast
 * theme + mode swaps. The full Settings → Appearance panel (Phase B.4)
 * carries font-pairing, density, and motion in addition to these.
 *
 * Swatches mirror prototype's set-themes preview — light bg, light brand,
 * light ink, dark bg — so the user can read the personality at a glance.
 */

type ThemeSwatch = {
  id: ThemeId;
  label: string;
  tagline: string;
  light: { bg: string; brand: string; ink: string };
  dark: { bg: string };
};

const THEMES: ThemeSwatch[] = [
  {
    id: "homestead",
    label: "Homestead",
    tagline: "Warm earth, terracotta, cream",
    light: { bg: "#FAF4E8", brand: "#C2531C", ink: "#241607" },
    dark: { bg: "#1A120A" },
  },
  {
    id: "quarry",
    label: "Quarry",
    tagline: "Editorial stone, ink, one red",
    light: { bg: "#F3F0EA", brand: "#C8241C", ink: "#0C0C0A" },
    dark: { bg: "#121210" },
  },
  {
    id: "nocturne",
    label: "Nocturne",
    tagline: "Operator dark, single signal",
    light: { bg: "#FAFAF9", brand: "#D63A2D", ink: "#0A0A0A" },
    dark: { bg: "#0A0A0A" },
  },
  {
    id: "meadow",
    label: "Meadow",
    tagline: "Sage, honey, daylight",
    light: { bg: "#F5F6EE", brand: "#3D6B2F", ink: "#132010" },
    dark: { bg: "#141A10" },
  },
  {
    id: "slate",
    label: "Slate",
    tagline: "Clinical blue-grey, data-dense",
    light: { bg: "#F1F4F8", brand: "#1E4FCC", ink: "#0B1220" },
    dark: { bg: "#0A1018" },
  },
];

const MODES: { id: ThemeMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "auto", label: "Auto", icon: Monitor },
];

// Verify the swatch list stays in sync with the canonical theme list.
// If THEME_IDS adds an entry without a matching swatch, the picker silently
// hides it; flag it loudly in dev instead.
if (process.env.NODE_ENV !== "production") {
  const swatchIds = new Set(THEMES.map((t) => t.id));
  for (const id of THEME_IDS) {
    if (!swatchIds.has(id)) {
      // eslint-disable-next-line no-console
      clientLogger.warn(`[theme-settings] no swatch defined for ThemeId="${id}"`);
    }
  }
}

export function ThemeSettings() {
  const { themeConfig, setThemeConfig, resolvedMode } = useTheme();

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Palette className="w-4 h-4" />
          Theme
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Appearance</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Mode toggle */}
          <div>
            <p className="text-sm font-medium mb-2">Mode</p>
            <div className="flex gap-2">
              {MODES.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setThemeConfig({ mode: id })}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-md border text-sm font-medium transition-all flex-1 justify-center",
                    themeConfig.mode === id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-accent/50",
                  )}
                  aria-pressed={themeConfig.mode === id}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Theme cards */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium">Theme</p>
              {themeConfig.theme !== "homestead" && (
                <button
                  type="button"
                  onClick={() => setThemeConfig({ theme: "homestead" })}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                  data-testid="button-reset-theme"
                >
                  Reset to Homestead
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setThemeConfig({ theme: t.id })}
                  aria-pressed={themeConfig.theme === t.id}
                  className={cn(
                    "flex flex-col items-start rounded-card border p-3 text-left transition-all min-h-[96px]",
                    themeConfig.theme === t.id
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-border hover:border-primary/50",
                  )}
                >
                  <div className="grid grid-cols-4 gap-1 mb-2 w-full h-5 rounded-md overflow-hidden">
                    <div style={{ backgroundColor: t.light.bg }} />
                    <div style={{ backgroundColor: t.light.brand }} />
                    <div style={{ backgroundColor: t.light.ink }} />
                    <div style={{ backgroundColor: t.dark.bg }} />
                  </div>
                  <span className="text-xs font-semibold">{t.label}</span>
                  <span className="text-xs text-muted-foreground leading-tight">
                    {t.tagline}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Changes apply instantly · Currently showing <strong>{resolvedMode}</strong> mode
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
