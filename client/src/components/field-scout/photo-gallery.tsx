import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Camera,
  Trash2,
  MapPin,
  Clock,
  Compass,
  Plus,
  X,
  MessageSquare,
  Image,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScoutPhoto {
  id: string;
  url: string;
  thumbnailUrl?: string;
  caption: string;
  latitude?: number;
  longitude?: number;
  bearing?: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PhotoGalleryProps {
  photos: ScoutPhoto[];
  onDelete: (id: string) => void;
  onUpdateCaption: (id: string, caption: string) => void;
  onAddPhoto: () => void;
}

export function PhotoGallery({
  photos,
  onDelete,
  onUpdateCaption,
  onAddPhoto,
}: PhotoGalleryProps) {
  const [selectedPhoto, setSelectedPhoto] = useState<ScoutPhoto | null>(null);
  const [showMetadata, setShowMetadata] = useState(true);
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionDraft, setCaptionDraft] = useState("");

  const openPhoto = (photo: ScoutPhoto) => {
    setSelectedPhoto(photo);
    setCaptionDraft(photo.caption);
    setEditingCaption(false);
  };

  const handleSaveCaption = () => {
    if (selectedPhoto) {
      onUpdateCaption(selectedPhoto.id, captionDraft);
      setSelectedPhoto({ ...selectedPhoto, caption: captionDraft });
      setEditingCaption(false);
    }
  };

  return (
    <>
      <Card className="bg-acr-bg-sunken border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Camera className="w-4 h-4 text-acr-accent" />
              Photos
            </CardTitle>
            <Badge variant="secondary" className="text-xs bg-acr-bg-sunken text-muted-foreground">
              {photos.length} photo{photos.length !== 1 ? "s" : ""}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {photos.length === 0 ? (
            <div className="text-center py-6">
              <Image className="w-10 h-10 mx-auto mb-2 text-foreground" />
              <p className="text-xs text-muted-foreground mb-3">
                No photos yet. Capture property photos to include in your report.
              </p>
              <Button
                size="sm"
                onClick={onAddPhoto}
                className="bg-acr-accent hover:bg-acr-accent"
              >
                <Camera className="w-3 h-3 mr-1" />
                Take Photo
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Photo grid */}
              <div className="grid grid-cols-3 gap-2">
                {photos.map((photo) => (
                  <button
                    key={photo.id}
                    onClick={() => openPhoto(photo)}
                    className="relative aspect-square rounded-card overflow-hidden bg-acr-bg-sunken hover:ring-2 hover:ring-acr-pos transition-all group"
                  >
                    <img
                      src={photo.thumbnailUrl || photo.url}
                      alt={photo.caption || "Field photo"}
                      className="w-full h-full object-cover"
                      // Phase 8 Mo 12 — Beatriz §1 (LCP) / §2 (CLS).
                      // Photos in the gallery grid are below-the-fold —
                      // lazy + async decode keeps them from blocking the
                      // initial paint. Explicit width/height matches the
                      // CSS aspect-square parent so the browser reserves
                      // layout space (zero CLS).
                      width={200}
                      height={200}
                      loading="lazy"
                      decoding="async"
                    />
                    {/* Overlay on hover */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-1">
                      {photo.caption && (
                        <span className="text-[9px] text-white truncate w-full">
                          {photo.caption}
                        </span>
                      )}
                    </div>
                    {/* GPS indicator */}
                    {photo.latitude && (
                      <div className="absolute top-1 right-1">
                        <MapPin className="w-3 h-3 text-acr-pos drop-shadow" />
                      </div>
                    )}
                  </button>
                ))}

                {/* Add photo button in grid */}
                <button
                  onClick={onAddPhoto}
                  className="aspect-square rounded-card border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 hover:border-acr-accent hover:text-acr-accent transition-colors text-muted-foreground"
                >
                  <Plus className="w-5 h-5" />
                  <span className="text-[9px]">Add</span>
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Full-size photo dialog */}
      <Dialog open={!!selectedPhoto} onOpenChange={() => setSelectedPhoto(null)}>
        <DialogContent className="bg-acr-bg-sunken border-border max-w-lg p-0 overflow-hidden">
          <DialogHeader className="p-3 pb-0">
            <DialogTitle className="text-sm flex items-center justify-between">
              <span>Photo Detail</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowMetadata(!showMetadata)}
                  className={cn(
                    "h-7 px-2 text-xs",
                    showMetadata ? "text-acr-pos" : "text-muted-foreground"
                  )}
                >
                  <MapPin className="w-3 h-3 mr-1" />
                  Info
                </Button>
                <Button aria-label="Delete"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (selectedPhoto) {
                      onDelete(selectedPhoto.id);
                      setSelectedPhoto(null);
                    }
                  }}
                  className="h-7 px-2 text-xs text-acr-neg hover:text-acr-neg"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>

          {selectedPhoto && (
            <div className="space-y-0">
              {/* Image with zoom feel */}
              <div className="relative bg-black">
                <img
                  src={selectedPhoto.url}
                  alt={selectedPhoto.caption || "Field photo"}
                  className="w-full max-h-[60vh] object-contain"
                  // Lightbox view — eagerly load (user opened the dialog).
                  // Explicit dims taken from the canonical "full" variant
                  // so the dialog reserves space before the bytes arrive.
                  width={1920}
                  height={1440}
                  loading="eager"
                  decoding="async"
                />

                {/* Metadata overlay */}
                {showMetadata && (
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8">
                    <div className="space-y-1">
                      {selectedPhoto.latitude && selectedPhoto.longitude && (
                        <div className="flex items-center gap-1 text-micro text-muted-foreground">
                          <MapPin className="w-3 h-3 text-acr-pos" />
                          {selectedPhoto.latitude.toFixed(6)}, {selectedPhoto.longitude.toFixed(6)}
                        </div>
                      )}
                      {selectedPhoto.bearing !== undefined && (
                        <div className="flex items-center gap-1 text-micro text-muted-foreground">
                          <Compass className="w-3 h-3 text-acr-accent" />
                          {selectedPhoto.bearing.toFixed(1)} heading
                        </div>
                      )}
                      <div className="flex items-center gap-1 text-micro text-muted-foreground">
                        <Clock className="w-3 h-3 text-acr-warn" />
                        {format(new Date(selectedPhoto.timestamp), "MMM d, yyyy h:mm a")}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Caption section */}
              <div className="p-3 space-y-2">
                {editingCaption ? (
                  <div className="space-y-2">
                    <Textarea
                      value={captionDraft}
                      onChange={(e) => setCaptionDraft(e.target.value)}
                      placeholder="Add a caption or notes…"
                      className="bg-acr-bg-sunken border-border text-white text-xs h-16 resize-none"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingCaption(false)}
                        className="flex-1 text-xs text-muted-foreground"
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveCaption}
                        className="flex-1 text-xs bg-acr-pos hover:bg-acr-pos"
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setCaptionDraft(selectedPhoto.caption);
                      setEditingCaption(true);
                    }}
                    className="w-full text-left p-2 rounded border border-border hover:border-border transition-colors"
                  >
                    {selectedPhoto.caption ? (
                      <p className="text-xs text-muted-foreground">{selectedPhoto.caption}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MessageSquare className="w-3 h-3" />
                        Tap to add caption...
                      </p>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
