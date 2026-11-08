/**
 * The purchase-agreement review → draft → send dialog for ONE deal.
 *
 * Extracted verbatim from the Wave D2 Contracts tab (client/src/pages/offers.tsx,
 * `ContractChainSection`) so the deal itself can open the same chain from its
 * Documents tab. One component, two entry points: whatever the operator sees
 * and confirms is the same no matter which door they came through.
 *
 * Three separate human acts, never one:
 *
 *   1. REVIEW — GET /api/deals/:id/contract-preview assembles and returns the
 *               exact body, writing nothing. Refusals land here, named, with
 *               the fields to fix and where.
 *   2. CREATE — POST /api/deals/:id/contract, gated on an explicit
 *               confirmation plus the sha256 of the content the operator was
 *               actually shown. Persists a DRAFT. Sends nothing.
 *   3. SEND   — the pre-existing native rail
 *               POST /api/generated-documents/:id/request-signature, a separate
 *               click that mints per-signer links for the operator to deliver
 *               themselves. The counterparty signs on /sign with their own
 *               consent; nothing here records a signature for anyone.
 *
 * Legal signing is a permanent founder-only hard-stop, so nothing here fires on
 * mount, on a query, or as a side effect of another action.
 */
import { useState } from "react";
import DOMPurify from "isomorphic-dompurify";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { QueryErrorState } from "@/components/query-error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy, FileSignature, FileText, Info, Loader2, ShieldAlert } from "lucide-react";
import { Verbs } from "@/lib/labels";

interface ContractSignerRole {
  role: string;
  name: string;
  email: string | null;
}

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
    practiceNotes: string;
  };
  signerRoles: ContractSignerRole[];
  advisories: string[];
  disclaimer: string;
  sent: boolean;
  hardStop: string;
}

/** The server's named refusals (ContractRefusal), as they arrive in `details`. */
interface ContractRefusal {
  code?: string;
  message?: string;
  state?: string;
  stateName?: string | null;
  dealStatus?: string;
  missing?: Array<{ field: string; label: string; fixAt: string }>;
  details?: { statute?: string; friendlyName?: string };
  recommendation?: string;
  citation?: string | null;
}

/** Pull the named refusal out of a 422, or null when this isn't one. */
function contractRefusalOf(error: unknown): ContractRefusal | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  const details = error.body?.details;
  if (!details || typeof details !== "object") return null;
  return details as ContractRefusal;
}

const REFUSAL_TITLE: Record<string, string> = {
  STATE_NOT_CONFIGURED: "No reviewed template for this state",
  OFFER_NOT_ACCEPTED: "This offer isn't accepted yet",
  DEAL_TYPE_NOT_SUPPORTED: "Not for a deal where you are selling",
  MISSING_REQUIRED_FIELDS: "AcreOS won't guess contract terms",
  DISCLOSURE_MISSING: "A statutory disclosure is required here",
  OPERATOR_REVIEW_REQUIRED: "A person has to review this first",
  REVIEW_STALE: "This contract changed since you reviewed it",
};

/**
 * Render a refusal in the server's own words. The state is NAMED — we never
 * fall back to offering a generic document in its place.
 */
function ContractRefusalNotice({ refusal }: { refusal: ContractRefusal }) {
  const title =
    (refusal.code && REFUSAL_TITLE[refusal.code]) ||
    "AcreOS will not generate this document";
  const stateLabel = refusal.stateName || refusal.state || null;

  return (
    <div
      role="alert"
      className="space-y-2 rounded-card border border-acr-warn/50 bg-acr-warn-soft p-3"
      data-testid="contract-refusal"
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-acr-warn" aria-hidden="true" />
        <div className="min-w-0 space-y-1 text-sm">
          <p className="font-medium">
            {title}
            {refusal.code === "STATE_NOT_CONFIGURED" && stateLabel ? ` — ${stateLabel}` : ""}
          </p>
          <p className="text-muted-foreground" data-testid="contract-refusal-message">
            {refusal.message ??
              "The deal is not contract-ready. Fix the named gap and assemble it again."}
          </p>
          {refusal.missing && refusal.missing.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {refusal.missing.map((m) => (
                <li key={m.field}>
                  <span className="font-medium text-foreground">{m.label}</span> — {m.fixAt}
                </li>
              ))}
            </ul>
          ) : null}
          {refusal.recommendation ? (
            <p className="text-muted-foreground">{refusal.recommendation}</p>
          ) : null}
          {refusal.citation ? (
            <p className="text-xs text-muted-foreground">{refusal.citation}</p>
          ) : null}
          {refusal.details?.statute ? (
            <p className="text-xs text-muted-foreground">
              {refusal.details.friendlyName} ({refusal.details.statute})
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface SigningLink {
  signerId: string;
  name: string;
  email: string;
  role: string;
  url: string;
}

/**
 * Open for `dealId`; closed when it is null. `onClose` is called after the
 * dialog has forgotten everything it held for that deal.
 */
export function ContractReviewDialog({
  dealId,
  dealLabel,
  onClose,
}: {
  dealId: number | null;
  dealLabel: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [confirmedHash, setConfirmedHash] = useState<string | null>(null);
  const [createdDocument, setCreatedDocument] = useState<{ id: number; name: string } | null>(null);
  const [signerEmails, setSignerEmails] = useState<Record<string, string>>({});
  const [signingLinks, setSigningLinks] = useState<SigningLink[]>([]);

  // STEP 1 — review. A read: assembles and returns, persists nothing.
  const previewQuery = useQuery<ContractPreview>({
    queryKey: ["/api/deals", dealId, "contract-preview", "purchase_agreement"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/deals/${dealId}/contract-preview?kind=purchase_agreement`,
      );
      return res.json() as Promise<ContractPreview>;
    },
    enabled: dealId !== null,
    retry: false,
  });

  // STEP 2 — create the draft. Requires the operator's confirmation AND the
  // hash of the content they were shown; a stale hash refuses server-side.
  const createContract = useMutation({
    mutationFn: async (input: { dealId: number; reviewedContentHash: string }) => {
      const res = await apiRequest("POST", `/api/deals/${input.dealId}/contract`, {
        kind: "purchase_agreement",
        confirmReviewed: true,
        reviewedContentHash: input.reviewedContentHash,
      });
      return res.json() as Promise<{
        document: { id: number; name: string };
        sent: boolean;
        signerRoles: ContractSignerRole[];
        nextStep: { note: string };
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/generated-documents"] });
      setCreatedDocument(data.document);
      toast({
        title: "Draft contract created.",
        description: data.nextStep.note,
      });
    },
    onError: (error: Error) => {
      if (contractRefusalOf(error)) return; // rendered in place, named
      toast({
        title: "Couldn't assemble the contract",
        description: `${error.message} — nothing was created and nothing was sent.`,
        variant: "destructive",
      });
    },
  });

  // STEP 3 — the pre-existing signing rail. Separate, explicit, operator-only.
  const requestSignature = useMutation({
    mutationFn: async (input: { documentId: number; signers: ContractSignerRole[] }) => {
      const res = await apiRequest(
        "POST",
        `/api/generated-documents/${input.documentId}/request-signature`,
        {
          // Keyed by POSITION, not by role: a two-witness state (Florida) has
          // two signers sharing the role "witness", and keying by role would
          // silently send one person's address to both.
          signers: input.signers.map((s, i) => ({
            name: s.name,
            email: signerEmails[String(i)] ?? s.email ?? "",
            role: s.role,
          })),
        },
        { idempotent: true },
      );
      return res.json() as Promise<{ signingLinks: SigningLink[] }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/generated-documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      setSigningLinks(data.signingLinks ?? []);
      toast({
        title: "Signing links issued.",
        description: "AcreOS emailed no one — copy each link into your own email or text.",
      });
    },
    onError: (error: Error) => {
      if (contractRefusalOf(error)) return;
      toast({
        title: "Couldn't send for signature",
        description: `${error.message} — the draft is untouched and no one was contacted.`,
        variant: "destructive",
      });
    },
  });

  // Closing forgets this deal entirely — including a refusal from a previous
  // attempt, which must never surface on the next deal opened.
  const close = () => {
    setConfirmedHash(null);
    setCreatedDocument(null);
    setSignerEmails({});
    setSigningLinks([]);
    createContract.reset();
    requestSignature.reset();
    onClose();
  };

  const preview = previewQuery.data;
  const previewRefusal = contractRefusalOf(previewQuery.error);
  const createRefusal = contractRefusalOf(createContract.error);
  const sendRefusal = contractRefusalOf(requestSignature.error);

  return (
    <Dialog
      open={dealId !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {createdDocument
              ? "Draft created — sending is a separate step"
              : "Review before anything is created"}
          </DialogTitle>
          <DialogDescription>{dealLabel}</DialogDescription>
        </DialogHeader>

        {previewQuery.isPending && dealId !== null ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : previewRefusal ? (
          <ContractRefusalNotice refusal={previewRefusal} />
        ) : previewQuery.isError ? (
          <QueryErrorState
            error={previewQuery.error as Error}
            onRetry={() => previewQuery.refetch()}
            testId="contract-preview-error"
          />
        ) : preview ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {preview.stateName} ({preview.state}) template
              </Badge>
              <Badge variant="secondary">Nothing sent yet</Badge>
            </div>

            <section className="space-y-2">
              <h4 className="text-sm font-medium">
                Exactly what will go out
              </h4>
              <div
                className="prose prose-sm dark:prose-invert max-w-none rounded-card border border-border p-4"
                data-testid="contract-preview-content"
                // Server-assembled body; escaped at assembly and sanitized
                // again here (repo pattern — see documents.tsx preview).
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(preview.content) }}
              />
              <p className="font-mono text-xs text-muted-foreground" data-testid="contract-hash">
                sha256 {preview.contentHash.slice(0, 16)}… — the draft is created
                from this exact text, and the signing rail re-checks it at
                dispatch.
              </p>
            </section>

            <section className="space-y-1">
              <h4 className="text-sm font-medium">How {preview.stateName} executes this</h4>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>Conveyance by {preview.stateRequirements.deedType}.</li>
                <li>
                  {preview.stateRequirements.notaryRequired
                    ? "Notarization required."
                    : "No notarization required."}{" "}
                  {preview.stateRequirements.witnessCount > 0
                    ? `${preview.stateRequirements.witnessCount} witness${
                        preview.stateRequirements.witnessCount === 1 ? "" : "es"
                      } required.`
                    : "No witnesses required."}
                </li>
                <li>Recorded with the {preview.stateRequirements.recordingOffice}.</li>
                <li>{preview.stateRequirements.transferTaxNotes}</li>
                {preview.stateRequirements.attorneyStateForClosing ? (
                  <li>An attorney must conduct the closing in {preview.stateName}.</li>
                ) : null}
              </ul>
            </section>

            <section className="space-y-1">
              <h4 className="text-sm font-medium">Who signs</h4>
              <ul className="m-0 list-none space-y-1 p-0 text-sm">
                {preview.signerRoles.map((s) => (
                  <li key={`${s.role}-${s.name}`} className="text-muted-foreground">
                    <span className="capitalize text-foreground">{s.role}</span>: {s.name}
                    {s.email ? ` · ${s.email}` : " · no email on file yet"}
                  </li>
                ))}
              </ul>
            </section>

            {preview.advisories.length > 0 ? (
              <section className="space-y-2">
                <h4 className="text-sm font-medium">Resolve before execution</h4>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {preview.advisories.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <p className="text-xs text-muted-foreground">{preview.disclaimer}</p>

            <div className="flex items-start gap-2 rounded-card border border-border p-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">
                Legal signing is a founder-only hard-stop
                {preview.hardStop ? ` (${preview.hardStop})` : ""}. AcreOS never
                signs, emails, or dispatches a contract on its own — every step
                below is a click you make.
              </p>
            </div>

            {createRefusal ? <ContractRefusalNotice refusal={createRefusal} /> : null}

            {!createdDocument ? (
              <div className="space-y-3 border-t border-border pt-4">
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="contract-confirm-review"
                    checked={confirmedHash === preview.contentHash}
                    onCheckedChange={(checked) =>
                      setConfirmedHash(checked ? preview.contentHash : null)
                    }
                    data-testid="checkbox-confirm-review"
                  />
                  <Label htmlFor="contract-confirm-review" className="text-sm font-normal">
                    I have read the document above and confirm this is what
                    should go out.
                  </Label>
                </div>
                <Button
                  disabled={
                    confirmedHash !== preview.contentHash ||
                    createContract.isPending ||
                    dealId === null
                  }
                  onClick={() => {
                    if (dealId === null) return;
                    createContract.mutate({
                      dealId,
                      reviewedContentHash: preview.contentHash,
                    });
                  }}
                  data-testid="button-create-contract"
                >
                  {createContract.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <FileText className="mr-2 h-4 w-4" aria-hidden="true" />
                  )}
                  Create the draft (sends nothing)
                </Button>
              </div>
            ) : (
              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-sm">
                  <span className="font-medium">{createdDocument.name}</span> is
                  saved as a draft. It has not been sent.
                </p>

                {sendRefusal ? <ContractRefusalNotice refusal={sendRefusal} /> : null}

                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    requestSignature.mutate({
                      documentId: createdDocument.id,
                      signers: preview.signerRoles,
                    });
                  }}
                >
                  {preview.signerRoles.map((s, i) => (
                    <div key={`email-${i}-${s.role}`} className="space-y-1">
                      <Label htmlFor={`signer-email-${i}`}>
                        <span className="capitalize">{s.role}</span> email — {s.name}
                      </Label>
                      <Input
                        id={`signer-email-${i}`}
                        type="email"
                        value={signerEmails[String(i)] ?? s.email ?? ""}
                        onChange={(e) =>
                          setSignerEmails((prev) => ({ ...prev, [String(i)]: e.target.value }))
                        }
                        placeholder="name@example.com"
                        data-testid={`input-signer-email-${i}`}
                      />
                      {s.role === "witness" ? (
                        <p className="text-xs text-muted-foreground">
                          Witnesses usually sign in person — leave this blank if
                          yours will.
                        </p>
                      ) : null}
                    </div>
                  ))}
                  <Button
                    type="submit"
                    disabled={requestSignature.isPending || signingLinks.length > 0}
                    data-testid="button-send-for-signature"
                  >
                    {requestSignature.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <FileSignature className="mr-2 h-4 w-4" aria-hidden="true" />
                    )}
                    Send for signature
                  </Button>
                </form>

                {signingLinks.length > 0 ? (
                  <div className="space-y-2 rounded-card border border-border p-3">
                    <p className="text-sm font-medium">
                      Signing links — copy each into your own email or text:
                    </p>
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
                            toast({
                              title: "Link copied.",
                              description: `${link.name}'s signing link is on your clipboard.`,
                            });
                          }}
                          data-testid={`button-copy-signing-link-${link.role}`}
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            {Verbs.CANCEL}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
