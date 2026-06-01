import { Users, Upload } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

interface LeadsEmptyStateProps {
  onAddLead?: () => void;
  onImportLeads?: () => void;
}

/**
 * Surface-specific empty state for the Leads surface.
 * Thin wrapper around the canonical EmptyState primitive.
 * Agency-frame copy (Joanna wave 3): names what Pax does the moment the user acts.
 */
export function LeadsEmptyState({ onAddLead, onImportLeads }: LeadsEmptyStateProps) {
  return (
    <EmptyState
      icon={Users}
      headline="Tell Pax which counties to watch"
      subtitle="You haven't told Pax which counties to watch yet. Paste a county list or upload a CSV — Pax scores every new record within 90 seconds and surfaces the top three on Today by 6am."
      cta={{
        label: "Add your first lead",
        onClick: onAddLead,
        "data-testid": "button-add-lead-empty",
      }}
      secondaryCta={
        onImportLeads
          ? {
              label: "Import from CSV",
              onClick: onImportLeads,
              "data-testid": "button-import-leads",
            }
          : undefined
      }
      actionIcon={null}
      tips={[
        "Pax scores every new lead within 90 seconds against motivation signals — tax delinquency, vacancy, inherited deed",
        "The top three are on Today by 6am so you always start the day with a clear first move",
      ]}
      testId="empty-state-leads"
    />
  );
}
