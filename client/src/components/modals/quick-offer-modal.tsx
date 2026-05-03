/**
 * Quick Offer modal — ⌘N entry point per HANDOFF demo script step 3
 * ("Click 'Draft offer' → modal opens, prefilled with Atlas-suggested amount").
 *
 * Distinct from the full /blind-offer-wizard (which captures county +
 * comps + sellerProfile). This modal is the fast path: paste a parcel
 * ID, see Atlas's suggested band, send a written offer in under 30
 * seconds (per landing copy: "Generate written offers in 30 seconds.
 * Atlas defends the price.").
 *
 * Opens via useModals().openQuickOffer(parcelId?). Triggers:
 * - ⌘N keyboard (registered in use-keyboard-shortcuts)
 * - Sidebar header trigger with data-tour="quick-offer"
 * - Programmatic from any place that has a parcel context
 */
import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useModals } from "@/stores/modal-store";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Sparkles, Send, Loader2 } from "lucide-react";

interface AtlasSuggestion {
  recommendedOfferTotal: number;
  baseOfferTotal: number;
  confidence: "low" | "medium" | "high";
  rationale?: string;
}

export function QuickOfferModal() {
  const open = useModals((s) => s.quickOffer.open);
  const parcelId = useModals((s) => s.quickOffer.parcelId);
  const close = useModals((s) => s.closeQuickOffer);
  const { toast } = useToast();

  const [parcelInput, setParcelInput] = useState("");
  const [amount, setAmount] = useState("");
  const [suggestion, setSuggestion] = useState<AtlasSuggestion | null>(null);

  // Reset state when opening fresh
  useEffect(() => {
    if (open) {
      setParcelInput(parcelId ?? "");
      setAmount("");
      setSuggestion(null);
    }
  }, [open, parcelId]);

  const analyzeMutation = useMutation({
    mutationFn: async (parcel: string): Promise<AtlasSuggestion> => {
      const res = await apiRequest("POST", "/api/atlas/analyze", { parcelId: parcel });
      if (!res.ok) throw new Error("Pax analysis failed");
      const data = await res.json();
      return {
        recommendedOfferTotal: data.recommendedOfferTotal ?? data.suggestedOffer ?? 0,
        baseOfferTotal: data.baseOfferTotal ?? data.recommendedOfferTotal ?? 0,
        confidence: data.confidence ?? "medium",
        rationale: data.rationale,
      };
    },
    onSuccess: (data) => {
      setSuggestion(data);
      setAmount(String(data.recommendedOfferTotal));
    },
    onError: () => {
      toast({
        title: "Pax didn't return a suggestion",
        description: "You can still enter an amount manually.",
        variant: "destructive",
      });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/offers", {
        parcelId: parcelInput,
        amount: Number(amount),
        source: "quick-offer",
      });
      if (!res.ok) throw new Error("Couldn't send offer");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Offer sent",
        description: `Pax queued a written offer for ${parcelInput}.`,
      });
      close();
    },
    onError: (e: Error) => {
      toast({
        title: "Couldn't send the offer",
        description: e.message || "Try again — your draft is saved.",
        variant: "destructive",
      });
    },
  });

  const canSend = parcelInput.trim().length > 0 && Number(amount) > 0 && !sendMutation.isPending;
  const canAnalyze = parcelInput.trim().length > 0 && !analyzeMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sm:max-w-md" data-testid="quick-offer-modal">
        <DialogHeader>
          <DialogTitle>Quick offer</DialogTitle>
          <DialogDescription>
            Paste a parcel ID. Pax suggests the price and sends the letter.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="quick-offer-parcel">Parcel</Label>
            <Input
              id="quick-offer-parcel"
              value={parcelInput}
              onChange={(e) => setParcelInput(e.target.value)}
              placeholder="e.g. APN 304-12-456"
              autoFocus
              data-testid="input-quick-offer-parcel"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="quick-offer-amount">Offer amount (USD)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!canAnalyze}
                onClick={() => analyzeMutation.mutate(parcelInput.trim())}
                data-testid="button-quick-offer-suggest"
                className="h-7 text-xs"
              >
                {analyzeMutation.isPending ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="w-3 h-3 mr-1" aria-hidden="true" />
                )}
                Suggest
              </Button>
            </div>
            <Input
              id="quick-offer-amount"
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              data-testid="input-quick-offer-amount"
            />
            {suggestion && (
              <p className="text-xs text-muted-foreground">
                Suggested band: ${suggestion.baseOfferTotal.toLocaleString()}–
                ${suggestion.recommendedOfferTotal.toLocaleString()} ·{" "}
                <span className="capitalize">{suggestion.confidence}</span> confidence
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-4 border-t mt-4">
          <Button variant="ghost" onClick={close} data-testid="button-quick-offer-cancel">
            Cancel
          </Button>
          <Button
            onClick={() => sendMutation.mutate()}
            disabled={!canSend}
            data-testid="button-quick-offer-send"
          >
            {sendMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="w-4 h-4 mr-2" aria-hidden="true" />
            )}
            Send offer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
