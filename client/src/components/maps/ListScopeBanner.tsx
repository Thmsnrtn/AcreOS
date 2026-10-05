/**
 * ListScopeBanner (W10.3) — says, on the leads view, that the rows are the
 * members of ONE saved county list (`/leads?listId=`), so a narrowed view is
 * never mistaken for the whole book. The list's name comes from the server's
 * lists read; while that is unknown the banner says "a saved list", not a guess.
 */
import { ListChecks, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useListBuilderLists } from "@/hooks/use-list-builder";

export function ListScopeBanner({ listId, onClear }: { listId: number; onClear: () => void }) {
  const lists = useListBuilderLists();
  const row = lists.data?.lists.find((l) => l.id === listId) ?? null;
  return (
    <div
      className="mb-4 flex items-center justify-between gap-3 rounded-card border bg-muted/40 px-3 py-2 text-sm"
      role="status"
      data-testid="leads-list-scope"
    >
      <span className="flex min-w-0 items-center gap-2">
        <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">
          Showing the leads in {row ? <strong>{row.name}</strong> : "a saved list"}
          {row ? ` (${row.county}, ${row.state})` : ""}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClear}
        className="shrink-0 min-h-11 pointer-fine:sm:min-h-8"
        data-testid="button-clear-list-scope"
      >
        <X className="mr-1 h-4 w-4" aria-hidden="true" />
        Show all leads
      </Button>
    </div>
  );
}
