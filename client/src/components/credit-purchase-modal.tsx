import { useState, useId } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CreditCard, Check } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Verbs } from "@/lib/labels";

const CREDIT_PACKS = [
  { id: "pack_10", name: "$10", credits: 1000, price: 10 },
  { id: "pack_25", name: "$25", credits: 2500, price: 25 },
  { id: "pack_50", name: "$50", credits: 5000, price: 50 },
  { id: "pack_100", name: "$100", credits: 10000, price: 100 },
] as const;

interface CreditPurchaseModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreditPurchaseModal({ open, onOpenChange }: CreditPurchaseModalProps) {
  const { toast } = useToast();
  const [selectedPack, setSelectedPack] = useState<string>("pack_25");
  const groupLabelId = useId();

  // allow-no-invalidation: redirects to Stripe checkout (window.location.href) — cache resets on return
  const purchaseMutation = useMutation({
    mutationFn: async (packId: string) => {
      const res = await apiRequest("POST", "/api/credits/purchase", { packId }, { idempotent: true });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create checkout session");
      }
      return res.json();
    },
    onSuccess: (data) => {
      // Server returns the Stripe Checkout URL as `checkoutUrl`; reading `url`
      // meant the redirect never fired and the customer could never actually
      // pay (the mutation succeeded silently). Accept both keys defensively.
      const url = data.checkoutUrl ?? data.url;
      if (url) {
        window.location.href = url;
      } else {
        toast({
          title: "Couldn't open checkout",
          description: "The purchase couldn't be started. Try again or contact support.",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't start purchase",
        description: `${error.message} — your selection is preserved. Try again or contact support.`,
        variant: "destructive",
      });
    },
  });

  const handlePurchase = () => {
    purchaseMutation.mutate(selectedPack);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle id={groupLabelId} className="flex items-center gap-2">
            <CreditCard className="w-5 h-5" aria-hidden="true" />
            Purchase credits
          </DialogTitle>
          <DialogDescription>
            Select a credit pack to add to your account. Credits can be used for emails, SMS, AI features, and more.
          </DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-labelledby={groupLabelId} className="grid grid-cols-2 gap-3 py-4">
          {CREDIT_PACKS.map((pack) => {
            const isSelected = selectedPack === pack.id;
            return (
              <Card
                key={pack.id}
                role="radio"
                aria-checked={isSelected}
                aria-label={`${pack.name} pack: ${pack.credits.toLocaleString()} credits, $${(pack.credits / 100).toFixed(0)} value`}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => setSelectedPack(pack.id)}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    setSelectedPack(pack.id);
                  }
                }}
                className={`cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  isSelected ? "ring-2 ring-primary" : ""
                }`}
                data-testid={`card-pack-${pack.id}`}
              >
                <CardContent className="p-4 text-center relative">
                  {isSelected && (
                    <div className="absolute top-2 right-2" aria-hidden="true">
                      <Check className="w-4 h-4 text-primary" aria-hidden="true" />
                    </div>
                  )}
                  <div aria-hidden="true" className="text-2xl font-bold tabular-nums">{pack.name}</div>
                  <div aria-hidden="true" className="text-sm text-muted-foreground mt-1 tabular-nums">
                    {pack.credits.toLocaleString()} credits
                  </div>
                  <Badge aria-hidden="true" variant="secondary" className="mt-2 tabular-nums">
                    ${(pack.credits / 100).toFixed(0)} value
                  </Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={purchaseMutation.isPending}
            data-testid="button-cancel-purchase"
          >
            {Verbs.CANCEL}
          </Button>
          <Button
            type="button"
            onClick={handlePurchase}
            disabled={purchaseMutation.isPending}
            aria-busy={purchaseMutation.isPending}
            aria-label={purchaseMutation.isPending ? "Starting purchase" : `Purchase ${CREDIT_PACKS.find(p => p.id === selectedPack)?.name || ""} credit pack`}
            data-testid="button-confirm-purchase"
          >
            {purchaseMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
            ) : (
              <CreditCard className="w-4 h-4 mr-2" aria-hidden="true" />
            )}
            {purchaseMutation.isPending ? "Starting…" : "Purchase"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
