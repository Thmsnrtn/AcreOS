import { useState, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Brain, Database, Tag, Search, ChevronDown, ChevronUp,
  Lightbulb, History, Layers,
} from "lucide-react";
import { relative } from "@/lib/format";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useCognitiveMemory } from "@/hooks/use-sovereign-dashboard";

function useMemorySearch(query: string, memoryType: string) {
  return useQuery({
    queryKey: ["/api/founder/v13/memory/search", query, memoryType],
    queryFn: async () => {
      if (!query || query.length < 2) return [];
      const params = new URLSearchParams({ q: query, type: memoryType });
      const res = await fetch(`/api/founder/v13/memory/search?${params}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: query.length >= 2,
    staleTime: 30_000,
  });
}

function MemoryCard({ memory }: { memory: any }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();

  const typeColors: Record<string, string> = {
    episodic: "bg-acr-accent text-acr-accent dark:bg-acr-accent dark:text-acr-accent",
    semantic: "bg-acr-brand-soft text-acr-brand dark:bg-acr-brand-soft dark:text-acr-brand",
    working: "bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft dark:text-acr-pos",
    procedural: "bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft dark:text-acr-warn",
  };

  const typeIcons: Record<string, React.ReactNode> = {
    episodic: <History className="w-3.5 h-3.5" aria-hidden="true" />,
    semantic: <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" />,
    working: <Layers className="w-3.5 h-3.5" aria-hidden="true" />,
    procedural: <Database className="w-3.5 h-3.5" aria-hidden="true" />,
  };

  const title = memory.title ?? memory.key ?? memory.subject ?? "Memory";

  return (
    <li>
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`p-1.5 rounded ${typeColors[memory.type] ?? "bg-muted"}`}
                aria-label={`${memory.type ?? "unknown"} memory`}
              >
                {typeIcons[memory.type] ?? <Brain className="w-3.5 h-3.5" aria-hidden="true" />}
              </div>
              <div className="min-w-0">
                <p className="font-medium text-sm line-clamp-1">{title}</p>
                <p className="text-xs text-muted-foreground">
                  {memory.agent ?? memory.source ?? "system"} · {memory.type ?? "unknown"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {memory.strength != null && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  Strength: {Math.round(memory.strength * 100)}%
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-9 min-w-9"
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
                aria-controls={detailsId}
                aria-label={`${expanded ? "Collapse" : "Expand"} memory: ${title}`}
              >
                {expanded ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
              </Button>
            </div>
          </div>

          {expanded && (
            <div id={detailsId} className="mt-3 pl-10 space-y-2">
              {memory.content && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{memory.content}</p>
              )}
              {memory.context && (
                <p className="text-sm text-muted-foreground">{JSON.stringify(memory.context)}</p>
              )}
              {memory.tags && Array.isArray(memory.tags) && memory.tags.length > 0 && (
                <ul className="flex gap-1 flex-wrap" aria-label="Memory tags">
                  {memory.tags.map((tag: string, i: number) => (
                    <li key={i}>
                      <Badge variant="outline" className="text-xs">
                        <Tag className="w-2.5 h-2.5 mr-1" aria-hidden="true" />{tag}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              <dl className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                {memory.accessCount != null && (
                  <div className="flex gap-1">
                    <dt>Accessed:</dt>
                    <dd className="tabular-nums">{memory.accessCount}x</dd>
                  </div>
                )}
                {memory.decayRate != null && (
                  <div className="flex gap-1">
                    <dt>Decay:</dt>
                    <dd className="tabular-nums">{(memory.decayRate * 100).toFixed(1)}%/day</dd>
                  </div>
                )}
                {memory.createdAt && (
                  <div className="flex gap-1">
                    <dt>Created:</dt>
                    <dd className="tabular-nums">{relative(memory.createdAt)}</dd>
                  </div>
                )}
                {memory.lastAccessedAt && (
                  <div className="flex gap-1">
                    <dt>Last accessed:</dt>
                    <dd className="tabular-nums">{relative(memory.lastAccessedAt)}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

export default function MemoryBrowser() {
  useDocumentTitle("Memory browser");
  const searchId = useId();
  const [searchQuery, setSearchQuery] = useState("");
  const [memoryType, setMemoryType] = useState("all");
  const { data: recentMemories = [], isLoading: recentLoading } = useCognitiveMemory();
  const { data: searchResults = [], isLoading: searchLoading } = useMemorySearch(searchQuery, memoryType);

  const isLoading = recentLoading;

  const displayMemories = searchQuery.length >= 2 ? searchResults : recentMemories;

  const typeCounts = Array.isArray(displayMemories) ? displayMemories.reduce((acc: Record<string, number>, m: any) => {
    const type = m.type ?? "unknown";
    acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>) : {};

  const filtered = Array.isArray(displayMemories)
    ? displayMemories.filter((m: any) => memoryType === "all" || m.type === memoryType)
    : [];

  return (
    <PageShell isLoading={isLoading}>
      <div className="space-y-6 md:space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Brain className="w-6 h-6 text-primary" aria-hidden="true" />
            Memory browser
          </h1>
          <p className="text-sm text-muted-foreground">
            Browse episodic, semantic, and working memory from the cognitive memory layer (v13).
          </p>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Label htmlFor={searchId} className="sr-only">Search memories</Label>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id={searchId}
              type="search"
              placeholder="Search memories…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
        </div>

        <Tabs value={memoryType} onValueChange={setMemoryType}>
          <TabsList>
            <TabsTrigger value="all">
              All {Array.isArray(displayMemories) && <Badge variant="secondary" className="ml-1 tabular-nums">{displayMemories.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="episodic">
              Episodic {typeCounts["episodic"] && <Badge variant="secondary" className="ml-1 tabular-nums">{typeCounts["episodic"]}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="semantic">
              Semantic {typeCounts["semantic"] && <Badge variant="secondary" className="ml-1 tabular-nums">{typeCounts["semantic"]}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="working">
              Working {typeCounts["working"] && <Badge variant="secondary" className="ml-1 tabular-nums">{typeCounts["working"]}</Badge>}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <ul className="grid grid-cols-1 md:grid-cols-3 gap-4" aria-label="Memory type descriptions">
          <li>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <History className="w-4 h-4 text-acr-accent" aria-hidden="true" />
                  <p className="font-medium text-sm">Episodic</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Specific events and experiences — deal outcomes, negotiation details, market events.
                </p>
              </CardContent>
            </Card>
          </li>
          <li>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <Lightbulb className="w-4 h-4 text-acr-brand" aria-hidden="true" />
                  <p className="font-medium text-sm">Semantic</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  General knowledge — market patterns, pricing insights, best practices learned.
                </p>
              </CardContent>
            </Card>
          </li>
          <li>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <Layers className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                  <p className="font-medium text-sm">Working</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Active context — current deals, recent conversations, ongoing strategies.
                </p>
              </CardContent>
            </Card>
          </li>
        </ul>

        {searchLoading ? (
          <Card>
            <CardContent className="pt-6 text-center text-sm text-muted-foreground" role="status" aria-live="polite">
              <span className="sr-only">Searching memories…</span>
              Searching memories…
            </CardContent>
          </Card>
        ) : filtered.length > 0 ? (
          <ul className="space-y-3" aria-label={searchQuery.length >= 2 ? "Memory search results" : "Recent memories"}>
            {filtered.map((memory: any, i: number) => (
              <MemoryCard key={memory.id ?? i} memory={memory} />
            ))}
          </ul>
        ) : (
          <Card>
            <CardContent className="pt-6 text-center text-sm text-muted-foreground">
              {searchQuery.length >= 2
                ? "No memories match your search."
                : "No memories stored yet. The cognitive memory layer will populate as agents learn and make decisions."}
            </CardContent>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
