/**
 * Location Intelligence — proximity alerts for nearby properties
 * Used in offline-first mobile mode for field work notifications.
 */

interface LocationAlert {
  propertyId: number;
  distance: number; // miles
  name: string;
  type: "portfolio" | "opportunity";
}

const ALERT_DISTANCE_MILES = 0.5;
const ALERTS_PER_PROPERTY_PER_DAY = 1;
const alertHistory = new Map<string, number>(); // propertyId:date → timestamp

export function checkNearbyProperties(
  lat: number,
  lng: number,
  properties: Array<{
    id: number;
    lat: number;
    lng: number;
    name: string;
    type: "portfolio" | "opportunity";
  }>
): LocationAlert[] {
  return properties
    .map((p) => ({ ...p, distance: haversine(lat, lng, p.lat, p.lng) }))
    .filter((p) => p.distance <= ALERT_DISTANCE_MILES)
    .filter((p) => {
      const key = `${p.id}:${new Date().toDateString()}`;
      if (alertHistory.has(key)) return false;
      alertHistory.set(key, Date.now());
      return true;
    })
    .map((p) => ({
      propertyId: p.id,
      distance: p.distance,
      name: p.name,
      type: p.type,
    }));
}

function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

export type { LocationAlert };
