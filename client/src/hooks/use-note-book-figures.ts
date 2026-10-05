import { useQuery } from "@tanstack/react-query";
import { okOrThrow } from "@/lib/fetch-honesty";

/**
 * The note book's whole-book figures (GET /api/notes/book-figures), counted
 * in SQL over every active note. Book-wide money figures read these — never
 * a sum over GET /api/notes, which is the capped newest-5,000 table payload
 * (W10.2b audit). Money is in the notes' own dollar units.
 */
export interface NoteBookFigures {
  activeCount: number;
  totalOutstanding: number;
  totalMonthly: number;
  totalFinanced: number;
  weightedRate: number | null;
  averageRate: number | null;
  averageTermMonths: number | null;
  delinquentCount: number;
  totalServiceFees: number;
  taxEscrowCount: number;
  mostDelinquent: {
    id: number;
    borrowerId: number | null;
    borrowerName: string | null;
    nextPaymentDate: string;
    daysLate: number;
  } | null;
  // The Finance hero's figures (PersonaFinanceHero) — see server/storage/noteBookFigures.ts.
  bookYield: number | null;
  feeScheduledCount: number;
  notesWritten: number;
  capitalDeployed: number;
  principalWeightedRate: number | null;
  principalWeightedTermMonths: number | null;
  escrowAccounts: number;
  escrowUnderManagement: number;
  originationVolume: { month: string; amount: number }[];
  originationsInWindow: number;
  originationTimeZone: string;
}

export const NOTE_BOOK_FIGURES_PATH = "/api/notes/book-figures";

/** The viewer's IANA zone, so the origination months are cut in local time as before. */
function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function useNoteBookFigures() {
  return useQuery<NoteBookFigures>({
    // Under /api/notes so every note mutation's invalidation refreshes it.
    queryKey: ["/api/notes", "book-figures"],
    queryFn: async () => {
      const url = `${NOTE_BOOK_FIGURES_PATH}?tz=${encodeURIComponent(viewerTimeZone())}`;
      const res = await okOrThrow(await fetch(url, { credentials: "include" }));
      return (await res.json()) as NoteBookFigures;
    },
  });
}
