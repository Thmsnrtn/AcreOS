import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ChevronUp, ChevronDown, RotateCcw, GripVertical, Smartphone, Monitor } from "lucide-react";
import { ALL_NAV_ITEMS, NAV_ITEM_MAP, DEFAULT_SIDEBAR_ITEMS, DEFAULT_MOBILE_ITEMS } from "@/lib/nav-items";
import { cn } from "@/lib/utils";

interface NavCustomizerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sidebarItems: string[];
  mobileItems: string[];
  onSidebarChange: (items: string[]) => void;
  onMobileChange: (items: string[]) => void;
  onReset: () => void;
}

function move(arr: string[], index: number, direction: "up" | "down"): string[] {
  const next = [...arr];
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= next.length) return arr;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function ReorderList({
  label,
  icon: Icon,
  items,
  maxItems,
  onChange,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: string[];
  maxItems?: number;
  onChange: (items: string[]) => void;
}) {
  const enabledSet = new Set(items);

  const toggle = (id: string) => {
    if (enabledSet.has(id)) {
      // Remove — keep existing order
      onChange(items.filter((i) => i !== id));
    } else {
      // Add — append to end (or skip if at max)
      if (maxItems && items.length >= maxItems) return;
      onChange([...items, id]);
    }
  };

  // Items shown in order, then the rest alphabetically
  const orderedEnabled = items.filter((id) => NAV_ITEM_MAP.has(id));
  const disabledItems = ALL_NAV_ITEMS.filter((item) => !enabledSet.has(item.id));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <span className="font-medium text-sm">{label}</span>
        {maxItems && (
          <Badge variant="secondary" className="ml-auto text-xs">
            {items.length} / {maxItems}
          </Badge>
        )}
      </div>

      {/* Enabled items — ordered, with reorder controls */}
      {orderedEnabled.length > 0 && (
        <div className="space-y-1">
          {orderedEnabled.map((id, index) => {
            const item = NAV_ITEM_MAP.get(id)!;
            const ItemIcon = item.icon;
            return (
              <div
                key={id}
                className="flex items-center gap-2 px-2 py-2 rounded-lg bg-muted/40 group"
                data-testid={`nav-customizer-item-${id}`}
              >
                <GripVertical className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                <ItemIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-sm flex-1 truncate">{item.label}</span>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => onChange(move(orderedEnabled, index, "up"))}
                    disabled={index === 0}
                    className="p-1 rounded hover:bg-muted disabled:opacity-25 transition-opacity"
                    aria-label={`Move ${item.label} up`}
                    data-testid={`move-up-${id}`}
                  >
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => onChange(move(orderedEnabled, index, "down"))}
                    disabled={index === orderedEnabled.length - 1}
                    className="p-1 rounded hover:bg-muted disabled:opacity-25 transition-opacity"
                    aria-label={`Move ${item.label} down`}
                    data-testid={`move-down-${id}`}
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </div>
                <Switch
                  checked
                  onCheckedChange={() => toggle(id)}
                  aria-label={`Remove ${item.label} from nav`}
                  data-testid={`toggle-${id}`}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Disabled items — flat list to add */}
      {disabledItems.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 px-1 pt-1">
            Available to add
          </p>
          {disabledItems.map((item) => {
            const ItemIcon = item.icon;
            const atMax = maxItems != null && items.length >= maxItems;
            return (
              <div
                key={item.id}
                className={cn(
                  "flex items-center gap-2 px-2 py-2 rounded-lg",
                  atMax ? "opacity-40" : "opacity-70 hover:opacity-100 transition-opacity"
                )}
                data-testid={`nav-customizer-item-${item.id}`}
              >
                <GripVertical className="w-4 h-4 text-muted-foreground/20 shrink-0" />
                <ItemIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-sm flex-1 truncate">{item.label}</span>
                <p className="text-xs text-muted-foreground hidden sm:block truncate max-w-[160px]">
                  {item.description}
                </p>
                <Switch
                  checked={false}
                  disabled={atMax}
                  onCheckedChange={() => toggle(item.id)}
                  aria-label={`Add ${item.label} to nav`}
                  data-testid={`toggle-${item.id}`}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function NavCustomizer({
  open,
  onOpenChange,
  sidebarItems,
  mobileItems,
  onSidebarChange,
  onMobileChange,
  onReset,
}: NavCustomizerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 py-5 border-b border-border">
          <SheetTitle>Customize Navigation</SheetTitle>
          <SheetDescription>
            Choose which pages appear in your sidebar and mobile bar, and reorder them to match your workflow.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">
          {/* Sidebar */}
          <ReorderList
            label="Sidebar"
            icon={Monitor}
            items={sidebarItems}
            onChange={onSidebarChange}
          />

          <Separator />

          {/* Mobile bottom bar */}
          <ReorderList
            label="Mobile Bottom Bar"
            icon={Smartphone}
            items={mobileItems}
            maxItems={4}
            onChange={onMobileChange}
          />
        </div>

        <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="gap-2 text-muted-foreground"
            data-testid="nav-customizer-reset"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset to defaults
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)} data-testid="nav-customizer-done">
            Done
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
