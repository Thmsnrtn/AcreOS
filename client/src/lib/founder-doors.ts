/**
 * Founder four-door doctrine (Hands roadmap P6).
 *
 * The customer nav is disciplined to five fixed doors (CLAUDE.md). The founder
 * side had no such discipline and grew to 88 /founder/* routes — at least ten
 * overlapping "here's your status" overviews. For a self-operating business the
 * founder surface should INVERT: the more the autopilot does, the FEWER doors the
 * founder needs.
 *
 * The canonical model is FOUR primary doors + one deliberate admin namespace.
 * Everything else collapses under these as a child/section/tab or moves under
 * /founder/admin/*. New founder surfaces must live behind one of these — never as
 * a new top-level overview route (the founderFourDoors ratchet enforces it).
 */
export interface FounderDoor {
  id: "letter" | "decisions" | "controls" | "story";
  label: string;
  href: string;
  /** One line: what this door is FOR. */
  purpose: string;
}

export const FOUNDER_DOORS: readonly FounderDoor[] = [
  {
    id: "letter",
    label: "The Letter",
    href: "/founder/autopilot",
    purpose: "The home. What happened, what it decided, what it needs you for, what's working. 90% of days: read and close.",
  },
  {
    id: "decisions",
    label: "Decisions",
    href: "/founder/decisions",
    purpose: "The ONLY place you're a required participant: the witnessed-send queue, asks, appeals, recourse.",
  },
  {
    id: "controls",
    label: "Controls",
    href: "/founder/autopilot/control",
    purpose: "Master switches, per-domain trust levels, budgets, objectives + Your Voice, per-hand kill switches.",
  },
  {
    id: "story",
    label: "Story",
    href: "/founder/autopilot/story",
    purpose: "The glass-box audit timeline — for verifying, not operating.",
  },
] as const;

/** Deep instrument panels (telemetry, costs, ETL, prompts, …) live here — visited
 * deliberately, never competing for daily attention. */
export const FOUNDER_ADMIN_NAMESPACE = "/founder/admin";

export function founderDoorByHref(href: string): FounderDoor | null {
  return FOUNDER_DOORS.find((d) => d.href === href) ?? null;
}
