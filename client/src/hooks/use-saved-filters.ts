/**
 * T36 — Saved Filter Presets (Persistent Views)
 *
 * Persists named filter presets to the server (savedViews table).
 * Falls back to localStorage for offline resilience.
 *
 * Usage:
 *   const { presets, savePreset, loadPreset, deletePreset } = useSavedFilters("leads");
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface FilterPreset {
  id?: number;
  name: string;
  entityType: string; // "leads" | "properties" | "deals"
  filters: Record<string, any>;
  isDefault?: boolean;
  createdAt?: string;
}

const LS_KEY = (entity: string) => `acreOS_filters_${entity}`;

function loadFromLocalStorage(entity: string): FilterPreset[] {
  try {
    const raw = localStorage.getItem(LS_KEY(entity));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToLocalStorage(entity: string, presets: FilterPreset[]) {
  try {
    localStorage.setItem(LS_KEY(entity), JSON.stringify(presets));
  } catch {}
}

export function useSavedFilters(entityType: string) {
  const queryClient = useQueryClient();
  const queryKey = [`/api/saved-views`, entityType];

  // Fetch from server
  const { data: serverPresets = [] } = useQuery<FilterPreset[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/saved-views?entityType=${entityType}`);
      if (!res.ok) throw new Error("Failed to load presets");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const localPresets = loadFromLocalStorage(entityType);

  // Merge: server presets take precedence, local fills gap
  const presets: FilterPreset[] = serverPresets.length > 0
    ? serverPresets
    : localPresets;

  const saveMutation = useMutation({
    mutationFn: async (preset: Omit<FilterPreset, "id" | "createdAt">) => {
      const res = await fetch("/api/saved-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...preset, entityType }),
      });
      if (!res.ok) {
        // Fallback to localStorage
        const existing = loadFromLocalStorage(entityType);
        const updated = [...existing, { ...preset, id: Date.now(), createdAt: new Date().toISOString() }];
        saveToLocalStorage(entityType, updated);
        return updated[updated.length - 1];
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/saved-views/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const existing = loadFromLocalStorage(entityType).filter(p => p.id !== id);
        saveToLocalStorage(entityType, existing);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/saved-views/${id}/default`, { method: "PATCH" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const savePreset = useCallback(
    (name: string, filters: Record<string, any>) => {
      return saveMutation.mutateAsync({ name, entityType, filters });
    },
    [saveMutation, entityType]
  );

  const deletePreset = useCallback(
    (id: number) => deleteMutation.mutateAsync(id),
    [deleteMutation]
  );

  const setDefault = useCallback(
    (id: number) => setDefaultMutation.mutateAsync(id),
    [setDefaultMutation]
  );

  const defaultPreset = presets.find(p => p.isDefault);

  return {
    presets,
    savePreset,
    deletePreset,
    setDefault,
    defaultPreset,
    isSaving: saveMutation.isPending,
  };
}
