/**
 * MobileShell — persona-aware mobile IA spike.
 *
 * Top-level mobile layout used when `mobile.new_shell_enabled` is ON
 * (founder_settings KNOB) AND the viewport is mobile-sized. Renders
 * a 4-tab bottom bar (Today / Inbox / Pipeline / Portfolio) with a
 * persona-aware FAB.
 *
 * This is a proof of IA — every tab body is currently a placeholder
 * Card. Wiring real per-persona content is the next iteration; the
 * goal here is to evaluate the navigation structure on staging.
 *
 * Scope: customer-facing only. Founder routes (/founder/*) continue
 * to use FounderMobileBottomNav; this shell is suppressed there at
 * the App.tsx render site.
 */

import { useState, type ReactNode } from "react";
import { Calendar, Inbox, ListChecks, BarChart3, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Persona } from "@shared/models/auth";

type TabId = "today" | "inbox" | "pipeline" | "portfolio";

interface TabDef {
  id: TabId;
  label: string;
  icon: typeof Calendar;
}

const TABS: TabDef[] = [
  { id: "today", label: "Today", icon: Calendar },
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "pipeline", label: "Pipeline", icon: ListChecks },
  { id: "portfolio", label: "Portfolio", icon: BarChart3 },
];

/**
 * Human-readable persona label used in placeholder cards. Falls back
 * to "Land Flipper" per the spec when the user has no persona set.
 */
function personaLabel(persona: Persona | undefined): string {
  switch (persona) {
    case "land_investor":
      return "Land Flipper";
    case "note_investor":
    case "note_originator":
    case "note_servicer":
      return "Note Investor";
    case "tax_delinquent":
      return "Tax-Delinquent Investor";
    case "wholesaler":
      return "Wholesaler";
    case "subdivider":
      return "Subdivider";
    case "fix_flipper":
      return "Fix & Flip Investor";
    case "landlord":
      return "Buy-and-Hold Landlord";
    default:
      return "Land Flipper";
  }
}

/**
 * Persona-aware FAB label. Real action wiring comes later — for the
 * spike this only affects what the button reads.
 */
function fabLabel(persona: Persona | undefined): string {
  switch (persona) {
    case "note_investor":
    case "note_originator":
    case "note_servicer":
      return "Log payment received";
    case "landlord":
      return "Log maintenance issue";
    default:
      // land_investor / fix_flipper / tax_delinquent / subdivider /
      // wholesaler all share the "quick add lead" entry point in v1.
      return "Quick add lead";
  }
}

interface PlaceholderProps {
  tab: TabId;
  persona: Persona | undefined;
}

function tabHeadline(tab: TabId): string {
  switch (tab) {
    case "today":
      return "Today";
    case "inbox":
      return "Inbox";
    case "pipeline":
      return "Pipeline";
    case "portfolio":
      return "Portfolio";
  }
}

function tabBody(tab: TabId, persona: string): string {
  switch (tab) {
    case "today":
      return `Coming soon: ${persona}-specific Today view`;
    case "inbox":
      return `Coming soon: ${persona}-specific Inbox view (triage of inbound responses)`;
    case "pipeline":
      return `Coming soon: ${persona}-specific Pipeline view (deal flow)`;
    case "portfolio":
      return `Coming soon: ${persona}-specific Portfolio view (health)`;
  }
}

function TabPlaceholder({ tab, persona }: PlaceholderProps) {
  const label = personaLabel(persona);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {tabHeadline(tab)} — {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {tabBody(tab, label)}
      </CardContent>
    </Card>
  );
}

interface MobileShellProps {
  persona: Persona | undefined;
  /**
   * Optional override for non-default tab bodies. Reserved for the
   * follow-up iteration that swaps placeholders for real per-persona
   * components — unused in the spike.
   */
  renderTab?: (tab: TabId, persona: Persona | undefined) => ReactNode;
}

export function MobileShell({ persona, renderTab }: MobileShellProps) {
  const [active, setActive] = useState<TabId>("today");
  const fab = fabLabel(persona);

  const body = renderTab
    ? renderTab(active, persona)
    : <TabPlaceholder tab={active} persona={persona} />;

  return (
    <div
      className="min-h-[100dvh] bg-background text-foreground flex flex-col"
      data-testid="mobile-shell"
    >
      <main
        className="flex-1 overflow-y-auto px-4 pt-6 pb-32"
        // pb-32 leaves room for the bottom bar + safe-area + FAB.
      >
        {body}
      </main>

      {/* Persona-aware FAB. Label-only for the spike; no real action. */}
      <div
        className="fixed right-4 z-50"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 88px)" }}
      >
        <Button
          type="button"
          className="shadow-lg rounded-full h-12 px-5 gap-2"
          aria-label={fab}
          data-testid="mobile-shell-fab"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span className="text-sm font-medium">{fab}</span>
        </Button>
      </div>

      <nav
        aria-label="Mobile shell navigation"
        className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-lg border-t border-border"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        data-testid="mobile-shell-bottom-bar"
      >
        <div className="flex justify-around items-center h-[72px] px-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActive(tab.id)}
                aria-current={isActive ? "page" : undefined}
                aria-label={tab.label}
                data-testid={`mobile-shell-tab-${tab.id}`}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 min-w-[56px] min-h-[48px] rounded-xl transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground active:bg-muted/50",
                )}
              >
                <div
                  className={cn(
                    "flex items-center justify-center w-full h-8 rounded-full transition-colors",
                    isActive && "bg-primary/15",
                  )}
                >
                  <Icon className="w-6 h-6" aria-hidden="true" />
                </div>
                <span
                  className={cn(
                    "text-[11px] font-medium truncate",
                    isActive && "text-primary",
                  )}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export default MobileShell;
