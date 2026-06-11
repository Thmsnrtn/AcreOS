/**
 * LandDealCalculator — shared body used by `/tools/calculator` (with
 * AcreOS chrome) and `/tools/calculator/embed` (bare, iframe-friendly).
 *
 * The calculator math + URL encoding live in @shared/calculators/landDeal
 * so the page can stay thin. Inputs debounce 150ms before recomputing +
 * before re-serializing the URL — keystroke-rate updates were jittery on
 * lower-end Android during the 390px verification.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { usd, percent } from "@/lib/format";
import { trackCanonicalEvent } from "@/lib/analytics";
import {
  computeLandDeal,
  dollarsToCentsInput,
  encodeInputsToQuery,
  decodeInputsFromQuery,
  DEFAULT_INPUTS_DOLLARS,
  type CalculatorInputsDollars,
} from "@shared/calculators/landDeal";
import { ArrowRight, Copy, RotateCcw, Code2 } from "lucide-react";

interface Props {
  /** When true: hide AcreOS marketing CTA + embed snippet; render minimal layout for iframe. */
  embed?: boolean;
}

const FIELD_DEFS: Array<{
  key: keyof CalculatorInputsDollars;
  label: string;
  hint?: string;
  step?: number;
}> = [
  { key: "purchase", label: "Purchase price", step: 100 },
  { key: "closingAtBuy", label: "Closing costs at acquisition", hint: "Default 1% of purchase", step: 5 },
  { key: "holdingPerMonth", label: "Holding costs per month", hint: "Taxes + insurance", step: 5 },
  { key: "holdMonths", label: "Hold time (months)", step: 1 },
  { key: "marketing", label: "Marketing cost", hint: "Typical mail spend", step: 25 },
  { key: "salePrice", label: "Expected sale price", step: 500 },
  { key: "closingAtSale", label: "Closing costs at sale", hint: "Default 3% of sale", step: 25 },
];

function urlSearch(): string {
  if (typeof window === "undefined") return "";
  return window.location.search;
}

export function LandDealCalculator({ embed = false }: Props) {
  const { toast } = useToast();
  // Seed from URL on first render so a shared link round-trips.
  const [inputs, setInputs] = useState<CalculatorInputsDollars>(() =>
    decodeInputsFromQuery(urlSearch(), DEFAULT_INPUTS_DOLLARS),
  );

  // Debounced inputs feed the math + URL serialization. The form itself
  // updates immediately for visual responsiveness.
  const [debouncedInputs, setDebouncedInputs] =
    useState<CalculatorInputsDollars>(inputs);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedInputs(inputs), 150);
    return () => window.clearTimeout(t);
  }, [inputs]);

  // Recompute on debounced input change. Pure + cheap; safe in render.
  const results = useMemo(
    () => computeLandDeal(dollarsToCentsInput(debouncedInputs)),
    [debouncedInputs],
  );

  // Mirror form state into the URL — embed mode skips this so an iframe
  // never hijacks the parent's address bar (only the iframe's own
  // contentWindow URL changes, which is fine, but we keep embed lean).
  useEffect(() => {
    if (embed || typeof window === "undefined") return;
    const next = encodeInputsToQuery(debouncedInputs);
    const url = `${window.location.pathname}?${next}`;
    window.history.replaceState(null, "", url);
  }, [debouncedInputs, embed]);

  // PostHog `calculator_completed` fires once per "session" of edits — i.e.
  // after the user stops typing for 150ms AND the math has produced a
  // meaningful output. Guarded by a ref so the initial mount doesn't fire
  // a synthetic event before any real interaction.
  const firedRef = useRef(false);
  useEffect(() => {
    if (!firedRef.current) {
      firedRef.current = true;
      return;
    }
    trackCanonicalEvent("calculator_completed", {
      profit_cents: results.profitCents,
      roi_pct: results.roi === null ? null : Math.round(results.roi * 10000) / 100,
      irr_pct: results.irr === null ? null : Math.round(results.irr * 10000) / 100,
      embed,
    });
  }, [results.profitCents, results.roi, results.irr, embed]);

  const update = useCallback(
    (key: keyof CalculatorInputsDollars, raw: string) => {
      const n = raw === "" ? 0 : Number(raw);
      if (!Number.isFinite(n) || n < 0) return; // ≥0 validation; ignore garbage
      setInputs((prev) => ({ ...prev, [key]: n }));
    },
    [],
  );

  const reset = useCallback(() => {
    setInputs(DEFAULT_INPUTS_DOLLARS);
    toast({ title: "Calculator reset", description: "Defaults restored." });
  }, [toast]);

  const copyShareLink = useCallback(async () => {
    if (typeof window === "undefined") return;
    const link = `${window.location.origin}/tools/calculator?${encodeInputsToQuery(debouncedInputs)}`;
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Link copied", description: "Share this URL to send your scenario." });
    } catch {
      toast({ title: "Couldn't copy", description: "Your browser blocked clipboard access.", variant: "destructive" });
    }
  }, [debouncedInputs, toast]);

  const copyEmbed = useCallback(async () => {
    if (typeof window === "undefined") return;
    const snippet = `<iframe src="${window.location.origin}/tools/calculator/embed" width="100%" height="700" frameborder="0"></iframe>`;
    try {
      await navigator.clipboard.writeText(snippet);
      toast({ title: "Embed code copied", description: "Paste into any page." });
    } catch {
      toast({ title: "Couldn't copy", description: "Your browser blocked clipboard access.", variant: "destructive" });
    }
  }, [toast]);

  const onCtaClick = useCallback(() => {
    trackCanonicalEvent("calculator_cta_click", { profit_cents: results.profitCents });
  }, [results.profitCents]);

  return (
    <div className={embed ? "mx-auto max-w-5xl px-4 py-6" : "mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12"}>
      <div className="grid gap-6 lg:grid-cols-5">
        {/* ── Inputs (top on mobile, left on desktop) ── */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Deal inputs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {FIELD_DEFS.map(({ key, label, hint, step }) => {
              const id = `calc-${key}`;
              return (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={id} className="text-sm font-medium">
                    {label}
                  </Label>
                  <Input
                    id={id}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={step ?? 1}
                    value={inputs[key]}
                    onChange={(e) => update(key, e.target.value)}
                    data-testid={`calc-input-${key}`}
                  />
                  {hint ? (
                    <p className="text-xs text-muted-foreground">{hint}</p>
                  ) : null}
                </div>
              );
            })}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={copyShareLink}
                aria-label="Copy shareable link"
                className="gap-2"
                data-testid="calc-copy-share"
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                Copy shareable link
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={reset}
                aria-label="Reset calculator to defaults"
                className="gap-2"
                data-testid="calc-reset"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Results ── */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Deal economics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ResultsGrid results={results} />
            {!embed ? (
              <CtaCard onClick={onCtaClick} />
            ) : (
              <p className="pt-2 text-center text-xs text-muted-foreground">
                Powered by{" "}
                <a
                  href="https://acreos.io/tools/calculator?utm_source=embed&utm_medium=iframe"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline underline-offset-2 hover:text-foreground"
                >
                  AcreOS
                </a>
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Embed snippet (only on the main route) ── */}
      {!embed ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Code2 className="h-4 w-4" aria-hidden="true" />
              Embed this calculator
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Drop this snippet into any page. Free to use; we'd love a backlink.
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">
              <code data-testid="calc-embed-snippet">{`<iframe src="https://acreos.io/tools/calculator/embed" width="100%" height="700" frameborder="0"></iframe>`}</code>
            </pre>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={copyEmbed}
              aria-label="Copy embed code"
              className="gap-2"
              data-testid="calc-copy-embed"
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy embed code
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Mobile sticky CTA (main route only) ── */}
      {!embed ? <MobileStickyCta onClick={onCtaClick} /> : null}
    </div>
  );
}

interface ResultsGridProps {
  results: ReturnType<typeof computeLandDeal>;
}

function ResultsGrid({ results }: ResultsGridProps) {
  const profitPositive = results.profitCents > 0;
  const profitNegative = results.profitCents < 0;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Stat label="Total cost in" value={usd(results.totalCostInCents / 100)} testid="calc-out-cost" />
      <Stat label="Net proceeds out" value={usd(results.netProceedsCents / 100)} testid="calc-out-net" />
      <Stat
        label="Profit"
        value={usd(results.profitCents / 100)}
        emphasis={profitPositive ? "positive" : profitNegative ? "negative" : "neutral"}
        testid="calc-out-profit"
      />
      <Stat
        label="ROI"
        value={results.roi === null ? "—" : percent(results.roi, { decimals: 1 })}
        emphasis={results.roi === null ? "neutral" : results.roi >= 0 ? "positive" : "negative"}
        testid="calc-out-roi"
      />
      <Stat
        label="Annualized return"
        value={results.annualizedReturn === null ? "—" : percent(results.annualizedReturn, { decimals: 1 })}
        emphasis={results.annualizedReturn === null ? "neutral" : results.annualizedReturn >= 0 ? "positive" : "negative"}
        testid="calc-out-annualized"
      />
      <Stat
        label="IRR (annual)"
        value={results.irr === null ? "n/a" : percent(results.irr, { decimals: 1 })}
        helper={
          results.irr === null
            ? "Cash flow shape doesn't support an IRR (no sign change in the series)."
            : undefined
        }
        emphasis={results.irr === null ? "neutral" : results.irr >= 0 ? "positive" : "negative"}
        testid="calc-out-irr"
      />
      <Stat
        label="Breakeven sale price"
        value={usd(results.breakevenSaleCents / 100)}
        helper="Sale price at which profit = $0, given your other inputs."
        testid="calc-out-breakeven"
      />
    </div>
  );
}

function Stat({
  label,
  value,
  helper,
  emphasis = "neutral",
  testid,
}: {
  label: string;
  value: string;
  helper?: string;
  emphasis?: "positive" | "negative" | "neutral";
  testid?: string;
}) {
  const tone =
    emphasis === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : emphasis === "negative"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3" data-testid={testid}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      {helper ? <div className="mt-1 text-xs text-muted-foreground">{helper}</div> : null}
    </div>
  );
}

function CtaCard({ onClick }: { onClick: () => void }) {
  return (
    <a
      href="/auth?mode=register&utm_source=calculator&utm_medium=internal&utm_campaign=calculator_cta"
      onClick={onClick}
      className="group mt-4 flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      data-testid="calc-cta"
    >
      <div className="space-y-1">
        <p className="text-sm font-medium">
          AcreOS tracks 100+ of these in one dashboard, pulls the lists, and runs the mail.
        </p>
        <p className="text-xs text-muted-foreground">See how it fits your workflow.</p>
      </div>
      <ArrowRight className="h-5 w-5 shrink-0 text-primary transition-transform group-hover:translate-x-1" aria-hidden="true" />
    </a>
  );
}

function MobileStickyCta({ onClick }: { onClick: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface-chrome p-3 backdrop-blur-md lg:hidden">
      <a
        href="/auth?mode=register&utm_source=calculator&utm_medium=internal&utm_campaign=calculator_cta"
        onClick={onClick}
        className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        data-testid="calc-cta-mobile"
      >
        Get the full AcreOS workflow
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </a>
    </div>
  );
}
