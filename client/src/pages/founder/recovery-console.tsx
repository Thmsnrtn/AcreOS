/**
 * Phase 3 Week 13 — Coriander Recovery Console (operator UI).
 *
 * Wraps the seven founder-gated recovery endpoints shipped in routes-admin-
 * recovery.ts (commit 84109ef). Use cases:
 *
 *   - Customer lost their 2FA device → Reset 2FA after identity proof.
 *   - Account compromised → Revoke a single session, or all-but-current.
 *   - Original owner died, autopay still firing → Freeze autopay on the org.
 *   - Court-ordered ownership transfer → Move organizations.ownerId after
 *     uploading the supporting court document.
 *   - User can't sign in → Generate a one-time Clerk sign-in link.
 *
 * Every destructive action is wrapped in an AlertDialog confirmation. The
 * 2FA reset flow forces a 4-step identity-proof modal that captures proof
 * type, proof reference, justification, and a final "I have verified the
 * identity" checkbox before the API call fires.
 *
 * Audit trail: every backend handler writes to audit_events; this page
 * surfaces the most-recent rows (filtered to recovery.*) in a "Recent
 * recovery actions" card sourced from GET /api/admin/recovery/audit.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Wrench,
  Search,
  ShieldAlert,
  KeyRound,
  Clock,
  Snowflake,
  ArrowRightLeft,
  Copy,
  Trash2,
  LogOut,
  CheckCircle2,
  Upload,
  ScrollText,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface UserHit {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  clerkUserId: string | null;
}

interface SessionRow {
  sessionId: string;
  createdAt: string | null;
  lastActiveAt: string | null;
  ip: string | null;
  userAgent: string | null;
  status: string | null;
}

interface AuditRow {
  id: string;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string;
  justification: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

type ProofType = "video_call" | "court_doc" | "id_photo" | "notarized_statement";

const PROOF_LABEL: Record<ProofType, string> = {
  video_call: "Video call (Zoom/Meet recording)",
  court_doc: "Court document (probate, power of attorney, etc.)",
  id_photo: "Government-issued ID photo",
  notarized_statement: "Notarized statement",
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FounderRecoveryConsolePage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<string>("find");
  const [selected, setSelected] = useState<UserHit | null>(null);

  // ── Tab: Find user ────────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const searchQuery = useQuery<{ results: UserHit[] }>({
    queryKey: ["/api/admin/users/search", query],
    queryFn: async () => {
      if (query.trim().length < 2) return { results: [] };
      const res = await apiRequest(
        "GET",
        `/api/admin/users/search?q=${encodeURIComponent(query.trim())}`,
      );
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: query.trim().length >= 2,
  });

  const handleSelect = (u: UserHit) => {
    setSelected(u);
    setTab("sessions");
  };

  // ── Recent recovery audit log ────────────────────────────────────────────
  const auditQuery = useQuery<{ events: AuditRow[] }>({
    queryKey: ["/api/admin/recovery/audit"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/recovery/audit?limit=25");
      if (!res.ok) throw new Error("Audit fetch failed");
      return res.json();
    },
  });
  const refreshAudit = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/admin/recovery/audit"] });

  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Wrench className="w-7 h-7" aria-hidden="true" />
            Recovery console
          </h1>
          <p className="text-muted-foreground mt-1 max-w-3xl">
            Founder-only operator surface for last-resort account recovery.
            Every action writes an immutable row to <code>audit_events</code>{" "}
            (7-year retention). Do not use without a documented support
            ticket.
          </p>
        </div>

        {selected && (
          <Card className="border-primary/40">
            <CardContent className="py-4 flex items-center gap-3 flex-wrap">
              <Badge variant="outline">Selected user</Badge>
              <div className="text-sm">
                <span className="font-medium">
                  {selected.firstName ?? ""} {selected.lastName ?? ""}
                </span>{" "}
                <span className="text-muted-foreground">
                  &lt;{selected.email ?? "no-email"}&gt;
                </span>
              </div>
              <code className="text-xs text-muted-foreground">
                id={selected.id}
              </code>
              {selected.clerkUserId && (
                <code className="text-xs text-muted-foreground">
                  clerk={selected.clerkUserId}
                </code>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(null)}
                aria-label="Clear selected user"
              >
                Clear
              </Button>
            </CardContent>
          </Card>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="find">
              <Search className="w-4 h-4 mr-1" aria-hidden="true" />
              Find user
            </TabsTrigger>
            <TabsTrigger value="sessions" disabled={!selected}>
              <Clock className="w-4 h-4 mr-1" aria-hidden="true" />
              Sessions
            </TabsTrigger>
            <TabsTrigger value="2fa" disabled={!selected}>
              <ShieldAlert className="w-4 h-4 mr-1" aria-hidden="true" />
              2FA reset
            </TabsTrigger>
            <TabsTrigger value="password" disabled={!selected}>
              <KeyRound className="w-4 h-4 mr-1" aria-hidden="true" />
              Password reset link
            </TabsTrigger>
            <TabsTrigger value="autopay">
              <Snowflake className="w-4 h-4 mr-1" aria-hidden="true" />
              Freeze autopay
            </TabsTrigger>
            <TabsTrigger value="ownership">
              <ArrowRightLeft className="w-4 h-4 mr-1" aria-hidden="true" />
              Transfer ownership
            </TabsTrigger>
          </TabsList>

          <TabsContent value="find" className="mt-4">
            <FindUserPanel
              query={query}
              setQuery={setQuery}
              isLoading={searchQuery.isFetching}
              results={searchQuery.data?.results ?? []}
              onSelect={handleSelect}
            />
          </TabsContent>

          <TabsContent value="sessions" className="mt-4">
            {selected ? (
              <SessionsPanel user={selected} onAction={refreshAudit} />
            ) : (
              <EmptySelection />
            )}
          </TabsContent>

          <TabsContent value="2fa" className="mt-4">
            {selected ? (
              <TwoFactorResetPanel user={selected} onAction={refreshAudit} />
            ) : (
              <EmptySelection />
            )}
          </TabsContent>

          <TabsContent value="password" className="mt-4">
            {selected ? (
              <PasswordResetPanel user={selected} onAction={refreshAudit} />
            ) : (
              <EmptySelection />
            )}
          </TabsContent>

          <TabsContent value="autopay" className="mt-4">
            <FreezeAutopayPanel onAction={refreshAudit} />
          </TabsContent>

          <TabsContent value="ownership" className="mt-4">
            <TransferOwnershipPanel onAction={refreshAudit} />
          </TabsContent>
        </Tabs>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScrollText className="w-5 h-5" aria-hidden="true" />
              Recent recovery actions
            </CardTitle>
            <CardDescription>
              Last 25 rows from audit_events filtered to recovery.*. Visible
              to founders only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {auditQuery.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : auditQuery.error ? (
              <p className="text-sm text-destructive">
                Failed to load audit log.
              </p>
            ) : (auditQuery.data?.events ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recovery actions yet.
              </p>
            ) : (
              <div className="space-y-2">
                {(auditQuery.data?.events ?? []).map((e) => (
                  <div
                    key={e.id}
                    className="text-sm border rounded-md px-3 py-2 flex flex-col gap-1"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="font-mono text-xs">
                        {e.action}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(e.createdAt).toLocaleString()}
                      </span>
                      <span className="text-xs">
                        {e.targetType} <code>{e.targetId}</code>
                      </span>
                      {e.actorEmail && (
                        <span className="text-xs text-muted-foreground">
                          by {e.actorEmail}
                        </span>
                      )}
                    </div>
                    {e.justification && (
                      <p className="text-xs text-muted-foreground">
                        {e.justification}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}

// ─── Empty selection ─────────────────────────────────────────────────────────

function EmptySelection() {
  return (
    <Card>
      <CardContent className="py-8 text-center text-sm text-muted-foreground">
        Select a user from the <strong>Find user</strong> tab first.
      </CardContent>
    </Card>
  );
}

// ─── Find user panel ─────────────────────────────────────────────────────────

function FindUserPanel({
  query,
  setQuery,
  isLoading,
  results,
  onSelect,
}: {
  query: string;
  setQuery: (s: string) => void;
  isLoading: boolean;
  results: UserHit[];
  onSelect: (u: UserHit) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Find user</CardTitle>
        <CardDescription>
          Search by email substring or paste an exact userId / Clerk userId.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="email@example.com or userId"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="User search query"
          />
        </div>

        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : query.trim().length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Type at least 2 characters.
          </p>
        ) : results.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users matched.</p>
        ) : (
          <div className="space-y-2">
            {results.map((u) => (
              <button
                key={u.id}
                onClick={() => onSelect(u)}
                className="w-full text-left border rounded-md px-3 py-2 hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label={`Select user ${u.email ?? u.id}`}
              >
                <div className="text-sm font-medium">
                  {u.firstName ?? ""} {u.lastName ?? ""}{" "}
                  <span className="text-muted-foreground">
                    &lt;{u.email ?? "no-email"}&gt;
                  </span>
                </div>
                <div className="text-xs text-muted-foreground font-mono">
                  id={u.id}
                  {u.clerkUserId ? ` · clerk=${u.clerkUserId}` : ""}
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sessions panel ──────────────────────────────────────────────────────────

function SessionsPanel({
  user,
  onAction,
}: {
  user: UserHit;
  onAction: () => void;
}) {
  const { toast } = useToast();
  const [adminSessionId, setAdminSessionId] = useState("");
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);

  const sessionsQuery = useQuery<SessionRow[]>({
    queryKey: ["/api/admin/users", user.id, "sessions"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/admin/users/${encodeURIComponent(user.id)}/sessions`,
      );
      if (!res.ok) throw new Error("Failed to load sessions");
      return res.json();
    },
  });

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["/api/admin/users", user.id, "sessions"],
    });

  const revokeOne = useMutation({
    mutationFn: async (sid: string) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/users/${encodeURIComponent(user.id)}/sessions/${encodeURIComponent(sid)}/revoke`,
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? "Revoke failed");
      return json;
    },
    onSuccess: () => {
      toast({ title: "Session revoked" });
      refresh();
      onAction();
    },
    onError: (e: Error) => {
      toast({
        title: "Revoke failed",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const revokeAllOthers = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/admin/users/${encodeURIComponent(user.id)}/sessions/revoke-all-others`,
        { exceptCurrentAdminSessionId: adminSessionId.trim() },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? "Bulk revoke failed");
      return json;
    },
    onSuccess: (data) => {
      toast({
        title: "Bulk revoke complete",
        description: `Revoked ${data?.revokedCount ?? 0} session(s).`,
      });
      refresh();
      onAction();
    },
    onError: (e: Error) => {
      toast({
        title: "Bulk revoke failed",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const sessions = sessionsQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions for {user.email ?? user.id}</CardTitle>
        <CardDescription>
          Revoke a single session, or revoke all sessions except a known
          admin session id (paste your own session id to keep yourself
          signed in).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sessionsQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : sessionsQuery.error ? (
          <p className="text-sm text-destructive">
            Failed to load sessions.
          </p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active sessions for this user.
          </p>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.sessionId}
                className="border rounded-md px-3 py-2 flex items-center gap-3 flex-wrap"
              >
                <code className="text-xs">{s.sessionId}</code>
                {s.status && (
                  <Badge variant="outline" className="text-xs">
                    {s.status}
                  </Badge>
                )}
                {s.lastActiveAt && (
                  <span className="text-xs text-muted-foreground">
                    last {new Date(s.lastActiveAt).toLocaleString()}
                  </span>
                )}
                {s.ip && (
                  <span className="text-xs text-muted-foreground">
                    {s.ip}
                  </span>
                )}
                <div className="ml-auto">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setPendingRevoke(s.sessionId)}
                    aria-label={`Revoke session ${s.sessionId}`}
                  >
                    <Trash2 className="w-4 h-4 mr-1" aria-hidden="true" />
                    Revoke
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="border-t pt-4 space-y-2">
          <Label htmlFor="admin-sid">
            Your current admin session id (preserved during bulk revoke)
          </Label>
          <Input
            id="admin-sid"
            placeholder="sess_abc123…"
            value={adminSessionId}
            onChange={(e) => setAdminSessionId(e.target.value)}
            aria-label="Admin session id to preserve"
          />
          <Button
            variant="destructive"
            disabled={adminSessionId.trim().length === 0}
            onClick={() => setConfirmRevokeAll(true)}
            aria-label="Revoke all other sessions"
          >
            <LogOut className="w-4 h-4 mr-1" aria-hidden="true" />
            Revoke all other sessions
          </Button>
        </div>
      </CardContent>

      <AlertDialog
        open={!!pendingRevoke}
        onOpenChange={(o) => !o && setPendingRevoke(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this session?</AlertDialogTitle>
            <AlertDialogDescription>
              The user will be signed out of this session immediately.
              This action is logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel aria-label="Cancel revoke">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRevoke) revokeOne.mutate(pendingRevoke);
                setPendingRevoke(null);
              }}
              aria-label="Confirm revoke session"
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmRevokeAll}
        onOpenChange={setConfirmRevokeAll}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke all other sessions?</AlertDialogTitle>
            <AlertDialogDescription>
              All sessions for this user will be revoked except{" "}
              <code>{adminSessionId}</code>. This is irreversible and is
              logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel aria-label="Cancel bulk revoke">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                revokeAllOthers.mutate();
                setConfirmRevokeAll(false);
              }}
              aria-label="Confirm bulk revoke"
            >
              Revoke all others
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ─── 2FA reset panel ─────────────────────────────────────────────────────────

function TwoFactorResetPanel({
  user,
  onAction,
}: {
  user: UserHit;
  onAction: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [proofType, setProofType] = useState<ProofType>("video_call");
  const [proofRefId, setProofRefId] = useState("");
  const [justification, setJustification] = useState("");
  const [verified, setVerified] = useState(false);

  const reset = () => {
    setStep(1);
    setProofType("video_call");
    setProofRefId("");
    setJustification("");
    setVerified(false);
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  // Backend currently rejects "notarized_statement" because the Zod
  // schema is ["video_call","court_doc","id_photo"]. Map notarized →
  // court_doc on submit and capture the original choice in proofRefId.
  const apiProofType = (t: ProofType): "video_call" | "court_doc" | "id_photo" =>
    t === "notarized_statement" ? "court_doc" : t;

  const mutation = useMutation({
    mutationFn: async () => {
      const refLabel =
        proofType === "notarized_statement"
          ? `notarized_statement:${proofRefId}`
          : proofRefId;
      const res = await apiRequest(
        "POST",
        `/api/admin/users/${encodeURIComponent(user.id)}/2fa/reset`,
        {
          identityProofType: apiProofType(proofType),
          proofRefId: refLabel,
          justification,
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? "2FA reset failed");
      return json;
    },
    onSuccess: () => {
      toast({ title: "2FA reset complete" });
      close();
      onAction();
    },
    onError: (e: Error) => {
      toast({
        title: "2FA reset failed",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const canProceed = useMemo(() => {
    if (step === 1) return !!proofType;
    if (step === 2) return proofRefId.trim().length >= 1;
    if (step === 3) return justification.trim().length >= 10;
    if (step === 4) return verified;
    return false;
  }, [step, proofType, proofRefId, justification, verified]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset 2FA for {user.email ?? user.id}</CardTitle>
        <CardDescription>
          Disables every Clerk MFA factor on the user. Use only after
          verifying identity through one of the four supported channels.
          The 4-step modal captures the proof for audit.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="destructive"
          onClick={() => setOpen(true)}
          aria-label="Begin 2FA reset workflow"
        >
          <ShieldAlert className="w-4 h-4 mr-1" aria-hidden="true" />
          Begin 2FA reset workflow
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>2FA reset — step {step} of 4</DialogTitle>
            <DialogDescription>
              Every step is logged. The reset is only fired after step 4
              confirmation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {step === 1 && (
              <div className="space-y-2">
                <Label htmlFor="proof-type">Identity-proof channel</Label>
                <Select
                  value={proofType}
                  onValueChange={(v) => setProofType(v as ProofType)}
                >
                  <SelectTrigger id="proof-type" aria-label="Identity proof type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PROOF_LABEL) as ProofType[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {PROOF_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-2">
                <Label htmlFor="proof-ref">
                  Proof reference (S3 key, video session id, ticket #, etc.)
                </Label>
                <Input
                  id="proof-ref"
                  value={proofRefId}
                  onChange={(e) => setProofRefId(e.target.value)}
                  placeholder="s3://acreos-recovery/abc123.pdf"
                  aria-label="Proof reference id"
                />
              </div>
            )}

            {step === 3 && (
              <div className="space-y-2">
                <Label htmlFor="just">Justification (audit-logged)</Label>
                <Textarea
                  id="just"
                  rows={4}
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder="Customer lost their phone in a house fire; verified via video call against ID on file. Support ticket #12345."
                  aria-label="Justification text"
                />
                <p className="text-xs text-muted-foreground">
                  Minimum 10 characters. Be specific — this is the
                  permanent record.
                </p>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-3">
                <div className="rounded-md border p-3 text-sm space-y-1">
                  <div>
                    <span className="text-muted-foreground">User: </span>
                    {user.email ?? user.id}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Proof: </span>
                    {PROOF_LABEL[proofType]}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Reference: </span>
                    <code>{proofRefId}</code>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      Justification:{" "}
                    </span>
                    {justification}
                  </div>
                </div>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={verified}
                    onCheckedChange={(v) => setVerified(v === true)}
                    aria-label="Confirm identity verified"
                  />
                  <span>I have verified the identity of this user.</span>
                </label>
              </div>
            )}
          </div>

          <DialogFooter className="flex flex-row justify-between">
            <Button
              variant="ghost"
              onClick={close}
              aria-label="Cancel 2FA reset"
            >
              Cancel
            </Button>
            <div className="flex gap-2">
              {step > 1 && (
                <Button
                  variant="outline"
                  onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : 1))}
                  aria-label="Previous step"
                >
                  Back
                </Button>
              )}
              {step < 4 ? (
                <Button
                  disabled={!canProceed}
                  onClick={() => setStep((s) => (s < 4 ? ((s + 1) as 2 | 3 | 4) : 4))}
                  aria-label="Next step"
                >
                  Next
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  disabled={!canProceed || mutation.isPending}
                  onClick={() => mutation.mutate()}
                  aria-label="Confirm 2FA reset"
                >
                  {mutation.isPending ? "Resetting…" : "Reset 2FA"}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Password reset link panel ───────────────────────────────────────────────

function PasswordResetPanel({
  user,
  onAction,
}: {
  user: UserHit;
  onAction: () => void;
}) {
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const [generated, setGenerated] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/admin/users/${encodeURIComponent(user.id)}/password-reset-link`,
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? "Failed");
      return json as { url: string };
    },
    onSuccess: (data) => {
      setGenerated(data.url);
      toast({ title: "Reset link generated" });
      onAction();
    },
    onError: (e: Error) => {
      toast({
        title: "Failed to generate link",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const copy = async () => {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({
        title: "Copy failed",
        description: "Select the URL manually.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate password reset link</CardTitle>
        <CardDescription>
          Mints a one-hour Clerk sign-in token. Share via your trusted
          channel — the link bypasses the password requirement once.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          onClick={() => setConfirm(true)}
          disabled={mutation.isPending}
          aria-label="Generate password reset link"
        >
          <KeyRound className="w-4 h-4 mr-1" aria-hidden="true" />
          Generate link
        </Button>

        {generated && (
          <div className="border rounded-md p-3 space-y-2">
            <Label>Reset link</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={generated}
                aria-label="Generated reset link"
              />
              <Button
                variant="outline"
                onClick={copy}
                aria-label="Copy reset link to clipboard"
              >
                <Copy className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Expires in 1 hour. Single-use.
            </p>
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate reset link?</AlertDialogTitle>
            <AlertDialogDescription>
              A one-time sign-in link will be created for{" "}
              {user.email ?? user.id}. The user will be able to sign in
              without their password. This action is logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel aria-label="Cancel link generation">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                mutation.mutate();
                setConfirm(false);
              }}
              aria-label="Confirm link generation"
            >
              Generate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ─── Freeze autopay panel ────────────────────────────────────────────────────

function FreezeAutopayPanel({ onAction }: { onAction: () => void }) {
  const { toast } = useToast();
  const [orgId, setOrgId] = useState("");
  const [reason, setReason] = useState("");
  const [untilDate, setUntilDate] = useState("");
  const [confirm, setConfirm] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { reason };
      if (untilDate.trim()) {
        body.untilDate = new Date(untilDate).toISOString();
      }
      const res = await apiRequest(
        "POST",
        `/api/admin/orgs/${encodeURIComponent(orgId)}/freeze-autopay`,
        body,
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? "Failed");
      return json;
    },
    onSuccess: () => {
      toast({ title: "Autopay frozen" });
      setOrgId("");
      setReason("");
      setUntilDate("");
      onAction();
    },
    onError: (e: Error) => {
      toast({
        title: "Freeze failed",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const canSubmit =
    orgId.trim().length > 0 && reason.trim().length > 0 && /^\d+$/.test(orgId.trim());

  return (
    <Card>
      <CardHeader>
        <CardTitle>Freeze autopay</CardTitle>
        <CardDescription>
          Switches Stripe collection to <code>send_invoice</code> on the
          org's subscription. Use when the cardholder has died, asked us
          to stop, or is mid-fraud-investigation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="freeze-org">Organization id (numeric)</Label>
            <Input
              id="freeze-org"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              placeholder="42"
              aria-label="Organization id"
            />
          </div>
          <div>
            <Label htmlFor="freeze-until">Until date (optional)</Label>
            <Input
              id="freeze-until"
              type="datetime-local"
              value={untilDate}
              onChange={(e) => setUntilDate(e.target.value)}
              aria-label="Freeze until date"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="freeze-reason">Reason (audit-logged)</Label>
          <Textarea
            id="freeze-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Cardholder deceased per family notice email 2026-04-30. Family asked we pause until estate settles."
            aria-label="Freeze reason"
          />
        </div>
        <Button
          variant="destructive"
          disabled={!canSubmit || mutation.isPending}
          onClick={() => setConfirm(true)}
          aria-label="Freeze autopay"
        >
          <Snowflake className="w-4 h-4 mr-1" aria-hidden="true" />
          Freeze autopay
        </Button>
      </CardContent>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Freeze autopay on org #{orgId}?</AlertDialogTitle>
            <AlertDialogDescription>
              Stripe collection will switch to <code>send_invoice</code>{" "}
              and the org row will be flagged frozen. The customer will
              not be auto-charged until you manually unfreeze.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel aria-label="Cancel freeze">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                mutation.mutate();
                setConfirm(false);
              }}
              aria-label="Confirm freeze autopay"
            >
              Freeze
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ─── Transfer ownership panel ────────────────────────────────────────────────

function TransferOwnershipPanel({ onAction }: { onAction: () => void }) {
  const { toast } = useToast();
  const [orgId, setOrgId] = useState("");
  const [newOwnerUserId, setNewOwnerUserId] = useState("");
  const [courtDocS3Key, setCourtDocS3Key] = useState("");
  const [justification, setJustification] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [uploadName, setUploadName] = useState<string | null>(null);

  // No production S3-presign helper exists in client/src yet (verified via
  // grep on 2026-05-03). We accept a manually-pasted S3 key here; when the
  // file picker is used, we surface a clear note that the operator must
  // upload to S3 separately and paste the resulting key. This matches the
  // "S3 key" contract on the backend (transferOwnershipSchema.courtDocumentS3Key).
  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploadName(f.name);
    toast({
      title: "File noted",
      description:
        "Upload the file to S3 via the ops bucket, then paste the S3 key below.",
    });
    e.target.value = "";
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        newOwnerUserId: newOwnerUserId.trim(),
        justification,
      };
      if (courtDocS3Key.trim()) {
        body.courtDocumentS3Key = courtDocS3Key.trim();
      }
      const res = await apiRequest(
        "POST",
        `/api/admin/orgs/${encodeURIComponent(orgId)}/transfer-ownership`,
        body,
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? "Failed");
      return json;
    },
    onSuccess: () => {
      toast({ title: "Ownership transferred" });
      setOrgId("");
      setNewOwnerUserId("");
      setCourtDocS3Key("");
      setJustification("");
      setUploadName(null);
      onAction();
    },
    onError: (e: Error) => {
      toast({
        title: "Transfer failed",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const canSubmit =
    orgId.trim().length > 0 &&
    /^\d+$/.test(orgId.trim()) &&
    newOwnerUserId.trim().length > 0 &&
    justification.trim().length >= 10;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transfer organization ownership</CardTitle>
        <CardDescription>
          Reassigns <code>organizations.ownerId</code>. Used for probate /
          court-ordered transfers and acquihires. Both old + new owner
          receive an email when the transfer succeeds.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="xfer-org">Organization id (numeric)</Label>
            <Input
              id="xfer-org"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              placeholder="42"
              aria-label="Organization id"
            />
          </div>
          <div>
            <Label htmlFor="xfer-new">New owner userId</Label>
            <Input
              id="xfer-new"
              value={newOwnerUserId}
              onChange={(e) => setNewOwnerUserId(e.target.value)}
              placeholder="user_..."
              aria-label="New owner user id"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Court document</Label>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 cursor-pointer rounded-md border px-3 py-1.5 text-sm hover:bg-muted/50">
              <Upload className="w-4 h-4" aria-hidden="true" />
              <span>Choose file</span>
              <input
                type="file"
                className="hidden"
                onChange={onFileChosen}
                aria-label="Court document file"
              />
            </label>
            {uploadName && (
              <span className="text-xs text-muted-foreground">
                {uploadName}
              </span>
            )}
          </div>
          <Input
            value={courtDocS3Key}
            onChange={(e) => setCourtDocS3Key(e.target.value)}
            placeholder="s3://acreos-ops/court-docs/2026/abc123.pdf"
            aria-label="Court document S3 key"
          />
          <p className="text-xs text-muted-foreground">
            Upload to the ops bucket, then paste the resulting S3 key
            here. Stored on the audit row for legal traceability.
          </p>
        </div>

        <div>
          <Label htmlFor="xfer-just">Justification (audit-logged)</Label>
          <Textarea
            id="xfer-just"
            rows={3}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Probate order #2026-PR-1234 transfers operating control to spouse. Court doc attached above."
            aria-label="Transfer justification"
          />
        </div>

        <Button
          variant="destructive"
          disabled={!canSubmit || mutation.isPending}
          onClick={() => setConfirm(true)}
          aria-label="Transfer ownership"
        >
          <ArrowRightLeft className="w-4 h-4 mr-1" aria-hidden="true" />
          Transfer ownership
        </Button>
      </CardContent>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Transfer ownership of org #{orgId}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <code>organizations.ownerId</code> will become{" "}
              <code>{newOwnerUserId}</code>. Both the old and new owner
              will receive an email. This action is logged with the
              court-doc S3 key and your justification.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel aria-label="Cancel transfer">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                mutation.mutate();
                setConfirm(false);
              }}
              aria-label="Confirm ownership transfer"
            >
              <CheckCircle2 className="w-4 h-4 mr-1" aria-hidden="true" />
              Transfer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
