/**
 * /account/fcra-attestation/substantive — Panel-300 G4 substantive
 * 3-screen FCRA attestation form.
 *
 * Wynne's "theater that works in depositions" standard. Replaces the
 * checkbox attestation with a structured form capturing permissible
 * purpose, specific use-case (≥50 chars), data categories used, operator
 * role, and explicit acknowledgements. Posts to the G4 endpoint
 * (POST /api/account/fcra-attestation with substantiveForm payload).
 *
 * Three screens: PURPOSE → DATA → ACKNOWLEDGEMENTS. Linear; no skip.
 * Validation per screen before allowing next.
 */

import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ShieldCheck, ChevronLeft, ChevronRight, AlertTriangle, Check } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";

const PURPOSES: Array<{ key: string; label: string; description: string }> = [
  { key: "tenant_screening", label: "Tenant screening", description: "Evaluating an applicant for a residential or commercial lease." },
  { key: "account_review", label: "Account review", description: "Reviewing an existing tenant's account (renewal, default, etc.)." },
  { key: "written_consent", label: "Written consent", description: "The subject has provided written consent for this lookup." },
  { key: "legitimate_business_need", label: "Legitimate business need", description: "FCRA §1681b(a)(3)(F) — legitimate business need with the consumer." },
  { key: "collection", label: "Collection", description: "Collection of an account of the consumer." },
];

const DATA_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "credit", label: "Credit history" },
  { key: "criminal", label: "Criminal background" },
  { key: "eviction", label: "Eviction history" },
  { key: "income", label: "Income verification" },
  { key: "address", label: "Address history" },
  { key: "phone", label: "Phone records" },
  { key: "email", label: "Email records" },
];

const OPERATOR_ROLES: Array<{ key: string; label: string }> = [
  { key: "owner", label: "Owner / principal investor" },
  { key: "property_manager", label: "Property manager" },
  { key: "leasing_agent", label: "Leasing agent" },
  { key: "screening_specialist", label: "Screening specialist" },
];

function csrf(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

export default function FcraSubstantiveFormPage() {
  useDocumentTitle("FCRA attestation — AcreOS");
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [screen, setScreen] = useState<1 | 2 | 3>(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // State across screens
  const [permissiblePurpose, setPermissiblePurpose] = useState("");
  const [specificUseCase, setSpecificUseCase] = useState("");
  const [dataCategoriesUsed, setDataCategoriesUsed] = useState<string[]>([]);
  const [operatorRole, setOperatorRole] = useState("");
  const [ackAdverseAction, setAckAdverseAction] = useState(false);
  const [ackRetention, setAckRetention] = useState(false);

  const screen1Valid = !!permissiblePurpose && specificUseCase.trim().length >= 50;
  const screen2Valid = dataCategoriesUsed.length > 0 && !!operatorRole;
  const screen3Valid = ackAdverseAction && ackRetention;

  const submit = async () => {
    setSubmitting(true);
    try {
      const r = await fetch("/api/account/fcra-attestation", {
        method: "POST",
        credentials: "include",
        headers: csrf(),
        body: JSON.stringify({
          substantiveForm: {
            permissiblePurpose,
            specificUseCase,
            dataCategoriesUsed,
            operatorRole,
            acknowledgedAdverseActionDuty: ackAdverseAction,
            acknowledgedDataRetentionPolicy: ackRetention,
          },
        }),
      });
      if (!r.ok) {
        const detail = await r.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${r.status})`);
      }
      setSubmitted(true);
      toast({ title: "Attestation recorded", description: "Valid for 365 days." });
    } catch (err: any) {
      toast({ title: "Couldn't record attestation", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <PageShell label="FCRA attestation">
        <Card className="max-w-2xl mx-auto mt-12">
          <CardContent className="py-12 text-center">
            <Check className="w-12 h-12 text-acr-pos mx-auto mb-4" aria-hidden="true" />
            <h1 className="text-2xl font-semibold mb-2">Attestation recorded</h1>
            <p className="text-muted-foreground mb-6">
              Your annual FCRA permissible-purpose attestation is valid for the next 365 days. Each tenant
              screening you run will require a per-lookup justification on top of this annual record.
            </p>
            <Button asChild>
              <Link href="/today">Back to AcreOS</Link>
            </Button>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell label="FCRA attestation">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6 flex items-start gap-3">
          <ShieldCheck className="w-7 h-7 text-primary mt-1" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">FCRA attestation — annual</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              Required before running tenant screenings. Three screens; takes ~2 minutes. Valid 365 days.
            </p>
          </div>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`h-2 rounded-full transition-all ${
                screen === n ? "bg-primary w-8" : "bg-muted w-4"
              }`}
              aria-hidden="true"
            />
          ))}
        </div>

        {/* Screen 1: Permissible purpose + use case */}
        {screen === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Step 1 of 3: Permissible purpose</CardTitle>
              <CardDescription>
                Pick the permissible purpose under FCRA §1681b that authorizes this lookup, then describe
                the specific use-case in your own words (≥50 characters).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                {PURPOSES.map((p) => (
                  <label
                    key={p.key}
                    className={`flex items-start gap-3 p-3 rounded-card border cursor-pointer transition-colors ${
                      permissiblePurpose === p.key
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/30"
                    }`}
                  >
                    <input
                      type="radio"
                      name="purpose"
                      className="mt-1"
                      checked={permissiblePurpose === p.key}
                      onChange={() => setPermissiblePurpose(p.key)}
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{p.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{p.description}</div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="space-y-2">
                <Label htmlFor="useCase">Specific use-case (your own words, ≥50 chars)</Label>
                <Textarea
                  id="useCase"
                  rows={4}
                  value={specificUseCase}
                  onChange={(e) => setSpecificUseCase(e.target.value)}
                  placeholder="e.g., Screening prospective tenants for our 24-unit BH portfolio in Travis County. We will use the data only for the lease decision and retain it per our 90-day retention policy."
                />
                <div
                  className={`text-xs ${
                    specificUseCase.trim().length >= 50 ? "text-acr-pos" : "text-muted-foreground"
                  }`}
                >
                  {specificUseCase.trim().length} / 50 characters
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button disabled={!screen1Valid} onClick={() => setScreen(2)}>
                  Next <ChevronRight className="w-4 h-4 ml-1" aria-hidden="true" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Screen 2: Data categories + operator role */}
        {screen === 2 && (
          <Card>
            <CardHeader>
              <CardTitle>Step 2 of 3: What you'll use, who you are</CardTitle>
              <CardDescription>
                Select the data categories you'll use AND your role within the org. Both shape the audit
                trail tied to each screening run.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label>Data categories used (select all that apply)</Label>
                <div className="grid grid-cols-2 gap-2">
                  {DATA_CATEGORIES.map((c) => {
                    const checked = dataCategoriesUsed.includes(c.key);
                    return (
                      <label
                        key={c.key}
                        className={`flex items-center gap-2 p-3 rounded-md border cursor-pointer transition-colors ${
                          checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            setDataCategoriesUsed(
                              v
                                ? [...dataCategoriesUsed, c.key]
                                : dataCategoriesUsed.filter((k) => k !== c.key),
                            );
                          }}
                        />
                        <span className="text-sm">{c.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <Label>Your role within the organization</Label>
                <div className="space-y-2">
                  {OPERATOR_ROLES.map((r) => (
                    <label
                      key={r.key}
                      className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                        operatorRole === r.key
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/30"
                      }`}
                    >
                      <input
                        type="radio"
                        name="role"
                        checked={operatorRole === r.key}
                        onChange={() => setOperatorRole(r.key)}
                      />
                      <span className="text-sm">{r.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setScreen(1)}>
                  <ChevronLeft className="w-4 h-4 mr-1" aria-hidden="true" /> Back
                </Button>
                <Button disabled={!screen2Valid} onClick={() => setScreen(3)}>
                  Next <ChevronRight className="w-4 h-4 ml-1" aria-hidden="true" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Screen 3: Acknowledgements */}
        {screen === 3 && (
          <Card>
            <CardHeader>
              <CardTitle>Step 3 of 3: Acknowledgements</CardTitle>
              <CardDescription>
                You must explicitly acknowledge both duties before AcreOS will permit a tenant-screening
                lookup under your account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <label className={`flex items-start gap-3 p-4 rounded-card border cursor-pointer ${
                ackAdverseAction ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
              }`}>
                <Checkbox
                  checked={ackAdverseAction}
                  onCheckedChange={(v) => setAckAdverseAction(!!v)}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm font-medium">Adverse-action duty</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    I understand that any adverse action taken against an applicant based wholly or partly
                    on a screening report obtained through AcreOS triggers the FCRA adverse-action
                    notification requirement. I will provide each affected applicant a notice naming the
                    consumer reporting agency, a statement of their dispute right, and a copy of their
                    rights under FCRA — within the statutory window.
                  </div>
                </div>
              </label>

              <label className={`flex items-start gap-3 p-4 rounded-card border cursor-pointer ${
                ackRetention ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
              }`}>
                <Checkbox
                  checked={ackRetention}
                  onCheckedChange={(v) => setAckRetention(!!v)}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm font-medium">Data-retention policy</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    I will retain screening data only as long as needed for the lease decision and any
                    associated dispute window. I will not share the data outside my organization except
                    as required by law. I understand AcreOS retains audit metadata (who ran a screening,
                    when, with what stated purpose) under the data-retention policy in our admin console.
                  </div>
                </div>
              </label>

              {!screen3Valid && (
                <div className="flex items-start gap-2 p-3 rounded-md bg-acr-warn/10 border border-acr-warn/30">
                  <AlertTriangle className="w-4 h-4 mt-0.5 text-acr-warn flex-shrink-0" aria-hidden="true" />
                  <p className="text-xs text-muted-foreground">
                    Both acknowledgements are required. AcreOS won't process tenant screenings without an
                    operator-confirmed adverse-action and retention commitment on file.
                  </p>
                </div>
              )}

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setScreen(2)}>
                  <ChevronLeft className="w-4 h-4 mr-1" aria-hidden="true" /> Back
                </Button>
                <Button
                  disabled={!screen3Valid || submitting}
                  onClick={submit}
                >
                  {submitting ? "Recording…" : "Submit attestation"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="mt-6 text-xs text-muted-foreground text-center max-w-xl mx-auto">
          This attestation is logged with your IP, user-agent, and timestamp. It supersedes any prior
          checkbox-only attestation on file. Valid 365 days; you'll be prompted to refresh before expiry.
        </p>
      </div>
    </PageShell>
  );
}
