export interface AcceptedAdvisory {
  advisory: string;
  justification: string;
  reviewTrigger: string;
  reviewBy: string;
}

export function evaluate(
  report: unknown,
  accepted: AcceptedAdvisory[] | undefined,
  lockPackages: Record<string, { dev?: boolean; version?: string }> | undefined,
  today?: string,
): { lines: string[]; failures: string[] };
