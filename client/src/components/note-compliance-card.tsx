/**
 * Compliance card for the acquired-note detail page.
 *
 * Two halves: hazard insurance + property-tax escrow with disbursement-
 * due workflow. Both fields are inline-editable on the same card.
 *
 * Linnea: "A note platform without insurance compliance is incomplete."
 * + "Without [a tax disbursement workflow] I miss a tax payment and
 * lose lien priority."
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Shield, Landmark, AlertTriangle, CheckCircle2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/format";
import { Verbs } from "@/lib/labels";

type InsuranceStatus = "verified" | "expiring_soon" | "lapsed" | "force_placed";

interface ComplianceProps {
  noteId: string;
  insuranceStatus: InsuranceStatus;
  insuranceCarrier: string | null;
  insurancePolicyNumber: string | null;
  insuranceExpiresAt: string | null;
  taxEscrowEnabled: boolean;
  taxEscrowBalanceCents: number;
  taxDisbursementDueDate: string | null;
  taxDisbursementAmountCents: number | null;
  taxAuthorityName: string | null;
}

const STATUS_TONE: Record<InsuranceStatus, { tone: string; label: string; icon: typeof CheckCircle2 }> = {
  verified: { tone: "text-acr-pos", label: "Verified", icon: CheckCircle2 },
  expiring_soon: { tone: "text-acr-warning", label: "Expiring soon", icon: AlertTriangle },
  lapsed: { tone: "text-acr-neg", label: "Lapsed", icon: AlertTriangle },
  force_placed: { tone: "text-acr-warning", label: "Force-placed", icon: Shield },
};

function fmtUsd(cents: number | null): string {
  if (cents === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  return Math.round(ms / 86_400_000);
}

export function NoteComplianceCard(props: ComplianceProps) {
  const { toast } = useToast();
  const [editingInsurance, setEditingInsurance] = useState(false);
  const [editingTax, setEditingTax] = useState(false);

  // Insurance form state
  const [insStatus, setInsStatus] = useState<InsuranceStatus>(props.insuranceStatus);
  const [insCarrier, setInsCarrier] = useState(props.insuranceCarrier ?? "");
  const [insPolicy, setInsPolicy] = useState(props.insurancePolicyNumber ?? "");
  const [insExpiresAt, setInsExpiresAt] = useState(props.insuranceExpiresAt ?? "");

  // Tax form state
  const [taxOn, setTaxOn] = useState(props.taxEscrowEnabled);
  const [taxBalance, setTaxBalance] = useState(props.taxEscrowBalanceCents ? String(props.taxEscrowBalanceCents / 100) : "");
  const [taxDueDate, setTaxDueDate] = useState(props.taxDisbursementDueDate ?? "");
  const [taxAmount, setTaxAmount] = useState(props.taxDisbursementAmountCents ? String(props.taxDisbursementAmountCents / 100) : "");
  const [taxAuthority, setTaxAuthority] = useState(props.taxAuthorityName ?? "");

  const patchMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/notes/${props.noteId}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrfToken),
        },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Save failed" }));
        throw new Error(err.message || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes", props.noteId] });
      setEditingInsurance(false);
      setEditingTax(false);
      toast({ title: "Saved" });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't save", description: err.message, variant: "destructive" });
    },
  });

  const saveInsurance = () => {
    patchMutation.mutate({
      insuranceStatus: insStatus,
      insuranceCarrier: insCarrier.trim() || undefined,
      insurancePolicyNumber: insPolicy.trim() || undefined,
      insuranceExpiresAt: insExpiresAt || undefined,
    });
  };

  const saveTax = () => {
    patchMutation.mutate({
      taxEscrowEnabled: taxOn,
      taxEscrowBalanceCents: taxBalance ? Math.round(parseFloat(taxBalance.replace(/[$,\s]/g, "")) * 100) : 0,
      taxDisbursementDueDate: taxDueDate || undefined,
      taxDisbursementAmountCents: taxAmount ? Math.round(parseFloat(taxAmount.replace(/[$,\s]/g, "")) * 100) : undefined,
      taxAuthorityName: taxAuthority.trim() || undefined,
    });
  };

  const meta = STATUS_TONE[props.insuranceStatus];
  const StatusIcon = meta.icon;
  const expiresInDays = daysUntil(props.insuranceExpiresAt);
  const dueInDays = daysUntil(props.taxDisbursementDueDate);

  return (
    <Card className="mb-6">
      <div className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Insurance half */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" aria-hidden="true" />
                <h2 className="text-sm font-semibold">Hazard insurance</h2>
              </div>
              {!editingInsurance && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setEditingInsurance(true)}>
                  {Verbs.EDIT}
                </Button>
              )}
            </div>

            {!editingInsurance ? (
              <>
                <div className="flex items-center gap-1.5 mb-3">
                  <StatusIcon className={`w-4 h-4 ${meta.tone}`} aria-hidden="true" />
                  <span className={`text-sm font-medium ${meta.tone}`}>{meta.label}</span>
                </div>
                <dl className="space-y-1.5 text-xs">
                  <Row label="Carrier" value={props.insuranceCarrier || "—"} />
                  <Row label="Policy #" value={props.insurancePolicyNumber || "—"} mono />
                  <Row
                    label="Expires"
                    value={formatDate(props.insuranceExpiresAt)}
                    sub={expiresInDays !== null ? `${expiresInDays >= 0 ? `${expiresInDays} days` : `${Math.abs(expiresInDays)} days ago`}` : undefined}
                  />
                </dl>
              </>
            ) : (
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label htmlFor="ins-status" className="text-xs">Status</Label>
                  <Select value={insStatus} onValueChange={(v) => setInsStatus(v as InsuranceStatus)}>
                    <SelectTrigger id="ins-status" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="verified">Verified</SelectItem>
                      <SelectItem value="expiring_soon">Expiring soon</SelectItem>
                      <SelectItem value="lapsed">Lapsed</SelectItem>
                      <SelectItem value="force_placed">Force-placed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ins-carrier" className="text-xs">Carrier</Label>
                  <Input id="ins-carrier" className="h-8 text-xs" value={insCarrier} onChange={(e) => setInsCarrier(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ins-policy" className="text-xs">Policy number</Label>
                  <Input id="ins-policy" className="h-8 text-xs font-mono" value={insPolicy} onChange={(e) => setInsPolicy(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ins-expires" className="text-xs">Expires</Label>
                  <Input id="ins-expires" type="date" className="h-8 text-xs" value={insExpiresAt} onChange={(e) => setInsExpiresAt(e.target.value)} />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingInsurance(false)}>{Verbs.CANCEL}</Button>
                  <Button size="sm" className="h-7 text-xs" onClick={saveInsurance} disabled={patchMutation.isPending}>{Verbs.SAVE}</Button>
                </div>
              </div>
            )}
          </div>

          {/* Tax escrow half */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Landmark className="w-4 h-4 text-primary" aria-hidden="true" />
                <h2 className="text-sm font-semibold">Property-tax escrow</h2>
              </div>
              {!editingTax && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setEditingTax(true)}>
                  {Verbs.EDIT}
                </Button>
              )}
            </div>

            {!editingTax ? (
              !props.taxEscrowEnabled ? (
                <p className="text-sm text-muted-foreground">Tax escrow not collected on this note.</p>
              ) : (
                <dl className="space-y-1.5 text-xs">
                  <Row label="Balance" value={fmtUsd(props.taxEscrowBalanceCents)} />
                  <Row label="Authority" value={props.taxAuthorityName || "—"} />
                  <Row
                    label="Next due"
                    value={formatDate(props.taxDisbursementDueDate)}
                    sub={
                      dueInDays !== null
                        ? dueInDays < 0
                          ? `Overdue by ${Math.abs(dueInDays)} days`
                          : dueInDays <= 60
                            ? `Due in ${dueInDays} days`
                            : `Due in ${dueInDays} days`
                        : undefined
                    }
                    tone={dueInDays !== null && dueInDays < 0 ? "text-acr-neg" : dueInDays !== null && dueInDays <= 30 ? "text-acr-warning" : undefined}
                  />
                  <Row label="Amount" value={fmtUsd(props.taxDisbursementAmountCents)} />
                </dl>
              )
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="tax-on" className="text-xs">Collecting tax escrow</Label>
                  <Switch id="tax-on" checked={taxOn} onCheckedChange={setTaxOn} />
                </div>
                {taxOn && (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor="tax-balance" className="text-xs">Current balance</Label>
                      <Input id="tax-balance" inputMode="decimal" className="h-8 text-xs" value={taxBalance} onChange={(e) => setTaxBalance(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="tax-authority" className="text-xs">Tax authority</Label>
                      <Input id="tax-authority" className="h-8 text-xs" value={taxAuthority} onChange={(e) => setTaxAuthority(e.target.value)} placeholder="County name / state DOR" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="tax-due-date" className="text-xs">Next disbursement due</Label>
                      <Input id="tax-due-date" type="date" className="h-8 text-xs" value={taxDueDate} onChange={(e) => setTaxDueDate(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="tax-amount" className="text-xs">Disbursement amount</Label>
                      <Input id="tax-amount" inputMode="decimal" className="h-8 text-xs" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} />
                    </div>
                  </>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingTax(false)}>{Verbs.CANCEL}</Button>
                  <Button size="sm" className="h-7 text-xs" onClick={saveTax} disabled={patchMutation.isPending}>{Verbs.SAVE}</Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Top-of-card warning banner if anything's awry. */}
        {(props.insuranceStatus !== "verified" || (props.taxEscrowEnabled && dueInDays !== null && dueInDays <= 30)) && (
          <>
            <Separator className="my-4" />
            <div className="flex items-start gap-2 text-xs text-acr-warning">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                {props.insuranceStatus === "lapsed" && "Insurance lapsed — uninsured loss risk. Force-place coverage and add the premium to escrow. "}
                {props.insuranceStatus === "expiring_soon" && "Insurance policy expiring soon. "}
                {props.taxEscrowEnabled && dueInDays !== null && dueInDays < 0 && `Tax disbursement overdue by ${Math.abs(dueInDays)} days. Lien priority at risk. `}
                {props.taxEscrowEnabled && dueInDays !== null && dueInDays >= 0 && dueInDays <= 30 && `Tax disbursement due in ${dueInDays} days. `}
              </span>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function Row({ label, value, sub, tone, mono }: { label: string; value: string; sub?: string; tone?: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-right ${mono ? "font-mono" : ""} ${tone ?? ""}`}>
        {value}
        {sub && <span className={`block text-micro ${tone ?? "text-muted-foreground"}`}>{sub}</span>}
      </dd>
    </div>
  );
}
