/**
 * trigger_card artifact — single revenue trigger with [Approve] [Defer]
 * inline buttons.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Clock, TrendingUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ThinkingDots } from "@/components/founder-chat/ThinkingDots";
import { CROSS_FADE, SPRING_INTERACTIVE, TAP_PRESS } from "@/lib/motion";
import type { RevenueTrigger } from "@shared/founder-chat/artifacts";

interface TriggerCardProps {
  trigger: RevenueTrigger;
  actions?: Array<"approve" | "defer">;
}

function fmt(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round((cents ?? 0) / 100));
}

export function TriggerCardArtifact({
  trigger,
  actions = ["approve", "defer"],
}: TriggerCardProps) {
  const [pending, setPending] = useState<"approve" | "defer" | null>(null);
  const [resolved, setResolved] = useState<"approved" | "deferred" | null>(null);
  const { toast } = useToast();

  const handle = async (kind: "approve" | "defer") => {
    setPending(kind);
    try {
      const tid = trigger.thresholdId ?? trigger.id;
      const url =
        kind === "approve"
          ? `/api/founder/triggers/${encodeURIComponent(String(tid))}/approve`
          : `/api/founder/triggers/${encodeURIComponent(String(tid))}/defer`;
      await apiRequest("POST", url, kind === "defer" ? { days: 7 } : {});
      setResolved(kind === "approve" ? "approved" : "deferred");
      toast({
        title: kind === "approve" ? "Trigger approved" : "Trigger deferred",
        description: trigger.title,
      });
    } catch (err) {
      toast({
        title: "Action failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setPending(null);
    }
  };

  const delta =
    typeof trigger.preCents === "number" && typeof trigger.postCents === "number"
      ? trigger.postCents - trigger.preCents
      : null;

  return (
    <Card
      className="border-l-2 border-l-acr-pos/60"
      data-testid={`artifact-trigger-${trigger.id}`}
    >
      <CardContent className="p-4 space-y-3">
        <div className="space-y-1">
          <div className="flex items-start gap-2 flex-wrap">
            <h4 className="text-sm font-semibold leading-snug flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-acr-pos" aria-hidden="true" />
              {trigger.title}
            </h4>
            {trigger.kind && (
              <Badge variant="secondary" className="text-micro">
                {trigger.kind}
              </Badge>
            )}
            {delta !== null && (
              <Badge
                variant="secondary"
                className={
                  "text-micro tabular-nums " +
                  (delta >= 0
                    ? "bg-acr-pos-soft text-acr-pos border-transparent"
                    : "bg-acr-neg-soft text-acr-neg border-transparent")
                }
              >
                {delta >= 0 ? "+" : ""}
                {fmt(delta)}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {trigger.rationale}
          </p>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {resolved ? (
            <motion.div
              key="resolved"
              initial={CROSS_FADE.initial}
              animate={CROSS_FADE.animate}
              exit={CROSS_FADE.exit}
              className={
                "text-sm font-medium " +
                (resolved === "approved" ? "text-acr-pos" : "text-acr-warn")
              }
              role="status"
              aria-live="polite"
            >
              {resolved === "approved" ? "Approved." : "Deferred 7 days."}
            </motion.div>
          ) : (
            <motion.div
              key="actions"
              initial={CROSS_FADE.initial}
              animate={CROSS_FADE.animate}
              exit={CROSS_FADE.exit}
              className="flex gap-2 flex-wrap"
            >
              {actions.includes("approve") && (
                <motion.div whileTap={pending ? undefined : TAP_PRESS} transition={SPRING_INTERACTIVE}>
                  <Button
                    size="sm"
                    variant="default"
                    disabled={!!pending}
                    onClick={() => handle("approve")}
                    aria-label={`Approve ${trigger.title}`}
                    data-testid={`trigger-approve-${trigger.id}`}
                  >
                    {pending === "approve" ? (
                      <ThinkingDots size="sm" aria-label="Approving" />
                    ) : (
                      <Check className="w-3.5 h-3.5" aria-hidden="true" strokeWidth={1.75} />
                    )}
                    <span className="ml-1">Approve</span>
                  </Button>
                </motion.div>
              )}
              {actions.includes("defer") && (
                <motion.div whileTap={pending ? undefined : TAP_PRESS} transition={SPRING_INTERACTIVE}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!pending}
                    onClick={() => handle("defer")}
                    aria-label={`Defer ${trigger.title}`}
                    data-testid={`trigger-defer-${trigger.id}`}
                  >
                    {pending === "defer" ? (
                      <ThinkingDots size="sm" aria-label="Deferring" />
                    ) : (
                      <Clock className="w-3.5 h-3.5" aria-hidden="true" strokeWidth={1.5} />
                    )}
                    <span className="ml-1">Defer</span>
                  </Button>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

export default TriggerCardArtifact;
