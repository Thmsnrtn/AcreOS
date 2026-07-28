/**
 * LetterConfession — "Since last week — what went wrong" (trust audit,
 * 2026-07-28).
 *
 * Self-reported misses are the fastest trust builder: a self-reported error
 * is a deposit; a discovered one is bankruptcy. Doctrine:
 *   - NEVER hidden when non-empty — a standing section on the Letter.
 *   - SILENT when empty: no celebratory padding, no cheerful empty state.
 *     The section simply doesn't exist.
 *   - Lines arrive pre-worded from the server (narrate.ts) from real
 *     sources (negative outcome scores, trust demotions, overdue checks) —
 *     rendered verbatim, severity never softened. "What changed" appears
 *     only when genuinely known.
 */
import { AlertTriangle } from "lucide-react";
import { formatRelative } from "@/lib/format";

export interface LetterMiss {
  atIso: string | null;
  line: string;
  changed: string | null;
}

export function LetterConfession({ misses }: { misses: LetterMiss[] }) {
  // Honest empty state = silence. Nothing renders, nothing celebrates.
  if (!misses || misses.length === 0) return null;

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="letter-confession"
      aria-label="Since last week — what went wrong"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-[hsl(var(--acr-warn))]" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Since last week — what went wrong</h2>
      </div>
      <ul role="list" className="mt-2 space-y-2.5">
        {misses.map((m, i) => (
          <li key={i} className="text-sm leading-relaxed text-foreground">
            <span>{m.line}</span>
            {m.atIso ? (
              <span className="ml-2 whitespace-nowrap text-xs text-muted-foreground">
                {formatRelative(m.atIso)}
              </span>
            ) : null}
            {m.changed ? (
              <p className="mt-0.5 text-xs text-muted-foreground">What changed: {m.changed}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
