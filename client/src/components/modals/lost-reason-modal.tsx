/**
 * Lost Reason capture modal.
 *
 * Per HANDOFF §4: "window.__acr.openLost(deal)" → "useModals().openLostReason(deal)".
 * Fires when a deal is moved to a lost / cancelled stage so the team
 * can learn from misses without leaving flow.
 *
 * Reasons are intentionally short — long-form text discourages capture.
 * Free-text "Other" exists for the cases none of these fit.
 */
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useModals } from "@/stores/modal-store";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";
import { Verbs } from "@/lib/labels";

const REASONS = [
  { value: "seller_silent", label: "Seller went silent" },
  { value: "lost_to_competitor", label: "Lost to a competitor" },
  { value: "price_too_low", label: "My price was too low" },
  { value: "price_too_high", label: "Their price was too high" },
  { value: "title_issue", label: "Title / chain issue" },
  { value: "funding_fell_through", label: "Funding fell through" },
  { value: "not_a_fit", label: "Not actually a fit" },
  { value: "other", label: "Other" },
] as const;

type Reason = typeof REASONS[number]["value"];

export function LostReasonModal() {
  const open = useModals((s) => s.lostReason.open);
  const deal = useModals((s) => s.lostReason.deal);
  const close = useModals((s) => s.closeLostReason);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setReason(null);
      setNote("");
    }
  }, [open]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!deal || !reason) throw new Error("Pick a reason");
      const res = await apiRequest("POST", `/api/deals/${deal.id}/lost-reason`, {
        reason,
        note: note.trim() || undefined,
      });
      if (!res.ok) throw new Error("Couldn't save reason");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Logged",
        description: "Reason saved — Pax will learn from this.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      close();
    },
    onError: (e: Error) => {
      toast({
        title: "Couldn't save the reason",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sm:max-w-md" data-testid="lost-reason-modal">
        <DialogHeader>
          <DialogTitle>Why did this one slip?</DialogTitle>
          <DialogDescription>
            One click. Pax uses these patterns to suggest better offers next
            time. Skippable, but the patterns get better when you don't.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="grid grid-cols-2 gap-2 pt-2">
          <legend className="sr-only">Reason</legend>
          {REASONS.map((r) => (
            <label
              key={r.value}
              htmlFor={`lr-${r.value}`}
              className={`flex items-center gap-2 p-2.5 rounded-md border text-sm cursor-pointer transition-colors ${
                reason === r.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/30"
              }`}
              data-testid={`option-lost-${r.value}`}
            >
              <input
                id={`lr-${r.value}`}
                type="radio"
                name="lost-reason"
                value={r.value}
                checked={reason === r.value}
                onChange={() => setReason(r.value)}
                className="sr-only"
              />
              <span>{r.label}</span>
            </label>
          ))}
        </fieldset>

        <div className="pt-3">
          <Textarea
            aria-label="Additional notes on why this was lost"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything else worth remembering? (optional)"
            rows={2}
            data-testid="input-lost-note"
          />
        </div>

        <div className="flex items-center justify-between gap-2 pt-4 border-t mt-4">
          <Button variant="ghost" onClick={close} data-testid="button-lost-skip">
            Skip
          </Button>
          <Button
            onClick={() => submitMutation.mutate()}
            disabled={!reason || submitMutation.isPending}
            data-testid="button-lost-save"
          >
            {submitMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
            ) : null}
            {Verbs.SAVE}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
