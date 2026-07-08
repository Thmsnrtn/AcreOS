/**
 * Supersede modal for /founder/asks — marks an ask no-longer-relevant with a
 * required reason.
 *
 * Extracted verbatim from client/src/pages/founder/asks.tsx (W3-5
 * decomposition) — behavior unchanged.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
import { truncate, type FounderAsk } from "./ask-shared";
import { Verbs } from "@/lib/labels";

interface SupersedeAskDialogProps {
  ask: FounderAsk | null;
  onClose: () => void;
  onSubmitted: () => void;
}

export function SupersedeAskDialog({
  ask,
  onClose,
  onSubmitted,
}: SupersedeAskDialogProps) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");

  // allow-no-invalidation: onSuccess calls the parent's onSubmitted() prop, which refreshes the asks list
  const mutation = useMutation({
    mutationFn: async (input: { askId: number; reason: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/founder/asks/${input.askId}/supersede`,
        { reason: input.reason },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message || `Supersede failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (_data, vars) => {
      toast({ title: `Ask #${vars.askId} superseded` });
      onSubmitted();
    },
    onError: (error) => {
      toast({
        title: getErrorTitle(error),
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  if (!ask) return null;

  const submit = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      toast({
        title: "Reason required",
        description: "Please explain why this ask is no longer relevant.",
        variant: "destructive",
      });
      return;
    }
    mutation.mutate({ askId: ask.id, reason: trimmed });
  };

  return (
    <Dialog
      open={ask !== null}
      onOpenChange={(o) => {
        if (!o) {
          setReason("");
          onClose();
        }
      }}
    >
      <DialogContent
        className="max-w-md"
        aria-labelledby={`supersede-ask-${ask.id}-title`}
        data-testid={`dialog-supersede-${ask.id}`}
      >
        <DialogHeader>
          <DialogTitle id={`supersede-ask-${ask.id}-title`}>
            Supersede this ask?
          </DialogTitle>
          <DialogDescription>
            Mark this ask as no-longer-relevant. The agent won't get an answer
            — your reason is recorded for the agent's context.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            <span className="font-mono">{ask.askingAgentRole}</span>:{" "}
            <span className="italic">{truncate(ask.questionSummary, 100)}</span>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`supersede-reason-${ask.id}`}>
              Reason (required)
            </Label>
            <Textarea
              id={`supersede-reason-${ask.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. situation changed — already shipped a different fix"
              data-testid={`textarea-supersede-reason-${ask.id}`}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setReason("");
              onClose();
            }}
            data-testid="button-supersede-cancel"
            aria-label="Cancel supersede"
          >
            {Verbs.CANCEL}
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={mutation.isPending}
            data-testid={`button-supersede-submit-${ask.id}`}
            aria-label="Confirm supersede"
          >
            {mutation.isPending ? "Submitting…" : "Supersede"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
