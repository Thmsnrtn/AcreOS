/**
 * Settings → Appearance — routed section (Wave 1.5, P2 §1).
 *
 * Moved intact from the settings.tsx monolith's Account tab. The full
 * Settings → Appearance surface is AppearancePanel; ThemeSettings (dialog
 * quick-picker) is intended for top-bar mount in Phase E.
 */
import { Settings as SettingsIcon } from "lucide-react";
import { AppearancePanel } from "@/components/settings/appearance-panel";
import { PreferencesCard } from "@/components/preferences-card";

export default function AppearanceSection() {
  return (
    <div className="space-y-4" data-testid="settings-section-appearance">
      <div>
        <h2 className="text-section-h2 flex items-center gap-2">
          <SettingsIcon className="w-5 h-5" />
          Appearance
        </h2>
        <p className="text-muted-foreground text-sm">
          Five themes, five type pairings, and the small comforts that make
          the workspace feel like yours.
        </p>
      </div>
      <AppearancePanel />
      <PreferencesCard />
    </div>
  );
}
