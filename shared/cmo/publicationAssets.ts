/** Non-secret publication content frozen by rendering, then bound to founder approval. */
export interface CmoPublicationProof {
  schema: "cmo.publication.v1";
  video: { sha256: string; byteLength: number };
  copy: { name: string; primaryText: string; headline: string; adText: string; ctaUrl: string; ctaType: "SIGN_UP" };
}
export interface CmoApprovedAsset {
  renderId: string;
  scriptId: string;
  brandProfileId: number;
  storagePath: string;
  trackingId: string;
  aspectRatio: string;
  publication: CmoPublicationProof;
}
