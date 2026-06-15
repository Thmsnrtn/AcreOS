/**
 * PersonaSwitcher — header dropdown that flips between founder and
 * customer mode in a single click.
 *
 * Tom's #1 nav pain: from the founder dashboard the only escape was
 * hitting Back repeatedly. This switcher gives a one-tap exit (and the
 * inverse — one-tap entry from customer mode for the founder).
 *
 * Renders only for founders (the toggle is meaningless for
 * customer-only users). Tier'd UI: full pill with chevron on desktop,
 * 44pt icon-and-label on mobile. Uses canonical TAP_PRESS +
 * SPRING_INTERACTIVE from lib/motion so the press feel matches the rest
 * of the Atlas surface.
 */
import { motion } from "framer-motion";
import { Check, ChevronDown, Crown, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { usePersonaMode, type PersonaMode } from "@/hooks/use-persona-mode";
import { SPRING_INTERACTIVE, TAP_PRESS } from "@/lib/motion";
import { useRespectfulTransition } from "@/lib/motion-tokens";
import { TOUCH_TARGET_PT } from "@/lib/spacing";
import { cn } from "@/lib/utils";

const MODE_LABEL: Record<PersonaMode, string> = {
  founder: "Founder",
  customer: "Customer",
};

const MODE_DESC: Record<PersonaMode, string> = {
  founder: "Founder dashboard, agents, controls",
  customer: "Today, leads, deals, money",
};

interface PersonaSwitcherProps {
  /** Optional compact mode — icon only with mode initial. */
  compact?: boolean;
  className?: string;
}

export function PersonaSwitcher({ compact, className }: PersonaSwitcherProps) {
  const { isFounder } = useAuth();
  const { mode, setMode } = usePersonaMode();
  const tapSpring = useRespectfulTransition(SPRING_INTERACTIVE);

  // Only founders ever see the toggle — for everyone else this would
  // dead-end on /founder (403).
  if (!isFounder) return null;

  const Icon = mode === "founder" ? Crown : User;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <motion.button
          type="button"
          whileTap={TAP_PRESS}
          transition={tapSpring}
          aria-label={`Switch mode. Currently ${MODE_LABEL[mode]} mode.`}
          data-testid="persona-switcher-trigger"
          style={{ minHeight: TOUCH_TARGET_PT }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-veil px-3 text-xs font-medium text-foreground shadow-sm backdrop-blur-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            compact && "px-2",
            className,
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {!compact && (
            <>
              <span className="text-muted-foreground">Mode:</span>
              <span>{MODE_LABEL[mode]}</span>
            </>
          )}
          {compact && <span>{MODE_LABEL[mode][0]}</span>}
          <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
        </motion.button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" data-testid="persona-switcher-menu">
        <DropdownMenuLabel className="text-caption uppercase tracking-wider text-muted-foreground">
          Switch mode
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(["founder", "customer"] as PersonaMode[]).map((m) => {
          const ItemIcon = m === "founder" ? Crown : User;
          const active = mode === m;
          return (
            <DropdownMenuItem
              key={m}
              onSelect={() => setMode(m)}
              data-testid={`persona-switcher-option-${m}`}
              style={{ minHeight: TOUCH_TARGET_PT }}
              className="flex items-start gap-2 py-2"
            >
              <ItemIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {MODE_LABEL[m]}
                  {active && (
                    <Check className="h-3.5 w-3.5 text-acr-brand" aria-hidden="true" />
                  )}
                </div>
                <div className="text-caption text-muted-foreground">{MODE_DESC[m]}</div>
              </div>
              {m === "customer" && (
                <kbd className="ml-2 mt-0.5 hidden shrink-0 items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-micro sm:inline-flex">
                  ⌘;
                </kbd>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default PersonaSwitcher;
