/**
 * /settings/pax — Settings → Pax (AUTONOMY_SPEC.md §3a; decision record
 * docs/company/founder-decision-2026-09-02-pax-controls.md).
 *
 * The ONE customer surface for what Pax does on its own. Two stances, one
 * pause, one queue, one receipts feed, one fixed Never list. No level, no
 * percentage, no per-person preference: EVERY line is read from
 * GET /api/pax/controls (org truth — server/routes-pax-controls.ts), and the
 * four writes go to POST /pause, POST /resume, PATCH /controls and the
 * existing PATCH /api/ai/scheduled-tasks/:id. True zeros render as zeros;
 * a number with no row renders as "no runs yet", never as a guess.
 *
 * Copy discipline: every customer-visible string comes from
 * shared/pax-glossary.ts (stance / pause / group / page copy), and the
 * "what Pause stops" list is rendered from UNATTENDED_PATHS in
 * shared/pax-controls.ts — the same registry the pause-coverage ratchet
 * reads, so the page can only list a path the engines actually gate.
 * tests/unit/paxControlsPage.test.ts pins both (mutation-probed).
 *
 * A controls read the server could not verify is REFUSED upstream (503 with
 * the glossary's "could not verify" line) and rendered here as an error
 * with retry — a failed read is not a stance, so the page never shows one.
 */

import React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Database,
  History,
  Inbox,
  Mail,
  MessageSquare,
  MinusCircle,
  PauseCircle,
  PlayCircle,
  Printer,
  Trash2,
  XCircle,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OFFERED_STANCES, STANCE_LABELS, UNATTENDED_PATHS, type PaxStance } from "@shared/pax-controls";
import {
  PAX_GROUP_COPY,
  PAX_LABELS,
  PAX_NEVER_LIST,
  PAX_PAGE_COPY,
  PAX_PAUSE_COPY,
  PAX_PAUSE_OPTIONS,
  PAX_RECEIPT_WORDS,
  PAX_STANCE_COPY,
  type PaxPauseOption,
} from "@shared/pax-glossary";

// ── The controls object (frozen contract 3, server/routes-pax-controls.ts) ──

interface ScheduledPromptRow {
  id: number;
  name: string;
  isActive: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  nextRunAt: string | null;
}

export interface PaxControlsResponse {
  paused: boolean;
  pausedUntil: string | null;
  pausedBy: { userId: string | number; name: string | null } | null;
  checkFailed: boolean;
  stance: PaxStance;
  canChangeStance: boolean;
  canResume: boolean;
  switches: { leadScoring: boolean; borrowerReminders: boolean; inboxDrafts: boolean };
  rightNow: {
    waiting: number;
    changedTodayOnItsOwn: number;
    rulesRunning: { workflows: number; sequences: number; scheduledPrompts: number };
  };
  runsOnItsOwn: {
    workflows: { active: number; live: number; lastRanAt: string | null };
    sequences: { activeEnrollments: number; lastSendAt: string | null };
    scheduledPrompts: ScheduledPromptRow[];
    leadScoring: { lastRanAt: string | null; rescoredToday: number };
    borrowerReminders: { waiting: number };
    fixedRules: { emailsUsedToday: number; emailLimit: number; textsUsedToday: number; textLimit: number };
  };
  /** The org's IANA zone, when the server sends it; pause times print in it. */
  timezone?: string;
}

interface ReceiptItem {
  id: number;
  at: string;
  actor: "pax" | "rule";
  origin: string | null;
  group: string | null;
  mode: "asked" | "on_its_own" | "rule";
  action: string;
  entityType: string;
  entityId: number;
  entityLabel?: string;
  summary: string;
  pendingActionId?: number;
}

interface ReceiptsPage {
  items: ReceiptItem[];
  nextCursor: string | null;
}

interface TaskRun {
  id: number;
  runAt: string;
  status: string;
  summary: string | null;
  durationMs: number | null;
}

interface ByokResponse {
  channels: Array<{ channel: string; status: "platform" | "byok" }>;
}

interface MailboxResponse {
  mailboxes: Array<{ id: number; emailAddress: string }>;
}

const CONTROLS_KEY = ["/api/pax/controls"] as const;
const RECEIPTS_LIMIT = 10;
const RECEIPTS_KEY = ["/api/pax/receipts", { limit: RECEIPTS_LIMIT }] as const;
const SCHEDULED_TASKS_KEY = ["/api/ai/scheduled-tasks"] as const;

/** Sizes on this page: every tap target is ≥44px on touch. */
const TAP = "min-h-11 pointer-fine:sm:min-h-9";

// The four connection rows moved here from the deleted autopilot-setup.tsx.
// "Connected" is keyed on the customer having their OWN key for the channel
// (BYO rails); the link goes to the one catalog at /settings/byok.
const CAPABILITIES: Array<{
  key: keyof typeof PAX_PAGE_COPY.capabilities;
  icon: typeof MessageSquare;
  channels: string[];
}> = [
  { key: "texts", icon: MessageSquare, channels: ["twilio", "telnyx"] },
  { key: "email", icon: Mail, channels: ["sendgrid", "ses"] },
  { key: "mail", icon: Printer, channels: ["lob", "postgrid"] },
  { key: "data", icon: Database, channels: ["attom", "regrid", "batch_skiptracing"] },
];

const BYOK_PATH = "/settings/byok";
const QUEUE_PATH = "/ai";
const TEAM_PATH = "/settings#organization";

// ── Helpers ────────────────────────────────────────────────────────────────

function browserZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t) : null;
}

/** "503: Pax could not verify…" → the server's own sentence. */
function serverMessage(error: unknown): string | undefined {
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : undefined;
  return msg ? msg.replace(/^\d{3}:\s*/, "") : undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The 30-day "until I resume" is the only offered choice that reaches past 3 days. */
function isLongPause(until: Date | null): boolean {
  return until !== null && until.getTime() - Date.now() > 3 * DAY_MS;
}

type PromptTone = "ok" | "neutral" | "error";

/** Neutral outcomes stay neutral: a skip is not an error. */
function promptStatus(status: string | null): { label: string; tone: PromptTone } | null {
  if (!status) return null;
  if (status === "success") return { label: PAX_PAGE_COPY.promptOk, tone: "ok" };
  if (status === "skipped_paused") return { label: PAX_PAGE_COPY.promptSkippedPaused, tone: "neutral" };
  if (status === "skipped_off") return { label: PAX_PAGE_COPY.promptSkippedOff, tone: "neutral" };
  if (status.startsWith("skipped")) return { label: status.replace(/_/g, " "), tone: "neutral" };
  return { label: PAX_PAGE_COPY.promptError, tone: "error" };
}

const TONE_CLASS: Record<PromptTone, string> = {
  ok: "bg-acr-pos-soft text-acr-pos-soft-ink border-transparent",
  neutral: "bg-muted text-muted-foreground border-transparent",
  error: "bg-acr-neg-soft text-acr-neg-soft-ink border-transparent",
};

const RECEIPT_MODE_WORD: Record<ReceiptItem["mode"], string> = {
  asked: PAX_RECEIPT_WORDS.asked,
  on_its_own: PAX_RECEIPT_WORDS.onItsOwn,
  rule: PAX_RECEIPT_WORDS.rule,
};

async function getJson<T>(url: string): Promise<T> {
  const res = await apiRequest("GET", url);
  return (await res.json()) as T;
}

// ── Page ───────────────────────────────────────────────────────────────────

export function PaxControls() {
  useDocumentTitle(PAX_PAGE_COPY.title);
  const { toast } = useToast();
  const [pauseOpen, setPauseOpen] = React.useState(false);

  const controls = useQuery<PaxControlsResponse>({
    queryKey: CONTROLS_KEY,
    queryFn: () => getJson<PaxControlsResponse>("/api/pax/controls"),
    refetchInterval: 60_000,
  });

  const settle = React.useCallback((next: PaxControlsResponse) => {
    queryClient.setQueryData(CONTROLS_KEY, next);
    void queryClient.invalidateQueries({ queryKey: [RECEIPTS_KEY[0]] });
  }, []);

  const data = controls.data;
  const zone = data?.timezone ?? browserZone();
  const pausedUntil = toDate(data?.pausedUntil);
  const pauseWords = { until: pausedUntil, byName: data?.pausedBy?.name ?? null, timeZone: zone };

  // allow-no-invalidation: settle() writes the fresh controls object into
  // CONTROLS_KEY with setQueryData and invalidates the receipts feed; the
  // rule cannot follow the useCallback helper.
  const pause = useMutation({
    mutationFn: async (until: PaxPauseOption) => {
      const res = await apiRequest("POST", "/api/pax/pause", { until, timeZone: browserZone() });
      return (await res.json()) as PaxControlsResponse;
    },
    onSuccess: (next) => {
      settle(next);
      setPauseOpen(false);
      toast({
        title: PAX_PAUSE_COPY.statusLine({
          until: toDate(next.pausedUntil),
          byName: next.pausedBy?.name ?? null,
          timeZone: next.timezone ?? browserZone(),
        }),
        description: PAX_PAUSE_COPY.stillWorks,
      });
    },
    onError: (error: unknown) =>
      toast({ title: PAX_PAGE_COPY.couldNotPause, description: serverMessage(error), variant: "destructive" }),
  });

  // allow-no-invalidation: settle() writes the fresh controls object into
  // CONTROLS_KEY with setQueryData and invalidates the receipts feed; the
  // rule cannot follow the useCallback helper.
  const resume = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pax/resume");
      return (await res.json()) as PaxControlsResponse;
    },
    onSuccess: (next) => {
      settle(next);
      // Org truth: a member's own pause may clear while a teammate's holds.
      toast({
        title: next.paused
          ? PAX_PAUSE_COPY.statusLine({
              until: toDate(next.pausedUntil),
              byName: next.pausedBy?.name ?? null,
              timeZone: next.timezone ?? browserZone(),
            })
          : PAX_LABELS.active,
      });
    },
    onError: (error: unknown) =>
      toast({ title: PAX_PAGE_COPY.couldNotResume, description: serverMessage(error), variant: "destructive" }),
  });

  type Patch = Partial<{ stance: PaxStance; leadScoring: boolean; borrowerReminders: boolean; inboxDrafts: boolean }>;
  // allow-no-invalidation: settle() writes the fresh controls object into
  // CONTROLS_KEY with setQueryData and invalidates the receipts feed; the
  // rule cannot follow the useCallback helper.
  const patch = useMutation({
    mutationFn: async (body: Patch) => {
      const res = await apiRequest("PATCH", "/api/pax/controls", body);
      return { next: (await res.json()) as PaxControlsResponse, body };
    },
    onSuccess: ({ next, body }) => {
      settle(next);
      if (body.stance) toast({ title: PAX_STANCE_COPY[body.stance].toast });
      if (body.leadScoring !== undefined)
        toast({ title: PAX_PAGE_COPY.switchToast(PAX_PAGE_COPY.leadScoring, body.leadScoring) });
      if (body.borrowerReminders !== undefined)
        toast({ title: PAX_PAGE_COPY.switchToast(PAX_PAGE_COPY.borrowerReminders, body.borrowerReminders) });
      if (body.inboxDrafts !== undefined)
        toast({ title: PAX_PAGE_COPY.switchToast(PAX_PAGE_COPY.inboxDrafts, body.inboxDrafts) });
    },
    onError: (error: unknown) =>
      toast({ title: PAX_PAGE_COPY.couldNotChange, description: serverMessage(error), variant: "destructive" }),
  });

  if (controls.isLoading) {
    return (
      <PageShell label={PAX_PAGE_COPY.title}>
        <div className="space-y-4" data-testid="pax-controls-loading" aria-busy="true">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-24 w-full rounded-card" />
          <Skeleton className="h-40 w-full rounded-card" />
          <Skeleton className="h-64 w-full rounded-card" />
        </div>
      </PageShell>
    );
  }

  if (controls.isError || !data) {
    return (
      <PageShell label={PAX_PAGE_COPY.title}>
        <QueryErrorState
          error={controls.error as Error}
          onRetry={() => void controls.refetch()}
          title={PAX_PAGE_COPY.couldNotLoad}
          description={serverMessage(controls.error)}
          testId="pax-controls-error"
        />
      </PageShell>
    );
  }

  const stance = data.stance;
  const canEdit = data.canChangeStance && !patch.isPending;
  const pauseStops = UNATTENDED_PATHS.filter((p) => p.customerVisible && p.pauseStops);
  const pauseKeeps = UNATTENDED_PATHS.filter((p) => p.customerVisible && !p.pauseStops);
  const runs = data.runsOnItsOwn;
  const promptsOn = runs.scheduledPrompts.filter((p) => p.isActive).length;

  return (
    <PageShell label={PAX_PAGE_COPY.title}>
      <div className="mb-6">
        <h1 className="text-hero">{PAX_PAGE_COPY.title}</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{PAX_PAGE_COPY.intro}</p>
      </div>

      {/* ── 1. Status strip ─────────────────────────────────────────────── */}
      <Card className="rounded-card mb-4" data-testid="pax-status-strip">
        <CardContent className="p-4 flex items-start gap-3 flex-wrap">
          {data.paused ? (
            <PauseCircle className="w-5 h-5 text-acr-warn shrink-0 mt-0.5" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-acr-pos shrink-0 mt-0.5" aria-hidden="true" />
          )}
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm" data-testid="pax-status-line">
              {data.paused ? PAX_PAUSE_COPY.statusLine(pauseWords) : `${PAX_LABELS.active} · ${STANCE_LABELS[stance]}`}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {data.paused ? PAX_PAUSE_COPY.sentence(pauseWords) : PAX_STANCE_COPY[stance].sentence}
            </div>
            {data.paused && isLongPause(pausedUntil) && pausedUntil && (
              <div className="text-xs text-muted-foreground mt-0.5" data-testid="pax-resumes-by-itself">
                {PAX_PAUSE_COPY.resumesByItself(pausedUntil, zone)}
              </div>
            )}
          </div>
          {data.paused ? (
            data.canResume ? (
              <Button
                variant="outline"
                className={TAP}
                onClick={() => resume.mutate()}
                disabled={resume.isPending}
                data-testid="button-pax-resume"
              >
                <PlayCircle className="w-4 h-4 mr-2" aria-hidden="true" />
                {PAX_PAGE_COPY.resumeButton}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground self-center" data-testid="pax-resume-not-yours">
                {PAX_PAGE_COPY.resumeNotYours}
              </span>
            )
          ) : (
            <Button
              variant="outline"
              className={cn(TAP, "border-acr-warn text-acr-warn-soft-ink hover:bg-acr-warn-soft")}
              onClick={() => setPauseOpen(true)}
              disabled={pause.isPending}
              data-testid="button-pax-pause"
            >
              <PauseCircle className="w-4 h-4 mr-2" aria-hidden="true" />
              {PAX_PAGE_COPY.pauseButton}
            </Button>
          )}
        </CardContent>
        <CardContent className="px-4 pb-4 pt-0 grid gap-4 md:grid-cols-2">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              {PAX_PAGE_COPY.whatPauseStops}
            </h2>
            <ul className="text-sm space-y-1" data-testid="pax-pause-stops">
              {pauseStops.map((p) => (
                <li key={p.id} data-testid={`pause-stops-${p.id}`} className="flex gap-2">
                  <MinusCircle className="w-4 h-4 mt-0.5 shrink-0 text-acr-warn" aria-hidden="true" />
                  <span>
                    <span className="font-medium">{p.label}</span>
                    <span className="text-muted-foreground"> — {p.whilePaused}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              {PAX_PAGE_COPY.whatPauseKeeps}
            </h2>
            <ul className="text-sm space-y-1" data-testid="pax-pause-keeps">
              {pauseKeeps.map((p) => (
                <li key={p.id} data-testid={`pause-keeps-${p.id}`} className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-acr-pos" aria-hidden="true" />
                  <span>
                    <span className="font-medium">{p.label}</span>
                    <span className="text-muted-foreground"> — {p.whilePaused}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground mt-2" data-testid="pax-pause-still-works">
              {PAX_PAUSE_COPY.stillWorks}
            </p>
          </div>
        </CardContent>
      </Card>

      <Dialog open={pauseOpen} onOpenChange={setPauseOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm" data-testid="pax-pause-dialog">
          <DialogHeader>
            <DialogTitle>{PAX_PAGE_COPY.pauseUntilPrompt}</DialogTitle>
            <DialogDescription>{PAX_PAUSE_COPY.stillWorks}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {(Object.keys(PAX_PAUSE_OPTIONS) as PaxPauseOption[]).map((key, idx) => (
              <Button
                key={key}
                variant={idx === 0 ? "default" : "outline"}
                className={cn(TAP, "justify-between")}
                autoFocus={idx === 0}
                onClick={() => pause.mutate(key)}
                disabled={pause.isPending}
                data-testid={`button-pause-${key}`}
              >
                <span>{PAX_PAUSE_OPTIONS[key]}</span>
                {key === "30d" && (
                  <span className="text-xs font-normal opacity-80">{PAX_PAGE_COPY.pauseOptionLiftNote}</span>
                )}
              </Button>
            ))}
            <Button variant="ghost" className={TAP} onClick={() => setPauseOpen(false)}>
              {PAX_PAGE_COPY.cancel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── 2. When Pax asks ────────────────────────────────────────────── */}
      <Card className="rounded-card mb-4" data-testid="pax-stance-card">
        <CardHeader>
          <CardTitle className="text-section-h2">{PAX_PAGE_COPY.whenPaxAsks}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ToggleGroup
            type="single"
            value={stance}
            onValueChange={(v) => {
              if (v && v !== stance && OFFERED_STANCES.includes(v as PaxStance)) patch.mutate({ stance: v as PaxStance });
            }}
            disabled={!canEdit}
            aria-label={PAX_PAGE_COPY.whenPaxAsks}
            className="justify-start flex-wrap gap-2"
            data-testid="pax-stance-control"
          >
            {OFFERED_STANCES.map((s) => (
              <ToggleGroupItem
                key={s}
                value={s}
                variant="outline"
                className={cn(TAP, "px-4 data-[state=on]:bg-acr-brand-soft data-[state=on]:text-acr-brand-soft-ink")}
                data-testid={`stance-option-${s}`}
              >
                {STANCE_LABELS[s]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-sm" data-testid="pax-stance-sentence">
            {PAX_STANCE_COPY[stance].sentence}
          </p>
          {!data.canChangeStance && (
            <p className="text-xs text-muted-foreground" data-testid="pax-stance-read-only">
              {PAX_PAGE_COPY.askAnOwner}
            </p>
          )}
          <p className="text-sm text-muted-foreground tabular-nums" data-testid="pax-right-now">
            <span className="font-medium text-foreground">{PAX_PAGE_COPY.rightNowLabel}: </span>
            {PAX_PAGE_COPY.rightNow(data.rightNow)}
          </p>
          <p className="text-sm border-l-2 border-acr-brand pl-3" data-testid="pax-fixed-rule">
            {PAX_LABELS.fixedRule}
          </p>
        </CardContent>
      </Card>

      {/* ── 3. What runs on its own ─────────────────────────────────────── */}
      <Card className="rounded-card mb-4" data-testid="pax-runs-card">
        <CardHeader>
          <CardTitle className="text-section-h2">{PAX_PAGE_COPY.runsOnItsOwn}</CardTitle>
          <CardDescription>{PAX_PAGE_COPY.runsOnItsOwnIntro}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {/* Workflows — switches live on /workflows */}
          <RunRow
            testId="run-row-workflows"
            label={PAX_PAGE_COPY.workflows}
            line={PAX_PAGE_COPY.workflowsLine({
              active: runs.workflows.active,
              live: runs.workflows.live,
              lastRan: runs.workflows.lastRanAt ? formatRelative(runs.workflows.lastRanAt) : null,
            })}
            badge={runs.workflows.active > runs.workflows.live ? PAX_LABELS.notYetLive : null}
            control={
              <Button asChild variant="outline" size="sm" className={TAP}>
                <Link href="/workflows">
                  {PAX_PAGE_COPY.switchesLiveOn(PAX_PAGE_COPY.workflows)}
                  <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </Button>
            }
          />
          {/* Campaign sequences — per-enrollment pause lives on /campaigns */}
          <RunRow
            testId="run-row-sequences"
            label={PAX_PAGE_COPY.sequences}
            line={PAX_PAGE_COPY.sequencesLine({
              activeEnrollments: runs.sequences.activeEnrollments,
              lastSend: runs.sequences.lastSendAt ? formatRelative(runs.sequences.lastSendAt) : null,
            })}
            control={
              <Button asChild variant="outline" size="sm" className={TAP}>
                <Link href="/campaigns">
                  {PAX_PAGE_COPY.switchesLiveOn("Campaigns")}
                  <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </Button>
            }
          />
          {/* Scheduled prompts — inline, each with its own switch */}
          <div className="px-4 py-3" data-testid="run-row-scheduled-prompts">
            <div className="text-sm font-medium">{PAX_PAGE_COPY.scheduledPrompts}</div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {PAX_PAGE_COPY.scheduledPromptsLine({ on: promptsOn, total: runs.scheduledPrompts.length })}
            </div>
            <ScheduledPrompts prompts={runs.scheduledPrompts} />
          </div>
          {/* Lead scoring — org switch */}
          <SwitchRow
            testId="run-row-lead-scoring"
            id="switch-lead-scoring"
            label={PAX_PAGE_COPY.leadScoring}
            line={PAX_PAGE_COPY.leadScoringLine({
              lastRan: runs.leadScoring.lastRanAt ? formatRelative(runs.leadScoring.lastRanAt) : null,
              rescoredToday: runs.leadScoring.rescoredToday,
            })}
            checked={data.switches.leadScoring}
            disabled={!canEdit}
            onChange={(on) => patch.mutate({ leadScoring: on })}
          />
          {/* Borrower reminders — preparation only; dispatch always asks */}
          <SwitchRow
            testId="run-row-borrower-reminders"
            id="switch-borrower-reminders"
            label={PAX_PAGE_COPY.borrowerReminders}
            line={PAX_PAGE_COPY.borrowerRemindersLine({ waiting: runs.borrowerReminders.waiting })}
            checked={data.switches.borrowerReminders}
            disabled={!canEdit}
            onChange={(on) => patch.mutate({ borrowerReminders: on })}
          />
          {/* Inbox reply drafts */}
          <SwitchRow
            testId="run-row-inbox-drafts"
            id="switch-inbox-drafts"
            label={PAX_PAGE_COPY.inboxDrafts}
            line={PAX_PAGE_COPY.inboxDraftsLine}
            checked={data.switches.inboxDrafts}
            disabled={!canEdit}
            onChange={(on) => patch.mutate({ inboxDrafts: on })}
          />
          {/* Fixed rules — read-only, usage from the send log */}
          <RunRow
            testId="run-row-fixed-rules"
            label={PAX_PAGE_COPY.fixedRules}
            line={PAX_PAGE_COPY.fixedRulesLine(runs.fixedRules)}
          />
        </CardContent>
      </Card>

      {/* ── 4. What Pax can use ─────────────────────────────────────────── */}
      <Connections />

      {/* ── 5. Waiting for your tap · What Pax did · Team ───────────────── */}
      <Card className="rounded-card mb-4" data-testid="pax-links-card">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-sm font-medium">{PAX_LABELS.queue}</div>
              <div className="text-xs text-muted-foreground">{PAX_PAGE_COPY.waitingHint}</div>
            </div>
            <Button asChild variant="default" className={TAP}>
              <Link href={QUEUE_PATH} data-testid="link-pax-waiting">
                {PAX_PAGE_COPY.waitingLink(data.rightNow.waiting)}
                <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </Button>
          </div>
          <Receipts />
          <div className="flex items-center justify-between gap-3 flex-wrap border-t pt-4">
            <div className="text-sm font-medium">{PAX_PAGE_COPY.teamLink}</div>
            <Button asChild variant="outline" size="sm" className={TAP}>
              <Link href={TEAM_PATH} data-testid="link-pax-team">
                {PAX_PAGE_COPY.teamHint}
                <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── 6. Never ────────────────────────────────────────────────────── */}
      <Card className="rounded-card" data-testid="pax-never-card">
        <CardHeader>
          <CardTitle className="text-section-h2">{PAX_GROUP_COPY.never.label}</CardTitle>
          <CardDescription>{PAX_PAGE_COPY.neverLead}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="text-sm space-y-1" data-testid="pax-never-list">
            {PAX_NEVER_LIST.map((n) => (
              <li key={n.id} data-testid={`never-${n.id}`} className="flex gap-2">
                <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-acr-neg" aria-hidden="true" />
                <span>{n.line}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm font-medium mt-3">{PAX_LABELS.notEvenIfYouAsk}</p>
        </CardContent>
      </Card>
    </PageShell>
  );
}

export default PaxControls;

// ── Rows ───────────────────────────────────────────────────────────────────

function RunRow({
  testId,
  label,
  line,
  badge,
  control,
}: {
  testId: string;
  label: string;
  line: string;
  badge?: string | null;
  control?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap" data-testid={testId}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
          {label}
          {badge && (
            <Badge variant="secondary" className="text-[10px] border-transparent bg-acr-warn-soft text-acr-warn-soft-ink">
              {badge}
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground tabular-nums" data-testid={`${testId}-line`}>
          {line}
        </div>
      </div>
      {control}
    </div>
  );
}

function SwitchRow({
  testId,
  id,
  label,
  line,
  checked,
  disabled,
  onChange,
}: {
  testId: string;
  id: string;
  label: string;
  line: string;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="px-4 py-3 flex items-start justify-between gap-3" data-testid={testId}>
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="text-sm font-medium cursor-pointer">
          {label}
        </Label>
        <div className="text-xs text-muted-foreground tabular-nums" data-testid={`${testId}-line`}>
          {line}
        </div>
      </div>
      <div className="min-h-11 flex items-center">
        <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} data-testid={id} />
      </div>
    </div>
  );
}

// ── Scheduled prompts (moved here from the deleted pax-tasks-settings-tab) ──

function ScheduledPrompts({ prompts }: { prompts: ScheduledPromptRow[] }) {
  const { toast } = useToast();
  const [historyOf, setHistoryOf] = React.useState<ScheduledPromptRow | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: CONTROLS_KEY });
    void queryClient.invalidateQueries({ queryKey: SCHEDULED_TASKS_KEY });
  };

  // PATCH /api/ai/scheduled-tasks/:id { isActive } — server/routes-ai.ts.
  // (The old tab's toggleMut POSTed a /toggle route that does not exist.)
  // allow-no-invalidation: refresh() invalidates CONTROLS_KEY and
  // SCHEDULED_TASKS_KEY; the rule cannot follow the helper.
  const setActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      await apiRequest("PATCH", `/api/ai/scheduled-tasks/${id}`, { isActive });
    },
    onSuccess: refresh,
    onError: (error: unknown) =>
      toast({ title: PAX_PAGE_COPY.couldNotChange, description: serverMessage(error), variant: "destructive" }),
  });

  // allow-no-invalidation: refresh() invalidates CONTROLS_KEY and
  // SCHEDULED_TASKS_KEY; the rule cannot follow the helper.
  const remove = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/ai/scheduled-tasks/${id}`);
    },
    onSuccess: () => {
      refresh();
      toast({ title: PAX_PAGE_COPY.promptDeleted });
    },
    onError: (error: unknown) =>
      toast({ title: PAX_PAGE_COPY.couldNotChange, description: serverMessage(error), variant: "destructive" }),
  });

  if (prompts.length === 0) {
    return (
      <p className="text-xs text-muted-foreground mt-2" data-testid="scheduled-prompts-empty">
        {PAX_PAGE_COPY.scheduledPromptsEmpty}
      </p>
    );
  }

  return (
    <>
      <ul className="mt-2 space-y-2" data-testid="scheduled-prompts-list">
        {prompts.map((p) => {
          const status = promptStatus(p.lastRunStatus);
          return (
            <li
              key={p.id}
              className={cn("border rounded-card px-3 py-2 flex items-start gap-3", !p.isActive && "opacity-70")}
              data-testid={`scheduled-prompt-${p.id}`}
            >
              <Clock className="w-4 h-4 mt-1 shrink-0 text-acr-brand" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">{p.name}</span>
                  {!p.isActive && (
                    <Badge variant="secondary" className="text-[10px] border-transparent">
                      {PAX_PAGE_COPY.promptPaused}
                    </Badge>
                  )}
                  {status && (
                    <Badge
                      variant="secondary"
                      className={cn("text-[10px]", TONE_CLASS[status.tone])}
                      data-testid={`scheduled-prompt-${p.id}-status`}
                    >
                      {status.label}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {p.lastRunAt ? PAX_PAGE_COPY.lastRan(formatRelative(p.lastRunAt)) : PAX_PAGE_COPY.noRunsYet}
                  {p.isActive && p.nextRunAt ? ` · ${PAX_PAGE_COPY.promptNextRun(formatDateTime(p.nextRunAt))}` : null}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  className={TAP}
                  onClick={() => setActive.mutate({ id: p.id, isActive: !p.isActive })}
                  disabled={setActive.isPending}
                  data-testid={`button-prompt-${p.isActive ? "pause" : "resume"}-${p.id}`}
                >
                  {p.isActive ? PAX_PAGE_COPY.promptPause : PAX_PAGE_COPY.promptResume}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-11 w-11 pointer-fine:sm:h-9 pointer-fine:sm:w-9"
                  onClick={() => setHistoryOf(p)}
                  aria-label={`${PAX_PAGE_COPY.promptHistory}: ${p.name}`}
                  data-testid={`button-prompt-history-${p.id}`}
                >
                  <History className="w-4 h-4" aria-hidden="true" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-11 w-11 pointer-fine:sm:h-9 pointer-fine:sm:w-9 text-muted-foreground hover:text-destructive"
                  onClick={() => remove.mutate(p.id)}
                  disabled={remove.isPending}
                  aria-label={`${PAX_PAGE_COPY.promptDelete}: ${p.name}`}
                  data-testid={`button-prompt-delete-${p.id}`}
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <RunHistorySheet prompt={historyOf} onClose={() => setHistoryOf(null)} />
    </>
  );
}

function RunHistorySheet({ prompt, onClose }: { prompt: ScheduledPromptRow | null; onClose: () => void }) {
  const runs = useQuery<TaskRun[]>({
    queryKey: [SCHEDULED_TASKS_KEY[0], prompt?.id ?? 0, "runs"],
    queryFn: () => getJson<TaskRun[]>(`/api/ai/scheduled-tasks/${prompt!.id}/runs`),
    enabled: prompt !== null,
    staleTime: 30_000,
  });

  return (
    <Sheet open={prompt !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-[420px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <History className="w-4 h-4 text-acr-brand" aria-hidden="true" />
            {prompt ? PAX_PAGE_COPY.runHistoryTitle(prompt.name) : PAX_PAGE_COPY.promptHistory}
          </SheetTitle>
          <p className="text-xs text-muted-foreground">{PAX_PAGE_COPY.runHistoryIntro}</p>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" data-testid="run-history-list">
          {runs.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : runs.isError ? (
            <QueryErrorState error={runs.error as Error} onRetry={() => void runs.refetch()} compact testId="run-history-error" />
          ) : (runs.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-10">{PAX_PAGE_COPY.runHistoryEmpty}</p>
          ) : (
            (runs.data ?? []).map((run) => {
              const status = promptStatus(run.status) ?? { label: run.status, tone: "neutral" as const };
              return (
                <div key={run.id} className="rounded-md border px-3 py-2 space-y-0.5" data-testid={`run-${run.id}`}>
                  <div className="flex items-center gap-2">
                    {status.tone === "ok" ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-acr-pos shrink-0" aria-hidden="true" />
                    ) : status.tone === "neutral" ? (
                      <MinusCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-acr-neg shrink-0" aria-hidden="true" />
                    )}
                    <span className="text-xs font-medium tabular-nums">{formatDateTime(run.runAt)}</span>
                    <span className={cn("ml-auto text-[10px] font-medium rounded px-1.5 py-0.5", TONE_CLASS[status.tone])}>
                      {status.label}
                    </span>
                    {run.durationMs ? (
                      <span className="text-[10px] text-muted-foreground tabular-nums">{(run.durationMs / 1000).toFixed(1)}s</span>
                    ) : null}
                  </div>
                  {run.summary && <p className="text-xs text-muted-foreground line-clamp-2 pl-5">{run.summary}</p>}
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── What Pax can use (moved here from the deleted autopilot-setup) ─────────

function Connections() {
  const byok = useQuery<ByokResponse>({
    queryKey: ["/api/byok"],
    queryFn: () => getJson<ByokResponse>("/api/byok"),
  });
  const mailbox = useQuery<MailboxResponse>({
    queryKey: ["/api/mailbox"],
    queryFn: () => getJson<MailboxResponse>("/api/mailbox"),
  });

  const ownChannels = new Set((byok.data?.channels ?? []).filter((c) => c.status === "byok").map((c) => c.channel));
  const inboxConnected = (mailbox.data?.mailboxes?.length ?? 0) > 0;
  const pending = byok.isLoading || mailbox.isLoading;

  const rows: Array<{ key: string; label: string; icon: typeof MessageSquare; connected: boolean }> = [
    ...CAPABILITIES.map((c) => ({
      key: c.key,
      label: PAX_PAGE_COPY.capabilities[c.key],
      icon: c.icon,
      connected: c.channels.some((ch) => ownChannels.has(ch)),
    })),
    { key: "inbox", label: PAX_PAGE_COPY.capabilities.inbox, icon: Inbox, connected: inboxConnected },
  ];

  return (
    <Card className="rounded-card mb-4" data-testid="pax-connections-card">
      <CardHeader>
        <CardTitle className="text-section-h2">{PAX_PAGE_COPY.canUse}</CardTitle>
        <CardDescription>{PAX_PAGE_COPY.canUseIntro}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y p-0">
        {rows.map((r) => {
          const Icon = r.icon;
          return (
            <div key={r.key} className="px-4 py-2.5 flex items-center justify-between gap-3" data-testid={`connection-${r.key}`}>
              <div className="flex items-center gap-3 min-w-0">
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                <span className="text-sm truncate">{r.label}</span>
              </div>
              {pending ? (
                <Skeleton className="h-8 w-24" />
              ) : r.connected ? (
                <Badge variant="default" className="bg-acr-pos text-acr-brand-ink hover:bg-acr-pos">
                  <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" /> {PAX_PAGE_COPY.connected}
                </Badge>
              ) : (
                <Button asChild variant="outline" size="sm" className={TAP}>
                  <Link href={BYOK_PATH}>
                    {PAX_PAGE_COPY.connect} <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── What Pax did (GET /api/pax/receipts) ───────────────────────────────────

function Receipts() {
  const receipts = useQuery<ReceiptsPage>({
    queryKey: RECEIPTS_KEY,
    queryFn: () => getJson<ReceiptsPage>(`/api/pax/receipts?limit=${RECEIPTS_LIMIT}`),
  });

  return (
    <div className="border-t pt-4" data-testid="pax-receipts">
      <div className="text-sm font-medium">{PAX_LABELS.receipts}</div>
      <div className="text-xs text-muted-foreground mb-2">{PAX_PAGE_COPY.receiptsHint}</div>
      {receipts.isLoading ? (
        <div className="space-y-2" data-testid="pax-receipts-loading">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : receipts.isError ? (
        <QueryErrorState error={receipts.error as Error} onRetry={() => void receipts.refetch()} compact testId="pax-receipts-error" />
      ) : (receipts.data?.items ?? []).length === 0 ? (
        <EmptyState
          icon={History}
          headline={PAX_LABELS.receipts}
          subtitle={PAX_PAGE_COPY.receiptsEmpty}
          // TODO(cta): receipts are written by Pax and the rules; no user action creates one.
          cta={{ label: "", _noOp: true }}
          actionIcon={null}
          testId="pax-receipts-empty"
        />
      ) : (
        <ul className="space-y-1.5" data-testid="pax-receipts-list">
          {(receipts.data?.items ?? []).map((r) => (
            <li key={r.id} className="text-sm flex gap-2 flex-wrap items-baseline" data-testid={`receipt-${r.id}`}>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">{formatRelative(r.at)}</span>
              <span className="min-w-0 flex-1">{r.summary}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {r.entityLabel ?? `${r.entityType} #${r.entityId}`}
              </span>
              <Badge variant="secondary" className="text-[10px] border-transparent shrink-0">
                {RECEIPT_MODE_WORD[r.mode] ?? r.mode}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
