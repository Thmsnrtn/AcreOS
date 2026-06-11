/**
 * Settings → Account sections (Refer & earn, Privacy & data rights) —
 * extracted from the settings.tsx monolith (T3 census W1-2). Behavior and
 * test ids preserved; loading states upgraded to content-shaped Skeletons
 * and query failures now render QueryErrorState with retry.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { usd } from "@/lib/format";
import {
  Gift,
  Link2,
  Users,
  CheckCircle2,
  Coins,
  Wallet,
  Lock,
  Download,
  Trash2,
  Shield,
  AlertTriangle,
  Loader2,
} from "lucide-react";

// ── Referral Settings ──────────────────────────────────────────────────────

export function ReferralSettings() {
  const { toast } = useToast();
  const appUrl = typeof window !== "undefined" ? window.location.origin : "https://app.acreos.io";

  const codeQuery = useQuery<{ code: string }>({
    queryKey: ["/api/referral/code"],
    queryFn: async () => {
      const res = await fetch("/api/referral/code", { credentials: "include" });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return res.json();
    },
  });

  const statsQuery = useQuery<{ signups: number; conversions: number; creditsEarned: number; creditBalance: number }>({
    queryKey: ["/api/referral/stats"],
    queryFn: async () => {
      const res = await fetch("/api/referral/stats", { credentials: "include" });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return res.json();
    },
  });

  const referralLink = codeQuery.data?.code
    ? `${appUrl}/?ref=${codeQuery.data.code}`
    : "";

  const copyLink = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink).then(() => {
      toast({ title: "Referral link copied to clipboard" });
    });
  };

  const stats = statsQuery.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="w-5 h-5" aria-hidden="true" />
            Refer &amp; earn
          </CardTitle>
          <CardDescription>
            Share AcreOS with fellow Land Investors. They get 30 days free — you get $20 account credit when they subscribe.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Offer callout */}
          <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 flex items-start gap-3">
            <Gift className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-semibold text-sm">Give 30 days free, get $20 credit</p>
              <p className="text-xs text-muted-foreground">
                Your referral code gives new users their first 30 days on us.
                Once they become a paying subscriber, you'll automatically receive a $20 account credit — applied to your next invoice.
              </p>
            </div>
          </div>

          {/* Referral link */}
          <div className="space-y-2">
            <Label htmlFor="input-referral-link" className="text-sm font-medium">Your referral link</Label>
            {codeQuery.isLoading ? (
              <Skeleton className="h-10 w-full" announceText="Loading your referral link" />
            ) : codeQuery.isError ? (
              <QueryErrorState
                error={codeQuery.error as Error}
                onRetry={() => codeQuery.refetch()}
                isRetrying={codeQuery.isRefetching}
                compact
                title="Couldn't load your referral link"
                description="Your referral credits are unchanged — this is just a display issue."
                testId="error-referral-link"
              />
            ) : (
              <div className="flex gap-2">
                <Input
                  id="input-referral-link"
                  readOnly
                  value={referralLink}
                  className="font-mono text-sm"
                  onFocus={(e) => e.currentTarget.select()}
                  data-testid="input-referral-link"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyLink}
                  className="shrink-0 min-h-11 pointer-fine:sm:min-h-9"
                  aria-label="Copy referral link to clipboard"
                >
                  <Link2 className="w-4 h-4 mr-1" aria-hidden="true" />
                  Copy
                </Button>
              </div>
            )}
          </div>

          {/* Stats */}
          {statsQuery.isError ? (
            <QueryErrorState
              error={statsQuery.error as Error}
              onRetry={() => statsQuery.refetch()}
              isRetrying={statsQuery.isRefetching}
              compact
              title="Couldn't load your referral stats"
              testId="error-referral-stats"
            />
          ) : (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Signups", value: stats?.signups ?? 0, icon: Users, isMoney: false },
                { label: "Converted", value: stats?.conversions ?? 0, icon: CheckCircle2, isMoney: false },
                { label: "Credits earned", value: stats ? usd(stats.creditsEarned / 100, { noCents: true }) : "$0", icon: Coins, isMoney: true },
                { label: "Available credit", value: stats ? usd(stats.creditBalance / 100, { noCents: true }) : "$0", icon: Wallet, isMoney: true },
              ].map(({ label, value, icon: Icon }, i) => (
                <div key={label} className="rounded-card border border-border/60 bg-card p-4 space-y-1 text-center">
                  <Icon className="w-4 h-4 text-primary mx-auto" aria-hidden="true" />
                  {statsQuery.isLoading ? (
                    <Skeleton
                      className="h-8 w-12 mx-auto"
                      announce={i === 0}
                      announceText="Loading referral stats"
                    />
                  ) : (
                    <dd className="text-2xl font-bold tabular-nums">{value}</dd>
                  )}
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                </div>
              ))}
            </dl>
          )}

          <p className="text-xs text-muted-foreground">
            Credits are applied automatically to your subscription invoice once a referee has been a paying subscriber for 30+ days.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Privacy & Data Settings ─────────────────────────────────────────────────

interface PrivacyStatus {
  deleted: boolean;
  userId: number;
}

export function PrivacyDataSettings() {
  const { toast } = useToast();
  const { logout } = useAuth();
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [showDeleteForm, setShowDeleteForm] = useState(false);

  const { data: privacyStatus } = useQuery<PrivacyStatus>({
    queryKey: ["/api/privacy/status"],
    queryFn: () => fetch("/api/privacy/status", { credentials: "include" }).then(r => r.json()),
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/privacy/export", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `acreOS-data-export-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    onSuccess: () => toast({ title: "Data export downloaded" }),
    onError: (err: any) =>
      toast({
        title: "Couldn't prepare your export",
        description: err?.message || "Check your connection and try again — no data was changed.",
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/privacy/delete", { confirm: "DELETE MY DATA" }),
    onSuccess: () => {
      toast({
        title: "Account anonymized",
        description: "Your personal data has been deleted. You'll be signed out in a few seconds.",
      });
      setShowDeleteForm(false);
      setTimeout(() => {
        logout();
      }, 3000);
    },
    onError: (err: any) =>
      toast({
        title: "Couldn't delete your data",
        description: err?.message || "Check your connection and try again — your account is unchanged.",
        variant: "destructive",
      }),
  });

  if (privacyStatus?.deleted) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center" role="status" aria-live="polite">
        <CheckCircle2 className="w-12 h-12 text-acr-pos" aria-hidden="true" />
        <h2 className="text-section-h2">Data deletion complete</h2>
        <p className="text-muted-foreground text-sm">Your personal data has already been anonymized.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-section-h2 flex items-center gap-2">
          <Lock className="w-5 h-5" aria-hidden="true" />
          Privacy &amp; data rights
        </h2>
        <p className="text-muted-foreground text-sm">
          Manage your personal data rights under GDPR/CCPA.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Data Export */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Download className="w-5 h-5 text-primary" aria-hidden="true" />
              <CardTitle className="text-base">Export your data</CardTitle>
            </div>
            <CardDescription>
              Download a complete copy of all personal data AcreOS holds about you (GDPR Article 15).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>Your export includes:</p>
              <ul className="list-disc list-inside space-y-0.5 text-xs">
                <li>Account information</li>
                <li>Leads assigned to you</li>
                <li>Deals and properties</li>
                <li>Tasks and messages</li>
                <li>Support tickets</li>
              </ul>
            </div>
            <Button
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending}
              className="w-full min-h-11 pointer-fine:sm:min-h-9"
              data-testid="btn-export-data"
            >
              {exportMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />Preparing export…</>
              ) : (
                <><Download className="w-4 h-4 mr-2" aria-hidden="true" />Download my data</>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Data Deletion */}
        <Card className="border-acr-neg/30 dark:border-acr-neg/30">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-acr-neg" aria-hidden="true" />
              <CardTitle className="text-base text-acr-neg dark:text-acr-neg">Delete personal data</CardTitle>
            </div>
            <CardDescription>
              Permanently anonymize your personal data (GDPR Article 17 — right to erasure).
              Business records required for legal compliance are retained in anonymized form.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="flex items-start gap-2 p-3 rounded-card bg-acr-warn-soft dark:bg-acr-warn-soft/20 border border-acr-warn/30 dark:border-acr-warn/30"
              role="alert"
            >
              <AlertTriangle className="w-4 h-4 text-acr-warn shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-xs text-acr-warn dark:text-acr-warn space-y-1">
                <p className="font-medium">This action can't be undone.</p>
                <p>Your email, name, and contact details will be replaced with anonymized values. Deals and business records are retained for legal compliance.</p>
              </div>
            </div>

            {!showDeleteForm ? (
              <Button
                variant="destructive"
                className="w-full min-h-11 pointer-fine:sm:min-h-9"
                onClick={() => setShowDeleteForm(true)}
                data-testid="btn-request-deletion"
              >
                <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" />
                Request data deletion
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="input-delete-confirm" className="text-xs">
                    Type <strong className="tabular-nums">DELETE</strong> to confirm:
                  </Label>
                  <Input
                    id="input-delete-confirm"
                    value={deleteConfirmText}
                    onChange={e => setDeleteConfirmText(e.target.value)}
                    placeholder="Type DELETE here"
                    className="text-sm"
                    autoComplete="off"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    data-testid="input-delete-confirm"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    className="flex-1 min-h-11 pointer-fine:sm:min-h-9"
                    disabled={deleteConfirmText !== "DELETE" || deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate()}
                    data-testid="btn-confirm-deletion"
                  >
                    {deleteMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />Deleting…</>
                    ) : (
                      "Confirm deletion"
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11 pointer-fine:sm:min-h-9"
                    onClick={() => { setShowDeleteForm(false); setDeleteConfirmText(""); }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" aria-hidden="true" />
            <CardTitle className="text-base">Your data rights</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-label="GDPR and CCPA data rights">
            {[
              { right: "Right of access (Art. 15)", desc: "Download all data we hold about you.", status: "available" as const },
              { right: "Right to erasure (Art. 17)", desc: "Request anonymization of personal data.", status: "available" as const },
              { right: "Right to rectification (Art. 16)", desc: "Correct inaccurate data via Settings.", status: "available" as const },
              { right: "Right to portability (Art. 20)", desc: "Export your data in JSON format.", status: "available" as const },
              { right: "Right to object (Art. 21)", desc: "Contact support to object to processing.", status: "contact" as const },
              { right: "Right to restriction (Art. 18)", desc: "Contact support to restrict processing.", status: "contact" as const },
            ].map(({ right, desc, status }) => (
              <li key={right} className="flex items-start gap-2 p-3 rounded-card border bg-muted/20">
                <Badge
                  variant={status === "available" ? "default" : "outline"}
                  className="text-xs shrink-0 mt-0.5"
                >
                  {status === "available" ? "Available" : "Via support"}
                </Badge>
                <div>
                  <p className="text-xs font-medium">{right}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
