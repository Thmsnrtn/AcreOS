import { Map, Upload } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

interface PropertiesEmptyStateProps {
  onAddProperty?: () => void;
  onImportProperties?: () => void;
}

/**
 * Surface-specific empty state for the Properties surface.
 * Thin wrapper around the canonical EmptyState primitive.
 * Agency-frame copy (Joanna wave 3): names what Pax does the moment the user acts.
 */
export function PropertiesEmptyState({ onAddProperty, onImportProperties }: PropertiesEmptyStateProps) {
  return (
    <EmptyState
      icon={Map}
      headline="No properties in inventory"
      subtitle="Add your first parcel — Pax pulls 14 comps and a flood-zone read inside 90 seconds, and re-runs the valuation the moment a comparable sale hits."
      cta={{
        label: "Add a property",
        onClick: onAddProperty,
        "data-testid": "button-add-property",
      }}
      secondaryCta={
        onImportProperties
          ? {
              label: "Import from CSV",
              onClick: onImportProperties,
              "data-testid": "button-import-properties",
            }
          : undefined
      }
      actionIcon={null}
      tips={[
        "Drop in the APN — Pax pulls county records, GIS, and 14 comparable sales inside 90 seconds",
        "Pax re-runs the valuation automatically whenever a comparable sale hits nearby",
      ]}
      testId="empty-state-properties"
    />
  );
}
