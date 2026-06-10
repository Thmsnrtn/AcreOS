/**
 * Settings → Billing sections — extracted from the settings.tsx monolith
 * (T3 census W1-2). Behavior, deep links, and test ids preserved verbatim;
 * loading states upgraded to content-shaped Skeletons and query failures
 * now surface a QueryErrorState with retry instead of failing silently.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import {
  Wallet,
  Users,
  Check,
  CheckCircle2,
  AlertCircle,
  Clock,
  Link2,
  ExternalLink,
  RefreshCw,
  Unlink,
  Loader2,
  UserPlus,
} from "lucide-react";

interface SeatInfo {
  tier: string;
  includedSeats: number;
  additionalSeats: number;
  totalSeats: number;
  maxSeats: number | null;
  usedSeats: number;
  availableSeats: number;
  canAddSeats: boolean;
  seatPriceCents: number | null;
  hasTeamMessaging: boolean;
}

interface SeatPricing {
  canPurchaseSeats: boolean;
  message?: string;
  tier?: string;
  monthly?: { id: string; amount: number; currency: string } | null;
  yearly?: { id: string; amount: number; currency: string } | null;
}

interface StripeConnectStatusResponse {
  isConnected: boolean;
  accountId?: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  capabilities?: {
    cardPayments?: string;
    transfers?: string;
    usBankAccountAchPayments?: string;
  };
  requirements?: {
    currentlyDue: string[];
    eventuallyDue: string[];
    pastDue: string[];
  };
  businessProfile?: {
    name?: string;
    url?: string;
  };
}

export function StripeConnectSettings() {
  const { toast } = useToast();
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const {
    data: connectStatus,
    isLoading: statusLoading,
    isError: statusIsError,
    error: statusError,
    refetch,
    isRefetching,
  } = useQuery<StripeConnectStatusResponse>({
    queryKey: ["/api/stripe/connect/status"],
    retry: 1,
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/connect/link", {}, { idempotent: true });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.onboardingUrl) {
        window.location.href = data.onboardingUrl;
      }
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't start Stripe onboarding",
        description: error?.message || "Check your connection and try again — your Stripe connection is unchanged.",
        variant: "destructive",
      });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/connect/refresh", {}, { idempotent: true });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stripe/connect/status"] });
      toast({
        title: "Status refreshed",
        description: "Your Stripe account status has been updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't refresh Stripe status",
        description: error?.message || "Check your connection and try again.",
        variant: "destructive",
      });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/connect/disconnect", {}, { idempotent: true });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stripe/connect/status"] });
      setShowDisconnectConfirm(false);
      toast({
        title: "Stripe disconnected",
        description: "Your Stripe account has been disconnected.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't disconnect Stripe",
        description: error?.message || "Check your connection and try again — your Stripe account is still connected.",
        variant: "destructive",
      });
    },
  });

  const getStatusDisplay = () => {
    if (!connectStatus) return { label: "Not connected", icon: AlertCircle, color: "text-muted-foreground" };

    if (!connectStatus.isConnected) {
      return { label: "Not connected", icon: AlertCircle, color: "text-muted-foreground" };
    }

    if (!connectStatus.detailsSubmitted) {
      return { label: "Onboarding required", icon: Clock, color: "text-acr-warn" };
    }

    if (!connectStatus.chargesEnabled) {
      return { label: "Pending verification", icon: Clock, color: "text-acr-warn" };
    }

    return { label: "Active", icon: CheckCircle2, color: "text-acr-pos" };
  };

  const status = getStatusDisplay();
  const StatusIcon = status.icon;

  if (statusLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5" aria-hidden="true" />
            Stripe Connect
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6" aria-busy="true">
          {/* Status row */}
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-5 rounded-full" announceText="Loading Stripe Connect status" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" announce={false} />
              <Skeleton className="h-3 w-24" announce={false} />
            </div>
          </div>
          {/* Capabilities grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-16" announce={false} />
                <Skeleton className="h-4 w-20" announce={false} />
              </div>
            ))}
          </div>
          {/* Action row */}
          <div className="flex gap-3 pt-4 border-t">
            <Skeleton className="h-11 sm:h-9 w-44" announce={false} />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Settings must never silently fail — a Stripe status failure previously
  // left the user staring at "Not connected" with no explanation.
  if (statusIsError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5" aria-hidden="true" />
            Stripe Connect
          </CardTitle>
        </CardHeader>
        <CardContent>
          <QueryErrorState
            error={statusError as Error}
            onRetry={() => refetch()}
            isRetrying={isRefetching}
            compact
            title="Couldn't load your billing status"
            description="Your Stripe connection is unchanged — this is just a display issue."
            testId="error-stripe-connect-status"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="w-5 h-5" aria-hidden="true" />
          Stripe Connect
        </CardTitle>
        <CardDescription>
          Connect your Stripe account to receive payments from borrowers and buyers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <StatusIcon className={`w-5 h-5 ${status.color}`} aria-hidden="true" />
            <div>
              <p className="font-medium">Connection status</p>
              <p className={`text-sm ${status.color}`} data-testid="text-stripe-status">
                {status.label}
              </p>
            </div>
          </div>

          {connectStatus?.isConnected && connectStatus.accountId && (
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Account ID</p>
              <p className="font-mono text-sm tabular-nums" data-testid="text-stripe-account-id">
                {connectStatus.accountId}
              </p>
            </div>
          )}
        </div>

        {connectStatus?.isConnected && (
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t">
            <div className="space-y-1">
              <dt className="text-sm text-muted-foreground">Charges</dt>
              <dd className="flex items-center gap-1">
                {connectStatus.chargesEnabled ? (
                  <CheckCircle2 className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-acr-warn" aria-hidden="true" />
                )}
                <span className="text-sm font-medium">
                  {connectStatus.chargesEnabled ? "Enabled" : "Pending"}
                </span>
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm text-muted-foreground">Payouts</dt>
              <dd className="flex items-center gap-1">
                {connectStatus.payoutsEnabled ? (
                  <CheckCircle2 className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-acr-warn" aria-hidden="true" />
                )}
                <span className="text-sm font-medium">
                  {connectStatus.payoutsEnabled ? "Enabled" : "Pending"}
                </span>
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm text-muted-foreground">Onboarding</dt>
              <dd className="flex items-center gap-1">
                {connectStatus.detailsSubmitted ? (
                  <CheckCircle2 className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-acr-warn" aria-hidden="true" />
                )}
                <span className="text-sm font-medium">
                  {connectStatus.detailsSubmitted ? "Complete" : "Incomplete"}
                </span>
              </dd>
            </div>
          </dl>
        )}

        {connectStatus?.requirements && connectStatus.requirements.currentlyDue.length > 0 && (
          <div
            className="p-4 rounded-md bg-acr-warn/10 border border-acr-warn/20"
            role="status"
            aria-live="polite"
          >
            <p className="font-medium text-acr-warn flex items-center gap-2">
              <AlertCircle className="w-4 h-4" aria-hidden="true" />
              Action required
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Complete your Stripe onboarding to enable payments. Click &ldquo;Complete onboarding&rdquo; below.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-3 pt-4 border-t">
          {!connectStatus?.isConnected ? (
            <Button
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending}
              className="min-h-11 sm:min-h-9"
              data-testid="button-connect-stripe"
            >
              {connectMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
              ) : (
                <Link2 className="w-4 h-4 mr-2" aria-hidden="true" />
              )}
              Connect Stripe account
            </Button>
          ) : (
            <>
              {!connectStatus.detailsSubmitted && (
                <Button
                  onClick={() => connectMutation.mutate()}
                  disabled={connectMutation.isPending}
                  className="min-h-11 sm:min-h-9"
                  data-testid="button-complete-onboarding"
                >
                  {connectMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                  ) : (
                    <ExternalLink className="w-4 h-4 mr-2" aria-hidden="true" />
                  )}
                  Complete onboarding
                </Button>
              )}

              <Button
                variant="outline"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                className="min-h-11 sm:min-h-9"
                data-testid="button-refresh-stripe-status"
              >
                {refreshMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
                )}
                Refresh status
              </Button>

              <Button
                variant="outline"
                onClick={() => setShowDisconnectConfirm(true)}
                disabled={disconnectMutation.isPending}
                className="min-h-11 sm:min-h-9"
                data-testid="button-disconnect-stripe"
              >
                {disconnectMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                ) : (
                  <Unlink className="w-4 h-4 mr-2" aria-hidden="true" />
                )}
                Disconnect
              </Button>
            </>
          )}
        </div>

        <div className="pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            <strong>Platform fee:</strong> a 2.5% platform fee is applied to all payments processed through AcreOS.
            This covers payment processing, automated payment collection, and platform infrastructure.
          </p>
        </div>
      </CardContent>

      <ConfirmDialog
        open={showDisconnectConfirm}
        onOpenChange={setShowDisconnectConfirm}
        title="Disconnect your Stripe account?"
        description="You won't be able to collect new payments through AcreOS until you reconnect. Pending payments already in Stripe will continue to process normally. You can reconnect at any time."
        confirmLabel="Disconnect Stripe"
        cancelLabel="Keep connected"
        variant="destructive"
        isLoading={disconnectMutation.isPending}
        onConfirm={() => disconnectMutation.mutate()}
      />
    </Card>
  );
}

export function SeatManagement() {
  const { toast } = useToast();
  const [seatQuantity, setSeatQuantity] = useState(1);
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "yearly">("monthly");

  const {
    data: seatInfo,
    isLoading: seatInfoLoading,
    isError: seatInfoError,
    error: seatInfoErrorObj,
    refetch: refetchSeatInfo,
    isRefetching: seatInfoRefetching,
  } = useQuery<SeatInfo>({
    queryKey: ["/api/organization/seats"],
  });

  const {
    data: seatPricing,
    isLoading: pricingLoading,
    isError: pricingError,
    refetch: refetchPricing,
  } = useQuery<SeatPricing>({
    queryKey: ["/api/organization/seats/pricing"],
  });

  const purchaseSeatsMutation = useMutation({
    mutationFn: async ({ quantity, billingPeriod }: { quantity: number; billingPeriod: string }) => {
      const res = await apiRequest("POST", "/api/organization/seats/purchase", { quantity, billingPeriod }, { idempotent: true });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't start seat purchase",
        description: error?.message || "Check your connection and try again — no card was charged and your seat count is unchanged.",
        variant: "destructive",
      });
    },
  });

  const handlePurchaseSeats = () => {
    purchaseSeatsMutation.mutate({ quantity: seatQuantity, billingPeriod });
  };

  const formatPrice = (amount: number | undefined, currency: string = "usd") => {
    if (!amount) return "$0";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 0,
    }).format(amount / 100);
  };

  if (seatInfoLoading || pricingLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" aria-hidden="true" />
            Seat management
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4" aria-busy="true">
          {/* Stat grid matches the loaded 4-stat layout */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton
                  className="h-3 w-20"
                  announce={i === 1}
                  announceText="Loading seat information"
                />
                <Skeleton className="h-8 w-12" announce={false} />
              </div>
            ))}
          </div>
          <Skeleton className="h-2 w-full" announce={false} />
        </CardContent>
      </Card>
    );
  }

  if (seatInfoError || pricingError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" aria-hidden="true" />
            Seat management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <QueryErrorState
            error={(seatInfoErrorObj as Error) ?? null}
            onRetry={() => {
              if (seatInfoError) refetchSeatInfo();
              if (pricingError) refetchPricing();
            }}
            isRetrying={seatInfoRefetching}
            compact
            title="Couldn't load seat information"
            description="Your seats and billing are unchanged — this is just a display issue."
            testId="error-seat-management"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="w-5 h-5" aria-hidden="true" />
          Seat management
        </CardTitle>
        <CardDescription>Manage your team seat allocation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <dt className="text-sm text-muted-foreground">Included seats</dt>
            <dd className="text-2xl font-semibold tabular-nums" data-testid="text-included-seats">
              {seatInfo?.includedSeats ?? 0}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-sm text-muted-foreground">Additional seats</dt>
            <dd className="text-2xl font-semibold tabular-nums" data-testid="text-additional-seats">
              {seatInfo?.additionalSeats ?? 0}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-sm text-muted-foreground">Used</dt>
            <dd className="text-2xl font-semibold tabular-nums" data-testid="text-used-seats">
              {seatInfo?.usedSeats ?? 0} / {seatInfo?.totalSeats ?? 0}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-sm text-muted-foreground">Available</dt>
            <dd className="text-2xl font-semibold tabular-nums text-acr-pos" data-testid="text-available-seats">
              {seatInfo?.availableSeats ?? 0}
            </dd>
          </div>
        </dl>

        {seatInfo && seatInfo.totalSeats > 0 && (
          <Progress
            value={(seatInfo.usedSeats / seatInfo.totalSeats) * 100}
            className="h-2"
            aria-label={`Seat usage: ${seatInfo.usedSeats} of ${seatInfo.totalSeats} seats in use`}
          />
        )}

        {seatInfo?.hasTeamMessaging && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="w-4 h-4 text-acr-pos" aria-hidden="true" />
            Team messaging enabled (2+ seats)
          </div>
        )}

        {seatPricing?.canPurchaseSeats && seatInfo?.canAddSeats && (
          <div className="pt-4 border-t space-y-4">
            <h4 className="font-medium">Add more seats</h4>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <Label htmlFor="seat-quantity">Quantity</Label>
                <Input
                  id="seat-quantity"
                  type="number"
                  min={1}
                  max={seatInfo?.maxSeats ? seatInfo.maxSeats - seatInfo.totalSeats : 100}
                  value={seatQuantity}
                  onChange={(e) => setSeatQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-20 tabular-nums"
                  inputMode="numeric"
                  data-testid="input-seat-quantity"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="select-billing-period">Billing</Label>
                <Select value={billingPeriod} onValueChange={(v) => setBillingPeriod(v as "monthly" | "yearly")}>
                  <SelectTrigger id="select-billing-period" className="w-28" data-testid="select-billing-period">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-1">
                <Label>Price</Label>
                <p className="text-lg font-semibold tabular-nums" data-testid="text-seat-price">
                  {billingPeriod === "monthly"
                    ? `${formatPrice((seatPricing.monthly?.amount ?? 0) * seatQuantity)}/mo`
                    : `${formatPrice((seatPricing.yearly?.amount ?? 0) * seatQuantity)}/yr`
                  }
                </p>
              </div>
              <Button
                onClick={handlePurchaseSeats}
                disabled={purchaseSeatsMutation.isPending || !seatQuantity}
                className="min-h-11 sm:min-h-9"
                data-testid="button-purchase-seats"
                aria-label={`Add ${seatQuantity} ${billingPeriod} seat${seatQuantity === 1 ? "" : "s"}`}
              >
                {purchaseSeatsMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                ) : (
                  <UserPlus className="w-4 h-4 mr-2" aria-hidden="true" />
                )}
                Add seats
              </Button>
            </div>
          </div>
        )}

        {seatPricing && !seatPricing.canPurchaseSeats && (
          <p className="text-sm text-muted-foreground pt-4 border-t">
            {seatPricing.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
