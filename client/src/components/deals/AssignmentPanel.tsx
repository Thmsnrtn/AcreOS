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
 *   → REVIEW the assembled assignment document (compliance gate handled:
 *     blocked renders the citation, warn asks for an ack)
 *   → create the draft, gated on an explicit confirmation of that exact text
 *   → send for signature (per-signer links to copy into your own email)
 *   → mark signed when the document completes.
 *
 * WAVE D2 UPDATE — the document now comes from the contract chain
 * (GET /api/deals/:id/contract-preview → POST /api/deals/:id/contract,
 * server/routes-contract-chain.ts) rather than from a blind template
 * generation. That buys three things the old path did not have: the operator
 * SEES the merged body before it exists, the draft carries the sha256 of what
 * they reviewed (re-verified by the signing rail at dispatch), and a state
 * with no reviewed template REFUSES by name instead of emitting a generic
 * document. Legal signing remains a founder-only hard-stop: nothing here
 * sends without a separate, explicit click.
 *
 * Rendered inside the Docs tab of a deal (a section behind an existing
 * door, per the five-door rule). Visible for wholesaler orgs — and for
 * ANY org that already has assignment records on the deal (data is
 * never hidden by a persona toggle).
 */
import { useState } from "react";
import DOMPurify from "isomorphic-dompurify";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRightLeft, Copy, FileSignature, FileText, Info, ScrollText, ShieldAlert } from "lucide-react";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Verbs } from "@/lib/labels";

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

/** The assembled document returned by the contract chain's review endpoint. */
interface ContractPreview {
  kind: string;
  title: string;
  name: string;
  state: string;
  stateName: string;
  content: string;
  contentHash: string;
  stateRequirements: {
    deedType: string;
    notaryRequired: boolean;
    witnessCount: number;
    recordingOffice: string;
    transferTaxNotes: string;
    attorneyStateForClosing: boolean;
  };
  signerRoles: Array<{ role: string; name: string; email: string | null }>;
  advisories: string[];
  disclaimer: string;
  assignmentId: number | null;
  sent: boolean;
  hardStop: string;
}

/** A named refusal from the chain (state not configured, fields missing, …). */
interface ChainRefusal {
  code?: string;
  message?: string;
  state?: string;
  stateName?: string | null;
  dealStatus?: string;
  missing?: Array<{ field: string; label: string; fixAt: string }>;
  recommendation?: string;
  citation?: string | null;
}

function chainRefusalOf(error: unknown): ChainRefusal | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  const details = error.body?.details;
  if (!details || typeof details !== "object") return null;
  return details as ChainRefusal;
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
  // Review-then-create: the dialog is the only path to a document, and the
  // hash gate means "created" can only ever mean "a human read THIS text".
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmedHash, setConfirmedHash] = useState<string | null>(null);

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

  // ── STEP 1: review. Assembles and returns the exact body; writes nothing.
  const previewQuery = useQuery<ContractPreview>({
    queryKey: [
      "/api/deals",
      dealId,
      "contract-preview",
      "assignment_of_contract",
      active?.id ?? null,
    ],
    queryFn: async () => {
      const qs = active?.id ? `&assignmentId=${active.id}` : "";
      const res = await apiRequest(
        "GET",
        `/api/deals/${dealId}/contract-preview?kind=assignment_of_contract${qs}`,
      );
      return res.json() as Promise<ContractPreview>;
    },
    enabled: reviewOpen,
    retry: false,
  });

  // ── STEP 2: create the draft. Requires the operator's confirmation AND the
  //    sha256 of the text they were shown. Persists a draft; sends nothing.
  const createDoc = useMutation({
    mutationFn: async ({ ack, reviewedContentHash }: { ack: boolean; reviewedContentHash: string }) => {
      const res = await apiRequest("POST", `/api/deals/${dealId}/contract`, {
        kind: "assignment_of_contract",
        ...(active?.id ? { assignmentId: active.id } : {}),
        confirmReviewed: true,
        reviewedContentHash,
        ackComplianceWarning: ack,
      });
      return res.json() as Promise<{
        document: { id: number; name: string };
        sent: boolean;
        nextStep: { note: string };
      }>;
    },
    onSuccess: (data) => {
      // The chain sets generatedDocumentId + status "doc_generated" on the
      // assignment row server-side, so re-read the row rather than patching.
      queryClient.invalidateQueries({ queryKey: [`/api/deals/${dealId}/assignments`] });
      queryClient.invalidateQueries({ queryKey: [`/api/generated-documents/${data.document.id}`] });
      setComplianceIssue(null);
      setReviewOpen(false);
      setConfirmedHash(null);
      toast({ title: "Assignment draft created", description: data.nextStep.note });
    },
    onError: (err: Error) => {
      const refusal = chainRefusalOf(err);
      if (refusal?.code === "WHOLESALER_COMPLIANCE_BLOCKED" || refusal?.code === "WHOLESALER_COMPLIANCE_WARN") {
        setComplianceIssue({
          kind: refusal.code === "WHOLESALER_COMPLIANCE_BLOCKED" ? "blocked" : "warn",
          message: refusal.message ?? "This state restricts contract assignments.",
          recommendation: refusal.recommendation,
          citation: refusal.citation ?? undefined,
        });
        return;
      }
      if (refusal) return; // rendered in the review dialog, named
      toast({
        title: "Couldn't create the assignment document",
        description: `${err.message} — nothing was created and nothing was sent.`,
        variant: "destructive",
      });
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

  /** A named refusal from the review step, or null when the draft assembled. */
  const previewRefusal = chainRefusalOf(previewQuery.error);

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

            {active.status === "draft" && (
              <div className="space-y-1">
                <Button
                  onClick={() => {
                    setConfirmedHash(null);
                    setReviewOpen(true);
                  }}
                  data-testid="button-generate-assignment-doc"
                >
                  <ScrollText className="mr-2 h-4 w-4" aria-hidden="true" />
                  Review assignment document
                </Button>
                <p className="text-xs text-muted-foreground">
                  You read the document first. Creating it is a second click, and
                  sending it for signature is a third — nothing here is automatic.
                </p>
              </div>
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

        {/* The review step. Reading it writes nothing; the confirm below is the
            only path to a document, and no path here sends anything. */}
        <Dialog
          open={reviewOpen}
          onOpenChange={(open) => {
            setReviewOpen(open);
            if (!open) setConfirmedHash(null);
          }}
        >
          <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Review before anything is created</DialogTitle>
              <DialogDescription>
                Assignment of contract for deal #{dealId}
              </DialogDescription>
            </DialogHeader>

            {previewQuery.isPending ? (
              <div className="space-y-3" aria-busy="true">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-5 w-1/2" />
              </div>
            ) : previewRefusal ? (
              <div
                role="alert"
                className="space-y-2 rounded-md border border-acr-warn/50 bg-acr-warn/10 p-3"
                data-testid="assignment-chain-refusal"
              >
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-acr-warn" aria-hidden="true" />
                  <div className="min-w-0 space-y-1 text-sm">
                    <p className="font-medium">
                      {previewRefusal.code === "STATE_NOT_CONFIGURED"
                        ? `No reviewed assignment template for ${
                            previewRefusal.stateName || previewRefusal.state || "this state"
                          }`
                        : "AcreOS will not generate this document"}
                    </p>
                    <p className="text-muted-foreground">
                      {previewRefusal.message ??
                        "This deal is not contract-ready. Fix the named gap and review it again."}
                    </p>
                    {previewRefusal.missing && previewRefusal.missing.length > 0 && (
                      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                        {previewRefusal.missing.map((m) => (
                          <li key={m.field}>
                            <span className="font-medium text-foreground">{m.label}</span> — {m.fixAt}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            ) : previewQuery.isError ? (
              <p className="text-sm text-muted-foreground" role="alert">
                {(previewQuery.error as Error).message} — nothing was created.
              </p>
            ) : previewQuery.data ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {previewQuery.data.stateName} ({previewQuery.data.state}) template
                  </Badge>
                  <Badge variant="secondary">Nothing sent yet</Badge>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Exactly what will go out</h4>
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none rounded-md border border-border p-4"
                    data-testid="assignment-preview-content"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(previewQuery.data.content),
                    }}
                  />
                  <p className="font-mono text-xs text-muted-foreground">
                    sha256 {previewQuery.data.contentHash.slice(0, 16)}… — the draft is
                    created from this exact text, and the signing rail re-checks
                    it at dispatch.
                  </p>
                </div>

                <div className="space-y-1">
                  <h4 className="text-sm font-medium">Who signs</h4>
                  <ul className="m-0 list-none space-y-1 p-0 text-sm text-muted-foreground">
                    {previewQuery.data.signerRoles.map((s) => (
                      <li key={`${s.role}-${s.name}`}>
                        <span className="capitalize text-foreground">{s.role}</span>: {s.name}
                        {s.email ? ` · ${s.email}` : " · no email on file yet"}
                      </li>
                    ))}
                  </ul>
                </div>

                {previewQuery.data.advisories.length > 0 && (
                  <div className="space-y-1">
                    <h4 className="text-sm font-medium">Resolve before execution</h4>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      {previewQuery.data.advisories.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">{previewQuery.data.disclaimer}</p>

                <div className="flex items-start gap-2 rounded-md border border-border p-3">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <p className="text-xs text-muted-foreground">
                    Legal signing is a founder-only hard-stop
                    {previewQuery.data.hardStop ? ` (${previewQuery.data.hardStop})` : ""}.
                    Creating the draft sends nothing; the assignment fee is paid
                    between you and the end buyer at closing — AcreOS never
                    handles it.
                  </p>
                </div>

                {/* State legality (wholesaler_state_rules). Blocked refuses
                    outright; a warning needs an explicit acknowledgement ON TOP
                    of the review confirmation — it never replaces it. */}
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
                      {complianceIssue.recommendation && (
                        <p className="text-muted-foreground">{complianceIssue.recommendation}</p>
                      )}
                      {complianceIssue.citation && (
                        <p className="text-xs text-muted-foreground">{complianceIssue.citation}</p>
                      )}
                      {complianceIssue.kind === "warn" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          disabled={
                            createDoc.isPending ||
                            confirmedHash !== previewQuery.data.contentHash
                          }
                          onClick={() => {
                            if (confirmedHash !== previewQuery.data.contentHash) return;
                            createDoc.mutate({ ack: true, reviewedContentHash: confirmedHash });
                          }}
                          data-testid="button-ack-compliance"
                        >
                          I understand — create the draft anyway
                        </Button>
                      )}
                      {complianceIssue.kind === "warn" &&
                        confirmedHash !== previewQuery.data.contentHash && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Confirm the document below first — acknowledging a
                            state warning does not skip the review.
                          </p>
                        )}
                    </div>
                  </div>
                )}

                <div className="space-y-3 border-t border-border pt-4">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="assignment-confirm-review"
                      checked={confirmedHash === previewQuery.data.contentHash}
                      onCheckedChange={(checked) =>
                        setConfirmedHash(checked ? previewQuery.data.contentHash : null)
                      }
                      data-testid="checkbox-assignment-confirm-review"
                    />
                    <Label htmlFor="assignment-confirm-review" className="text-sm font-normal">
                      I have read the document above and confirm this is what
                      should go out.
                    </Label>
                  </div>
                  <Button
                    disabled={
                      confirmedHash !== previewQuery.data.contentHash || createDoc.isPending
                    }
                    onClick={() =>
                      createDoc.mutate({
                        ack: false,
                        reviewedContentHash: previewQuery.data.contentHash,
                      })
                    }
                    data-testid="button-create-assignment-doc"
                  >
                    <FileText className="mr-2 h-4 w-4" aria-hidden="true" />
                    {createDoc.isPending ? "Creating…" : "Create the draft (sends nothing)"}
                  </Button>
                </div>
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setReviewOpen(false);
                  setConfirmedHash(null);
                }}
              >
                {Verbs.CANCEL}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
