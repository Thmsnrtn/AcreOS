/**
 * /founder/pricing — Pricing & Promotions (extracted from
 * founder-dashboard.tsx).
 *
 * Pure move; no behavior change. Preserves the existing /api/founder/pricing
 * query key + mutation paths (PUT /:tier, POST /:tier/promo, DELETE /:tier/promo).
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Tag, Percent } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";

interface PricingConfigRow {
  id: number;
  tier: string;
  displayPriceMonthly: number;
  displayPriceYearly: number;
  promoLabel: string | null;
  promoDiscountPercent: number | null;
  promoEndsAt: string | null;
  stripeCouponId: string | null;
  allowPromoCodes: boolean;
}

export function PricingSection() {
  const { toast } = useToast();
  const [editingTier, setEditingTier] = useState<string | null>(null);
  const [draftPrices, setDraftPrices] = useState<{ monthly: string; yearly: string }>({ monthly: "", yearly: "" });
  const [promoForm, setPromoForm] = useState<{ tier: string; label: string; discount: string; endsAt: string } | null>(null);

  const { data: configs, isLoading, refetch } = useQuery<PricingConfigRow[]>({
    queryKey: ["/api/founder/pricing"],
  });

  // Optimistic price update — closes the edit panel instantly while the
  // PUT is in flight. Carries the row id so the list cache can match by id.
  const updatePriceMutation = useOptimisticUpdate<{ id: number; tier: string; monthly: number; yearly: number }>({
    mutationFn: async ({ tier, monthly, yearly }) =>
      apiRequest("PUT", `/api/founder/pricing/${tier}`, {
        displayPriceMonthly: monthly,
        displayPriceYearly: yearly,
      }),
    listKeys: [["/api/founder/pricing"]],
    getId: ({ id }) => id,
    buildPatch: ({ monthly, yearly }) => ({ displayPriceMonthly: monthly, displayPriceYearly: yearly }),
    successToast: { title: "Prices updated" },
  }, {
    onSuccess: () => setEditingTier(null),
  });

  const createPromoMutation = useMutation({
    mutationFn: async ({ tier, label, discount, endsAt }: { tier: string; label: string; discount: number; endsAt: string }) =>
      apiRequest("POST", `/api/founder/pricing/${tier}/promo`, {
        promoLabel: label,
        promoDiscountPercent: discount,
        promoEndsAt: endsAt,
      }),
    onSuccess: () => { refetch(); setPromoForm(null); toast({ title: "Promotion activated" }); },
    onError: () => toast({ title: "Couldn't create promotion", description: "No promotion was activated. Try again.", variant: "destructive" }),
  });

  const clearPromoMutation = useMutation({
    mutationFn: async (tier: string) => apiRequest("DELETE", `/api/founder/pricing/${tier}/promo`),
    onSuccess: () => { refetch(); toast({ title: "Promotion cleared" }); },
    onError: () => toast({ title: "Couldn't clear promotion", description: "The promotion is still active. Try again.", variant: "destructive" }),
  });

  const togglePromoCodesMutation = useOptimisticUpdate<{ id: number; tier: string; allow: boolean }>({
    mutationFn: async ({ tier, allow }) =>
      apiRequest("PUT", `/api/founder/pricing/${tier}`, { allowPromoCodes: allow }),
    listKeys: [["/api/founder/pricing"]],
    getId: ({ id }) => id,
    buildPatch: ({ allow }) => ({ allowPromoCodes: allow }),
    successToast: false,
  });

  const tierLabels: Record<string, string> = {
    starter: "Starter",
    pro: "Pro",
    growth: "Growth",
    enterprise: "Enterprise",
  };

  return (
    <div className="mt-8 p-6 border rounded-xl bg-card space-y-4">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Tag className="w-5 h-5 text-primary" />
          Pricing & Promotions
        </h2>
        <p className="text-muted-foreground text-sm mt-0.5">
          Adjust display pricing, run flash sales, and manage Stripe promo codes.
        </p>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-40 rounded-card bg-muted/50" />
      ) : (
        <div className="space-y-3">
          {(configs || []).map((cfg) => {
            const isExpired = cfg.promoEndsAt && new Date(cfg.promoEndsAt) < new Date();
            const hasActivePromo = cfg.promoLabel && !isExpired;
            return (
              <div key={cfg.tier} className="p-4 border rounded-card space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="font-medium">{tierLabels[cfg.tier] || cfg.tier}</span>
                    {hasActivePromo && (
                      <Badge className="ml-2 bg-acr-pos/10 text-acr-pos border-acr-pos/20">
                        <Percent className="w-3 h-3 mr-1" />
                        {cfg.promoDiscountPercent}% off — {cfg.promoLabel}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {editingTier === cfg.tier ? (
                      <>
                        <Input
                          type="number"
                          inputMode="numeric"
                          className="h-8 w-24 text-sm"
                          placeholder="Monthly ¢"
                          value={draftPrices.monthly}
                          onChange={(e) => setDraftPrices((p) => ({ ...p, monthly: e.target.value }))}
                        />
                        <Input
                          type="number"
                          inputMode="numeric"
                          className="h-8 w-24 text-sm"
                          placeholder="Yearly ¢"
                          value={draftPrices.yearly}
                          onChange={(e) => setDraftPrices((p) => ({ ...p, yearly: e.target.value }))}
                        />
                        <Button
                          size="sm"
                          className="h-8"
                          onClick={() => updatePriceMutation.mutate({ id: cfg.id, tier: cfg.tier, monthly: parseInt(draftPrices.monthly), yearly: parseInt(draftPrices.yearly) })}
                          disabled={updatePriceMutation.isPending}
                        >
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingTier(null)}>Cancel</Button>
                      </>
                    ) : (
                      <>
                        <span className="text-sm text-muted-foreground font-mono">
                          ${(cfg.displayPriceMonthly / 100).toFixed(0)}/mo · ${(cfg.displayPriceYearly / 100).toFixed(0)}/mo yearly
                        </span>
                        <Button size="sm" variant="outline" className="h-8 text-xs"
                          onClick={() => { setEditingTier(cfg.tier); setDraftPrices({ monthly: String(cfg.displayPriceMonthly), yearly: String(cfg.displayPriceYearly) }); }}>
                          Edit Prices
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  {hasActivePromo ? (
                    <Button size="sm" variant="destructive" className="h-7 text-xs"
                      onClick={() => clearPromoMutation.mutate(cfg.tier)}
                      disabled={clearPromoMutation.isPending}>
                      End Promotion
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => setPromoForm({ tier: cfg.tier, label: "", discount: "", endsAt: "" })}>
                      <Percent className="w-3 h-3 mr-1" />
                      Flash Sale
                    </Button>
                  )}
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={cfg.allowPromoCodes}
                      onCheckedChange={(allow) => togglePromoCodesMutation.mutate({ id: cfg.id, tier: cfg.tier, allow })}
                      className="scale-75"
                    />
                    <span className="text-xs text-muted-foreground">User promo codes at checkout</span>
                  </div>
                  {cfg.promoEndsAt && !isExpired && (
                    <span className="text-xs text-muted-foreground">
                      Ends {new Date(cfg.promoEndsAt).toLocaleDateString()}
                    </span>
                  )}
                </div>

                {promoForm?.tier === cfg.tier && (
                  <div className="p-3 bg-muted/50 rounded-card space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="Label (e.g. Spring Sale)" className="h-8 text-sm"
                        value={promoForm.label} onChange={(e) => setPromoForm((p) => p ? { ...p, label: e.target.value } : null)} />
                      <Input type="number" inputMode="numeric" min="1" max="99" placeholder="Discount %" className="h-8 text-sm"
                        value={promoForm.discount} onChange={(e) => setPromoForm((p) => p ? { ...p, discount: e.target.value } : null)} />
                      <Input type="datetime-local" className="h-8 text-sm col-span-2"
                        value={promoForm.endsAt} onChange={(e) => setPromoForm((p) => p ? { ...p, endsAt: e.target.value } : null)} />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="h-8"
                        onClick={() => createPromoMutation.mutate({ tier: cfg.tier, label: promoForm.label, discount: parseInt(promoForm.discount), endsAt: promoForm.endsAt })}
                        disabled={createPromoMutation.isPending || !promoForm.label || !promoForm.discount || !promoForm.endsAt}>
                        Activate Promo
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8" onClick={() => setPromoForm(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function FounderPricingPage() {
  useDocumentTitle("Pricing & promotions — AcreOS");

  return (
    <PageShell label="Pricing & promotions">
      <div className="mb-6 flex items-start gap-3">
        <Tag className="w-6 h-6 text-primary mt-1" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pricing & promotions</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Adjust display pricing, run flash sales, and manage Stripe promo
            codes across tiers. Optimistic updates apply instantly.
          </p>
        </div>
      </div>

      <PricingSection />
    </PageShell>
  );
}
