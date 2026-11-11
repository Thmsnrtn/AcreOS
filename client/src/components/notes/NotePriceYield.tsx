/**
 * Price ↔ yield for a note you have not bought yet (autonomy gap N-4).
 *
 * Enter the yield you need and see the price; enter a price and see the yield.
 * The arithmetic lives in shared/notes/notePriceYield.ts (same monthly-IRR →
 * (1+r)^12−1 convention as the on-book yield). This component adds no math and
 * invents no input: the balance, rate and term come from the acquisition, the
 * payment (and any balloon) are typed by the buyer, and anything the math
 * refuses is shown as the refusal's own message.
 */
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dollars } from "@/lib/format";
import {
  priceForTargetYield,
  yieldForPrice,
  type NoteCashFlowInput,
} from "@shared/notes/notePriceYield";

/** "$1,234.50" / "1234.5" → cents; blank or unparseable → null. */
function parseCents(s: string): number | null {
  const t = s.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function parseNumber(s: string): number | null {
  const t = s.replace(/[%,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

interface Props {
  /** Unpaid balance being priced, cents. Without it the calculator is not shown. */
  balanceCents: number | null;
  /** Note rate, bps. Without it the calculator is not shown. */
  rateBps: number | null;
  /** Term on the acquisition — pre-fills "payments remaining"; the buyer confirms it. */
  termMonths: number | null;
  /** The price being considered, cents — pre-fills the yield side. */
  priceCents: number | null;
}

export function NotePriceYield({ balanceCents, rateBps, termMonths, priceCents }: Props) {
  const [payment, setPayment] = useState("");
  const [term, setTerm] = useState(termMonths ? String(termMonths) : "");
  const [balloonAmt, setBalloonAmt] = useState("");
  const [balloonMonth, setBalloonMonth] = useState("");
  const [targetPct, setTargetPct] = useState("");
  const [price, setPrice] = useState(priceCents ? String(priceCents / 100) : "");

  const input = useMemo<NoteCashFlowInput | { missing: string }>(() => {
    if (balanceCents === null || rateBps === null) return { missing: "balance and rate" };
    const paymentCents = parseCents(payment);
    const remaining = parseNumber(term);
    if (paymentCents === null) return { missing: "the monthly payment" };
    if (remaining === null) return { missing: "the payments remaining" };
    const bAmt = parseCents(balloonAmt);
    const bMonth = parseNumber(balloonMonth);
    return {
      currentBalanceCents: balanceCents,
      noteRateBps: rateBps,
      paymentAmountCents: paymentCents,
      remainingTermMonths: remaining,
      // A balloon is "amount and month" together; one without the other is
      // passed through so the math can refuse it rather than silently drop it.
      balloon: bAmt === null && bMonth === null ? null : { amountCents: bAmt ?? 0, month: bMonth ?? 0 },
    };
  }, [balanceCents, rateBps, payment, term, balloonAmt, balloonMonth]);

  const priceResult = useMemo(() => {
    const t = parseNumber(targetPct);
    if ("missing" in input || t === null) return null;
    return priceForTargetYield(input, t * 100);
  }, [input, targetPct]);

  const yieldResult = useMemo(() => {
    const p = parseCents(price);
    if ("missing" in input || p === null) return null;
    return yieldForPrice(input, p);
  }, [input, price]);

  if (balanceCents === null || rateBps === null) return null;

  return (
    <Card className="mb-6" data-testid="note-price-yield">
      <div className="p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Price ↔ yield</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            On the stated terms only — no prepayment, default or servicing cost assumed. Balance {dollars(balanceCents)} at {(rateBps / 100).toFixed(2)}%.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field id="npy-pmt" label="Monthly payment ($)" value={payment} onChange={setPayment} />
          <Field id="npy-term" label="Payments remaining" value={term} onChange={setTerm} />
          <Field id="npy-balloon" label="Balloon ($, if any)" value={balloonAmt} onChange={setBalloonAmt} />
          <Field id="npy-balloon-month" label="Balloon due with payment #" value={balloonMonth} onChange={setBalloonMonth} />
        </div>

        {"missing" in input && (
          <p className="text-xs text-muted-foreground" role="status">
            Enter {input.missing} to price this note.
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Field id="npy-target" label="Target yield (%)" value={targetPct} onChange={setTargetPct} />
            <div aria-live="polite" className="text-sm" data-testid="note-price-for-yield">
              {priceResult === null ? (
                <span className="text-muted-foreground">Enter a target yield to see the price.</span>
              ) : priceResult.ok ? (
                <span>
                  Pay up to <strong>{dollars(priceResult.priceCents)}</strong>{" "}
                  <span className="text-muted-foreground">({(priceResult.priceToBalance * 100).toFixed(1)}% of balance)</span>
                </span>
              ) : (
                <span className="text-destructive">{priceResult.message}</span>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Field id="npy-price" label="Price ($)" value={price} onChange={setPrice} />
            <div aria-live="polite" className="text-sm" data-testid="note-yield-for-price">
              {yieldResult === null ? (
                <span className="text-muted-foreground">Enter a price to see the yield.</span>
              ) : yieldResult.ok ? (
                <span>
                  Yield <strong>{(yieldResult.annualYield * 100).toFixed(2)}%</strong>{" "}
                  <span className="text-muted-foreground">annualized</span>
                </span>
              ) : (
                <span className="text-destructive">{yieldResult.message}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Field({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="h-9" />
    </div>
  );
}
