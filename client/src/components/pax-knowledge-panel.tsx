import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Paperclip, Trash2, Loader2, BookOpen, X } from "lucide-react";
import { cn } from "@/lib/utils";

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

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      await fetch(`/api/ai/knowledge/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/ai/knowledge"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/ai/knowledge/${id}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/ai/knowledge"] }),
  });

  const descMutation = useMutation({
    mutationFn: async ({ id, description }: { id: number; description: string }) => {
      await fetch(`/api/ai/knowledge/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ description }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/ai/knowledge"] }),
  });

  const uploadFile = async (file: File) => {
    if (files.length >= MAX_KB_FILES) return;
    if (!ACCEPTED_MIME.includes(file.type)) return;
    if (file.size > MAX_FILE_BYTES) return;
    setUploading(true);
    try {
      const content = await readAsDataURL(file);
      await fetch("/api/ai/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: file.name, content, mimeType: file.type, sizeBytes: file.size }),
      });
      qc.invalidateQueries({ queryKey: ["/api/ai/knowledge"] });
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
          <p className="text-[11px] text-muted-foreground">
            Files Pax always has in context. Great for investment criteria, templates, and checklists.
          </p>
          <p className="text-[11px] text-muted-foreground/70 font-medium">
            {files.length} of {MAX_KB_FILES} files used
          </p>
        </SheetHeader>

        {/* Upload zone */}
        <div
          className={cn(
            "mx-4 mt-3 rounded-lg border-2 border-dashed p-4 text-center cursor-pointer transition-colors flex-shrink-0",
            isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
            files.length >= MAX_KB_FILES && "opacity-50 pointer-events-none"
          )}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept=".pdf,.docx,.csv,.txt,.json"
            onChange={(e) => { Array.from(e.target.files ?? []).forEach(uploadFile); e.target.value = ""; }}
          />
          {uploading ? (
            <Loader2 className="w-5 h-5 text-primary animate-spin mx-auto mb-1" />
          ) : (
            <Paperclip className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
          )}
          <p className="text-xs text-muted-foreground">
            {uploading ? "Uploading…" : "Drop files or click to upload"}
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">PDF, DOCX, CSV, TXT · max 10 MB</p>
          <p className="text-[10px] text-amber-600/80 mt-1">Only upload templates and criteria, not personal data.</p>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2 mt-2">
          {isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!isLoading && files.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              No knowledge files yet. Upload your first file above.
            </p>
          )}
          {files.map((file) => (
            <div key={file.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{file.name}</p>
                  <p className="text-[10px] text-muted-foreground">{fmtBytes(file.sizeBytes)}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Switch
                    checked={file.isActive}
                    onCheckedChange={(v) => toggleMutation.mutate({ id: file.id, isActive: v })}
                    className="scale-75"
                  />
                  <button
                    onClick={() => deleteMutation.mutate(file.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <Textarea
                defaultValue={file.description ?? ""}
                placeholder="Add a description…"
                className="text-[11px] min-h-[40px] resize-none"
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
