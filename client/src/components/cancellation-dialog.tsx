import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, TrendingDown } from "lucide-react";
import {
  tierForSubscriptionTier,
  tierPriceCents,
  TIER_PRICES_CENTS,
  type Tier,
} from "@shared/billing/tier-pricing";

const CANCEL_REASONS = [
  { value: "too_expensive", label: "Too expensive for my needs" },
  { value: "not_using", label: "I'm not using it enough" },
  { value: "missing_features", label: "Missing features I need" },
  { value: "switching_competitor", label: "Switching to another tool" },
  { value: "other", label: "Other reason" },
] as const;

/**
 * Vesper §3 — given the customer's current tier, return the next-cheapest
 * paid tier we should suggest as a downgrade. Returns null when there's
 * nowhere lower to go (Starter customers can only cancel).
 *
 * The currentTier value comes from organizations.subscription_tier which
 * may use canonical starter/pro/scale labels OR the legacy
 * solo/operator/empire labels. tierForSubscriptionTier folds both sets
 * onto the canonical keys.
 */
function suggestedDowngradeTier(currentTier: string): Tier | null {
  const canonical = tierForSubscriptionTier(currentTier);
  if (canonical === "scale") return "pro";
  if (canonical === "pro") return "starter";
  // starter → no lower paid tier
  return null;
}

interface CancellationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTier: string;
  /**
   * Vesper §3 — invoked when the user clicks "Downgrade instead". The
   * parent surface should open the plan picker preselected to the
   * suggested tier. When omitted, the button is hidden (no-downgrade
   * surfaces shouldn't show the affordance).
   */
  onDowngrade?: (suggestedTier: Tier) => void;
}

export function CancellationDialog({ open, onOpenChange, currentTier, onDowngrade }: CancellationDialogProps) {
  const [step, setStep] = useState<"reason" | "confirm">("reason");
  const [reason, setReason] = useState<string>("");
  const [feedback, setFeedback] = useState("");
  const reasonGroupId = useId();
  const feedbackId = useId();
  const { toast } = useToast();

  const contextQuery = useQuery({
    queryKey: ["/api/subscription/cancellation-context"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/subscription/cancellation-context");
      return res.json();
    },
    enabled: open,
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/subscription/cancel", {
        reason,
        feedback: feedback || undefined,
      }, { idempotent: true });
      return res.json() as Promise<{ portalUrl?: string }>;
    },
    onSuccess: (data) => {
      if (data.portalUrl) {
        window.location.href = data.portalUrl;
      }
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't cancel subscription",
        description: `${err?.message ?? "Network error"} — your reason and feedback are preserved. Try again or contact support.`,
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    setStep("reason");
    setReason("");
    setFeedback("");
    onOpenChange(false);
  };

  // Vesper §3 — compute the suggested downgrade target and savings line.
  const suggestion = suggestedDowngradeTier(currentTier);
  const currentCanonical = tierForSubscriptionTier(currentTier);
  const monthlySavingsCents =
    suggestion && currentCanonical
      ? tierPriceCents(currentCanonical, "monthly") -
        tierPriceCents(suggestion, "monthly")
      : 0;
  const monthlySavingsDollars = Math.max(0, Math.round(monthlySavingsCents / 100));
  const suggestionDisplayName = suggestion ? TIER_PRICES_CENTS[suggestion].displayName : null;

  const handleDowngrade = () => {
    if (!suggestion || !onDowngrade) {
      handleClose();
      return;
    }
    onDowngrade(suggestion);
    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        {step === "reason" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-acr-warn" aria-hidden="true" />
                Cancel your subscription?
              </DialogTitle>
              <DialogDescription>
                We're sorry to see you go. Your feedback helps us improve.
              </DialogDescription>
            </DialogHeader>

            {contextQuery.data?.usage && (
              <section aria-labelledby="cancel-usage-heading" className="rounded-card border bg-muted/50 p-4 text-sm">
                <p id="cancel-usage-heading" className="font-medium mb-1 m-0">Your usage this month:</p>
                <ul aria-labelledby="cancel-usage-heading" className="space-y-1 text-muted-foreground list-none p-0 m-0">
                  {Object.entries(contextQuery.data.usage).map(([key, val]: [string, any]) => {
                    if (val?.used == null) return null;
                    const niceKey = key.replace(/([A-Z])/g, " $1");
                    return (
                      <li key={key} className="flex justify-between" aria-label={`${niceKey}: ${val.used} of ${val.limit} used`}>
                        <span className="capitalize" aria-hidden="true">{niceKey}</span>
                        <span className="font-mono tabular-nums" aria-hidden="true">{val.used} / {val.limit}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <div className="space-y-3">
              <Label id={reasonGroupId} className="text-sm font-medium">Why are you cancelling?</Label>
              <RadioGroup value={reason} onValueChange={setReason} aria-labelledby={reasonGroupId}>
                {CANCEL_REASONS.map((r) => (
                  <div key={r.value} className="flex items-center space-x-2">
                    <RadioGroupItem value={r.value} id={r.value} />
                    <Label htmlFor={r.value} className="font-normal cursor-pointer">{r.label}</Label>
                  </div>
                ))}
              </RadioGroup>

              <Label htmlFor={feedbackId} className="sr-only">Additional feedback</Label>
              <Textarea
                id={feedbackId}
                placeholder="Any additional feedback? (optional)"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={3}
                autoCapitalize="sentences"
              />
            </div>

            {suggestion && suggestionDisplayName && monthlySavingsDollars > 0 && (
              <p
                className="rounded-card border bg-acr-pos/5 p-3 text-sm text-muted-foreground"
                aria-live="polite"
                data-testid="downgrade-savings-pitch"
              >
                Switch to <span className="font-medium text-foreground">{suggestionDisplayName}</span> instead — you'd save <span className="font-mono tabular-nums text-foreground">${monthlySavingsDollars}/mo</span>. Your data stays.
              </p>
            )}

            <DialogFooter className="flex-col sm:flex-row gap-2">
              {suggestion && suggestionDisplayName && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDowngrade}
                  className="flex items-center gap-1"
                  aria-label={`Downgrade to ${suggestionDisplayName} instead of cancelling`}
                  data-testid="cancel-downgrade-instead"
                >
                  <TrendingDown className="h-4 w-4" aria-hidden="true" />
                  Downgrade to {suggestionDisplayName} instead
                </Button>
              )}
              <Button
                type="button"
                variant="destructive"
                disabled={!reason}
                onClick={() => setStep("confirm")}
              >
                Continue to cancel
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Confirm cancellation</DialogTitle>
              <DialogDescription>
                Your subscription will remain active until the end of your current billing period.
                Your data will be preserved, and you can re-subscribe at any time.
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setStep("reason")}>
                Go back
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={cancelMutation.isPending}
                aria-busy={cancelMutation.isPending}
                aria-label={cancelMutation.isPending ? "Processing cancellation" : "Confirm cancellation"}
                onClick={() => cancelMutation.mutate()}
              >
                {cancelMutation.isPending ? "Processing…" : "Confirm cancellation"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
