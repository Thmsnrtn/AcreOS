/**
 * AtrGate — pre-activation gate for a pending note.
 *
 * Reg-Z §1026.43(c) requires every consumer-purpose closed-end credit
 * transaction secured by a dwelling to have an ability-to-repay (ATR)
 * determination on file at or before consummation. The §1026.36(a)(4)
 * seller-financer exemption is for MLO licensing — it does NOT exempt
 * the creditor from ATR. The only statutory escapes are raw land
 * (non-dwelling), business-purpose credit, or a non-natural-person
 * (commercial) borrower.
 *
 * This component renders on the note detail page when the note's status
 * is 'pending'. The operator chooses one of two paths:
 *   1. Enter the eight statutory factors → POST to /originate as an ATR
 *      determination. The server validates + persists the attestation and
 *      flips the row to 'active'.
 *   2. Claim a statutory exemption (raw_land / business_purpose /
 *      commercial_borrower) → POST to /originate with just the exemption
 *      code, no eight-factor data.
 *
 * The "Activate" button is disabled until either (a) all eight factors are
 * filled and the attestation language is acknowledged, or (b) an exemption
 * code is selected. The DB CHECK constraint (notes_atr_origination_gate)
 * backstops this at the data layer.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ShieldCheck, AlertTriangle, FileCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

// The canonical attestation text — must match ATR_ATTESTATION_TEXT in
// server/services/atrSafeHarbor.ts. Keep them in sync.
const ATR_ATTESTATION_TEXT =
  "I certify that I have made a reasonable and good faith determination that the consumer has a reasonable ability to repay this loan according to its terms, based on consideration of the eight factors enumerated in 12 CFR 1026.43(c)(2), and that the factors have been verified using reasonably reliable third-party records as required by 12 CFR 1026.43(c)(3). The supporting documentation is retained in the consumer credit transaction file in accordance with 12 CFR 1026.25(c)(3).";

type EightFactorState = {
  factorI_incomeCents: string;
  factorII_employment: string;
  factorIII_monthlyMortgageCents: string;
  factorIV_simultaneousLoansCents: string;
  factorV_mortgageRelatedCents: string;
  factorVI_otherDebtsCents: string;
  factorVII_dtiOrResidualCents: string;
  factorVIII_creditHistory: string;
};

const EMPTY_FACTORS: EightFactorState = {
  factorI_incomeCents: "",
  factorII_employment: "",
  factorIII_monthlyMortgageCents: "",
  factorIV_simultaneousLoansCents: "0",
  factorV_mortgageRelatedCents: "0",
  factorVI_otherDebtsCents: "0",
  factorVII_dtiOrResidualCents: "",
  factorVIII_creditHistory: "",
};

type ExemptionCode = "raw_land" | "business_purpose" | "commercial_borrower";

interface AtrGateProps {
  noteId: number;
  /**
   * Current authenticated user — DISPLAY ONLY.
   *
   * Shown in the affirmation line so the operator can see whose name is going
   * on the certification. It is no longer sent: the server derives both
   * `attestedBy` and `attestedByUserId` from the authenticated session, because
   * a client-supplied certifier on a §1026.43 record is a signature anyone with
   * a session can forge.
   */
  attestor: { id: string; name: string };
  onActivated?: () => void;
}

export function AtrGate({ noteId, attestor, onActivated }: AtrGateProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"atr" | "exemption">("atr");
  const [factors, setFactors] = useState<EightFactorState>(EMPTY_FACTORS);
  const [attestationAcknowledged, setAttestationAcknowledged] = useState(false);
  const [exemptionCode, setExemptionCode] = useState<ExemptionCode | "">("");
  /**
   * §1026.43(c)(3) verification records — WHAT THE OPERATOR ACTUALLY HAS.
   *
   * These two fields used to be a hardcoded array with its own `// Stub:`
   * comment, shaped to satisfy the server's refusal rather than to describe
   * anything: `tax_return` + `credit_report`, both dated today, on every note
   * ever originated. So AcreOS wrote an invented fact about a named consumer's
   * credit file into a record built to be read by an examiner years later, and
   * the module's central refusal could never fire.
   *
   * The operator holds these documents; AcreOS does not. Asking is the whole
   * fix, and it is the posture in miniature — AcreOS supplies the form and the
   * refusal, the customer supplies the facts and certifies them.
   */
  const [incomeDoc, setIncomeDoc] = useState<{ documentType: string; receivedDate: string }>(
    { documentType: "", receivedDate: "" },
  );
  const [creditDoc, setCreditDoc] = useState<{ documentType: string; receivedDate: string }>(
    { documentType: "", receivedDate: "" },
  );

  const allEightFilled =
    factors.factorI_incomeCents.trim() !== "" &&
    Number(factors.factorI_incomeCents) > 0 &&
    factors.factorII_employment.trim() !== "" &&
    factors.factorIII_monthlyMortgageCents.trim() !== "" &&
    factors.factorIV_simultaneousLoansCents.trim() !== "" &&
    factors.factorV_mortgageRelatedCents.trim() !== "" &&
    factors.factorVI_otherDebtsCents.trim() !== "" &&
    factors.factorVII_dtiOrResidualCents.trim() !== "" &&
    factors.factorVIII_creditHistory.trim() !== "";

  const verificationRecorded =
    incomeDoc.documentType !== "" &&
    incomeDoc.receivedDate.trim() !== "" &&
    creditDoc.documentType !== "" &&
    creditDoc.receivedDate.trim() !== "";

  const atrReady = allEightFilled && verificationRecorded && attestationAcknowledged;
  const exemptionReady = exemptionCode !== "";
  const canActivate = mode === "atr" ? atrReady : exemptionReady;

  const activate = useMutation({
    mutationFn: async () => {
      const csrfToken =
        document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] ?? "";
      const body =
        mode === "atr"
          ? {
              atrDetermination: {
                currentOrReasonablyExpectedIncomeCents: Number(factors.factorI_incomeCents),
                currentEmploymentStatus: factors.factorII_employment.trim(),
                monthlyMortgagePaymentCents: Number(factors.factorIII_monthlyMortgageCents),
                monthlyPaymentSimultaneousLoansCents: Number(factors.factorIV_simultaneousLoansCents),
                monthlyPaymentMortgageRelatedObligationsCents: Number(factors.factorV_mortgageRelatedCents),
                currentDebtObligationsAlimonyChildSupportCents: Number(factors.factorVI_otherDebtsCents),
                monthlyDtiOrResidualIncomeCents: Number(factors.factorVII_dtiOrResidualCents),
                creditHistorySummary: factors.factorVIII_creditHistory.trim(),
                verificationDocuments: [
                  {
                    factor: "factor_i_income",
                    documentType: incomeDoc.documentType,
                    receivedDate: incomeDoc.receivedDate,
                  },
                  {
                    factor: "factor_viii_credit_history",
                    documentType: creditDoc.documentType,
                    receivedDate: creditDoc.receivedDate,
                  },
                ],
                qmClassification: null,
                // attestedBy / attestedByUserId are NOT sent. The server derives
                // both from the authenticated session and ignores the body —
                // otherwise the certifier of a federal credit determination is
                // whoever the caller says it is. Kept out of the payload rather
                // than sent-and-overridden so no reader thinks it is honoured.
                attestationText: ATR_ATTESTATION_TEXT,
              },
            }
          : { atrExemptionCode: exemptionCode as ExemptionCode };

      const res = await fetch(`/api/notes/${noteId}/originate`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrfToken),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Note activated",
        description:
          mode === "atr"
            ? "ATR determination recorded. Status set to active."
            : `Exemption (${exemptionCode}) recorded. Status set to active.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/notes", noteId] });
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      onActivated?.();
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't activate note",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Card className="border-acr-warn" data-testid="atr-gate">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-5 w-5 text-acr-warn" aria-hidden="true" />
          Ability-to-Repay determination required
        </CardTitle>
        <CardDescription>
          Reg Z §1026.43(c) requires an ATR determination at or before consummation for
          consumer-purpose loans secured by a dwelling. Provide either the eight statutory
          factors or claim a statutory exemption before activating this note.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as "atr" | "exemption")}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="atr" data-testid="tab-atr">
              Eight-factor ATR
            </TabsTrigger>
            <TabsTrigger value="exemption" data-testid="tab-exemption">
              Statutory exemption
            </TabsTrigger>
          </TabsList>

          <TabsContent value="atr" className="space-y-4 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="atr-factor-i">
                  (i) Annual income (cents)
                </Label>
                <Input
                  id="atr-factor-i"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={factors.factorI_incomeCents}
                  onChange={(e) =>
                    setFactors((f) => ({ ...f, factorI_incomeCents: e.target.value }))
                  }
                  aria-label="Statutory factor i — current or reasonably expected income in cents"
                  data-testid="atr-input-i"
                />
              </div>
              <div>
                <Label htmlFor="atr-factor-ii">
                  (ii) Current employment status
                </Label>
                <Input
                  id="atr-factor-ii"
                  type="text"
                  value={factors.factorII_employment}
                  onChange={(e) =>
                    setFactors((f) => ({ ...f, factorII_employment: e.target.value }))
                  }
                  aria-label="Statutory factor ii — current employment status"
                  data-testid="atr-input-ii"
                />
              </div>
              <div>
                <Label htmlFor="atr-factor-iii">
                  (iii) Monthly P&amp;I on this loan (cents)
                </Label>
                <Input
                  id="atr-factor-iii"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={factors.factorIII_monthlyMortgageCents}
                  onChange={(e) =>
                    setFactors((f) => ({
                      ...f,
                      factorIII_monthlyMortgageCents: e.target.value,
                    }))
                  }
                  aria-label="Statutory factor iii — monthly mortgage payment in cents"
                  data-testid="atr-input-iii"
                />
              </div>
              <div>
                <Label htmlFor="atr-factor-iv">
                  (iv) Simultaneous loan payment (cents)
                </Label>
                <Input
                  id="atr-factor-iv"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={factors.factorIV_simultaneousLoansCents}
                  onChange={(e) =>
                    setFactors((f) => ({
                      ...f,
                      factorIV_simultaneousLoansCents: e.target.value,
                    }))
                  }
                  aria-label="Statutory factor iv — monthly payment on simultaneous loans in cents"
                  data-testid="atr-input-iv"
                />
              </div>
              <div>
                <Label htmlFor="atr-factor-v">
                  (v) Taxes, insurance, HOA, MI (cents/mo)
                </Label>
                <Input
                  id="atr-factor-v"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={factors.factorV_mortgageRelatedCents}
                  onChange={(e) =>
                    setFactors((f) => ({
                      ...f,
                      factorV_mortgageRelatedCents: e.target.value,
                    }))
                  }
                  aria-label="Statutory factor v — monthly mortgage-related obligations in cents"
                  data-testid="atr-input-v"
                />
              </div>
              <div>
                <Label htmlFor="atr-factor-vi">
                  (vi) Other debts, alimony, child support (cents/mo)
                </Label>
                <Input
                  id="atr-factor-vi"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={factors.factorVI_otherDebtsCents}
                  onChange={(e) =>
                    setFactors((f) => ({
                      ...f,
                      factorVI_otherDebtsCents: e.target.value,
                    }))
                  }
                  aria-label="Statutory factor vi — current debt obligations in cents"
                  data-testid="atr-input-vi"
                />
              </div>
              <div>
                <Label htmlFor="atr-factor-vii">
                  (vii) DTI ratio (bps) or residual income (cents)
                </Label>
                <Input
                  id="atr-factor-vii"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={factors.factorVII_dtiOrResidualCents}
                  onChange={(e) =>
                    setFactors((f) => ({
                      ...f,
                      factorVII_dtiOrResidualCents: e.target.value,
                    }))
                  }
                  aria-label="Statutory factor vii — monthly DTI ratio or residual income"
                  data-testid="atr-input-vii"
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="atr-factor-viii">
                  (viii) Credit history summary
                </Label>
                <Textarea
                  id="atr-factor-viii"
                  rows={3}
                  value={factors.factorVIII_creditHistory}
                  onChange={(e) =>
                    setFactors((f) => ({
                      ...f,
                      factorVIII_creditHistory: e.target.value,
                    }))
                  }
                  aria-label="Statutory factor viii — credit history summary"
                  data-testid="atr-input-viii"
                />
              </div>
            </div>

            {/*
              §1026.43(c)(3) — the third-party records behind the factors above.
              These two fields replaced a hardcoded stub that asserted a tax
              return and a credit report, both dated today, on every note. The
              operator holds the documents; AcreOS does not, and must not say it
              does.
            */}
            <div className="space-y-3 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">
                  Third-party verification records
                </p>
                <p className="text-xs text-muted-foreground">
                  §1026.43(c)(3) requires the income and credit-history factors to
                  rest on reasonably reliable third-party records. Record what you
                  verified and when. The documents themselves stay in your own
                  consumer credit transaction file.
                </p>
              </div>
              {(
                [
                  {
                    key: "income",
                    label: "Income / assets — factor (i)",
                    testid: "atr-doc-income",
                    value: incomeDoc,
                    set: setIncomeDoc,
                    types: ["w2", "tax_return", "bank_statement", "pay_stub", "voe", "other"],
                  },
                  {
                    key: "credit",
                    label: "Credit history — factor (viii)",
                    testid: "atr-doc-credit",
                    value: creditDoc,
                    set: setCreditDoc,
                    types: ["credit_report", "other"],
                  },
                ] as const
              ).map((row) => (
                <div key={row.key} className="grid gap-2 md:grid-cols-2">
                  <div>
                    <Label htmlFor={`${row.testid}-type`}>{row.label}</Label>
                    <Select
                      value={row.value.documentType}
                      onValueChange={(v) => row.set((d) => ({ ...d, documentType: v }))}
                    >
                      <SelectTrigger
                        id={`${row.testid}-type`}
                        aria-label={`${row.label} — document type verified`}
                        data-testid={`${row.testid}-type`}
                      >
                        <SelectValue placeholder="Document type verified" />
                      </SelectTrigger>
                      <SelectContent>
                        {row.types.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t.replace(/_/g, " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`${row.testid}-date`}>Date received</Label>
                    <Input
                      id={`${row.testid}-date`}
                      type="date"
                      value={row.value.receivedDate}
                      onChange={(e) =>
                        row.set((d) => ({ ...d, receivedDate: e.target.value }))
                      }
                      aria-label={`${row.label} — date the record was received`}
                      data-testid={`${row.testid}-date`}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
              {ATR_ATTESTATION_TEXT}
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="atr-ack"
                checked={attestationAcknowledged}
                onCheckedChange={(v) => setAttestationAcknowledged(!!v)}
                aria-label="Acknowledge ATR attestation"
                data-testid="atr-acknowledge"
              />
              <Label htmlFor="atr-ack" className="text-sm font-normal leading-snug">
                I, {attestor.name}, affirm the attestation above and certify that the
                supporting documentation has been collected and retained per
                §1026.25(c)(3).
              </Label>
            </div>
          </TabsContent>

          <TabsContent value="exemption" className="space-y-4 pt-4">
            <div className="flex items-start gap-2 rounded-md border border-acr-warn bg-acr-warn-soft p-3 text-xs">
              <AlertTriangle className="h-4 w-4 text-acr-warn mt-0.5" aria-hidden="true" />
              <p>
                Claim an exemption only if the loan is statutorily out of scope. Choosing
                wrong does not insulate you from §1026.43 — the analysis is fact-driven.
              </p>
            </div>
            <div>
              <Label htmlFor="atr-exemption-select">Exemption code</Label>
              <Select
                value={exemptionCode}
                onValueChange={(v) => setExemptionCode(v as ExemptionCode)}
              >
                <SelectTrigger
                  id="atr-exemption-select"
                  aria-label="Select statutory exemption code"
                  data-testid="atr-exemption-select"
                >
                  <SelectValue placeholder="Select an exemption…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="raw_land">
                    Raw land — non-dwelling collateral
                  </SelectItem>
                  <SelectItem value="business_purpose">
                    Business purpose — §1026.43(a)(1)(i)
                  </SelectItem>
                  <SelectItem value="commercial_borrower">
                    Commercial borrower — entity, not a natural person
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end pt-2">
          <Button
            type="button"
            onClick={() => activate.mutate()}
            disabled={!canActivate || activate.isPending}
            aria-label="Activate note after ATR determination or exemption"
            data-testid="atr-activate-button"
          >
            <FileCheck className="h-4 w-4 mr-2" aria-hidden="true" />
            {activate.isPending ? "Activating…" : "Activate note"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
