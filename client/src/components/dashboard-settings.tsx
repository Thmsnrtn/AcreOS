import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Settings, GripVertical, ChevronUp, ChevronDown, RotateCcw } from "lucide-react";
import { useOrganization, useUpdateOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import type { Organization } from "@shared/schema";

export interface WidgetConfig {
  id: string;
  label: string;
  defaultVisible: boolean;
}

export const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: "stats", label: "Stats Cards", defaultVisible: true },
  { id: "tasksDue", label: "Tasks Due Today", defaultVisible: true },
  { id: "intelligence", label: "Smart Intelligence", defaultVisible: true },
  { id: "dealVelocityFunnel", label: "Deal Velocity Funnel", defaultVisible: true },
  { id: "playbooks", label: "Playbooks", defaultVisible: true },
  { id: "checklist", label: "Getting Started Checklist", defaultVisible: true },
  { id: "agingLeads", label: "Aging Leads", defaultVisible: true },
  { id: "activityFeed", label: "Activity Feed", defaultVisible: true },
  { id: "inventoryChart", label: "Inventory Status Chart", defaultVisible: true },
  { id: "leadPipelineChart", label: "Lead Pipeline Chart", defaultVisible: true },
];

export interface DashboardWidgetSettings {
  order: string[];
  visibility: Record<string, boolean>;
}

export function getDefaultSettings(): DashboardWidgetSettings {
  return {
    order: DEFAULT_WIDGETS.map(w => w.id),
    visibility: DEFAULT_WIDGETS.reduce((acc, w) => ({ ...acc, [w.id]: w.defaultVisible }), {} as Record<string, boolean>),
  };
}

const LOCAL_STORAGE_KEY = "dashboard-widget-settings";

export function loadSettings(organization: Organization | undefined): DashboardWidgetSettings {
  const orgSettings = organization?.settings?.dashboardWidgets;
  if (orgSettings && orgSettings.order?.length > 0) {
    return orgSettings;
  }
  
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.order?.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.error("Failed to load dashboard settings from localStorage", e);
  }
  
  return getDefaultSettings();
}

interface DashboardSettingsProps {
  settings: DashboardWidgetSettings;
  onSettingsChange: (settings: DashboardWidgetSettings) => void;
}

export function DashboardSettings({ settings, onSettingsChange }: DashboardSettingsProps) {
  const [open, setOpen] = useState(false);
  const [localSettings, setLocalSettings] = useState<DashboardWidgetSettings>(settings);
  const { data: organization } = useOrganization();
  const updateOrg = useUpdateOrganization();
  const { toast } = useToast();

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleVisibilityChange = (widgetId: string, visible: boolean) => {
    setLocalSettings(prev => ({
      ...prev,
      visibility: { ...prev.visibility, [widgetId]: visible },
    }));
  };

  const moveWidget = (widgetId: string, direction: "up" | "down") => {
    const currentIndex = localSettings.order.indexOf(widgetId);
    if (currentIndex === -1) return;
    
    const newIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= localSettings.order.length) return;
    
    const newOrder = [...localSettings.order];
    [newOrder[currentIndex], newOrder[newIndex]] = [newOrder[newIndex], newOrder[currentIndex]];
    setLocalSettings(prev => ({ ...prev, order: newOrder }));
  };

  const handleReset = () => {
    setLocalSettings(getDefaultSettings());
  };

  const handleSave = async () => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(localSettings));
      
      if (organization) {
        await updateOrg.mutateAsync({
          settings: {
            ...organization.settings,
            dashboardWidgets: localSettings,
          },
        });
      }
      
      onSettingsChange(localSettings);
      setOpen(false);
      toast({
        title: "Dashboard settings saved",
        description: "Your widget preferences have been updated.",
      });
    } catch (error) {
      console.error("Failed to save dashboard settings", error);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(localSettings));
      onSettingsChange(localSettings);
      setOpen(false);
      toast({
        title: "Settings saved locally",
        description: "Preferences saved to your browser (backend sync unavailable).",
        variant: "default",
      });
    }
  };

  const getWidgetLabel = (widgetId: string): string => {
    return DEFAULT_WIDGETS.find(w => w.id === widgetId)?.label || widgetId;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" data-testid="button-dashboard-settings">
          <Settings className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Customize Dashboard
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            Show, hide, and reorder dashboard widgets to customize your view.
          </p>
          
          <div className="space-y-2">
            {localSettings.order.map((widgetId, index) => (
              <div
                key={widgetId}
                className="flex items-center justify-between gap-2 p-3 rounded-md bg-muted/50"
                data-testid={`widget-settings-${widgetId}`}
              >
                <div className="flex items-center gap-3">
                  <GripVertical className="w-4 h-4 text-muted-foreground" />
                  <Label htmlFor={`widget-${widgetId}`} className="font-medium text-sm cursor-pointer">
                    {getWidgetLabel(widgetId)}
                  </Label>
                </div>
                
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      disabled={index === 0}
                      onClick={() => moveWidget(widgetId, "up")}
                      data-testid={`button-move-up-${widgetId}`}
                    >
                      <ChevronUp className="w-3 h-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      disabled={index === localSettings.order.length - 1}
                      onClick={() => moveWidget(widgetId, "down")}
                      data-testid={`button-move-down-${widgetId}`}
                    >
                      <ChevronDown className="w-3 h-3" />
                    </Button>
                  </div>
                  <Switch
                    id={`widget-${widgetId}`}
                    checked={localSettings.visibility[widgetId] ?? true}
                    onCheckedChange={(checked) => handleVisibilityChange(widgetId, checked)}
                    data-testid={`switch-visibility-${widgetId}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="flex items-center justify-between gap-2 pt-2">
          <Button variant="outline" onClick={handleReset} data-testid="button-reset-dashboard">
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} data-testid="button-cancel-settings">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={updateOrg.isPending} data-testid="button-save-dashboard-settings">
              {updateOrg.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
