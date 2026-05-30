import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Users,
  Map,
  Handshake,
  Megaphone,
  Inbox,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

/**
 * FirstHelloEmpty
 * --------------------------------------------------------------------------
 * Archetype #1 — for *new* organizations with zero data on a given surface.
 * Optimistic, onboarding-flavored, with one or two purposeful CTAs.
 *
 * Use this when `records.length === 0` AND the org has never had records
 * (no archived items, no filters applied). For "you cleared everything"
 * use `<ClearedEmpty>`. For "filters returned nothing" use `<EmptyFilter>`.
 */

export type FirstHelloSurface =
  | "leads"
  | "properties"
  | "deals"
  | "campaigns"
  | "inbox";

interface FirstHelloCta {
  label: string;
  onClick: () => void;
}

interface FirstHelloEmptyProps {
  surface: FirstHelloSurface;
  cta: {
    primary: FirstHelloCta;
    secondary?: FirstHelloCta;
  };
  /** Optional override for the headline copy. */
  headline?: string;
  /** Optional override for the subtitle copy. */
  subtitle?: string;
  className?: string;
}

interface SurfaceContent {
  icon: LucideIcon;
  headline: string;
  subtitle: string;
  testIdSuffix: string;
}

// Agency-frame archetype copy (Joanna): name what the user hasn't
// done, name what Pax does the moment they do it, name when. Avoid
// the absence-frame default ("No X yet — add some.") that signals
// the system is idle until the user moves.
const SURFACE_CONTENT: Record<FirstHelloSurface, SurfaceContent> = {
  leads: {
    icon: Users,
    headline: "Tell Pax which counties to watch",
    subtitle:
      "You haven't told Pax which counties to watch yet. Paste a county list or upload a CSV — Pax scores every new record within 90 seconds and surfaces the top three on Today by 6am.",
    testIdSuffix: "leads",
  },
  properties: {
    icon: Map,
    headline: "No properties in inventory",
    subtitle:
      "Add your first parcel — Pax pulls comps and a flood-zone read inside 90 seconds.",
    testIdSuffix: "properties",
  },
  deals: {
    icon: Handshake,
    headline: "No open deals",
    subtitle:
      "The moment you send an offer, Pax tracks the reply window and pings you on day 5 if the seller goes quiet.",
    testIdSuffix: "deals",
  },
  campaigns: {
    icon: Megaphone,
    headline: "Reach motivated sellers",
    subtitle:
      "Pick a list and a letter — Pax handles addresses, mail merge, and tracking, and flags every reply against the right lead.",
    testIdSuffix: "campaigns",
  },
  inbox: {
    icon: Inbox,
    headline: "Wire up an inbox",
    subtitle:
      "Connect a mailbox or phone number — Pax threads every reply against the right lead and drafts the response by the time you read it.",
    testIdSuffix: "inbox",
  },
};

export function FirstHelloEmpty({
  surface,
  cta,
  headline,
  subtitle,
  className = "",
}: FirstHelloEmptyProps) {
  const content = SURFACE_CONTENT[surface];
  const Icon = content.icon;
  const testId = `first-hello-${content.testIdSuffix}`;

  return (
    <Card
      className={`border-dashed bg-muted/30 ${className}`}
      data-testid={testId}
    >
      <CardContent className="flex flex-col items-center justify-center py-14 px-6 text-center">
        <div
          className="relative mb-5 p-4 rounded-full bg-gradient-to-br from-primary/15 to-primary/5"
          aria-hidden="true"
        >
          <Icon className="w-10 h-10 text-primary" />
          <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-background border border-border flex items-center justify-center">
            <Sparkles className="w-3 h-3 text-primary" />
          </span>
        </div>

        <h3
          className="text-lg font-semibold mb-2 text-foreground"
          data-testid={`${testId}-title`}
        >
          {headline ?? content.headline}
        </h3>
        <p
          className="text-sm text-muted-foreground max-w-md mb-6"
          data-testid={`${testId}-subtitle`}
        >
          {subtitle ?? content.subtitle}
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
          <Button
            type="button"
            onClick={cta.primary.onClick}
            aria-label={cta.primary.label}
            data-testid={`${testId}-cta-primary`}
          >
            {cta.primary.label}
          </Button>
          {cta.secondary && (
            <Button
              type="button"
              variant="outline"
              onClick={cta.secondary.onClick}
              aria-label={cta.secondary.label}
              data-testid={`${testId}-cta-secondary`}
            >
              {cta.secondary.label}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
