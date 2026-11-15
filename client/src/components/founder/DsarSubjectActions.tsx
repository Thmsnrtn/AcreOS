/**
 * DsarSubjectActions — founder verify / export / erase controls for ONE
 * `dsar_requests_lifecycle` row (PKG-1 §6, docs/pkg1-dsar-design-2026-11.md).
 *
 * Mounted in the Action cell of the DSAR tab on /founder/compliance-ops.
 * Self-contained: its own subject-candidates query and its own mutations.
 * The host passes `csrf` (its existing helper — not duplicated here) and
 * `onChanged` (it invalidates the /recent queue, like `fulfillDsar` does).
 *
 * Server contract (server/routes-privacy-dsar.ts):
 *   POST /api/founder/dsar/:id/verify-identity   {method, evidenceNote}
 *   GET  /api/founder/dsar/:id/subject-candidates
 *   POST /api/founder/dsar/:id/generate-export   {subject}
 *   POST /api/founder/dsar/:id/execute-erasure   {subject, confirm:"ERASE"}
 * Refusals use the Errors envelope `{error, message, details, statusCode}`;
 * the machine name is `details.reason` (423 also carries `error:
 * "LEGAL_HOLD_ACTIVE"`).
 *
 * Deviations from the design/brief, following the code's facts:
 *  - The DSAR tab has no row-expansion pattern; rows are a plain table. The
 *    panel therefore opens as a Dialog from the Action cell (design §6 puts
 *    the component in that cell). The candidates query only runs while the
 *    dialog is open, so mounting 50 rows fires no fetches.
 *  - subject-candidates returns `{users, leads}` carrying ids and flags only
 *    (no names, emails or org names — listDsarSubjectCandidates deliberately
 *    returns none). Every candidate's email equals the requester email by
 *    construction (exact match), so it is shown once above the list, and
 *    candidates are labelled by id: "Account holder (user …)" / "Lead #N in
 *    org #M".
 *  - "Export instead" (S-1 retention refusal): the server gate only allows an
 *    export on an access/portability record, so on an erasure record the
 *    button is disabled with that reason rather than firing a request the
 *    gate will always refuse.
 *  - No "Verified" column is added to the host table (the build brief limits
 *    the host diff to the mount); the verification state is shown here.
 */

import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Info, Search, ShieldAlert } from "lucide-react";
import { DSAR_IDENTITY_POSTURE } from "@shared/privacy/dsarIdentityPosture";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";

type VerificationMethod = (typeof DSAR_IDENTITY_POSTURE.acceptedMethods)[number];

interface DsarSubjectActionsRecord {
  id: string;
  requestType: string;
  requesterEmail: string;
  requesterIdentityVerified: boolean;
}

interface DsarSubjectActionsProps {
  record: DsarSubjectActionsRecord;
  /** The host's csrf header builder (founder-compliance-ops.tsx `csrf()`). */
  csrf: () => Record<string, string>;
  /** Called after a state-changing action so the host refetches its queue. */
  onChanged: () => void;
}

type SubjectSelector =
  | { kind: "user"; userId: string }
  | { kind: "lead"; organizationId: number; leadId: number };

interface UserCandidate { kind: "user"; userId: string; organizationIds: number[]; erased: boolean }
interface LeadCandidate { kind: "lead"; organizationId: number; leadId: number; isBorrower: boolean; erased: boolean }

interface CandidatesResponse {
  dsarId: string;
  requestType: string;
  verified: boolean;
  posture: string;
  users: UserCandidate[];
  leads: LeadCandidate[];
}

interface Candidate {
  key: string;
  selector: SubjectSelector;
  label: string;
  sublabel: string | null;
  borrower: boolean;
  erased: boolean;
}

interface EraseResponse {
  erased: true;
  report: unknown;
  retained: Array<{ domain: string; reason: string }>;
  operatorFollowUps: string[];
}

type Outcome =
  | { kind: "hold"; caseRef: string; holdId: string | null; organizationId: number | null; scope: string | null }
  | { kind: "alreadyErased"; message: string }
  | { kind: "retention"; noteIds: number[]; selector: SubjectSelector; message: string }
  | { kind: "message"; message: string }
  | { kind: "erased"; retained: Array<{ domain: string; reason: string }>; operatorFollowUps: string[] };

const EXPORT_REQUEST_TYPES: readonly string[] = ["access", "portability"];
const ERASURE_REQUEST_TYPE = "erasure";
const DSAR_UNVERIFIED_REASON = "Verify the requester's identity first.";

/** A non-2xx response, keeping the Errors envelope's named reason. */
class DsarActionError extends Error {
  status: number;
  reason: string | null;
  details: Record<string, unknown>;
  constructor(status: number, body: any) {
    super(typeof body?.message === "string" && body.message ? body.message : `Failed (${status})`);
    this.name = "DsarActionError";
    this.status = status;
    this.details = body && typeof body.details === "object" && body.details ? body.details : {};
    const reason = this.details.reason ?? body?.error;
    this.reason = typeof reason === "string" ? reason : null;
  }
}

async function failure(r: Response): Promise<DsarActionError> {
  // Same parse as VendorMetricForm: a named reason, not just `Failed (status)`.
  const body = await r.json().catch(() => ({}));
  return new DsarActionError(r.status, body);
}

function outcomeFromError(err: unknown, selector: SubjectSelector | null): Outcome {
  if (!(err instanceof DsarActionError)) {
    return { kind: "message", message: err instanceof Error ? err.message : String(err) };
  }
  const d = err.details;
  if (err.status === 423 || err.reason === "LEGAL_HOLD_ACTIVE") {
    return {
      kind: "hold",
      caseRef: typeof d.caseRef === "string" ? d.caseRef : String(d.caseRef ?? "unknown"),
      holdId: d.holdId != null ? String(d.holdId) : null,
      organizationId: typeof d.organizationId === "number" ? d.organizationId : null,
      scope: typeof d.scope === "string" ? d.scope : null,
    };
  }
  if (err.reason === "SUBJECT_ALREADY_ERASED") {
    return { kind: "alreadyErased", message: err.message };
  }
  if (err.reason === "RETENTION_REQUIRED_LOAN_RECORDS" && selector) {
    const noteIds = Array.isArray(d.noteIds) ? d.noteIds.map((n) => Number(n)).filter((n) => Number.isFinite(n)) : [];
    return { kind: "retention", noteIds, selector, message: err.message };
  }
  return { kind: "message", message: err.message };
}

function toCandidates(data: CandidatesResponse): Candidate[] {
  const users: Candidate[] = (data.users ?? []).map((u) => ({
    key: `user:${u.userId}`,
    selector: { kind: "user", userId: u.userId },
    label: `Account holder (user ${u.userId})`,
    sublabel: u.organizationIds.length > 0 ? `Member of ${u.organizationIds.map((o) => `org #${o}`).join(", ")}` : "No organization membership",
    borrower: false,
    erased: u.erased,
  }));
  const leads: Candidate[] = (data.leads ?? []).map((l) => ({
    key: `lead:${l.organizationId}:${l.leadId}`,
    selector: { kind: "lead", organizationId: l.organizationId, leadId: l.leadId },
    label: `Lead #${l.leadId} in org #${l.organizationId}`,
    sublabel: null,
    borrower: l.isBorrower,
    erased: l.erased,
  }));
  return [...users, ...leads];
}

function methodLabel(m: VerificationMethod): string {
  return m.replace(/_/g, " ");
}

export function DsarSubjectActions({ record, csrf, onChanged }: DsarSubjectActionsProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [verifiedHere, setVerifiedHere] = useState(false);
  const [method, setMethod] = useState<VerificationMethod | "">("");
  const [evidence, setEvidence] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  // A 200 from verify-identity is the server's own confirmation, so the
  // panel unlocks immediately; the host refetch then carries the flag.
  const verified = record.requesterIdentityVerified || verifiedHere;
  const exportType = EXPORT_REQUEST_TYPES.includes(record.requestType);
  const erasureType = record.requestType === ERASURE_REQUEST_TYPE;
  const candidatesKey = ["/api/founder/dsar", record.id, "subject-candidates"];

  const candidates = useQuery<CandidatesResponse>({
    queryKey: candidatesKey,
    enabled: open,
    queryFn: async () => {
      const r = await fetch(`/api/founder/dsar/${record.id}/subject-candidates`, { credentials: "include" });
      if (!r.ok) throw await failure(r);
      return r.json();
    },
  });

  const list = candidates.data ? toCandidates(candidates.data) : [];
  const selected = list.find((c) => c.key === selectedKey && !c.erased) ?? null;

  const verifyIdentity = useMutation({
    mutationFn: async (body: { method: VerificationMethod; evidenceNote: string }) => {
      const r = await fetch(`/api/founder/dsar/${record.id}/verify-identity`, {
        method: "POST",
        credentials: "include",
        headers: csrf(),
        body: JSON.stringify(body),
      });
      if (!r.ok) throw await failure(r);
      return r.json() as Promise<{ verified: true; alreadyVerified: boolean }>;
    },
    onSuccess: (data) => {
      setVerifyError(null);
      setVerifiedHere(true);
      setEvidence("");
      toast({
        title: data.alreadyVerified
          ? "Already verified — attestation recorded again in audit_events"
          : "Identity check recorded — audit_events updated",
      });
      qc.invalidateQueries({ queryKey: candidatesKey });
      onChanged();
    },
    onError: (err: Error) => setVerifyError(err.message),
  });

  // allow-no-invalidation: an export writes no queue state (fulfilledAt is set only by /fulfill)
  const generateExport = useMutation({
    mutationFn: async (subject: SubjectSelector) => {
      const res = await fetch(`/api/founder/dsar/${record.id}/generate-export`, {
        method: "POST",
        credentials: "include",
        headers: csrf(),
        body: JSON.stringify({ subject }),
      });
      if (!res.ok) throw await failure(res);
      // The export-button.tsx download sequence, with a POST body.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dsar-export-${record.id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    onMutate: () => setOutcome(null),
    onSuccess: () => toast({ title: "Export downloaded — forward it to the requester by hand" }),
    onError: (err, subject) => setOutcome(outcomeFromError(err, subject)),
  });

  const executeErasure = useMutation({
    mutationFn: async (subject: SubjectSelector) => {
      const r = await fetch(`/api/founder/dsar/${record.id}/execute-erasure`, {
        method: "POST",
        credentials: "include",
        headers: csrf(),
        body: JSON.stringify({ subject, confirm: "ERASE" }),
      });
      if (!r.ok) throw await failure(r);
      return r.json() as Promise<EraseResponse>;
    },
    onMutate: () => setOutcome(null),
    onSuccess: (data) => {
      toast({ title: "Subject erased — audit_events updated" });
      setOutcome({
        kind: "erased",
        retained: Array.isArray(data.retained) ? data.retained : [],
        operatorFollowUps: Array.isArray(data.operatorFollowUps) ? data.operatorFollowUps : [],
      });
      qc.invalidateQueries({ queryKey: candidatesKey });
      onChanged();
    },
    onError: (err, subject) => setOutcome(outcomeFromError(err, subject)),
    onSettled: () => {
      setConfirmOpen(false);
      setConfirmText("");
    },
  });

  const busy = generateExport.isPending || executeErasure.isPending;

  const exportBlockedReason = !verified
    ? DSAR_UNVERIFIED_REASON
    : !exportType
      ? `An export runs on an access or portability request — this is a "${record.requestType}" request.`
      : !selected
        ? "Pick a subject first."
        : null;
  const eraseBlockedReason = !verified
    ? DSAR_UNVERIFIED_REASON
    : !erasureType
      ? `Erasure runs on an erasure request — this is a "${record.requestType}" request.`
      : !selected
        ? "Pick a subject first."
        : null;

  const evidenceTrimmed = evidence.trim();
  const evidenceShort = evidenceTrimmed.length < DSAR_IDENTITY_POSTURE.minEvidenceNoteChars;
  const ids = {
    method: `${uid}-method`,
    evidence: `${uid}-evidence`,
    evidenceHint: `${uid}-evidence-hint`,
    exportReason: `${uid}-export-reason`,
    eraseReason: `${uid}-erase-reason`,
    confirm: `${uid}-confirm`,
    statement: `${uid}-statement`,
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        aria-label={`Open subject actions for DSAR ${record.id}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        data-testid={`button-dsar-subject-actions-${record.id}`}
      >
        Subject actions
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl" data-testid="dsar-subject-actions">
          <DialogHeader>
            <DialogTitle>Subject actions — {record.requestType} request</DialogTitle>
            <DialogDescription>
              Requester email: <span className="font-mono">{record.requesterEmail}</span>
            </DialogDescription>
            <div>
              {verified ? (
                <Badge variant="default" className="text-xs">Identity verified</Badge>
              ) : (
                <Badge variant="outline" className="text-xs">Identity not verified</Badge>
              )}
            </div>
          </DialogHeader>

          {/* Posture — rendered verbatim from the one named place. */}
          <div
            id={ids.statement}
            className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
            data-testid="dsar-posture-statement"
          >
            {DSAR_IDENTITY_POSTURE.statement}
          </div>

          {/* ── Verify identity (only while unverified) ── */}
          {!verified && (
            <section className="space-y-3" aria-labelledby={`${uid}-verify-heading`} data-testid="dsar-verify-section">
              <h3 id={`${uid}-verify-heading`} className="text-sm font-medium">Record the identity check</h3>
              <div className="space-y-1">
                <Label htmlFor={ids.method}>Verification method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as VerificationMethod)}>
                  <SelectTrigger id={ids.method} className="w-full" data-testid="select-dsar-verify-method">
                    <SelectValue placeholder="Choose how identity was checked" />
                  </SelectTrigger>
                  <SelectContent>
                    {DSAR_IDENTITY_POSTURE.acceptedMethods.map((m) => (
                      <SelectItem key={m} value={m}>{methodLabel(m)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={ids.evidence}>Evidence note</Label>
                <Textarea
                  id={ids.evidence}
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  aria-describedby={ids.evidenceHint}
                  maxLength={2000}
                  rows={3}
                  data-testid="textarea-dsar-evidence"
                />
                <p id={ids.evidenceHint} className="text-xs text-muted-foreground">
                  At least {DSAR_IDENTITY_POSTURE.minEvidenceNoteChars} characters — what you checked and how
                  ({evidenceTrimmed.length}/{DSAR_IDENTITY_POSTURE.minEvidenceNoteChars}).
                </p>
              </div>
              {verifyError && (
                <Alert variant="destructive" data-testid="dsar-verify-error">
                  <AlertDescription>{verifyError}</AlertDescription>
                </Alert>
              )}
              <Button
                size="sm"
                onClick={() => {
                  if (!method || evidenceShort) return;
                  verifyIdentity.mutate({ method, evidenceNote: evidenceTrimmed });
                }}
                disabled={!method || evidenceShort || verifyIdentity.isPending}
                data-testid="button-dsar-verify"
              >
                {verifyIdentity.isPending ? "Recording…" : "Record identity check"}
              </Button>
            </section>
          )}

          {/* ── Subject picker ── */}
          <section className="space-y-2" aria-labelledby={`${uid}-subject-heading`}>
            <h3 id={`${uid}-subject-heading`} className="text-sm font-medium">Subject</h3>
            <p className="text-xs text-muted-foreground">
              Accounts and leads whose email on file is exactly the requester email. The same email in another
              organization is a separate subject.
            </p>
            {candidates.isLoading ? (
              <div className="space-y-2" data-testid="dsar-candidates-loading">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : candidates.isError ? (
              <QueryErrorState
                compact
                error={candidates.error as Error}
                onRetry={() => candidates.refetch()}
                isRetrying={candidates.isFetching}
                title="Couldn't load subject candidates"
              />
            ) : list.length === 0 ? (
              <EmptyState
                icon={Search}
                headline="No account or lead matches this requester's email"
                subtitle="Nothing can be exported or erased for this request until a subject matches exactly."
                cta={{ label: "Check again", onClick: () => candidates.refetch() }}
                testId="dsar-candidates-empty"
              />
            ) : (
              <RadioGroup
                value={selectedKey}
                onValueChange={(v) => { setSelectedKey(v); setOutcome(null); }}
                aria-label="DSAR subject"
                data-testid="dsar-candidates"
              >
                {list.map((c) => {
                  const itemId = `${uid}-cand-${c.key}`;
                  return (
                    <div key={c.key} className="flex items-start gap-2 rounded-md border border-border p-2">
                      <RadioGroupItem
                        id={itemId}
                        value={c.key}
                        disabled={c.erased}
                        className="mt-0.5"
                        data-testid={`radio-dsar-candidate-${c.key}`}
                      />
                      <Label htmlFor={itemId} className="flex-1 cursor-pointer space-y-0.5 font-normal">
                        <span className="flex flex-wrap items-center gap-1 text-sm">
                          {c.label}
                          {c.borrower && <Badge variant="outline" className="text-xs">borrower</Badge>}
                          {c.erased && <Badge variant="secondary" className="text-xs">already erased</Badge>}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {record.requesterEmail}
                          {c.sublabel ? ` · ${c.sublabel}` : ""}
                        </span>
                      </Label>
                    </div>
                  );
                })}
              </RadioGroup>
            )}
            {selected?.borrower && erasureType && (
              <Alert data-testid="dsar-borrower-warning">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>Erasure will be refused — loan records retained (S-1)</AlertTitle>
                <AlertDescription>
                  This person is a borrower. Loan, 1099-INT and 1098 records require their identity to be retained,
                  so erasure is refused until the founder/counsel ruling. Export instead: an export runs on an access
                  or portability request for this person.
                </AlertDescription>
              </Alert>
            )}
          </section>

          {/* ── Actions ── */}
          <section className="flex flex-wrap items-start gap-4">
            <div className="space-y-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => selected && generateExport.mutate(selected.selector)}
                disabled={exportBlockedReason !== null || busy}
                aria-describedby={exportBlockedReason ? ids.exportReason : undefined}
                data-testid="button-dsar-export"
              >
                {generateExport.isPending ? "Exporting…" : "Generate export"}
              </Button>
              {exportBlockedReason && (
                <p id={ids.exportReason} className="text-xs text-muted-foreground" data-testid="dsar-export-reason">
                  {exportBlockedReason}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => { setConfirmText(""); setConfirmOpen(true); }}
                disabled={eraseBlockedReason !== null || busy}
                aria-describedby={eraseBlockedReason ? ids.eraseReason : undefined}
                data-testid="button-dsar-erase"
              >
                Erase subject
              </Button>
              {eraseBlockedReason && (
                <p id={ids.eraseReason} className="text-xs text-muted-foreground" data-testid="dsar-erase-reason">
                  {eraseBlockedReason}
                </p>
              )}
            </div>
          </section>

          {/* ── Inline outcomes (design §6 table) ── */}
          {outcome?.kind === "hold" && (
            <Alert variant="destructive" data-testid="dsar-outcome-hold">
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>Legal hold {outcome.caseRef} blocks erasure — release the hold first.</AlertTitle>
              <AlertDescription>
                Nothing was changed.
                {outcome.holdId ? ` Hold ${outcome.holdId}` : ""}
                {outcome.organizationId != null ? ` in org #${outcome.organizationId}` : ""}
                {outcome.scope ? ` (${outcome.scope})` : ""}
                {outcome.holdId || outcome.organizationId != null ? "." : ""}
              </AlertDescription>
            </Alert>
          )}
          {outcome?.kind === "alreadyErased" && (
            <div
              className="flex items-start gap-2 rounded-md border border-border p-3 text-sm"
              role="status"
              data-testid="dsar-outcome-already-erased"
            >
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>Already erased — nothing changed. {outcome.message}</span>
            </div>
          )}
          {outcome?.kind === "retention" && (
            <Alert data-testid="dsar-outcome-retention">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>Erasure refused — loan records must be retained</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  Borrower on note{outcome.noteIds.length === 1 ? "" : "s"}{" "}
                  <span data-testid="dsar-retention-note-ids">{outcome.noteIds.map((n) => `#${n}`).join(", ")}</span>.
                  {" "}{outcome.message}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => generateExport.mutate(outcome.selector)}
                  disabled={!exportType || busy}
                  aria-describedby={!exportType ? `${uid}-export-instead-reason` : undefined}
                  data-testid="button-dsar-export-instead"
                >
                  Export instead
                </Button>
                {!exportType && (
                  <p id={`${uid}-export-instead-reason`} className="text-xs text-muted-foreground">
                    An export runs on an access or portability request for this person — this record is an erasure
                    request.
                  </p>
                )}
              </AlertDescription>
            </Alert>
          )}
          {outcome?.kind === "message" && (
            <Alert variant="destructive" data-testid="dsar-outcome-message">
              <AlertDescription>{outcome.message}</AlertDescription>
            </Alert>
          )}
          {outcome?.kind === "erased" && (
            <div className="space-y-2 rounded-md border border-border p-3 text-sm" role="status" data-testid="dsar-outcome-erased">
              <p className="font-medium">Subject erased.</p>
              {outcome.retained.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">Retained (not erased), with the reason:</p>
                  <ul className="list-disc pl-5 text-xs">
                    {outcome.retained.map((r) => (
                      <li key={r.domain}><span className="font-mono">{r.domain}</span> — {r.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              {outcome.operatorFollowUps.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">Your follow-ups (AcreOS did not do these):</p>
                  <ul className="list-disc pl-5 text-xs">
                    {outcome.operatorFollowUps.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Close the request with "Mark fulfilled" when you have responded.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Erase confirmation ── */}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => { if (!executeErasure.isPending) { setConfirmOpen(o); if (!o) setConfirmText(""); } }}
      >
        <AlertDialogContent className="border-destructive/50" data-testid="dsar-erase-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Erase this subject?</AlertDialogTitle>
            <AlertDialogDescription>
              {selected ? selected.label : "No subject selected"}. Erasure anonymizes the subject's identity and cannot
              be undone. Retained records are listed after it runs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {selected?.borrower && (
            <Alert data-testid="dsar-confirm-borrower-warning">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>
                Erasure will be refused while loan records must be retained (S-1). Export instead.
              </AlertDescription>
            </Alert>
          )}
          <div className="space-y-1">
            <Label htmlFor={ids.confirm}>Type ERASE to confirm</Label>
            <Input
              id={ids.confirm}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              data-testid="input-dsar-erase-confirm"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={executeErasure.isPending}>Cancel</AlertDialogCancel>
            {/* A plain Button, not AlertDialogAction: the dialog closes on settle, not on click. */}
            <Button
              variant="destructive"
              onClick={() => selected && confirmText === "ERASE" && executeErasure.mutate(selected.selector)}
              disabled={confirmText !== "ERASE" || !selected || executeErasure.isPending}
              data-testid="button-dsar-erase-confirm"
            >
              {executeErasure.isPending ? "Erasing…" : "Erase subject"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
