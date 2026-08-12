/**
 * ForecastCalibration — telling the customer what their forecasts actually do.
 *
 * The other half of the learning loop. The Today card ASKS what happened; this
 * is what the answers are FOR. Without it the customer is asked to feed an
 * instrument they can never see, which is a good way to teach someone that
 * answering is pointless.
 *
 * IT RENDERS THE SERVER'S SENTENCES VERBATIM
 * ------------------------------------------
 * `summary` comes from `describeCalibration` and is printed as-is. That is the
 * single most important decision in this file. The server already refuses to
 * claim a direction below six compared outcomes, already says "not enough
 * measured outcomes yet" as a whole sentence rather than a hedged claim, and
 * already never says a decision was good or bad (BI178). A client that
 * paraphrased would eventually paraphrase the refusal away — "trending
 * optimistic (early data)" is exactly the sentence the floor exists to prevent,
 * and nothing would catch it.
 *
 * The numbers beside each line are shown only when the server marked the metric
 * `calibrated`, because that is the flag that says they mean anything.
 *
 * WHY BEHIND DEALS
 * ----------------
 * The decisions being calibrated are offers, passes and acquisitions, so this
 * belongs with them. It is NOT on Today: Today is for what needs attention now,
 * and a calibration is a reference view you consult, not a task. Five fixed
 * doors — this is a section behind an existing one, never a sixth entry.
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { motion } from "framer-motion";
import { Target } from "lucide-react";

/** Mirrors `MetricCalibration` in shared/outcomes/calibration.ts. */
interface MetricCalibration {
  metricId: string;
  label: string;
  unit: string;
  comparedCount: number;
  unmeasuredCount: number;
  unscaledCount: number;
  state: "calibrated" | "insufficient";
  medianRelativeError?: number;
  medianDelta?: number;
  bias?: "optimistic" | "pessimistic" | "centred";
  majorityDirectionCount?: number;
  directionProbability?: number;
  factors: string[];
}

interface CalibrationResponse {
  calibration: {
    shapeVersion: number;
    outcomeCount: number;
    metrics: MetricCalibration[];
  };
  /** One honest line per metric, from the server's describeCalibration. */
  summary: string[];
  minComparisonsForDirection: number;
}

/**
 * The badge for a metric's direction.
 *
 * `centred` and `insufficient` deliberately look the same as each other and
 * quieter than a real finding — neither is a result, and styling "not enough
 * data" like a conclusion is how a reader comes away with one.
 */
function biasTone(m: MetricCalibration): "default" | "secondary" | "outline" {
  if (m.state !== "calibrated" || m.bias === "centred") return "outline";
  return "secondary";
}

function biasLabel(m: MetricCalibration): string {
  if (m.state !== "calibrated") return "not enough yet";
  if (m.bias === "centred") return "no clear direction";
  return m.bias === "optimistic" ? "runs optimistic" : "runs conservative";
}

export function ForecastCalibration() {
  const { data, isLoading, isError, error, refetch } = useQuery<CalibrationResponse>({
    queryKey: ["/api/decisions/calibration"],
  });

  if (isLoading) {
    return (
      <Card className="rounded-card shadow-acr-1">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">How your forecasts are tracking</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="rounded-card shadow-acr-1">
        <CardContent className="py-6">
          <QueryErrorState error={error ?? null} onRetry={() => refetch()} />
        </CardContent>
      </Card>
    );
  }

  const metrics = data?.calibration.metrics ?? [];
  const summary = data?.summary ?? [];
  const outcomeCount = data?.calibration.outcomeCount ?? 0;
  const floor = data?.minComparisonsForDirection ?? 6;

  if (metrics.length === 0) {
    return (
      <Card className="rounded-card shadow-acr-1">
        <CardContent className="py-2">
          <EmptyState
            icon={Target}
            headline="Nothing to compare yet"
            subtitle={`Once you've recorded what actually happened on ${floor} decisions that carried a forecast, this shows whether your numbers tend to land high, low or about right — per metric, not as one score.`}
            tone="default"
            tips={[
              "Answer the “What happened?” card on Today — that is what feeds this.",
              "It reports nothing until the data can support it, rather than guessing early.",
            ]}
            cta={{ label: "Go to Today", href: "/today" }}
            testId="forecast-calibration-empty"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-card shadow-acr-1" data-testid="forecast-calibration">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4" aria-hidden="true" />
          How your forecasts are tracking
        </CardTitle>
        <Badge variant="outline" data-testid="forecast-calibration-outcomes">
          {outcomeCount} recorded
        </Badge>
      </CardHeader>
      <CardContent>
        <motion.ul
          className="space-y-4"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {metrics.map((m, i) => (
            <motion.li
              key={m.metricId}
              variants={staggerItem}
              data-testid={`calibration-${m.metricId}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  {/* The server's own sentence, verbatim. See the file header:
                      paraphrasing is how a refusal becomes a hedged claim. */}
                  <p className="text-sm leading-snug">{summary[i] ?? m.label}</p>
                  {/* The factors say WHY — how many outcomes, how lopsided, how
                      many were predicted and never measured. Shown always,
                      including when refusing, so "not enough yet" is never a
                      bare assertion. */}
                  <p className="text-xs text-muted-foreground">
                    {m.factors.join(" · ")}
                  </p>
                </div>
                <Badge variant={biasTone(m)} className="shrink-0">
                  {biasLabel(m)}
                </Badge>
              </div>
            </motion.li>
          ))}
        </motion.ul>
        <p className="mt-4 text-xs text-muted-foreground">
          Directions are only claimed once {floor} outcomes can distinguish one
          from chance. Nothing here says a decision was right or wrong — a good
          decision can have a bad outcome.
        </p>
      </CardContent>
    </Card>
  );
}
