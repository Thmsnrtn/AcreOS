/**
 * Offline parcel maps for field visits (W5b, behind the Map door).
 *
 * "Save this area" fetches, ahead of time and while online:
 *   - the imagery tiles of the area from every source whose terms ALLOW
 *     offline caching (shared/map/offlineSources.ts — OpenFreeMap's terms
 *     forbid automated collection, so street tiles and labels are refused and
 *     the saved map says so);
 *   - the org's own parcel facts in the area (GET /api/maps/offline-pack);
 *   - the offline viewer itself (/offline-map.html + /offline-map.js), which
 *     needs no sign-in round trip and no network to open.
 *
 * Tiles go to Cache Storage (`offline-map-tiles-v1` — deliberately NOT named
 * `acreos-*`, which the service worker's activate step clears on every
 * version bump); the area record (bbox, zooms, parcels, savedAt, bytes) goes
 * to IndexedDB `acreos-offline-maps`. Both are read by client/public/
 * offline-map.js, so the names here and there must match (pinned by
 * tests/unit/offlineMapSources.test.ts).
 *
 * SIZE-CAPPED: an area over OFFLINE_AREA_MAX_TILES is refused before any
 * fetch, and a save that passes OFFLINE_AREA_MAX_BYTES stops and removes what
 * it saved. Nothing is labelled offline-ready unless every tile was stored.
 */
import {
  OFFLINE_AREA_MAX_BYTES,
  OFFLINE_AREA_MAX_TILES,
  OFFLINE_MAP_SOURCES,
  cacheableOfflineSources,
  offlineSourceForUrl,
  tileUrl,
  tilesForBbox,
  type Bbox,
} from "@shared/map/offlineSources";

export const OFFLINE_TILE_CACHE = "offline-map-tiles-v1";
export const OFFLINE_SHELL_CACHE = "offline-map-shell-v1";
export const OFFLINE_DB_NAME = "acreos-offline-maps";
export const OFFLINE_DB_STORE = "areas";
export const OFFLINE_SHELL_URLS = ["/offline-map.html", "/offline-map.js"] as const;

export interface OfflineParcel {
  id: number;
  apn: string;
  county: string;
  state: string;
  acres: string | null;
  address: string | null;
  status: string;
  zoning: string | null;
  roadAccess: string | null;
  assessedValue: string | null;
  lat: number | null;
  lng: number | null;
  boundary: { type: "Polygon" | "MultiPolygon"; coordinates: unknown } | null;
}

export interface OfflineArea {
  id: string;
  name: string;
  bbox: Bbox;
  minZoom: number;
  maxZoom: number;
  savedAt: string;
  bytes: number;
  tileCount: number;
  sources: Array<{ id: string; label: string; attribution: string; template: string }>;
  refusedSources: Array<{ id: string; label: string; terms: string }>;
  tileUrls: string[];
  parcels: OfflineParcel[];
  parcelsTruncated: boolean;
}

export class OfflineAreaRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfflineAreaRefusal";
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OFFLINE_DB_STORE)) db.createObjectStore(OFFLINE_DB_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(OFFLINE_DB_STORE, mode);
    const req = fn(t.objectStore(OFFLINE_DB_STORE));
    t.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
  });
}

export async function listOfflineAreas(): Promise<OfflineArea[]> {
  const all = await tx<OfflineArea[]>("readonly", (s) => s.getAll() as IDBRequest<OfflineArea[]>);
  return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function planOfflineArea(bbox: Bbox, minZoom: number, maxZoom: number) {
  const sources = cacheableOfflineSources();
  const refused = OFFLINE_MAP_SOURCES.filter((s) => s.policy !== "allowed");
  const tiles = sources.flatMap((src) =>
    tilesForBbox(bbox, Math.max(minZoom, src.minZoom), Math.min(maxZoom, src.maxZoom)).map((t) => tileUrl(src.tileUrl, t)),
  );
  // Belt and braces: every planned URL's host must classify as "allowed".
  for (const url of tiles) {
    if (offlineSourceForUrl(url)?.policy !== "allowed") throw new OfflineAreaRefusal(`Refusing to save tiles from ${new URL(url).host}: its terms don't allow offline caching.`);
  }
  return { sources, refused, tiles };
}

export interface SaveProgress {
  done: number;
  total: number;
  bytes: number;
}

/**
 * Save an area. `fetchImpl` is the page's fetch (the service worker sees the
 * tile requests and lets them through to the network when online).
 */
export async function saveOfflineArea(
  input: { name: string; bbox: Bbox; minZoom: number; maxZoom: number; now: Date },
  onProgress?: (p: SaveProgress) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<OfflineArea> {
  if (typeof caches === "undefined" || typeof indexedDB === "undefined") {
    throw new OfflineAreaRefusal("This browser can't store maps for offline use.");
  }
  const { sources, refused, tiles } = planOfflineArea(input.bbox, input.minZoom, input.maxZoom);
  if (tiles.length > OFFLINE_AREA_MAX_TILES) {
    throw new OfflineAreaRefusal(
      `That area needs ${tiles.length.toLocaleString()} map tiles; one offline area holds at most ${OFFLINE_AREA_MAX_TILES.toLocaleString()}. Choose a smaller radius or fewer zoom levels.`,
    );
  }

  const q = new URLSearchParams({
    west: String(input.bbox.west),
    south: String(input.bbox.south),
    east: String(input.bbox.east),
    north: String(input.bbox.north),
  });
  const packRes = await fetchImpl(`/api/maps/offline-pack?${q}`, { credentials: "include" });
  if (!packRes.ok) throw new OfflineAreaRefusal(`Your parcel facts couldn't be loaded (${packRes.status}). Nothing was saved.`);
  const pack = (await packRes.json()) as { parcels: OfflineParcel[]; truncated: boolean };

  const shell = await caches.open(OFFLINE_SHELL_CACHE);
  await shell.addAll([...OFFLINE_SHELL_URLS]);

  const cache = await caches.open(OFFLINE_TILE_CACHE);
  let bytes = 0;
  const stored: string[] = [];
  try {
    for (let i = 0; i < tiles.length; i++) {
      const url = tiles[i];
      const res = await fetchImpl(url, { mode: "cors", credentials: "omit" });
      if (!res.ok) throw new OfflineAreaRefusal(`A map tile couldn't be downloaded (${res.status}). Nothing was saved — try again with a signal.`);
      const blob = await res.clone().blob();
      bytes += blob.size;
      if (bytes > OFFLINE_AREA_MAX_BYTES) {
        throw new OfflineAreaRefusal(
          `That area is larger than ${Math.round(OFFLINE_AREA_MAX_BYTES / 1024 / 1024)} MB of imagery. Choose a smaller radius or fewer zoom levels.`,
        );
      }
      await cache.put(url, res);
      stored.push(url);
      onProgress?.({ done: i + 1, total: tiles.length, bytes });
    }
  } catch (err) {
    await removeTiles(stored);
    throw err;
  }

  const area: OfflineArea = {
    id: `${input.now.getTime()}`,
    name: input.name,
    bbox: input.bbox,
    minZoom: input.minZoom,
    maxZoom: input.maxZoom,
    savedAt: input.now.toISOString(),
    bytes,
    tileCount: stored.length,
    sources: sources.map((s) => ({ id: s.id, label: s.label, attribution: s.attribution, template: s.tileUrl })),
    refusedSources: refused.map((s) => ({ id: s.id, label: s.label, terms: s.terms })),
    tileUrls: stored,
    parcels: pack.parcels,
    parcelsTruncated: pack.truncated,
  };
  await tx("readwrite", (s) => s.put(area));
  return area;
}

async function removeTiles(urls: string[], keep: Set<string> = new Set()): Promise<void> {
  const cache = await caches.open(OFFLINE_TILE_CACHE);
  for (const u of urls) if (!keep.has(u)) await cache.delete(u);
}

export async function deleteOfflineArea(id: string): Promise<void> {
  const areas = await listOfflineAreas();
  const target = areas.find((a) => a.id === id);
  if (!target) return;
  const keep = new Set(areas.filter((a) => a.id !== id).flatMap((a) => a.tileUrls));
  await removeTiles(target.tileUrls, keep);
  await tx("readwrite", (s) => s.delete(id));
}

/** A box `radiusMiles` around a point. */
export function bboxAround(lat: number, lng: number, radiusMiles: number): Bbox {
  const dLat = radiusMiles / 69;
  const dLng = radiusMiles / (69 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return { west: lng - dLng, south: lat - dLat, east: lng + dLng, north: lat + dLat };
}
