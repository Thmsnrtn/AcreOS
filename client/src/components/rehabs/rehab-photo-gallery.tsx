/**
 * Photo gallery on /rehabs/:id (FF-7).
 *
 * Renders a grid grouped by tag — before / during / after / defect /
 * lender_draw / tax — plus an "untagged" bucket so untagged photos surface
 * rather than disappear. Backed by GET /api/rehabs/:rehabId/photos which
 * already returns photos pre-grouped server-side.
 *
 * Upload: small dropzone at the top accepts multiple files at once and
 * forwards a shared `tag` for the batch (Devon's iOS camera-roll flow
 * normally produces a batch of "after" shots in one go).
 */

import { Suspense, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Camera, Upload, AlertTriangle } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/format";

const TAG_ORDER = [
  "before",
  "during",
  "after",
  "defect",
  "lender_draw",
  "tax",
  "untagged",
] as const;

const TAG_LABEL: Record<string, string> = {
  before: "Before",
  during: "During",
  after: "After",
  defect: "Defect",
  lender_draw: "Lender draw",
  tax: "Tax basis",
  untagged: "Untagged",
};

interface PhotoRow {
  id: string;
  rehabId: string;
  lineItemId: string | null;
  s3Key: string;
  /** Short-lived signed URL; null when the image bytes were never kept. */
  imageUrl?: string | null;
  caption: string | null;
  tag: string | null;
  capturedAt: string | null;
  lat: string | null;
  lng: string | null;
}

interface PhotosResponse {
  rehabId: string;
  total: number;
  /** False while no blob store exists: uploads are refused, and the rows
   *  below are records whose image files were never kept (DEFECT-0164). */
  storageAvailable?: boolean;
  groups: Record<string, PhotoRow[]>;
}

function csrfHeader(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

export function RehabPhotoGallery({ rehabId }: { rehabId: string }) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Camera className="w-4 h-4" aria-hidden="true" /> Photo evidence
        </CardTitle>
        <CardDescription>
          Before / during / after, defect callouts, lender-draw packets, and
          tax basis. Photos roll up to the line item they're attached to.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense
          fallback={
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          }
        >
          <GalleryBody rehabId={rehabId} />
        </Suspense>
      </CardContent>
    </Card>
  );
}

function GalleryBody({ rehabId }: { rehabId: string }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadTag, setUploadTag] = useState<string>("after");

  const photos = useQuery<PhotosResponse>({
    queryKey: ["/api/rehabs", rehabId, "photos"],
    queryFn: async () => {
      const res = await fetch(`/api/rehabs/${rehabId}/photos`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("photos", f));
      form.append("tag", uploadTag);

      const res = await fetch(`/api/rehabs/${rehabId}/photos`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeader(),
        body: form,
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (r: any) => {
      toast({ title: `${r.photos?.length ?? 0} photo(s) uploaded` });
      queryClient.invalidateQueries({ queryKey: ["/api/rehabs", rehabId, "photos"] });
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (err: any) =>
      toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  if (photos.isError) {
    return (
      <QueryErrorState
        error={photos.error}
        onRetry={() => photos.refetch()}
        isRetrying={photos.isRefetching}
        title="Couldn't load photos"
        compact
        testId="rehab-photos-error"
      />
    );
  }

  if (photos.isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }

  const groups = photos.data?.groups ?? {};
  const total = photos.data?.total ?? 0;
  const storageOff = photos.data?.storageAvailable === false;

  return (
    <div className="space-y-4">
      {storageOff && (
        <Alert data-testid="rehab-photos-storage-off">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>
            Photo storage isn't connected yet, so uploads are paused rather than
            accepted and lost. Keep your photos on your device for now.
            {total > 0 &&
              ` The ${total} photo record${total === 1 ? "" : "s"} below ${total === 1 ? "was" : "were"} saved earlier without ${total === 1 ? "its" : "their"} image file${total === 1 ? "" : "s"} — the images were not kept.`}
          </AlertDescription>
        </Alert>
      )}
      {/* Upload bar */}
      <div className="flex flex-wrap items-end gap-2 pb-3 border-b border-border">
        <div className="w-40">
          <label className="text-xs text-muted-foreground block mb-1">Tag for batch</label>
          <Select value={uploadTag} onValueChange={setUploadTag}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TAG_ORDER.filter((t) => t !== "untagged").map((t) => (
                <SelectItem key={t} value={t}>
                  {TAG_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) upload.mutate(e.target.files);
          }}
          aria-label="Upload rehab photos"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={upload.isPending || storageOff}
        >
          <Upload className="w-4 h-4 mr-1" aria-hidden="true" />
          {upload.isPending ? "Uploading…" : "Upload photos"}
        </Button>
        <span className="text-xs text-muted-foreground self-center ml-auto">
          {total} photo{total === 1 ? "" : "s"}
        </span>
      </div>

      {total === 0 ? (
        <EmptyState
          icon={Camera}
          headline="No photos yet"
          subtitle={
            storageOff
              ? "Photo uploads are paused until storage is connected."
              : "Upload before/after shots, defect callouts, lender-draw photos, and tax basis evidence. Photos group by tag automatically."
          }
          cta={
            storageOff
              ? // TODO(cta): no action exists until photo storage is connected (DEFECT-0164)
                { label: "", _noOp: true }
              : {
                  label: "Upload photos",
                  onClick: () => fileRef.current?.click(),
                  "data-testid": "rehab-photos-upload",
                }
          }
          actionIcon={Upload}
          testId="rehab-photos-empty"
        />
      ) : (
        TAG_ORDER.map((tag) => {
          const rows = groups[tag] ?? [];
          if (rows.length === 0) return null;
          return (
            <section key={tag} aria-labelledby={`rehab-photos-${tag}`}>
              <h3
                id={`rehab-photos-${tag}`}
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-2"
              >
                {TAG_LABEL[tag]}
                <Badge variant="outline" className="text-xs font-normal">
                  {rows.length}
                </Badge>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {rows.map((p) => (
                  <PhotoTile key={p.id} photo={p} fileKept={!storageOff} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function PhotoTile({ photo, fileKept }: { photo: PhotoRow; fileKept: boolean }) {
  // A tile shows the image only when the server signed a URL for bytes it
  // actually holds (founder ruling #1). A record without one says so — the
  // bytes of pre-storage uploads were dropped (DEFECT-0164).
  const kept = fileKept && !!photo.imageUrl;
  return (
    <div className="border border-border rounded-md p-2 text-xs bg-muted/30">
      <div className="aspect-square bg-muted/60 rounded mb-2 flex items-center justify-center text-muted-foreground overflow-hidden">
        {kept ? (
          <img
            src={photo.imageUrl!}
            alt={photo.caption ?? "Rehab photo"}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : (
          <Camera className="w-6 h-6" aria-hidden="true" />
        )}
      </div>
      <div className="font-medium truncate" title={photo.caption ?? undefined}>
        {photo.caption ?? (kept ? "Photo" : "Photo record")}
      </div>
      {!kept && <div className="text-muted-foreground">Image not kept</div>}
      <div className="text-muted-foreground flex items-center gap-1 mt-1">
        {photo.capturedAt && (
          <span>{formatDate(photo.capturedAt)}</span>
        )}
        {photo.lat && photo.lng && (
          <Badge variant="outline" className="text-micro gap-0.5 px-1">
            <AlertTriangle className="w-2.5 h-2.5" aria-hidden="true" /> geo
          </Badge>
        )}
      </div>
    </div>
  );
}
