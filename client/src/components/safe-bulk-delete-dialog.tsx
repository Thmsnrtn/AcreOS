import { useState, useEffect, useId } from "react";
import { Label } from "@/components/ui/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { 
  Trash2, 
  AlertTriangle, 
  Loader2, 
  User, 
  Mail, 
  Phone,
  Undo2,
  Info
} from "lucide-react";

interface LeadPreview {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
}

interface BulkDeletePreviewResponse {
  count: number;
  leads: LeadPreview[];
}

interface BulkDeleteResponse {
  deletedCount: number;
  recoverable: boolean;
  message: string;
}

interface SafeBulkDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: number[];
  onSuccess?: (deletedIds: number[]) => void;
}

export function SafeBulkDeleteDialog({
  open,
  onOpenChange,
  selectedIds,
  onSuccess,
}: SafeBulkDeleteDialogProps) {
  const { toast } = useToast();
  const [confirmText, setConfirmText] = useState("");
  const [lastDeletedIds, setLastDeletedIds] = useState<number[]>([]);
  const confirmInputId = useId();
  
  // Fetch preview when dialog opens
  const { data: preview, isLoading: isLoadingPreview, error: previewError } = useQuery<BulkDeletePreviewResponse>({
    queryKey: ["/api/leads/bulk-delete/preview", selectedIds],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/leads/bulk-delete/preview", { ids: selectedIds });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to load preview");
      }
      return res.json();
    },
    enabled: open && selectedIds.length > 0,
    staleTime: 0,
  });
  
  // Reset confirmation when dialog closes or selection changes
  useEffect(() => {
    if (!open) {
      setConfirmText("");
    }
  }, [open]);
  
  const deleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await apiRequest("POST", "/api/leads/bulk-delete", { ids });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to delete leads");
      }
      return res.json() as Promise<BulkDeleteResponse>;
    },
    onSuccess: (data) => {
      setLastDeletedIds(selectedIds);
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      onOpenChange(false);
      onSuccess?.(selectedIds);
      
      // Show toast with undo action
      toast({
        title: "Leads moved to trash",
        description: (
          <div className="flex items-center justify-between gap-4">
            <span>{data.message}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleUndo(selectedIds)}
              className="shrink-0"
              aria-label={`Undo — restore ${selectedIds.length} lead${selectedIds.length === 1 ? "" : "s"} from trash`}
              data-testid="button-undo-delete"
            >
              <Undo2 className="w-3 h-3 mr-1" aria-hidden="true" />
              Undo
            </Button>
          </div>
        ),
        duration: 10000, // 10 seconds to undo
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't delete leads",
        description: `${error.message} — no leads were deleted. Try again or cancel to keep them.`,
        variant: "destructive",
      });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await apiRequest("POST", "/api/leads/restore", { ids });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to restore leads");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({
        title: "Leads restored",
        description: `${data.restoredCount} lead${data.restoredCount === 1 ? "" : "s"} restored.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't restore leads",
        description: `${error.message} — the leads are still in trash. You can try again or restore them manually from Trash.`,
        variant: "destructive",
      });
    },
  });
  
  const handleUndo = (ids: number[]) => {
    restoreMutation.mutate(ids);
  };
  
  const handleDelete = () => {
    if (confirmText !== "DELETE" || !preview) return;
    deleteMutation.mutate(selectedIds);
  };
  
  const isConfirmValid = confirmText === "DELETE";
  const isDeleting = deleteMutation.isPending;
  
  const count = preview?.count ?? selectedIds.length;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg" data-testid="dialog-safe-bulk-delete">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" aria-hidden="true" />
            Delete <span className="tabular-nums mx-1">{selectedIds.length}</span> lead{selectedIds.length !== 1 ? "s" : ""}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-acr-warn-soft dark:bg-acr-warn-soft/30 border border-acr-warn-soft dark:border-acr-warn-soft rounded-md">
                <Info className="w-4 h-4 text-acr-warn dark:text-acr-warn mt-0.5 shrink-0" aria-hidden="true" />
                <p className="text-sm text-acr-warn dark:text-acr-warn">
                  These leads will be moved to trash and can be restored within 30 days.
                </p>
              </div>

              {isLoadingPreview && (
                <div className="space-y-2 py-2" role="status" aria-busy="true" aria-live="polite">
                  <span className="sr-only">Loading lead preview…</span>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-2 rounded-md bg-muted/50">
                      <Skeleton announce={false} className="w-8 h-8 rounded-full shrink-0" />
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <Skeleton announce={false} className="h-4 w-1/3 max-w-40" />
                        <Skeleton announce={false} className="h-3 w-2/3 max-w-56" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {previewError && (
                <div role="alert" className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm">
                  Couldn't load preview — {(previewError as Error).message}. No leads have been deleted.
                </div>
              )}

              {preview && (
                <>
                  <p className="text-sm font-medium">
                    The following <span className="tabular-nums">{preview.count}</span> lead{preview.count !== 1 ? "s" : ""} will be deleted:
                  </p>

                  <ScrollArea className="h-[200px] border rounded-md">
                    <ul className="p-2 space-y-2" aria-label="Leads that will be deleted">
                      {preview.leads.map((lead) => (
                        <li
                          key={lead.id}
                          className="flex items-center gap-3 p-2 rounded-md bg-muted/50"
                          data-testid={`preview-lead-${lead.id}`}
                        >
                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center" aria-hidden="true">
                            <User className="w-4 h-4 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {lead.firstName} {lead.lastName}
                            </p>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              {lead.email && (
                                <span className="flex items-center gap-1 truncate">
                                  <Mail className="w-3 h-3" aria-hidden="true" />
                                  {lead.email}
                                </span>
                              )}
                              {lead.phone && (
                                <span className="flex items-center gap-1">
                                  <Phone className="w-3 h-3" aria-hidden="true" />
                                  <span className="tabular-nums">{lead.phone}</span>
                                </span>
                              )}
                            </div>
                          </div>
                          <Badge variant="secondary" className="shrink-0 text-xs capitalize">
                            {lead.status}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>

                  <div className="space-y-2 pt-2">
                    <Label htmlFor={confirmInputId} className="text-sm text-muted-foreground font-normal">
                      Type <span className="font-mono font-bold text-destructive">DELETE</span> to confirm:
                    </Label>
                    <Input
                      id={confirmInputId}
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder="Type DELETE here"
                      className="font-mono"
                      autoComplete="off"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      data-testid="input-confirm-delete"
                    />
                  </div>
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting} className="min-h-11" data-testid="button-cancel-delete">
            Cancel
          </AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!isConfirmValid || isDeleting || !preview}
            className="min-h-11"
            data-testid="button-confirm-delete"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                Deleting…
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" />
                Delete <span className="tabular-nums mx-1">{count}</span> lead{count !== 1 ? "s" : ""}
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Hook for showing the undo toast after programmatic deletes
export function useLeadUndoToast() {
  const { toast } = useToast();
  
  const restoreMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await apiRequest("POST", "/api/leads/restore", { ids });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to restore leads");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({
        title: "Leads restored",
        description: `${data.restoredCount} lead${data.restoredCount === 1 ? "" : "s"} restored.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't restore leads",
        description: `${error.message} — the leads are still in trash. You can try again or restore them manually from Trash.`,
        variant: "destructive",
      });
    },
  });

  const showUndoToast = (deletedCount: number, deletedIds: number[]) => {
    toast({
      title: "Leads moved to trash",
      description: (
        <div className="flex items-center justify-between gap-4">
          <span>{deletedCount} lead{deletedCount === 1 ? "" : "s"} moved to trash.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => restoreMutation.mutate(deletedIds)}
            className="shrink-0"
            aria-label={`Undo — restore ${deletedCount} lead${deletedCount === 1 ? "" : "s"} from trash`}
          >
            <Undo2 className="w-3 h-3 mr-1" aria-hidden="true" />
            Undo
          </Button>
        </div>
      ),
      duration: 10000,
    });
  };
  
  return { showUndoToast, isRestoring: restoreMutation.isPending };
}
