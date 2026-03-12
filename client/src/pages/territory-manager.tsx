import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
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
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [counties, setCounties] = useState("");

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
      toast({ title: `Territory "${name}" created` });
      qc.invalidateQueries({ queryKey: ["/api/territories"] });
      setShowCreate(false);
      setName(""); setStateCode(""); setCounties("");
    },
    onError: () => toast({ title: "Failed to create territory", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/territories/${id}`),
    onSuccess: () => {
      toast({ title: "Territory removed" });
      qc.invalidateQueries({ queryKey: ["/api/territories"] });
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const territories = data?.territories ?? [];

  return (
    <PageShell>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-territory-manager-title">
            Territory Manager
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Assign geographic territories to team members for lead ownership.
          </p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)}>
          <Plus className="w-4 h-4 mr-2" /> New Territory
        </Button>
      </div>

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create Territory</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Territory Name</Label>
                <Input placeholder="e.g. North Texas" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">State Code</Label>
                <Input placeholder="TX" maxLength={2} value={stateCode} onChange={e => setStateCode(e.target.value)} className="uppercase" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Counties (comma-separated)</Label>
              <Input placeholder="Dallas, Collin, Denton" value={counties} onChange={e => setCounties(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button disabled={!name || !stateCode || createMutation.isPending} onClick={() => createMutation.mutate()}>
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
              </Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading territories...
        </div>
      ) : territories.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Map className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground text-sm">No territories defined yet.</p>
            <Button className="mt-3" size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-1" /> Create First Territory
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {territories.map(t => (
            <Card key={t.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-sm">{t.name}</CardTitle>
                    <Badge variant="outline" className="text-xs mt-1">{t.stateCode}</Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteMutation.mutate(t.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {t.assignedUserName && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="w-3 h-3" /> {t.assignedUserName}
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Layers className="w-3 h-3" /> {t.counties.length} counties
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Leads</p>
                    <p className="text-sm font-medium">{t.leadCount}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Properties</p>
                    <p className="text-sm font-medium">{t.propertyCount}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
