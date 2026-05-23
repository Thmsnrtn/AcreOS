/**
 * PersonaSheet — mobile bottom-sheet that mirrors the PersonaSwitcher
 * dropdown. Triggered by long-press on any founder-mobile-bottom-nav
 * slot AND by tapping the "Mode" chip on the mobile founder chat
 * header.
 *
 * One sheet component, two trigger surfaces, single source of truth for
 * mode state via usePersonaMode.
 */
import { Check, Crown, User } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { usePersonaMode, type PersonaMode } from "@/hooks/use-persona-mode";
import { TOUCH_TARGET_PT } from "@/lib/spacing";
import { cn } from "@/lib/utils";

const MODE_LABEL: Record<PersonaMode, string> = {
  founder: "Founder",
  customer: "Customer",
};
const MODE_DESC: Record<PersonaMode, string> = {
  founder: "Atlas dashboard, agents, controls",
  customer: "Today, leads, deals, money",
};

interface PersonaSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PersonaSheet({ open, onOpenChange }: PersonaSheetProps) {
  const { mode, setMode } = usePersonaMode();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl" data-testid="persona-sheet">
        <SheetHeader className="text-left">
          <SheetTitle className="text-base">Switch mode</SheetTitle>
          <SheetDescription className="text-xs">
            Move between founder controls and the customer surface.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-2 pb-4">
          {(["founder", "customer"] as PersonaMode[]).map((m) => {
            const ItemIcon = m === "founder" ? Crown : User;
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  onOpenChange(false);
                }}
                style={{ minHeight: TOUCH_TARGET_PT }}
                data-testid={`persona-sheet-option-${m}`}
                className={cn(
                  "w-full flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active && "border-acr-brand/40 bg-acr-brand/5",
                )}
              >
                <ItemIcon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {MODE_LABEL[m]}
                    {active && (
                      <Check className="h-3.5 w-3.5 text-acr-brand" aria-hidden="true" />
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{MODE_DESC[m]}</div>
                </div>
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default PersonaSheet;
