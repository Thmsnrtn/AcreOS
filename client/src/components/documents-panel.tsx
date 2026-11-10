/**
 * DocumentsPanel — the ONE shared panel for the object document store
 * (autonomy gap §8 slice 5, design docs/docstore-design-2026-11.md §9).
 *
 * Three mount points, one component: a deal, a property, an acquired note.
 * Server surface (server/routes-object-documents.ts):
 *
 *   GET  /api/{deals,properties,notes}/:objectId/documents
 *   POST /api/{deals,properties,notes}/:objectId/documents          (multipart "file")
 *   GET  /api/{deals,properties,notes}/:objectId/documents/:id/download
 *
 * BUNDLE BUDGET: this file imports NOTHING from @shared/schema — it declares
 * its own row interface below. `shared/constants/activity.ts:1-17` is the
 * standing reminder that a careless import here drags 364 KB of DDL into the
 * client entry chunk.
 *
 * HONEST ABOUT STORAGE: the list response carries `storageAvailable`. When it
 * is false the bytes cannot be served, so the panel says so inline and
 * DISABLES the upload control with that reason attached — it does not hide the
 * control (a missing button teaches nothing) and it does not render a download
 * link that would 503.
 */

import { useId, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { FileText, Upload, Download, AlertCircle, Loader2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { formatDate } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types — declared HERE, deliberately not imported from @shared/schema.
// ---------------------------------------------------------------------------

export type DocumentObjectType = "deal" | "property" | "note";

/** One row of `uploaded_documents`, narrowed to what this panel renders. */
interface UploadedDocumentRow {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  category: string | null;
  uploadedBy: string;
  createdAt: string;
}

interface DocumentListResponse {
  objectType: DocumentObjectType;
  objectId: number | string;
  total: number;
  /**
   * False while the blob store isn't configured. Rows may still exist (from a
   * period when it was), but their bytes cannot be served right now.
   */
  storageAvailable: boolean;
  documents: UploadedDocumentRow[];
}

const SEGMENT: Record<DocumentObjectType, "deals" | "properties" | "notes"> = {
  deal: "deals",
  property: "properties",
  note: "notes",
};

/**
 * What the panel can say about an unconfigured store BEFORE the server has
 * given it a message. The list response carries only the boolean; the server's
 * own sentence (DOCUMENT_STORAGE_UNAVAILABLE_MESSAGE) arrives on the 503 body
 * of an upload attempt, and is preferred verbatim the moment we have it.
 */
const STORAGE_UNAVAILABLE_FALLBACK =
  "Document storage isn't connected yet, so files can't be uploaded or downloaded here. " +
  "Keep your originals — they can be uploaded once storage is connected.";

/** An upload failure that remembers its status, so a 503 can be told apart. */
class UploadFailed extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "UploadFailed";
    this.status = status;
  }
}

function readCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

/** Byte size in the units a person reads. Never rounded to zero. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface DocumentsPanelProps {
  objectType: DocumentObjectType;
  objectId: string | number;
  /**
   * Extra classes for the Card root. Spacing is NOT baked in — the three
   * mount points sit in different layouts (a `space-y` tab panel, a stack of
   * `mb-6` cards), so each one owns its own margin.
   */
  className?: string;
}

export function DocumentsPanel({ objectType, objectId, className = "" }: DocumentsPanelProps) {
  const { toast } = useToast();
  const segment = SEGMENT[objectType];
  const basePath = `/api/${segment}/${objectId}/documents`;
  const queryKey = [`/api/${segment}`, String(objectId), "documents"];

  const fileInputId = useId();
  const categoryInputId = useId();
  const noticeId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [category, setCategory] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  /** The server's OWN refusal sentence, once it has given us one. */
  const [serverStorageMessage, setServerStorageMessage] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery<DocumentListResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(basePath, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
      return res.json();
    },
    enabled: objectId !== undefined && objectId !== null && String(objectId).length > 0,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const trimmed = category.trim();
      if (trimmed.length > 0) form.append("category", trimmed);

      const csrf = readCsrfToken();
      // No Content-Type header: the browser must set the multipart boundary.
      const res = await fetch(basePath, {
        method: "POST",
        credentials: "include",
        headers: csrf ? { "x-csrf-token": csrf } : undefined,
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new UploadFailed(res.status, body?.message || `Upload failed (${res.status})`);
      }
      return res.json() as Promise<{ document: UploadedDocumentRow }>;
    },
    // Clear the picker on BOTH paths: without this, re-picking the same file
    // after a refusal fires no `change` event and the retry silently does
    // nothing.
    onSettled: () => {
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onSuccess: (result) => {
      setCategory("");
      queryClient.invalidateQueries({ queryKey });
      toast({
        title: "Document added",
        description: `${result.document.fileName} is attached to this ${objectType}.`,
      });
    },
    onError: (err: unknown) => {
      // A 503 is the store refusing BEFORE anything was written. Keep the
      // server's own sentence and show it inline — it says what did not
      // happen and what to do instead.
      if (err instanceof UploadFailed && err.status === 503) {
        setServerStorageMessage(err.message);
      }
      toast({
        title: "Document not saved",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const documents = data?.documents ?? [];
  // Unknown (still loading / errored) is not "unavailable" — only an explicit
  // false from the server disables the control.
  const storageUnavailable = data?.storageAvailable === false;
  const storageNotice = serverStorageMessage ?? STORAGE_UNAVAILABLE_FALLBACK;
  const uploadDisabled = storageUnavailable || uploadMutation.isPending;

  const submitFile = (file: File | undefined | null) => {
    if (!file || uploadDisabled) return;
    uploadMutation.mutate(file);
  };

  const openFilePicker = () => {
    if (uploadDisabled) return;
    fileInputRef.current?.click();
  };

  return (
    <Card className={className} data-testid="documents-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" aria-hidden="true" />
          Documents
          {data ? (
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              {data.total}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Honest storage notice ─────────────────────────────────────── */}
        {storageUnavailable && (
          <div
            id={noticeId}
            role="status"
            className="flex items-start gap-2 rounded-md border border-acr-warn/40 bg-acr-warn-soft/30 p-3"
            data-testid="documents-storage-unavailable"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-acr-warn" aria-hidden="true" />
            <p className="text-xs text-muted-foreground">{storageNotice}</p>
          </div>
        )}

        {/* ── Upload ────────────────────────────────────────────────────── */}
        <div className="space-y-3">
          {/* The drop zone is a real <button> (focusable, keyboard-activated).
              It carries aria-disabled rather than `disabled`, because a
              disabled button leaves the tab order and the reason it is
              unavailable would then never be announced; the handlers refuse. */}
          <button
            type="button"
            onClick={openFilePicker}
            onDragOver={(e) => {
              e.preventDefault();
              if (!uploadDisabled) setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              submitFile(e.dataTransfer.files?.[0]);
            }}
            aria-disabled={uploadDisabled}
            aria-label={
              storageUnavailable
                ? `Upload a PDF — unavailable. ${storageNotice}`
                : "Upload a PDF — drag a file here, or activate to choose one"
            }
            aria-describedby={storageUnavailable ? noticeId : undefined}
            className={`w-full min-h-[88px] rounded-md border border-dashed p-4 text-center transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
              ${uploadDisabled ? "cursor-not-allowed opacity-60" : ""}
              ${isDragging ? "border-primary bg-primary/5" : "border-border bg-muted/30 hover:bg-muted/50"}`}
            data-testid="documents-dropzone"
          >
            <span className="flex flex-col items-center gap-1.5">
              {uploadMutation.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-hidden="true" />
              ) : (
                <Upload className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="text-sm font-medium">
                {uploadMutation.isPending ? "Uploading…" : "Drop a PDF here"}
              </span>
              <span className="text-xs text-muted-foreground">
                {storageUnavailable
                  ? "Uploads are unavailable until storage is connected"
                  : "PDF only, up to 25 MB"}
              </span>
            </span>
          </button>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={fileInputId}>Choose a PDF</Label>
              <Input
                id={fileInputId}
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                disabled={uploadDisabled}
                aria-describedby={storageUnavailable ? noticeId : undefined}
                onChange={(e) => submitFile(e.target.files?.[0])}
                data-testid="documents-file-input"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={categoryInputId}>Category (optional)</Label>
              <Input
                id={categoryInputId}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Title commitment, PSA, deed…"
                disabled={uploadDisabled}
                data-testid="documents-category-input"
              />
            </div>
          </div>
        </div>

        {/* ── List ──────────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading documents">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <Skeleton className="h-8 w-8 rounded-md shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="h-8 w-20 rounded-md shrink-0" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <QueryErrorState
            compact
            error={error instanceof Error ? error : null}
            onRetry={() => void refetch()}
            isRetrying={isRefetching}
            title="Couldn't load documents"
            testId="documents-error"
          />
        ) : documents.length === 0 ? (
          <EmptyState
            framed
            icon={FileText}
            headline="No documents on this file yet"
            subtitle="Drop in the paperwork this deal is made of — it stays attached here, not in an inbox."
            cta={
              storageUnavailable
                ? // TODO(cta): storage isn't connected — there is no action
                  // that would succeed, and the notice above says why.
                  { label: "", _noOp: true }
                : {
                    label: "Add the title commitment",
                    onClick: openFilePicker,
                    "data-testid": "documents-empty-cta",
                  }
            }
            actionIcon={storageUnavailable ? null : Upload}
            testId="documents-empty"
          />
        ) : (
          <motion.ul
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="divide-y divide-border/40"
            data-testid="documents-list"
          >
            {documents.map((doc) => (
              <motion.li
                key={doc.id}
                variants={staggerItem}
                className="flex items-start justify-between gap-3 py-2.5"
                data-testid={`document-row-${doc.id}`}
              >
                <div className="min-w-0 flex items-start gap-3">
                  <span
                    className="p-2 rounded-md bg-muted shrink-0"
                    aria-hidden="true"
                  >
                    <FileText className="w-4 h-4 text-muted-foreground" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" title={doc.fileName}>
                      {doc.fileName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className="tabular-nums">{formatBytes(doc.byteSize)}</span>
                      {doc.category ? ` · ${doc.category}` : ""}
                      {` · added ${formatDate(doc.createdAt)}`}
                    </p>
                  </div>
                </div>

                {storageUnavailable ? (
                  // No link that would 503. The row still says it exists.
                  <span
                    className="text-xs text-muted-foreground whitespace-nowrap pt-1.5"
                    data-testid={`document-download-unavailable-${doc.id}`}
                  >
                    Download unavailable
                  </span>
                ) : (
                  <Button asChild variant="outline" size="sm" className="shrink-0">
                    <a
                      href={`${basePath}/${doc.id}/download`}
                      aria-label={`Download ${doc.fileName}`}
                      data-testid={`document-download-${doc.id}`}
                    >
                      <Download className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                      Download
                    </a>
                  </Button>
                )}
              </motion.li>
            ))}
          </motion.ul>
        )}
      </CardContent>
    </Card>
  );
}
