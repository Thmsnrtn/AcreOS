import { createHash } from "node:crypto";
export const publicationVideoBytes = Buffer.from("approved-video-fixture");
export const publicationFixture = {
  schema: "cmo.publication.v1" as const,
  video: { sha256: createHash("sha256").update(publicationVideoBytes).digest("hex"), byteLength: publicationVideoBytes.length },
  copy: { name: "Frozen creative", primaryText: "Approved body", headline: "Approved headline", adText: "Approved caption", ctaUrl: "https://acreos.io/approved", ctaType: "SIGN_UP" as const },
};
