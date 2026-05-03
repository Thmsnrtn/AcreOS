import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Grade = "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F";

interface LandCreditBadgeProps {
  propertyId?: number;
  score?: number;
  grade?: string;
  size?: "sm" | "md" | "full";
  dimensions?: Record<string, number>;
}

function gradeFromScore(score: number): Grade {
  if (score >= 800) return "A+";
  if (score >= 750) return "A";
  if (score >= 700) return "B+";
  if (score >= 650) return "B";
  if (score >= 600) return "C+";
  if (score >= 550) return "C";
  if (score >= 450) return "D";
  return "F";
}

function gradeColor(grade: string): string {
  switch (grade) {
    case "A+": return "bg-acr-pos";
    case "A": return "bg-acr-pos";
    case "B+": return "bg-acr-accent";
    case "B": return "bg-acr-accent";
    case "C+": return "bg-acr-warn";
    case "C": return "bg-acr-warn";
    case "D": return "bg-acr-warn";
    default: return "bg-acr-neg";
  }
}

function barColor(value: number): string {
  if (value >= 70) return "bg-acr-pos";
  if (value >= 50) return "bg-acr-warn";
  return "bg-acr-neg";
}

const dimensionLabels: Record<string, string> = {
  location: "Location",
  physical: "Physical",
  legal: "Legal",
  financial: "Financial",
  environmental: "Environmental",
  market: "Market",
};

function DimensionBreakdown({ dimensions, score, grade }: { dimensions: Record<string, number>; score: number; grade: string }) {
  return (
    <div className="space-y-2 min-w-[220px]">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold">Land Credit Score: {score} ({grade})</p>
      </div>
      <div className="w-full h-px bg-border mb-2" />
      {Object.entries(dimensions).map(([key, value]) => {
        const dimScore = value ?? 50;
        return (
          <div key={key} className="space-y-0.5">
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">{dimensionLabels[key] || key}</span>
              <span className="font-medium tabular-nums">{dimScore}</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${barColor(dimScore)}`}
                style={{ width: `${Math.max(0, Math.min(100, dimScore))}%` }}
              />
            </div>
          </div>
        );
      })}
      <p className="text-[10px] text-muted-foreground pt-1">
        The Land Credit Score rates this parcel across 6 dimensions. Higher scores indicate better investment quality.
      </p>
    </div>
  );
}

function ScoreCircle({ score, grade, sizeClass, textClass, gradeTextClass }: {
  score: number;
  grade: string;
  sizeClass: string;
  textClass: string;
  gradeTextClass: string;
}) {
  return (
    <div className={`${sizeClass} rounded-full ${gradeColor(grade)} text-white flex flex-col items-center justify-center`}>
      <span className={`${textClass} font-bold leading-none`}>{score}</span>
      <span className={`${gradeTextClass} leading-none mt-0.5`}>{grade}</span>
    </div>
  );
}

export function LandCreditBadge({ propertyId, score, grade, size = "md", dimensions }: LandCreditBadgeProps) {
  const skipFetch = score !== undefined || !propertyId;

  const { data, isLoading } = useQuery({
    queryKey: ["land-credit", "property", propertyId],
    queryFn: async () => {
      const res = await fetch(`/api/land-credit/property/${propertyId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !skipFetch,
    staleTime: 5 * 60 * 1000,
  });

  // Resolve score from prop or API
  let resolvedScore = score;
  let resolvedGrade = grade;
  let resolvedDimensions = dimensions;

  if (!skipFetch && data?.history?.length) {
    const latest = data.history[0];
    resolvedScore = latest.score ?? 0;
    resolvedGrade = latest.grade;
    if (latest.factors) {
      resolvedDimensions = {
        location: latest.factors.location?.score ?? 50,
        physical: latest.factors.physical?.score ?? 50,
        legal: latest.factors.legal?.score ?? 50,
        financial: latest.factors.financial?.score ?? 50,
        environmental: latest.factors.environmental?.score ?? 50,
        market: latest.factors.market?.score ?? 50,
      };
    }
  }

  if (resolvedScore === undefined) {
    if (isLoading && size === "sm") {
      return (
        <span className="inline-flex items-center justify-center rounded-full w-5 h-5 text-[10px] font-bold border bg-muted text-muted-foreground animate-pulse">
          ?
        </span>
      );
    }
    return null;
  }

  const clampedScore = Math.max(300, Math.min(850, resolvedScore));
  const displayGrade = (resolvedGrade || gradeFromScore(clampedScore)) as string;

  // Compact — 40px circle for cards/lists
  if (size === "sm") {
    if (resolvedDimensions) {
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary rounded-full"
              aria-label={`Land Credit Score: ${clampedScore} (${displayGrade})`}
            >
              <ScoreCircle score={clampedScore} grade={displayGrade} sizeClass="w-10 h-10" textClass="text-xs" gradeTextClass="text-[8px]" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3" align="end">
            <DimensionBreakdown dimensions={resolvedDimensions} score={clampedScore} grade={displayGrade} />
          </PopoverContent>
        </Popover>
      );
    }

    return (
      <div
        className={`w-10 h-10 rounded-full ${gradeColor(displayGrade)} text-white flex flex-col items-center justify-center`}
        aria-label={`Land Credit Score: ${clampedScore} (${displayGrade})`}
      >
        <span className="text-xs font-bold leading-none">{clampedScore}</span>
        <span className="text-[8px] leading-none mt-0.5">{displayGrade}</span>
      </div>
    );
  }

  // Medium — default card badge
  if (size === "md") {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary rounded-full"
            aria-label={`Land Credit Score: ${clampedScore} (${displayGrade})`}
          >
            <ScoreCircle score={clampedScore} grade={displayGrade} sizeClass="w-10 h-10" textClass="text-xs" gradeTextClass="text-[8px]" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="end">
          {resolvedDimensions ? (
            <DimensionBreakdown dimensions={resolvedDimensions} score={clampedScore} grade={displayGrade} />
          ) : (
            <p className="text-xs text-muted-foreground">Score: {clampedScore} ({displayGrade})</p>
          )}
        </PopoverContent>
      </Popover>
    );
  }

  // Full — 80px circle for detail pages
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex flex-col items-center gap-1 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary rounded-lg p-2"
          aria-label={`Land Credit Score: ${clampedScore} (${displayGrade})`}
        >
          <ScoreCircle score={clampedScore} grade={displayGrade} sizeClass="w-20 h-20" textClass="text-xl" gradeTextClass="text-xs" />
          {resolvedDimensions && (
            <div className="flex gap-0.5 mt-1">
              {Object.values(resolvedDimensions).map((val, i) => (
                <div key={i} className={`w-3 h-1 rounded-full ${barColor(val ?? 50)}`} />
              ))}
            </div>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="center">
        {resolvedDimensions ? (
          <DimensionBreakdown dimensions={resolvedDimensions} score={clampedScore} grade={displayGrade} />
        ) : (
          <p className="text-xs text-muted-foreground">Score: {clampedScore} ({displayGrade})</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
