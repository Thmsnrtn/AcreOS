import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { AlertTriangle } from "lucide-react";

/**
 * 1031 exchange tracker — refused until it can store exchanges.
 *
 * This page used to create "trackers" through an API whose persistence was a
 * stub: the create call answered 201, the toast said "1031 exchange tracker
 * created", and the list stayed empty forever (best-in-class audit
 * 2026-10-20). A deadline tracker that silently tracks nothing is worse than
 * none, so the page now says so and offers nothing it cannot do.
 */
export default function Exchange1031Page() {
  useDocumentTitle("1031 exchange tracker");

  return (
    <PageShell label="1031 exchange">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-exchange-1031-title">
          1031 exchange tracker
        </h1>
      </div>
      <Card data-testid="exchange-1031-unavailable">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" aria-hidden="true" />
            Not available yet
          </CardTitle>
          <CardDescription>
            AcreOS does not store 1031 exchanges yet, so it cannot track your identification and
            exchange deadlines.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Calendar both deadlines with your qualified intermediary: the 45-day identification
            deadline and the exchange deadline, which is the earlier of 180 days after the sale or
            your tax return's due date (with extensions) for that year.
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
