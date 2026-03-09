/**
 * T35 — Bulk Actions Hook
 *
 * Provides consistent checkbox selection + bulk action pattern for
 * leads, properties, and deals list pages.
 *
 * Features:
 *   - Select all / select row / deselect all
 *   - Tracks selected IDs in a Set for O(1) lookup
 *   - Action bar visibility driven by selection count
 *   - Integrates with existing React Query mutations
 */

import { useState, useCallback, useMemo } from "react";

export interface BulkActionsState<T extends { id: number }> {
  selectedIds: Set<number>;
  isAllSelected: boolean;
  isIndeterminate: boolean;
  selectedCount: number;
  isSelected: (id: number) => boolean;
  toggleRow: (id: number) => void;
  toggleAll: (items: T[]) => void;
  clearSelection: () => void;
  selectIds: (ids: number[]) => void;
}

export function useBulkActions<T extends { id: number }>(): BulkActionsState<T> {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [totalCount, setTotalCount] = useState(0);

  const isAllSelected = useMemo(
    () => totalCount > 0 && selectedIds.size === totalCount,
    [selectedIds.size, totalCount]
  );

  const isIndeterminate = useMemo(
    () => selectedIds.size > 0 && selectedIds.size < totalCount,
    [selectedIds.size, totalCount]
  );

  const isSelected = useCallback((id: number) => selectedIds.has(id), [selectedIds]);

  const toggleRow = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback((items: T[]) => {
    setTotalCount(items.length);
    setSelectedIds(prev => {
      if (prev.size === items.length) return new Set();
      return new Set(items.map(i => i.id));
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setTotalCount(0);
  }, []);

  const selectIds = useCallback((ids: number[]) => {
    setSelectedIds(new Set(ids));
    setTotalCount(ids.length);
  }, []);

  return {
    selectedIds,
    isAllSelected,
    isIndeterminate,
    selectedCount: selectedIds.size,
    isSelected,
    toggleRow,
    toggleAll,
    clearSelection,
    selectIds,
  };
}
