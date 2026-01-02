import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreditPurchaseModal } from "@/components/credit-purchase-modal";

const LOW_BALANCE_THRESHOLD = 200; // $2.00 in cents

export function LowBalanceAlert() {
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);

  const { data: balanceData } = useQuery<{ balance: number }>({
    queryKey: ["/api/credits/balance"],
  });

  const balance = balanceData?.balance ?? 0;
  const isLowBalance = balance < LOW_BALANCE_THRESHOLD;

  if (!isLowBalance) {
    return null;
  }

  return (
    <>
      <div 
        className="flex items-center justify-between gap-4 px-4 py-3 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800"
        data-testid="alert-low-balance"
      >
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            <span className="font-medium">Low credit balance:</span>{" "}
            ${(balance / 100).toFixed(2)} remaining. Add credits to continue using AI features, emails, and SMS.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setPurchaseModalOpen(true)}
          className="flex-shrink-0"
          data-testid="button-add-credits"
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Credits
        </Button>
      </div>

      <CreditPurchaseModal
        open={purchaseModalOpen}
        onOpenChange={setPurchaseModalOpen}
      />
    </>
  );
}
