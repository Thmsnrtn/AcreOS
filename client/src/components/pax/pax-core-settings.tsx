/**
 * Pax core on Settings → Pax (E2 slice 1): how much Pax does on its own
 * (presets, with an honest preview), rails, shadow mode, the business memory
 * panel, and the trust ledger.
 *
 * Every number here comes from the org's own rows (GET /api/pax/core/*). A
 * preview with no history says so; it never shows synthetic numbers. Stand-
 * down is the Pause at the top of this page — reported here, not duplicated.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Brain, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import type { PaxBusinessMemoryItem } from "@shared/schema";
import {
  PAX_MEMORY_CATEGORIES,
  MEMORY_CONTENT_MAX,
  PAX_LEDGER_WORDS,
  PAX_MEMORY_CATEGORY_WORDS,
  RAIL_TEXT_MAX,
  type PaxPreset,
  type PaxPresetId,
} from "@shared/pax-core";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/error-utils";
import { formatDateTime } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";

const TAP = "min-h-11 pointer-fine:sm:min-h-9";

interface RailView {
  key: string;
  text: string;
  active: boolean;
  governs: string;
  updatedAt: string | null;
}

interface AutonomyResponse {
  presets: PaxPreset[];
  preset: PaxPresetId;
  shadowMode: boolean;
  readFailed: boolean;
  rails: RailView[];
  standDown: { active: boolean; until: string | null; checkFailed: boolean };
}

interface PreviewResponse {
  preset: PaxPresetId;
  windowDays: number;
  hasHistory: boolean;
  prepared: number;
  shadow: number;
  wouldHavePrepared: number;
  wouldHaveBeenShadowOrSkipped: number;
}

interface TimelineEntry {
  key: string;
  event: string;
  actor: string;
  shadow: boolean;
  detail: Record<string, unknown>;
  at: string;
}

type MemoryWire = Omit<PaxBusinessMemoryItem, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

const AUTONOMY_KEY = ["/api/pax/core/autonomy"] as const;
const MEMORY_KEY = ["/api/pax/core/memory"] as const;
const LEDGER_KEY = ["/api/pax/core/ledger"] as const;

function invalidateCore() {
  queryClient.invalidateQueries({ queryKey: AUTONOMY_KEY });
  queryClient.invalidateQueries({ queryKey: LEDGER_KEY });
}

function useCoreMutation<TVars>(fn: (vars: TVars) => Promise<unknown>, done?: () => void) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      invalidateCore();
      done?.();
    },
    onError: (error) => toast({ title: "Couldn't save that", description: getErrorMessage(error), variant: "destructive" }),
  });
}

// ── Presets ─────────────────────────────────────────────────────────────────

function PreviewLine({ preset }: { preset: PaxPresetId }) {
  const q = useQuery<PreviewResponse>({ queryKey: [`/api/pax/core/autonomy/preview?preset=${preset}`] });
  if (q.isLoading) return <Skeleton className="h-4 w-2/3" />;
  if (q.isError || !q.data) return <p className="text-xs text-acr-ink-3">The preview could not be read.</p>;
  const p = q.data;
  if (!p.hasHistory) {
    return (
      <p className="text-xs text-acr-ink-3" data-testid="preset-preview-empty">
        No history to preview yet — Pax has prepared nothing in the last {p.windowDays} days.
      </p>
    );
  }
  return (
    <p className="text-xs text-acr-ink-3" data-testid="preset-preview">
      Last {p.windowDays} days: Pax prepared {p.prepared} and recorded {p.shadow} shadow{" "}
      {p.shadow === 1 ? "entry" : "entries"}. Under this setting it would have prepared {p.wouldHavePrepared}; the
      other {p.wouldHaveBeenShadowOrSkipped} would have been shadow entries or skipped.
    </p>
  );
}

function PresetsCard({ data, canEdit }: { data: AutonomyResponse; canEdit: boolean }) {
  const [considering, setConsidering] = useState<PaxPresetId | null>(null);
  const save = useCoreMutation(
    (preset: PaxPresetId) => apiRequest("PUT", "/api/pax/core/autonomy/preset", { preset }),
    () => setConsidering(null),
  );
  return (
    <Card className="rounded-card mb-4" data-testid="pax-presets-card">
      <CardHeader>
        <CardTitle className="text-section-h2">What Pax does on its own</CardTitle>
        <CardDescription>
          This is separate from when Pax asks above: in every setting, sends wait for your tap.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.presets.map((p) => {
          const current = p.id === data.preset;
          return (
            <div
              key={p.id}
              className={`rounded-md border p-3 ${current ? "border-primary" : "border-[color:var(--acr-line-soft)]"}`}
              data-testid={`preset-${p.id}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{p.label}</h3>
                {current && <Badge>In use</Badge>}
                {!p.selectable && <Badge variant="outline">Not available yet</Badge>}
              </div>
              <dl className="mt-2 grid gap-1 text-sm">
                <div><dt className="inline font-medium">Will do: </dt><dd className="inline text-acr-ink-2">{p.willDo}</dd></div>
                <div><dt className="inline font-medium">Will never: </dt><dd className="inline text-acr-ink-2">{p.willNeverDo}</dd></div>
                <div><dt className="inline font-medium">Asks first: </dt><dd className="inline text-acr-ink-2">{p.asksFirst}</dd></div>
              </dl>
              {p.notYet && <p className="mt-2 text-xs text-acr-ink-3">{p.notYet}</p>}
              {p.selectable && !current && (
                <div className="mt-2 space-y-2">
                  {considering === p.id ? (
                    <>
                      <PreviewLine preset={p.id} />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className={TAP}
                          disabled={!canEdit || save.isPending}
                          onClick={() => save.mutate(p.id)}
                          data-testid={`button-preset-confirm-${p.id}`}
                        >
                          Switch to {p.label}
                        </Button>
                        <Button size="sm" variant="ghost" className={TAP} onClick={() => setConsidering(null)}>
                          Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className={TAP}
                      disabled={!canEdit}
                      onClick={() => setConsidering(p.id)}
                      data-testid={`button-preset-${p.id}`}
                    >
                      Use {p.label}
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!canEdit && <p className="text-xs text-acr-ink-3">Only an owner or admin can change this.</p>}
      </CardContent>
    </Card>
  );
}

// ── Rails ───────────────────────────────────────────────────────────────────

function RailRow({ rail, canEdit }: { rail: RailView; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rail.text);
  const save = useCoreMutation(
    (text: string) => apiRequest("PATCH", `/api/pax/core/rails/${rail.key}`, { text }),
    () => setEditing(false),
  );
  const toggle = useCoreMutation((active: boolean) =>
    apiRequest("POST", `/api/pax/core/rails/${rail.key}/${active ? "restore" : "revoke"}`),
  );
  const inputId = `rail-text-${rail.key}`;
  return (
    <li className="py-3 space-y-2" data-testid={`rail-${rail.key}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={rail.active ? "default" : "outline"}>{rail.active ? "In force" : "Revoked"}</Badge>
      </div>
      {editing ? (
        <div className="space-y-2">
          <Label htmlFor={inputId}>Your rail, in your words</Label>
          <Textarea
            id={inputId}
            value={draft}
            maxLength={RAIL_TEXT_MAX}
            onChange={(e) => setDraft(e.target.value)}
            data-testid={`input-rail-${rail.key}`}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className={TAP}
              disabled={save.isPending || draft.trim().length === 0}
              onClick={() => save.mutate(draft.trim())}
              data-testid={`button-rail-save-${rail.key}`}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" className={TAP} onClick={() => { setDraft(rail.text); setEditing(false); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className={`text-[15px] ${rail.active ? "" : "text-acr-ink-3 line-through"}`} data-testid={`text-rail-${rail.key}`}>
          {rail.text}
        </p>
      )}
      <p className="text-xs text-acr-ink-3">{rail.governs}</p>
      {canEdit && !editing && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className={TAP} onClick={() => setEditing(true)} data-testid={`button-rail-edit-${rail.key}`}>
            <Pencil className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={TAP}
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(!rail.active)}
            data-testid={`button-rail-${rail.active ? "revoke" : "restore"}-${rail.key}`}
          >
            {rail.active ? "Revoke" : "Restore"}
          </Button>
        </div>
      )}
    </li>
  );
}

function RailsCard({ data, canEdit }: { data: AutonomyResponse; canEdit: boolean }) {
  return (
    <Card className="rounded-card mb-4" data-testid="pax-rails-card">
      <CardHeader>
        <CardTitle className="text-section-h2">Rails</CardTitle>
        <CardDescription>
          What Pax may prepare without being asked. A rail never lets Pax send, pay or change anything on its own.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y divide-[color:var(--acr-line-soft)]">
          {data.rails.map((r) => (
            <RailRow key={`${r.key}-${r.updatedAt ?? "default"}`} rail={r} canEdit={canEdit} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ── Shadow mode + stand-down state ──────────────────────────────────────────

function ShadowCard({ data, canEdit }: { data: AutonomyResponse; canEdit: boolean }) {
  const save = useCoreMutation((on: boolean) => apiRequest("PUT", "/api/pax/core/autonomy/shadow", { on }));
  return (
    <Card className="rounded-card mb-4" data-testid="pax-shadow-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="pax-shadow-switch" className="text-sm font-semibold">Shadow mode</Label>
            <p className="text-sm text-acr-ink-3">
              Pax records, in the ledger below, the work it would have prepared under rails or a setting you have not
              granted. Shadow entries are never shown as prepared work and never run.
            </p>
          </div>
          <Switch
            id="pax-shadow-switch"
            checked={data.shadowMode}
            disabled={!canEdit || save.isPending}
            onCheckedChange={(on) => save.mutate(on)}
            data-testid="switch-pax-shadow"
          />
        </div>
        <p className="text-xs text-acr-ink-3" data-testid="text-pax-stand-down">
          {data.standDown.active
            ? `Stand-down is on (Pax is paused${data.standDown.until ? ` until ${formatDateTime(data.standDown.until)}` : ""}): nothing is prepared and no shadow entries accrue.`
            : "Stand-down: the Pause at the top of this page stops all preparation and shadow entries at once."}
        </p>
      </CardContent>
    </Card>
  );
}

// ── Memory ──────────────────────────────────────────────────────────────────

function CategorySelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className={`w-44 ${TAP}`} aria-label="Category">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PAX_MEMORY_CATEGORIES.map((c) => (
          <SelectItem key={c} value={c}>{PAX_MEMORY_CATEGORY_WORDS[c]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MemoryRow({ item }: { item: MemoryWire }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(item.content);
  const [category, setCategory] = useState<string>(item.category);
  const done = () => {
    queryClient.invalidateQueries({ queryKey: MEMORY_KEY });
    queryClient.invalidateQueries({ queryKey: LEDGER_KEY });
  };
  const onError = (error: unknown) =>
    toast({ title: "Couldn't save that", description: getErrorMessage(error), variant: "destructive" });
  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/pax/core/memory/${item.id}`, { content: content.trim(), category }),
    onSuccess: () => { done(); setEditing(false); },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/pax/core/memory/${item.id}`),
    onSuccess: done,
    onError,
  });
  const inputId = `memory-edit-${item.id}`;
  return (
    <li className="py-3 space-y-2" data-testid={`memory-item-${item.id}`}>
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{PAX_MEMORY_CATEGORY_WORDS[item.category] ?? "Other"}</Badge>
        {item.source === "pax-proposed" && <span className="text-xs text-acr-ink-3">Suggested by Pax, approved by you</span>}
        <div className="ml-auto flex gap-1">
          {!editing && (
            <Button
              size="icon"
              variant="ghost"
              className="min-h-11 min-w-11"
              aria-label="Edit this memory"
              onClick={() => setEditing(true)}
              data-testid={`button-memory-edit-${item.id}`}
            >
              <Pencil className="w-4 h-4" aria-hidden="true" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="min-h-11 min-w-11"
            aria-label="Delete this memory"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
            data-testid={`button-memory-delete-${item.id}`}
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      {editing ? (
        <div className="space-y-2">
          <CategorySelect id={`${inputId}-category`} value={category} onChange={setCategory} />
          <Label htmlFor={inputId} className="sr-only">Memory</Label>
          <Textarea id={inputId} value={content} maxLength={MEMORY_CONTENT_MAX} onChange={(e) => setContent(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" className={TAP} disabled={save.isPending || !content.trim()} onClick={() => save.mutate()}>Save</Button>
            <Button size="sm" variant="ghost" className={TAP} onClick={() => { setContent(item.content); setCategory(item.category); setEditing(false); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-[15px] whitespace-pre-wrap">{item.content}</p>
      )}
    </li>
  );
}

function MemoryCard() {
  const { toast } = useToast();
  const q = useQuery<{ items: MemoryWire[] }>({ queryKey: MEMORY_KEY });
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<string>("buy_box");
  const add = useMutation({
    mutationFn: () => apiRequest("POST", "/api/pax/core/memory", { category, content: content.trim() }),
    onSuccess: () => {
      setContent("");
      queryClient.invalidateQueries({ queryKey: MEMORY_KEY });
      queryClient.invalidateQueries({ queryKey: LEDGER_KEY });
    },
    onError: (error) => toast({ title: "Couldn't save that", description: getErrorMessage(error), variant: "destructive" }),
  });
  const focusAdd = () => document.getElementById("memory-new-content")?.focus();
  return (
    <Card className="rounded-card mb-4" id="pax-memory" data-testid="pax-memory-card">
      <CardHeader>
        <CardTitle className="text-section-h2">Memory</CardTitle>
        <CardDescription>
          What Pax knows about your business. Pax only adds to it when you approve a suggestion; everything here is yours
          to edit or delete. Pax reads it as information, never as instructions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="space-y-2 rounded-md border border-[color:var(--acr-line-soft)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <CategorySelect id="memory-new-category" value={category} onChange={setCategory} />
          </div>
          <Label htmlFor="memory-new-content">Add something Pax should know</Label>
          <Textarea
            id="memory-new-content"
            value={content}
            maxLength={MEMORY_CONTENT_MAX}
            onChange={(e) => setContent(e.target.value)}
            placeholder="e.g. I buy 5–40 acre rural parcels in Maine under $30k"
            data-testid="input-memory-new"
          />
          <Button size="sm" className={TAP} disabled={add.isPending || !content.trim()} onClick={() => add.mutate()} data-testid="button-memory-add">
            Add to memory
          </Button>
        </div>
        {q.isLoading ? (
          <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
        ) : q.isError ? (
          <QueryErrorState error={q.error as Error} onRetry={() => q.refetch()} compact testId="memory-error" />
        ) : (q.data?.items ?? []).length === 0 ? (
          <EmptyState
            icon={Brain}
            headline="Pax remembers nothing about your business yet"
            subtitle="Add your buy box, the people you work with or how you like things written."
            cta={{ label: "Add a memory", onClick: focusAdd }}
            data-testid="memory-empty"
          />
        ) : (
          <ul className="divide-y divide-[color:var(--acr-line-soft)]">
            {q.data!.items.map((m) => <MemoryRow key={`${m.id}-${m.updatedAt}`} item={m} />)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── Trust ledger ────────────────────────────────────────────────────────────

function ledgerLine(e: TimelineEntry): string {
  const words = PAX_LEDGER_WORDS[e.event as keyof typeof PAX_LEDGER_WORDS] ?? e.event;
  const title = typeof e.detail.title === "string" ? `: ${e.detail.title}` : "";
  if (e.event === "preset_changed") return `${words}: ${String(e.detail.from)} → ${String(e.detail.to)}`;
  if (e.event === "shadow_recorded") {
    const why = e.detail.reason === "watch_only" ? " (Watch only)" : e.detail.reason === "rail_revoked" ? " (rail revoked)" : "";
    return `${words}${title}${why}`;
  }
  if (e.event === "memory_created" || e.event === "memory_edited" || e.event === "memory_deleted") {
    const c = PAX_MEMORY_CATEGORY_WORDS[String(e.detail.category)] ?? "";
    return c ? `${words} (${c})` : words;
  }
  if (typeof e.detail.description === "string") return `${words} — ${e.detail.description}`;
  return `${words}${title}`;
}

function LedgerCard() {
  const q = useQuery<{ entries: TimelineEntry[] }>({ queryKey: LEDGER_KEY });
  return (
    <Card className="rounded-card mb-4" data-testid="pax-ledger-card">
      <CardHeader>
        <CardTitle className="text-section-h2">Trust ledger</CardTitle>
        <CardDescription>Everything Pax prepared, what you decided, and every change to these settings.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {q.isLoading ? (
          <div className="space-y-2"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-full" /></div>
        ) : q.isError ? (
          <QueryErrorState error={q.error as Error} onRetry={() => q.refetch()} compact testId="ledger-error" />
        ) : (q.data?.entries ?? []).length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            headline="Nothing recorded yet"
            subtitle="When Pax prepares something or you change a setting here, it is recorded."
            // TODO(cta): a read-only record — there is nothing to do here until something happens.
            cta={{ label: "", _noOp: true }}
            data-testid="ledger-empty"
          />
        ) : (
          <ol className="space-y-2" data-testid="pax-ledger-list">
            {q.data!.entries.map((e) => (
              <li key={e.key} className="text-sm flex gap-3" data-testid={`ledger-entry-${e.event}`}>
                <span className="text-xs text-acr-ink-3 shrink-0 w-36">{formatDateTime(e.at)}</span>
                <span className={e.shadow ? "italic text-acr-ink-3" : ""}>{ledgerLine(e)}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export function PaxCoreSettings({ canEdit }: { canEdit: boolean }) {
  const q = useQuery<AutonomyResponse>({ queryKey: AUTONOMY_KEY });
  return (
    <div data-testid="pax-core-settings">
      {q.isLoading ? (
        <Skeleton className="h-40 w-full mb-4 rounded-card" />
      ) : q.isError || !q.data ? (
        <QueryErrorState error={(q.error as Error | null) ?? null} onRetry={() => q.refetch()} testId="pax-core-error" />
      ) : q.data.readFailed ? (
        <p className="text-sm text-acr-ink-3 mb-4">Your Pax settings could not be read just now; Pax prepares nothing until they can.</p>
      ) : (
        <>
          <PresetsCard data={q.data} canEdit={canEdit} />
          <RailsCard data={q.data} canEdit={canEdit} />
          <ShadowCard data={q.data} canEdit={canEdit} />
        </>
      )}
      <MemoryCard />
      <LedgerCard />
    </div>
  );
}
