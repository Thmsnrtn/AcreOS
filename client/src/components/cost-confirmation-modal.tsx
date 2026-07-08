import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CreditCard, Plus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { CreditPurchaseModal } from "@/components/credit-purchase-modal";
import { usd } from "@/lib/format";
import { Verbs } from "@/lib/labels";

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
              <CreditCard className="w-5 h-5" aria-hidden="true" />
              Confirm action cost
            </DialogTitle>
            <DialogDescription>
              {actionDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {isEstimating ? (
              <div role="status" aria-live="polite" aria-busy="true" className="space-y-3 py-2">
                <span className="sr-only">Estimating cost…</span>
                <div className="flex justify-between items-center py-2 border-b">
                  <Skeleton announce={false} className="h-4 w-28" />
                  <Skeleton announce={false} className="h-5 w-16" />
                </div>
                <div className="flex justify-between items-center py-2">
                  <Skeleton announce={false} className="h-4 w-32" />
                  <Skeleton announce={false} className="h-5 w-16" />
                </div>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">Estimated cost</span>
                  <span className="font-medium tabular-nums" data-testid="text-estimated-cost">
                    {usd(estimatedCost / 100)}
                  </span>
                </div>

                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">Current balance</span>
                  <span className="font-medium tabular-nums" data-testid="text-current-balance">
                    {usd(balance / 100)}
                  </span>
                </div>

                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-muted-foreground">Balance after</span>
                  <span
                    className={`font-medium tabular-nums ${hasInsufficientCredits ? "text-destructive" : ""}`}
                    data-testid="text-balance-after"
                  >
                    {usd((balance - estimatedCost) / 100)}
                  </span>
                </div>

                {hasInsufficientCredits && (
                  <div role="alert" className="flex items-start gap-3 p-3 rounded-md bg-acr-warn-soft dark:bg-acr-warn-soft/50 border border-acr-warn-soft dark:border-acr-warn-soft">
                    <AlertTriangle className="w-5 h-5 text-acr-warn dark:text-acr-warn flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="space-y-2">
                      <p className="text-sm text-acr-warn dark:text-acr-warn">
                        You don't have enough credits for this action.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPurchaseModalOpen(true)}
                        data-testid="button-add-credits-inline"
                      >
                        <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
                        Add credits
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
              {Verbs.CANCEL}
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={isEstimating || hasInsufficientCredits}
              data-testid="button-confirm-action"
            >
              {Verbs.CONFIRM}
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
