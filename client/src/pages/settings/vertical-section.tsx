/**
 * Settings → Vertical & vocabulary — routed section (Wave 1.5, P2 §1).
 *
 * Investor persona — drives vocabulary swaps + onboarding path. Moved
 * intact from the settings.tsx monolith's Account tab into its own
 * Workspace-group section (P2 §1.3: persona changes CONTENT, and its
 * policy home is the workspace, not personal appearance).
 */
import { PersonaPanel } from "@/components/settings/persona-panel";

export default function VerticalSection() {
  return (
    <div className="space-y-4" data-testid="settings-section-vertical">
      <PersonaPanel />
    </div>
  );
}
