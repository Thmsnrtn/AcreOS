/**
 * Types for the LOC counting rule (`measure-loc.mjs`). The implementation is
 * `.mjs` so it runs under plain node; this declaration lets a TypeScript test
 * import the SAME module rather than a copy. Keep it in step with the exports.
 */
export declare const LOC_ROOTS: string[];
export declare const LOC_FILE_FLOOR: number;
export declare function isProductSource(file: string): boolean;
export declare function measureLoc(cwd?: string): { files: number; lines: number };
