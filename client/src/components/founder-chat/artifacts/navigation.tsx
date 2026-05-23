/**
 * navigation artifact — auto-navigate on mount.
 *
 * Emitted by Atlas mode-switch tools (switch_to_customer_mode /
 * switch_to_founder_mode) and any future tool that needs to take the
 * user somewhere as part of its result. Renders a quiet confirmation
 * line while wouter handles the actual route change.
 *
 * Uses wouter's useLocation rather than window.location so the SPA
 * router stays in control — no full reload, no scroll loss, no
 * dropped React state.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { ArrowRight } from "lucide-react";

interface NavigationArtifactProps {
  target: string;
  label?: string;
}

export function NavigationArtifact({ target, label }: NavigationArtifactProps) {
  const [, navigate] = useLocation();
  const firedRef = useRef(false);

  useEffect(() => {
    // Guard against StrictMode double-mount firing the nav twice.
    if (firedRef.current) return;
    if (!target) return;
    firedRef.current = true;
    navigate(target);
  }, [target, navigate]);

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
      data-testid="artifact-navigation"
    >
      <ArrowRight className="h-3 w-3" aria-hidden="true" />
      <span>{label ?? `Opening ${target}…`}</span>
    </div>
  );
}

export default NavigationArtifact;
