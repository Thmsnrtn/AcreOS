import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CreditCard, Check } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

  const purchaseMutation = useMutation({
    mutationFn: async (packId: string) => {
      const res = await apiRequest("POST", "/api/credits/purchase", { packId });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create checkout session");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Purchase Failed",
        description: error.message,
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
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            Purchase Credits
          </DialogTitle>
          <DialogDescription>
            Select a credit pack to add to your account. Credits can be used for emails, SMS, AI features, and more.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-4">
          {CREDIT_PACKS.map((pack) => (
            <Card
              key={pack.id}
              className={`cursor-pointer transition-all ${
                selectedPack === pack.id
                  ? "ring-2 ring-primary"
                  : ""
              }`}
              onClick={() => setSelectedPack(pack.id)}
              data-testid={`card-pack-${pack.id}`}
            >
              <CardContent className="p-4 text-center relative">
                {selectedPack === pack.id && (
                  <div className="absolute top-2 right-2">
                    <Check className="w-4 h-4 text-primary" />
                  </div>
                )}
                <div className="text-2xl font-bold">{pack.name}</div>
                <div className="text-sm text-muted-foreground mt-1">
                  {pack.credits.toLocaleString()} credits
                </div>
                <Badge variant="secondary" className="mt-2">
                  ${(pack.credits / 100).toFixed(0)} value
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={purchaseMutation.isPending}
            data-testid="button-cancel-purchase"
          >
            Cancel
          </Button>
          <Button
            onClick={handlePurchase}
            disabled={purchaseMutation.isPending}
            data-testid="button-confirm-purchase"
          >
            {purchaseMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <CreditCard className="w-4 h-4 mr-2" />
            )}
            Purchase
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
