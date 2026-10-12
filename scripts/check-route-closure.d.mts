export interface RouteSpec {
  route: string;
  source: string;
}
export interface ClosureRow {
  route: string;
  chunk: string;
  chunks: number;
  bytes: number;
  mapModules: number;
}
export interface ChunkGraph {
  version?: number;
  chunks: Record<string, unknown>;
  dynamicImports?: Record<string, string[]>;
}
export const MAP_MODULE_PATTERNS: RegExp[];
export function isMapModule(id: string): boolean;
export const MAP_FREE_ROUTES: RouteSpec[];
export const MAP_ROUTE: RouteSpec;
export const MIN_CHUNKS: number;
export const ENTRY_EXCLUDED_MODULES: Array<{ module: string; why: string }>;
export const ROUTER_MODULE: string;
export function moduleIds(chunk: unknown): string[];
export function staticClosure(chunks: Record<string, unknown>, startFile: string): Set<string>;
export function evaluate(graph: ChunkGraph, opts?: { assetsRoot?: string | null }): { failures: string[]; rows: ClosureRow[] };
export function shellWarmers(
  graph: ChunkGraph,
  chunks: Record<string, unknown>,
  entryClosure: Set<string>,
  mapIn: (closure: Set<string>) => string[],
): string[];
