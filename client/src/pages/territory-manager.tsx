import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Map, Plus, Users, Layers, Trash2, Loader2 } from "lucide-react";

interface Territory {
  id: number;
  name: string;
  description?: string;
  assignedUserId?: number;
  assignedUserName?: string;
  counties: string[];
  stateCode: string;
  leadCount: number;
  propertyCount: number;
  createdAt: string;
}

export default function TerritoryManagerPage() {
  useDocumentTitle("Territory manager");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [counties, setCounties] = useState("");
  const [territoryToDelete, setTerritoryToDelete] = useState<Territory | null>(null);
  const nameId = useId();
  const stateId = useId();
  const countiesId = useId();

  const { data, isLoading } = useQuery<{ territories: Territory[] }>({
    queryKey: ["/api/territories"],
    queryFn: () => fetch("/api/territories").then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/territories", {
      name,
      stateCode: stateCode.toUpperCase(),
      counties: counties.split(",").map(c => c.trim()).filter(Boolean),
    }),
    onSuccess: () => {
      toast({ title: `Territory "${name}" created.` });
      qc.invalidateQueries({ queryKey: ["/api/territories"] });
      setShowCreate(false);
      setName(""); setStateCode(""); setCounties("");
    },
    onError: () =>
      toast({
        title: "Couldn't create territory",
        description: "No territory was created — your input is preserved. Check fields and try again.",
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/territories/${id}`),
    onSuccess: () => {
      toast({ title: "Territory removed." });
      qc.invalidateQueries({ queryKey: ["/api/territories"] });
      setTerritoryToDelete(null);
    },
    onError: () =>
      toast({
        title: "Couldn't remove territory",
        description: "The territory and its assignments are unchanged.",
        variant: "destructive",
      }),
  });

  const territories = data?.territories ?? [];

  return (
    <PageShell>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-territory-manager-title">
            Territory manager
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Assign geographic territories to team members for lead ownership.
          </p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)} className="min-h-11" aria-expanded={showCreate}>
          <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> New territory
        </Button>
      </div>

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create territory</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => { e.preventDefault(); if (name && stateCode && !createMutation.isPending) createMutation.mutate(); }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor={nameId} className="text-xs">
                    Territory name <span className="text-destructive" aria-label="required">*</span>
                  </Label>
                  <Input
                    id={nameId}
                    placeholder="e.g. North Texas"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    autoCapitalize="words"
                  />
                </div>
                <div>
                  <Label htmlFor={stateId} className="text-xs">
                    State code <span className="text-destructive" aria-label="required">*</span>
                  </Label>
                  <Input
                    id={stateId}
                    placeholder="TX"
                    maxLength={2}
                    value={stateCode}
                    onChange={e => setStateCode(e.target.value.toUpperCase())}
                    className="uppercase"
                    autoCapitalize="characters"
                    autoComplete="address-level1"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor={countiesId} className="text-xs">Counties (comma-separated)</Label>
                <Input
                  id={countiesId}
                  placeholder="Dallas, Collin, Denton"
                  value={counties}
                  onChange={e => setCounties(e.target.value)}
                  autoCapitalize="words"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  disabled={!name || !stateCode || createMutation.isPending}
                  className="min-h-11"
                >
                  {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : "Create"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowCreate(false)} className="min-h-11">Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground" role="status" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading territories…
        </div>
      ) : territories.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Map className="w-8 h-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
            <p className="text-muted-foreground text-sm">No territories defined yet.</p>
            <Button className="mt-3 min-h-9" size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Create first territory
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Territories">
          {territories.map(t => (
            <li key={t.id}>
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-sm">{t.name}</CardTitle>
                      <Badge variant="outline" className="text-xs mt-1">{t.stateCode}</Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 min-h-9 min-w-9 text-muted-foreground hover:text-destructive"
                      onClick={() => setTerritoryToDelete(t)}
                      aria-label={`Delete territory: ${t.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {t.assignedUserName && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="w-3 h-3" aria-hidden="true" /> {t.assignedUserName}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Layers className="w-3 h-3" aria-hidden="true" /> <span className="tabular-nums">{t.counties.length}</span> counties
                  </div>
                  <dl className="grid grid-cols-2 gap-2 pt-1">
                    <div className="text-center">
                      <dt className="text-xs text-muted-foreground">Leads</dt>
                      <dd className="text-sm font-medium tabular-nums">{t.leadCount}</dd>
                    </div>
                    <div className="text-center">
                      <dt className="text-xs text-muted-foreground">Properties</dt>
                      <dd className="text-sm font-medium tabular-nums">{t.propertyCount}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!territoryToDelete}
        onOpenChange={(open) => !open && setTerritoryToDelete(null)}
        title={territoryToDelete ? `Delete territory "${territoryToDelete.name}"?` : "Delete territory?"}
        description="This removes the territory and its assignments. Leads and properties inside it are unchanged — they just become unassigned from this territory."
        confirmLabel="Delete territory"
        variant="destructive"
        onConfirm={() => {
          if (territoryToDelete) deleteMutation.mutate(territoryToDelete.id);
        }}
      />
    </PageShell>
  );
}
