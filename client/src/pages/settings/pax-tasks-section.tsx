/**
 * Settings → Scheduled tasks — routed section (Wave 1.5, P2 §1).
 *
 * Pax task settings, moved intact from the settings.tsx monolith's
 * Integrations tab (legacy tab value `ai-tasks`).
 */
import { PaxTasksSettingsTab } from "@/components/pax-tasks-settings-tab";

export default function PaxTasksSection() {
  return (
    <div className="space-y-4" data-testid="settings-section-pax-tasks">
      <PaxTasksSettingsTab />
    </div>
  );
}
