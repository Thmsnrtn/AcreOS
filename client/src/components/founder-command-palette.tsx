/**
 * FounderCommandPalette — ⌘K / Ctrl+K global search.
 *
 * Renders at app level via FounderCommandPaletteProvider. Opens a
 * dialog with live search across:
 *   - Decisions (label, agent, item type)
 *   - Agents (codename, title, wing)
 *   - Organizations (name, slug)
 *   - Founder letters (month key, content)
 *   - Strategic proposals (title, rationale)
 *
 * Selecting a result navigates to the appropriate page. Keyboard-only
 * navigation works end to end.
 *
 * The palette is only available to authenticated founders (the search
 * endpoint requires founder auth). Non-founders won't see a shortcut
 * trigger.
 */

import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Brain,
  Building2,
  FileText,
  Lightbulb,
  ListChecks,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

interface DecisionHit {
  id: number;
  label: string;
  itemType: string;
  status: string;
  agent: string | null;
  organizationId: number | null;
}
interface AgentHit {
  codename: string;
  title: string;
  wing: string;
  trustScore: number;
}
interface OrgHit {
  id: number;
  name: string;
  slug: string;
  subscriptionTier: string;
  subscriptionStatus: string;
}
interface LetterHit {
  monthKey: string;
  status: string;
}
interface ProposalHit {
  id: number;
  title: string;
  category: string;
  status: string;
  proposedBy: string;
  monthKey: string | null;
}

interface SearchResponse {
  groups: Array<
    | { key: "decisions"; label: string; items: DecisionHit[] }
    | { key: "agents"; label: string; items: AgentHit[] }
    | { key: "organizations"; label: string; items: OrgHit[] }
    | { key: "letters"; label: string; items: LetterHit[] }
    | { key: "proposals"; label: string; items: ProposalHit[] }
  >;
}

interface PaletteCtx {
  open: boolean;
  setOpen: (open: boolean) => void;
}
const Ctx = createContext<PaletteCtx>({ open: false, setOpen: () => {} });

export function useCommandPalette() {
  return useContext(Ctx);
}

export function FounderCommandPaletteProvider({ children }: PropsWithChildren) {
  const [open, setOpen] = useState(false);
  const { isFounder } = useAuth();

  // ⌘⇧K / Ctrl+Shift+K — founder-specific palette. The non-shift ⌘K is
  // already claimed by the operator-level palette (leads/properties/
  // deals); this one searches founder-side entities (decisions, agents,
  // letters, proposals) so the two don't collide.
  useEffect(() => {
    if (!isFounder) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isFounder]);

  return (
    <Ctx.Provider value={{ open, setOpen }}>
      {children}
      {isFounder && <PaletteDialog open={open} setOpen={setOpen} />}
    </Ctx.Provider>
  );
}

function PaletteDialog({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [, navigate] = useLocation();

  const { data, isFetching } = useQuery<SearchResponse>({
    queryKey: ["/api/founder/intelligence/search", query],
    queryFn: async () => {
      if (!query.trim()) return { groups: [] };
      const url = `/api/founder/intelligence/search?q=${encodeURIComponent(query)}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`search failed ${r.status}`);
      return r.json();
    },
    enabled: open && query.trim().length > 0,
    staleTime: 5_000,
  });

  const go = (path: string) => {
    setOpen(false);
    setQuery("");
    navigate(path);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} data-testid="command-palette">
      <CommandInput
        placeholder="Search decisions, agents, customers, letters, proposals…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {query.trim().length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">
            <p className="mb-3">Try searching by:</p>
            <ul className="space-y-1 text-xs">
              <li>• An agent name (forge_revenue, sophie_csm)</li>
              <li>• A customer slug or name</li>
              <li>• A keyword from a decision ("churn", "dunning")</li>
              <li>• A month (2026-04)</li>
            </ul>
            <p className="mt-4 text-[11px] text-muted-foreground/70">Press Esc to close.</p>
          </div>
        )}
        {query.trim().length > 0 && !isFetching && (data?.groups?.length ?? 0) === 0 && (
          <CommandEmpty>No matches.</CommandEmpty>
        )}
        {data?.groups?.map((g) => {
          if (g.key === "decisions") {
            return (
              <CommandGroup key={g.key} heading={g.label}>
                {g.items.map((d) => (
                  <CommandItem
                    key={`d-${d.id}`}
                    onSelect={() => go(`/founder/decisions?id=${d.id}`)}
                    data-testid={`palette-decision-${d.id}`}
                  >
                    <ListChecks className="h-4 w-4 mr-2 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground truncate">{d.label}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {d.agent ?? "agent"} · {d.itemType} · {d.status}
                      </p>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          }
          if (g.key === "agents") {
            return (
              <CommandGroup key={g.key} heading={g.label}>
                {g.items.map((a) => (
                  <CommandItem
                    key={`a-${a.codename}`}
                    onSelect={() => go(`/founder/agents/${a.codename}`)}
                    data-testid={`palette-agent-${a.codename}`}
                  >
                    <Brain className="h-4 w-4 mr-2 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">
                        {a.title}{" "}
                        <span className="text-[11px] text-muted-foreground font-mono">
                          ({a.codename})
                        </span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {a.wing} wing · trust {a.trustScore}
                      </p>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          }
          if (g.key === "organizations") {
            return (
              <CommandGroup key={g.key} heading={g.label}>
                {g.items.map((o) => (
                  <CommandItem
                    key={`o-${o.id}`}
                    onSelect={() => go(`/organizations/${o.id}`)}
                    data-testid={`palette-org-${o.id}`}
                  >
                    <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground truncate">{o.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {o.slug} · {o.subscriptionTier} / {o.subscriptionStatus}
                      </p>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          }
          if (g.key === "letters") {
            return (
              <CommandGroup key={g.key} heading={g.label}>
                {g.items.map((l) => (
                  <CommandItem
                    key={`l-${l.monthKey}`}
                    onSelect={() => go(`/founder/letter`)}
                    data-testid={`palette-letter-${l.monthKey}`}
                  >
                    <FileText className="h-4 w-4 mr-2 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">{l.monthKey}</p>
                      <p className="text-[11px] text-muted-foreground">{l.status}</p>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          }
          if (g.key === "proposals") {
            return (
              <CommandGroup key={g.key} heading={g.label}>
                {g.items.map((p) => (
                  <CommandItem
                    key={`p-${p.id}`}
                    onSelect={() => go(`/founder/letter`)}
                    data-testid={`palette-proposal-${p.id}`}
                  >
                    <Lightbulb className="h-4 w-4 mr-2 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground truncate">{p.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {p.proposedBy} · {p.category} · {p.status}
                        {p.monthKey ? ` · ${p.monthKey}` : ""}
                      </p>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          }
          return null;
        })}
      </CommandList>
    </CommandDialog>
  );
}
