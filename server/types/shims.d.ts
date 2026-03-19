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

// GeoJSON namespace shim when types are not explicitly imported
declare namespace GeoJSON {
  interface Geometry {}
  interface Polygon extends Geometry {}
  interface MultiPolygon extends Geometry {}
}

// Express Request augmentation for org/context fields sometimes attached at runtime
declare namespace Express {
  interface Request {
    org?: any;
    organization?: any;
  }
}
