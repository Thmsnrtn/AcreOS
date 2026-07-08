/**
 * Find-user search panel for /founder/recovery-console.
 *
 * Extracted from client/src/pages/founder/recovery-console.tsx (W3-5
 * decomposition). State-consistency upgrade in the same pass: shaped
 * skeleton (role="status" wrapper), QueryErrorState with retry (search
 * errors were previously swallowed and rendered as "No users matched"),
 * and an EmptyFilter archetype for zero-hit searches.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyFilter } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import type { UserHit } from "./recovery-shared";

export function FindUserPanel({
  query,
  setQuery,
  isLoading,
  error,
  onRetry,
  results,
  onSelect,
}: {
  query: string;
  setQuery: (s: string) => void;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  results: UserHit[];
  onSelect: (u: UserHit) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Find user</CardTitle>
        <CardDescription>
          Search by email substring or paste an exact userId / Clerk userId.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="email@example.com or userId"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="User search query"
          />
        </div>

        {isLoading ? (
          <div className="space-y-2" role="status" aria-live="polite">
            <span className="sr-only">Searching users…</span>
            {[0, 1, 2].map((i) => (
              <div key={i} className="border rounded-md px-3 py-2 space-y-2">
                <Skeleton announce={false} className="h-4 w-64 max-w-full" />
                <Skeleton announce={false} className="h-3 w-44 max-w-full" />
              </div>
            ))}
          </div>
        ) : error ? (
          <QueryErrorState
            compact
            error={error}
            onRetry={onRetry}
            title="User search failed"
          />
        ) : query.trim().length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Type at least 2 characters.
          </p>
        ) : results.length === 0 ? (
          <EmptyFilter
            filterCount={0}
            headline="No users matched"
            subtitle="Try a different email substring, or paste an exact userId / Clerk userId."
            clearLabel="Clear search"
            onClearFilters={() => setQuery("")}
          />
        ) : (
          <div className="space-y-2">
            {results.map((u) => (
              <button
                key={u.id}
                onClick={() => onSelect(u)}
                className="w-full text-left border rounded-md px-3 py-2 hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label={`Select user ${u.email ?? u.id}`}
              >
                <div className="text-sm font-medium">
                  {u.firstName ?? ""} {u.lastName ?? ""}{" "}
                  <span className="text-muted-foreground">
                    &lt;{u.email ?? "no-email"}&gt;
                  </span>
                </div>
                <div className="text-xs text-muted-foreground font-mono">
                  id={u.id}
                  {u.clerkUserId ? ` · clerk=${u.clerkUserId}` : ""}
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
