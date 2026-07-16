/**
 * FounderLetterPage — the monthly narrative that replaces the
 * dashboard as the primary surface for the "1 hour/month" operation.
 *
 * Instead of five cards, read one page. The letter is written by the
 * AcreOS Chief of Staff (an AI synthesizing across all 12 agents) and
 * always ends with a single bolded decision the founder has to weigh
 * in on. The archive sidebar shows previous months.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { FounderAuthError } from "@/components/founder/FounderAuthError";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { FileText, Check, RefreshCw, Archive, Send } from "lucide-react";
import { format } from "date-fns";

interface FounderLetter {
  id: number;
  monthKey: string;
  letterMarkdown: string;
  pendingFounderDecision: string | null;
  generatedAt: string;
  deliveredAt: string | null;
  status: "draft" | "delivered" | "archived";
}

interface ArchiveRow {
  monthKey: string;
  generatedAt: string;
  deliveredAt: string | null;
  status: string;
  pendingFounderDecision: string | null;
}

function useCurrentLetter(monthKey?: string) {
  return useQuery<{ letter: FounderLetter | null }>({
    queryKey: monthKey
      ? [`/api/founder/intelligence/letter/${monthKey}`]
      : ["/api/founder/intelligence/letter/current"],
    staleTime: 60_000,
  });
}

function useArchive() {
  return useQuery<{ letters: ArchiveRow[] }>({
    queryKey: ["/api/founder/intelligence/letter/archive"],
    staleTime: 5 * 60_000,
  });
}

function renderMarkdown(md: string): React.ReactNode {
  const blocks = md.trim().split(/\n{2,}/);
  return blocks.map((block, i) => {
    const trimmed = block.trim();
    if (trimmed.startsWith("# ")) {
      return (
        <h1 key={i} className="text-3xl font-bold text-foreground mt-6 mb-4">
          {inline(trimmed.slice(2))}
        </h1>
      );
    }
    if (trimmed.startsWith("## ")) {
      return (
        <h2 key={i} className="text-xl font-semibold text-foreground mt-8 mb-3">
          {inline(trimmed.slice(3))}
        </h2>
      );
    }
    if (trimmed.startsWith("### ")) {
      return (
        <h3 key={i} className="text-lg font-semibold text-foreground mt-6 mb-2">
          {inline(trimmed.slice(4))}
        </h3>
      );
    }
    if (/^[-*] /.test(trimmed)) {
      const items = trimmed.split(/\n/).filter((l) => /^[-*] /.test(l));
      return (
        <ul key={i} className="list-disc pl-6 my-3 space-y-1.5 text-foreground/90">
          {items.map((it, j) => (
            <li key={j}>{inline(it.replace(/^[-*] /, ""))}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={i} className="my-3 text-foreground/90 leading-relaxed">
        {inline(trimmed)}
      </p>
    );
  });
}

function inline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  const boldRe = /\*\*([^*]+)\*\*/;
  while (remaining.length > 0) {
    const m = boldRe.exec(remaining);
    if (!m || m.index === undefined) {
      parts.push(remaining);
      break;
    }
    if (m.index > 0) parts.push(remaining.slice(0, m.index));
    parts.push(
      <strong key={key++} className="font-semibold text-foreground">
        {m[1]}
      </strong>,
    );
    remaining = remaining.slice(m.index + m[0].length);
  }
  return <>{parts}</>;
}

// ── Horizon A3 — letter replies as directives ───────────────────────────────

interface LetterReplyOption {
  key: string;
  label: string;
}

interface LetterReplyParse {
  kind: "ruling" | "directive" | "question" | "noise";
  confidence: number;
  restatement: string;
}

interface LetterReplyResponse {
  itemId: number;
  parse: LetterReplyParse;
  options: LetterReplyOption[];
}

const KIND_LABELS: Record<LetterReplyParse["kind"], string> = {
  ruling: "Ruling",
  directive: "Directive",
  question: "Question",
  noise: "Noise",
};

const CONFIRM_TOASTS: Record<string, string> = {
  stored_precedent: "Stored as precedent",
  queued_directive: "Queued for Solene",
  sent_to_chat: "Noted — ask Solene in chat when you're ready",
  discarded: "Discarded",
  already_resolved: "Already handled",
};

/**
 * The reply box under the letter body. The parse is SHOWN BACK for a
 * one-tap confirmation — nothing is stored as a precedent or queued as a
 * directive until an option is tapped (witnessed admission). Keyed on
 * monthKey by the caller so switching letters resets the panel.
 */
function LetterReplyPanel({ monthKey }: { monthKey: string }) {
  const [replyText, setReplyText] = useState("");
  const [pending, setPending] = useState<LetterReplyResponse | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const send = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/founder/intelligence/letter/${monthKey}/reply`, {
        replyText: replyText.trim(),
      });
      return (await res.json()) as LetterReplyResponse;
    },
    onSuccess: (data) => {
      setPending(data);
      // The pending card also lands in the decisions inbox (same row).
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/decisions-inbox"] });
    },
    onError: (e: Error) =>
      toast({
        title: "Couldn't send your reply",
        description: `${e.message}. Nothing was stored — try again in a moment.`,
        variant: "destructive",
      }),
  });

  const confirm = useMutation({
    mutationFn: async (chosenOption: string) => {
      const res = await apiRequest(
        "POST",
        `/api/founder/intelligence/letter/reply/${pending!.itemId}/confirm`,
        { chosenOption },
      );
      return (await res.json()) as { outcome: string };
    },
    onSuccess: (data) => {
      toast({ title: CONFIRM_TOASTS[data.outcome] ?? "Done" });
      setPending(null);
      setReplyText("");
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/decisions-inbox"] });
    },
    onError: (e: Error) =>
      toast({
        title: "Couldn't confirm",
        description: `${e.message}. The card is still pending — try again or discard it.`,
        variant: "destructive",
      }),
  });

  const canSend = replyText.trim().length >= 3 && replyText.trim().length <= 2000;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Reply to Solene</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {pending == null ? (
          <>
            <label htmlFor="letter-reply-text" className="sr-only">
              Your reply to the {monthKey} letter
            </label>
            <Textarea
              id="letter-reply-text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Answer the decision, set a rule, or hand off a task — plain language is fine."
              maxLength={2000}
              rows={3}
              disabled={send.isPending}
              data-testid="letter-reply-textarea"
            />
            {send.isPending ? (
              <div className="space-y-2" role="status" aria-live="polite">
                <span className="sr-only">Reading your reply…</span>
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  You'll see what I understood before anything is stored.
                </p>
                <Button
                  type="button"
                  size="sm"
                  disabled={!canSend}
                  onClick={() => send.mutate()}
                  data-testid="letter-reply-send"
                >
                  <Send className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                  Send
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3" data-testid="letter-reply-parse-card">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{KIND_LABELS[pending.parse.kind]}</Badge>
              <span className="text-xs text-muted-foreground tabular-nums">
                {Math.round(pending.parse.confidence * 100)}% confident
              </span>
            </div>
            <p className="text-sm text-foreground leading-relaxed">{pending.parse.restatement}</p>
            <p className="text-xs text-muted-foreground">
              Nothing is stored until you confirm below.
            </p>
            <div className="flex flex-col gap-2 pt-1">
              {pending.options.map((opt) => (
                <Button
                  key={opt.key}
                  type="button"
                  variant={opt.key === "discard" ? "outline" : "default"}
                  className="w-full min-h-11 justify-center whitespace-normal"
                  disabled={confirm.isPending}
                  aria-busy={confirm.isPending}
                  onClick={() => confirm.mutate(opt.key)}
                  data-testid={`letter-reply-option-${opt.key}`}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function FounderLetterPage() {
  useDocumentTitle("Founder letter");
  const [selectedMonth, setSelectedMonth] = useState<string | undefined>(undefined);
  const { data, isLoading, isError, error, refetch } = useCurrentLetter(selectedMonth);
  const archive = useArchive();
  const qc = useQueryClient();
  const { toast } = useToast();

  const generate = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/founder/intelligence/letter/generate", {});
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/letter/current"] });
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/letter/archive"] });
      toast({ title: "Letter generated", description: "Fresh content loaded." });
    },
    onError: (e: Error) =>
      toast({
        title: "Couldn't generate letter",
        description: `${e.message}. Your previous letter (if any) is unchanged — try again in a moment.`,
        variant: "destructive",
      }),
  });

  const markDelivered = useMutation({
    mutationFn: async (monthKey: string) => {
      const res = await apiRequest("POST", `/api/founder/intelligence/letter/${monthKey}/mark-delivered`, {});
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/letter/current"] });
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/letter/archive"] });
    },
    onError: () =>
      toast({
        title: "Couldn't mark letter as read",
        description: "The letter status is unchanged. Try again in a moment.",
        variant: "destructive",
      }),
  });

  const letter = data?.letter ?? null;

  return (
    <PageShell label="Founder Letter">
      <div className="grid gap-6 lg:grid-cols-[1fr_280px] max-w-6xl mx-auto">
        <div className="space-y-4">
          {isLoading ? (
            <Card>
              <CardContent className="p-8 space-y-3" role="status" aria-live="polite">
                <span className="sr-only">Loading founder letter…</span>
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-10/12" />
              </CardContent>
            </Card>
          ) : isError ? (
            <FounderAuthError
              error={error instanceof Error ? error : new Error("Couldn't load the letter")}
              title="Couldn't load the letter"
              onRetry={() => void refetch()}
            />
          ) : !letter ? (
            <EmptyState
              icon={FileText}
              headline="No letter yet"
              subtitle="The first letter will be generated on the 1st of next month. You can also generate one on demand from the current data."
              cta={{
                label: generate.isPending ? "Generating…" : "Generate now",
                onClick: () => generate.mutate(),
                "data-testid": "button-generate-letter",
              }}
              actionIcon={null}
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Badge variant={letter.status === "delivered" ? "secondary" : "default"} className="capitalize">
                    {letter.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Generated {format(new Date(letter.generatedAt), "MMM d, yyyy h:mm a")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => generate.mutate()}
                    disabled={generate.isPending}
                    variant="ghost"
                    size="sm"
                    data-testid="button-regenerate-letter"
                    aria-label={`Regenerate letter for ${letter.monthKey}`}
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${generate.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
                    {generate.isPending ? "Regenerating…" : "Regenerate"}
                  </Button>
                  {letter.status !== "delivered" && (
                    <Button
                      onClick={() => markDelivered.mutate(letter.monthKey)}
                      disabled={markDelivered.isPending}
                      variant="outline"
                      size="sm"
                      data-testid="button-mark-delivered"
                      aria-label={`Mark ${letter.monthKey} letter as read`}
                    >
                      <Check className="h-4 w-4 mr-2" aria-hidden="true" />
                      Read
                    </Button>
                  )}
                </div>
              </div>

              <Card>
                <CardContent className="p-8 prose prose-neutral dark:prose-invert max-w-none">
                  {renderMarkdown(letter.letterMarkdown)}
                </CardContent>
              </Card>

              {letter.pendingFounderDecision && (
                <Card className="bg-acr-warn-soft dark:bg-acr-warn-soft/20 border-acr-warn-soft dark:border-acr-warn-soft" role="region" aria-label="Founder decision required">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base text-acr-warn dark:text-acr-warn">
                      The one thing I need from you
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-acr-warn dark:text-acr-warn">
                      {letter.pendingFounderDecision}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Horizon A3 — reply to the letter; keyed so switching
                  months resets the draft + any pending parse card. */}
              <LetterReplyPanel key={letter.monthKey} monthKey={letter.monthKey} />
            </>
          )}
        </div>

        <aside className="space-y-3" aria-label="Letter archive">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Archive className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Archive
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              {archive.isLoading ? (
                <div role="status" aria-live="polite">
                  <span className="sr-only">Loading archive…</span>
                  <Skeleton className="h-4 w-full" />
                </div>
              ) : archive.data?.letters.length === 0 ? (
                <p className="text-xs text-muted-foreground">No previous letters yet.</p>
              ) : (
                <ol className="space-y-1" aria-label="Previous founder letters, newest first">
                  {archive.data?.letters.map((row) => {
                    const isSelected = selectedMonth === row.monthKey;
                    return (
                      <li key={row.monthKey}>
                        <button
                          type="button"
                          onClick={() => setSelectedMonth(isSelected ? undefined : row.monthKey)}
                          className={`w-full text-left p-2 rounded text-xs hover:bg-muted/60 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isSelected ? "bg-muted" : ""}`}
                          aria-pressed={isSelected}
                          aria-label={`${isSelected ? "Hide" : "View"} ${row.monthKey} letter`}
                          data-testid={`archive-${row.monthKey}`}
                        >
                          <div className="font-medium text-foreground tabular-nums">{row.monthKey}</div>
                          <div className="text-caption text-muted-foreground">
                            <span className="capitalize">{row.status}</span>
                            {row.deliveredAt ? <> · read <span className="tabular-nums">{format(new Date(row.deliveredAt), "MMM d")}</span></> : ""}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </PageShell>
  );
}
