/**
 * Tax Identity settings page (org-side, owner-only).
 *
 * Mirrors the onboarding step's form so owners can edit later or fill it in
 * if they skipped during onboarding. The 1099 generator returns 422 until
 * these values are present, so the page surfaces a clear "blocking" badge
 * when not yet captured.
 *
 * Plaintext EIN is never returned by GET /api/organization/tax-identity —
 * we only display the last-4 (mask) once captured.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useUserPermissions } from "@/hooks/use-organization";
import {
  ShieldCheck,
  ShieldAlert,
  Lock,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import {
  formatTaxIdAsTyped,
  isValidTaxId,
  taxIdFormatHint,
  type TaxIdType,
} from "@shared/taxIdentity";

type TaxIdentityResponse = {
  legalEntityName: string | null;
  taxIdType: TaxIdType | null;
  taxIdLast4: string | null;
  taxIdMasked: string | null;
  taxAddress: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    phone?: string;
  } | null;
  captured: boolean;
  skipped: boolean;
  skippedAt: string | null;
  capturedAt: string | null;
};

export default function TaxIdentitySettingsPage() {
  useDocumentTitle("Tax identity");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: permissions, isLoading: permsLoading } = useUserPermissions();

  const isOwner = permissions?.role === "owner";

  const { data, isLoading, isError, refetch } = useQuery<TaxIdentityResponse>({
    queryKey: ["/api/organization/tax-identity"],
    queryFn: async () => {
      const res = await fetch("/api/organization/tax-identity", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load tax identity");
      return res.json();
    },
    enabled: !!isOwner,
  });

  const [legalEntityName, setLegalEntityName] = useState("");
  const [taxIdType, setTaxIdType] = useState<TaxIdType>("EIN");
  const [taxId, setTaxId] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Pre-fill once the response arrives. We never pre-fill the tax ID itself
  // (server doesn't return plaintext) — owners must re-enter to update.
  useEffect(() => {
    if (!data) return;
    if (data.legalEntityName) setLegalEntityName(data.legalEntityName);
    if (data.taxIdType) setTaxIdType(data.taxIdType);
    if (data.taxAddress) {
      setLine1(data.taxAddress.line1 ?? "");
      setLine2(data.taxAddress.line2 ?? "");
      setCity(data.taxAddress.city ?? "");
      setState(data.taxAddress.state ?? "");
      setZip(data.taxAddress.zip ?? "");
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/organization/tax-identity", {
        legalEntityName: legalEntityName.trim(),
        taxIdType,
        taxId,
        taxAddress: {
          line1: line1.trim(),
          line2: line2.trim() || undefined,
          city: city.trim(),
          state: state.trim().toUpperCase(),
          zip: zip.trim(),
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || "Couldn't save tax identity");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Tax identity saved",
        description: "Encrypted and stored. 1099 issuance is unblocked.",
      });
      setTaxId("");
      setFormError(null);
      queryClient.invalidateQueries({
        queryKey: ["/api/organization/tax-identity"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
    },
    onError: (err: any) => {
      const msg = err?.message ?? "Couldn't save tax identity";
      setFormError(msg);
      toast({
        title: "Couldn't save tax identity",
        description: `${msg} — your previous values are unchanged.`,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!isValidTaxId(taxId, taxIdType)) {
      setFormError(taxIdFormatHint(taxIdType));
      return;
    }
    saveMutation.mutate();
  };

  // ── Permission gate ──────────────────────────────────────────────────────
  if (permsLoading) {
    return (
      <PageShell>
        <Skeleton className="h-8 w-48 mb-2" />
        <Skeleton className="h-4 w-96 mb-8" />
        <Skeleton className="h-64 w-full" />
      </PageShell>
    );
  }

  if (!isOwner) {
    return (
      <PageShell>
        <EmptyState
          icon={Lock}
          title="Owner-only"
          description="Only the workspace owner can view or edit the organization's tax identity. Ask an owner to update these settings."
        />
      </PageShell>
    );
  }

  // ── Loading / error states ───────────────────────────────────────────────
  if (isLoading) {
    return (
      <PageShell>
        <div className="space-y-2 mb-6">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </PageShell>
    );
  }

  if (isError) {
    return (
      <PageShell>
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load tax identity"
          description="We couldn't reach the server. Your stored data is unchanged."
          actionLabel="Try again"
          onAction={() => refetch()}
        />
      </PageShell>
    );
  }

  const captured = !!data?.captured;
  const skipped = !!data?.skipped && !captured;

  return (
    <PageShell>
      <div className="space-y-1 mb-6">
        <h1
          className="text-2xl md:text-3xl font-bold flex items-center gap-2"
          data-testid="text-tax-identity-title"
        >
          <ShieldCheck className="w-6 h-6 text-primary" aria-hidden="true" />
          Tax identity
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Required to issue 1099-INT forms to your borrowers and lenders. We
          encrypt this at rest with AES-256-GCM.
        </p>
      </div>

      {/* Status card */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-base flex items-center gap-2">
              {captured ? (
                <>
                  <ShieldCheck className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                  Captured
                </>
              ) : (
                <>
                  <ShieldAlert className="w-4 h-4 text-acr-warn" aria-hidden="true" />
                  Not yet captured
                </>
              )}
            </CardTitle>
            {captured ? (
              <Badge variant="secondary" data-testid="badge-tax-identity-captured">
                1099 issuance enabled
              </Badge>
            ) : skipped ? (
              <Badge variant="outline" data-testid="badge-tax-identity-skipped">
                Skipped during onboarding
              </Badge>
            ) : (
              <Badge variant="destructive" data-testid="badge-tax-identity-blocking">
                Blocks 1099 issuance
              </Badge>
            )}
          </div>
          <CardDescription className="pt-2">
            {captured
              ? `Stored EIN ends in ${data?.taxIdLast4}. To rotate, enter a new value below.`
              : "Until this is captured, every 1099-INT generation request will return 422 PAYER_EIN_MISSING."}
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Legal entity</CardTitle>
            <CardDescription>
              Use the exact name registered with the IRS for this entity.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="legal-entity-name">Legal entity name</Label>
              <Input
                id="legal-entity-name"
                value={legalEntityName}
                onChange={(e) => setLegalEntityName(e.target.value)}
                placeholder="e.g. Apex Land Group, LLC"
                required
                data-testid="input-legal-entity-name"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tax ID</CardTitle>
            <CardDescription>
              EIN for entities, SSN for sole proprietors, ITIN for non-US
              individuals. We never display the full value after saving — only
              the last four digits.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Tax ID type</Label>
              <RadioGroup
                value={taxIdType}
                onValueChange={(v) => {
                  setTaxIdType(v as TaxIdType);
                  setTaxId("");
                  setFormError(null);
                }}
                className="flex flex-wrap gap-4"
              >
                {(["EIN", "SSN", "ITIN"] as const).map((opt) => (
                  <div key={opt} className="flex items-center space-x-2">
                    <RadioGroupItem
                      value={opt}
                      id={`tax-id-type-${opt}`}
                      data-testid={`option-tax-id-type-${opt}`}
                    />
                    <Label htmlFor={`tax-id-type-${opt}`} className="cursor-pointer">
                      {opt}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tax-id">
                Tax ID ({taxIdType})
                {captured && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
                    Currently ends in {data?.taxIdLast4}. Enter a new value to rotate.
                  </span>
                )}
              </Label>
              <Input
                id="tax-id"
                value={taxId}
                onChange={(e) => {
                  setTaxId(formatTaxIdAsTyped(e.target.value, taxIdType));
                  setFormError(null);
                }}
                placeholder={
                  taxIdType === "EIN"
                    ? "XX-XXXXXXX"
                    : taxIdType === "SSN"
                    ? "XXX-XX-XXXX"
                    : "9XX-XX-XXXX"
                }
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!!formError}
                aria-describedby="tax-id-hint"
                data-testid="input-tax-id"
              />
              <p
                id="tax-id-hint"
                className={`text-xs ${formError ? "text-destructive" : "text-muted-foreground"}`}
              >
                {formError ?? taxIdFormatHint(taxIdType)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tax address</CardTitle>
            <CardDescription>
              Address that should appear on issued 1099 forms. May differ from
              your operational address.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tax-addr-line1">Street address</Label>
              <Input
                id="tax-addr-line1"
                value={line1}
                onChange={(e) => setLine1(e.target.value)}
                placeholder="123 Main St"
                required
                data-testid="input-tax-addr-line1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tax-addr-line2">
                Apt / Suite <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="tax-addr-line2"
                value={line2}
                onChange={(e) => setLine2(e.target.value)}
                placeholder="Suite 200"
                data-testid="input-tax-addr-line2"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="tax-addr-city">City</Label>
                <Input
                  id="tax-addr-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  required
                  data-testid="input-tax-addr-city"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tax-addr-state">State</Label>
                <Input
                  id="tax-addr-state"
                  value={state}
                  onChange={(e) =>
                    setState(
                      e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z]/g, "")
                        .slice(0, 2),
                    )
                  }
                  maxLength={2}
                  placeholder="TX"
                  required
                  data-testid="input-tax-addr-state"
                />
              </div>
            </div>
            <div className="space-y-2 max-w-xs">
              <Label htmlFor="tax-addr-zip">ZIP</Label>
              <Input
                id="tax-addr-zip"
                value={zip}
                onChange={(e) =>
                  setZip(e.target.value.replace(/[^0-9-]/g, "").slice(0, 10))
                }
                placeholder="78701"
                inputMode="numeric"
                required
                data-testid="input-tax-addr-zip"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Button
            type="submit"
            disabled={saveMutation.isPending}
            data-testid="button-save-tax-identity"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : captured ? (
              "Update tax identity"
            ) : (
              "Save tax identity"
            )}
          </Button>
        </div>
      </form>
    </PageShell>
  );
}
