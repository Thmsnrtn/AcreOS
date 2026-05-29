import { useMemo } from "react";
import { usd } from "@/lib/format";

/**
 * SmallMultipleTwelveMonth — twelve narrow panels on a common Y-scale,
 * one per month, stacking principal-in + interest-in + late-fees-in as
 * three colored bars. A delinquency-rate line is overlaid in a thin
 * strip below the small-multiple row (Tufte: a single "slope" view
 * threaded across all twelve panels).
 *
 * Per Tufte (Envisioning Information, p.67–79 and Beautiful Evidence
 * ch.4): small multiples should share a common scale so the eye reads
 * differences as quantitative facts, not visual artifacts. Y-axis is
 * computed once across the twelve panels; X is the categorical month.
 *
 * Pure SVG — no recharts/d3 — because at this size the per-panel
 * overhead of a charting library swamps the actual rendering work
 * and the customizations we need (shared Y-scale, three stacked
 * bars per panel) are easier expressed as a 30-line layout.
 */
export interface MonthBreakdown {
  month: string; // YYYY-MM
  principal: number;
  interest: number;
  lateFees: number;
  total: number;
}

interface Props {
  data: MonthBreakdown[];
  /**
   * Optional per-month delinquency rate (0..100) for the bottom strip.
   * If omitted the strip is skipped and only the bar panels render.
   */
  delinquencyRate?: number[];
  ariaLabel?: string;
}

const COLOR_PRINCIPAL = "var(--acr-brand)";
const COLOR_INTEREST = "var(--acr-accent)";
const COLOR_LATE = "var(--acr-warn)";

function shortMonth(yyyymm: string): string {
  // YYYY-MM → e.g. "May 26". Parse as local to avoid UTC drift on
  // first-of-month dates rolling back to the prior month.
  const [y, m] = yyyymm.split("-").map(Number);
  if (!y || !m) return yyyymm;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString("en-US", { month: "short" });
}

export function SmallMultipleTwelveMonth({ data, delinquencyRate, ariaLabel }: Props) {
  const max = useMemo(() => {
    let m = 0;
    data.forEach((d) => {
      const t = d.principal + d.interest + d.lateFees;
      if (t > m) m = t;
    });
    return m || 1;
  }, [data]);

  const PANEL_W = 36;
  const PANEL_H = 64;
  const STRIP_H = 18;
  const GAP = 4;
  const PADDING_X = 8;
  const PADDING_TOP = 8;
  const totalW = data.length * (PANEL_W + GAP) + PADDING_X * 2;
  const totalH = PADDING_TOP + PANEL_H + (delinquencyRate ? STRIP_H + 4 : 0) + 20;

  const a11ySummary =
    ariaLabel ||
    `Twelve-month small multiple: ${data
      .map(
        (d) =>
          `${shortMonth(d.month)} principal ${usd(d.principal, { noCents: true })}, interest ${usd(d.interest, { noCents: true })}, late fees ${usd(d.lateFees, { noCents: true })}`,
      )
      .join("; ")}.`;

  return (
    <div className="w-full overflow-x-auto" role="img" aria-label={a11ySummary}>
      <svg
        width={totalW}
        height={totalH}
        viewBox={`0 0 ${totalW} ${totalH}`}
        className="block"
      >
        {data.map((d, i) => {
          const x = PADDING_X + i * (PANEL_W + GAP);
          const total = d.principal + d.interest + d.lateFees;
          const hTotal = (total / max) * PANEL_H;
          const hP = (d.principal / max) * PANEL_H;
          const hI = (d.interest / max) * PANEL_H;
          const hL = (d.lateFees / max) * PANEL_H;
          const barW = PANEL_W - 12;
          const barX = x + 6;
          const baseY = PADDING_TOP + PANEL_H;
          return (
            <g key={d.month}>
              {/* Three stacked bars: principal (bottom) → interest → late fees (top). */}
              <rect
                x={barX}
                y={baseY - hP}
                width={barW}
                height={Math.max(hP, total > 0 ? 0.5 : 0)}
                fill={COLOR_PRINCIPAL}
              />
              <rect
                x={barX}
                y={baseY - hP - hI}
                width={barW}
                height={Math.max(hI, total > 0 ? 0.5 : 0)}
                fill={COLOR_INTEREST}
              />
              <rect
                x={barX}
                y={baseY - hTotal}
                width={barW}
                height={Math.max(hL, d.lateFees > 0 ? 0.5 : 0)}
                fill={COLOR_LATE}
              />
              {/* Baseline tick — Tufte's "data ink ratio" calls for the
                  spine, not a chart border. */}
              <line
                x1={x}
                y1={baseY}
                x2={x + PANEL_W}
                y2={baseY}
                stroke="currentColor"
                strokeOpacity={0.2}
                strokeWidth={0.5}
              />
              <text
                x={x + PANEL_W / 2}
                y={baseY + 12}
                textAnchor="middle"
                fontSize="9"
                fill="currentColor"
                opacity={0.6}
              >
                {shortMonth(d.month)}
              </text>
            </g>
          );
        })}

        {delinquencyRate && delinquencyRate.length === data.length && (() => {
          const stripY = PADDING_TOP + PANEL_H + 16;
          const maxRate = Math.max(...delinquencyRate, 1);
          // Build a path threading the rate across all twelve panels.
          const pts = delinquencyRate.map((r, i) => {
            const x = PADDING_X + i * (PANEL_W + GAP) + PANEL_W / 2;
            const y = stripY + STRIP_H - (r / maxRate) * STRIP_H;
            return `${i === 0 ? "M" : "L"} ${x} ${y}`;
          });
          return (
            <g>
              <line
                x1={PADDING_X}
                y1={stripY + STRIP_H}
                x2={totalW - PADDING_X}
                y2={stripY + STRIP_H}
                stroke="currentColor"
                strokeOpacity={0.15}
                strokeWidth={0.5}
              />
              <path
                d={pts.join(" ")}
                stroke="var(--acr-neg)"
                strokeWidth={1}
                fill="none"
              />
              <text
                x={PADDING_X}
                y={stripY - 2}
                fontSize="8"
                fill="currentColor"
                opacity={0.55}
              >
                Delinquency rate
              </text>
            </g>
          );
        })()}
      </svg>

      {/* Legend — three small swatches, principal/interest/late. */}
      <div className="flex flex-wrap items-center gap-3 mt-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2" style={{ backgroundColor: COLOR_PRINCIPAL }} aria-hidden="true" />
          Principal
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2" style={{ backgroundColor: COLOR_INTEREST }} aria-hidden="true" />
          Interest
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2" style={{ backgroundColor: COLOR_LATE }} aria-hidden="true" />
          Late fees
        </span>
        <span className="ml-auto tabular-nums">Scale: {usd(max, { noCents: true })}</span>
      </div>
    </div>
  );
}
