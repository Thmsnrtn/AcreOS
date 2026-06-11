/**
 * Settings → Underwriting — org-level owner-finance defaults (Hank fix).
 *
 * blindOfferCalculator hardcoded 9% APR / 84 months. Texas land standard
 * — and the actual book of any operator writing notes today — is 9.9%
 * APR / 120 months / 20% down / no balloon. Hardcoding meant every
 * projected cash-flow on the wizard was ~30% off for the operators who
 * actually owner-finance their flips.
 *
 * This surface lets the operator persist their underwriting defaults
 * once. The calculator reads them via /api/me/underwriting-defaults on
 * every blind-offer build; missing defaults fall back to the legacy
 * hardcode for backward compat.
 *
 * Save fires on commit (Save button), not on every keystroke. We avoid
 * client-side computed previews here — the operator-facing preview lives
 * in the blind-offer report itself once they run a parcel through it.
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface OwnerFinanceDefaults {
  apr: number;
  termMonths: number;
  downPaymentPct: number;
  balloon: boolean;
}

interface UnderwritingResponse {
  ownerFinance: OwnerFinanceDefaults;
  isCustomised: boolean;
  suggested: OwnerFinanceDefaults;
}

export default function UnderwritingSettingsPage() {
  useDocumentTitle("Underwriting defaults");
  const { toast } = useToast();

  const { data, isLoading } = useQuery<UnderwritingResponse>({
    queryKey: ["/api/me/underwriting-defaults"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/me/underwriting-defaults");
      return res.json();
    },
  });

  const [draft, setDraft] = useState<OwnerFinanceDefaults | null>(null);

  useEffect(() => {
    if (data?.ownerFinance && !draft) {
      setDraft(data.ownerFinance);
    }
  }, [data, draft]);

  const save = useMutation({
    mutationFn: async (next: OwnerFinanceDefaults) => {
      const res = await apiRequest(
        "PATCH",
        "/api/me/underwriting-defaults",
        { ownerFinance: next },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/me/underwriting-defaults"],
      });
      toast({ title: "Underwriting defaults saved" });
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't save defaults",
        description: err?.message ?? "Try again.",
        variant: "destructive",
      });
    },
  });

  if (isLoading || !draft) {
    return (
      <PageShell label="Underwriting defaults">
        <Card>
          <CardContent className="p-6 space-y-3">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const dirty =
    !!data &&
    (data.ownerFinance.apr !== draft.apr ||
      data.ownerFinance.termMonths !== draft.termMonths ||
      data.ownerFinance.downPaymentPct !== draft.downPaymentPct ||
      data.ownerFinance.balloon !== draft.balloon);

  return (
    <PageShell label="Underwriting defaults">
      <header className="mb-6">
        <h1 className="text-hero">
          Underwriting defaults
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          The owner-finance numbers Pax and the blind-offer wizard use
          when projecting cash flow on a new parcel.
        </p>
      </header>
      <Card data-testid="underwriting-defaults-card">
        <CardHeader>
          <CardTitle className="text-section-h2">Owner-finance defaults</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {!data?.isCustomised && (
            <div className="text-sm text-muted-foreground border border-dashed border-border rounded-md p-3">
              These are the Texas land standard — adjust to match the
              paper you actually write.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="uw-apr">APR (%)</Label>
              <Input
                id="uw-apr"
                type="number"
                inputMode="decimal"
                step="0.1"
                min={0}
                max={36}
                className="tabular-nums"
                value={draft.apr}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    apr: Number(e.target.value),
                  })
                }
                data-testid="underwriting-apr"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="uw-term">Term (months)</Label>
              <Input
                id="uw-term"
                type="number"
                inputMode="numeric"
                step="1"
                min={12}
                max={480}
                className="tabular-nums"
                value={draft.termMonths}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    termMonths: Number(e.target.value),
                  })
                }
                data-testid="underwriting-term"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="uw-down">Down payment (%)</Label>
              <Input
                id="uw-down"
                type="number"
                inputMode="decimal"
                step="0.5"
                min={0}
                max={100}
                className="tabular-nums"
                value={draft.downPaymentPct}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    downPaymentPct: Number(e.target.value),
                  })
                }
                data-testid="underwriting-down"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="uw-balloon" className="block">
                Balloon
              </Label>
              <div className="flex items-center gap-3 h-10">
                <Switch
                  id="uw-balloon"
                  checked={draft.balloon}
                  onCheckedChange={(checked) =>
                    setDraft({ ...draft, balloon: !!checked })
                  }
                  aria-describedby="uw-balloon-state"
                  data-testid="underwriting-balloon"
                />
                <span id="uw-balloon-state" className="text-sm text-muted-foreground">
                  {draft.balloon
                    ? "Balloon due at term end"
                    : "Fully amortizing"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => data?.ownerFinance && setDraft(data.ownerFinance)}
              disabled={!dirty || save.isPending}
              data-testid="underwriting-reset"
            >
              Reset
            </Button>
            <Button
              onClick={() => save.mutate(draft)}
              disabled={!dirty || save.isPending}
              data-testid="underwriting-save"
            >
              {save.isPending ? "Saving…" : "Save defaults"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
