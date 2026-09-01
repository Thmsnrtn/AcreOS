import type React from "react";
import { useState, useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  Shield,
  Download,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Clock,
} from "lucide-react";
import { Verbs } from "@/lib/labels";

interface OpenRequest {
  id: string;
  type: "access" | "erasure" | "portability" | "rectification";
  receivedAt: string;
  slaDeadlineAt: string;
  overdue: boolean;
}

interface RecentRequest {
  id: string;
  type: "access" | "erasure" | "portability" | "rectification";
  fulfilledAt: string | null;
  deliveryMethod: string | null;
}

interface PrivacyStatus {
  deleted: boolean;
  email: string;
  open: OpenRequest[];
  recent: RecentRequest[];
}

const TYPE_LABEL: Record<OpenRequest["type"], string> = {
  access: "Data export",
  erasure: "Account deletion",
  portability: "Data portability",
  rectification: "Data rectification",
};

function fmtRelative(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * THE ONE privacy surface. Rendered as a page at `/settings/privacy` and as the
 * Privacy section of the main Settings page — the same component both times.
 *
 * It was not always one. Settings carried a 257-line near-copy in
 * `settings/account-sections.tsx`: its own export mutation, its own delete
 * mutation, its own confirm-text state, its own "already deleted" branch, on the
 * same two endpoints. That copy is what shipped the defect ledger 41 closed — it
 * called `res.blob()` on a 202 QUEUE RECEIPT and saved
 * `{requestId, status:"queued"}` as a file named after the user's personal data,
 * then toasted "Account anonymized" and signed them out, while this file one
 * directory over had been honest the whole time.
 *
 * The immediate fix made the copy match. The copy is now GONE, because two
 * implementations of a legally consequential control is the condition that
 * produced the lie, and "keep them in sync" is a promise nobody can keep. Its
 * test used to be titled "both privacy surfaces agree, in source"; it now pins
 * that there is one.
 *
 * `variant` carries only CHROME — page heading and `PageShell` vs a section
 * heading. No behaviour branches on it, deliberately: the moment it does, this
 * is two implementations again wearing one name.
 */
export function PrivacyDataRights({
  variant = "page",
}: {
  variant?: "page" | "section";
}) {
  const isPage = variant === "page";
  const { toast } = useToast();
  const qc = useQueryClient();
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [showDeleteForm, setShowDeleteForm] = useState(false);
  const confirmInputId = useId();

  const { data: status } = useQuery<PrivacyStatus>({
    queryKey: ["/api/privacy/status"],
    queryFn: () =>
      fetch("/api/privacy/status", { credentials: "include" }).then((r) => r.json()),
  });

  const invalidateStatus = () =>
    qc.invalidateQueries({ queryKey: ["/api/privacy/status"] });

  // allow-no-invalidation: onSuccess calls the local invalidateStatus() helper above
  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/privacy/export", {});
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? "Export request failed");
      return json as { requestId: string; eta: string; slaDeadlineAt: string };
    },
    onSuccess: (data) => {
      toast({
        title: "Export queued",
        description: `Your export request was received. You'll get an email within ${data.eta} when it's ready.`,
      });
      invalidateStatus();
    },
    onError: (err: Error) =>
      toast({
        title: "Couldn't queue export",
        description:
          err.message ||
          "Your data is unchanged. Check your connection and try again.",
        variant: "destructive",
      }),
  });

  // allow-no-invalidation: onSuccess calls the local invalidateStatus() helper above
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/privacy/delete", {
        confirm: "DELETE MY DATA",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? "Delete request failed");
      return json as { requestId: string; eta: string; slaDeadlineAt: string };
    },
    onSuccess: (data) => {
      toast({
        title: "Deletion queued",
        description: `Your deletion request was received. You'll get an email within ${data.eta} confirming completion. Your account remains active until then.`,
      });
      setShowDeleteForm(false);
      setDeleteConfirm("");
      invalidateStatus();
    },
    onError: (err: Error) =>
      toast({
        title: "Couldn't queue deletion",
        description: `${
          err.message || "The request failed."
        } — your account is unchanged.`,
        variant: "destructive",
      }),
  });

  // Chrome only. `Frame` is PageShell on the standalone route and a plain
  // wrapper inside Settings, which already has its own shell — nesting a second
  // one would double the page padding and put a second landmark on the page.
  const Frame = ({ children }: { children: React.ReactNode }) =>
    isPage ? <PageShell>{children}</PageShell> : <div className="space-y-6">{children}</div>;

  // Already-deleted (fulfilled erasure) → show completion banner.
  if (status?.deleted) {
    return (
      <Frame>
        <div
          className="flex flex-col items-center gap-4 py-16 text-center"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 className="w-12 h-12 text-acr-pos" aria-hidden="true" />
          {isPage ? (
            <h1 className="text-xl font-semibold">Data deletion complete</h1>
          ) : (
            <h2 className="text-section-h2">Data deletion complete</h2>
          )}
          <p className="text-muted-foreground text-sm">
            Your personal data has already been anonymized.
          </p>
        </div>
      </Frame>
    );
  }

  const openRequests = status?.open ?? [];
  const recentRequests = status?.recent ?? [];
  const hasOpenErasure = openRequests.some((r) => r.type === "erasure");
  const hasOpenExport = openRequests.some(
    (r) => r.type === "access" || r.type === "portability",
  );

  return (
    <Frame>
      <div>
        {isPage ? (
          <h1
            className="text-2xl md:text-3xl font-bold"
            data-testid="text-privacy-title"
          >
            Privacy &amp; data
          </h1>
        ) : (
          <h2 className="text-section-h2 flex items-center gap-2" data-testid="text-privacy-title">
            <Shield className="w-5 h-5" aria-hidden="true" />
            Privacy &amp; data rights
          </h2>
        )}
        <p className="text-muted-foreground text-sm md:text-base">
          Manage your personal data rights under GDPR/CCPA. Every request is
          tracked in our audit log against a 24-hour fulfillment target.
        </p>
      </div>

      {/* Open requests — surfaced at the top so customers see the queue state */}
      {openRequests.length > 0 && (
        <Card data-testid="card-open-requests">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock
                className="w-5 h-5 text-primary"
                aria-hidden="true"
              />
              <CardTitle className="text-base">Your open requests</CardTitle>
            </div>
            <CardDescription>
              Requests are worked against a 24-hour target — track each one's
              status right here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <ul
              className="space-y-2"
              aria-label="Open data-subject requests"
            >
              {openRequests.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
                  data-testid={`open-request-${r.id}`}
                >
                  <Badge
                    variant={r.overdue ? "destructive" : "secondary"}
                    aria-label={r.overdue ? "overdue" : "queued"}
                  >
                    {r.overdue ? "Overdue" : "Queued"}
                  </Badge>
                  <span className="font-medium">{TYPE_LABEL[r.type]}</span>
                  <span className="text-xs text-muted-foreground">
                    submitted {fmtRelative(r.receivedAt)} · SLA{" "}
                    {fmtRelative(r.slaDeadlineAt)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Data Export */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Download className="w-5 h-5 text-primary" aria-hidden="true" />
              <CardTitle className="text-base">Export your data</CardTitle>
            </div>
            <CardDescription>
              Request a complete copy of all personal data AcreOS holds about
              you (GDPR Article 15). Tracked against a 24-hour fulfillment
              target — follow its status above.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>Your export will include:</p>
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
              disabled={exportMutation.isPending || hasOpenExport}
              className="w-full min-h-11"
              aria-label="Request data export"
              data-testid="button-export-data"
            >
              {exportMutation.isPending ? (
                <>
                  <Loader2
                    className="w-4 h-4 mr-2 animate-spin"
                    aria-hidden="true"
                  />
                  Queueing request…
                </>
              ) : hasOpenExport ? (
                <>
                  <Clock className="w-4 h-4 mr-2" aria-hidden="true" />
                  Export already queued
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" aria-hidden="true" />
                  Request data export
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Data Deletion */}
        <Card className="border-acr-neg-soft dark:border-acr-neg-soft">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-acr-neg" aria-hidden="true" />
              <CardTitle className="text-base text-acr-neg dark:text-acr-neg">
                Delete personal data
              </CardTitle>
            </div>
            <CardDescription>
              Request permanent anonymization of your personal data (GDPR
              Article 17 — Right to Erasure). Tracked against a 24-hour
              fulfillment target. Business records required for legal
              compliance are retained in anonymized form.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="flex items-start gap-2 p-3 rounded-card bg-acr-warn-soft dark:bg-acr-warn-soft/20 border border-acr-warn-soft dark:border-acr-warn-soft"
              role="alert"
            >
              <AlertTriangle
                className="w-4 h-4 text-acr-warn shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="text-xs text-acr-warn dark:text-acr-warn space-y-1">
                <p className="font-medium">This action can't be undone.</p>
                <p>
                  Your email, name, and contact details will be replaced with
                  anonymized values. Deals and business records are retained for
                  legal compliance.
                </p>
              </div>
            </div>

            {!showDeleteForm ? (
              <Button
                variant="destructive"
                className="w-full min-h-11"
                onClick={() => setShowDeleteForm(true)}
                disabled={hasOpenErasure}
                aria-label="Request data deletion"
                data-testid="button-request-delete"
              >
                {hasOpenErasure ? (
                  <>
                    <Clock className="w-4 h-4 mr-2" aria-hidden="true" />
                    Deletion already queued
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" />
                    Request data deletion
                  </>
                )}
              </Button>
            ) : (
              <div className="space-y-3">
                <div>
                  <Label
                    htmlFor={confirmInputId}
                    className="text-xs text-muted-foreground mb-2 block font-normal"
                  >
                    Type{" "}
                    <strong className="font-mono">DELETE MY DATA</strong> to
                    confirm:
                  </Label>
                  <Input
                    id={confirmInputId}
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder="Type DELETE MY DATA here"
                    className="text-sm font-mono"
                    autoComplete="off"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    variant="destructive"
                    className="flex-1 min-h-11"
                    disabled={
                      deleteConfirm !== "DELETE MY DATA" ||
                      deleteMutation.isPending
                    }
                    onClick={() => deleteMutation.mutate()}
                    aria-label="Confirm deletion request"
                    data-testid="button-confirm-delete"
                  >
                    {deleteMutation.isPending ? (
                      <>
                        <Loader2
                          className="w-4 h-4 mr-2 animate-spin"
                          aria-hidden="true"
                        />
                        Queueing…
                      </>
                    ) : (
                      "Confirm deletion request"
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => {
                      setShowDeleteForm(false);
                      setDeleteConfirm("");
                    }}
                    aria-label="Cancel deletion request"
                  >
                    {Verbs.CANCEL}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent fulfilled requests */}
      {recentRequests.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2
                className="w-5 h-5 text-acr-pos"
                aria-hidden="true"
              />
              <CardTitle className="text-base">
                Recently fulfilled requests
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ul
              className="space-y-2 text-sm"
              aria-label="Recently fulfilled requests"
            >
              {recentRequests.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border p-3"
                >
                  <Badge variant="outline">Fulfilled</Badge>
                  <span className="font-medium">{TYPE_LABEL[r.type]}</span>
                  {r.fulfilledAt && (
                    <span className="text-xs text-muted-foreground">
                      {fmtRelative(r.fulfilledAt)}
                    </span>
                  )}
                  {r.deliveryMethod && (
                    <span className="text-xs text-muted-foreground">
                      via {r.deliveryMethod}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" aria-hidden="true" />
            <CardTitle className="text-base">Your data rights</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <ul
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            aria-label="Your GDPR data rights"
          >
            {[
              {
                right: "Right of access (Art. 15)",
                desc: "Request a copy of all data we hold about you",
                status: "available",
              },
              {
                right: "Right to erasure (Art. 17)",
                desc: "Request anonymization of personal data",
                status: "available",
              },
              {
                right: "Right to rectification (Art. 16)",
                desc: "Correct inaccurate data via Settings",
                status: "available",
              },
              {
                right: "Right to portability (Art. 20)",
                desc: "Export your data in JSON format",
                status: "available",
              },
              {
                right: "Right to object (Art. 21)",
                desc: "Contact support to object to processing",
                status: "contact",
              },
              {
                right: "Right to restriction (Art. 18)",
                desc: "Contact support to restrict processing",
                status: "contact",
              },
            ].map(({ right, desc, status }) => (
              <li
                key={right}
                className="flex items-start gap-2 p-3 rounded-card border bg-muted/20"
              >
                <Badge
                  variant={status === "available" ? "default" : "outline"}
                  className="text-xs shrink-0 mt-0.5"
                  aria-label={
                    status === "available" ? "available" : "contact support"
                  }
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
    </Frame>
  );
}

/**
 * The standalone route at `/settings/privacy`, linked from the public privacy
 * policy and from the data-export page. Nothing but chrome and a title.
 */
export default function PrivacySettingsPage() {
  useDocumentTitle("Privacy & data");
  return <PrivacyDataRights variant="page" />;
}
