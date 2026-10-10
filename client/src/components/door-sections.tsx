/**
 * The sections behind a door, as a row of links inside the page.
 *
 * WHY THIS EXISTS. The desktop sidebar lists a door's children (Deals →
 * Pipeline · Leads) and hides the rest under "More". A phone has no sidebar:
 * the bottom bar carries the five doors and nothing below them. So on a phone
 * the persona walks (tests/simulation/walks/persona-walks.ts) tapped Deals and
 * found no way to Leads or Outreach — "import my list" and "send postcards"
 * were dead ends on the device a land flipper actually uses in the field. On
 * desktop "Outreach" sat behind the sidebar's collapsed "More" and was a dead
 * end too.
 *
 * This is not a new top-level entry (CLAUDE.md "five fixed doors"): it renders
 * INSIDE a door's own pages and lists only that door's own sections. Routes the
 * sidebar hides for this account's persona are hidden here by the same
 * registry (`resolveHiddenRoutes`), so the strip never advertises a section
 * the sidebar would not.
 */
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useHiddenRoutes } from "@/hooks/use-hidden-routes";

export interface DoorSection {
  label: string;
  href: string;
  /** Other paths that belong to this section, for the current-page marker. */
  also?: string[];
}

/**
 * The Deals door's sections, in the order a deal moves: leads come in,
 * outreach goes out, deals are worked in the pipeline. Mirrors the Deals
 * children + the Outreach overflow entry in layout-sidebar.tsx NAV_MODULES.
 */
export const DEALS_SECTIONS: DoorSection[] = [
  { label: "Pipeline", href: "/deals" },
  { label: "Leads", href: "/leads" },
  { label: "Outreach", href: "/campaigns", also: ["/outreach/mail"] },
];

function isCurrent(location: string, s: DoorSection): boolean {
  return [s.href, ...(s.also ?? [])].some((p) => location === p || location.startsWith(`${p}/`));
}

export function DoorSections({
  door,
  sections,
  className,
}: {
  /** The door's name, for the landmark: "Deals" → "Deals sections". */
  door: string;
  sections: DoorSection[];
  className?: string;
}) {
  const [location] = useLocation();
  const hidden = useHiddenRoutes();
  const visible = sections.filter((s) => !hidden.includes(s.href));
  if (visible.length < 2) return null;
  return (
    <nav aria-label={`${door} sections`} className={cn("-mx-1 overflow-x-auto", className)} data-testid={`door-sections-${door.toLowerCase()}`}>
      <ul className="flex gap-2 px-1 py-1 list-none m-0">
        {visible.map((s) => {
          const current = isCurrent(location, s);
          return (
            <li key={s.href} className="shrink-0">
              <Link
                href={s.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  current
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:bg-muted",
                )}
                data-testid={`door-section-${s.label.toLowerCase()}`}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
