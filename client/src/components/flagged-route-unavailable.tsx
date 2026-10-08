/**
 * The view FlaggedRoute renders when a route's feature flag is off: a
 * neutral "not available" EmptyState inside the normal app shell.
 */
import { Clock } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function FeatureNotAvailable() {
  useDocumentTitle("Not available");
  return (
    <PageShell label="Not available">
      <EmptyState
        icon={Clock}
        headline="This feature isn't available"
        subtitle="Everything else in AcreOS works as usual — pick up where you left off on Today."
        cta={{ label: "Go to Today", href: "/today", "data-testid": "flagged-route-go-today" }}
        actionIcon={null}
        testId="flagged-route-unavailable"
      />
    </PageShell>
  );
}
