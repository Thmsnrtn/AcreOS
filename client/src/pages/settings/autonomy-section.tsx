/**
 * Settings → Autonomy — routed section (Wave 1.5, P2 §1).
 *
 * The autonomy matrix, moved intact from the settings.tsx monolith's
 * Integrations tab. Founder-gated feature flag per design-system §8.4:
 * the SHELL hides the rail entry and the palette hides the destination
 * when `feature.autonomy-matrix` is off (same registry `flag` field for
 * both); this section double-checks so a direct URL with the flag off
 * states the truth instead of rendering a control that does nothing.
 */
import { useFlag } from "@/contexts/feature-flags-context";
import { AutonomyPanel } from "@/components/settings/autonomy-panel";

export default function AutonomySection() {
  const autonomyFlag = useFlag("feature.autonomy-matrix");

  if (!autonomyFlag) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="autonomy-section-disabled">
        The autonomy matrix isn&apos;t enabled for this workspace yet.
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="settings-section-autonomy">
      <AutonomyPanel />
    </div>
  );
}
