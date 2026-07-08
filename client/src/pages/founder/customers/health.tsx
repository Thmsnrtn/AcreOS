/**
 * /founder/customers/health — composite customer-health view (F-D #4).
 *
 * Per docs/archive/exhaustive-completion/founder-dashboard-extraction-queue.md
 * Extraction #4: "Three related panels that always read together; single
 * dedicated route makes the customer-health story scannable."
 *
 * Composes existing fetchers — no new server endpoint. Pure layout.
 */

import { Heart } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { MRRTrajectory } from "@/components/dashboard";
import { ChurnRiskPanel } from "@/components/founder/customers-health/churn-risk-panel";
import { OrgHealthMonitor } from "@/components/founder/customers-health/org-health-monitor";

export default function FounderCustomersHealthPage() {
  useDocumentTitle("Customers — Health — AcreOS");

  return (
    <PageShell label="Customer health">
      <div className="mb-6 flex items-start gap-3">
        <Heart className="w-6 h-6 text-primary mt-1" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customer health</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Forward-looking customer signal — churn risk, revenue trajectory,
            org engagement. The /founder churn-risk card is the headline; this
            is the deep dive.
          </p>
        </div>
      </div>

      {/* Calm-matrix grid — MRR trajectory + churn-risk side by side, then full-width OrgHealth */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <MRRTrajectory />
        <ChurnRiskPanel />
      </div>

      <OrgHealthMonitor />
    </PageShell>
  );
}
