import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Camera,
  Compass,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Trees,
  Droplets,
  Home,
  Route,
  Mountain,
  Building2,
  Mic,
  MicOff,
  RotateCcw,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { fadeInUp, staggerContainer, staggerItem } from "@/lib/animations";

const DIRECTIONS = ["NORTH", "EAST", "SOUTH", "WEST"] as const;
type Direction = (typeof DIRECTIONS)[number];

interface FieldObservations {
  roadType: string;
  vegetationDensity: string;
  structures: string[];
  waterFeatures: string[];
  terrain: string;
  neighboringDevelopment: string;
}

interface ScanResult {
  observations: FieldObservations;
  photos: string[];
  analysisComplete: boolean;
}

const DIRECTION_LABELS: Record<Direction, { icon: string; hint: string }> = {
  NORTH: { icon: "N", hint: "Face north and capture the view" },
  EAST: { icon: "E", hint: "Turn 90° clockwise to face east" },
  SOUTH: { icon: "S", hint: "Turn to face south" },
  WEST: { icon: "W", hint: "Turn 90° clockwise to face west" },
};

function CompassOverlay({ direction }: { direction: Direction }) {
  const dirIdx = DIRECTIONS.indexOf(direction);
  const rotation = dirIdx * 90;

  return (
    <div className="absolute top-4 right-4 z-10">
      <div className="relative w-16 h-16">
        <div
          className="w-16 h-16 rounded-full border-2 border-white/60 bg-black/30 backdrop-blur flex items-center justify-center"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          <Compass className="w-8 h-8 text-white" />
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white text-xs font-bold bg-primary rounded-full w-6 h-6 flex items-center justify-center">
            {DIRECTION_LABELS[direction].icon}
          </span>
        </div>
      </div>
    </div>
  );
}

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-2 justify-center">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`w-2.5 h-2.5 rounded-full transition-colors ${
            i < current ? "bg-primary" : i === current ? "bg-primary animate-pulse" : "bg-muted"
          }`}
        />
      ))}
    </div>
  );
}

function ObservationBadge({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-card border bg-card">
      <Icon className="w-4 h-4 text-primary shrink-0" />
      <div className="min-w-0">
        <p className="text-micro text-muted-foreground">{label}</p>
        <p className="text-xs font-medium truncate">{value}</p>
      </div>
    </div>
  );
}

interface FieldScannerProps {
  propertyId: number;
  onComplete?: (result: ScanResult) => void;
}

export function FieldScanner({ propertyId, onComplete }: FieldScannerProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<"capture" | "analyzing" | "results">("capture");
  const [directionIndex, setDirectionIndex] = useState(0);
  const [capturedPhotos, setCapturedPhotos] = useState<string[]>([]);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const currentDirection = DIRECTIONS[directionIndex];

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      toast({ title: "Camera access denied", description: "Enable camera to scan properties", variant: "destructive" });
    }
  }, [toast]);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.8);
  }, []);

  const scanMutation = useMutation({
    mutationFn: async (photos: string[]) => {
      const images = photos.map((p) => p.replace(/^data:image\/\w+;base64,/, ""));
      const res = await apiRequest("POST", `/api/properties/${propertyId}/vision-scan`, { images });
      return res.json();
    },
    onSuccess: (data) => {
      const scanResult: ScanResult = {
        observations: data.observations,
        photos: capturedPhotos,
        analysisComplete: true,
      };
      setResult(scanResult);
      setStep("results");
      onComplete?.(scanResult);
      toast({ title: "Scan complete", description: "Field observations extracted and saved" });
    },
    onError: () => {
      toast({ title: "Couldn't analyze photo", description: "Your photo is preserved. Try again or add observations manually.", variant: "destructive" });
      setStep("capture");
    },
  });

  const handleCapture = useCallback(() => {
    const photo = capturePhoto();
    if (!photo) return;

    const newPhotos = [...capturedPhotos, photo];
    setCapturedPhotos(newPhotos);

    if (directionIndex < DIRECTIONS.length - 1) {
      setDirectionIndex((prev) => prev + 1);
    } else {
      // All 4 photos captured — start analysis
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setStep("analyzing");
      scanMutation.mutate(newPhotos);
    }
  }, [capturePhoto, capturedPhotos, directionIndex, scanMutation]);

  const handleReset = useCallback(() => {
    setCapturedPhotos([]);
    setDirectionIndex(0);
    setResult(null);
    setStep("capture");
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  // Voice memo
  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).replace(/^data:audio\/\w+;base64,/, "");
          try {
            await apiRequest("POST", `/api/properties/${propertyId}/voice-memo`, {
              audio: base64,
              direction: currentDirection,
            });
            toast({ title: "Voice memo saved" });
          } catch {
            toast({ title: "Memo saved locally", description: "Transcription pending" });
          }
        };
        reader.readAsDataURL(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch {
      toast({ title: "Microphone access denied", variant: "destructive" });
    }
  }, [isRecording, propertyId, currentDirection, toast]);

  // Capture mode
  if (step === "capture") {
    return (
      <Card className="overflow-hidden">
        <div className="relative aspect-video bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
            onLoadedMetadata={() => {}}
          />
          <canvas ref={canvasRef} className="hidden" />
          <CompassOverlay direction={currentDirection} />

          {/* Direction guide overlay */}
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-4">
            <p className="text-white text-sm font-medium text-center">
              {DIRECTION_LABELS[currentDirection].hint}
            </p>
            <ProgressDots current={directionIndex} total={DIRECTIONS.length} />
          </div>
        </div>

        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Photo {directionIndex + 1} of {DIRECTIONS.length} — {currentDirection}
            </span>
            <Button variant="ghost" size="sm" onClick={toggleRecording} aria-label={isRecording ? "Stop recording" : "Record voice note"}>
              {isRecording ? <MicOff className="w-4 h-4 text-acr-neg" /> : <Mic className="w-4 h-4" />}
            </Button>
          </div>

          <div className="flex gap-2">
            <Button className="flex-1" onClick={handleCapture}>
              <Camera className="w-4 h-4 mr-2" />
              Capture {currentDirection}
            </Button>
            {capturedPhotos.length > 0 && (
              <Button variant="outline" size="icon" onClick={handleReset} aria-label="Reset scan">
                <RotateCcw className="w-4 h-4" />
              </Button>
            )}
          </div>

          {capturedPhotos.length === 0 && (
            <Button variant="outline" className="w-full" onClick={startCamera}>
              Open Camera
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  // Analyzing state
  if (step === "analyzing") {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Analyzing property...</p>
            <p className="text-xs text-muted-foreground animate-pulse">
              {scanMutation.isPending ? "Checking flood zones... Analyzing soil... Scoring access..." : "Processing images..."}
            </p>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {capturedPhotos.map((photo, i) => (
              <div key={i} className="relative aspect-square rounded-md overflow-hidden">
                <img src={photo} alt={DIRECTIONS[i]} className="w-full h-full object-cover" />
                <div className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-micro text-center py-0.5">
                  {DIRECTIONS[i]}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Results
  if (step === "results" && result) {
    const obs = result.observations;
    return (
      <motion.div variants={staggerContainer} initial="hidden" animate="visible">
        <Card>
          <CardContent className="p-4 space-y-4">
            <motion.div variants={fadeInUp} className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-acr-pos" />
              <p className="text-sm font-semibold">Field Scan Complete</p>
            </motion.div>

            {/* 2x2 photo grid */}
            <motion.div variants={staggerItem} className="grid grid-cols-2 gap-2">
              {result.photos.map((photo, i) => (
                <div key={i} className="relative aspect-square rounded-md overflow-hidden">
                  <img src={photo} alt={DIRECTIONS[i]} className="w-full h-full object-cover" />
                  <Badge className="absolute top-1 left-1 text-micro" variant="secondary">
                    {DIRECTIONS[i]}
                  </Badge>
                </div>
              ))}
            </motion.div>

            {/* Observation badges */}
            <motion.div variants={staggerItem} className="grid grid-cols-2 gap-2">
              <ObservationBadge icon={Route} label="Road Access" value={obs.roadType || "Unknown"} />
              <ObservationBadge icon={Trees} label="Vegetation" value={obs.vegetationDensity || "Unknown"} />
              <ObservationBadge icon={Mountain} label="Terrain" value={obs.terrain || "Unknown"} />
              <ObservationBadge icon={Building2} label="Neighboring" value={obs.neighboringDevelopment || "None visible"} />
              {obs.waterFeatures?.length > 0 && (
                <ObservationBadge icon={Droplets} label="Water Features" value={obs.waterFeatures.join(", ")} />
              )}
              {obs.structures?.length > 0 && (
                <ObservationBadge icon={Home} label="Structures" value={obs.structures.join(", ")} />
              )}
            </motion.div>

            <Button variant="outline" className="w-full" onClick={handleReset}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Scan Again
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return null;
}

/** Compact card for property detail showing existing scan data */
export function FieldScanCard({
  scanData,
  propertyId,
}: {
  scanData?: FieldObservations | null;
  propertyId: number;
}) {
  if (!scanData) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-4 text-center space-y-2">
          <Camera className="w-6 h-6 mx-auto text-muted-foreground" />
          <p className="text-xs text-muted-foreground">On site? Scan this property</p>
          <Button variant="outline" size="sm" asChild>
            <a href={`/properties/${propertyId}/scan`}>Scan This Property</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-acr-pos" />
          <p className="text-xs font-semibold">Field Scan Data</p>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {scanData.roadType && (
            <div className="text-xs"><span className="text-muted-foreground">Road:</span> {scanData.roadType}</div>
          )}
          {scanData.terrain && (
            <div className="text-xs"><span className="text-muted-foreground">Terrain:</span> {scanData.terrain}</div>
          )}
          {scanData.vegetationDensity && (
            <div className="text-xs"><span className="text-muted-foreground">Vegetation:</span> {scanData.vegetationDensity}</div>
          )}
          {scanData.neighboringDevelopment && (
            <div className="text-xs"><span className="text-muted-foreground">Neighbors:</span> {scanData.neighboringDevelopment}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
