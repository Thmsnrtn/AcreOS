/**
 * Founder feedback inbox — triage surface for the public
 * /api/feedback submissions that replaced the dead `thomas@acreos.io`
 * mailto links.
 *
 * Lists submissions newest-first, filterable by status + category,
 * with mark-read / mark-replied / archive actions inline.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  Mail,
  Inbox,
  Archive,
  Check,
  MessageSquare,
  AlertCircle,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type Status = "new" | "read" | "replied" | "archived";
type Category = "support" | "feedback" | "question";

interface FeedbackRow {
  id: number;
  category: Category;
  name: string | null;
  email: string | null;
  message: string;
  source: string | null;
  status: Status;
  readAt: string | null;
  repliedAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface ListResponse {
  submissions: FeedbackRow[];
  total: number;
  page: number;
  limit: number;
}

// ─── Display helpers ────────────────────────────────────────────────────────

const STATUS_TONE: Record<Status, "default" | "secondary" | "outline" | "destructive"> = {
  new: "default",
  read: "secondary",
  replied: "outline",
  archived: "outline",
};

const CATEGORY_TONE: Record<Category, "default" | "secondary" | "outline"> = {
  support: "destructive" as any, // visual urgency
  feedback: "secondary",
  question: "outline",
};

function formatDate(s: string): string {
  const d = new Date(s);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function FounderFeedbackInboxPage() {
  useDocumentTitle("Feedback inbox");
  const { toast } = useToast();
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<Status | "all">("new");
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const queryKey = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (categoryFilter !== "all") params.set("category", categoryFilter);
    const qs = params.toString();
    return [`/api/founder/feedback${qs ? `?${qs}` : ""}`];
  }, [statusFilter, categoryFilter]);

  const { data, isLoading, error } = useQuery<ListResponse>({ queryKey });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: Status }) => {
      const res = await apiRequest("PATCH", `/api/founder/feedback/${id}`, {
        status,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Update failed");
      }
      return res.json();
    },
    onSuccess: (_row, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/founder/feedback"] });
      qc.invalidateQueries({ queryKey });
      toast({
        title:
          vars.status === "archived"
            ? "Archived"
            : vars.status === "replied"
              ? "Marked replied"
              : "Marked read",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't update",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const submissions = data?.submissions ?? [];

  return (
    <PageShell>
      <div className="max-w-5xl mx-auto py-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Inbox className="h-6 w-6" />
              Feedback inbox
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Support requests, feedback, and questions submitted from the
              public site. Replaces the old thomas@acreos.io mailto.
            </p>
          </div>
          {data && (
            <div className="text-right">
              <div className="text-2xl font-semibold tabular-nums">
                {data.total}
              </div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide">
                matching
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Status
            </label>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as Status | "all")}
            >
              <SelectTrigger className="w-40" data-testid="filter-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="read">Read</SelectItem>
                <SelectItem value="replied">Replied</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Category
            </label>
            <Select
              value={categoryFilter}
              onValueChange={(v) => setCategoryFilter(v as Category | "all")}
            >
              <SelectTrigger className="w-40" data-testid="filter-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="support">Support</SelectItem>
                <SelectItem value="feedback">Feedback</SelectItem>
                <SelectItem value="question">Question</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        )}

        {error && (
          <Card>
            <CardContent className="pt-6 flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Couldn't load feedback — try refreshing.
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && submissions.length === 0 && (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
              No submissions match the current filters.
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {submissions.map((row) => {
            const expanded = expandedId === row.id;
            return (
              <Card
                key={row.id}
                className={
                  row.status === "new"
                    ? "border-primary/40"
                    : ""
                }
                data-testid={`feedback-row-${row.id}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Badge variant={STATUS_TONE[row.status]}>
                          {row.status}
                        </Badge>
                        <Badge variant={CATEGORY_TONE[row.category]}>
                          {row.category}
                        </Badge>
                        <span className="text-sm font-normal text-muted-foreground">
                          {formatDate(row.createdAt)}
                        </span>
                      </CardTitle>
                      <CardDescription>
                        {row.name || "Anonymous"}
                        {row.email && (
                          <>
                            {" · "}
                            <a
                              href={`mailto:${row.email}`}
                              className="underline-offset-2 hover:underline"
                            >
                              {row.email}
                            </a>
                          </>
                        )}
                        {row.source && (
                          <span className="text-xs text-muted-foreground ml-2">
                            from {row.source}
                          </span>
                        )}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {row.status !== "read" &&
                        row.status !== "replied" &&
                        row.status !== "archived" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              updateMutation.mutate({ id: row.id, status: "read" })
                            }
                            disabled={updateMutation.isPending}
                            data-testid={`mark-read-${row.id}`}
                          >
                            <Check className="h-3.5 w-3.5 mr-1" />
                            Mark read
                          </Button>
                        )}
                      {row.email && row.status !== "replied" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateMutation.mutate({
                              id: row.id,
                              status: "replied",
                            })
                          }
                          disabled={updateMutation.isPending}
                          data-testid={`mark-replied-${row.id}`}
                        >
                          <Mail className="h-3.5 w-3.5 mr-1" />
                          Mark replied
                        </Button>
                      )}
                      {row.status !== "archived" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            updateMutation.mutate({
                              id: row.id,
                              status: "archived",
                            })
                          }
                          disabled={updateMutation.isPending}
                          data-testid={`archive-${row.id}`}
                        >
                          <Archive className="h-3.5 w-3.5 mr-1" />
                          Archive
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId(expanded ? null : row.id)
                    }
                    className="text-left w-full"
                  >
                    <p
                      className={`text-sm whitespace-pre-wrap ${
                        expanded ? "" : "line-clamp-3"
                      }`}
                    >
                      {row.message}
                    </p>
                    {!expanded && row.message.length > 200 && (
                      <span className="text-xs text-muted-foreground mt-1 inline-block">
                        Show more
                      </span>
                    )}
                  </button>
                  {expanded && (row.ipAddress || row.userAgent) && (
                    <div className="mt-3 pt-3 border-t text-xs text-muted-foreground space-y-0.5">
                      {row.ipAddress && <div>IP: {row.ipAddress}</div>}
                      {row.userAgent && (
                        <div className="truncate">UA: {row.userAgent}</div>
                      )}
                      {row.readAt && (
                        <div>Read: {formatDate(row.readAt)}</div>
                      )}
                      {row.repliedAt && (
                        <div>Replied: {formatDate(row.repliedAt)}</div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </PageShell>
  );
}
