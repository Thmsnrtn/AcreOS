/**
 * UnderwritingWorkbench — every vertical's decision desk, one implementation.
 *
 * The canonical loop for a vertical is:
 *   numbers (a deterministic engine) → a decision citing them →
 *   "when will you know?" → the Today door asks what happened → calibration.
 * The flip analyzer and the blind-offer wizard each built that by hand. This is
 * the same loop for the other verticals (decision-memos/2026-10-04-vertical-
 * program.md). A vertical supplies its engine, its fields and its decision
 * route; the guarantees live here, once.
 *
 * WHAT IT REFUSES TO DO
 *   - Compute anything. The numbers come from POST /api/scenarios/preview,
 *     which runs the same registered engine the recorded scenario will use, so
 *     what the operator sees is what gets frozen.
 *   - Treat an empty optional input as zero. It is sent as absent, and the
 *     engine records its own substitution as an assumption, shown here with
 *     its origin.
 *   - Pick the call or the review date. Neither is pre-selected, and the
 *     decision cannot be recorded until the operator answers both.
 *   - Record numbers the operator has not seen. While a typed change is still
 *     inside the debounce, or its preview is in flight, recording is disabled,
 *     so the inputs sent are exactly the ones the shown metrics came from.
 *   - Freeze a description written for other numbers. Once the operator edits
 *     "what you're deciding" it is theirs and is never overwritten, so if the
 *     inputs change afterwards, recording waits until they either take the
 *     regenerated sentence or confirm their own wording.
 *   - Render an uncomputable number as 0. A null metric shows "—".
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PropertyCombobox } from "@/components/property-combobox";
import { QueryErrorState } from "@/components/query-error-state";
import { ReviewDateChoice, reviewDueAtFromDays } from "@/components/decisions/ReviewDateChoice";
import { apiRequest } from "@/lib/queryClient";
import { Verbs } from "@/lib/labels";
import { metricById, type ScenarioAssumption, type ScenarioMetric } from "@shared/economics/scenario";
import type { DecisionKind } from "@shared/decisions/snapshot";
import { wireInputs, type EngineField } from "@shared/economics/engineFields";

export interface PreviewResult {
  engineId: string;
  engineVersion: string;
  metrics: ScenarioMetric[];
  assumptions: ScenarioAssumption[];
  inputs: Record<string, number | string>;
}

const KIND_LABEL: Record<DecisionKind, string> = {
  pursue: "Pursue",
  pass: "Pass",
  offer: "Make an offer",
  acquire: "Acquire",
  hold: "Hold",
  dispose: "Sell",
  price: "Set the price",
  finance: "Choose the financing",
};

const ORIGIN_LABEL: Record<ScenarioAssumption["origin"], string> = {
  user: "Your input",
  "strategy-pack-default": "Strategy default",
  derived: "Derived",
  "platform-default": "Platform default — replace with your own",
};

/** Format one metric by its registered unit. Null is "—", never zero. */
export function formatMetric(m: Pick<ScenarioMetric, "value" | "unit">): string {
  if (m.value === null) return "—";
  switch (m.unit) {
    case "cents":
      return `${m.value < 0 ? "−" : ""}$${Math.abs(Math.round(m.value / 100)).toLocaleString("en-US")}`;
    case "ratio":
      return `${(m.value * 100).toFixed(1)}%`;
    case "percent":
      return `${m.value.toFixed(1)}%`;
    case "multiple":
      return `${m.value.toFixed(2)}×`;
    case "months":
      return `${m.value} mo`;
    case "days":
      return `${m.value} days`;
  }
}

export interface UnderwritingWorkbenchProps {
  /** The registered engine (must declare this vertical). */
  engineId: string;
  fields: readonly EngineField[];
  /** The vertical's decision route — it calls recordUnderwrittenDecision with a literal pack. */
  decideEndpoint: string;
  /** Decision kinds this vertical's call can be. None is pre-selected. */
  kinds: readonly DecisionKind[];
  /** Metric ids to feature first, in order. */
  headlineMetrics: readonly string[];
  /** The default "what was chosen" sentence, editable before recording. */
  describeChoice: (kind: DecisionKind, inputs: Record<string, number>, metrics: ScenarioMetric[]) => string;
  /** Optional: a property to start on (e.g. from a deep link). */
  initialPropertyId?: number | null;
  testIdPrefix: string;
}

export function UnderwritingWorkbench({
  engineId,
  fields,
  decideEndpoint,
  kinds,
  headlineMetrics,
  describeChoice,
  initialPropertyId = null,
  testIdPrefix,
}: UnderwritingWorkbenchProps) {
  const [propertyId, setPropertyId] = useState<number | null>(initialPropertyId);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<DecisionKind | null>(null);
  const [choice, setChoice] = useState("");
  const [choiceEdited, setChoiceEdited] = useState(false);
  /** The inputs the operator's own wording was written (or confirmed) against. */
  const [choiceInputsKey, setChoiceInputsKey] = useState<string | null>(null);
  const [rationale, setRationale] = useState("");
  const [reviewInDays, setReviewInDays] = useState<number | null | undefined>(undefined);
  const [recorded, setRecorded] = useState<{ decisionId: number } | null>(null);

  const { inputs, missing } = useMemo(() => wireInputs(fields, typed), [fields, typed]);
  const ready = missing.length === 0;

  // Debounce what reaches the server so each keystroke is not a request.
  const [debounced, setDebounced] = useState(inputs);
  const inputsKey = JSON.stringify(inputs);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(inputs), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialised inputs
  }, [inputsKey]);

  const preview = useQuery<PreviewResult>({
    queryKey: ["/api/scenarios/preview", engineId, JSON.stringify(debounced)],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/scenarios/preview", { engineId, inputs: debounced });
      return res.json();
    },
    enabled: ready && JSON.stringify(debounced) === inputsKey,
    retry: false,
  });

  const metrics = preview.data?.metrics ?? [];
  useEffect(() => {
    if (!choiceEdited && preview.data && kind) setChoice(describeChoice(kind, inputs, preview.data.metrics));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only when the numbers or kind change
  }, [preview.data, kind]);

  const queryClient = useQueryClient();
  const record = useMutation({
    mutationFn: async () => {
      if (reviewInDays === undefined || kind === null) throw new Error("Answer your call and when you'll know first");
      const res = await apiRequest("POST", decideEndpoint, {
        propertyId,
        inputs,
        kind,
        choice: choice.trim(),
        rationale: rationale.trim(),
        reviewDueAt: reviewDueAtFromDays(reviewInDays),
      });
      return (await res.json()) as { decisionId: number; scenarioId: number };
    },
    onSuccess: (d) => {
      setRecorded({ decisionId: d.decisionId });
      // A new decision changes what Today's outcome prompt and Decision Memory show.
      queryClient.invalidateQueries({ queryKey: ["/api/decisions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/decisions/due"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios"] });
    },
  });

  // The shown metrics are for `debounced`; recording sends `inputs`. They must
  // be the same inputs, or the frozen scenario is one the operator never saw.
  const previewCurrent = JSON.stringify(debounced) === inputsKey && !!preview.data && !preview.isFetching;
  const choiceStale = choiceEdited && choiceInputsKey !== inputsKey;
  const canRecord =
    propertyId !== null &&
    ready &&
    previewCurrent &&
    !choiceStale &&
    kind !== null &&
    choice.trim().length > 0 &&
    rationale.trim().length >= 10 &&
    reviewInDays !== undefined &&
    !record.isPending;

  const ordered = [
    ...headlineMetrics.map((id) => metrics.find((m) => m.id === id)).filter((m): m is ScenarioMetric => !!m),
    ...metrics.filter((m) => !headlineMetrics.includes(m.id)),
  ];

  return (
    <div className="space-y-4" data-testid={`${testIdPrefix}-workbench`}>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">The numbers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${testIdPrefix}-property`}>Property</Label>
            <PropertyCombobox
              id={`${testIdPrefix}-property`}
              value={propertyId}
              onChange={(id) => setPropertyId(id)}
              aria-label="Property this decision is about"
              data-testid={`${testIdPrefix}-property`}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((f) => {
              const id = `${testIdPrefix}-field-${f.key}`;
              const invalid = (typed[f.key] ?? "").trim() !== "" && missing.includes(f.key);
              return (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={id} id={`${id}-label`}>
                    {f.label}
                    {f.optional ? <span className="text-muted-foreground font-normal"> (optional)</span> : null}
                  </Label>
                  {f.options ? (
                    // The WAI-ARIA radio-group pattern: one Tab stop (the chosen
                    // option, or the first while unanswered), arrow keys move and
                    // choose. Nothing is pre-selected.
                    <div
                      id={id}
                      role="radiogroup"
                      aria-labelledby={`${id}-label`}
                      aria-required={!f.optional}
                      aria-describedby={f.hint ? `${id}-hint` : undefined}
                      className="flex flex-wrap gap-2"
                      data-testid={id}
                    >
                      {f.options.map((o, i, all) => {
                        const on = typed[f.key] === String(o.value);
                        const answered = all.some((x) => typed[f.key] === String(x.value));
                        const choose = (v: number) => setTyped((t) => ({ ...t, [f.key]: String(v) }));
                        return (
                          <Button
                            key={o.value}
                            type="button"
                            size="sm"
                            role="radio"
                            aria-checked={on}
                            tabIndex={on || (!answered && i === 0) ? 0 : -1}
                            variant={on ? "secondary" : "outline"}
                            onClick={() => choose(o.value)}
                            onKeyDown={(e) => {
                              const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                              if (step === 0) return;
                              e.preventDefault();
                              const next = all[(i + step + all.length) % all.length];
                              choose(next.value);
                              const group = e.currentTarget.parentElement;
                              (group?.querySelector(`[data-testid="${id}-${next.value}"]`) as HTMLElement | null)?.focus();
                            }}
                            data-testid={`${id}-${o.value}`}
                          >
                            {o.label}
                          </Button>
                        );
                      })}
                    </div>
                  ) : (
                    <Input
                      id={id}
                      inputMode="decimal"
                      value={typed[f.key] ?? ""}
                      onChange={(e) => setTyped((t) => ({ ...t, [f.key]: e.target.value }))}
                      aria-invalid={invalid}
                      aria-describedby={f.hint ? `${id}-hint` : undefined}
                      data-testid={id}
                    />
                  )}
                  {f.hint ? (
                    <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                      {f.hint}
                    </p>
                  ) : null}
                  {invalid ? <p className="text-xs text-destructive">Not a valid value for this field.</p> : null}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card data-testid={`${testIdPrefix}-results`}>
        <CardHeader>
          <CardTitle className="text-base">What the engine says</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!ready ? (
            <p className="text-sm text-muted-foreground">
              Fill in the required fields and the numbers appear here — computed by the same engine
              that freezes them when you record the decision.
            </p>
          ) : preview.isError ? (
            <QueryErrorState
              error={preview.error as Error}
              onRetry={() => preview.refetch()}
              isRetrying={preview.isFetching}
              compact
              title="Couldn't compute these numbers"
              testId={`${testIdPrefix}-preview-error`}
            />
          ) : !preview.data ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {headlineMetrics.map((id) => (
                <Skeleton key={id} className="h-14" />
              ))}
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {ordered.map((m) => (
                  <div key={m.id} className="rounded-md border border-border p-2" data-testid={`${testIdPrefix}-metric-${m.id}`}>
                    <dt className="text-xs text-muted-foreground">{metricById(m.id)?.label ?? m.id}</dt>
                    <dd className="text-base font-semibold tabular-nums" title={m.value === null ? "Not computable from these inputs" : undefined}>
                      {formatMetric(m)}
                    </dd>
                  </div>
                ))}
              </dl>
              {preview.data.assumptions.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Assumptions behind these numbers</p>
                  <ul className="mt-1 space-y-1">
                    {preview.data.assumptions.map((a) => (
                      <li key={a.key} className="flex flex-wrap items-center gap-2 text-sm">
                        <span>{a.basis ?? a.key}: {String(a.value)}</span>
                        <Badge variant={a.origin === "user" ? "secondary" : "outline"}>{ORIGIN_LABEL[a.origin]}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Engine {preview.data.engineId} · version {preview.data.engineVersion}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card data-testid={`${testIdPrefix}-decision`}>
        <CardHeader>
          <CardTitle className="text-base">Record the decision</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {recorded ? (
            <p className="flex items-center gap-2 text-sm" data-testid={`${testIdPrefix}-recorded`}>
              <CheckCircle2 className="h-4 w-4 text-acr-pos" aria-hidden="true" />
              Recorded as decision #{recorded.decisionId}. The numbers and your reasoning are frozen
              against this property{reviewInDays ? ", and Today will ask how it went when it's due" : ""}.
            </p>
          ) : (
            <>
              <fieldset>
                <legend className="text-sm font-medium">Your call</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {kinds.map((k) => (
                    <Button
                      key={k}
                      type="button"
                      size="sm"
                      variant={kind === k ? "secondary" : "outline"}
                      aria-pressed={kind === k}
                      onClick={() => setKind(k)}
                      data-testid={`${testIdPrefix}-kind-${k}`}
                    >
                      {KIND_LABEL[k]}
                    </Button>
                  ))}
                </div>
              </fieldset>
              <div className="space-y-1.5">
                <Label htmlFor={`${testIdPrefix}-choice`}>What you're deciding</Label>
                <Input
                  id={`${testIdPrefix}-choice`}
                  value={choice}
                  onChange={(e) => {
                    setChoice(e.target.value);
                    setChoiceEdited(true);
                    setChoiceInputsKey(inputsKey);
                  }}
                  data-testid={`${testIdPrefix}-choice`}
                />
                {choiceStale ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs" role="status" data-testid={`${testIdPrefix}-choice-stale`}>
                    <span className="text-muted-foreground">You wrote this for different numbers.</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setChoiceEdited(false);
                        if (preview.data && kind) setChoice(describeChoice(kind, inputs, preview.data.metrics));
                      }}
                      data-testid={`${testIdPrefix}-choice-regenerate`}
                    >
                      Use the current numbers
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setChoiceInputsKey(inputsKey)}
                      data-testid={`${testIdPrefix}-choice-keep`}
                    >
                      Keep my wording
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${testIdPrefix}-rationale`}>Why</Label>
                <Textarea
                  id={`${testIdPrefix}-rationale`}
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  placeholder="The sentence you'll want to read when you find out how this went."
                  data-testid={`${testIdPrefix}-rationale`}
                />
              </div>
              <ReviewDateChoice value={reviewInDays} onChange={setReviewInDays} testIdPrefix={`${testIdPrefix}-review-in`} />
              {record.isError ? (
                <p className="text-sm text-destructive" role="alert">
                  {(record.error as Error).message} — nothing was recorded.
                </p>
              ) : null}
              <Button
                className="w-full min-h-11 pointer-fine:sm:min-h-9"
                disabled={!canRecord}
                onClick={() => record.mutate()}
                data-testid={`${testIdPrefix}-record`}
              >
                {record.isPending ? "Recording…" : Verbs.SAVE + " decision"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Recording sends nothing to anyone and moves no money. It freezes what you knew and
                what you expected, so the outcome can be compared with it later.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
