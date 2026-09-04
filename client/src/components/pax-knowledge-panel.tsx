import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Paperclip, Trash2, Loader2, BookOpen, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface KnowledgeFile {
  id: number;
  name: string;
  description: string | null;
  mimeType: string;
  sizeBytes: number;
  isActive: boolean;
  createdAt: string;
}

const MAX_KB_FILES = 8;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME = ["application/pdf", "text/plain", "text/csv", "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

function readAsDataURL(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

interface PaxKnowledgePanelProps {
  open: boolean;
  onClose: () => void;
}

export function PaxKnowledgePanel({ open, onClose }: PaxKnowledgePanelProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: files = [], isLoading } = useQuery<KnowledgeFile[]>({
    queryKey: ["/api/ai/knowledge"],
    queryFn: async () => {
      const r = await fetch("/api/ai/knowledge", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: open,
  });

  // Every mutation below went through a raw fetch() whose result was DISCARDED.
  // react-query cannot tell a 403 from a 204 when the mutationFn resolves
  // either way, so onSuccess ran, the cache was invalidated, and the row the
  // customer had just deleted reappeared with no error anywhere — the UI
  // reporting an effect that did not happen, which is the client-side form of
  // the rule this repository already enforces on the server.
  //
  // apiRequest throws on a non-OK status (and transparently retries once after
  // refreshing an expired session), so failure now reaches onError.
  const failed = (what: string) => (err: Error) =>
    toast({
      title: what,
      description: err.message || "Try again in a moment.",
      variant: "destructive",
    });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      await apiRequest("PATCH", `/api/ai/knowledge/${id}`, { isActive });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/ai/knowledge"] }),
    onError: failed("Couldn't change that file"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/ai/knowledge/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/ai/knowledge"] }),
    onError: failed("Couldn't remove that file"),
  });

  const descMutation = useMutation({
    mutationFn: async ({ id, description }: { id: number; description: string }) => {
      await apiRequest("PATCH", `/api/ai/knowledge/${id}`, { description });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/ai/knowledge"] }),
    onError: failed("Couldn't save that description"),
  });

  const uploadFile = async (file: File) => {
    if (files.length >= MAX_KB_FILES) return;
    if (!ACCEPTED_MIME.includes(file.type)) return;
    if (file.size > MAX_FILE_BYTES) return;
    setUploading(true);
    try {
      const content = await readAsDataURL(file);
      // The upload was the worst of the four: it POSTed, ignored the result,
      // invalidated the cache and cleared the spinner in `finally`, so a
      // rejected upload was indistinguishable from a successful one.
      await apiRequest("POST", "/api/ai/knowledge", {
        name: file.name,
        content,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      qc.invalidateQueries({ queryKey: ["/api/ai/knowledge"] });
    } catch (err) {
      failed("Couldn't add that file")(err as Error);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    Array.from(e.dataTransfer.files).forEach(uploadFile);
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-[340px] sm:w-[380px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b flex-shrink-0">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <BookOpen className="w-4 h-4 text-primary" />
            Pax Knowledge Base
          </SheetTitle>
          <p className="text-caption text-muted-foreground">
            Files Pax always has in context. Great for investment criteria, templates, and checklists.
          </p>
          <p className="text-caption text-muted-foreground/70 font-medium">
            {files.length} of {MAX_KB_FILES} files used
          </p>
        </SheetHeader>

        {/* Upload zone */}
        <button
          type="button"
          disabled={files.length >= MAX_KB_FILES}
          className={cn(
            "mx-4 mt-3 w-auto rounded-card border-2 border-dashed p-4 text-center cursor-pointer transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
            files.length >= MAX_KB_FILES && "opacity-50 pointer-events-none"
          )}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          aria-label="Upload knowledge base file"
        >
          {uploading ? (
            <Loader2 className="w-5 h-5 text-primary animate-spin mx-auto mb-1" aria-hidden="true" />
          ) : (
            <Paperclip className="w-5 h-5 text-muted-foreground mx-auto mb-1" aria-hidden="true" />
          )}
          <p className="text-xs text-muted-foreground">
            {uploading ? "Uploading…" : "Drop files or click to upload"}
          </p>
          <p className="text-micro text-muted-foreground/60 mt-0.5">PDF, DOCX, CSV, TXT · max 10 MB</p>
          <p className="text-micro text-acr-warn/80 mt-1">Only upload templates and criteria, not personal data.</p>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          multiple
          accept=".pdf,.docx,.csv,.txt,.json"
          onChange={(e) => { Array.from(e.target.files ?? []).forEach(uploadFile); e.target.value = ""; }}
          aria-label="Knowledge base files"
        />

        {/* File list */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2 mt-2">
          {isLoading && (
            <div role="status" aria-busy="true" aria-live="polite" className="space-y-2">
              <span className="sr-only">Loading knowledge files</span>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-card border p-3 space-y-2">
                  <Skeleton announce={false} className="h-3.5 w-2/3" />
                  <Skeleton announce={false} className="h-3 w-16" />
                </div>
              ))}
            </div>
          )}
          {!isLoading && files.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              No knowledge files yet. Upload your first file above.
            </p>
          )}
          {files.map((file) => (
            <div key={file.id} className="rounded-card border p-3 space-y-2">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{file.name}</p>
                  <p className="text-micro text-muted-foreground">{fmtBytes(file.sizeBytes)}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Switch
                    checked={file.isActive}
                    onCheckedChange={(v) => toggleMutation.mutate({ id: file.id, isActive: v })}
                    className="scale-75"
                  />
                  <button aria-label="Delete"
                    onClick={() => deleteMutation.mutate(file.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <Textarea
                aria-label={`Description for ${file.name ?? "file"}`}
                defaultValue={file.description ?? ""}
                placeholder="Add a description…"
                className="text-caption min-h-[40px] resize-none"
                rows={1}
                onBlur={(e) => {
                  if (e.target.value !== (file.description ?? "")) {
                    descMutation.mutate({ id: file.id, description: e.target.value });
                  }
                }}
              />
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
