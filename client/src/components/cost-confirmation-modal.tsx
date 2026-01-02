import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, CreditCard, Plus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { CreditPurchaseModal } from "@/components/credit-purchase-modal";

interface CostConfirmationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actionType: string;
  actionDescription: string;
  quantity: number;
  onConfirm: () => void;
}

export function CostConfirmationModal({
  open,
  onOpenChange,
  actionType,
  actionDescription,
  quantity,
  onConfirm,
}: CostConfirmationProps) {
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);

  const { data: balanceData } = useQuery<{ balance: number }>({
    queryKey: ["/api/credits/balance"],
    enabled: open,
  });

  const { data: estimateData, isLoading: isEstimating } = useQuery<{ estimatedCost: number }>({
    queryKey: ["/api/usage/estimate", actionType, quantity],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/usage/estimate", { actionType, quantity });
      if (!res.ok) {
        throw new Error("Failed to get cost estimate");
      }
      return res.json();
    },
    enabled: open && !!actionType && quantity > 0,
  });

  const balance = balanceData?.balance ?? 0;
  const estimatedCost = estimateData?.estimatedCost ?? 0;
  const hasInsufficientCredits = balance < estimatedCost;

  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="w-5 h-5" />
              Confirm Action Cost
            </DialogTitle>
            <DialogDescription>
              {actionDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {isEstimating ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">Estimated Cost</span>
                  <span className="font-medium" data-testid="text-estimated-cost">
                    ${(estimatedCost / 100).toFixed(2)}
                  </span>
                </div>

                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">Current Balance</span>
                  <span className="font-medium" data-testid="text-current-balance">
                    ${(balance / 100).toFixed(2)}
                  </span>
                </div>

                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-muted-foreground">Balance After</span>
                  <span 
                    className={`font-medium ${hasInsufficientCredits ? "text-destructive" : ""}`}
                    data-testid="text-balance-after"
                  >
                    ${((balance - estimatedCost) / 100).toFixed(2)}
                  </span>
                </div>

                {hasInsufficientCredits && (
                  <div className="flex items-start gap-3 p-3 rounded-md bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800">
                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
                    <div className="space-y-2">
                      <p className="text-sm text-amber-800 dark:text-amber-200">
                        You don't have enough credits for this action.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPurchaseModalOpen(true)}
                        data-testid="button-add-credits-inline"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Add Credits
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-action"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={isEstimating || hasInsufficientCredits}
              data-testid="button-confirm-action"
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreditPurchaseModal
        open={purchaseModalOpen}
        onOpenChange={setPurchaseModalOpen}
      />
    </>
  );
}
