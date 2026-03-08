import { useTheme, type ThemePreset, type ThemeAccent, type ThemeMode } from "@/contexts/theme-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Palette, Moon, Sun, Monitor } from "lucide-react";

const PRESETS: { id: ThemePreset; label: string; description: string; lightBg: string; darkBg: string; accent: string }[] = [
  { id: "default",     label: "Desert",     description: "Warm terracotta & sand",   lightBg: "#f5f0eb", darkBg: "#1a1008", accent: "#c2724f" },
  { id: "midnight",    label: "Midnight",   description: "Deep navy & indigo",        lightBg: "#eef1f8", darkBg: "#080d1a", accent: "#5b7ce5" },
  { id: "forest",      label: "Forest",     description: "Rich green & sage",         lightBg: "#edf5f0", darkBg: "#071209", accent: "#3a8f5c" },
  { id: "ocean",       label: "Ocean",      description: "Cool blue & teal",          lightBg: "#eaf2f8", darkBg: "#08111a", accent: "#2e8fbd" },
  { id: "sunset",      label: "Sunset",     description: "Warm amber & rose",         lightBg: "#f8f0e8", darkBg: "#1a0d08", accent: "#e07a28" },
  { id: "monochrome",  label: "Monochrome", description: "Clean grayscale",           lightBg: "#f4f4f5", darkBg: "#0d0e10", accent: "#3e4451" },
];

const ACCENTS: { id: ThemeAccent; label: string; color: string }[] = [
  { id: "terracotta", label: "Terracotta", color: "#c2724f" },
  { id: "forest",     label: "Forest",    color: "#3a8f5c" },
  { id: "ocean",      label: "Ocean",     color: "#2e8fbd" },
  { id: "amber",      label: "Amber",     color: "#d97706" },
  { id: "rose",       label: "Rose",      color: "#e11d68" },
  { id: "slate",      label: "Slate",     color: "#64748b" },
];

const MODES: { id: ThemeMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "light",  label: "Light",  icon: Sun },
  { id: "dark",   label: "Dark",   icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

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
                    "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all flex-1 justify-center",
                    themeConfig.mode === id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-accent/50"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Preset cards */}
          <div>
            <p className="text-sm font-medium mb-2">Theme Preset</p>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setThemeConfig({ preset: preset.id })}
                  className={cn(
                    "flex flex-col items-start rounded-lg border p-3 text-left transition-all",
                    themeConfig.preset === preset.id
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  {/* Color swatch */}
                  <div className="flex gap-1 mb-2">
                    <div
                      className="w-5 h-5 rounded-md border border-border"
                      style={{ backgroundColor: preset.lightBg }}
                    />
                    <div
                      className="w-5 h-5 rounded-md border border-border"
                      style={{ backgroundColor: preset.darkBg }}
                    />
                    <div
                      className="w-5 h-5 rounded-full border border-border"
                      style={{ backgroundColor: preset.accent }}
                    />
                  </div>
                  <span className="text-xs font-semibold">{preset.label}</span>
                  <span className="text-xs text-muted-foreground leading-tight">
                    {preset.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Accent color — only relevant for "default" preset */}
          {themeConfig.preset === "default" && (
            <div>
              <p className="text-sm font-medium mb-2">Accent Color</p>
              <div className="flex gap-2 flex-wrap">
                {ACCENTS.map((acc) => (
                  <button
                    key={acc.id}
                    title={acc.label}
                    onClick={() => setThemeConfig({ accent: acc.id })}
                    className={cn(
                      "w-8 h-8 rounded-full border-2 transition-all",
                      themeConfig.accent === acc.id
                        ? "border-foreground scale-110 shadow-md"
                        : "border-transparent hover:scale-105"
                    )}
                    style={{ backgroundColor: acc.color }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Live preview indicator */}
          <p className="text-xs text-muted-foreground text-center">
            Changes apply instantly · Currently showing{" "}
            <strong>{resolvedMode}</strong> mode
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
