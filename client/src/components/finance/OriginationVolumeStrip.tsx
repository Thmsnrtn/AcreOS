import { useMemo } from "react";
import { usd } from "@/lib/format";

/**
 * OriginationVolumeStrip — twelve narrow bars on a common Y-scale, one per
 * month, showing capital deployed into new paper (Σ original principal of
 * notes written that month). The note_originator counterpart to the
 * note_investor small-multiple: same Tufte vocabulary (shared scale, pure
 * SVG, baseline spine, no chart border) but a single series, because for an
 * originator the question is "how much paper did I write each month," not a
 * principal/interest decomposition.
 *
 * Every bar is real: it sums `originalPrincipal` over notes whose `createdAt`
 * falls in that month. A month with no originations renders as an empty slot
 * (a baseline tick only) — an honest zero, not a hidden gap.
 */
export interface MonthVolume {
  month: string; // YYYY-MM
  amount: number;
}

interface Props {
  data: MonthVolume[];
  ariaLabel?: string;
}

const COLOR_VOLUME = "var(--acr-brand)";

function shortMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  if (!y || !m) return yyyymm;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString("en-US", { month: "short" });
}

export function OriginationVolumeStrip({ data, ariaLabel }: Props) {
  const max = useMemo(() => {
    let m = 0;
    data.forEach((d) => {
      if (d.amount > m) m = d.amount;
    });
    return m || 1;
  }, [data]);

  const PANEL_W = 36;
  const PANEL_H = 64;
  const GAP = 4;
  const PADDING_X = 8;
  const PADDING_TOP = 8;
  const totalW = data.length * (PANEL_W + GAP) + PADDING_X * 2;
  const totalH = PADDING_TOP + PANEL_H + 20;

  const total = useMemo(() => data.reduce((s, d) => s + d.amount, 0), [data]);

  const a11ySummary =
    ariaLabel ||
    `Twelve-month origination volume: ${data
      .map((d) => `${shortMonth(d.month)} ${usd(d.amount, { noCents: true })}`)
      .join("; ")}.`;

  return (
    <div className="w-full overflow-x-auto" role="img" aria-label={a11ySummary}>
      <svg width={totalW} height={totalH} viewBox={`0 0 ${totalW} ${totalH}`} className="block">
        {data.map((d, i) => {
          const x = PADDING_X + i * (PANEL_W + GAP);
          const h = (d.amount / max) * PANEL_H;
          const barW = PANEL_W - 12;
          const barX = x + 6;
          const baseY = PADDING_TOP + PANEL_H;
          return (
            <g key={d.month}>
              <rect
                x={barX}
                y={baseY - h}
                width={barW}
                height={Math.max(h, d.amount > 0 ? 0.5 : 0)}
                fill={COLOR_VOLUME}
              />
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
      </svg>

      <div className="flex flex-wrap items-center gap-3 mt-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2" style={{ backgroundColor: COLOR_VOLUME }} aria-hidden="true" />
          Capital deployed
        </span>
        <span className="tabular-nums">12-mo total {usd(total, { noCents: true })}</span>
        <span className="ml-auto tabular-nums">Scale: {usd(max, { noCents: true })}</span>
      </div>
    </div>
  );
}
