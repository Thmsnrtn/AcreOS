import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Brain, Database, Clock, Tag, Search, ChevronDown, ChevronUp,
  Lightbulb, History, Layers,
} from "lucide-react";
import { relative } from "@/lib/format";
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

  const typeColors: Record<string, string> = {
    episodic: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    semantic: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    working: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    procedural: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  };

  const typeIcons: Record<string, React.ReactNode> = {
    episodic: <History className="w-3.5 h-3.5" />,
    semantic: <Lightbulb className="w-3.5 h-3.5" />,
    working: <Layers className="w-3.5 h-3.5" />,
    procedural: <Database className="w-3.5 h-3.5" />,
  };

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-1.5 rounded ${typeColors[memory.type] ?? "bg-gray-100"}`}>
              {typeIcons[memory.type] ?? <Brain className="w-3.5 h-3.5" />}
            </div>
            <div>
              <p className="font-medium text-sm line-clamp-1">
                {memory.title ?? memory.key ?? memory.subject ?? "Memory"}
              </p>
              <p className="text-xs text-muted-foreground">
                {memory.agent ?? memory.source ?? "system"} · {memory.type ?? "unknown"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {memory.strength != null && (
              <span className="text-xs text-muted-foreground">
                Strength: {Math.round(memory.strength * 100)}%
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="mt-3 pl-10 space-y-2">
            {memory.content && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{memory.content}</p>
            )}
            {memory.context && (
              <p className="text-sm text-muted-foreground">{JSON.stringify(memory.context)}</p>
            )}
            {memory.tags && Array.isArray(memory.tags) && memory.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {memory.tags.map((tag: string, i: number) => (
                  <Badge key={i} variant="outline" className="text-xs">
                    <Tag className="w-2.5 h-2.5 mr-1" />{tag}
                  </Badge>
                ))}
              </div>
            )}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {memory.accessCount != null && <span>Accessed {memory.accessCount}x</span>}
              {memory.decayRate != null && <span>Decay: {(memory.decayRate * 100).toFixed(1)}%/day</span>}
              {memory.createdAt && (
                <span>Created {relative(memory.createdAt)}</span>
              )}
              {memory.lastAccessedAt && (
                <span>Last accessed {relative(memory.lastAccessedAt)}</span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function MemoryBrowser() {
  const [searchQuery, setSearchQuery] = useState("");
  const [memoryType, setMemoryType] = useState("all");
  const { data: recentMemories = [], isLoading: recentLoading } = useCognitiveMemory();
  const { data: searchResults = [], isLoading: searchLoading } = useMemorySearch(searchQuery, memoryType);

  const isLoading = recentLoading;

  const displayMemories = searchQuery.length >= 2 ? searchResults : recentMemories;

  // Group by type for stats
  const typeCounts = Array.isArray(displayMemories) ? displayMemories.reduce((acc: Record<string, number>, m: any) => {
    const type = m.type ?? "unknown";
    acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>) : {};

  return (
    <PageShell isLoading={isLoading}>
      <div className="space-y-6 md:space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Brain className="w-6 h-6 text-primary" />
            Memory Browser
          </h1>
          <p className="text-sm text-muted-foreground">
            Browse episodic, semantic, and working memory from the cognitive memory layer (v13)
          </p>
        </div>

        {/* Search */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search memories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Memory Type Filter */}
        <Tabs value={memoryType} onValueChange={setMemoryType}>
          <TabsList>
            <TabsTrigger value="all">
              All {Array.isArray(displayMemories) && <Badge variant="secondary" className="ml-1">{displayMemories.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="episodic">
              Episodic {typeCounts["episodic"] && <Badge variant="secondary" className="ml-1">{typeCounts["episodic"]}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="semantic">
              Semantic {typeCounts["semantic"] && <Badge variant="secondary" className="ml-1">{typeCounts["semantic"]}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="working">
              Working {typeCounts["working"] && <Badge variant="secondary" className="ml-1">{typeCounts["working"]}</Badge>}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Memory Type Descriptions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <History className="w-4 h-4 text-blue-500" />
                <p className="font-medium text-sm">Episodic</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Specific events and experiences — deal outcomes, negotiation details, market events
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <Lightbulb className="w-4 h-4 text-purple-500" />
                <p className="font-medium text-sm">Semantic</p>
              </div>
              <p className="text-xs text-muted-foreground">
                General knowledge — market patterns, pricing insights, best practices learned
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <Layers className="w-4 h-4 text-green-500" />
                <p className="font-medium text-sm">Working</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Active context — current deals, recent conversations, ongoing strategies
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Memory List */}
        <div className="space-y-3">
          {searchLoading ? (
            <Card>
              <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                Searching memories...
              </CardContent>
            </Card>
          ) : Array.isArray(displayMemories) && displayMemories.length > 0 ? (
            displayMemories
              .filter((m: any) => memoryType === "all" || m.type === memoryType)
              .map((memory: any, i: number) => (
                <MemoryCard key={memory.id ?? i} memory={memory} />
              ))
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
      </div>
    </PageShell>
  );
}
