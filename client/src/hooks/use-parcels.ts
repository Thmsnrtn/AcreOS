import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface ParcelLookupRequest {
  apn?: string;
  lat?: number;
  lng?: number;
  state?: string;
  county?: string;
}

export interface ParcelData {
  apn: string;
  boundary: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
  centroid: {
    lat: number;
    lng: number;
  };
  data: {
    regridId: string;
    /** null when the source names no owner. */
    owner: string | null;
    ownerAddress: string;
    taxAmount: string;
    lastUpdated: string;
    acres?: number;
    county?: string;
    state?: string;
    assessedValue?: number | string;
    marketValue?: number | string;
    lastSalePrice?: number | string;
    lastSaleDate?: string | number;
  };
}

/**
 * True when the lookup endpoint answered "no parcel record" (404): the chain
 * has no coverage for this parcel/point. Callers render that as an honest
 * "not covered" state, not as a failure.
 */
export function isParcelNotCovered(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function useParcelLookup() {
  const { toast } = useToast();
  
  // allow-no-invalidation: read-only parcel lookup — results feed the caller's form, nothing persisted
  return useMutation({
    mutationFn: async (request: ParcelLookupRequest): Promise<ParcelData> => {
      const res = await apiRequest("POST", "/api/parcels/lookup", request);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to lookup parcel");
      }
      return res.json();
    },
    onError: (error: Error) => {
      // "No coverage" is an answer, not a failure — the caller renders it
      // in place, so no destructive toast on top of it.
      if (isParcelNotCovered(error)) return;
      toast({
        title: "Couldn't look up parcel",
        description: `${error.message} — your existing property records are unchanged.`,
        variant: "destructive",
      });
    },
  });
}

export function useFetchPropertyParcel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (propertyId: number) => {
      const res = await apiRequest("POST", `/api/properties/${propertyId}/fetch-parcel`, {});
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to fetch parcel data");
      }
      return res.json();
    },
    onSuccess: (data, propertyId) => {
      queryClient.invalidateQueries({ queryKey: ['/api/properties'] });
      queryClient.invalidateQueries({ queryKey: ['/api/properties', propertyId] });
      toast({
        title: "Parcel data retrieved",
        description: "Property map boundary has been updated",
      });
    },
    onError: (error: Error) => {
      // Common cases worth surfacing in friendlier copy than the raw
      // upstream error string.
      const msg = error.message || "";
      const isNotFound = /404|not found/i.test(msg);
      const isNotConfigured = /not configured|no provider|api.key/i.test(msg);
      toast({
        title: "Couldn't fetch parcel data",
        description: isNotFound
          ? "We couldn't find this parcel in any of our providers. Double-check the APN, county, and state on the property and try again."
          : isNotConfigured
            ? "Parcel lookup providers aren't configured yet. Add a Regrid key in Settings → Integrations to enable this."
            : `${msg} — your existing property records are unchanged.`,
        variant: "destructive",
      });
    },
  });
}

interface BulkParcelResult {
  message: string;
  updated: number;
  failed: number;
  results: Array<{ propertyId: number; apn: string; success: boolean; source?: string; error?: string }>;
}

export function useFetchAllParcels() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (): Promise<BulkParcelResult> => {
      const res = await apiRequest("POST", "/api/properties/fetch-all-parcels", {});
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to bulk fetch parcel data");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/properties'] });
      toast({
        title: "Bulk parcel fetch complete",
        description: data.message,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't fetch parcel data",
        description: `${error.message} — your existing property records are unchanged.`,
        variant: "destructive",
      });
    },
  });
}
