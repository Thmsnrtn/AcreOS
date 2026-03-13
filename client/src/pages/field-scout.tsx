import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  MapPin,
  Camera,
  Mic,
  MicOff,
  Phone,
  MessageSquare,
  Navigation,
  Star,
  StarOff,
  Plus,
  Search,
  Wifi,
  WifiOff,
  CheckCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Map,
  Eye,
  Clock,
  Zap,
  FileText,
  ClipboardList,
  History,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import { InspectionChecklist, type ChecklistResults } from "@/components/field-scout/inspection-checklist";
import { PhotoGallery, type ScoutPhoto } from "@/components/field-scout/photo-gallery";
import { ScoutReportCard, type FieldScoutVisit } from "@/components/field-scout/scout-report-card";
import { OfflineSyncBanner, type SyncState } from "@/components/field-scout/offline-sync-banner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScoutLead {
  id?: number;
  ownerName: string;
  county: string;
  state: string;
  apn: string;
  address: string;
  latitude?: number;
  longitude?: number;
  score?: number;
  assessedValue?: string;
  acreage?: string;
  notes?: string;
  photoUrls?: string[];
  isFavorited?: boolean;
  source?: string;
  createdAt?: string;
  isOffline?: boolean; // Created while offline, pending sync
}

interface OfflineAction {
  id: string;
  type: "create_lead" | "add_note" | "add_photo" | "update_status" | "save_visit";
  payload: any;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// GPS hook
// ---------------------------------------------------------------------------

function useGPS() {
  const [coords, setCoords] = useState<GeolocationCoordinates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const watchIdRef = useRef<number | null>(null);

  const getCurrentPosition = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Geolocation not supported on this device");
      return;
    }
    setLoading(true);
    // Clear any existing watch
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    // Use watchPosition for continuous high-accuracy updates
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setCoords(position.coords);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000,        // Cache for 5s (reduced for field accuracy)
        // @ts-ignore — desiredAccuracy is non-standard but supported on some devices
        desiredAccuracy: 5,      // 5 metres target
      }
    );
  }, []);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return { coords, error, loading, getCurrentPosition };
}

// ---------------------------------------------------------------------------
// Device orientation / compass bearing hook
// ---------------------------------------------------------------------------

interface CompassData {
  heading: number | null;   // 0–360°, true north
  accuracy: number | null;  // degrees
  supported: boolean;
}

function useCompass(): CompassData {
  const [data, setData] = useState<CompassData>({
    heading: null,
    accuracy: null,
    supported: false,
  });

  useEffect(() => {
    // iOS 13+ requires permission for DeviceOrientationEvent
    const handler = (e: DeviceOrientationEvent) => {
      // @ts-ignore — webkitCompassHeading is iOS-specific
      const heading = (e as any).webkitCompassHeading ?? (e.alpha !== null ? (360 - e.alpha) : null);
      // @ts-ignore
      const accuracy = (e as any).webkitCompassAccuracy ?? null;
      if (heading !== null) {
        setData({ heading: Math.round(heading * 10) / 10, accuracy, supported: true });
      }
    };

    if (typeof DeviceOrientationEvent !== "undefined") {
      // Request permission on iOS 13+
      const req = (DeviceOrientationEvent as any).requestPermission;
      if (typeof req === "function") {
        req()
          .then((state: string) => {
            if (state === "granted") {
              window.addEventListener("deviceorientation", handler as any, true);
              setData((d) => ({ ...d, supported: true }));
            }
          })
          .catch(() => { /* permission denied */ });
      } else {
        window.addEventListener("deviceorientation", handler as any, true);
        setData((d) => ({ ...d, supported: true }));
      }
    }

    return () => {
      window.removeEventListener("deviceorientation", handler as any, true);
    };
  }, []);

  return data;
}

// ---------------------------------------------------------------------------
// Bearing + distance calculator between two GPS points
// ---------------------------------------------------------------------------

function getBearingLabel(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

function getGPSAccuracyLabel(accuracy: number): { label: string; color: string } {
  if (accuracy <= 3) return { label: "Excellent (±3m)", color: "text-emerald-600" };
  if (accuracy <= 10) return { label: "Good (±10m)", color: "text-green-500" };
  if (accuracy <= 25) return { label: "Fair (±25m)", color: "text-amber-500" };
  if (accuracy <= 100) return { label: "Poor (±100m)", color: "text-orange-500" };
  return { label: "Very Poor", color: "text-red-500" };
}

// ---------------------------------------------------------------------------
// Offline queue
// ---------------------------------------------------------------------------

const OFFLINE_QUEUE_KEY = "acreos_offline_queue";

function getOfflineQueue(): OfflineAction[] {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function addToOfflineQueue(action: OfflineAction): void {
  const queue = getOfflineQueue();
  queue.push(action);
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

function clearOfflineQueue(): void {
  localStorage.removeItem(OFFLINE_QUEUE_KEY);
}

// ---------------------------------------------------------------------------
// Main Field Scout page
// ---------------------------------------------------------------------------

export default function FieldScout() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { coords, error: gpsError, loading: gpsLoading, getCurrentPosition } = useGPS();
  const compass = useCompass();

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineQueue, setOfflineQueue] = useState<OfflineAction[]>(getOfflineQueue());
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [currentNote, setCurrentNote] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeView, setActiveView] = useState<"scout" | "leads" | "map" | "visits">("scout");
  const [selectedLead, setSelectedLead] = useState<ScoutLead | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [newLeadForm, setNewLeadForm] = useState<Partial<ScoutLead>>({});

  // New state for enhanced features
  const [scoutPhotos, setScoutPhotos] = useState<ScoutPhoto[]>([]);
  const [checklistResults, setChecklistResults] = useState<ChecklistResults | undefined>(undefined);
  const [showChecklist, setShowChecklist] = useState(false);
  const [visitStartTime] = useState<string>(new Date().toISOString());
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncProgress, setSyncProgress] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | undefined>(
    localStorage.getItem("acreos_last_sync") || undefined
  );
  const [syncError, setSyncError] = useState<string | undefined>(undefined);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval>>();

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncOfflineQueue();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Sync offline queue when back online
  const syncOfflineQueue = useCallback(async () => {
    const queue = getOfflineQueue();
    if (queue.length === 0) return;

    setSyncState("syncing");
    setSyncProgress(0);
    setSyncError(undefined);

    let synced = 0;
    let failed = 0;
    for (let i = 0; i < queue.length; i++) {
      const action = queue[i];
      try {
        if (action.type === "create_lead") {
          await apiRequest("POST", "/api/leads", action.payload);
          synced++;
        } else if (action.type === "add_note") {
          await apiRequest("PATCH", `/api/leads/${action.payload.leadId}`, {
            notes: action.payload.note,
          });
          synced++;
        } else if (action.type === "save_visit") {
          await apiRequest("POST", "/api/field-scout/visits", action.payload);
          synced++;
        } else if (action.type === "add_photo") {
          const formData = new FormData();
          formData.append("photo", action.payload.photoBlob);
          await fetch(`/api/leads/${action.payload.leadId}/photos`, {
            method: "POST",
            body: formData,
          });
          synced++;
        }
      } catch (err) {
        console.error("Sync failed for action:", action.id);
        failed++;
      }
      setSyncProgress(Math.round(((i + 1) / queue.length) * 100));
    }

    if (failed > 0) {
      setSyncState("error");
      setSyncError(`${failed} action${failed > 1 ? "s" : ""} failed to sync. Tap retry to try again.`);
    } else {
      setSyncState("success");
      const now = new Date().toISOString();
      setLastSyncedAt(now);
      localStorage.setItem("acreos_last_sync", now);
      // Auto-clear success state after 3 seconds
      setTimeout(() => setSyncState("idle"), 3000);
    }

    if (synced > 0) {
      clearOfflineQueue();
      setOfflineQueue(getOfflineQueue());
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/field-scout/visits"] });
      toast({
        title: `${synced} offline action${synced > 1 ? "s" : ""} synced`,
        description: "Your field work has been saved to AcreOS.",
      });
    }
  }, [queryClient, toast]);

  // Recent leads query
  const { data: recentLeads = [] } = useQuery<ScoutLead[]>({
    queryKey: ["/api/leads", { limit: 20, source: "field" }],
    queryFn: async () => {
      if (!isOnline) {
        // Return cached leads from localStorage
        try {
          return JSON.parse(localStorage.getItem("acreos_cached_leads") || "[]");
        } catch {
          return [];
        }
      }
      const resp = await apiRequest("GET", "/api/leads?limit=20&orderBy=score");
      const data = await resp.json();
      // Cache for offline use
      localStorage.setItem("acreos_cached_leads", JSON.stringify(data.leads || data || []));
      return data.leads || data || [];
    },
  });

  // Parcel lookup by GPS coordinates
  const parcelLookupMutation = useMutation({
    mutationFn: async (coords: { lat: number; lng: number }) => {
      const resp = await apiRequest(
        "GET",
        `/api/properties/parcel-lookup?lat=${coords.lat}&lng=${coords.lng}`
      );
      return resp.json();
    },
    onSuccess: (data) => {
      if (data?.apn) {
        setNewLeadForm({
          apn: data.apn,
          county: data.county,
          state: data.state,
          address: data.address,
          assessedValue: data.assessedValue,
          ownerName: data.ownerName,
          acreage: data.acreage,
          latitude: coords?.latitude,
          longitude: coords?.longitude,
        });
        setShowQuickAdd(true);
        toast({
          title: "Parcel identified!",
          description: `${data.address} — Owner: ${data.ownerName || "Unknown"}`,
        });
      } else {
        toast({
          title: "No parcel found at this location",
          description: "Try again or enter details manually.",
          variant: "destructive",
        });
      }
    },
    onError: () => {
      // Offline fallback — let user fill manually
      setNewLeadForm({
        latitude: coords?.latitude,
        longitude: coords?.longitude,
      });
      setShowQuickAdd(true);
    },
  });

  // Create lead (online or offline)
  const createLeadMutation = useMutation({
    mutationFn: async (lead: Partial<ScoutLead>) => {
      if (!isOnline) {
        const action: OfflineAction = {
          id: `lead_${Date.now()}`,
          type: "create_lead",
          payload: { ...lead, source: "field_scout" },
          timestamp: Date.now(),
        };
        addToOfflineQueue(action);
        setOfflineQueue(getOfflineQueue());
        return { ...lead, id: -Date.now(), isOffline: true };
      }
      const resp = await apiRequest("POST", "/api/leads", { ...lead, source: "field_scout" });
      return resp.json();
    },
    onSuccess: (data) => {
      setShowQuickAdd(false);
      setNewLeadForm({});
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({
        title: "Lead added!",
        description: (data as any).isOffline
          ? "Saved locally — will sync when back online."
          : "Lead added to your pipeline.",
      });
    },
  });

  // Past visits query
  const { data: pastVisits = [] } = useQuery<FieldScoutVisit[]>({
    queryKey: ["/api/field-scout/visits"],
    queryFn: async () => {
      if (!isOnline) {
        try {
          return JSON.parse(localStorage.getItem("acreos_cached_visits") || "[]");
        } catch {
          return [];
        }
      }
      const resp = await apiRequest("GET", "/api/field-scout/visits?limit=20");
      const data = await resp.json();
      const visits = data.visits || data || [];
      localStorage.setItem("acreos_cached_visits", JSON.stringify(visits));
      return visits;
    },
  });

  // Save complete visit mutation
  const saveVisitMutation = useMutation({
    mutationFn: async (visitData: {
      lead: Partial<ScoutLead>;
      checklist?: ChecklistResults;
      photos: ScoutPhoto[];
      notes: string;
      startedAt: string;
      endedAt: string;
      gpsTrack?: { lat: number; lng: number; timestamp: number }[];
    }) => {
      if (!isOnline) {
        const action: OfflineAction = {
          id: `visit_${Date.now()}`,
          type: "save_visit",
          payload: visitData,
          timestamp: Date.now(),
        };
        addToOfflineQueue(action);
        setOfflineQueue(getOfflineQueue());
        return { id: `offline_${Date.now()}`, synced: false };
      }
      const resp = await apiRequest("POST", "/api/field-scout/visits", visitData);
      return resp.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-scout/visits"] });
      toast({
        title: "Visit saved!",
        description: (data as any).synced === false
          ? "Saved locally — will sync when back online."
          : "Complete visit record saved to AcreOS.",
      });
      // Reset scout state
      setScoutPhotos([]);
      setChecklistResults(undefined);
      setShowChecklist(false);
      setCurrentNote("");
      setShowQuickAdd(false);
      setNewLeadForm({});
    },
  });

  // Photo upload mutation
  const uploadPhotoMutation = useMutation({
    mutationFn: async ({ leadId, file }: { leadId: number; file: File }) => {
      const formData = new FormData();
      formData.append("photo", file);
      const resp = await fetch(`/api/leads/${leadId}/photos`, {
        method: "POST",
        body: formData,
      });
      return resp.json();
    },
  });

  // Handle adding a photo from camera
  const handleAddPhoto = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const newPhoto: ScoutPhoto = {
        id: `photo_${Date.now()}`,
        url,
        thumbnailUrl: url,
        caption: "",
        latitude: coords?.latitude,
        longitude: coords?.longitude,
        bearing: compass.heading ?? undefined,
        timestamp: new Date().toISOString(),
      };
      setScoutPhotos((prev) => [...prev, newPhoto]);
      toast({ title: "Photo captured", description: "Added to visit gallery." });
    };
    input.click();
  }, [coords, compass.heading, toast]);

  // Handle deleting a photo
  const handleDeletePhoto = useCallback((id: string) => {
    setScoutPhotos((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // Handle updating photo caption
  const handleUpdatePhotoCaption = useCallback((id: string, caption: string) => {
    setScoutPhotos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, caption } : p))
    );
  }, []);

  // Handle checklist completion
  const handleChecklistComplete = useCallback((results: ChecklistResults) => {
    setChecklistResults(results);
    toast({
      title: "Inspection complete",
      description: `Score: ${results.overallScore}% passing`,
    });
  }, [toast]);

  // Handle "Complete Visit" flow
  const handleCompleteVisit = useCallback(() => {
    const endedAt = new Date().toISOString();
    const startMs = new Date(visitStartTime).getTime();
    const endMs = new Date(endedAt).getTime();
    const durationMinutes = Math.round((endMs - startMs) / 60000);

    saveVisitMutation.mutate({
      lead: newLeadForm,
      checklist: checklistResults,
      photos: scoutPhotos,
      notes: currentNote,
      startedAt: visitStartTime,
      endedAt,
    });
  }, [visitStartTime, newLeadForm, checklistResults, scoutPhotos, currentNote, saveVisitMutation]);

  // Generate report handler
  const handleGenerateReport = useCallback((visitId: string) => {
    toast({
      title: "Generating report...",
      description: "Your scout report is being compiled.",
    });
    // In production, this would navigate to a report generation page or trigger a PDF export
  }, [toast]);

  // Sync to deal handler
  const handleSyncToDeal = useCallback((visitId: string) => {
    toast({
      title: "Link to deal",
      description: "Select a deal to link this visit to.",
    });
    // In production, this would open a deal selection dialog
  }, [toast]);

  // Voice recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });

        // If online, send for transcription
        if (isOnline) {
          try {
            const formData = new FormData();
            formData.append("audio", blob, "voice_memo.webm");
            const resp = await fetch("/api/voice/transcribe", {
              method: "POST",
              body: formData,
            });
            const { transcript } = await resp.json();
            if (transcript) {
              setCurrentNote((prev) => (prev ? `${prev}\n\n${transcript}` : transcript));
              toast({ title: "Voice memo transcribed", description: transcript.substring(0, 80) });
            }
          } catch {
            toast({
              title: "Transcription queued",
              description: "Voice memo saved. Transcription will happen when online.",
            });
          }
        } else {
          toast({
            title: "Voice memo recorded",
            description: "Will transcribe when back online.",
          });
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      toast({
        title: "Microphone access denied",
        description: "Allow microphone access to use voice memos.",
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(recordingTimerRef.current);
    }
  };

  const handleGPSLookup = () => {
    getCurrentPosition();
    setTimeout(() => {
      if (coords) {
        parcelLookupMutation.mutate({
          lat: coords.latitude,
          lng: coords.longitude,
        });
      }
    }, 1000);
  };

  const filteredLeads = recentLeads.filter(
    (l) =>
      !searchQuery ||
      l.ownerName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.county?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.apn?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Format GPS display — degrees-minutes-seconds
  function toDMS(decimal: number, isLat: boolean): string {
    const d = Math.floor(Math.abs(decimal));
    const m = Math.floor((Math.abs(decimal) - d) * 60);
    const s = ((Math.abs(decimal) - d) * 60 - m) * 60;
    const dir = isLat ? (decimal >= 0 ? "N" : "S") : (decimal >= 0 ? "E" : "W");
    return `${d}°${m}'${s.toFixed(1)}"${dir}`;
  }

  const gpsDisplay = coords
    ? `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`
    : "No GPS";

  const gpsDMSDisplay = coords
    ? `${toDMS(coords.latitude, true)} ${toDMS(coords.longitude, false)}`
    : null;

  const gpsAccuracyInfo = coords?.accuracy
    ? getGPSAccuracyLabel(coords.accuracy)
    : null;

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-20">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Compass rose mini */}
            <div className="relative w-9 h-9 shrink-0">
              <div
                className="w-full h-full rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center"
                style={{
                  transform: compass.heading !== null
                    ? `rotate(${-compass.heading}deg)`
                    : undefined,
                  transition: "transform 0.3s ease",
                }}
              >
                <svg viewBox="0 0 36 36" className="w-full h-full">
                  <polygon points="18,4 15,18 21,18" fill="#ef4444" />
                  <polygon points="18,32 15,18 21,18" fill="rgba(255,255,255,0.5)" />
                  <circle cx="18" cy="18" r="2.5" fill="white" />
                </svg>
              </div>
              {compass.heading !== null && (
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[8px] font-bold text-emerald-400 bg-gray-900 px-0.5 rounded">
                  {getBearingLabel(compass.heading)}
                </div>
              )}
            </div>
            <div>
              <div className="font-bold text-sm">Field Scout</div>
              <div className="text-[10px] text-gray-400 font-mono">
                {gpsDMSDisplay ?? gpsDisplay}
              </div>
              {gpsAccuracyInfo && (
                <div className={`text-[9px] ${gpsAccuracyInfo.color}`}>
                  {gpsAccuracyInfo.label}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isOnline && (
              <Badge variant="destructive" className="text-xs flex items-center gap-1">
                <WifiOff className="w-3 h-3" />
                Offline
              </Badge>
            )}
            {isOnline && (
              <Badge className="text-xs bg-emerald-700 flex items-center gap-1">
                <Wifi className="w-3 h-3" />
                Online
              </Badge>
            )}
            {offlineQueue.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {offlineQueue.length} pending sync
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="flex border-b border-gray-800 bg-gray-900">
        {[
          { key: "scout", label: "Scout", icon: Navigation },
          { key: "leads", label: "Leads", icon: MapPin },
          { key: "map", label: "Map", icon: Map },
          { key: "visits", label: "Visits", icon: History },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveView(key as any)}
            className={cn(
              "flex-1 py-3 text-xs font-medium flex flex-col items-center gap-1 transition-colors",
              activeView === key
                ? "text-emerald-400 border-b-2 border-emerald-400"
                : "text-gray-500 hover:text-gray-300"
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Offline Sync Banner */}
      <OfflineSyncBanner
        isOnline={isOnline}
        queueCount={offlineQueue.length}
        syncState={syncState}
        syncProgress={syncProgress}
        lastSyncedAt={lastSyncedAt}
        syncError={syncError}
        onSyncNow={syncOfflineQueue}
        onRetry={syncOfflineQueue}
      />

      {/* SCOUT VIEW */}
      {activeView === "scout" && (
        <div className="p-4 space-y-4">
          {/* GPS Parcel Identify */}
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-400" />
                Instant Parcel Identify
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-gray-400">
                Standing near a property? GPS-identify the parcel instantly — get owner,
                tax status, and estimated value in seconds.
              </p>
              <Button
                onClick={handleGPSLookup}
                disabled={gpsLoading || parcelLookupMutation.isPending}
                className="w-full bg-emerald-600 hover:bg-emerald-700"
              >
                <MapPin className="w-4 h-4 mr-2" />
                {gpsLoading
                  ? "Getting GPS..."
                  : parcelLookupMutation.isPending
                  ? "Looking up parcel..."
                  : "Identify This Parcel"}
              </Button>

              {coords && (
                <div className="text-xs text-gray-500 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-emerald-400" />
                  GPS: {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)} (±{Math.round(coords.accuracy)}m)
                </div>
              )}
              {gpsError && (
                <div className="text-xs text-red-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {gpsError}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Add Form */}
          {showQuickAdd && (
            <Card className="bg-gray-900 border-emerald-700 border-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Plus className="w-4 h-4 text-emerald-400" />
                  Add to Pipeline
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-gray-400">Owner Name</Label>
                    <Input
                      value={newLeadForm.ownerName || ""}
                      onChange={(e) =>
                        setNewLeadForm((p) => ({ ...p, ownerName: e.target.value }))
                      }
                      className="bg-gray-800 border-gray-700 text-white text-sm"
                      placeholder="Owner name"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-gray-400">APN</Label>
                    <Input
                      value={newLeadForm.apn || ""}
                      onChange={(e) =>
                        setNewLeadForm((p) => ({ ...p, apn: e.target.value }))
                      }
                      className="bg-gray-800 border-gray-700 text-white text-sm"
                      placeholder="Parcel number"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-gray-400">County</Label>
                    <Input
                      value={newLeadForm.county || ""}
                      onChange={(e) =>
                        setNewLeadForm((p) => ({ ...p, county: e.target.value }))
                      }
                      className="bg-gray-800 border-gray-700 text-white text-sm"
                      placeholder="County"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-gray-400">State</Label>
                    <Input
                      value={newLeadForm.state || ""}
                      onChange={(e) =>
                        setNewLeadForm((p) => ({ ...p, state: e.target.value }))
                      }
                      className="bg-gray-800 border-gray-700 text-white text-sm"
                      placeholder="TX"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-gray-400">Address</Label>
                  <Input
                    value={newLeadForm.address || ""}
                    onChange={(e) =>
                      setNewLeadForm((p) => ({ ...p, address: e.target.value }))
                    }
                    className="bg-gray-800 border-gray-700 text-white text-sm"
                    placeholder="Property address"
                  />
                </div>

                {/* Voice note area */}
                <div>
                  <Label className="text-xs text-gray-400 flex items-center gap-1">
                    Notes
                    <span className="text-gray-600">· Voice memo supported</span>
                  </Label>
                  <Textarea
                    value={currentNote}
                    onChange={(e) => setCurrentNote(e.target.value)}
                    className="bg-gray-800 border-gray-700 text-white text-sm h-20 resize-none"
                    placeholder="Field notes, observations, access notes..."
                  />
                </div>

                {/* Quick actions */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={isRecording ? stopRecording : startRecording}
                    className={cn(
                      "flex-1 border-gray-700",
                      isRecording && "border-red-500 text-red-400"
                    )}
                  >
                    {isRecording ? (
                      <>
                        <MicOff className="w-4 h-4 mr-1" />
                        Stop ({recordingSeconds}s)
                      </>
                    ) : (
                      <>
                        <Mic className="w-4 h-4 mr-1" />
                        Voice Memo
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 border-gray-700"
                    onClick={handleAddPhoto}
                  >
                    <Camera className="w-4 h-4 mr-1" />
                    Photo
                    {scoutPhotos.length > 0 && (
                      <Badge variant="secondary" className="ml-1 text-[9px] px-1 py-0 h-4 bg-blue-900/50 text-blue-300">
                        {scoutPhotos.length}
                      </Badge>
                    )}
                  </Button>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowQuickAdd(false);
                      setNewLeadForm({});
                      setCurrentNote("");
                    }}
                    className="flex-1 text-gray-500"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      createLeadMutation.mutate({
                        ...newLeadForm,
                        notes: currentNote || undefined,
                      })
                    }
                    disabled={createLeadMutation.isPending || !newLeadForm.ownerName}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                  >
                    {createLeadMutation.isPending ? "Saving..." : "Add Lead"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Inspection Checklist (collapsible) */}
          <Card className="bg-gray-900 border-gray-800">
            <button
              onClick={() => setShowChecklist(!showChecklist)}
              className="w-full px-4 py-3 flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-medium">Property Inspection</span>
                {checklistResults && (
                  <Badge
                    className={cn(
                      "text-[10px]",
                      checklistResults.overallScore >= 80
                        ? "bg-emerald-900/50 text-emerald-300"
                        : checklistResults.overallScore >= 50
                        ? "bg-yellow-900/50 text-yellow-300"
                        : "bg-red-900/50 text-red-300"
                    )}
                  >
                    {checklistResults.overallScore}%
                  </Badge>
                )}
              </div>
              {showChecklist ? (
                <ChevronUp className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              )}
            </button>
          </Card>
          {showChecklist && (
            <InspectionChecklist
              onComplete={handleChecklistComplete}
              initialData={checklistResults}
            />
          )}

          {/* Photo Gallery */}
          <PhotoGallery
            photos={scoutPhotos}
            onDelete={handleDeletePhoto}
            onUpdateCaption={handleUpdatePhotoCaption}
            onAddPhoto={handleAddPhoto}
          />

          {/* Complete Visit button */}
          {(scoutPhotos.length > 0 || checklistResults || currentNote || newLeadForm.ownerName) && (
            <Button
              onClick={handleCompleteVisit}
              disabled={saveVisitMutation.isPending}
              className="w-full bg-emerald-600 hover:bg-emerald-700 h-12 text-sm font-medium"
            >
              <Save className="w-4 h-4 mr-2" />
              {saveVisitMutation.isPending ? "Saving Visit..." : "Complete Visit"}
            </Button>
          )}

          {/* Quick Actions for selected lead */}
          {selectedLead && (
            <Card className="bg-gray-900 border-gray-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>{selectedLead.ownerName}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedLead(null)}
                    className="text-gray-500 h-6 w-6 p-0"
                  >
                    ×
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-gray-400">
                  {selectedLead.county}, {selectedLead.state} · APN: {selectedLead.apn || "N/A"}
                </div>
                {selectedLead.score !== undefined && (
                  <Badge
                    className={cn(
                      "text-xs",
                      selectedLead.score >= 80
                        ? "bg-red-900/50 text-red-300"
                        : selectedLead.score >= 60
                        ? "bg-yellow-900/50 text-yellow-300"
                        : "bg-gray-800 text-gray-400"
                    )}
                  >
                    Score: {selectedLead.score}
                  </Badge>
                )}

                {/* One-tap actions */}
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-gray-700 text-emerald-400 flex-col h-14 gap-1"
                    onClick={() => {
                      // Quick call
                      window.location.href = `tel:${(selectedLead as any).phone || ""}`;
                    }}
                  >
                    <Phone className="w-4 h-4" />
                    <span className="text-xs">Call</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-gray-700 text-blue-400 flex-col h-14 gap-1"
                    onClick={() => {
                      window.location.href = `sms:${(selectedLead as any).phone || ""}`;
                    }}
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span className="text-xs">Text</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-gray-700 text-purple-400 flex-col h-14 gap-1"
                    onClick={() => setShowQuickAdd(true)}
                  >
                    <Plus className="w-4 h-4" />
                    <span className="text-xs">Note</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent Activity */}
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-gray-400 uppercase tracking-wide">
                Recent Field Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {offlineQueue.length > 0 && (
                <div className="text-xs text-yellow-400 flex items-center gap-1 p-2 bg-yellow-900/20 rounded mb-2">
                  <Clock className="w-3 h-3" />
                  {offlineQueue.length} action{offlineQueue.length > 1 ? "s" : ""} waiting to sync
                </div>
              )}
              {filteredLeads.slice(0, 5).map((lead, i) => (
                <button
                  key={lead.id || i}
                  onClick={() => setSelectedLead(lead)}
                  className="w-full flex items-center justify-between p-2 rounded hover:bg-gray-800 text-left transition-colors"
                >
                  <div>
                    <div className="text-sm font-medium">{lead.ownerName || "Unknown"}</div>
                    <div className="text-xs text-gray-500">
                      {lead.county}, {lead.state}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(lead as any).isOffline && (
                      <WifiOff className="w-3 h-3 text-yellow-400" />
                    )}
                    {lead.score !== undefined && (
                      <span
                        className={cn(
                          "text-xs font-bold",
                          lead.score >= 80
                            ? "text-red-400"
                            : lead.score >= 60
                            ? "text-yellow-400"
                            : "text-gray-500"
                        )}
                      >
                        {lead.score}
                      </span>
                    )}
                    <Eye className="w-3 h-3 text-gray-600" />
                  </div>
                </button>
              ))}
              {filteredLeads.length === 0 && (
                <p className="text-xs text-gray-600 text-center py-4">
                  No field leads yet. Use GPS parcel identify to get started.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Manual Add button */}
          {!showQuickAdd && (
            <Button
              onClick={() => setShowQuickAdd(true)}
              variant="outline"
              className="w-full border-dashed border-gray-700 text-gray-400 hover:text-white hover:border-emerald-600"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Lead Manually
            </Button>
          )}
        </div>
      )}

      {/* LEADS VIEW */}
      {activeView === "leads" && (
        <div className="p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-500" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search leads..."
              className="pl-9 bg-gray-900 border-gray-800 text-white"
            />
          </div>

          <div className="space-y-2">
            {filteredLeads.map((lead, i) => (
              <Card
                key={lead.id || i}
                className={cn(
                  "bg-gray-900 border-gray-800 cursor-pointer hover:border-gray-700",
                  selectedLead?.id === lead.id && "border-emerald-700"
                )}
                onClick={() => setSelectedLead(lead)}
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-sm">{lead.ownerName || "Unknown Owner"}</div>
                      <div className="text-xs text-gray-400">
                        {lead.county}, {lead.state}
                        {lead.acreage && ` · ${lead.acreage} acres`}
                      </div>
                      {lead.apn && (
                        <div className="text-xs text-gray-600 font-mono">APN: {lead.apn}</div>
                      )}
                    </div>
                    <div className="text-right">
                      {lead.score !== undefined && (
                        <div
                          className={cn(
                            "text-lg font-bold",
                            lead.score >= 80
                              ? "text-red-400"
                              : lead.score >= 65
                              ? "text-yellow-400"
                              : "text-gray-500"
                          )}
                        >
                          {lead.score}
                        </div>
                      )}
                      {lead.assessedValue && (
                        <div className="text-xs text-gray-500">
                          ${parseInt(lead.assessedValue).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Quick actions row */}
                  <div className="flex gap-2 mt-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-emerald-400 px-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.location.href = `tel:${(lead as any).phone || ""}`;
                      }}
                    >
                      <Phone className="w-3 h-3 mr-1" />
                      Call
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-blue-400 px-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.location.href = `sms:${(lead as any).phone || ""}`;
                      }}
                    >
                      <MessageSquare className="w-3 h-3 mr-1" />
                      Text
                    </Button>
                    {lead.notes && (
                      <span className="text-xs text-gray-600 ml-auto self-center truncate max-w-24">
                        {lead.notes}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* MAP VIEW */}
      {activeView === "map" && (
        <div className="p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl h-80 flex items-center justify-center">
            <div className="text-center text-gray-500">
              <Map className="w-12 h-12 mx-auto mb-2 text-gray-700" />
              <div className="text-sm">Territory Map</div>
              <div className="text-xs mt-1">Shows leads, visited properties, and GPS track</div>
              {coords && (
                <div className="text-xs text-emerald-400 mt-2">
                  Current: {coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)}
                </div>
              )}
              <Button
                size="sm"
                className="mt-3 bg-emerald-700 hover:bg-emerald-600 text-xs"
                onClick={getCurrentPosition}
              >
                <Navigation className="w-3 h-3 mr-1" />
                Center on Me
              </Button>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <h3 className="text-xs text-gray-500 uppercase tracking-wide">Lead Density</h3>
            {["TX", "AZ", "NM"].map((state) => {
              const count = recentLeads.filter((l) => l.state === state).length;
              return (
                <div key={state} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-6">{state}</span>
                  <div className="flex-1 bg-gray-800 rounded-full h-2">
                    <div
                      className="bg-emerald-600 rounded-full h-2 transition-all"
                      style={{ width: `${Math.min(100, count * 20)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VISITS VIEW */}
      {activeView === "visits" && (
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-xs text-gray-400 uppercase tracking-wide">Past Scout Visits</h2>
            <Badge variant="secondary" className="text-[10px] bg-gray-800 text-gray-400">
              {pastVisits.length} visit{pastVisits.length !== 1 ? "s" : ""}
            </Badge>
          </div>

          {pastVisits.length === 0 ? (
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="py-8 text-center">
                <FileText className="w-10 h-10 mx-auto mb-2 text-gray-700" />
                <p className="text-sm text-gray-500">No visits recorded yet</p>
                <p className="text-xs text-gray-600 mt-1">
                  Complete a scout visit to see it here.
                </p>
                <Button
                  size="sm"
                  className="mt-3 bg-emerald-600 hover:bg-emerald-700 text-xs"
                  onClick={() => setActiveView("scout")}
                >
                  <Navigation className="w-3 h-3 mr-1" />
                  Start Scouting
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {pastVisits.map((visit) => (
                <ScoutReportCard
                  key={visit.id}
                  visit={visit}
                  onGenerateReport={handleGenerateReport}
                  onSyncToDeal={handleSyncToDeal}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bottom floating action button */}
      <div className="fixed bottom-6 right-4 flex flex-col gap-2">
        {isRecording ? (
          <button
            onClick={stopRecording}
            className="w-14 h-14 bg-red-600 rounded-full flex items-center justify-center shadow-lg animate-pulse"
          >
            <MicOff className="w-6 h-6 text-white" />
          </button>
        ) : (
          <button
            onClick={startRecording}
            className="w-14 h-14 bg-gray-700 rounded-full flex items-center justify-center shadow-lg"
          >
            <Mic className="w-6 h-6 text-white" />
          </button>
        )}
        <button
          onClick={() => {
            setShowQuickAdd(true);
            setActiveView("scout");
          }}
          className="w-14 h-14 bg-emerald-600 rounded-full flex items-center justify-center shadow-lg"
        >
          <Plus className="w-7 h-7 text-white" />
        </button>
      </div>

      {/* Recording indicator */}
      {isRecording && (
        <div className="fixed top-16 left-0 right-0 flex justify-center pointer-events-none">
          <div className="bg-red-600 text-white text-xs px-3 py-1 rounded-full flex items-center gap-1 shadow-lg">
            <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
            Recording {recordingSeconds}s
          </div>
        </div>
      )}
    </div>
  );
}
