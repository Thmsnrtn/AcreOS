/**
 * /outreach/mail · Compose tab.
 *
 * Vertical stack on mobile, two-column on desktop. Every input mutates the
 * draft state which feeds a debounced `useMailQuote` — so $/piece, totals,
 * and "saved vs Lob" update live as the user tunes the audience or speed.
 *
 * Mistake-resistance hooks built in:
 *   - Preview-all modal (Dialog) renders per-piece recipient + copy.
 *   - 30-minute hold banner after successful queue, with one-click Cancel.
 *   - Recent-mail dedupe modal if >20% of selected recipients have been
 *     mailed in the last 30d.
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardEdit,
  Clock,
  Eye,
  Mail as MailIcon,
  PenLine,
  Send,
  Sparkles,
  Truck,
  Users,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { staggerContainer, staggerItem } from "@/lib/animations";
import {
  type AudienceFilter,
  type MailSpeed,
  type PieceType,
  type QueueResponse,
  useCancelMailShipment,
  useMailQuote,
  useQueueMailShipment,
} from "@/hooks/use-outreach-mail";

// ── Static option metadata ──────────────────────────────────────────────────

const PIECE_TYPE_OPTIONS: { value: PieceType; label: string; sub: string; icon: typeof MailIcon }[] = [
  { value: "postcard_4x6", label: "Postcard 4×6", sub: "Highest-volume workhorse", icon: MailIcon },
  { value: "postcard_6x9", label: "Postcard 6×9", sub: "Larger format, higher recall", icon: MailIcon },
  { value: "letter_10", label: "Letter #10", sub: "Personalized, envelope", icon: ClipboardEdit },
  { value: "handwritten", label: "Handwritten", sub: "Premium touch", icon: PenLine },
];

const SPEED_OPTIONS: {
  value: MailSpeed;
  label: string;
  hint: string;
}[] = [
  { value: "next_day", label: "Next day", hint: "1-day ETA — overnight handoff" },
  { value: "standard", label: "Standard", hint: "5-day ETA — class-stamped" },
  { value: "batch_3d", label: "Batch (3-day)", hint: "Aggregated with same-day senders" },
  { value: "batch_weekly", label: "Batch (cheapest)", hint: "Weekly aggregation — lowest $/piece" },
  { value: "eddm_geo", label: "EDDM blast", hint: "Geo-target carrier walks (Round 4)" },
];

// ── Compose tab ─────────────────────────────────────────────────────────────

export default function ComposeTab() {
  const { toast } = useToast();

  // Audience selection
  const [selectedListIds, setSelectedListIds] = useState<number[]>([]);
  const [statesText, setStatesText] = useState("");
  const [countiesText, setCountiesText] = useState("");

  // Piece + speed + copy
  const [pieceType, setPieceType] = useState<PieceType>("postcard_4x6");
  const [speed, setSpeed] = useState<MailSpeed>("standard");
  const [copy, setCopy] = useState("");
  const [label, setLabel] = useState("");
  const [templateId, setTemplateId] = useState<number | null>(null);

  // UI state
  const [showPreview, setShowPreview] = useState(false);
  const [showDraftPanel, setShowDraftPanel] = useState(false);
  const [showDedupeWarn, setShowDedupeWarn] = useState(false);
  const [queuedShipment, setQueuedShipment] = useState<QueueResponse | null>(null);

  // Marketing lists for the audience picker.
  const lists = useQuery<{ id: number; name: string; totalRecords: number | null }[]>({
    queryKey: ["/api/marketing-lists"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/marketing-lists");
      const data = await res.json();
      return Array.isArray(data) ? data : data.lists ?? [];
    },
  });

  // Saved views (audience inputs) — keep optional; surface if present.
  const savedViews = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/saved-views"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", "/api/saved-views");
        const data = await res.json();
        return Array.isArray(data) ? data : data.views ?? [];
      } catch {
        return [];
      }
    },
    retry: false,
  });

  // Mail templates with response-rate badges (best-effort — the endpoint
  // doesn't exist yet so this is intentionally tolerant).
  const templates = useQuery<
    { id: number; name: string; responseRate?: number; campaigns?: number; sends?: number }[]
  >({
    queryKey: ["/api/outreach/mail/templates"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", "/api/outreach/mail/templates");
        const data = await res.json();
        return Array.isArray(data) ? data : data.templates ?? [];
      } catch {
        return [];
      }
    },
    retry: false,
  });

  // Build the audience filter snapshot we feed to the quote endpoint.
  const audienceFilter: AudienceFilter = useMemo(() => {
    const states = statesText
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length === 2);
    const counties = countiesText
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      leadListIds: selectedListIds.length > 0 ? selectedListIds : undefined,
      states: states.length > 0 ? states : undefined,
      counties: counties.length > 0 ? counties : undefined,
    };
  }, [selectedListIds, statesText, countiesText]);

  // Debounce the quote request so each keystroke doesn't fire a POST.
  const [debouncedFilter, setDebouncedFilter] = useState(audienceFilter);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilter(audienceFilter), 400);
    return () => clearTimeout(t);
  }, [audienceFilter]);

  const hasAudience =
    (debouncedFilter.leadListIds?.length ?? 0) > 0 ||
    (debouncedFilter.states?.length ?? 0) > 0 ||
    (debouncedFilter.counties?.length ?? 0) > 0;

  const quote = useMailQuote(
    hasAudience ? { audienceFilter: debouncedFilter, pieceType, speed } : null,
  );

  const queueMutation = useQueueMailShipment();
  const cancelMutation = useCancelMailShipment();

  const dedupeWarn =
    quote.data && quote.data.recentlyMailedFraction > 0.2 && quote.data.recentlyMailedCount > 0;

  const handleSend = async (force = false) => {
    if (!quote.data || quote.data.pieceCount === 0) return;
    if (dedupeWarn && !force) {
      setShowDedupeWarn(true);
      return;
    }
    try {
      const result = await queueMutation.mutateAsync({
        audienceFilter: debouncedFilter,
        pieceType,
        speed,
        templateId: templateId ?? undefined,
        copy: copy || undefined,
        label: label || undefined,
      });
      setQueuedShipment(result);
      setShowDedupeWarn(false);
      toast({
        title: "Queued",
        description: `${result.quote.pieceCount} pieces queued. Leaves in ${result.holdWindowMinutes} minutes.`,
      });
    } catch (err) {
      toast({
        title: "Couldn't queue mail",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleCancelHold = async () => {
    if (!queuedShipment) return;
    try {
      await cancelMutation.mutateAsync({ shipmentId: queuedShipment.shipmentId });
      setQueuedShipment(null);
      toast({ title: "Cancelled", description: "Shipment cancelled before send-off." });
    } catch (err) {
      toast({
        title: "Couldn't cancel",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="grid grid-cols-1 lg:grid-cols-3 gap-6"
      data-testid="compose-tab"
    >
      {/* ── Left column: builder sections ─────────────────────────────── */}
      <div className="lg:col-span-2 space-y-6">
        {/* Audience */}
        <motion.div variants={staggerItem}>
          <Card data-testid="card-audience">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-4 h-4" aria-hidden="true" />
                Audience
              </CardTitle>
              <CardDescription>
                Pick lists, saved views, or filter directly. Recipient count + cost update live.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="audience-lists" className="mb-2 block">
                  Lead lists
                </Label>
                {lists.isLoading ? (
                  <div className="space-y-2" data-testid="lists-loading">
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                  </div>
                ) : lists.error ? (
                  <QueryErrorState error={lists.error as Error} onRetry={() => lists.refetch()} compact />
                ) : (lists.data?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="lists-empty">
                    No lists yet. Import a CSV under Leads → Marketing lists.
                  </p>
                ) : (
                  <div
                    id="audience-lists"
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-label="Lead list selection"
                  >
                    {lists.data!.map((l) => {
                      const selected = selectedListIds.includes(l.id);
                      return (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() =>
                            setSelectedListIds((prev) =>
                              prev.includes(l.id) ? prev.filter((x) => x !== l.id) : [...prev, l.id],
                            )
                          }
                          aria-pressed={selected}
                          className={`px-3 py-1.5 rounded-full text-sm border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors ${
                            selected
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background hover:bg-muted border-border"
                          }`}
                          data-testid={`list-chip-${l.id}`}
                        >
                          {l.name}
                          {l.totalRecords ? ` · ${l.totalRecords.toLocaleString()}` : ""}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {(savedViews.data?.length ?? 0) > 0 && (
                <div>
                  <Label className="mb-2 block">Saved views</Label>
                  <div className="flex flex-wrap gap-2">
                    {savedViews.data!.map((v) => (
                      <Badge key={v.id} variant="secondary">
                        {v.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="audience-states">States (2-letter, comma-separated)</Label>
                  <Input
                    id="audience-states"
                    value={statesText}
                    onChange={(e) => setStatesText(e.target.value)}
                    placeholder="TX, OK, NM"
                    data-testid="input-states"
                  />
                </div>
                <div>
                  <Label htmlFor="audience-counties">Counties</Label>
                  <Input
                    id="audience-counties"
                    value={countiesText}
                    onChange={(e) => setCountiesText(e.target.value)}
                    placeholder="Hidalgo, Cameron"
                    data-testid="input-counties"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Piece type */}
        <motion.div variants={staggerItem}>
          <Card data-testid="card-piece-type">
            <CardHeader>
              <CardTitle>Piece type</CardTitle>
              <CardDescription>Per-piece cost reflects the current router quote.</CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                role="radiogroup"
                aria-label="Piece type"
              >
                {PIECE_TYPE_OPTIONS.map((opt) => {
                  const selected = pieceType === opt.value;
                  const showCost = quote.data && opt.value === pieceType;
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setPieceType(opt.value)}
                      className={`text-left p-4 rounded-lg border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors ${
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/40"
                      }`}
                      data-testid={`piece-type-${opt.value}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                        <span className="font-medium">{opt.label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{opt.sub}</p>
                      {showCost && (
                        <p className="text-sm mt-2 font-mono">
                          {formatUsd(quote.data!.perPieceCents)}/piece
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Templates */}
        <motion.div variants={staggerItem}>
          <Card data-testid="card-templates">
            <CardHeader>
              <CardTitle>Template</CardTitle>
              <CardDescription>Response rates are blended across all org campaigns.</CardDescription>
            </CardHeader>
            <CardContent>
              {templates.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : (templates.data?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="templates-empty">
                  No templates yet. Save your first copy below to start tracking response rates.
                </p>
              ) : (
                <ul className="space-y-2">
                  {templates.data!.map((t) => {
                    const selected = templateId === t.id;
                    return (
                      <li
                        key={t.id}
                        className={`p-3 rounded-md border flex items-center justify-between gap-3 ${
                          selected ? "border-primary bg-primary/5" : "border-border"
                        }`}
                        data-testid={`template-row-${t.id}`}
                      >
                        <div className="min-w-0">
                          <p className="font-medium truncate">{t.name}</p>
                          {t.responseRate !== undefined && (
                            <p className="text-xs text-muted-foreground">
                              {(t.responseRate * 100).toFixed(1)}% response rate
                              {t.campaigns !== undefined && t.sends !== undefined
                                ? ` (${t.campaigns} campaigns, ${t.sends.toLocaleString()} sends)`
                                : ""}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant={selected ? "default" : "outline"}
                            onClick={() => setTemplateId(selected ? null : t.id)}
                            aria-label={selected ? "Deselect template" : "Use template"}
                            data-testid={`template-use-${t.id}`}
                          >
                            {selected ? "Selected" : "Use"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Compare template ${t.name}`}
                            data-testid={`template-compare-${t.id}`}
                          >
                            Compare
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Copy */}
        <motion.div variants={staggerItem}>
          <Card data-testid="card-copy">
            <CardHeader>
              <CardTitle>Copy</CardTitle>
              <CardDescription>
                Free-text overrides the template. Use {"{firstName}"} / {"{city}"} for merge fields.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="compose-copy">Message</Label>
                <Textarea
                  id="compose-copy"
                  value={copy}
                  onChange={(e) => setCopy(e.target.value)}
                  rows={6}
                  placeholder="Hi {firstName}, we buy land in {city}…"
                  data-testid="textarea-copy"
                />
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDraftPanel(true)}
                  data-testid="button-draft-for-me"
                >
                  <Sparkles className="w-4 h-4 mr-2" aria-hidden="true" />
                  Draft for me
                </Button>
                <div className="flex-1" />
                <Label htmlFor="compose-label" className="text-xs text-muted-foreground">
                  Campaign label
                </Label>
                <Input
                  id="compose-label"
                  className="max-w-[16rem]"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Hidalgo absentees v3"
                  data-testid="input-label"
                />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Speed */}
        <motion.div variants={staggerItem}>
          <Card data-testid="card-speed">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="w-4 h-4" aria-hidden="true" />
                Speed
              </CardTitle>
              <CardDescription>
                Live $/piece + delivery ETA + total update as you switch.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={speed}
                onValueChange={(v) => setSpeed(v as MailSpeed)}
                className="grid grid-cols-1 gap-3"
                aria-label="Mail speed"
              >
                {SPEED_OPTIONS.map((opt) => {
                  const selected = speed === opt.value;
                  const isCurrent = selected && quote.data;
                  return (
                    <label
                      key={opt.value}
                      htmlFor={`speed-${opt.value}`}
                      className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer ${
                        selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                      }`}
                      data-testid={`speed-${opt.value}`}
                    >
                      <RadioGroupItem id={`speed-${opt.value}`} value={opt.value} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium">{opt.label}</span>
                          {isCurrent && (
                            <span className="text-xs font-mono text-muted-foreground">
                              {formatUsd(quote.data!.perPieceCents)}/piece · ETA{" "}
                              {quote.data!.deliveryEtaDays ?? "?"}d ·{" "}
                              {formatUsd(quote.data!.totalCents)}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{opt.hint}</p>
                      </div>
                    </label>
                  );
                })}
              </RadioGroup>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ── Right column: live cost + Send ─────────────────────────────── */}
      <aside className="space-y-6 lg:sticky lg:top-4 self-start">
        <Card data-testid="card-summary">
          <CardHeader>
            <CardTitle>Live cost</CardTitle>
            <CardDescription>Updates as filters + speed change.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!hasAudience ? (
              <p className="text-sm text-muted-foreground" data-testid="summary-empty">
                Pick a list or filter to see recipients + cost.
              </p>
            ) : quote.isLoading ? (
              <div className="space-y-2" data-testid="summary-loading">
                <Skeleton className="h-7 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : quote.error ? (
              <QueryErrorState
                error={quote.error as Error}
                onRetry={() => quote.refetch()}
                compact
              />
            ) : quote.data ? (
              <>
                <div>
                  <div className="text-2xl font-semibold font-mono" data-testid="summary-piece-count">
                    {quote.data.pieceCount.toLocaleString()}
                    <span className="text-sm font-normal text-muted-foreground ml-1">
                      recipients
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground" data-testid="summary-per-piece">
                    {formatUsd(quote.data.perPieceCents)}/piece via {quote.data.provider}
                  </div>
                </div>
                <div className="border-t pt-3">
                  <div className="text-xl font-mono" data-testid="summary-total">
                    {formatUsd(quote.data.totalCents)}
                  </div>
                  {quote.data.savedVsLobCents > 0 && (
                    <div className="text-sm text-acr-pos" data-testid="summary-savings">
                      Saved {formatUsd(quote.data.savedVsLobCents)} vs Lob
                    </div>
                  )}
                  {quote.data.deliveryEtaDays !== null && (
                    <div className="text-xs text-muted-foreground">
                      ETA {quote.data.deliveryEtaDays} day{quote.data.deliveryEtaDays === 1 ? "" : "s"}
                    </div>
                  )}
                </div>
                {dedupeWarn && (
                  <div
                    className="rounded-md border border-acr-warn/40 bg-acr-warn/10 p-3 text-sm flex gap-2"
                    role="alert"
                    data-testid="dedupe-warn"
                  >
                    <AlertTriangle className="w-4 h-4 text-acr-warn shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <p className="font-medium">Recent-mail overlap</p>
                      <p className="text-xs text-muted-foreground">
                        {quote.data.recentlyMailedCount} of {quote.data.pieceCount} were mailed in
                        the last 30 days.
                      </p>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card data-testid="card-send">
          <CardContent className="pt-6 space-y-2">
            <Button
              className="w-full"
              size="lg"
              disabled={
                !hasAudience ||
                quote.isLoading ||
                !quote.data ||
                quote.data.pieceCount === 0 ||
                queueMutation.isPending ||
                queuedShipment !== null
              }
              onClick={() => handleSend(false)}
              data-testid="button-send"
            >
              <Send className="w-4 h-4 mr-2" aria-hidden="true" />
              {quote.data
                ? `Queue ${quote.data.pieceCount} ${
                    quote.data.pieceCount === 1 ? "piece" : "pieces"
                  } for ${formatUsd(quote.data.totalCents)}`
                : "Queue"}
            </Button>
            {quote.data && quote.data.savedVsLobCents > 0 && (
              <p className="text-xs text-center text-muted-foreground">
                {formatUsd(quote.data.perPieceCents)}/piece — saved{" "}
                {formatUsd(quote.data.savedVsLobCents)} vs Lob
              </p>
            )}
            <Button
              variant="outline"
              className="w-full"
              disabled={!hasAudience || !quote.data || quote.data.pieceCount === 0}
              onClick={() => setShowPreview(true)}
              data-testid="button-preview-all"
            >
              <Eye className="w-4 h-4 mr-2" aria-hidden="true" />
              Preview all
            </Button>
          </CardContent>
        </Card>

        {queuedShipment && (
          <Card
            className="border-acr-warn/40 bg-acr-warn/5"
            data-testid="card-hold"
            role="status"
            aria-live="polite"
          >
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-acr-warn mt-0.5 shrink-0" aria-hidden="true" />
                <div className="flex-1">
                  <p className="font-medium text-sm">
                    This send will leave in {queuedShipment.holdWindowMinutes} minutes.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Cancel anytime before {new Date(queuedShipment.leavesAt).toLocaleTimeString()}.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleCancelHold}
                disabled={cancelMutation.isPending}
                data-testid="button-cancel-hold"
              >
                <X className="w-4 h-4 mr-2" aria-hidden="true" />
                Cancel send
              </Button>
            </CardContent>
          </Card>
        )}
      </aside>

      {/* ── Preview-all modal ────────────────────────────────────────────── */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Preview all</DialogTitle>
            <DialogDescription>
              {quote.data?.pieceCount.toLocaleString() ?? 0} pieces — recipient + rendered copy.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-auto flex-1">
            <PreviewList
              audienceFilter={debouncedFilter}
              copy={copy}
              show={showPreview}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPreview(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dedupe warning modal ─────────────────────────────────────────── */}
      <Dialog open={showDedupeWarn} onOpenChange={setShowDedupeWarn}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-acr-warn" aria-hidden="true" />
              Recent-mail overlap
            </DialogTitle>
            <DialogDescription>
              {quote.data?.recentlyMailedCount} of {quote.data?.pieceCount} selected recipients have
              been mailed in the last 30 days. Mailing again this soon usually lowers response
              rate.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDedupeWarn(false)}>
              Re-tune audience
            </Button>
            <Button onClick={() => handleSend(true)} data-testid="button-send-anyway">
              Send anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Draft-for-me side panel (Pax stub) ───────────────────────────── */}
      <Sheet open={showDraftPanel} onOpenChange={setShowDraftPanel}>
        <SheetContent side="right" className="sm:max-w-md w-full">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" aria-hidden="true" />
              Draft for me
            </SheetTitle>
            <SheetDescription>
              Pax will read the audience + piece type and propose three copy variants. Wired in a
              later round.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-3">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="rounded-md border p-3 space-y-2"
                data-testid={`draft-variant-${n}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Variant {n}</span>
                  <Badge variant="secondary">stub</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Variants will surface here when the Pax draft pipeline ships.
                </p>
                <Button size="sm" variant="outline" disabled aria-label={`Use draft variant ${n}`}>
                  <CheckCircle2 className="w-4 h-4 mr-2" aria-hidden="true" />
                  Use this variant
                </Button>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </motion.div>
  );
}

// ── Preview list ────────────────────────────────────────────────────────────

function PreviewList({
  audienceFilter,
  copy,
  show,
}: {
  audienceFilter: AudienceFilter;
  copy: string;
  show: boolean;
}) {
  // Reuse the quote endpoint's recipient resolution. For now we render
  // sample recipient slots; once /api/outreach/mail/preview lands in Round
  // 4 it will return rendered per-piece HTML.
  const preview = useQuery<{ recipients: { name: string; addressLine1: string; city: string; state: string; zip: string }[] }>({
    queryKey: ["/api/outreach/mail/preview", audienceFilter],
    enabled: show,
    queryFn: async () => {
      try {
        const res = await apiRequest("POST", "/api/outreach/mail/preview", { audienceFilter });
        return res.json();
      } catch {
        return { recipients: [] as { name: string; addressLine1: string; city: string; state: string; zip: string }[] };
      }
    },
    retry: false,
  });

  if (!show) return null;

  if (preview.isLoading) {
    return (
      <div className="space-y-2 p-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (!preview.data || preview.data.recipients.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-4" data-testid="preview-stub">
        Per-recipient previews land with the Round-4 preview pipeline. The audience filter currently
        targets the matching leads in your CRM — the queue endpoint will resolve them at send time.
      </p>
    );
  }

  return (
    <ul className="divide-y" data-testid="preview-list">
      {preview.data.recipients.map((r, i) => (
        <li key={i} className="p-3">
          <p className="font-medium">{r.name}</p>
          <p className="text-xs text-muted-foreground">
            {r.addressLine1}, {r.city}, {r.state} {r.zip}
          </p>
          {copy && <p className="text-sm mt-2 whitespace-pre-wrap">{renderMerge(copy, r)}</p>}
        </li>
      ))}
    </ul>
  );
}

function renderMerge(
  copy: string,
  recipient: { name: string; city: string; state: string },
): string {
  return copy
    .replace(/\{firstName\}/g, recipient.name.split(" ")[0] ?? "")
    .replace(/\{city\}/g, recipient.city)
    .replace(/\{state\}/g, recipient.state);
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
