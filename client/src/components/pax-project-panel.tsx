import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Paperclip, Trash2, Loader2, FolderOpen, Plus, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface PaxProject {
  id: number;
  name: string;
  description: string | null;
  fileCount: number;
  isActive: boolean;
  createdAt: string;
}

interface PaxProjectFile {
  id: number;
  projectId: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

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

interface PaxProjectPanelProps {
  open: boolean;
  onClose: () => void;
  activeProjectId: number | null;
  onSelectProject: (projectId: number | null) => void;
}

export function PaxProjectPanel({ open, onClose, activeProjectId, onSelectProject }: PaxProjectPanelProps) {
  const qc = useQueryClient();
  const [selectedProject, setSelectedProject] = useState<number | null>(activeProjectId);
  const [newProjectName, setNewProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: projects = [], isLoading } = useQuery<PaxProject[]>({
    queryKey: ["/api/ai/projects"],
    queryFn: async () => {
      const r = await fetch("/api/ai/projects", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: open,
  });

  const { data: projectFiles = [] } = useQuery<PaxProjectFile[]>({
    queryKey: ["/api/ai/projects", selectedProject, "files"],
    queryFn: async () => {
      const r = await fetch(`/api/ai/projects/${selectedProject}/files`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: open && selectedProject != null,
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const r = await fetch("/api/ai/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      return r.json();
    },
    onSuccess: (proj) => {
      qc.invalidateQueries({ queryKey: ["/api/ai/projects"] });
      setSelectedProject(proj.id);
      setNewProjectName("");
      setCreating(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/ai/projects/${id}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["/api/ai/projects"] });
      if (selectedProject === id) setSelectedProject(null);
      if (activeProjectId === id) onSelectProject(null);
    },
  });

  const deleteFileMutation = useMutation({
    mutationFn: async ({ projectId, fileId }: { projectId: number; fileId: number }) => {
      await fetch(`/api/ai/projects/${projectId}/files/${fileId}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ["/api/ai/projects", projectId, "files"] });
      qc.invalidateQueries({ queryKey: ["/api/ai/projects"] });
    },
  });

  const uploadFile = async (projectId: number, file: File) => {
    if (!ACCEPTED_MIME.includes(file.type) || file.size > MAX_FILE_BYTES) return;
    setUploadingFor(projectId);
    try {
      const content = await readAsDataURL(file);
      await fetch(`/api/ai/projects/${projectId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fileName: file.name, content, mimeType: file.type, sizeBytes: file.size }),
      });
      qc.invalidateQueries({ queryKey: ["/api/ai/projects", projectId, "files"] });
      qc.invalidateQueries({ queryKey: ["/api/ai/projects"] });
    } finally {
      setUploadingFor(null);
    }
  };

  const currentProject = projects.find((p) => p.id === selectedProject);

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-[340px] sm:w-[380px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b flex-shrink-0">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <FolderOpen className="w-4 h-4 text-primary" />
            Pax Projects
          </SheetTitle>
          <p className="text-caption text-muted-foreground">
            Scoped workspaces with files and notes. Active project context is always included in Pax's responses.
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {/* Project list */}
          <div className="px-4 pt-3 pb-2 border-b">
            <div className="flex items-center justify-between mb-2">
              <p className="text-caption font-medium text-muted-foreground uppercase tracking-wide">Projects</p>
              <Button size="sm" variant="ghost" className="h-6 text-caption px-2" onClick={() => setCreating(true)}>
                <Plus className="w-3 h-3 mr-1" /> New
              </Button>
            </div>

            {creating && (
              <div className="flex gap-1.5 mb-2">
                <Input
                  autoFocus
                  placeholder="Project name…"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="h-7 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newProjectName.trim()) createMutation.mutate(newProjectName.trim());
                    if (e.key === "Escape") { setCreating(false); setNewProjectName(""); }
                  }}
                />
                <Button
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => { if (newProjectName.trim()) createMutation.mutate(newProjectName.trim()); }}
                  disabled={!newProjectName.trim() || createMutation.isPending}
                >
                  Create
                </Button>
              </div>
            )}

            {isLoading && (
              <div role="status" aria-busy="true" aria-live="polite" className="space-y-1">
                <span className="sr-only">Loading projects</span>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2 px-2.5 py-2">
                    <Skeleton announce={false} className="h-3.5 w-3.5 rounded-sm shrink-0" />
                    <Skeleton announce={false} className="h-3.5 w-2/3" />
                  </div>
                ))}
              </div>
            )}

            {!isLoading && projects.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No projects yet. Create one above.</p>
            )}

            <div className="space-y-1">
              {projects.map((proj) => (
                <button
                  key={proj.id}
                  onClick={() => setSelectedProject(proj.id === selectedProject ? null : proj.id)}
                  className={cn(
                    "w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-md text-xs transition-colors",
                    selectedProject === proj.id ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
                  )}
                >
                  <FolderOpen className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate font-medium">{proj.name}</span>
                  <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">{proj.fileCount} files</Badge>
                  {activeProjectId === proj.id && (
                    <span className="text-[9px] text-primary font-semibold">Active</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Selected project detail */}
          {currentProject && (
            <div className="px-4 py-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold truncate flex-1">{currentProject.name}</p>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {activeProjectId === currentProject.id ? (
                    <button
                      onClick={() => { onSelectProject(null); }}
                      className="text-micro text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      <X className="w-3 h-3" /> Deactivate
                    </button>
                  ) : (
                    <button
                      onClick={() => { onSelectProject(currentProject.id); }}
                      className="text-micro text-primary hover:underline flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3 h-3" /> Set as active
                    </button>
                  )}
                  <button aria-label="Delete"
                    onClick={() => deleteMutation.mutate(currentProject.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* File upload zone */}
              <button
                type="button"
                className={cn(
                  "w-full rounded-card border-2 border-dashed p-3 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                )}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                  Array.from(e.dataTransfer.files).forEach((f) => uploadFile(currentProject.id, f));
                }}
                onClick={() => fileInputRef.current?.click()}
                aria-label={`Add files to ${currentProject.name ?? "project"}`}
              >
                {uploadingFor === currentProject.id ? (
                  <Loader2 className="w-4 h-4 animate-spin text-primary mx-auto mb-1" aria-hidden="true" />
                ) : (
                  <Paperclip className="w-4 h-4 text-muted-foreground mx-auto mb-1" aria-hidden="true" />
                )}
                <p className="text-caption text-muted-foreground">
                  {uploadingFor === currentProject.id ? "Uploading…" : "Add files to this project"}
                </p>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="sr-only"
                multiple
                accept=".pdf,.docx,.csv,.txt,.json"
                onChange={(e) => {
                  Array.from(e.target.files ?? []).forEach((f) => uploadFile(currentProject.id, f));
                  e.target.value = "";
                }}
                aria-label="Project files"
              />

              {/* Project files list */}
              {projectFiles.length > 0 && (
                <div className="space-y-1">
                  <p className="text-caption font-medium text-muted-foreground uppercase tracking-wide">Files</p>
                  {projectFiles.map((f) => (
                    <div key={f.id} className="flex items-center gap-2 px-2 py-1.5 rounded border text-xs">
                      <Paperclip className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      <span className="flex-1 truncate">{f.fileName}</span>
                      <span className="text-muted-foreground text-micro">{fmtBytes(f.sizeBytes)}</span>
                      <button aria-label={`Remove ${f.fileName}`}
                        onClick={() => deleteFileMutation.mutate({ projectId: currentProject.id, fileId: f.id })}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
