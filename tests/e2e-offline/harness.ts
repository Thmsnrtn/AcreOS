/**
 * Browser harness for the offline field-map spec: exposes the REAL page-side
 * store (client/src/lib/offline-map-store.ts) so the spec saves an area
 * exactly as the Map door's "Save this area for offline" does.
 */
import { saveOfflineArea, bboxAround, listOfflineAreas } from "../../client/src/lib/offline-map-store";

declare global {
  interface Window {
    saveArea: () => Promise<{ tileCount: number; parcels: number; refused: string[] }>;
    listAreas: () => Promise<number>;
  }
}

window.saveArea = async () => {
  const area = await saveOfflineArea({
    name: "TEST-APN-1 · Bastrop, TX · 0.5 mi",
    bbox: bboxAround(30.11, -97.31, 0.5),
    minZoom: 13,
    maxZoom: 15,
    now: new Date("2026-10-11T09:30:00Z"),
  });
  return { tileCount: area.tileCount, parcels: area.parcels.length, refused: area.refusedSources.map((s) => s.id) };
};
window.listAreas = async () => (await listOfflineAreas()).length;
