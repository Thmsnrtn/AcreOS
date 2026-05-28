// Ambient shims to stabilize server TypeScript baseline during refactor
// Narrow and remove after aligning real types.

// Some code references the global Stripe namespace types.
declare namespace Stripe {
  // Minimal placeholders
  interface Event {}
}

// Third-party packages without shipped types in this project
declare module "lob" {
  const Lob: any;
  export default Lob;
}

// parquetjs-lite ships no type declarations (CommonJS, used via dynamic import
// in server/jobs/archival.ts for cold-storage Parquet export).
declare module "parquetjs-lite" {
  const parquet: any;
  export = parquet;
}

// GeoJSON namespace shim when types are not explicitly imported
declare namespace GeoJSON {
  interface Geometry {}
  interface Polygon extends Geometry {}
  interface MultiPolygon extends Geometry {}
}

// Express Request augmentation removed — use AuthenticatedRequest from server/types/request.ts
// The previous `organization?: any` declaration here defeated the proper typing.
