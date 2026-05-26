/**
 * Lazy tax-identity prompt — shown when a user attempts to create their
 * FIRST seller-financed note and their organization has not yet captured
 * the IRS-required tax identity (legalEntityName + EIN/SSN/ITIN + tax
 * address).
 *
 * This was previously a mandatory step inside the signup OnboardingWizard
 * (step 4). Moved out 2026-05-11 — a land flipper without seller-financed
 * notes doesn't need this for weeks/months, so demanding an EIN at signup
 * was a friction point with no purpose. Now we prompt at the moment the
 * data first becomes load-bearing: the first note that would generate a
 * 1099-INT for a borrower.
 *
 * UX:
 *  - "Save & continue"  → PATCH /api/organization/tax-identity, then
 *    invokes onCaptured() so the caller can proceed with the deferred
 *    note save.
 *  - "Skip — I'll add it later" → POST /api/organization/tax-identity/skip,
 *    saves the in-flight note as DRAFT (caller controls how), explains
 *    that 1099-INT issuance will block until provided. The skip flag is
 *    surfaced in the dashboard checklist.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Loader2, AlertTriangle, Lock } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  formatTaxIdAsTyped,
  isValidTaxId,
  taxIdFormatHint,
  type TaxIdType,
} from "@shared/taxIdentity";
import { useToast } from "@/hooks/use-toast";
import { clientLogger } from "@/lib/clientLogger";

interface TaxIdentityPromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save — caller should proceed with the deferred action. */
  onCaptured: () => void;
  /** Called when the user chooses to skip — caller typically saves the in-flight item as draft. */
  onSkipped: () => void;
  /** Optional context describing what the user was trying to do, shown in the modal copy. */
  deferredActionLabel?: string;
}

export function TaxIdentityPrompt({
  open,
  onOpenChange,
  onCaptured,
  onSkipped,
  deferredActionLabel = "save this note",
}: TaxIdentityPromptProps) {
  const { toast } = useToast();
  const [legalEntityName, setLegalEntityName] = useState("");
  const [taxIdType, setTaxIdType] = useState<TaxIdType>("EIN");
  const [taxId, setTaxId] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [zip, setZip] = useState("");
  const [error, setError] = useState<string | null>(null);

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
          state: stateCode.trim().toUpperCase(),
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
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
      queryClient.invalidateQueries({ queryKey: ["/api/organization/tax-identity"] });
      toast({
        title: "Tax identity saved",
        description: "Encrypted and stored. 1099-INT issuance is unblocked.",
      });
      onCaptured();
    },
    onError: (err: Error) => {
      setError(err.message || "Couldn't save tax identity");
    },
  });

  const skipMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/organization/tax-identity/skip", {});
      if (!res.ok) throw new Error("Couldn't skip");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
      queryClient.invalidateQueries({ queryKey: ["/api/organization/tax-identity"] });
      onSkipped();
    },
    onError: (err: Error) => {
      clientLogger.error("Couldn't skip tax identity", err);
      // Even if the skip POST fails, the deferred-as-draft path still applies.
      onSkipped();
    },
  });

  const canSubmit =
    legalEntityName.trim().length > 0 &&
    taxId.trim().length > 0 &&
    line1.trim().length > 0 &&
    city.trim().length > 0 &&
    stateCode.trim().length === 2 &&
    /^[0-9]{5}(-[0-9]{4})?$/.test(zip.trim());

  const handleSave = () => {
    setError(null);
    if (!isValidTaxId(taxId, taxIdType)) {
      setError(taxIdFormatHint(taxIdType));
      return;
    }
    saveMutation.mutate();
  };

  const isPending = saveMutation.isPending || skipMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="secondary" className="gap-1">
              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
              One-time setup
            </Badge>
          </div>
          <DialogTitle>Set up 1099-INT issuance</DialogTitle>
          <DialogDescription>
            Required by the IRS before we can {deferredActionLabel}. Each
            seller-financed note generates a 1099-INT for the borrower at year
            end — that form needs your legal entity name and tax ID.
            Encrypted at rest with AES-256-GCM; plaintext is never returned
            to the browser.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="tip-legal-entity-name">
              Legal entity name <span className="text-destructive" aria-label="required">*</span>
            </Label>
            <Input
              id="tip-legal-entity-name"
              value={legalEntityName}
              onChange={(e) => setLegalEntityName(e.target.value)}
              placeholder="e.g. Apex Land Group, LLC"
              aria-required="true"
              data-testid="tip-input-legal-entity-name"
            />
            <p className="text-xs text-muted-foreground">
              Must match the entity name registered with the IRS exactly.
            </p>
          </div>

          {/* Trust microcopy at the moment of entry. Customers giving us
              an SSN/EIN are at peak anxiety — the /security page describes
              encryption at rest + audit-trail-per-access, but you have to
              go look for it. Surface it here, the one moment they need
              the reassurance. */}
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
            <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-foreground/70" aria-hidden />
            <span>
              Encrypted at rest, never shown back to support, audit-logged on every read.{" "}
              <Link href="/security" className="underline hover:text-foreground">
                How we protect your data
              </Link>
              .
            </span>
          </div>

          <div className="space-y-2">
            <Label>Tax ID type</Label>
            <RadioGroup
              value={taxIdType}
              onValueChange={(value) => {
                setTaxIdType(value as TaxIdType);
                setTaxId("");
                setError(null);
              }}
              className="flex gap-2"
            >
              {(["EIN", "SSN", "ITIN"] as const).map((opt) => (
                <Label
                  key={opt}
                  htmlFor={`tip-tax-id-type-${opt}`}
                  className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors ${
                    taxIdType === opt
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-input hover:bg-accent"
                  }`}
                  data-testid={`tip-option-tax-id-type-${opt}`}
                >
                  <RadioGroupItem value={opt} id={`tip-tax-id-type-${opt}`} className="sr-only" />
                  {opt}
                </Label>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tip-tax-id">
              Tax ID ({taxIdType}) <span className="text-destructive" aria-label="required">*</span>
            </Label>
            <Input
              id="tip-tax-id"
              value={taxId}
              onChange={(e) => {
                setTaxId(formatTaxIdAsTyped(e.target.value, taxIdType));
                setError(null);
              }}
              placeholder={
                taxIdType === "EIN" ? "XX-XXXXXXX" : taxIdType === "SSN" ? "XXX-XX-XXXX" : "9XX-XX-XXXX"
              }
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              aria-required="true"
              aria-invalid={!!error}
              aria-describedby="tip-tax-id-hint"
              data-testid="tip-input-tax-id"
            />
            <p
              id="tip-tax-id-hint"
              className={`text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}
            >
              {error ?? taxIdFormatHint(taxIdType)}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Tax address <span className="text-destructive" aria-label="required">*</span></Label>
            <p className="text-xs text-muted-foreground">
              Address that should appear on issued 1099s. Can differ from your operational address.
            </p>
            <div className="space-y-2">
              <Input
                value={line1}
                onChange={(e) => setLine1(e.target.value)}
                placeholder="Street address"
                aria-label="Street address"
                aria-required="true"
                data-testid="tip-input-tax-addr-line1"
              />
              <Input
                value={line2}
                onChange={(e) => setLine2(e.target.value)}
                placeholder="Apt / Suite (optional)"
                aria-label="Apartment or suite (optional)"
                data-testid="tip-input-tax-addr-line2"
              />
              <div className="grid grid-cols-[2fr_1fr_1fr] gap-2">
                <Input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="City"
                  aria-label="City"
                  aria-required="true"
                  data-testid="tip-input-tax-addr-city"
                />
                <Input
                  value={stateCode}
                  onChange={(e) =>
                    setStateCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2))
                  }
                  placeholder="State"
                  aria-label="State (2-letter code)"
                  aria-required="true"
                  maxLength={2}
                  data-testid="tip-input-tax-addr-state"
                />
                <Input
                  value={zip}
                  onChange={(e) => setZip(e.target.value.replace(/[^0-9-]/g, "").slice(0, 10))}
                  placeholder="ZIP"
                  aria-label="ZIP code"
                  aria-required="true"
                  inputMode="numeric"
                  data-testid="tip-input-tax-addr-zip"
                />
              </div>
            </div>
          </div>

          <div
            role="note"
            className="flex gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground"
          >
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-acr-pos" aria-hidden="true" />
            <span>
              Encrypted with AES-256-GCM at rest. Plaintext is never returned
              to the client — even owners only see the last four digits in
              the audit log.
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => skipMutation.mutate()}
            disabled={isPending}
            data-testid="tip-button-skip"
          >
            Skip — I'll add it later
          </Button>
          <Button
            onClick={handleSave}
            disabled={isPending || !canSubmit}
            data-testid="tip-button-save"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> Saving…
              </>
            ) : (
              "Save & continue"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
