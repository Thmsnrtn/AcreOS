/**
 * Checkout return handler — mounted on /settings, the landing page for
 * every Stripe Checkout return URL the server issues:
 *
 *   - /settings?subscription=success|cancelled  (plan checkout)
 *   - /settings?credits=success|cancelled        (credit-pack purchase)
 *
 * Before this component existed, those query params were written by the
 * server and read by nobody: a customer who just paid landed on Settings
 * with no confirmation and a stale credit balance. This handler closes
 * the loop — one toast, fresh data, then the params are stripped so a
 * refresh doesn't re-toast.
 *
 * Runs once on mount. Uses history.replaceState for cleanup (no navigation,
 * no tab reset — the user's tab state is untouched).
 */

import { useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function CheckoutReturnHandler() {
  const search = useSearch();
  const { toast } = useToast();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    const params = new URLSearchParams(search);
    const subscription = params.get("subscription");
    const credits = params.get("credits");
    if (!subscription && !credits) return;
    handled.current = true;

    if (subscription === "success") {
      // Plan data lives under these keys; refetch so the plans section
      // shows the new tier as Current instead of a stale card.
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stripe/products"] });
      toast({
        title: "You're subscribed",
        description:
          "Your plan is active. Find it under Settings → Billing, and cancel anytime there — no calls, no forms.",
      });
    } else if (subscription === "cancelled") {
      toast({
        title: "Checkout cancelled",
        description: "No charge was made. Your plan is unchanged — pick it up whenever you're ready.",
      });
    }

    if (credits === "success") {
      // Balance + recent transactions go stale the moment the webhook
      // grants the pack; refetch so the user sees the new balance.
      queryClient.invalidateQueries({ queryKey: ["/api/credits/balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/credits/transactions"] });
      toast({
        title: "Credits added",
        description: "Your new balance is reflected below. Credits never expire.",
      });
    } else if (credits === "cancelled") {
      toast({
        title: "Purchase cancelled",
        description: "No charge was made and your balance is unchanged.",
      });
    }

    // Strip the return params so a refresh doesn't re-toast. Keep any
    // other params (e.g. ?tab=billing) and the hash intact.
    params.delete("subscription");
    params.delete("credits");
    const rest = params.toString();
    const url =
      window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash;
    window.history.replaceState(null, "", url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return null;
}
