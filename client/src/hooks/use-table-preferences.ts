/**
 * T37 — Table Column Customization (Persistent)
 *
 * Persists per-user column visibility and order preferences.
 * Uses localStorage with server sync fallback.
 *
 * Usage:
 *   const { visibleColumns, columnOrder, toggleColumn, reorderColumns } =
 *     useTablePreferences("leads", defaultColumns);
 */

import { useState, useCallback, useEffect } from "react";

export interface ColumnDef {
  key: string;
  label: string;
  defaultVisible?: boolean;
  alwaysVisible?: boolean; // cannot be hidden (e.g. name/APN)
  width?: number;
}

interface TablePreferences {
  visible: string[];
  order: string[];
}

const LS_KEY = (table: string) => `acreOS_cols_${table}`;

function loadPrefs(tableId: string, defaults: ColumnDef[]): TablePreferences {
  try {
    const raw = localStorage.getItem(LS_KEY(tableId));
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    visible: defaults.filter(c => c.defaultVisible !== false).map(c => c.key),
    order: defaults.map(c => c.key),
  };
}

function savePrefs(tableId: string, prefs: TablePreferences) {
  try {
    localStorage.setItem(LS_KEY(tableId), JSON.stringify(prefs));
  } catch {}
}

export function useTablePreferences(tableId: string, allColumns: ColumnDef[]) {
  const [prefs, setPrefs] = useState<TablePreferences>(() =>
    loadPrefs(tableId, allColumns)
  );

  // Sync to localStorage on change
  useEffect(() => {
    savePrefs(tableId, prefs);
  }, [tableId, prefs]);

  // Always-visible columns are always included
  const visibleKeys = new Set([
    ...allColumns.filter(c => c.alwaysVisible).map(c => c.key),
    ...prefs.visible,
  ]);

  // Ordered list of visible ColumnDef objects
  const visibleColumns = prefs.order
    .filter(key => visibleKeys.has(key))
    .map(key => allColumns.find(c => c.key === key)!)
    .filter(Boolean);

  const toggleColumn = useCallback(
    (key: string) => {
      const col = allColumns.find(c => c.key === key);
      if (col?.alwaysVisible) return; // cannot toggle
      setPrefs(prev => ({
        ...prev,
        visible: prev.visible.includes(key)
          ? prev.visible.filter(k => k !== key)
          : [...prev.visible, key],
      }));
    },
    [allColumns]
  );

  const reorderColumns = useCallback((newOrder: string[]) => {
    setPrefs(prev => ({ ...prev, order: newOrder }));
  }, []);

  const resetToDefaults = useCallback(() => {
    setPrefs({
      visible: allColumns.filter(c => c.defaultVisible !== false).map(c => c.key),
      order: allColumns.map(c => c.key),
    });
  }, [allColumns]);

  const isVisible = useCallback(
    (key: string) => visibleKeys.has(key),
    [visibleKeys]
  );

  return {
    visibleColumns,
    allColumns,
    isVisible,
    toggleColumn,
    reorderColumns,
    resetToDefaults,
    prefs,
  };
}
