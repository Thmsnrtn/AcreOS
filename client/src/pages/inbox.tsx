import DOMPurify from "isomorphic-dompurify";
import { Sidebar, useSidebarCollapsed } from "@/components/layout-sidebar";
import "./today.css";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, fetchJsonArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo, useEffect } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { InboxMessage, Lead, Conversation, Message } from "@shared/schema";
import { format } from "date-fns";
import { ProviderReadinessBanner, ProviderStatusIndicator } from "@/components/provider-readiness-banner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { ClearedEmpty, EmptyFilter } from "@/components/empty-states";
import { ListSkeleton } from "@/components/list-skeleton";
import { ContentReveal } from "@/components/ContentReveal";
import {
  Search,
  Mail,
  Star,
  Archive,
  ArrowLeft,
  Send,
  MailOpen,
  Loader2,
  User,
  ExternalLink,
  MessageSquare,
  Phone,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { Link } from "wouter";

type ChannelFilter = "all" | "email" | "sms";
type StatusFilter = "all" | "unread" | "starred" | "archived";

type UnifiedItem = {
  type: "email";
  data: InboxMessage;
  timestamp: Date;
} | {
  type: "sms";
  data: Conversation;
  timestamp: Date;
};

function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  if (email) {
    return email.slice(0, 2).toUpperCase();
  }
  return "??";
}

function formatMessageDate(date: Date | string | null): string {
  if (!date) return "";
  const d = new Date(date);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return format(d, "h:mm a");
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return format(d, "EEEE");
  } else {
    return format(d, "MMM d");
  }
}

function ChannelBadge({ channel }: { channel: "email" | "sms" }) {
  if (channel === "sms") {
    return (
      <Badge variant="outline" className="text-xs flex items-center gap-1" data-testid="badge-channel-sms">
        <Phone className="h-3 w-3" aria-hidden="true" />
        SMS
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs flex items-center gap-1" data-testid="badge-channel-email">
      <Mail className="h-3 w-3" aria-hidden="true" />
      Email
    </Badge>
  );
}

function handleRowKeyDown(e: React.KeyboardEvent, onSelect: () => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    onSelect();
  }
}

function EmailMessageRow({
  message,
  isSelected,
  onSelect,
  leadName
}: {
  message: InboxMessage;
  isSelected: boolean;
  onSelect: () => void;
  leadName?: string;
}) {
  const { toast } = useToast();
  const starMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inbox/${message.id}/star`);
      return res.json();
    },
    // Optimistic toggle: flip isStarred across every cached inbox list immediately.
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["/api/inbox"] });
      const snapshots: Array<[readonly unknown[], unknown]> = [];
      const entries = queryClient.getQueriesData({ queryKey: ["/api/inbox"] });
      for (const [key, value] of entries) {
        snapshots.push([key, value]);
        if (Array.isArray(value)) {
          queryClient.setQueryData(key, value.map((m: any) =>
            m?.id === message.id ? { ...m, isStarred: !m.isStarred } : m
          ));
        }
      }
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshots) {
        for (const [key, value] of context.snapshots) {
          queryClient.setQueryData(key, value);
        }
      }
      toast({
        title: message.isStarred ? "Couldn't unstar message" : "Couldn't star message",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
    },
  });

  const senderLabel = message.senderName || message.senderEmail || "Unknown sender";
  const subjectLabel = message.subject || "(No subject)";
  const rowAriaLabel = `${message.isRead ? "Read" : "Unread"} email from ${senderLabel}: ${subjectLabel}`;

  return (
    <div
      data-testid={`inbox-message-row-${message.id}`}
      role="button"
      tabIndex={0}
      aria-label={rowAriaLabel}
      aria-current={isSelected ? "true" : undefined}
      onClick={onSelect}
      onKeyDown={(e) => handleRowKeyDown(e, onSelect)}
      className={`flex items-start gap-3 p-3 cursor-pointer border-b transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
        isSelected
          ? "bg-accent"
          : message.isRead
            ? "hover-elevate"
            : "bg-accent/30 hover-elevate"
      }`}
    >
      <Avatar className="h-9 w-9 flex-shrink-0">
        <AvatarFallback className="text-xs">
          {getInitials(message.senderName, message.senderEmail)}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm truncate ${!message.isRead ? "font-semibold" : ""}`}>
            {senderLabel}
          </span>
          <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">
            {formatMessageDate(message.receivedAt)}
          </span>
        </div>

        <div className={`text-sm truncate ${!message.isRead ? "font-medium" : "text-muted-foreground"}`}>
          {subjectLabel}
        </div>

        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <ChannelBadge channel="email" />
          {leadName && (
            <Badge variant="secondary" className="text-xs">
              {leadName}
            </Badge>
          )}
          {!message.isRead && (
            <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" aria-hidden="true" />
          )}
        </div>
      </div>

      <Button
        size="icon"
        variant="ghost"
        data-testid={`button-star-email-${message.id}`}
        onClick={(e) => {
          e.stopPropagation();
          starMutation.mutate();
        }}
        disabled={starMutation.isPending}
        className={message.isStarred ? "text-yellow-500" : "text-muted-foreground"}
        aria-label={message.isStarred ? `Unstar email from ${senderLabel}` : `Star email from ${senderLabel}`}
      >
        <Star className={`h-4 w-4 ${message.isStarred ? "fill-current" : ""}`} aria-hidden="true" />
      </Button>
    </div>
  );
}

function SMSConversationRow({
  conversation,
  isSelected,
  onSelect,
  lead
}: {
  conversation: Conversation;
  isSelected: boolean;
  onSelect: () => void;
  lead?: Lead;
}) {
  const leadName = lead ? `${lead.firstName} ${lead.lastName}` : undefined;
  const contactLabel = leadName || lead?.phone || "Unknown";
  const rowAriaLabel = `SMS conversation with ${contactLabel}`;

  return (
    <div
      data-testid={`sms-conversation-row-${conversation.id}`}
      role="button"
      tabIndex={0}
      aria-label={rowAriaLabel}
      aria-current={isSelected ? "true" : undefined}
      onClick={onSelect}
      onKeyDown={(e) => handleRowKeyDown(e, onSelect)}
      className={`flex items-start gap-3 p-3 cursor-pointer border-b transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
        isSelected ? "bg-accent" : "hover-elevate"
      }`}
    >
      <Avatar className="h-9 w-9 flex-shrink-0">
        <AvatarFallback className="text-xs">
          {getInitials(leadName, lead?.phone)}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm truncate font-medium">
            {contactLabel}
          </span>
          <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">
            {formatMessageDate(conversation.lastMessageAt)}
          </span>
        </div>

        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <ChannelBadge channel="sms" />
          {lead?.phone && (
            <Badge variant="secondary" className="text-xs tabular-nums">
              {lead.phone}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

function EmailMessageDetail({ 
  message,
  lead,
  onBack
}: { 
  message: InboxMessage;
  lead?: Lead;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [replyText, setReplyText] = useState("");
  const [showReply, setShowReply] = useState(false);
  const [pendingArchive, setPendingArchive] = useState(false);
  // Pax draft state (product-call #10). attribution shown above the
  // textarea once a draft lands; null when the user is composing manually.
  const [paxAttribution, setPaxAttribution] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const draftReplyMutation = useMutation({
    mutationFn: async (priorDraft?: string) => {
      const res = await apiRequest("POST", "/api/ai/draft-reply", {
        messageId: message.id,
        priorDraft,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || "Couldn't draft a reply");
      }
      return res.json() as Promise<{ draft: string; attribution: string; model: string }>;
    },
    onSuccess: (data) => {
      setReplyText(data.draft);
      setPaxAttribution(data.attribution);
      setDraftError(null);
    },
    onError: (err) => {
      setDraftError(err instanceof Error ? err.message : "Couldn't draft a reply");
    },
  });

  // Auto-trigger a draft the first time the user opens the reply panel.
  // Subsequent opens (e.g. after Cancel + Reply) don't re-trigger so the
  // user's prior draft is preserved.
  const [hasAutoDrafted, setHasAutoDrafted] = useState(false);
  useEffect(() => {
    if (showReply && !hasAutoDrafted && !replyText) {
      setHasAutoDrafted(true);
      draftReplyMutation.mutate(undefined);
    }
  }, [showReply, hasAutoDrafted, replyText, draftReplyMutation]);

  const markReadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inbox/${message.id}/read`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/unread-count"] });
    },
    onError: () => {
      toast({
        title: "Couldn't mark as read",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const markUnreadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inbox/${message.id}/unread`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/unread-count"] });
    },
    onError: () => {
      toast({
        title: "Couldn't mark as unread",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const starMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inbox/${message.id}/star`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
    },
    onError: () => {
      toast({
        title: message.isStarred ? "Couldn't unstar message" : "Couldn't star message",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inbox/${message.id}/archive`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/unread-count"] });
      toast({
        title: "Message archived",
        description: "The message has been moved to archive.",
      });
      onBack();
    },
    onError: () => {
      toast({
        title: "Couldn't archive message",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const sendReplyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/send-email", {
        to: message.senderEmail,
        subject: `Re: ${message.subject || "(No subject)"}`,
        text: replyText,
        html: `<p>${replyText.replace(/\n/g, "<br>")}</p>`,
        inReplyToMessageId: message.messageId,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Reply sent",
        description: "Your reply has been sent successfully.",
      });
      setReplyText("");
      setShowReply(false);
    },
    onError: () => {
      toast({
        title: "Couldn't send reply",
        description: "Your draft is preserved. Try again or check the email provider status.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-4 border-b flex-wrap">
        <Button
          size="icon"
          variant="ghost"
          onClick={onBack}
          className="md:hidden"
          aria-label="Back to inbox"
          data-testid="button-back-to-list"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>

        <div className="flex items-center gap-2 flex-wrap flex-1">
          <ChannelBadge channel="email" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => message.isRead ? markUnreadMutation.mutate() : markReadMutation.mutate()}
            disabled={markReadMutation.isPending || markUnreadMutation.isPending}
            data-testid="button-toggle-read"
            aria-pressed={!message.isRead}
          >
            {markReadMutation.isPending || markUnreadMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" />
            ) : message.isRead ? (
              <Mail className="h-4 w-4 mr-1" aria-hidden="true" />
            ) : (
              <MailOpen className="h-4 w-4 mr-1" aria-hidden="true" />
            )}
            {message.isRead ? "Mark unread" : "Mark read"}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => starMutation.mutate()}
            disabled={starMutation.isPending}
            data-testid="button-star-message"
            aria-pressed={!!message.isStarred}
            className={message.isStarred ? "text-yellow-500" : ""}
          >
            <Star className={`h-4 w-4 mr-1 ${message.isStarred ? "fill-current" : ""}`} aria-hidden="true" />
            {message.isStarred ? "Unstar" : "Star"}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setPendingArchive(true)}
            disabled={archiveMutation.isPending}
            data-testid="button-archive-message"
            aria-label={`Archive email: ${message.subject || "(No subject)"}`}
          >
            {archiveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" />
            ) : (
              <Archive className="h-4 w-4 mr-1" aria-hidden="true" />
            )}
            Archive
          </Button>

          <Button
            size="sm"
            onClick={() => setShowReply(!showReply)}
            data-testid="button-reply"
            aria-expanded={showReply}
            aria-controls="inbox-reply-panel"
            data-tour="inbox-ai-draft"
          >
            <Send className="h-4 w-4 mr-1" aria-hidden="true" />
            Reply
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <div className="flex items-start gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback>
                {getInitials(message.senderName, message.senderEmail)}
              </AvatarFallback>
            </Avatar>
            
            <div className="flex-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="font-medium">
                    {message.senderName || message.senderEmail}
                  </div>
                  {message.senderEmail && (
                    <a
                      href={`mailto:${message.senderEmail}`}
                      className="text-sm text-muted-foreground hover:underline"
                    >
                      {message.senderEmail}
                    </a>
                  )}
                </div>
                <div className="text-sm text-muted-foreground tabular-nums">
                  {message.receivedAt && (
                    <time dateTime={new Date(message.receivedAt).toISOString()}>
                      {format(new Date(message.receivedAt), "PPpp")}
                    </time>
                  )}
                </div>
              </div>

              {lead && (
                <Link
                  href={`/leads?id=${lead.id}`}
                  className="inline-flex items-center gap-1 mt-2 text-sm text-primary hover:underline focus-visible:underline"
                  data-testid="link-to-lead"
                  aria-label={`View lead ${lead.firstName} ${lead.lastName}`}
                >
                  <User className="h-3 w-3" aria-hidden="true" />
                  {lead.firstName} {lead.lastName}
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </Link>
              )}
            </div>
          </div>

          <div className="border-t pt-4">
            <h2 className="text-lg font-semibold mb-4">
              {message.subject || "(No subject)"}
            </h2>
            
            {message.bodyHtml ? (
              <div 
                className="prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(message.bodyHtml) }}
              />
            ) : (
              <div className="whitespace-pre-wrap text-sm">
                {message.bodyText || "(No content)"}
              </div>
            )}
          </div>

          {showReply && (
            <Card className="mt-4 rounded-card" id="inbox-reply-panel">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">Reply to {message.senderName || message.senderEmail}</CardTitle>
                  <ProviderStatusIndicator channel="email" />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <ProviderReadinessBanner channel="email" compact />

                {/* Pax draft attribution — only shown after the autodraft
                    lands. User can keep the draft, edit it, or regenerate. */}
                {paxAttribution && !draftReplyMutation.isPending && (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-acr-brand-soft text-acr-brand text-xs">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      {paxAttribution}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs hover:bg-acr-brand/15"
                      onClick={() => draftReplyMutation.mutate(replyText || undefined)}
                      disabled={draftReplyMutation.isPending}
                      data-testid="button-regenerate-draft"
                      aria-label="Regenerate Pax draft"
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                      Regenerate
                    </Button>
                  </div>
                )}

                {draftReplyMutation.isPending && !replyText && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted text-muted-foreground text-xs">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Pax is drafting a reply…
                  </div>
                )}

                {draftError && !replyText && (
                  <p className="text-xs text-acr-warn">
                    {draftError}. You can still write a reply manually below.
                  </p>
                )}

                <Textarea
                  placeholder="Type your reply…"
                  aria-label="Reply message"
                  value={replyText}
                  onChange={(e) => {
                    setReplyText(e.target.value);
                    // Once the user edits, the draft is theirs — drop the Pax
                    // attribution so they don't feel like they're sending an
                    // AI reply when in fact they reshaped it.
                    if (paxAttribution) setPaxAttribution(null);
                  }}
                  rows={5}
                  autoCapitalize="sentences"
                  data-testid="input-reply-text"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowReply(false);
                      setPaxAttribution(null);
                      setHasAutoDrafted(false);
                      setReplyText("");
                    }}
                    data-testid="button-cancel-reply"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => sendReplyMutation.mutate()}
                    disabled={!replyText.trim() || sendReplyMutation.isPending}
                    data-testid="button-send-reply"
                  >
                    {sendReplyMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" />
                    ) : (
                      <Send className="h-4 w-4 mr-1" aria-hidden="true" />
                    )}
                    Send
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>

      <ConfirmDialog
        open={pendingArchive}
        onOpenChange={(open) => { if (!open) setPendingArchive(false); }}
        title={`Archive email: "${message.subject || "(No subject)"}"?`}
        description="The email moves to your Archived tab. You can restore it later by switching to that tab and unstarring/replying — nothing is permanently deleted."
        confirmLabel="Archive email"
        onConfirm={() => {
          archiveMutation.mutate();
          setPendingArchive(false);
        }}
        isLoading={archiveMutation.isPending}
      />
    </div>
  );
}

function SMSConversationDetail({ 
  conversation,
  lead,
  onBack
}: { 
  conversation: Conversation;
  lead?: Lead;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [newMessage, setNewMessage] = useState("");

  const { data: messages = [], isLoading: isLoadingMessages, isError: isMessagesError } = useQuery<Message[]>({
    queryKey: ["/api/conversations", conversation.id, "messages"],
  });

  useEffect(() => {
    if (isMessagesError) {
      toast({
        title: "Couldn't load messages",
        description: "Check your connection and try again.",
        variant: "destructive",
      });
    }
  }, [isMessagesError, toast]);

  const sendSmsMutation = useMutation({
    mutationFn: async () => {
      if (!lead?.id) throw new Error("No lead associated with this conversation");
      const res = await apiRequest("POST", `/api/leads/${lead.id}/sms`, {
        message: newMessage,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "SMS sent",
        description: "Your message has been sent successfully.",
      });
      setNewMessage("");
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversation.id, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't send SMS",
        description: `${error.message || "Network error"} — your message draft is preserved. Try again or check the SMS provider status.`,
        variant: "destructive",
      });
    },
  });

  const leadName = lead ? `${lead.firstName} ${lead.lastName}` : "Unknown";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-4 border-b flex-wrap">
        <Button
          size="icon"
          variant="ghost"
          onClick={onBack}
          className="md:hidden"
          aria-label="Back to inbox"
          data-testid="button-back-to-list-sms"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>

        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Avatar className="h-10 w-10">
            <AvatarFallback>
              {getInitials(leadName, lead?.phone)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="font-medium flex items-center gap-2 flex-wrap">
              {leadName}
              <ChannelBadge channel="sms" />
            </div>
            {lead?.phone ? (
              <a
                href={`tel:${lead.phone}`}
                className="text-sm text-muted-foreground hover:underline tabular-nums"
              >
                {lead.phone}
              </a>
            ) : (
              <div className="text-sm text-muted-foreground">No phone number</div>
            )}
          </div>
        </div>

        {lead && (
          <Link
            href={`/leads?id=${lead.id}`}
            data-testid="link-to-lead-sms"
            aria-label={`View lead ${leadName}`}
          >
            <Button size="sm" variant="outline">
              <User className="h-4 w-4 mr-1" aria-hidden="true" />
              View lead
            </Button>
          </Link>
        )}
      </div>

      <ScrollArea className="flex-1 p-4">
        {isLoadingMessages ? (
          <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Loading messages…</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-center">
            <MessageSquare className="h-12 w-12 mb-2 opacity-50" aria-hidden="true" />
            <p>No messages yet</p>
            <p className="text-sm">Send a message to start the conversation.</p>
          </div>
        ) : (
          <div
            className="space-y-4"
            role="log"
            aria-label={`SMS conversation with ${leadName}`}
            aria-live="polite"
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                data-testid={`sms-message-${msg.id}`}
                className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] p-3 rounded-lg ${
                    msg.direction === "outbound"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  <p className={`text-xs mt-1 tabular-nums ${
                    msg.direction === "outbound" ? "text-primary-foreground/70" : "text-muted-foreground"
                  }`}>
                    <span className="sr-only">{msg.direction === "outbound" ? "Sent " : "Received "}</span>
                    {formatMessageDate(msg.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="border-t p-4 space-y-3">
        <ProviderReadinessBanner channel="sms" compact />
        <div className="flex gap-2">
          <Textarea
            placeholder="Type your message…"
            aria-label="SMS message"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            rows={2}
            className="resize-none"
            autoCapitalize="sentences"
            data-testid="input-sms-message"
          />
          <Button
            onClick={() => sendSmsMutation.mutate()}
            disabled={!newMessage.trim() || sendSmsMutation.isPending || !lead?.id}
            data-testid="button-send-sms"
            aria-label="Send SMS"
          >
            {sendSmsMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>
        {!lead?.id && (
          <p className="text-xs text-muted-foreground mt-2" role="alert">
            Can't send SMS — no lead is linked to this conversation.
          </p>
        )}
      </div>
    </div>
  );
}

export default function InboxPage() {
  useDocumentTitle("Inbox");
  const { isCollapsed } = useSidebarCollapsed();
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<UnifiedItem | null>(null);

  const emailQueryParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (statusFilter === "unread") {
      params.isRead = "false";
      params.isArchived = "false";
    } else if (statusFilter === "starred") {
      params.isStarred = "true";
      params.isArchived = "false";
    } else if (statusFilter === "archived") {
      params.isArchived = "true";
    } else {
      params.isArchived = "false";
    }
    return params;
  }, [statusFilter]);

  const { data: emailMessages = [], isLoading: isLoadingEmail } = useQuery<InboxMessage[]>({
    queryKey: ["/api/inbox", emailQueryParams],
    enabled: channelFilter === "all" || channelFilter === "email",
  });

  const { data: smsConversations = [], isLoading: isLoadingSms } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations", { channel: "sms" }],
    enabled: channelFilter === "all" || channelFilter === "sms",
  });

  const { data: unreadCountData } = useQuery<{ count: number }>({
    queryKey: ["/api/inbox/unread-count"],
  });

  const { data: leads = [] } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
    queryFn: () => fetchJsonArray<Lead>("/api/leads"),
  });

  const { toast } = useToast();
  const unreadCount = unreadCountData?.count ?? 0;
  const isLoading = isLoadingEmail || isLoadingSms;

  const leadsMap = useMemo(() => {
    const map = new Map<number, Lead>();
    leads.forEach(lead => map.set(lead.id, lead));
    return map;
  }, [leads]);

  const unifiedItems = useMemo(() => {
    const items: UnifiedItem[] = [];
    
    if (channelFilter === "all" || channelFilter === "email") {
      emailMessages.forEach(msg => {
        items.push({
          type: "email",
          data: msg,
          timestamp: msg.receivedAt ? new Date(msg.receivedAt) : new Date(0),
        });
      });
    }
    
    if (channelFilter === "all" || channelFilter === "sms") {
      smsConversations.forEach(conv => {
        items.push({
          type: "sms",
          data: conv,
          timestamp: conv.lastMessageAt ? new Date(conv.lastMessageAt) : new Date(0),
        });
      });
    }
    
    items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    
    return items;
  }, [emailMessages, smsConversations, channelFilter]);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return unifiedItems;
    const query = searchQuery.toLowerCase();
    return unifiedItems.filter(item => {
      if (item.type === "email") {
        const msg = item.data;
        return (
          msg.senderName?.toLowerCase().includes(query) ||
          msg.senderEmail?.toLowerCase().includes(query) ||
          msg.subject?.toLowerCase().includes(query) ||
          msg.bodyText?.toLowerCase().includes(query)
        );
      } else {
        const conv = item.data;
        const lead = leadsMap.get(conv.leadId);
        const leadName = lead ? `${lead.firstName} ${lead.lastName}`.toLowerCase() : "";
        const phone = lead?.phone?.toLowerCase() || "";
        return leadName.includes(query) || phone.includes(query);
      }
    });
  }, [unifiedItems, searchQuery, leadsMap]);

  const selectedLead = useMemo(() => {
    if (!selectedItem) return undefined;
    if (selectedItem.type === "email" && selectedItem.data.leadId) {
      return leadsMap.get(selectedItem.data.leadId);
    }
    if (selectedItem.type === "sms") {
      return leadsMap.get(selectedItem.data.leadId);
    }
    return undefined;
  }, [selectedItem, leadsMap]);

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/inbox/${id}/read`);
      return res.json();
    },
    // Optimistic mark-as-read: flip isRead in every cached inbox list and
    // decrement the unread badge count instantly.
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: ["/api/inbox"] });
      await queryClient.cancelQueries({ queryKey: ["/api/inbox/unread-count"] });
      const snapshots: Array<[readonly unknown[], unknown]> = [];
      const entries = queryClient.getQueriesData({ queryKey: ["/api/inbox"] });
      for (const [key, value] of entries) {
        snapshots.push([key, value]);
        if (Array.isArray(value)) {
          queryClient.setQueryData(key, value.map((m: any) =>
            m?.id === id ? { ...m, isRead: true } : m
          ));
        }
      }
      const prevCount = queryClient.getQueryData<{ count: number }>(["/api/inbox/unread-count"]);
      if (prevCount && typeof prevCount.count === "number") {
        snapshots.push([["/api/inbox/unread-count"], prevCount]);
        queryClient.setQueryData(["/api/inbox/unread-count"], {
          ...prevCount,
          count: Math.max(0, prevCount.count - 1),
        });
      }
      return { snapshots };
    },
    onError: (_err, _id, context) => {
      if (context?.snapshots) {
        for (const [key, value] of context.snapshots) {
          queryClient.setQueryData(key, value);
        }
      }
      toast({
        title: "Couldn't mark as read",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/unread-count"] });
    },
  });

  const handleSelectItem = (item: UnifiedItem) => {
    setSelectedItem(item);
    if (item.type === "email" && !item.data.isRead) {
      markReadMutation.mutate(item.data.id);
    }
  };

  const getEmptyMessage = () => {
    if (channelFilter === "sms") {
      return { title: "No SMS conversations", description: "SMS conversations will appear here." };
    }
    switch (statusFilter) {
      case "unread":
        return { title: "No unread messages", description: "You're all caught up!" };
      case "starred":
        return { title: "No starred messages", description: "Star messages to find them quickly." };
      case "archived":
        return { title: "No archived messages", description: "Archived messages will appear here." };
      default:
        return { title: "No messages", description: "Your inbox is empty." };
    }
  };

  return (
    // min-h-dvh (not min-h-screen) so iOS Safari's dynamic address bar
    // doesn't push content below the visible viewport. pb-[…] reserves
    // space for MobileBottomNav (~72px + iOS safe-area) so the message
    // list and reply panel don't sit under it on mobile.
    <div className="flex min-h-[100dvh] bg-background">
      <Sidebar />

      <main className={`flex-1 pt-16 md:pt-0 flex flex-col h-[100dvh] pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0 transition-all duration-200 ${isCollapsed ? "md:ml-[76px]" : "md:ml-[17rem]"}`}>
        <div className="flex items-center justify-between gap-4 p-4 border-b flex-wrap">
          {/* Homestead editorial inbox header (prototype: tier-c.jsx Inbox) */}
          <div>
            <div className="acr-eyebrow">Inbox</div>
            <h1
              className="acr-cc-greeting"
              style={{ fontSize: "26px", marginTop: 2 }}
              data-testid="text-inbox-title"
            >
              {unreadCount > 0 ? (
                <>
                  {unreadCount.toLocaleString()}
                  <span className="acr-cc-greeting-soft">
                    {" "}{unreadCount === 1 ? "unread message" : "unread messages"}
                  </span>
                </>
              ) : (
                <>
                  All caught up.
                  <span className="acr-cc-greeting-soft"> Nothing waiting.</span>
                </>
              )}
            </h1>
          </div>

          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              inputMode="search"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Search messages…"
              aria-label="Search messages"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-inbox"
            />
          </div>
        </div>

        <Tabs value={channelFilter} onValueChange={(v) => setChannelFilter(v as ChannelFilter)} className="border-b">
          <TabsList className="w-full justify-start rounded-none border-none h-12 p-0 bg-transparent" aria-label="Channel">
            <TabsTrigger
              value="all"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-channel-all"
            >
              <MessageSquare className="h-4 w-4 mr-1" aria-hidden="true" />
              All channels
            </TabsTrigger>
            <TabsTrigger
              value="email"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-channel-email"
            >
              <Mail className="h-4 w-4 mr-1" aria-hidden="true" />
              Email
            </TabsTrigger>
            <TabsTrigger
              value="sms"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
              data-testid="tab-channel-sms"
            >
              <Phone className="h-4 w-4 mr-1" aria-hidden="true" />
              SMS
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {channelFilter !== "sms" && (
          <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)} className="border-b">
            <TabsList className="w-full justify-start rounded-none border-none h-10 p-0 bg-transparent" aria-label="Status">
              <TabsTrigger
                value="all"
                className="text-sm data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
                data-testid="tab-status-all"
              >
                All
              </TabsTrigger>
              <TabsTrigger
                value="unread"
                className="text-sm data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
                data-testid="tab-status-unread"
              >
                Unread
                {unreadCount > 0 && (
                  <Badge variant="secondary" className="ml-1 text-xs tabular-nums">
                    {unreadCount.toLocaleString()}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="starred"
                className="text-sm data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
                data-testid="tab-status-starred"
              >
                Starred
              </TabsTrigger>
              <TabsTrigger
                value="archived"
                className="text-sm data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
                data-testid="tab-status-archived"
              >
                Archived
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        <div className="flex-1 flex overflow-hidden">
          <div className={`${selectedItem ? "hidden md:block" : ""} w-full md:w-96 border-r overflow-hidden flex flex-col`}>
            <ContentReveal
              ready={!isLoading}
              skeleton={<ListSkeleton count={5} />}
            >
            {filteredItems.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-4 w-full">
                {/* Filter/search returned nothing but there ARE messages → EmptyFilter */}
                {searchQuery.trim() && unifiedItems.length > 0 ? (
                  <EmptyFilter
                    filterCount={1}
                    onClearFilters={() => setSearchQuery("")}
                    headline="No messages match your search"
                    clearLabel="Clear search"
                  />
                ) : statusFilter === "unread" && unifiedItems.length > 0 ? (
                  /* Unread filter returned zero but there are messages → ClearedEmpty (inbox zero) */
                  <ClearedEmpty
                    headline="All caught up — no unread messages"
                    subtitle="Nothing needs your attention right now."
                    archiveCount={unifiedItems.length}
                    onShowArchive={() => setStatusFilter("all")}
                    archiveLabel="View all messages"
                  />
                ) : statusFilter === "starred" && unifiedItems.length > 0 ? (
                  <ClearedEmpty
                    headline="No starred messages"
                    subtitle="Star messages to find them quickly later."
                    archiveCount={unifiedItems.length}
                    onShowArchive={() => setStatusFilter("all")}
                    archiveLabel="View all messages"
                  />
                ) : (
                  <EmptyState
                    icon={channelFilter === "sms" ? Phone : Mail}
                    {...getEmptyMessage()}
                  />
                )}
              </div>
            ) : (
              <ScrollArea className="flex-1">
                <ul className="list-none p-0 m-0" role="list" aria-label={`${filteredItems.length} message${filteredItems.length === 1 ? "" : "s"}`}>
                  {filteredItems.map((item) => (
                    <li key={item.type === "email" ? `email-${item.data.id}` : `sms-${item.data.id}`}>
                      {item.type === "email" ? (
                        <EmailMessageRow
                          message={item.data}
                          isSelected={selectedItem?.type === "email" && selectedItem.data.id === item.data.id}
                          onSelect={() => handleSelectItem(item)}
                          leadName={item.data.leadId
                            ? (() => {
                                const lead = leadsMap.get(item.data.leadId!);
                                return lead ? `${lead.firstName} ${lead.lastName}` : undefined;
                              })()
                            : undefined}
                        />
                      ) : (
                        <SMSConversationRow
                          conversation={item.data}
                          isSelected={selectedItem?.type === "sms" && selectedItem.data.id === item.data.id}
                          onSelect={() => handleSelectItem(item)}
                          lead={leadsMap.get(item.data.leadId)}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
            </ContentReveal>
          </div>

          <div className={`${selectedItem ? "" : "hidden md:flex"} flex-1 flex flex-col`}>
            {selectedItem ? (
              selectedItem.type === "email" ? (
                <EmailMessageDetail
                  message={selectedItem.data}
                  lead={selectedLead}
                  onBack={() => setSelectedItem(null)}
                />
              ) : (
                <SMSConversationDetail
                  conversation={selectedItem.data}
                  lead={selectedLead}
                  onBack={() => setSelectedItem(null)}
                />
              )
            ) : (
              <div className="flex-1 flex items-center justify-center p-4">
                <EmptyState
                  icon={MessageSquare}
                  title="Select a message"
                  description="Choose a conversation from the list to read it here."
                />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
