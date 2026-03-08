import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';

interface LandCreditBadgeProps {
  propertyId?: number;
  score?: number;
  size?: 'sm' | 'md';
}

function getGrade(score: number): string {
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  if (score >= 20) return 'D';
  return 'F';
}

function getGradeFromCreditScore(creditScore: number): string {
  // The land credit service uses a 300-850 FICO-like scale
  // Map to A-F for badge display
  if (creditScore >= 740) return 'A';
  if (creditScore >= 670) return 'B';
  if (creditScore >= 580) return 'C';
  if (creditScore >= 500) return 'D';
  return 'F';
}

function gradeToColorClass(grade: string): string {
  switch (grade) {
    case 'A': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200';
    case 'B': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200';
    case 'C': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200';
    case 'D': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 border-orange-200';
    case 'F': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200';
    default:  return 'bg-muted text-muted-foreground';
  }
}

function ScoreBadge({ score, rawScore, size }: { score: number; rawScore?: number; size: 'sm' | 'md' }) {
  // score is 0-100 scale passed directly, or we derive grade from 300-850 scale
  const grade = rawScore !== undefined
    ? getGradeFromCreditScore(rawScore)
    : getGrade(score);
  const colorClass = gradeToColorClass(grade);

  if (size === 'sm') {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full w-5 h-5 text-[10px] font-bold border ${colorClass}`}
        title={`AcreOS Credit: ${grade}${rawScore !== undefined ? ` (${rawScore})` : ''}`}
      >
        {grade}
      </span>
    );
  }

  return (
    <Badge className={`${colorClass} gap-1 text-xs font-medium`}>
      AcreOS Credit: {grade}{rawScore !== undefined ? ` (${rawScore})` : ''}
    </Badge>
  );
}

export function LandCreditBadge({ propertyId, score, size = 'md' }: LandCreditBadgeProps) {
  // If score provided directly, render immediately
  const skipFetch = score !== undefined || !propertyId;

  const { data, isLoading } = useQuery({
    queryKey: ['land-credit', 'property', propertyId],
    queryFn: async () => {
      const res = await fetch(`/api/land-credit/property/${propertyId}`, {
        credentials: 'include',
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !skipFetch,
    // Don't refetch aggressively; credit scores don't change often
    staleTime: 1000 * 60 * 5,
  });

  // If score prop provided, use it (treated as 0-100 scale)
  if (score !== undefined) {
    return <ScoreBadge score={score} size={size} />;
  }

  if (skipFetch || isLoading) {
    if (size === 'sm') {
      return (
        <span className="inline-flex items-center justify-center rounded-full w-5 h-5 text-[10px] font-bold border bg-muted text-muted-foreground">
          ?
        </span>
      );
    }
    return null;
  }

  const history = data?.history ?? [];
  if (history.length === 0) return null;

  const latest = history[0];
  const rawScore: number = latest.score ?? 0;

  return <ScoreBadge score={rawScore} rawScore={rawScore} size={size} />;
}
