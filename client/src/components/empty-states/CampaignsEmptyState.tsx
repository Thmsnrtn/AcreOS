import { Mail } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

interface CampaignsEmptyStateProps {
  onCreateCampaign?: () => void;
}

/**
 * Surface-specific empty state for the Campaigns surface.
 * Thin wrapper around the canonical EmptyState primitive.
 * Agency-frame copy (Joanna wave 3): names what Pax does the moment the user acts.
 */
export function CampaignsEmptyState({ onCreateCampaign }: CampaignsEmptyStateProps) {
  return (
    <EmptyState
      icon={Mail}
      headline="Reach motivated sellers"
      subtitle="Pick a list and a letter — Pax handles addresses, mail merge, and tracking, and threads every reply back against the right lead."
      cta={{
        label: "Create your first campaign",
        onClick: onCreateCampaign,
        "data-testid": "button-create-campaign-empty",
      }}
      actionIcon={null}
      tips={[
        "Pax drafts a personalized outreach sequence for each lead based on the parcel profile — you approve the copy, Pax handles the cadence",
        "Every reply threads back against the right lead automatically",
      ]}
      testId="empty-state-campaigns"
    />
  );
}
