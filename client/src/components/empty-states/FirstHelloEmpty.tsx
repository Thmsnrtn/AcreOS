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

const SURFACE_CONTENT: Record<FirstHelloSurface, SurfaceContent> = {
  leads: {
    icon: Users,
    headline: "Welcome — let's bring in your first leads",
    subtitle:
      "Import a CSV, paste records, or sync from a list provider. AcreOS scores every lead the moment it lands.",
    testIdSuffix: "leads",
  },
  properties: {
    icon: Map,
    headline: "Your inventory starts here",
    subtitle:
      "Add the parcels you're tracking — prospects, owned land, and active listings all live together.",
    testIdSuffix: "properties",
  },
  deals: {
    icon: Handshake,
    headline: "Ready to track your first deal",
    subtitle:
      "Deals connect leads, parcels, and finances. Move them through your pipeline as you negotiate.",
    testIdSuffix: "deals",
  },
  campaigns: {
    icon: Megaphone,
    headline: "Reach motivated sellers",
    subtitle:
      "Send your first letter, email, or SMS campaign. AcreOS handles the addresses, mail merge, and tracking.",
    testIdSuffix: "campaigns",
  },
  inbox: {
    icon: Inbox,
    headline: "Your inbox is ready",
    subtitle:
      "Connect a mailbox or phone number and replies show up here, threaded against the right lead.",
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
