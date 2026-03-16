import { useState, useEffect } from "react";
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
              data-testid="button-undo-delete"
            >
              <Undo2 className="w-3 h-3 mr-1" />
              Undo
            </Button>
          </div>
        ),
        duration: 10000, // 10 seconds to undo
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Delete failed",
        description: error.message,
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
        description: `${data.restoredCount} lead(s) have been restored.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Restore failed",
        description: error.message,
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
  
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg" data-testid="dialog-safe-bulk-delete">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            Delete {selectedIds.length} Lead{selectedIds.length !== 1 ? "s" : ""}?
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
              <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-800 dark:text-amber-200">
                These leads will be moved to trash and can be restored within 30 days.
              </p>
            </div>
            
            {isLoadingPreview && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}
            
            {previewError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm">
                Failed to load preview: {(previewError as Error).message}
              </div>
            )}
            
            {preview && (
              <>
                <p className="text-sm font-medium">
                  The following {preview.count} lead{preview.count !== 1 ? "s" : ""} will be deleted:
                </p>
                
                <ScrollArea className="h-[200px] border rounded-md">
                  <div className="p-2 space-y-2">
                    {preview.leads.map((lead) => (
                      <div
                        key={lead.id}
                        className="flex items-center gap-3 p-2 rounded-md bg-muted/50"
                        data-testid={`preview-lead-${lead.id}`}
                      >
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                          <User className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {lead.firstName} {lead.lastName}
                          </p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            {lead.email && (
                              <span className="flex items-center gap-1 truncate">
                                <Mail className="w-3 h-3" />
                                {lead.email}
                              </span>
                            )}
                            {lead.phone && (
                              <span className="flex items-center gap-1">
                                <Phone className="w-3 h-3" />
                                {lead.phone}
                              </span>
                            )}
                          </div>
                        </div>
                        <Badge variant="secondary" className="shrink-0 text-xs">
                          {lead.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                
                <div className="space-y-2 pt-2">
                  <p className="text-sm text-muted-foreground">
                    Type <span className="font-mono font-bold text-destructive">DELETE</span> to confirm:
                  </p>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="DELETE"
                    className="font-mono"
                    autoComplete="off"
                    data-testid="input-confirm-delete"
                  />
                </div>
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting} data-testid="button-cancel-delete">
            Cancel
          </AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!isConfirmValid || isDeleting || !preview}
            data-testid="button-confirm-delete"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4 mr-2" />
                Delete {preview?.count || selectedIds.length} Lead{(preview?.count || selectedIds.length) !== 1 ? "s" : ""}
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
        description: `${data.restoredCount} lead(s) have been restored.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Restore failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  const showUndoToast = (deletedCount: number, deletedIds: number[]) => {
    toast({
      title: "Leads moved to trash",
      description: (
        <div className="flex items-center justify-between gap-4">
          <span>{deletedCount} lead(s) moved to trash.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => restoreMutation.mutate(deletedIds)}
            className="shrink-0"
          >
            <Undo2 className="w-3 h-3 mr-1" />
            Undo
          </Button>
        </div>
      ),
      duration: 10000,
    });
  };
  
  return { showUndoToast, isRestoring: restoreMutation.isPending };
}
