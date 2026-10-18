/** Publication routing shared by the review surface and queue writer. */
export type CmoPublicationPlatform = "meta" | "tiktok";
export interface CmoPublicationRender { id: string; aspectRatio: string }
export interface CmoPublicationDestination { renderId: string; platform: CmoPublicationPlatform }
export function cmoPublicationDestinations(renders: readonly CmoPublicationRender[], platforms: readonly CmoPublicationPlatform[]): CmoPublicationDestination[] {
  return platforms.flatMap(platform => renders.filter(render =>
    platform === "tiktok" ? render.aspectRatio === "9:16" : ["9:16", "1:1", "16:9"].includes(render.aspectRatio),
  ).map(render => ({ renderId: render.id, platform })));
}
