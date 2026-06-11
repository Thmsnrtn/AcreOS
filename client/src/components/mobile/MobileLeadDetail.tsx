/**
 * MobileLeadDetail — phone-optimized /leads/:id surface.
 *
 * The desktop LeadDetailContent is a wide multi-column layout
 * (overview / activity / docs / scoring / nurturing). On a phone we
 * compress that into a single scroll:
 *
 *   1) Hero — name, status pill, score, location
 *   2) Action row — Call / Text / Email / Maps (the four operations a
 *      user actually does mid-call or mid-meeting)
 *   3) Mark contacted — one-tap stamp of lastContactedAt + status
 *      bump to 'contacted' for "new" leads (the workflow that
 *      otherwise drowns under desktop spreadsheets)
 *   4) Notes — append-only feed; mic-dictation supported (Web Speech)
 *   5) Quick links — Enrich · Rescore · Full desktop view
 *
 * Everything routes through hooks the desktop already uses
 * (useLead, useUpdateLead) so optimistic cache stays consistent.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Phone,
  MessageSquare,
  Mail,
  Map as MapIcon,
  Mic,
  MicOff,
  CheckCircle2,
  Sparkles,
  RefreshCcw,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useLead, useUpdateLead } from "@/hooks/use-leads";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import PostCallSheet, { setPendingContactEvent } from "@/components/mobile/PostCallSheet";

/** Tiny one-shot speech-to-text. Same pattern as QuickAddSheet. */
function useDictate(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const supported =
    typeof window !== "undefined" &&
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  useEffect(() => {
    if (!supported) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (e: any) => {
      const transcript = e?.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) onResult(transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    return () => { try { rec.stop(); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  return {
    supported: !!supported,
    listening,
    start: () => {
      if (!recRef.current || listening) return;
      try { setListening(true); recRef.current.start(); } catch { setListening(false); }
    },
    stop: () => {
      try { recRef.current?.stop(); } catch { /* ignore */ }
    },
  };
}

function StatusPill({ status }: { status?: string | null }) {
  const s = (status ?? "new").toLowerCase();
  const tone =
    s === "dead" ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
    : s === "closed" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
    : s === "accepted" || s === "under_contract" || s === "qualified"
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
      : s === "responded" || s === "negotiating" || s === "interested" || s === "contacted"
        ? "bg-primary/15 text-primary"
        : "bg-muted text-foreground";
  return (
    <Badge variant="secondary" className={`uppercase tracking-wide text-micro ${tone}`}>
      {s.replace(/_/g, " ")}
    </Badge>
  );
}

interface MobileLeadDetailProps {
  leadId: number;
}

export function MobileLeadDetail({ leadId }: MobileLeadDetailProps) {
  const [, setLocation] = useLocation();
  const { data: lead, isLoading, error, refetch } = useLead(leadId);
  const updateLead = useUpdateLead();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [noteDraft, setNoteDraft] = useState("");
  const dictate = useDictate((text) => {
    setNoteDraft((prev) => (prev ? `${prev} ${text}` : text));
  });

  const rescoreMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/leads/${leadId}/score`, {});
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/leads"] });
      refetch();
      toast({ title: "Rescored" });
    },
    onError: (err: any) => {
      toast({
        title: "Rescore failed",
        description: err?.message ?? "Try again later.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-background px-4 pt-16 pb-24 space-y-4" aria-busy="true">
        <Skeleton className="h-16 w-2/3 rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="min-h-[100dvh] bg-background px-4 pt-16 flex flex-col items-center justify-center text-center">
        <h2 className="text-lg font-semibold">Lead unavailable</h2>
        <p className="text-sm text-muted-foreground mt-1">
          We couldn't load this lead. It may have been deleted, or your
          session needs a refresh.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => refetch()}>
          Try again
        </Button>
        <Link
          href="/leads"
          className="text-sm text-primary mt-3"
          data-testid="mobile-lead-back-to-list"
        >
          ← All leads
        </Link>
      </div>
    );
  }

  const fullName =
    [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() ||
    `Lead #${lead.id}`;
  const addressLine = [lead.address, lead.city, lead.state, lead.zip]
    .filter(Boolean)
    .join(", ");
  const phone = lead.phone || lead.phoneNormalized;
  const mapsHref = addressLine
    ? `https://maps.apple.com/?q=${encodeURIComponent(addressLine)}`
    : null;

  const markContacted = () => {
    updateLead.mutate(
      {
        id: lead.id,
        // Stamp lastContactedAt server-side via PUT (the route accepts
        // any partial). For 'new' leads, also bump status to 'contacted'
        // so the lead leaves the "untouched" pile.
        lastContactedAt: new Date().toISOString() as any,
        ...(lead.status === "new" ? { status: "contacted" as any } : {}),
      },
      {
        onSuccess: () => toast({ title: "Marked contacted" }),
        onError: (err: any) =>
          toast({
            title: "Couldn't update lead",
            description: err?.message ?? "Try again later.",
            variant: "destructive",
          }),
      },
    );
  };

  const appendNote = () => {
    const draft = noteDraft.trim();
    if (!draft) return;
    const stamp = new Date().toLocaleString();
    const merged = lead.notes
      ? `${lead.notes}\n\n[${stamp}] ${draft}`
      : `[${stamp}] ${draft}`;
    updateLead.mutate(
      { id: lead.id, notes: merged },
      {
        onSuccess: () => {
          setNoteDraft("");
          toast({ title: "Note saved" });
        },
        onError: (err: any) =>
          toast({
            title: "Couldn't save note",
            description: err?.message ?? "Note kept in the draft — try again.",
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <div className="min-h-[100dvh] bg-background pb-24" data-testid="mobile-lead-detail">
      {/* Sticky back nav — fixed so it survives the long notes scroll. */}
      <header
        className="sticky top-0 z-20 bg-surface-chrome backdrop-blur-md border-b border-border px-2 py-2 flex items-center"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
      >
        <button
          type="button"
          onClick={() => {
            if (window.history.length > 1) window.history.back();
            else setLocation("/leads");
          }}
          aria-label="Back"
          className="h-10 w-10 flex items-center justify-center rounded-full active:bg-muted/60"
          data-testid="mobile-lead-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 text-center font-medium truncate px-2">
          {fullName}
        </div>
        <Link
          href={`/leads/${lead.id}?desktop=1`}
          className="h-10 w-10 flex items-center justify-center rounded-full text-muted-foreground active:bg-muted/60"
          aria-label="Open full desktop view"
        >
          <ExternalLink className="h-4 w-4" />
        </Link>
      </header>

      <div className="px-4 pt-4 space-y-4">
        {/* Hero */}
        <section>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">
            {fullName}
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <StatusPill status={lead.status} />
            {typeof lead.score === "number" && (
              <Badge variant="outline" className="tabular-nums">
                {lead.score} score
              </Badge>
            )}
          </div>
          {addressLine && (
            <div className="text-sm text-muted-foreground mt-2">
              {addressLine}
            </div>
          )}
        </section>

        {/* Action row */}
        <section className="grid grid-cols-4 gap-2" aria-label="Lead actions">
          <ActionTile
            label="Call"
            icon={<Phone className="h-5 w-5" />}
            href={phone ? `tel:${phone}` : undefined}
            disabled={!phone}
            testId="mobile-lead-call"
            onTap={() => {
              // Optimistic — bump lastContactedAt + log the attempt
              // BEFORE the dialer hand-off so the data layer never
              // misses the call. PostCallSheet picks up the pending
              // flag on return-to-app and asks for the outcome.
              apiRequest("POST", `/api/leads/${lead.id}/contact-event`, {
                channel: "phone",
                method: "tap",
              }).catch(() => { /* fire-and-forget */ });
              setPendingContactEvent({
                leadId: lead.id,
                leadName: fullName,
                channel: "phone",
                startedAt: Date.now(),
              });
            }}
          />
          <ActionTile
            label="Text"
            icon={<MessageSquare className="h-5 w-5" />}
            href={phone ? `sms:${phone}` : undefined}
            disabled={!phone}
            testId="mobile-lead-sms"
            onTap={() => {
              apiRequest("POST", `/api/leads/${lead.id}/contact-event`, {
                channel: "sms",
                method: "tap",
              }).catch(() => { /* fire-and-forget */ });
              setPendingContactEvent({
                leadId: lead.id,
                leadName: fullName,
                channel: "sms",
                startedAt: Date.now(),
              });
            }}
          />
          <ActionTile
            label="Email"
            icon={<Mail className="h-5 w-5" />}
            href={lead.email ? `mailto:${lead.email}` : undefined}
            disabled={!lead.email}
            testId="mobile-lead-email"
          />
          <ActionTile
            label="Map"
            icon={<MapIcon className="h-5 w-5" />}
            href={mapsHref ?? undefined}
            disabled={!mapsHref}
            external
            testId="mobile-lead-map"
          />
        </section>

        {/* Mark contacted */}
        <Card className="p-3">
          <Button
            variant="secondary"
            className="w-full h-11 gap-2"
            onClick={markContacted}
            disabled={updateLead.isPending}
            data-testid="mobile-lead-mark-contacted"
          >
            <CheckCircle2 className="h-4 w-4" />
            {updateLead.isPending ? "Saving…" : "Mark contacted now"}
          </Button>
          {lead.lastContactedAt && (
            <div className="text-caption text-muted-foreground text-center mt-1.5">
              Last contacted{" "}
              {new Date(lead.lastContactedAt as any).toLocaleString()}
            </div>
          )}
        </Card>

        {/* Notes */}
        <section>
          <h2 className="text-caption uppercase tracking-wide text-muted-foreground mb-2 px-1">
            Notes
          </h2>
          <Card className="p-3 space-y-3">
            <div className="relative">
              <Textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="What did they say?"
                rows={3}
                className="pr-10 resize-none"
                data-testid="mobile-lead-note-input"
              />
              {dictate.supported && (
                <button
                  type="button"
                  onClick={dictate.listening ? dictate.stop : dictate.start}
                  aria-label={dictate.listening ? "Stop dictation" : "Dictate note"}
                  className={`absolute right-2 top-2 h-8 w-8 rounded-full flex items-center justify-center transition-colors ${
                    dictate.listening
                      ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 animate-pulse"
                      : "text-muted-foreground hover:bg-muted active:bg-muted"
                  }`}
                >
                  {dictate.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
              )}
            </div>
            <Button
              onClick={appendNote}
              disabled={!noteDraft.trim() || updateLead.isPending}
              className="w-full h-10"
              data-testid="mobile-lead-note-save"
            >
              {updateLead.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Save note"
              )}
            </Button>
            {lead.notes && (
              <div className="text-sm whitespace-pre-wrap text-muted-foreground border-t border-border/60 pt-3 max-h-48 overflow-y-auto">
                {lead.notes}
              </div>
            )}
          </Card>
        </section>

        {/* Quick actions */}
        <section className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="h-11 gap-2"
            onClick={() => rescoreMut.mutate()}
            disabled={rescoreMut.isPending}
            data-testid="mobile-lead-rescore"
          >
            {rescoreMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Rescore
          </Button>
          <Button
            variant="outline"
            className="h-11 gap-2"
            onClick={() => refetch()}
            data-testid="mobile-lead-refresh"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
        </section>
      </div>

      {/* Return-from-call outcome picker. Triggered by visibilitychange
          once a tap-to-call/text pending event is in sessionStorage. */}
      <PostCallSheet />
    </div>
  );
}

function ActionTile({
  label,
  icon,
  href,
  disabled,
  external,
  testId,
  onTap,
}: {
  label: string;
  icon: React.ReactNode;
  href?: string;
  disabled?: boolean;
  external?: boolean;
  testId?: string;
  /** Fire-and-forget side effect BEFORE the href is followed. */
  onTap?: () => void;
}) {
  const base =
    "flex flex-col items-center justify-center gap-1 h-16 rounded-xl text-xs font-medium transition-colors";
  if (disabled || !href) {
    return (
      <div
        className={`${base} bg-muted/40 text-muted-foreground/60 cursor-not-allowed`}
        aria-disabled
        data-testid={testId}
      >
        {icon}
        {label}
      </div>
    );
  }
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      onClick={onTap}
      className={`${base} bg-primary/10 text-primary active:bg-primary/20`}
      data-testid={testId}
    >
      {icon}
      {label}
    </a>
  );
}

export default MobileLeadDetail;

/**
 * Convenience wrapper that reads :id off the wouter route and renders
 * MobileLeadDetail. Used by lead-detail.tsx to flip between the
 * desktop and mobile layouts based on viewport.
 */
export function MobileLeadDetailRoute() {
  const [, params] = useRoute<{ id: string }>("/leads/:id");
  const id = params?.id ? parseInt(params.id, 10) : NaN;
  if (!id || Number.isNaN(id)) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6 text-center gap-3">
        <h2 className="text-base font-semibold">Bad lead URL</h2>
        <p className="text-sm text-muted-foreground">
          That link doesn't point to a valid lead. Open the leads list to
          pick one.
        </p>
        <Link href="/leads" className="text-sm text-primary">
          ← All leads
        </Link>
      </div>
    );
  }
  return <MobileLeadDetail leadId={id} />;
}
