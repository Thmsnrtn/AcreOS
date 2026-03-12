/**
 * T35 — Bulk Action Bar
 *
 * Floating action bar that appears when rows are selected.
 * Configurable actions via props — reusable across leads, properties, deals.
 */

import { X, Trash2, Tag, UserCheck, Download, Mail, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export interface BulkAction {
  label: string;
  icon?: React.ReactNode;
  variant?: "default" | "destructive" | "outline";
  requireConfirm?: boolean;
  confirmMessage?: string;
  options?: { label: string; value: string }[];
  onClick?: (selectedIds: number[]) => void;
  onSelect?: (selectedIds: number[], value: string) => void;
}

interface Props {
  selectedCount: number;
  selectedIds: Set<number>;
  actions: BulkAction[];
  onClear: () => void;
  entityLabel?: string; // e.g. "lead", "property"
}

export default function BulkActionBar({
  selectedCount,
  selectedIds,
  actions,
  onClear,
  entityLabel = "item",
}: Props) {
  if (selectedCount === 0) return null;

  const idArray = Array.from(selectedIds);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-200">
      <div className="flex items-center gap-2 bg-background border border-border rounded-xl shadow-lg px-4 py-3">
        {/* Count badge */}
        <Badge variant="secondary" className="font-semibold">
          {selectedCount} {entityLabel}{selectedCount !== 1 ? "s" : ""} selected
        </Badge>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Actions */}
        {actions.map((action, idx) => {
          if (action.options && action.options.length > 0) {
            return (
              <DropdownMenu key={idx}>
                <DropdownMenuTrigger asChild>
                  <Button variant={action.variant ?? "outline"} size="sm" className="gap-1.5">
                    {action.icon}
                    {action.label}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center">
                  {action.options.map(opt => (
                    <DropdownMenuItem
                      key={opt.value}
                      onClick={() => action.onSelect?.(idArray, opt.value)}
                    >
                      {opt.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          }

          if (action.requireConfirm) {
            return (
              <AlertDialog key={idx}>
                <AlertDialogTrigger asChild>
                  <Button variant={action.variant ?? "outline"} size="sm" className="gap-1.5">
                    {action.icon}
                    {action.label}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {action.confirmMessage ||
                        `This will ${action.label.toLowerCase()} ${selectedCount} ${entityLabel}(s). This action cannot be undone.`}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => action.onClick?.(idArray)}
                      className={action.variant === "destructive" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
                    >
                      {action.label}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            );
          }

          return (
            <Button
              key={idx}
              variant={action.variant ?? "outline"}
              size="sm"
              className="gap-1.5"
              onClick={() => action.onClick?.(idArray)}
            >
              {action.icon}
              {action.label}
            </Button>
          );
        })}

        <div className="w-px h-5 bg-border mx-1" />

        {/* Clear */}
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClear}>
          <X className="h-4 w-4" />
          <span className="sr-only">Clear selection</span>
        </Button>
      </div>
    </div>
  );
}
