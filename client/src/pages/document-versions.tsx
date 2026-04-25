import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { FileText, History, Download, RotateCcw, GitBranch, Loader2, Clock, User } from "lucide-react";

interface DocumentVersion {
  versionId: string;
  documentId: number;
  documentName: string;
  versionNumber: number;
  createdByName: string;
  createdAt: string;
  fileSizeBytes: number;
  changeNote?: string;
  isCurrent: boolean;
  downloadUrl?: string;
}

export default function DocumentVersionsPage() {
  useDocumentTitle("Document versions");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [versionToRestore, setVersionToRestore] = useState<DocumentVersion | null>(null);

  const { data: docsData } = useQuery<{ documents: Array<{ id: number; name: string; versionCount: number }> }>({
    queryKey: ["/api/documents/with-versions"],
    queryFn: () => fetch("/api/documents/with-versions").then(r => r.json()),
  });

  const { data: versionsData, isLoading } = useQuery<{ versions: DocumentVersion[] }>({
    queryKey: ["/api/documents", selectedDocId, "versions"],
    queryFn: () => fetch(`/api/documents/${selectedDocId}/versions`).then(r => r.json()),
    enabled: !!selectedDocId,
  });

  const restoreMutation = useMutation({
    mutationFn: (versionId: string) => apiRequest("POST", `/api/documents/${selectedDocId}/versions/${versionId}/restore`),
    onSuccess: () => {
      toast({ title: "Version restored as current." });
      qc.invalidateQueries({ queryKey: ["/api/documents"] });
      setVersionToRestore(null);
    },
    onError: () =>
      toast({
        title: "Couldn't restore version",
        description: "The current version is unchanged. Try again in a moment.",
        variant: "destructive",
      }),
  });

  const docs = docsData?.documents ?? [];
  const versions = versionsData?.versions ?? [];

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-document-versions-title">
          Document versions
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Browse version history and restore previous document versions.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="w-4 h-4" aria-hidden="true" /> Documents
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {docs.length === 0 ? (
              <p className="text-xs text-muted-foreground p-4">No documents with version history.</p>
            ) : (
              <ul className="divide-y" aria-label="Documents with version history">
                {docs.map(doc => (
                  <li key={doc.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedDocId(doc.id)}
                      aria-pressed={selectedDocId === doc.id}
                      className={`w-full text-left p-3 hover:bg-muted/50 transition-colors min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        selectedDocId === doc.id ? "bg-muted" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm truncate">{doc.name}</span>
                        <Badge
                          variant="secondary"
                          className="text-xs ml-2 flex-shrink-0"
                          aria-label={`${doc.versionCount} version${doc.versionCount === 1 ? "" : "s"}`}
                        >
                          v<span className="tabular-nums">{doc.versionCount}</span>
                        </Badge>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="w-4 h-4" aria-hidden="true" /> Version history
            </CardTitle>
            {selectedDocId && (
              <CardDescription>
                {docs.find(d => d.id === selectedDocId)?.name}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {!selectedDocId ? (
              <div className="text-center py-8">
                <GitBranch className="w-8 h-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
                <p className="text-muted-foreground text-sm">Select a document to view its history.</p>
              </div>
            ) : isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground" role="status" aria-live="polite">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading versions…
              </div>
            ) : versions.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">No version history available.</p>
            ) : (
              <ol className="space-y-2" aria-label="Versions, newest first">
                {versions.sort((a, b) => b.versionNumber - a.versionNumber).map(v => (
                  <li key={v.versionId}>
                    <div className={`border rounded-lg p-3 ${v.isCurrent ? "border-primary" : ""}`}>
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium tabular-nums">v{v.versionNumber}</span>
                            {v.isCurrent && <Badge className="text-xs">Current</Badge>}
                            <span className="text-xs text-muted-foreground tabular-nums">{formatSize(v.fileSizeBytes)}</span>
                          </div>
                          {v.changeNote && (
                            <p className="text-xs text-muted-foreground">{v.changeNote}</p>
                          )}
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <User className="w-3 h-3" aria-hidden="true" /> {v.createdByName}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" aria-hidden="true" />
                              <span className="tabular-nums">{new Date(v.createdAt).toLocaleString()}</span>
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          {v.downloadUrl && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-9 w-9 min-h-9 min-w-9"
                              aria-label={`Download version ${v.versionNumber}`}
                              asChild
                            >
                              <a href={v.downloadUrl} download>
                                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                              </a>
                            </Button>
                          )}
                          {!v.isCurrent && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 min-h-9 text-xs"
                              onClick={() => setVersionToRestore(v)}
                              aria-label={`Restore version ${v.versionNumber}`}
                            >
                              <RotateCcw className="w-3 h-3 mr-1" aria-hidden="true" /> Restore
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={!!versionToRestore}
        onOpenChange={(open) => !open && setVersionToRestore(null)}
        title={versionToRestore ? `Restore version ${versionToRestore.versionNumber}?` : "Restore version?"}
        description="This makes the selected version the current document. The version that was current is preserved in history — you can restore it back at any time."
        confirmLabel="Restore version"
        variant="default"
        onConfirm={() => {
          if (versionToRestore) restoreMutation.mutate(versionToRestore.versionId);
        }}
      />
    </PageShell>
  );
}
