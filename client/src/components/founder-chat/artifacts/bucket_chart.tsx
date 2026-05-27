/**
 * bucket_chart artifact — 5 canonical buckets (tax_reserve / refund_reserve
 * / profit_reserve / owner_draw / opex_available).
 *
 * Apple-grade redesign: the data is the hero. Big total in Fraunces, each
 * bucket a row with its share as a thin animated bar, balances right-
 * aligned in serif tabular numerals. No recharts wrapper — pure CSS so it
 * feels snappy in the chat stream.
 */
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SPRING_SOFT } from "@/lib/motion";
import type { BucketBalances } from "@shared/founder-chat/artifacts";

interface BucketChartProps {
  data: BucketBalances;
}

const BUCKETS: Array<{
  key: keyof BucketBalances;
  label: string;
  hex: string;
}> = [
  { key: "taxReserveCents",    label: "Tax reserve",    hex: "hsl(var(--acr-warn))"   },
  { key: "refundReserveCents", label: "Refund reserve", hex: "hsl(var(--acr-neg))"    },
  { key: "profitReserveCents", label: "Profit reserve", hex: "hsl(var(--acr-pos))"    },
  { key: "ownerDrawCents",     label: "Owner draw",     hex: "hsl(var(--acr-brand))"  },
  { key: "opexAvailableCents", label: "Opex available", hex: "hsl(var(--acr-accent))" },
];

function fmtUSD(cents: number): string {
  const dollars = Math.round((cents ?? 0) / 100);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(dollars);
}

export function BucketChartArtifact({ data }: BucketChartProps) {
  const rows = BUCKETS.map((b) => ({
    label: b.label,
    cents: Number(data?.[b.key] ?? 0),
    hex: b.hex,
  }));
  const total = rows.reduce((s, r) => s + r.cents, 0);
  const max = Math.max(...rows.map((r) => r.cents), 1);

  return (
    <Card
      data-testid="artifact-bucket-chart"
      className="border-border/60 shadow-none"
    >
      <CardContent className="p-5 sm:p-6">
        <p className="text-caption uppercase tracking-wider text-muted-foreground font-medium">
          Total across buckets
        </p>
        <p
          className={cn(
            "mt-1 font-serif tabular-nums leading-none",
            "text-4xl sm:text-5xl font-medium",
          )}
        >
          {fmtUSD(total)}
        </p>

        <ul className="mt-5 space-y-3" aria-label="Bucket breakdown">
          {rows.map((r, i) => {
            const pct = total > 0 ? (r.cents / max) * 100 : 0;
            return (
              <li key={r.label} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <span
                      aria-hidden="true"
                      className="w-1.5 h-1.5 rounded-full inline-block"
                      style={{ background: r.hex }}
                    />
                    {r.label}
                  </span>
                  <span className="font-serif tabular-nums text-base font-medium text-foreground">
                    {fmtUSD(r.cents)}
                  </span>
                </div>
                <div
                  className="mt-1.5 h-1 rounded-full bg-muted/60 overflow-hidden"
                  aria-hidden="true"
                >
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ ...SPRING_SOFT, delay: i * 0.05 }}
                    className="h-full rounded-full"
                    style={{ background: r.hex }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

export default BucketChartArtifact;
