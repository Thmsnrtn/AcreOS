/**
 * confirmation_request artifact — the KEY component for destructive ops.
 *
 * When Atlas calls a destructive tool, the backend returns this artifact
 * INSTEAD of executing. Apple-grade redesign: an inline destructive-op
 * gate. Warm amber rail, calm typography, a primary destructive-tinted
 * Confirm and a quieter Cancel. The action preview is the hero, the
 * raw arg JSON expands in place — never a modal.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Check, ChevronDown, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useChatCancel, useChatConfirm } from "@/hooks/use-founder-chat";
import { ThinkingDots } from "@/components/founder-chat/ThinkingDots";
import { CROSS_FADE, SPRING_INTERACTIVE, TAP_PRESS } from "@/lib/motion";
import { TOUCH_TARGET_PT } from "@/lib/spacing";
import { cn } from "@/lib/utils";

interface ConfirmationRequestProps {
  requestId: string;
  toolCall: { name: string; args: Record<string, unknown> };
  preview: string;
  warning?: string;
}

export function ConfirmationRequestArtifact({
  requestId,
  toolCall,
  preview,
  warning,
}: ConfirmationRequestProps) {
  const [resolved, setResolved] = useState<"confirmed" | "cancelled" | null>(null);
  const [argsOpen, setArgsOpen] = useState(false);
  const confirmMut = useChatConfirm();
  const cancelMut = useChatCancel();
  const { toast } = useToast();

  const handle = async (kind: "confirmed" | "cancelled") => {
    try {
      if (kind === "confirmed") {
        await confirmMut.mutateAsync(requestId);
      } else {
        await cancelMut.mutateAsync(requestId);
      }
      setResolved(kind);
      toast({
        title: kind === "confirmed" ? "Confirmed" : "Cancelled",
        description: toolCall.name,
      });
    } catch (err) {
      toast({
        title: "Failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const argsJson = JSON.stringify(toolCall.args, null, 2);
  const pending = confirmMut.isPending || cancelMut.isPending;

  return (
    <Card
      className={cn(
        "border border-acr-warn/30 bg-acr-warn-soft/20 overflow-hidden",
        "shadow-none",
      )}
      role="alertdialog"
      aria-labelledby={`confirm-title-${requestId}`}
      data-testid={`artifact-confirmation-${requestId}`}
    >
      {/* Warm rail along the top — the visual signal that this is gated. */}
      <div
        aria-hidden="true"
        className="h-0.5 w-full bg-acr-warn/70"
      />
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-acr-warn/15"
          >
            <AlertTriangle
              className="w-4 h-4 text-acr-warn"
              aria-hidden="true"
              strokeWidth={1.5}
            />
          </span>
          <div className="space-y-1.5 flex-1 min-w-0">
            <h4
              id={`confirm-title-${requestId}`}
              className="text-base font-semibold leading-snug text-foreground"
            >
              Confirm destructive action
            </h4>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {preview}
            </p>
            <Badge
              variant="secondary"
              className="font-mono text-[10px] bg-background/60 text-muted-foreground border-transparent"
            >
              {toolCall.name}
            </Badge>
          </div>
        </div>

        {warning && (
          <p
            className="text-xs text-acr-warn font-medium leading-relaxed pl-11"
            role="note"
          >
            {warning}
          </p>
        )}

        {/* Inline expansion — never a modal. */}
        <div className="pl-11">
          <button
            type="button"
            onClick={() => setArgsOpen((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground",
              "transition-colors duration-200",
            )}
            aria-expanded={argsOpen}
            data-testid={`confirm-toggle-args-${requestId}`}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "w-3 h-3 transition-transform duration-200",
                argsOpen && "rotate-180",
              )}
              strokeWidth={1.75}
            />
            {argsOpen ? "Hide parameters" : "Show parameters"}
          </button>
          <AnimatePresence initial={false}>
            {argsOpen && (
              <motion.div
                key="args"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                className="overflow-hidden"
              >
                <pre className="mt-2 p-3 rounded-md bg-muted/60 overflow-x-auto text-[11px] font-mono leading-relaxed tabular-nums">
                  {argsJson}
                </pre>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {resolved ? (
            <motion.div
              key="resolved"
              initial={CROSS_FADE.initial}
              animate={CROSS_FADE.animate}
              exit={CROSS_FADE.exit}
              className={cn(
                "text-sm font-medium pl-11",
                resolved === "confirmed" ? "text-acr-pos" : "text-muted-foreground",
              )}
              role="status"
              aria-live="polite"
            >
              {resolved === "confirmed" ? "Confirmed — executing." : "Cancelled."}
            </motion.div>
          ) : (
            <motion.div
              key="actions"
              initial={CROSS_FADE.initial}
              animate={CROSS_FADE.animate}
              exit={CROSS_FADE.exit}
              className="flex gap-2 flex-wrap pl-11"
            >
              <motion.div whileTap={pending ? undefined : TAP_PRESS} transition={SPRING_INTERACTIVE}>
                <Button
                  size="default"
                  variant="default"
                  disabled={pending}
                  onClick={() => handle("confirmed")}
                  aria-label="Confirm and execute"
                  className="bg-acr-warn text-white hover:bg-acr-warn/90"
                  style={{ minHeight: TOUCH_TARGET_PT }}
                  data-testid={`confirm-confirm-${requestId}`}
                >
                  {confirmMut.isPending ? (
                    <ThinkingDots size="sm" aria-label="Confirming" />
                  ) : (
                    <Check className="w-4 h-4" aria-hidden="true" strokeWidth={1.75} />
                  )}
                  <span className="ml-1.5">Confirm</span>
                </Button>
              </motion.div>
              <motion.div whileTap={pending ? undefined : TAP_PRESS} transition={SPRING_INTERACTIVE}>
                <Button
                  size="default"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => handle("cancelled")}
                  aria-label="Cancel action"
                  className="text-muted-foreground"
                  style={{ minHeight: TOUCH_TARGET_PT }}
                  data-testid={`confirm-cancel-${requestId}`}
                >
                  {cancelMut.isPending ? (
                    <ThinkingDots size="sm" aria-label="Cancelling" />
                  ) : (
                    <X className="w-4 h-4" aria-hidden="true" strokeWidth={1.5} />
                  )}
                  <span className="ml-1.5">Cancel</span>
                </Button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

export default ConfirmationRequestArtifact;
