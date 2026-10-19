import { Card, CardContent } from "@/components/ui/card";
import { AppearanceControls } from "@/components/settings/appearance-controls";

/**
 * Settings → Appearance. Exactly two choices — Colorway and Display — rendered
 * by the same AppearanceControls the top-bar quick dialog uses.
 *
 * Retired from this surface by the Fieldstone redesign (founder decision
 * 2026-10-18): the font-pairing, density and motion pickers, and the global
 * list-style picker (whose setting no list ever read). Reduced motion and
 * reading comfort live under Accessibility & comfort; company logos and
 * colours live under Company branding.
 */
export function AppearancePanel() {
  return (
    <Card data-testid="appearance-panel">
      <CardContent className="pt-6">
        <AppearanceControls />
      </CardContent>
    </Card>
  );
}
