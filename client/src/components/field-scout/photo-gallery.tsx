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
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Camera className="w-4 h-4 text-blue-400" />
              Photos
            </CardTitle>
            <Badge variant="secondary" className="text-xs bg-gray-800 text-gray-400">
              {photos.length} photo{photos.length !== 1 ? "s" : ""}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {photos.length === 0 ? (
            <div className="text-center py-6">
              <Image className="w-10 h-10 mx-auto mb-2 text-gray-700" />
              <p className="text-xs text-gray-500 mb-3">
                No photos yet. Capture property photos to include in your report.
              </p>
              <Button
                size="sm"
                onClick={onAddPhoto}
                className="bg-blue-600 hover:bg-blue-700"
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
                    className="relative aspect-square rounded-lg overflow-hidden bg-gray-800 hover:ring-2 hover:ring-emerald-500 transition-all group"
                  >
                    <img
                      src={photo.thumbnailUrl || photo.url}
                      alt={photo.caption || "Field photo"}
                      className="w-full h-full object-cover"
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
                        <MapPin className="w-3 h-3 text-emerald-400 drop-shadow" />
                      </div>
                    )}
                  </button>
                ))}

                {/* Add photo button in grid */}
                <button
                  onClick={onAddPhoto}
                  className="aspect-square rounded-lg border-2 border-dashed border-gray-700 flex flex-col items-center justify-center gap-1 hover:border-blue-500 hover:text-blue-400 transition-colors text-gray-600"
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
        <DialogContent className="bg-gray-900 border-gray-800 max-w-lg p-0 overflow-hidden">
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
                    showMetadata ? "text-emerald-400" : "text-gray-500"
                  )}
                >
                  <MapPin className="w-3 h-3 mr-1" />
                  Info
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (selectedPhoto) {
                      onDelete(selectedPhoto.id);
                      setSelectedPhoto(null);
                    }
                  }}
                  className="h-7 px-2 text-xs text-red-400 hover:text-red-300"
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
                />

                {/* Metadata overlay */}
                {showMetadata && (
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8">
                    <div className="space-y-1">
                      {selectedPhoto.latitude && selectedPhoto.longitude && (
                        <div className="flex items-center gap-1 text-[10px] text-gray-300">
                          <MapPin className="w-3 h-3 text-emerald-400" />
                          {selectedPhoto.latitude.toFixed(6)}, {selectedPhoto.longitude.toFixed(6)}
                        </div>
                      )}
                      {selectedPhoto.bearing !== undefined && (
                        <div className="flex items-center gap-1 text-[10px] text-gray-300">
                          <Compass className="w-3 h-3 text-blue-400" />
                          {selectedPhoto.bearing.toFixed(1)} heading
                        </div>
                      )}
                      <div className="flex items-center gap-1 text-[10px] text-gray-300">
                        <Clock className="w-3 h-3 text-amber-400" />
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
                      placeholder="Add a caption or notes..."
                      className="bg-gray-800 border-gray-700 text-white text-xs h-16 resize-none"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingCaption(false)}
                        className="flex-1 text-xs text-gray-500"
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveCaption}
                        className="flex-1 text-xs bg-emerald-600 hover:bg-emerald-700"
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
                    className="w-full text-left p-2 rounded border border-gray-800 hover:border-gray-700 transition-colors"
                  >
                    {selectedPhoto.caption ? (
                      <p className="text-xs text-gray-300">{selectedPhoto.caption}</p>
                    ) : (
                      <p className="text-xs text-gray-600 flex items-center gap-1">
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
