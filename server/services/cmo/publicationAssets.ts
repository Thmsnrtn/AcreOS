import { createHash } from "node:crypto";
import { actionContentHash } from "../../utils/actionContentHash";
import { z } from "zod";
import type { CmoApprovedAsset } from "@shared/cmo/publicationAssets";

const text = z.string().refine(value => value.trim().length > 0);
const publicationSchema = z.object({
  schema: z.literal("cmo.publication.v1"),
  video: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().positive().safe() }).strict(),
  copy: z.object({
    name: text, primaryText: text, headline: text, adText: text,
    ctaUrl: z.string().url().refine(value => ["http:", "https:"].includes(new URL(value).protocol)),
    ctaType: z.literal("SIGN_UP"),
  }).strict(),
}).strict();
const assetSchema = z.object({
  renderId: text, scriptId: text, brandProfileId: z.number().int().positive(),
  storagePath: text.refine(value => /^(local|r2):.+/.test(value)), trackingId: text,
  aspectRatio: z.enum(["9:16", "1:1", "16:9"]), publication: publicationSchema,
}).strict();
type RenderMetadata = { id: string; scriptId: string; brandProfileId: number; storagePath: string; trackingId: string; aspectRatio: string; manifestJson?: unknown };
export function videoByteProof(bytes: Buffer) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("Video bytes are unavailable");
  return { sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length };
}
export function approvedAssetFromRender(render: RenderMetadata): CmoApprovedAsset {
  const publication = (render.manifestJson as { publication?: unknown } | null)?.publication;
  const result = assetSchema.safeParse({ renderId: render.id, scriptId: render.scriptId, brandProfileId: render.brandProfileId, storagePath: render.storagePath, trackingId: render.trackingId, aspectRatio: render.aspectRatio, publication });
  if (!result.success) throw new Error("Publication proof is unavailable; regenerate or use manual handoff");
  return result.data;
}
export function approvedAssetMatchesRender(value: unknown, render: RenderMetadata): CmoApprovedAsset {
  const result = assetSchema.safeParse(value);
  if (!result.success) throw new Error("Approved publication proof is unavailable; manual reconciliation required");
  const asset = result.data;
  if (asset.renderId !== render.id || asset.scriptId !== render.scriptId || asset.brandProfileId !== render.brandProfileId || asset.storagePath !== render.storagePath || asset.trackingId !== render.trackingId || asset.aspectRatio !== render.aspectRatio) {
    throw new Error("Approved publication asset identity changed; manual reconciliation required");
  }
  return asset;
}
export function verifyApprovedVideoBytes(bytes: Buffer, asset: CmoApprovedAsset): void {
  const actual = videoByteProof(bytes);
  if (actual.sha256 !== asset.publication.video.sha256 || actual.byteLength !== asset.publication.video.byteLength) throw new Error("Approved video bytes changed; publication refused");
}

export function publicationAssetRevision(asset: CmoApprovedAsset): string {
  return actionContentHash("cmo.approvedAsset", { ...asset });
}
