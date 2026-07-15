/**
 * NativeMailPanel — the native business-inbox surface (R1c, slices 2-3).
 *
 * Self-contained: fetches its own data and manages its own state so it can be
 * dropped into the Inbox door's "Mail" tab (mirroring TeamChatPanel). It reads
 * and sends through the customer's Clerk-linked Gmail / Outlook ON-DEMAND — no
 * message body is ever persisted client- or server-side. Renders NO page chrome
 * (no Sidebar, no PageShell, no document title).
 *
 * Two panes: a mailbox picker + message list on the left, a reading pane +
 * reply composer on the right. Empty state (no mailbox connected) links to the
 * connectors hub at /settings/byok.
 */

import { useEffect, useId, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DOMPurify from "isomorphic-dompurify";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/empty-state";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Mail, Send, Loader2, ArrowLeft, Search, Settings2, RefreshCw } from "lucide-react";
import { relative } from "@/lib/format";
import { Verbs } from "@/lib/labels";

// ── Types (mirror the mailboxClient normalized shapes) ──────────────────────

interface MailboxRow {
  id: number;
  provider: string;
  emailAddress: string;
  status: string;
  settings?: MailboxSettings | null;
}

interface MailboxSettings {
  signature?: string;
  aiReplyTone?: string;
  showLabels?: boolean;
}

interface NormalizedMessage {
  id: string;
  threadId: string;
  from: string;
  fromName: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
}

interface FullMessage extends NormalizedMessage {
  bodyHtml?: string;
  bodyText?: string;
  to?: string;
}

const AI_TONES = ["professional", "friendly", "concise", "warm", "direct"] as const;

function initials(name?: string, email?: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(" ");
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return (email?.[0] ?? "?").toUpperCase();
}

// ── Fine-tuning dialog ──────────────────────────────────────────────────────

function MailboxSettingsDialog({ mailbox }: { mailbox: MailboxRow }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [signature, setSignature] = useState(mailbox.settings?.signature ?? "");
  const [tone, setTone] = useState(mailbox.settings?.aiReplyTone ?? "professional");
  const sigId = useId();

  // Re-seed local state when the dialog opens against the current row.
  useEffect(() => {
    if (open) {
      setSignature(mailbox.settings?.signature ?? "");
      setTone(mailbox.settings?.aiReplyTone ?? "professional");
    }
  }, [open, mailbox]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/mailbox/${mailbox.id}/settings`, {
        signature,
        aiReplyTone: tone,
      });
      if (!res.ok) throw new Error("save failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/mailbox"] });
      toast({ title: "Mailbox settings saved" });
      setOpen(false);
    },
    onError: () => toast({ title: "Couldn't save settings", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Fine-tune ${mailbox.emailAddress}`}
          data-testid="button-mailbox-settings"
        >
          <Settings2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Fine-tune {mailbox.emailAddress}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={sigId}>Signature</Label>
            <Textarea
              id={sigId}
              rows={3}
              placeholder="— Sent from AcreOS"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              data-testid="input-mailbox-signature"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mailbox-tone">AI reply tone</Label>
            <Select value={tone} onValueChange={setTone}>
              <SelectTrigger id="mailbox-tone" data-testid="select-mailbox-tone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AI_TONES.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            data-testid="button-save-mailbox-settings"
          >
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {Verbs.SAVE}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Reading pane + reply composer ───────────────────────────────────────────

function MessageReader({
  mailboxId,
  selected,
  onBack,
}: {
  mailboxId: number;
  selected: NormalizedMessage;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [replyText, setReplyText] = useState("");
  const [showReply, setShowReply] = useState(false);

  const { data, isLoading, isError } = useQuery<{ message: FullMessage }>({
    queryKey: ["/api/mailbox", mailboxId, "messages", selected.id],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/mailbox/${mailboxId}/messages/${encodeURIComponent(selected.id)}`,
      );
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const full = data?.message;

  // allow-no-invalidation: on-demand send — nothing is cached to go stale; the
  // list refetches live and the reply is delivered straight from the mailbox.
  const send = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/mailbox/${mailboxId}/send`, {
        to: selected.from,
        subject: selected.subject ? `Re: ${selected.subject}` : "",
        body: `<p>${replyText.replace(/\n/g, "<br>")}</p>`,
        inReplyTo: selected.id,
        threadId: selected.threadId,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || "Couldn't send");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Reply sent", description: "Sent from your own mailbox." });
      setReplyText("");
      setShowReply(false);
    },
    onError: (err) =>
      toast({
        title: "Couldn't send reply",
        description: err instanceof Error ? err.message : "Try again in a moment.",
        variant: "destructive",
      }),
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-4 border-b flex-wrap">
        <Button
          size="icon"
          variant="ghost"
          onClick={onBack}
          className="md:hidden"
          aria-label="Back to message list"
          data-testid="button-mail-back"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="text-xs">
              {initials(selected.fromName, selected.from)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="font-medium truncate">{selected.fromName || selected.from}</div>
            <div className="text-xs text-muted-foreground truncate">{selected.from}</div>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => setShowReply((v) => !v)}
          data-testid="button-mail-reply"
          aria-expanded={showReply}
        >
          <Send className="h-4 w-4 mr-1" aria-hidden="true" />
          Reply
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <h2 className="text-section-h2">{selected.subject || "(No subject)"}</h2>
          {isLoading ? (
            <div className="space-y-2" role="status" aria-live="polite">
              <span className="sr-only">Loading message…</span>
              <Skeleton announce={false} className="h-4 w-3/4" />
              <Skeleton announce={false} className="h-4 w-full" />
              <Skeleton announce={false} className="h-4 w-5/6" />
            </div>
          ) : isError ? (
            <p className="text-sm text-acr-warn" role="alert">
              Couldn't load this message. It stays safe in your mailbox — try selecting it again.
            </p>
          ) : full?.bodyHtml ? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(full.bodyHtml) }}
            />
          ) : (
            <div className="whitespace-pre-wrap text-sm">
              {full?.bodyText || selected.snippet || "(No content)"}
            </div>
          )}

          {showReply && (
            <div className="border-t pt-4 space-y-3">
              <Label htmlFor="mail-reply" className="sr-only">
                Reply to {selected.from}
              </Label>
              <Textarea
                id="mail-reply"
                placeholder="Type your reply…"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                rows={5}
                autoCapitalize="sentences"
                data-testid="input-mail-reply"
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowReply(false);
                    setReplyText("");
                  }}
                  data-testid="button-mail-cancel-reply"
                >
                  {Verbs.CANCEL}
                </Button>
                <Button
                  onClick={() => send.mutate()}
                  disabled={!replyText.trim() || send.isPending}
                  data-testid="button-mail-send-reply"
                >
                  {send.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="h-4 w-4 mr-1" aria-hidden="true" />
                  )}
                  Send
                </Button>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

export function NativeMailPanel() {
  const [activeMailboxId, setActiveMailboxId] = useState<number | null>(null);
  const [selected, setSelected] = useState<NormalizedMessage | null>(null);
  const [search, setSearch] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  const { data: mailboxData, isLoading: mailboxesLoading } = useQuery<{
    mailboxes: MailboxRow[];
  }>({
    queryKey: ["/api/mailbox"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/mailbox");
      return res.json();
    },
  });

  const mailboxes = useMemo(() => mailboxData?.mailboxes ?? [], [mailboxData]);

  // Auto-select the first connected mailbox.
  useEffect(() => {
    if (activeMailboxId === null && mailboxes.length > 0) {
      setActiveMailboxId(mailboxes[0].id);
    }
  }, [mailboxes, activeMailboxId]);

  const activeMailbox = mailboxes.find((m) => m.id === activeMailboxId) ?? null;

  const {
    data: listData,
    isLoading: listLoading,
    isError: listError,
    isFetching: listFetching,
    refetch,
  } = useQuery<{ messages: NormalizedMessage[]; nextPageToken?: string }>({
    queryKey: ["/api/mailbox", activeMailboxId, "messages", submittedQuery],
    enabled: activeMailboxId !== null,
    queryFn: async () => {
      const qs = submittedQuery ? `?q=${encodeURIComponent(submittedQuery)}` : "";
      const res = await apiRequest("GET", `/api/mailbox/${activeMailboxId}/messages${qs}`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const messages = listData?.messages ?? [];

  // No mailbox connected → agency empty state pointing at the connectors hub.
  if (!mailboxesLoading && mailboxes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <EmptyState
          icon={Mail}
          headline="Connect your business inbox"
          subtitle="Link your own Gmail or Outlook and AcreOS becomes the intelligent inbox over it — your account, your mail, no copy kept here."
          cta={{
            label: "Connect a mailbox",
            href: "/settings/byok",
            "data-testid": "native-mail-connect",
          }}
          actionIcon={null}
          testId="native-mail-empty"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden min-h-0" data-testid="native-mail-panel">
      {/* ── Left: mailbox picker + message list ── */}
      <div className={`${selected ? "hidden md:flex" : "flex"} w-full md:w-96 border-r flex-col min-h-0`}>
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center gap-2">
            {mailboxesLoading ? (
              <Skeleton className="h-9 flex-1" />
            ) : (
              <Select
                value={activeMailboxId ? String(activeMailboxId) : undefined}
                onValueChange={(v) => {
                  setActiveMailboxId(Number(v));
                  setSelected(null);
                }}
              >
                <SelectTrigger className="flex-1" data-testid="select-active-mailbox" aria-label="Choose mailbox">
                  <SelectValue placeholder="Choose a mailbox" />
                </SelectTrigger>
                <SelectContent>
                  {mailboxes.map((mb) => (
                    <SelectItem key={mb.id} value={String(mb.id)}>
                      {mb.emailAddress}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {activeMailbox && <MailboxSettingsDialog mailbox={activeMailbox} />}
            <Button
              size="icon"
              variant="ghost"
              aria-label="Refresh messages"
              onClick={() => refetch()}
              disabled={listFetching}
              data-testid="button-mail-refresh"
            >
              <RefreshCw className={`h-4 w-4 ${listFetching ? "animate-spin" : ""}`} aria-hidden="true" />
            </Button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSubmittedQuery(search.trim());
            }}
            className="relative"
          >
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              placeholder="Search this mailbox…"
              aria-label="Search mailbox"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              data-testid="input-mail-search"
            />
          </form>
        </div>

        <ScrollArea className="flex-1">
          {listLoading ? (
            <div className="p-3 space-y-3" role="status" aria-live="polite">
              <span className="sr-only">Loading messages…</span>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton announce={false} className="h-9 w-9 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton announce={false} className="h-3.5 w-1/2" />
                    <Skeleton announce={false} className="h-3 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : listError ? (
            <div className="p-6 text-center">
              <p className="text-sm text-acr-warn mb-3" role="alert">
                Couldn't reach this mailbox right now.
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-mail-retry">
                <RefreshCw className="h-4 w-4 mr-1" aria-hidden="true" />
                Try again
              </Button>
            </div>
          ) : messages.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {submittedQuery ? "No messages match your search." : "No messages in this mailbox."}
            </div>
          ) : (
            <ul className="list-none p-0 m-0" role="list" aria-label="Messages">
              {messages.map((msg) => (
                <li key={msg.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-current={selected?.id === msg.id ? "true" : undefined}
                    onClick={() => setSelected(msg)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(msg);
                      }
                    }}
                    className={`flex items-start gap-3 p-3 cursor-pointer border-b transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                      selected?.id === msg.id
                        ? "bg-[color:var(--acr-brand-soft)]"
                        : "hover:bg-[color:var(--acr-surface-2)]"
                    }`}
                    data-testid={`native-mail-row-${msg.id}`}
                  >
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarFallback className="text-xs">
                        {initials(msg.fromName, msg.from)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-sm truncate ${msg.unread ? "font-semibold text-[color:var(--acr-ink)]" : "text-[color:var(--acr-ink-2)]"}`}
                        >
                          {msg.fromName || msg.from}
                        </span>
                        <span className="text-xs text-[color:var(--acr-ink-3)] shrink-0 tabular-nums">
                          {relative(msg.date)}
                        </span>
                      </div>
                      <div
                        className={`text-sm truncate ${msg.unread ? "font-medium text-[color:var(--acr-ink)]" : "text-[color:var(--acr-ink-3)]"}`}
                      >
                        {msg.subject || "(No subject)"}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{msg.snippet}</div>
                      {msg.unread && (
                        <Badge variant="secondary" className="mt-1 text-xs">
                          Unread
                        </Badge>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </div>

      {/* ── Right: reading pane ── */}
      <div className={`${selected ? "flex" : "hidden md:flex"} flex-1 flex-col min-w-0`}>
        {selected && activeMailboxId !== null ? (
          <MessageReader
            mailboxId={activeMailboxId}
            selected={selected}
            onBack={() => setSelected(null)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center p-4">
            <EmptyState
              icon={Mail}
              headline="Select a message"
              subtitle="Choose a message from the list to read and reply here."
              cta={{ label: "", _noOp: true }}
              testId="native-mail-select-prompt"
            />
          </div>
        )}
      </div>
    </div>
  );
}
