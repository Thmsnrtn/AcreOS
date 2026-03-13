import { useState, useEffect, useCallback } from "react";
import { useSearch, useLocation } from "wouter";
import { GisFilterState, defaultGisFilters } from "@/components/gis-filters";

const STORAGE_KEY = "acreos:gis-filters";

/**
 * Encodes GIS filters to URL search params (only non-default values)
 */
function encodeFiltersToParams(filters: GisFilterState): URLSearchParams {
  const params = new URLSearchParams();
  
  if (filters.excludeFloodZones) {
    params.set("noFlood", "1");
  }
  if (filters.nearInfrastructure) {
    params.set("nearInfra", "1");
    if (filters.infrastructureDistanceMiles !== defaultGisFilters.infrastructureDistanceMiles) {
      params.set("infraMiles", String(filters.infrastructureDistanceMiles));
    }
  }
  if (filters.lowHazardRiskOnly) {
    params.set("lowRisk", "1");
  }
  if (filters.minimumInvestmentScore > 0) {
    params.set("minScore", String(filters.minimumInvestmentScore));
  }
  
  return params;
}

/**
 * Decodes GIS filters from URL search params
 */
function decodeFiltersFromParams(searchString: string): Partial<GisFilterState> {
  const params = new URLSearchParams(searchString);
  const partial: Partial<GisFilterState> = {};
  
  if (params.get("noFlood") === "1") {
    partial.excludeFloodZones = true;
  }
  if (params.get("nearInfra") === "1") {
    partial.nearInfrastructure = true;
    const miles = params.get("infraMiles");
    if (miles) {
      partial.infrastructureDistanceMiles = parseInt(miles, 10) || defaultGisFilters.infrastructureDistanceMiles;
    }
  }
  if (params.get("lowRisk") === "1") {
    partial.lowHazardRiskOnly = true;
  }
  const minScore = params.get("minScore");
  if (minScore) {
    partial.minimumInvestmentScore = parseInt(minScore, 10) || 0;
  }
  
  return partial;
}

/**
 * Loads filters from localStorage
 */
function loadFromStorage(): Partial<GisFilterState> | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn("Failed to load GIS filters from localStorage:", e);
  }
  return null;
}

/**
 * Saves filters to localStorage
 */
function saveToStorage(filters: GisFilterState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch (e) {
    console.warn("Failed to save GIS filters to localStorage:", e);
  }
}

/**
 * Hook for managing GIS filter state with persistence to localStorage and URL sync
 * 
 * Priority order for initial state:
 * 1. URL params (for shareable links)
 * 2. localStorage (for returning users)
 * 3. Default values
 */
export function usePersistedGisFilters() {
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Initialize filters from URL params, localStorage, or defaults
  const [filters, setFiltersState] = useState<GisFilterState>(() => {
    // First check URL params (highest priority for shareable links)
    const urlFilters = decodeFiltersFromParams(searchString);
    if (Object.keys(urlFilters).length > 0) {
      return { ...defaultGisFilters, ...urlFilters };
    }
    
    // Then check localStorage
    const storedFilters = loadFromStorage();
    if (storedFilters) {
      return { ...defaultGisFilters, ...storedFilters };
    }
    
    return defaultGisFilters;
  });

  // Mark as initialized after first render
  useEffect(() => {
    setIsInitialized(true);
  }, []);

  // Persist to localStorage when filters change (after initialization)
  useEffect(() => {
    if (isInitialized) {
      saveToStorage(filters);
    }
  }, [filters, isInitialized]);

  // Update filters and optionally sync to URL
  const setFilters = useCallback((newFilters: GisFilterState, syncToUrl: boolean = false) => {
    setFiltersState(newFilters);
    
    if (syncToUrl) {
      const currentParams = new URLSearchParams(searchString);
      // Remove existing GIS filter params
      currentParams.delete("noFlood");
      currentParams.delete("nearInfra");
      currentParams.delete("infraMiles");
      currentParams.delete("lowRisk");
      currentParams.delete("minScore");
      
      // Add new filter params
      const filterParams = encodeFiltersToParams(newFilters);
      filterParams.forEach((value, key) => {
        currentParams.set(key, value);
      });
      
      const newSearch = currentParams.toString();
      const newPath = window.location.pathname + (newSearch ? `?${newSearch}` : "");
      setLocation(newPath, { replace: true });
    }
  }, [searchString, setLocation]);

  // Reset filters to defaults
  const resetFilters = useCallback(() => {
    setFiltersState(defaultGisFilters);
    saveToStorage(defaultGisFilters);
    
    // Clear URL params
    const currentParams = new URLSearchParams(searchString);
    currentParams.delete("noFlood");
    currentParams.delete("nearInfra");
    currentParams.delete("infraMiles");
    currentParams.delete("lowRisk");
    currentParams.delete("minScore");
    
    const newSearch = currentParams.toString();
    const newPath = window.location.pathname + (newSearch ? `?${newSearch}` : "");
    setLocation(newPath, { replace: true });
  }, [searchString, setLocation]);

  // Generate shareable URL with current filters
  const getShareableUrl = useCallback(() => {
    const params = encodeFiltersToParams(filters);
    const baseUrl = window.location.origin + window.location.pathname;
    const paramString = params.toString();
    return paramString ? `${baseUrl}?${paramString}` : baseUrl;
  }, [filters]);

  // Check if current filters differ from defaults
  const hasActiveFilters = 
    filters.excludeFloodZones ||
    filters.nearInfrastructure ||
    filters.lowHazardRiskOnly ||
    filters.minimumInvestmentScore > 0;

  return {
    filters,
    setFilters,
    resetFilters,
    hasActiveFilters,
    getShareableUrl,
    isInitialized,
  };
}
