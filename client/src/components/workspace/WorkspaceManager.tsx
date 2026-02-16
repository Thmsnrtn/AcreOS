import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  LayoutGrid, 
  Plus, 
  ChevronDown, 
  Trash2, 
  Save,
  Briefcase,
  Users,
  TrendingUp,
  Sun,
  Check
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { WorkspacePreset } from "@shared/schema";

const presetIcons: Record<string, typeof LayoutGrid> = {
  morning: Sun,
  deals: Briefcase,
  leads: Users,
  analysis: TrendingUp,
  default: LayoutGrid,
};

const defaultPresets = [
  { name: "Morning Review", icon: "morning", route: "/", description: "Dashboard overview" },
  { name: "Deal Analysis", icon: "deals", route: "/deals", description: "Focus on active deals" },
  { name: "Lead Follow-up", icon: "leads", route: "/leads", description: "CRM and lead management" },
];

export function WorkspaceManager() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");

  const { data: presets = [], isLoading, error } = useQuery<WorkspacePreset[]>({
    queryKey: ["/api/workspaces"],
    onError: (err) => {
      console.error("Failed to load workspaces:", err);
      toast({
        title: "Failed to load workspaces",
        description: "Using default presets only. Your custom workspaces will not be available.",
        variant: "destructive",
      });
    },
  });

  const createPresetMutation = useMutation({
    mutationFn: async (data: { name: string; layout: any }) => {
      return apiRequest("/api/workspaces", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
      setIsCreateOpen(false);
      setNewPresetName("");
      toast({ title: "Workspace saved", description: "Your workspace preset has been created." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save workspace preset.", variant: "destructive" });
    },
  });

  const deletePresetMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/workspaces/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
      toast({ title: "Workspace deleted" });
    },
    onError: (err) => {
      console.error("Failed to delete workspace:", err);
      toast({
        title: "Failed to delete workspace",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSaveCurrentLayout = () => {
    if (!newPresetName.trim()) return;
    
    const layout = {
      route: location,
      sidebarCollapsed: false,
      openPanels: [],
    };
    
    createPresetMutation.mutate({ name: newPresetName, layout });
  };

  const handleLoadPreset = (preset: WorkspacePreset) => {
    if (preset.layout?.route) {
      setLocation(preset.layout.route);
      toast({ title: `Loaded: ${preset.name}` });
    }
  };

  const handleQuickPreset = (route: string, name: string) => {
    setLocation(route);
    toast({ title: `Switched to: ${name}` });
  };

  const currentPreset = presets.find(p => p.layout?.route === location);

  return (
    <div data-testid="workspace-manager">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="outline" 
            size="sm" 
            className="gap-2"
            data-testid="workspace-dropdown-trigger"
          >
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden sm:inline">
              {currentPreset?.name || "Workspaces"}
            </span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {defaultPresets.map((preset) => {
            const Icon = presetIcons[preset.icon] || LayoutGrid;
            const isActive = location === preset.route;
            return (
              <DropdownMenuItem
                key={preset.route}
                onClick={() => handleQuickPreset(preset.route, preset.name)}
                className="gap-2"
                data-testid={`workspace-preset-default-${preset.icon}`}
              >
                <Icon className="h-4 w-4" />
                <div className="flex-1">
                  <div className="font-medium">{preset.name}</div>
                  <div className="text-xs text-muted-foreground">{preset.description}</div>
                </div>
                {isActive && <Check className="h-4 w-4 text-primary" />}
              </DropdownMenuItem>
            );
          })}
          
          {presets.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-[6px] text-xs font-medium text-muted-foreground">
                Your Presets
              </div>
              {presets.map((preset) => {
                const isActive = preset.layout?.route === location;
                return (
                  <DropdownMenuItem
                    key={preset.id}
                    className="gap-2 group"
                    data-testid={`workspace-preset-${preset.id}`}
                  >
                    <LayoutGrid className="h-4 w-4" />
                    <span 
                      className="flex-1 cursor-pointer" 
                      onClick={() => handleLoadPreset(preset)}
                    >
                      {preset.name}
                    </span>
                    {isActive && <Check className="h-4 w-4 text-primary" />}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deletePresetMutation.mutate(preset.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                      data-testid={`delete-workspace-${preset.id}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </DropdownMenuItem>
                );
              })}
            </>
          )}
          
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Save Current Layout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-[400px]" data-testid="save-workspace-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Save className="h-5 w-5" />
              Save Workspace
            </DialogTitle>
            <DialogDescription>
              Save your current view as a workspace preset for quick access.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="preset-name">Preset Name</Label>
              <Input
                id="preset-name"
                placeholder="e.g., Afternoon Tasks"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                data-testid="input-workspace-name"
              />
            </div>
            <div className="text-sm text-muted-foreground">
              <strong>Current view:</strong> {location}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSaveCurrentLayout} 
              disabled={!newPresetName.trim() || createPresetMutation.isPending}
              data-testid="button-save-workspace"
            >
              {createPresetMutation.isPending ? "Saving..." : "Save Workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
