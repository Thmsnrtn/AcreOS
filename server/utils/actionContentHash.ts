import { createHash } from "node:crypto";

/**
 * Deterministic JSON: object keys sorted recursively so the hash is stable
 * across property-order differences. Arrays keep their order (order is
 * semantic). undefined values are dropped (matching JSON.stringify).
 */
export function canonicalizeToolArgs(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

/** sha256 binding an approval to exactly this tool + these frozen args. */
export function actionContentHash(toolName: string, args: Record<string, unknown>): string {
  return createHash("sha256")
    .update(`${toolName}\n${canonicalizeToolArgs(args)}`, "utf8")
    .digest("hex");
}
