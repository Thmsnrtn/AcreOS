/**
 * Settings → Workflows — routed section (Wave 1.5, P2 §1).
 *
 * Workflow automations, moved intact from the settings.tsx monolith's
 * Integrations tab (legacy tab value `automations`).
 */
import { WorkflowsSettingsTab } from "@/components/workflows-settings-tab";

export default function WorkflowsSection() {
  return (
    <div className="space-y-4" data-testid="settings-section-workflows">
      <WorkflowsSettingsTab />
    </div>
  );
}
