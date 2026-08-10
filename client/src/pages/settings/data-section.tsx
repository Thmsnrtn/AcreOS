/**
 * Settings → Data & fields — routed section (Wave 1.5, P2 §1).
 *
 * Custom fields + import/export, moved intact from the settings.tsx
 * monolith's Tax & Compliance tab (legacy tab value `data`).
 */
import { FileText } from "lucide-react";
import { CustomFieldsManager } from "@/components/custom-fields";
import { ImportExportManager } from "@/components/import-export";

export default function DataSection() {
  return (
    <div className="space-y-8" data-testid="settings-section-data">
      <div className="space-y-4">
        <div>
          <h2 className="text-section-h2 flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Custom Fields
          </h2>
          <p className="text-muted-foreground text-sm">
            Define custom fields for leads, properties, and deals.
          </p>
        </div>
        <CustomFieldsManager />
      </div>

      <div className="space-y-4">
        <ImportExportManager />
      </div>
    </div>
  );
}
