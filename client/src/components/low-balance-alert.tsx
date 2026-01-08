import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreditPurchaseModal } from "@/components/credit-purchase-modal";

const LOW_BALANCE_THRESHOLD = 200; // $2.00 in cents
const DISMISS_KEY = "lowBalanceAlertDismissed";
const DISMISS_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

export function LowBalanceAlert() {
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const [isDismissed, setIsDismissed] = useState(true); // Start hidden, check localStorage

  useEffect(() => {
    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    if (dismissedAt) {
      const dismissedTime = parseInt(dismissedAt, 10);
      // Show again after 24 hours
      if (Date.now() - dismissedTime < DISMISS_DURATION) {
        setIsDismissed(true);
        return;
      }
    }
    setIsDismissed(false);
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
    setIsDismissed(true);
  };

  const { data: balanceData } = useQuery<{ balance: number }>({
    queryKey: ["/api/credits/balance"],
  });

  const balance = balanceData?.balance ?? 0;
  const isLowBalance = balance < LOW_BALANCE_THRESHOLD;

  if (!isLowBalance || isDismissed) {
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
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            size="sm"
            onClick={() => setPurchaseModalOpen(true)}
            data-testid="button-add-credits"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Credits
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleDismiss}
            className="text-amber-700 dark:text-amber-300"
            data-testid="button-dismiss-low-balance"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <CreditPurchaseModal
        open={purchaseModalOpen}
        onOpenChange={setPurchaseModalOpen}
      />
    </>
  );
}
