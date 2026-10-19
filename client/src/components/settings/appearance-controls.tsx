import { useId } from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/contexts/theme-context";
import { cn } from "@/lib/utils";
import {
  COLORWAYS,
  DISPLAY_MODES,
  DISPLAY_MODE_LABELS,
  normalizeColorway,
  normalizeDisplayMode,
  type ColorwayDef,
  type DisplayMode,
} from "@shared/appearance";

/**
 * The ONE set of personal appearance controls — Colorway and Display. Both
 * entry points (Settings → Appearance and the quick dialog in the top bar)
 * render this component, so they cannot offer different choices. The lists
 * come from shared/appearance.ts.
 *
 * Both groups are Radix radio groups: arrow keys move the choice, each option
 * has a visible focus ring, a readable selected state, and press feedback on
 * touch (`active:`), pinned by tests/unit/appearancePanelPressState.test.ts.
 *
 * The swatches render the OTHER colorways' palettes, so they read hexes from
 * the shared contract rather than from the live tokens (which only ever hold
 * the current colorway).
 */

const MODE_ICONS: Record<DisplayMode, React.ComponentType<{ className?: string }>> = {
  light: Sun,
  dark: Moon,
  auto: Monitor,
};

function ColorwayPreview({ def, dark }: { def: ColorwayDef; dark: boolean }) {
  const s = dark ? def.dark : def.light;
  // A miniature of the shared layout: rail, page, one surface with an action.
  return (
    <div
      aria-hidden="true"
      className="flex h-12 sm:h-16 w-full overflow-hidden rounded-md border border-border/70"
      style={{ backgroundColor: s.page }}
    >
      <div className="w-1/4 shrink-0" style={{ backgroundColor: s.rail }}>
        <div className="mx-auto mt-2 h-1.5 w-1/2 rounded-full opacity-80" style={{ backgroundColor: s.accent }} />
      </div>
      <div className="flex flex-1 flex-col justify-center gap-1.5 p-2">
        <div className="h-2 w-3/4 rounded-full opacity-25" style={{ backgroundColor: s.rail }} />
        <div className="flex items-center gap-1.5 rounded-sm p-1.5" style={{ backgroundColor: s.surface }}>
          <div className="h-2.5 w-8 rounded-full" style={{ backgroundColor: s.primary }} />
          <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.accent }} />
        </div>
      </div>
    </div>
  );
}

export function ColorwayPicker({ compact = false }: { compact?: boolean }) {
  const { themeConfig, setThemeConfig, resolvedMode } = useTheme();
  return (
    <RadioGroupPrimitive.Root
      value={themeConfig.theme}
      onValueChange={(v) => {
        const id = normalizeColorway(v);
        if (id) setThemeConfig({ theme: id });
      }}
      aria-label="Colorway"
      // Phones: compact rows (swatch left, name + description right) — tall
      // stacked cards took most of a screen, and three-up truncated the names
      // at 320px. From sm: three cards across.
      className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3"
      data-testid="colorway-picker"
    >
      {COLORWAYS.map((def) => {
        const selected = themeConfig.theme === def.id;
        return (
          <RadioGroupPrimitive.Item
            key={def.id}
            value={def.id}
            aria-label={`${def.name} — ${def.description}`}
            data-testid={`theme-card-${def.id}`}
            className={cn(
              "group relative flex min-w-0 flex-row items-center gap-3 rounded-card border p-2 pr-10 text-left transition-colors sm:flex-col sm:items-start sm:gap-2 sm:p-2.5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              selected
                ? "border-primary ring-1 ring-primary bg-card"
                : "border-border bg-card hover:border-primary/50 active:border-primary/70",
            )}
          >
            <span className="w-24 shrink-0 sm:w-full">
              <ColorwayPreview def={def} dark={resolvedMode === "dark"} />
            </span>
            <span
              className={cn(
                "absolute right-3 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full shadow-acr-1 sm:right-1.5 sm:top-1.5 sm:translate-y-0",
                selected ? "bg-primary text-primary-foreground" : "border border-border bg-card",
              )}
              aria-hidden="true"
            >
              {selected && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5 sm:gap-2">
              <span className="text-sm font-semibold leading-tight">{def.name}</span>
              {!compact && (
                <span className="text-xs leading-snug text-muted-foreground max-[359px]:hidden">{def.description}</span>
              )}
            </span>
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}

export function DisplayModePicker() {
  const { themeConfig, setThemeConfig } = useTheme();
  return (
    <RadioGroupPrimitive.Root
      value={themeConfig.mode}
      onValueChange={(v) => {
        const m = normalizeDisplayMode(v);
        if (m) setThemeConfig({ mode: m });
      }}
      aria-label="Display"
      orientation="horizontal"
      className="grid w-full max-w-md grid-cols-3 gap-1 rounded-lg border border-border bg-muted/50 p-1"
      data-testid="display-mode-picker"
    >
      {DISPLAY_MODES.map((id) => {
        const Icon = MODE_ICONS[id];
        const selected = themeConfig.mode === id;
        return (
          <RadioGroupPrimitive.Item
            key={id}
            value={id}
            data-testid={`mode-button-${id}`}
            className={cn(
              // Icon above the label on a phone so "Match device" never
              // truncates in a third of a 320px screen; side by side from sm.
              "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md px-1.5 py-1 text-[13px] font-medium leading-tight transition-colors sm:min-h-10 sm:flex-row sm:gap-1.5 sm:px-2 sm:text-sm pointer-coarse:min-h-11",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-card text-foreground shadow-level-1"
                : "text-muted-foreground hover:text-foreground active:text-foreground active:bg-card/60",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">{DISPLAY_MODE_LABELS[id]}</span>
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}

/** Colorway + Display, with their labels. `compact` is the quick dialog. */
export function AppearanceControls({ compact = false }: { compact?: boolean }) {
  // Settings and the quick dialog can both be mounted at once; ids must differ.
  const uid = useId();
  const colorwayHeading = `${uid}-colorway`;
  const displayHeading = `${uid}-display`;
  return (
    <div className={cn("space-y-6", compact && "space-y-5")} data-testid="appearance-controls">
      <section aria-labelledby={colorwayHeading} className="space-y-3">
        <div>
          <h3 id={colorwayHeading} className="font-sans text-sm font-semibold tracking-normal">
            Colorway
          </h3>
          {!compact && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Three finishes on the same AcreOS — the layout and type never change.
            </p>
          )}
        </div>
        <ColorwayPicker compact={compact} />
      </section>
      <section aria-labelledby={displayHeading} className="space-y-3">
        <div>
          <h3 id={displayHeading} className="font-sans text-sm font-semibold tracking-normal">
            Display
          </h3>
          {!compact && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Match device follows your phone or computer. Light or Dark stays put until you change it.
            </p>
          )}
        </div>
        <DisplayModePicker />
      </section>
    </div>
  );
}
