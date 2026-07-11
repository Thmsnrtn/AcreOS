/**
 * W6.1 — the wholesaler's defining mechanic, finally in the UI.
 *
 * The backend has existed for a while: contract_assignments records
 * (end buyer + fee in integer cents + status machine), CRUD at
 * /api/deals/:id/assignments (POST returns the state legality rule),
 * the Assignment Contract system template, template generation at
 * /api/generated-documents (with the wholesaler compliance gate — 409
 * blocked in license-required states, 409 warn requiring explicit
 * acknowledgement), and the native e-sign pipeline. ZERO client code
 * touched any of it — the fee lived in a spreadsheet and the wholesaler
 * dashboard proxied revenue off netProfit.
 *
 * This panel chains those existing endpoints as one visible flow:
 *   record assignment (fee + end buyer, state rule surfaced)
 *   → generate the contract from the system template (compliance gate
 *     handled: blocked renders the citation, warn asks for an ack)
 *   → send for signature (per-signer links to copy into your own email)
 *   → mark signed when the document completes.
 *
 * Rendered inside the Docs tab of a deal (a section behind an existing
 * door, per the five-door rule). Visible for wholesaler orgs — and for
 * ANY org that already has assignment records on the deal (data is
 * never hidden by a persona toggle).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRightLeft, Copy, FileSignature, FileText, ShieldAlert } from "lucide-react";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

interface Assignment {
  id: number;
  dealId: number;
  endBuyerName: string | null;
  endBuyerProfileId: number | null;
  assignmentFeeCents: number;
  originalContractDate: string | null;
  generatedDocumentId: number | null;
  status: "draft" | "doc_generated" | "sent_for_signature" | "signed" | "cancelled";
  notes: string | null;
}

interface StateRule {
  state: string;
  status: string;
  licenseRequired: boolean;
  advertisingRestricted: boolean;
  recommendation: string;
  citation: string | null;
  summary: string | null;
}

interface SigningLink {
  signerId: string;
  name: string;
  email: string;
  role: string;
  url: string;
}

const STATUS_LABEL: Record<Assignment["status"], string> = {
  draft: "Draft",
  doc_generated: "Contract generated",
  sent_for_signature: "Out for signature",
  signed: "Signed",
  cancelled: "Cancelled",
};

const STATUS_VARIANT: Record<Assignment["status"], "secondary" | "default" | "destructive" | "outline"> = {
  draft: "secondary",
  doc_generated: "default",
  sent_for_signature: "default",
  signed: "default",
  cancelled: "destructive",
};

function dollarsToCents(value: string): number | null {
  const n = Number.parseFloat(value.replace(/[$,]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function AssignmentPanel({ dealId, propertyId }: { dealId: number; propertyId?: number | null }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: org } = useOrganization();

  const { data: assignments, isLoading } = useQuery<Assignment[]>({
    queryKey: [`/api/deals/${dealId}/assignments`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/deals/${dealId}/assignments`);
      return res.json();
    },
  });

  const businessType = (org?.settings as { businessType?: string } | null | undefined)?.businessType;
  const isWholesaler = businessType === "residential_wholesaler";
  const hasRecords = (assignments?.length ?? 0) > 0;

  // Local flow state
  const [stateRule, setStateRule] = useState<StateRule | null>(null);
  const [complianceIssue, setComplianceIssue] = useState<{
    kind: "blocked" | "warn";
    message: string;
    recommendation?: string;
    citation?: string;
  } | null>(null);
  const [signingLinks, setSigningLinks] = useState<SigningLink[]>([]);
  const [buyerEmail, setBuyerEmail] = useState("");

  // Create form state
  const [buyerName, setBuyerName] = useState("");
  const [feeDollars, setFeeDollars] = useState("");
  const [contractDate, setContractDate] = useState("");

  const active = assignments?.find((a) => a.status !== "cancelled") ?? null;

  const createAssignment = useMutation({
    mutationFn: async () => {
      const cents = dollarsToCents(feeDollars);
      if (cents === null) throw new Error("Enter the assignment fee in dollars (e.g. 7,500).");
      if (!buyerName.trim()) throw new Error("Enter the end buyer's name.");
      const res = await apiRequest("POST", `/api/deals/${dealId}/assignments`, {
        endBuyerName: buyerName.trim(),
        assignmentFeeCents: cents,
        ...(contractDate ? { originalContractDate: contractDate } : {}),
      });
      return res.json() as Promise<{ assignment: Assignment; stateRule: StateRule | null }>;
    },
    onSuccess: (data) => {
      setStateRule(data.stateRule);
      queryClient.invalidateQueries({ queryKey: [`/api/deals/${dealId}/assignments`] });
      toast({ title: "Assignment recorded", description: "Fee and end buyer saved on this deal." });
    },
    onError: (err: Error) => toast({ title: "Couldn't record the assignment", description: err.message, variant: "destructive" }),
  });

  const patchAssignment = useMutation({
    mutationFn: async (patch: Partial<Assignment> & { id: number }) => {
      const { id, ...body } = patch;
      const res = await apiRequest("PATCH", `/api/deals/${dealId}/assignments/${id}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/deals/${dealId}/assignments`] });
    },
  });

  const generateDoc = useMutation({
    mutationFn: async ({ ack }: { ack: boolean }) => {
      if (!active) throw new Error("No assignment to generate for.");
      // Find the Assignment Contract system template by type.
      const tplRes = await apiRequest("GET", "/api/document-templates");
      const templates: Array<{ id: number; type: string; name: string }> = await tplRes.json();
      const template = templates.find((t) => t.type === "assignment_of_contract");
      if (!template) throw new Error("Assignment Contract template not found.");
      const res = await apiRequest("POST", "/api/generated-documents", {
        templateId: template.id,
        dealId,
        propertyId: propertyId ?? undefined,
        ackComplianceWarning: ack,
      });
      return res.json() as Promise<{ id: number }>;
    },
    onSuccess: async (doc) => {
      setComplianceIssue(null);
      if (active) {
        await patchAssignment.mutateAsync({ id: active.id, generatedDocumentId: doc.id, status: "doc_generated" });
      }
      queryClient.invalidateQueries({ queryKey: [`/api/generated-documents/${doc.id}`] });
      toast({ title: "Assignment contract generated", description: "Fee and dates were auto-filled from this assignment." });
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.status === 409 && err.body) {
        const body = err.body as unknown as { error: string; message: string; recommendation?: string; citation?: string };
        setComplianceIssue({
          kind: body.error === "wholesaler_compliance_blocked" ? "blocked" : "warn",
          message: body.message,
          recommendation: body.recommendation,
          citation: body.citation ?? undefined,
        });
        return;
      }
      toast({ title: "Couldn't generate the contract", description: err.message, variant: "destructive" });
    },
  });

  const requestSignature = useMutation({
    mutationFn: async () => {
      if (!active?.generatedDocumentId) throw new Error("Generate the contract first.");
      if (!buyerEmail.trim()) throw new Error("Enter the end buyer's email for their signing link.");
      const res = await apiRequest(
        "POST",
        `/api/generated-documents/${active.generatedDocumentId}/request-signature`,
        {
          signers: [
            { name: org?.name ?? "Assignor", email: "", role: "assignor" },
            { name: active.endBuyerName ?? "End buyer", email: buyerEmail.trim(), role: "assignee" },
          ],
        },
        { idempotent: true },
      );
      return res.json() as Promise<{ signingLinks: SigningLink[] }>;
    },
    onSuccess: async (data) => {
      setSigningLinks(data.signingLinks ?? []);
      if (active) await patchAssignment.mutateAsync({ id: active.id, status: "sent_for_signature" });
      queryClient.invalidateQueries({ queryKey: [`/api/generated-documents/${active?.generatedDocumentId}`] });
      toast({ title: "Signing links issued", description: "Copy each link into your own email or text." });
    },
    onError: (err: Error) => {
      const detail =
        err instanceof ApiError && err.body?.details
          ? (err.body.details as { friendlyName?: string }).friendlyName ?? err.message
          : err.message;
      toast({ title: "Couldn't send for signature", description: detail, variant: "destructive" });
    },
  });

  // The generated document's live status — drives "mark signed".
  const { data: doc } = useQuery<{ id: number; status: string }>({
    queryKey: [`/api/generated-documents/${active?.generatedDocumentId}`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/generated-documents/${active?.generatedDocumentId}`);
      return res.json();
    },
    enabled: !!active?.generatedDocumentId,
  });

  // Persona gate LAST (after hooks): wholesalers see the panel always;
  // other personas only when assignment data already exists on the deal.
  if (!isWholesaler && !hasRecords) return null;

  return (
    <Card data-testid="assignment-panel">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ArrowRightLeft className="h-4 w-4 text-primary" aria-hidden="true" />
          Assignment of contract
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        ) : !active ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              createAssignment.mutate();
            }}
          >
            <p className="text-sm text-muted-foreground">
              Record who you're assigning this contract to and your fee — the assignment
              contract and your dashboard revenue both read from this record.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="assignment-buyer">End buyer</Label>
                <Input
                  id="assignment-buyer"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder="Buyer name"
                  data-testid="input-assignment-buyer"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="assignment-fee">Assignment fee ($)</Label>
                <Input
                  id="assignment-fee"
                  inputMode="decimal"
                  value={feeDollars}
                  onChange={(e) => setFeeDollars(e.target.value)}
                  placeholder="7,500"
                  data-testid="input-assignment-fee"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="assignment-contract-date">Original contract date</Label>
                <Input
                  id="assignment-contract-date"
                  type="date"
                  value={contractDate}
                  onChange={(e) => setContractDate(e.target.value)}
                  data-testid="input-assignment-date"
                />
              </div>
            </div>
            <Button type="submit" disabled={createAssignment.isPending} data-testid="button-create-assignment">
              {createAssignment.isPending ? "Recording…" : "Record assignment"}
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANT[active.status]}>{STATUS_LABEL[active.status]}</Badge>
              <span className="text-sm font-medium">{centsToDollars(active.assignmentFeeCents)} fee</span>
              {active.endBuyerName && (
                <span className="text-sm text-muted-foreground">→ {active.endBuyerName}</span>
              )}
            </div>

            {stateRule && (stateRule.licenseRequired || stateRule.advertisingRestricted || stateRule.recommendation !== "unrestricted") && (
              <div role="status" className="flex items-start gap-2 rounded-md border border-acr-warn/50 bg-acr-warn/10 p-3">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-acr-warn" aria-hidden="true" />
                <div className="text-sm">
                  <p className="font-medium">{stateRule.state} assignment rules apply</p>
                  {stateRule.summary && <p className="text-muted-foreground">{stateRule.summary}</p>}
                  {stateRule.citation && <p className="text-xs text-muted-foreground">{stateRule.citation}</p>}
                </div>
              </div>
            )}

            {complianceIssue && (
              <div
                role="alert"
                className={`flex items-start gap-2 rounded-md border p-3 ${
                  complianceIssue.kind === "blocked"
                    ? "border-destructive/50 bg-destructive/10"
                    : "border-acr-warn/50 bg-acr-warn/10"
                }`}
                data-testid="assignment-compliance-issue"
              >
                <AlertTriangle
                  className={`mt-0.5 h-4 w-4 shrink-0 ${complianceIssue.kind === "blocked" ? "text-destructive" : "text-acr-warn"}`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">
                    {complianceIssue.kind === "blocked"
                      ? "Assignment contracts are blocked in this state"
                      : "This state restricts assignments"}
                  </p>
                  <p className="text-muted-foreground">{complianceIssue.message}</p>
                  {complianceIssue.citation && (
                    <p className="text-xs text-muted-foreground">{complianceIssue.citation}</p>
                  )}
                  {complianceIssue.kind === "warn" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      disabled={generateDoc.isPending}
                      onClick={() => generateDoc.mutate({ ack: true })}
                      data-testid="button-ack-compliance"
                    >
                      I understand — generate anyway
                    </Button>
                  )}
                </div>
              </div>
            )}

            {active.status === "draft" && (
              <Button
                onClick={() => generateDoc.mutate({ ack: false })}
                disabled={generateDoc.isPending}
                data-testid="button-generate-assignment-doc"
              >
                <FileText className="mr-2 h-4 w-4" aria-hidden="true" />
                {generateDoc.isPending ? "Generating…" : "Generate assignment contract"}
              </Button>
            )}

            {active.status === "doc_generated" && (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  requestSignature.mutate();
                }}
              >
                <div className="space-y-1">
                  <Label htmlFor="assignment-buyer-email">End buyer's email (for their signing link)</Label>
                  <Input
                    id="assignment-buyer-email"
                    type="email"
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                    placeholder="buyer@example.com"
                    data-testid="input-assignment-buyer-email"
                  />
                </div>
                <Button type="submit" disabled={requestSignature.isPending} data-testid="button-send-assignment-signature">
                  <FileSignature className="mr-2 h-4 w-4" aria-hidden="true" />
                  {requestSignature.isPending ? "Issuing links…" : "Send for signature"}
                </Button>
              </form>
            )}

            {signingLinks.length > 0 && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <p className="text-sm font-medium">Signing links — copy into your own email or text:</p>
                {signingLinks.map((link) => (
                  <div key={link.signerId} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {link.name} ({link.role})
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Copy signing link for ${link.name}`}
                      onClick={() => {
                        navigator.clipboard.writeText(link.url);
                        toast({ title: "Link copied", description: `${link.name}'s signing link is on your clipboard.` });
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {active.status === "sent_for_signature" && doc?.status === "signed" && (
              <Button
                onClick={() => patchAssignment.mutate({ id: active.id, status: "signed" })}
                disabled={patchAssignment.isPending}
                data-testid="button-mark-assignment-signed"
              >
                Mark assignment signed
              </Button>
            )}

            {active.status === "signed" && (
              <p className="text-sm text-muted-foreground">
                Fully executed. This fee now counts as real assignment revenue on your dashboard.
              </p>
            )}

            {(active.status === "draft" || active.status === "doc_generated") && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={patchAssignment.isPending}
                onClick={() => {
                  if (window.confirm("Cancel this assignment? The record stays for your books but stops counting.")) {
                    patchAssignment.mutate({ id: active.id, status: "cancelled" });
                  }
                }}
                data-testid="button-cancel-assignment"
              >
                Cancel assignment
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
