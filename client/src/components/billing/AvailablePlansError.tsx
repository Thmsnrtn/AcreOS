/**
 * The Billing tab's plan-catalog failure state.
 *
 * Two different situations used to render as one: a transient failure (retry
 * will likely work) and a deployment where billing is not configured at all
 * (GET /api/stripe/products answers 503 SERVICE_UNAVAILABLE — retry will not
 * work). The second now says so, in the server's own words, instead of the
 * generic "display issue" copy. Both keep the retry, the "Couldn't load plans"
 * title and the testids that billing-upgrade-journey.spec.ts pins.
 */
import { Card, CardContent } from "@/components/ui/card";
import { QueryErrorState } from "@/components/query-error-state";
import { StripeProductsError } from "@/hooks/use-organization";

export interface AvailablePlansErrorProps {
  error: Error | null;
  onRetry: () => void;
  isRetrying: boolean;
}

export function AvailablePlansError({ error, onRetry, isRetrying }: AvailablePlansErrorProps) {
  const unavailable = error instanceof StripeProductsError && error.unavailable;
  const serverText = error?.message.replace(/^\d{3}:\s*/, "") ?? "";
  return (
    <Card>
      <CardContent className="py-6">
        <QueryErrorState
          error={error}
          onRetry={onRetry}
          isRetrying={isRetrying}
          compact
          title="Couldn't load plans"
          description={
            unavailable
              ? `${serverText} Plans can't be shown or changed here until billing is available. Your current subscription is unaffected.`
              : "Your current subscription is unaffected — this is just a display issue."
          }
          testId="error-available-plans"
        />
      </CardContent>
    </Card>
  );
}
