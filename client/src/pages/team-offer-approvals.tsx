/**
 * /team/offer-approvals — Phase 5 §5 Part E (team readiness).
 *
 * Admin/owner queue for offers above the org's
 * organizations.requiresApprovalOffersOver threshold. Reviewer clicks
 * approve/decline; the linked offer transitions to "approved" or "draft"
 * and the decision is audit-logged server-side.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
import { formatDateTime } from "@/lib/format";
import { CheckCircle2, XCircle, Inbox } from "lucide-react";

interface OfferApproval {
  id: number;
  offerId: number;
  status: "pending" | "approved" | "declined";
  submittedBy: string;
  reviewerId: string | null;
  reviewerNotes: string | null;
  thresholdAmount: string;
  offerAmount: string;
  createdAt: string;
  decidedAt: string | null;
}

export default function OfferApprovalsPage() {
  useDocumentTitle("Offer approvals");
  const { toast } = useToast();
  const [thresholdInput, setThresholdInput] = useState<string>("");
  const [notes, setNotes] = useState<Record<number, string>>({});

  const {
    data: approvals = [],
    isLoading,
    error,
    refetch,
  } = useQuery<OfferApproval[]>({
    queryKey: ["/api/team-readiness/offer-approvals"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/team-readiness/offer-approvals");
      const json = await res.json();
      return json.approvals;
    },
  });

  // Optimistic approval decision — the row flips status instantly so the
  // pending list retires the entry. Rollback restores prior status if the
  // server rejects.
  const decisionMutation = useOptimisticUpdate<{ id: number; decision: "approved" | "declined"; notesText?: string }>({
    mutationFn: async ({ id, decision, notesText }) => {
      const res = await apiRequest(
        "POST",
        `/api/team-readiness/offer-approvals/${id}/decision`,
        { decision, notes: notesText },
      );
      return await res.json();
    },
    listKeys: [["/api/team-readiness/offer-approvals"]],
    getId: ({ id }) => id,
    buildPatch: ({ decision }) => ({ status: decision }),
    successToast: { title: "Decision recorded" },
  });

  const thresholdMutation = useMutation({
    mutationFn: async (val: number | null) => {
      const res = await apiRequest("PUT", "/api/team-readiness/offer-approval-threshold", {
        requiresApprovalOffersOver: val,
      });
      return await res.json();
    },
    onSuccess: () => {
      // The threshold governs which offers require approval — refresh the list.
      queryClient.invalidateQueries({ queryKey: ["/api/team-readiness/offer-approvals"] });
      toast({ title: "Threshold updated" });
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  const pending = approvals.filter((a) => a.status === "pending");
  const decided = approvals.filter((a) => a.status !== "pending");

  return (
    <PageShell label="Offer approvals">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Offer approvals</h1>
          <p className="text-sm text-muted-foreground">
            Review offers that exceed your organization's approval threshold. Decisions are audit-logged.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Approval threshold</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3">
              <div className="flex-1 max-w-xs">
                <Label htmlFor="threshold-input">Offers above this amount require approval (USD)</Label>
                <Input
                  id="threshold-input"
                  type="number"
                  placeholder="50000"
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                />
              </div>
              <Button
                onClick={() =>
                  thresholdMutation.mutate(thresholdInput === "" ? null : parseFloat(thresholdInput))
                }
                disabled={thresholdMutation.isPending}
              >
                Save
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setThresholdInput("");
                  thresholdMutation.mutate(null);
                }}
              >
                Disable approval
              </Button>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <Card>
            <CardHeader>
              <CardTitle>Pending</CardTitle>
            </CardHeader>
            <CardContent>
              <div role="status" aria-busy="true">
                <span className="sr-only">Loading offer approvals…</span>
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-4">
                      <Skeleton className="h-4 w-16" announce={false} />
                      <Skeleton className="h-4 w-40 flex-1" announce={false} />
                      <Skeleton className="h-4 w-20" announce={false} />
                      <Skeleton className="h-16 w-40" announce={false} />
                      <Skeleton className="h-9 w-44 rounded-md" announce={false} />
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ) : error ? (
          <QueryErrorState
            error={error as Error}
            onRetry={() => refetch()}
            title="Couldn't load offer approvals"
            testId="offer-approvals-error"
          />
        ) : (
          <>
        <Card>
          <CardHeader>
            <CardTitle>Pending ({pending.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? (
              <EmptyState
                icon={Inbox}
                headline="No offers awaiting approval"
                subtitle="Offers above your approval threshold land here for review. You're all caught up."
                tone="celebratory"
                // TODO(cta): system-generated queue — clears as offers are reviewed; no user action available
                cta={{ label: "", _noOp: true }}
                testId="offer-approvals-pending-empty"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Offer #</TableHead>
                    <TableHead>Submitted by</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Threshold</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>#{a.offerId}</TableCell>
                      <TableCell className="text-xs">{a.submittedBy}</TableCell>
                      <TableCell className="text-right">
                        ${Number(a.offerAmount).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        ${Number(a.thresholdAmount).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Textarea
                          rows={2}
                          placeholder="Optional notes…"
                          value={notes[a.id] ?? ""}
                          onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })}
                          aria-label={`Notes for offer ${a.offerId}`}
                        />
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            decisionMutation.mutate({ id: a.id, decision: "approved", notesText: notes[a.id] })
                          }
                        >
                          <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            decisionMutation.mutate({ id: a.id, decision: "declined", notesText: notes[a.id] })
                          }
                        >
                          <XCircle className="h-4 w-4 mr-1" /> Decline
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recently decided ({decided.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {decided.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                headline="No decided approvals yet"
                subtitle="Once you approve or decline an offer, the decision and reviewer are recorded here."
                // TODO(cta): read-only history — populated by decisions made above; no user action available
                cta={{ label: "", _noOp: true }}
                testId="offer-approvals-decided-empty"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Offer #</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Reviewer</TableHead>
                    <TableHead>Decided at</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {decided.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>#{a.offerId}</TableCell>
                      <TableCell>
                        <Badge variant={a.status === "approved" ? "default" : "secondary"}>
                          {a.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">${Number(a.offerAmount).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">{a.reviewerId ?? "—"}</TableCell>
                      <TableCell className="text-xs">{a.decidedAt ? formatDateTime(a.decidedAt) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
          </>
        )}
      </div>
    </PageShell>
  );
}
