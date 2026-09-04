/**
 * decision_card artifact — single decision-queue item with inline
 * [Approve] [Reject] [Investigate] buttons.
 *
 * Click handlers POST to the existing decision endpoints. Decision IDs
 * match the legacy /api/founder/decisions/:id/... routes that the
 * Now-surface already uses.
 */
import { useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ThinkingDots } from "@/components/founder-chat/ThinkingDots";
import { CROSS_FADE, SPRING_INTERACTIVE, TAP_PRESS } from "@/lib/motion";
import type { DecisionItem } from "@shared/founder-chat/artifacts";

interface DecisionCardProps {
  item: DecisionItem;
  actions?: Array<"approve" | "reject" | "investigate">;
}

type PendingAction = "approve" | "reject" | null;

export function DecisionCardArtifact({
  item,
  actions = ["approve", "reject", "investigate"],
}: DecisionCardProps) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [resolved, setResolved] = useState<"approved" | "rejected" | null>(null);
  const { toast } = useToast();

  const handle = async (kind: "approve" | "reject") => {
    setPending(kind);
    try {
      const verb = kind === "approve" ? "approve" : "reject";
      await apiRequest(
        "POST",
        `/api/founder/decisions/${encodeURIComponent(String(item.id))}/${verb}`,
        kind === "reject" ? { reason: "Rejected from chat" } : {},
      );
      setResolved(kind === "approve" ? "approved" : "rejected");
      toast({
        title: kind === "approve" ? "Approved" : "Rejected",
        description: item.title,
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

  return (
    <Card
      className="border-l-2 border-l-acr-brand/60"
      data-testid={`artifact-decision-${item.id}`}
    >
      <CardContent className="p-4 space-y-3">
        <div className="space-y-1">
          <div className="flex items-start gap-2 flex-wrap">
            <h4 className="text-sm font-semibold leading-snug">{item.title}</h4>
            {item.ownerAgentCodename && (
              <Badge
                variant="secondary"
                className="text-micro bg-acr-brand-soft text-acr-brand-soft-ink border-transparent"
              >
                {item.ownerAgentCodename}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{item.summary}</p>
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
                (resolved === "approved" ? "text-acr-pos" : "text-acr-neg")
              }
              role="status"
              aria-live="polite"
            >
              {resolved === "approved" ? "Approved." : "Rejected."}
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
                    aria-label={`Approve ${item.title}`}
                    data-testid={`decision-approve-${item.id}`}
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
              {actions.includes("reject") && (
                <motion.div whileTap={pending ? undefined : TAP_PRESS} transition={SPRING_INTERACTIVE}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!pending}
                    onClick={() => handle("reject")}
                    aria-label={`Reject ${item.title}`}
                    data-testid={`decision-reject-${item.id}`}
                  >
                    {pending === "reject" ? (
                      <ThinkingDots size="sm" aria-label="Rejecting" />
                    ) : (
                      <X className="w-3.5 h-3.5" aria-hidden="true" strokeWidth={1.5} />
                    )}
                    <span className="ml-1">Reject</span>
                  </Button>
                </motion.div>
              )}
              {actions.includes("investigate") && item.inspectorHref && (
                <Button size="sm" variant="ghost" asChild>
                  <Link href={item.inspectorHref} aria-label={`Investigate ${item.title}`}>
                    <Search className="w-3.5 h-3.5" aria-hidden="true" strokeWidth={1.5} />
                    <span className="ml-1">Investigate</span>
                  </Link>
                </Button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

export default DecisionCardArtifact;
