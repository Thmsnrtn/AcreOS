import { useAllListViews, type ListView } from "@/hooks/use-list-view";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RotateCcw, Rows3, LayoutGrid, ListCollapse } from "lucide-react";

/**
 * Settings → Lists. Phase C.3.
 *
 * Per-list-type view picker (rows / cards / expand-on-click). Defaults
 * per surface from design-system §5.5; user can override. Lists not in
 * the registry use rows by default.
 *
 * Surface-level rendering wires up progressively as Phase E ports each
 * list-bearing surface — calling sites use `useListView(listType)`.
 */

const LIST_TYPE_LABELS: Record<string, { label: string; description: string }> = {
  inbox: { label: "Inbox", description: "Email + SMS threads" },
  contacts: { label: "Contacts", description: "People you've connected with" },
  pipeline: { label: "Pipeline", description: "Deals across stages" },
  buyboxes: { label: "Buy boxes", description: "Saved acquisition criteria" },
  lists: { label: "Lists", description: "Lead lists and saved searches" },
  campaigns: { label: "Campaigns", description: "Outbound campaigns" },
  deals: { label: "Deals", description: "Closed and active transactions" },
  parcels: { label: "Parcels", description: "Property records" },
  offers: { label: "Offers", description: "Offers sent and received" },
  documents: { label: "Documents", description: "Contracts, deeds, disclosures" },
  dispositions: { label: "Dispositions", description: "Buyer-side deals" },
};

const VIEW_LABELS: Record<ListView, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  rows: { label: "Rows", icon: Rows3 },
  cards: { label: "Cards", icon: LayoutGrid },
  "expand-on-click": { label: "Expand on click", icon: ListCollapse },
};

export function ListViewsPanel() {
  const { views, knownTypes, setView, reset } = useAllListViews();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">List views</CardTitle>
        <CardDescription>
          How each list type renders by default. Each surface keeps your
          choice across sessions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {knownTypes.map((type) => {
          const meta = LIST_TYPE_LABELS[type] ?? { label: type, description: "" };
          const current = views[type] ?? "rows";
          return (
            <div
              key={type}
              className="flex items-start justify-between gap-4"
              data-testid={`list-view-row-${type}`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{meta.label}</div>
                {meta.description && (
                  <div className="text-xs text-muted-foreground mt-0.5">{meta.description}</div>
                )}
              </div>
              <Select
                value={current}
                onValueChange={(v) => setView(type, v as ListView)}
              >
                <SelectTrigger className="w-44" data-testid={`list-view-select-${type}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(VIEW_LABELS) as ListView[]).map((v) => {
                    const { label, icon: Icon } = VIEW_LABELS[v];
                    return (
                      <SelectItem key={v} value={v}>
                        <span className="flex items-center gap-2">
                          <Icon className="w-3.5 h-3.5" />
                          {label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          );
        })}

        <div className="pt-2 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            className="gap-2 text-muted-foreground"
            data-testid="button-reset-list-views"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset to defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
