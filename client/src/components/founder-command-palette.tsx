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
  User,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { usePersonaMode } from "@/hooks/use-persona-mode";

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
  const { mode: personaMode, setMode: setPersonaMode } = usePersonaMode();

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

  // Inspector shortcuts: "lob" → provider page, "org #12" → org cost tab,
  // "#12345" → cost-event provenance. These run on every keystroke (cheap
  // pattern match) and surface as a top-of-list group so a single Enter
  // keypress lands the founder where they meant to go.
  const trimmed = query.trim().toLowerCase();
  const SUPPORTED_PROVIDERS = [
    "lob",
    "postgrid",
    "twilio",
    "telnyx",
    "sendgrid",
    "ses",
    "openrouter",
    "anthropic",
    "openai",
    "elevenlabs",
    "stripe",
    "sentry",
    "fly",
    "neon",
  ];
  const providerHit = SUPPORTED_PROVIDERS.find((p) => p === trimmed) ?? null;
  const orgIdHit = /^org[ #]+(\d+)$/.exec(trimmed)?.[1] ?? null;
  const ledgerIdHit = /^#?(\d{4,})$/.exec(trimmed)?.[1] ?? null;

  return (
    <CommandDialog open={open} onOpenChange={setOpen} data-testid="command-palette">
      <CommandInput
        placeholder="Search decisions, agents, customers, letters, proposals…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {/* Mode-switch shortcut — always surfaced (with or without
            query). Solves the #1 nav pain of having to hit Back to
            escape /founder/*. Cmd+; toggles the same action globally. */}
        <CommandGroup heading="Switch mode">
          <CommandItem
            key="persona-toggle"
            onSelect={() => {
              const next = personaMode === "founder" ? "customer" : "founder";
              setOpen(false);
              setQuery("");
              setPersonaMode(next);
            }}
            data-testid="palette-persona-toggle"
          >
            <User className="h-4 w-4 mr-2 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">
                {personaMode === "founder"
                  ? "Switch to customer mode"
                  : "Switch to founder mode"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {personaMode === "founder" ? "/today" : "/founder"}
              </p>
            </div>
            <kbd className="ml-2 hidden shrink-0 items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] sm:inline-flex">
              ⌘;
            </kbd>
          </CommandItem>
        </CommandGroup>
        {query.trim().length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">
            <p className="mb-3">Try searching by:</p>
            <ul className="space-y-1 text-xs">
              <li>• An agent name (forge_revenue, sophie_csm)</li>
              <li>• A customer slug or name</li>
              <li>• A keyword from a decision ("churn", "dunning")</li>
              <li>• A month (2026-04)</li>
              <li>• A provider name ("lob", "twilio") for the provider audit</li>
              <li>• "org 12" or a ledger id (#12345) for the inspector</li>
            </ul>
            <p className="mt-4 text-[11px] text-muted-foreground/70">Press Esc to close.</p>
          </div>
        )}
        {(providerHit || orgIdHit || ledgerIdHit) && (
          <CommandGroup heading="Inspector shortcuts">
            {providerHit && (
              <CommandItem
                key={`shortcut-provider-${providerHit}`}
                onSelect={() => go(`/founder/inspector/provider/${providerHit}`)}
                data-testid={`palette-provider-${providerHit}`}
              >
                <ListChecks className="h-4 w-4 mr-2 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">Provider audit: {providerHit}</p>
                  <p className="text-[11px] text-muted-foreground">
                    /founder/inspector/provider/{providerHit}
                  </p>
                </div>
              </CommandItem>
            )}
            {orgIdHit && (
              <CommandItem
                key={`shortcut-org-${orgIdHit}`}
                onSelect={() => go(`/founder/inspector/org/${orgIdHit}`)}
                data-testid={`palette-org-${orgIdHit}`}
              >
                <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">Org #{orgIdHit} — Cost tab</p>
                  <p className="text-[11px] text-muted-foreground">
                    /founder/inspector/org/{orgIdHit}
                  </p>
                </div>
              </CommandItem>
            )}
            {ledgerIdHit && (
              <CommandItem
                key={`shortcut-ledger-${ledgerIdHit}`}
                onSelect={() => go(`/founder/inspector/cost-event/${ledgerIdHit}`)}
                data-testid={`palette-cost-event-${ledgerIdHit}`}
              >
                <ListChecks className="h-4 w-4 mr-2 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">Cost event #{ledgerIdHit}</p>
                  <p className="text-[11px] text-muted-foreground">
                    /founder/inspector/cost-event/{ledgerIdHit}
                  </p>
                </div>
              </CommandItem>
            )}
          </CommandGroup>
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
                    onSelect={() => go(`/founder/inspector/org/${o.id}`)}
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
