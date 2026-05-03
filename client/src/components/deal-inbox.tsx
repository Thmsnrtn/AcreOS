import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Mail, Reply, Eye, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { useToast } from "@/hooks/use-toast";
import { Verbs } from "@/lib/labels";

interface LeadEmail {
  id: number;
  direction: "inbound" | "outbound";
  fromEmail: string;
  toEmail: string;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  receivedAt: string;
  readAt: string | null;
}

interface DealInboxProps {
  leadId: number;
  leadEmail?: string;
  leadName?: string;
}

export function DealInbox({ leadId, leadEmail, leadName }: DealInboxProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyTo, setReplyTo] = useState(leadEmail || "");
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: emails, isLoading } = useQuery<LeadEmail[]>({
    queryKey: [`/api/leads/${leadId}/emails`],
  });

  const markReadMutation = useMutation({
    mutationFn: async (emailIds: number[]) => {
      const res = await fetch(`/api/leads/${leadId}/emails/mark-read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailIds }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to mark as read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/leads/${leadId}/emails`] });
      queryClient.invalidateQueries({ queryKey: ["/api/emails/unread-count"] });
    },
  });

  const replyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/leads/${leadId}/emails/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: replyTo, subject: replySubject, body: replyBody }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to send reply");
    },
    onSuccess: () => {
      toast({ title: "Reply sent", description: `Email sent to ${replyTo}` });
      setReplyOpen(false);
      setReplyBody("");
      queryClient.invalidateQueries({ queryKey: [`/api/leads/${leadId}/emails`] });
    },
    onError: () => {
      toast({ title: "Couldn't send reply", description: "Your draft reply is preserved. Try sending again.", variant: "destructive" });
    },
  });

  const unreadEmails = emails?.filter(e => e.direction === "inbound" && !e.readAt) || [];

  const handleMarkAllRead = () => {
    if (unreadEmails.length > 0) {
      markReadMutation.mutate(unreadEmails.map(e => e.id));
    }
  };

  const handleReply = (email: LeadEmail) => {
    setReplyTo(email.fromEmail);
    setReplySubject(email.subject ? `Re: ${email.subject.replace(/^Re:\s*/i, "")}` : "");
    setReplyBody(
      `\n\n---\nOn ${new Date(email.receivedAt).toLocaleString()}, ${email.fromEmail} wrote:\n> ${(email.bodyText || "").split("\n").join("\n> ")}`
    );
    setReplyOpen(true);
  };

  if (isLoading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading email inbox"
        className="space-y-3"
      >
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  return (
    <div className="border rounded-lg">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className="flex items-center justify-between w-full p-4 hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-lg"
        aria-label={isExpanded ? "Collapse email thread" : "Expand email thread"}
      >
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium text-sm">Email thread</span>
          {unreadEmails.length > 0 && (
            <Badge variant="default" className="text-xs tabular-nums" aria-label={`${unreadEmails.length} new email${unreadEmails.length === 1 ? "" : "s"}`}>
              <span className="tabular-nums">{unreadEmails.length}</span> new
            </Badge>
          )}
        </div>
        {isExpanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
      </button>

      {isExpanded && (
        <div className="border-t">
          {(!emails || emails.length === 0) ? (
            <div className="p-6 text-center text-muted-foreground text-sm" role="status">
              <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" aria-hidden="true" />
              <p className="m-0">No emails yet for this lead.</p>
              {leadEmail && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    setReplyTo(leadEmail);
                    setReplySubject("");
                    setReplyBody("");
                    setReplyOpen(true);
                  }}
                  aria-label={`Send first email to ${leadName || leadEmail}`}
                >
                  Send first email
                </Button>
              )}
            </div>
          ) : (
            <motion.ul
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              aria-label="Email thread"
              className="divide-y max-h-[500px] overflow-y-auto list-none p-0 m-0"
            >
              {unreadEmails.length > 0 && (
                <li className="px-4 py-2 bg-muted/30 flex justify-end list-none">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleMarkAllRead}
                    disabled={markReadMutation.isPending}
                    aria-busy={markReadMutation.isPending}
                    aria-label={`Mark all ${unreadEmails.length} unread emails as read`}
                  >
                    <Eye className="h-3 w-3 mr-1" aria-hidden="true" />
                    Mark all read
                  </Button>
                </li>
              )}

              {emails.map((email) => {
                const isUnread = email.direction === "inbound" && !email.readAt;
                const fromLabel = email.direction === "inbound" ? email.fromEmail : `To: ${email.toEmail}`;
                const directionLabel = email.direction === "inbound" ? "Received" : "Sent";
                const timeStr = new Date(email.receivedAt).toLocaleString();
                const itemLabel = `${isUnread ? "Unread, " : ""}${directionLabel} ${email.direction === "inbound" ? "from" : "to"} ${email.direction === "inbound" ? email.fromEmail : email.toEmail}, ${timeStr}${email.subject ? `, subject: ${email.subject}` : ""}`;

                return (
                  <motion.li
                    key={email.id}
                    variants={staggerItem}
                    aria-label={itemLabel}
                    className={`p-4 list-none ${isUnread ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                  >
                    <div className="flex items-start justify-between mb-1">
                      <div className="flex items-center gap-2">
                        {isUnread && (
                          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                        )}
                        <span className="text-sm font-medium" aria-hidden="true">
                          {fromLabel}
                        </span>
                        <Badge variant="outline" className="text-xs" aria-hidden="true">
                          {directionLabel}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        <time dateTime={email.receivedAt} className="tabular-nums" aria-hidden="true">{timeStr}</time>
                      </div>
                    </div>

                    {email.subject && (
                      <p className="text-sm font-medium mb-1 m-0" aria-hidden="true">{email.subject}</p>
                    )}

                    <div className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-6">
                      {email.bodyText || "(no content)"}
                    </div>

                    {email.direction === "inbound" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mt-2"
                        onClick={() => handleReply(email)}
                        aria-label={`Reply to email from ${email.fromEmail}`}
                      >
                        <Reply className="h-3 w-3 mr-1" aria-hidden="true" />
                        Reply
                      </Button>
                    )}
                  </motion.li>
                );
              })}
            </motion.ul>
          )}

          {/* Reply composer */}
          <Sheet open={replyOpen} onOpenChange={setReplyOpen}>
            <SheetContent side="bottom" className="max-h-[60vh]">
              <SheetHeader>
                <SheetTitle>Reply to {leadName || replyTo}</SheetTitle>
              </SheetHeader>
              <form
                id="deal-inbox-reply-form"
                className="space-y-3 mt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!replyMutation.isPending && replyTo && replyBody) replyMutation.mutate();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="reply-to">To</Label>
                  <Input
                    id="reply-to"
                    value={replyTo}
                    onChange={(e) => setReplyTo(e.target.value)}
                    type="email"
                    inputMode="email"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reply-subject">Subject</Label>
                  <Input
                    id="reply-subject"
                    value={replySubject}
                    onChange={(e) => setReplySubject(e.target.value)}
                    autoCapitalize="sentences"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reply-body">Message</Label>
                  <Textarea
                    id="reply-body"
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    rows={8}
                    autoCapitalize="sentences"
                    placeholder="Write your reply…"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setReplyOpen(false)}>{Verbs.CANCEL}</Button>
                  <Button
                    type="submit"
                    form="deal-inbox-reply-form"
                    disabled={replyMutation.isPending || !replyTo || !replyBody}
                    aria-busy={replyMutation.isPending}
                    aria-label={replyMutation.isPending ? "Sending reply" : `Send reply to ${replyTo}`}
                  >
                    {replyMutation.isPending ? "Sending…" : "Send reply"}
                  </Button>
                </div>
              </form>
            </SheetContent>
          </Sheet>
        </div>
      )}
    </div>
  );
}

/**
 * Compact badge for dashboard/sidebar showing unread email responses.
 */
export function UnreadEmailBadge() {
  const { data } = useQuery<{ count: number }>({
    queryKey: ["/api/emails/unread-count"],
    refetchInterval: 60_000,
  });

  if (!data?.count) return null;

  return (
    <Badge variant="default" className="text-xs tabular-nums" aria-label={`${data.count} unread email${data.count === 1 ? "" : "s"}`}>
      <span className="tabular-nums">{data.count}</span>
    </Badge>
  );
}
