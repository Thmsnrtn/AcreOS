import { Handshake } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

interface DealsEmptyStateProps {
  onAddDeal?: () => void;
}

/**
 * Surface-specific empty state for the Deals surface.
 * Thin wrapper around the canonical EmptyState primitive.
 * Agency-frame copy (Joanna wave 3): names what Pax does the moment the user acts.
 */
export function DealsEmptyState({ onAddDeal }: DealsEmptyStateProps) {
  return (
    <EmptyState
      icon={Handshake}
      headline="No open deals"
      subtitle="The moment you send an offer, Pax tracks the reply window and pings you on day 5 if the seller goes quiet."
      cta={{
        label: "Create your first deal",
        onClick: onAddDeal,
        "data-testid": "button-add-deal",
      }}
      actionIcon={null}
      tips={[
        "Wire deals to parcels and leads — Pax keeps the offer, counter, reply window, and cool-off in one thread",
        "Pax pings you the day a deal ages past 5 days without a reply",
      ]}
      testId="empty-state-deals"
    />
  );
}
