import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, Plus, Star, Trash2, Settings, Eye, EyeOff, Check } from "lucide-react";
import type { SavedView, CustomFieldEntityType } from "@shared/schema";

interface SavedViewsSelectorProps {
  entityType: CustomFieldEntityType;
  currentFilters?: Record<string, any>;
  currentSort?: { field: string; order: "asc" | "desc" };
  visibleColumns?: string[];
  allColumns?: { key: string; label: string }[];
  onApplyView: (view: SavedView) => void;
  onColumnsChange?: (columns: string[]) => void;
}

export function SavedViewsSelector({
  entityType,
  currentFilters = {},
  currentSort,
  visibleColumns = [],
  allColumns = [],
  onApplyView,
  onColumnsChange,
}: SavedViewsSelectorProps) {
  const { toast } = useToast();
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [isShared, setIsShared] = useState(false);
  const storageKey = `savedView:${entityType}`;
  const [selectedViewId, setSelectedViewId] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? Number(raw) : null;
    } catch {
      return null;
    }
  });

  const { data: views = [], isLoading } = useQuery<SavedView[]>({
    queryKey: ["/api/saved-views", entityType],
    queryFn: async () => {
      const res = await fetch(`/api/saved-views?entityType=${entityType}`);
      if (!res.ok) throw new Error("Failed to load saved views");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; isShared: boolean }) => {
      const filters = Object.entries(currentFilters)
        .filter(([_, v]) => v !== "" && v !== null && v !== undefined)
        .map(([field, value]) => ({
          field,
          operator: "equals",
          value,
        }));

      return apiRequest("POST", "/api/saved-views", {
        entityType,
        name: data.name,
        filters: filters.length > 0 ? filters : null,
        sortBy: currentSort?.field || null,
        sortOrder: currentSort?.order || "desc",
        columns: visibleColumns.length > 0 ? visibleColumns : null,
        isShared: data.isShared,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-views", entityType] });
      toast({ title: "View saved successfully" });
      setIsSaveDialogOpen(false);
      setNewViewName("");
      setIsShared(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save view", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/saved-views/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-views", entityType] });
      toast({ title: "View deleted" });
      if (selectedViewId) {
        setSelectedViewId(null);
      }
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete view", description: err.message, variant: "destructive" });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("POST", `/api/saved-views/${id}/set-default`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-views", entityType] });
      toast({ title: "Default view updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to set default view", description: err.message, variant: "destructive" });
    },
  });

  const handleApplyView = (view: SavedView) => {
    setSelectedViewId(view.id);
    try { localStorage.setItem(storageKey, String(view.id)); } catch {}
    onApplyView(view);
  };

  const handleSaveView = () => {
    if (!newViewName.trim()) return;
    createMutation.mutate({ name: newViewName.trim(), isShared });
  };

  const toggleColumn = (columnKey: string) => {
    if (!onColumnsChange) return;
    const newColumns = visibleColumns.includes(columnKey)
      ? visibleColumns.filter((c) => c !== columnKey)
      : [...visibleColumns, columnKey];
    onColumnsChange(newColumns);
  };

  const selectedView = views.find((v) => v.id === selectedViewId);
  const defaultView = views.find((v) => v.isDefault);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-2" data-testid="button-saved-views">
            {selectedView ? (
              <>
                {selectedView.name}
                {selectedView.isDefault && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
              </>
            ) : (
              <>
                {defaultView ? defaultView.name : "All"}
              </>
            )}
            <ChevronDown className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem
            onClick={() => {
              setSelectedViewId(null);
              try { localStorage.removeItem(storageKey); } catch {}
              onApplyView({
                id: 0,
                organizationId: 0,
                entityType,
                name: "All",
                filters: null,
                sortBy: null,
                sortOrder: "desc",
                columns: null,
                isDefault: false,
                isShared: false,
                createdBy: null,
                createdAt: null,
                updatedAt: null,
              });
            }}
            data-testid="dropdown-view-all"
          >
            <Eye className="w-4 h-4 mr-2" />
            All {entityType}s
          </DropdownMenuItem>
          {views.length > 0 && <DropdownMenuSeparator />}
          {views.map((view) => (
            <DropdownMenuItem
              key={view.id}
              className="flex items-center justify-between gap-2"
              onClick={() => handleApplyView(view)}
              data-testid={`dropdown-view-${view.id}`}
            >
              <div className="flex items-center gap-2">
                {view.isDefault && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
                {view.name}
                {view.isShared && <Badge variant="secondary" className="text-xs">Shared</Badge>}
              </div>
              {selectedViewId === view.id && <Check className="w-4 h-4" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsSaveDialogOpen(true)} data-testid="dropdown-save-view">
            <Plus className="w-4 h-4 mr-2" />
            Save current view
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {selectedView && selectedView.id > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" data-testid="button-view-actions">
              <Settings className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem 
              onClick={() => setDefaultMutation.mutate(selectedView.id)}
              disabled={selectedView.isDefault}
              data-testid="button-set-default-view"
            >
              <Star className="w-4 h-4 mr-2" />
              Set as default
            </DropdownMenuItem>
            <DropdownMenuItem 
              className="text-destructive"
              onClick={() => deleteMutation.mutate(selectedView.id)}
              data-testid="button-delete-view"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete view
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {allColumns.length > 0 && onColumnsChange && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2" data-testid="button-column-visibility">
              <Eye className="w-4 h-4" />
              Columns
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Visible Columns</Label>
              {allColumns.map((column) => (
                <div key={column.key} className="flex items-center space-x-2">
                  <Checkbox
                    id={`column-${column.key}`}
                    checked={visibleColumns.includes(column.key)}
                    onCheckedChange={() => toggleColumn(column.key)}
                    data-testid={`checkbox-column-${column.key}`}
                  />
                  <Label htmlFor={`column-${column.key}`} className="text-sm font-normal">
                    {column.label}
                  </Label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      <Dialog open={isSaveDialogOpen} onOpenChange={setIsSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save View</DialogTitle>
            <DialogDescription>
              Save the current filters, sort order, and column visibility as a reusable view.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="viewName">View Name</Label>
              <Input
                id="viewName"
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                placeholder="e.g., Hot Leads, Active Properties"
                data-testid="input-view-name"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="isShared"
                checked={isShared}
                onCheckedChange={(checked) => setIsShared(!!checked)}
                data-testid="checkbox-is-shared"
              />
              <Label htmlFor="isShared" className="text-sm font-normal">
                Share with team members
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSaveDialogOpen(false)} data-testid="button-cancel-save">
              Cancel
            </Button>
            <Button 
              onClick={handleSaveView}
              disabled={!newViewName.trim() || createMutation.isPending}
              data-testid="button-confirm-save"
            >
              Save View
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
