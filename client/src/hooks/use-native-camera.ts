/**
 * useNativeCamera — Capacitor Camera with web fallback
 *
 * Tries native Camera.getPhoto() first; falls back to HTML5 file input on web.
 * Compresses images before upload and extracts EXIF GPS data when available.
 */

import { useState, useCallback, useRef } from "react";
import { isNative } from "@/lib/platform";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CapturedPhoto {
  /** Base64-encoded image data (without the data:image prefix) */
  base64: string;
  /** MIME type, e.g. "image/jpeg" */
  mimeType: string;
  /** Data URI ready for <img src> */
  dataUrl: string;
  /** EXIF GPS coordinates if available */
  gps?: { latitude: number; longitude: number } | null;
  /** Timestamp of capture */
  capturedAt: Date;
}

export interface UseNativeCameraReturn {
  takePhoto: () => Promise<CapturedPhoto | null>;
  pickFromGallery: () => Promise<CapturedPhoto | null>;
  photos: CapturedPhoto[];
  isNative: boolean;
}

// ─── EXIF GPS extraction ─────────────────────────────────────────────────────

function extractExifGps(
  base64: string,
): { latitude: number; longitude: number } | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const view = new DataView(bytes.buffer);

    // Check JPEG SOI marker
    if (view.getUint16(0) !== 0xffd8) return null;

    let offset = 2;
    while (offset < view.byteLength - 2) {
      const marker = view.getUint16(offset);
      if (marker === 0xffe1) {
        // APP1 / EXIF
        const length = view.getUint16(offset + 2);
        const exifData = bytes.slice(offset + 4, offset + 2 + length);
        return parseExifGps(exifData);
      }
      const segLength = view.getUint16(offset + 2);
      offset += 2 + segLength;
    }
  } catch {
    // EXIF parsing is best-effort
  }
  return null;
}

function parseExifGps(
  exif: Uint8Array,
): { latitude: number; longitude: number } | null {
  try {
    // Check for "Exif\0\0" header
    const header = String.fromCharCode(...exif.slice(0, 4));
    if (header !== "Exif") return null;

    const tiffOffset = 6;
    const view = new DataView(exif.buffer, exif.byteOffset + tiffOffset);
    const littleEndian = view.getUint16(0) === 0x4949;

    const ifdOffset = view.getUint32(4, littleEndian);
    const numEntries = view.getUint16(ifdOffset, littleEndian);

    // Find GPS IFD pointer in IFD0
    let gpsIfdOffset: number | null = null;
    for (let i = 0; i < numEntries; i++) {
      const entryOffset = ifdOffset + 2 + i * 12;
      const tag = view.getUint16(entryOffset, littleEndian);
      if (tag === 0x8825) {
        // GPSInfoIFDPointer
        gpsIfdOffset = view.getUint32(entryOffset + 8, littleEndian);
        break;
      }
    }

    if (gpsIfdOffset === null) return null;

    const gpsEntries = view.getUint16(gpsIfdOffset, littleEndian);
    let latRef = "N";
    let lonRef = "E";
    let latValues: number[] | null = null;
    let lonValues: number[] | null = null;

    for (let i = 0; i < gpsEntries; i++) {
      const entryOffset = gpsIfdOffset + 2 + i * 12;
      const tag = view.getUint16(entryOffset, littleEndian);
      const valueOffset = view.getUint32(entryOffset + 8, littleEndian);

      switch (tag) {
        case 1: // GPSLatitudeRef
          latRef = String.fromCharCode(view.getUint8(entryOffset + 8));
          break;
        case 2: // GPSLatitude
          latValues = readGpsRationals(view, valueOffset, littleEndian);
          break;
        case 3: // GPSLongitudeRef
          lonRef = String.fromCharCode(view.getUint8(entryOffset + 8));
          break;
        case 4: // GPSLongitude
          lonValues = readGpsRationals(view, valueOffset, littleEndian);
          break;
      }
    }

    if (!latValues || !lonValues) return null;

    let latitude = latValues[0] + latValues[1] / 60 + latValues[2] / 3600;
    let longitude = lonValues[0] + lonValues[1] / 60 + lonValues[2] / 3600;
    if (latRef === "S") latitude = -latitude;
    if (lonRef === "W") longitude = -longitude;

    return { latitude, longitude };
  } catch {
    return null;
  }
}

function readGpsRationals(
  view: DataView,
  offset: number,
  littleEndian: boolean,
): number[] {
  const values: number[] = [];
  for (let i = 0; i < 3; i++) {
    const num = view.getUint32(offset + i * 8, littleEndian);
    const den = view.getUint32(offset + i * 8 + 4, littleEndian);
    values.push(den === 0 ? 0 : num / den);
  }
  return values;
}

// ─── Image compression ───────────────────────────────────────────────────────

async function compressImage(
  dataUrl: string,
  maxWidth = 1920,
  quality = 0.8,
): Promise<{ base64: string; mimeType: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      const compressed = canvas.toDataURL("image/jpeg", quality);
      const base64 = compressed.split(",")[1];
      resolve({
        base64,
        mimeType: "image/jpeg",
        dataUrl: compressed,
      });
    };
    img.onerror = () => reject(new Error("Failed to load image for compression"));
    img.src = dataUrl;
  });
}

// ─── Web file input helper ───────────────────────────────────────────────────

function pickFileAsDataUrl(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        document.body.removeChild(input);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result as string);
        document.body.removeChild(input);
      };
      reader.onerror = () => {
        resolve(null);
        document.body.removeChild(input);
      };
      reader.readAsDataURL(file);
    };

    // Handle cancel — no change event fires
    input.addEventListener("cancel", () => {
      resolve(null);
      document.body.removeChild(input);
    });

    input.click();
  });
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useNativeCamera(): UseNativeCameraReturn {
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const cameraModuleRef = useRef<typeof import("@capacitor/camera") | null>(null);

  const getCameraModule = useCallback(async () => {
    if (cameraModuleRef.current) return cameraModuleRef.current;
    try {
      const mod = await import("@capacitor/camera");
      cameraModuleRef.current = mod;
      return mod;
    } catch {
      return null;
    }
  }, []);

  const captureNative = useCallback(
    async (source: "camera" | "gallery"): Promise<CapturedPhoto | null> => {
      const mod = await getCameraModule();
      if (!mod) return null;

      const { Camera, CameraResultType, CameraSource } = mod;

      try {
        // Request permissions first
        const perms = await Camera.checkPermissions();
        if (perms.camera === "denied" || perms.photos === "denied") {
          const requested = await Camera.requestPermissions();
          if (requested.camera === "denied") {
            console.warn("[Camera] Permission denied by user");
            return null;
          }
        }

        const photo = await Camera.getPhoto({
          quality: 85,
          resultType: CameraResultType.Base64,
          source:
            source === "camera" ? CameraSource.Camera : CameraSource.Photos,
          saveToGallery: source === "camera",
          correctOrientation: true,
          width: 1920,
        });

        if (!photo.base64String) return null;

        const mimeType = `image/${photo.format || "jpeg"}`;
        const dataUrl = `data:${mimeType};base64,${photo.base64String}`;
        const gps = extractExifGps(photo.base64String);

        const captured: CapturedPhoto = {
          base64: photo.base64String,
          mimeType,
          dataUrl,
          gps,
          capturedAt: new Date(),
        };

        setPhotos((prev) => [...prev, captured]);
        return captured;
      } catch (err: any) {
        // User cancelled — not an error
        if (err?.message?.includes("cancelled") || err?.message?.includes("canceled")) {
          return null;
        }
        console.error("[Camera] Native capture failed:", err);
        return null;
      }
    },
    [getCameraModule],
  );

  const captureWeb = useCallback(
    async (source: "camera" | "gallery"): Promise<CapturedPhoto | null> => {
      const accept =
        source === "camera" ? "image/*;capture=camera" : "image/*";
      const rawDataUrl = await pickFileAsDataUrl(accept);
      if (!rawDataUrl) return null;

      try {
        const compressed = await compressImage(rawDataUrl);
        const gps = extractExifGps(compressed.base64);

        const captured: CapturedPhoto = {
          base64: compressed.base64,
          mimeType: compressed.mimeType,
          dataUrl: compressed.dataUrl,
          gps,
          capturedAt: new Date(),
        };

        setPhotos((prev) => [...prev, captured]);
        return captured;
      } catch (err) {
        console.error("[Camera] Web capture failed:", err);
        return null;
      }
    },
    [],
  );

  const takePhoto = useCallback(async () => {
    if (isNative) return captureNative("camera");
    return captureWeb("camera");
  }, [captureNative, captureWeb]);

  const pickFromGallery = useCallback(async () => {
    if (isNative) return captureNative("gallery");
    return captureWeb("gallery");
  }, [captureNative, captureWeb]);

  return {
    takePhoto,
    pickFromGallery,
    photos,
    isNative,
  };
}
