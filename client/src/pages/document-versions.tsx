import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { FileText, History, Download, RotateCcw, Eye, GitBranch, Loader2, Clock, User } from "lucide-react";

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
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);

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
      toast({ title: "Version restored as current" });
      qc.invalidateQueries({ queryKey: ["/api/documents"] });
    },
    onError: () => toast({ title: "Restore failed", variant: "destructive" }),
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
          Document Versions
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Browse version history and restore previous document versions.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="w-4 h-4" /> Documents
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {docs.length === 0 && (
                <p className="text-xs text-muted-foreground p-4">No documents with version history.</p>
              )}
              {docs.map(doc => (
                <button
                  key={doc.id}
                  onClick={() => setSelectedDocId(doc.id)}
                  className={`w-full text-left p-3 hover:bg-muted/50 transition-colors ${
                    selectedDocId === doc.id ? "bg-muted" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm truncate">{doc.name}</span>
                    <Badge variant="secondary" className="text-xs ml-2 flex-shrink-0">
                      v{doc.versionCount}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="w-4 h-4" /> Version History
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
                <GitBranch className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">Select a document to view its history.</p>
              </div>
            ) : isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading versions...
              </div>
            ) : versions.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">No version history available.</p>
            ) : (
              <div className="space-y-2">
                {versions.sort((a, b) => b.versionNumber - a.versionNumber).map(v => (
                  <div
                    key={v.versionId}
                    className={`border rounded-lg p-3 ${v.isCurrent ? "border-primary" : ""}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">v{v.versionNumber}</span>
                          {v.isCurrent && <Badge className="text-xs">Current</Badge>}
                          <span className="text-xs text-muted-foreground">{formatSize(v.fileSizeBytes)}</span>
                        </div>
                        {v.changeNote && (
                          <p className="text-xs text-muted-foreground">{v.changeNote}</p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" /> {v.createdByName}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {new Date(v.createdAt).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {v.downloadUrl && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" asChild>
                            <a href={v.downloadUrl} download>
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          </Button>
                        )}
                        {!v.isCurrent && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => restoreMutation.mutate(v.versionId)}
                          >
                            <RotateCcw className="w-3 h-3 mr-1" /> Restore
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
