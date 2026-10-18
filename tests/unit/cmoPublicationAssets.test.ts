import { expect, it } from "vitest";
import { approvedAssetFromRender, approvedAssetMatchesRender, verifyApprovedVideoBytes } from "../../server/services/cmo/publicationAssets";
import { publicationFixture, publicationVideoBytes } from "../helpers/cmoPublicationFixture";
const render = { id: "render", scriptId: "script", brandProfileId: 1, trackingId: "tracking", aspectRatio: "9:16", storagePath: "local:fixture.mp4", manifestJson: { publication: publicationFixture } };
it("retains the exact frozen content and verifies bytes", () => {
  const asset = approvedAssetFromRender(render);
  expect(asset.publication).toEqual(publicationFixture);
  expect(() => verifyApprovedVideoBytes(publicationVideoBytes, asset)).not.toThrow();
});
it("refuses replacement bytes and a mismatched byte count", () => {
  const asset = approvedAssetFromRender(render);
  expect(() => verifyApprovedVideoBytes(Buffer.from("replacement"), asset)).toThrow("bytes");
  asset.publication.video.byteLength++;
  expect(() => verifyApprovedVideoBytes(publicationVideoBytes, asset)).toThrow("bytes");
});
it.each([{}, { ...publicationFixture, video: { sha256: "bad", byteLength: 1 } }, { ...publicationFixture, copy: { ...publicationFixture.copy, ctaUrl: "javascript:alert(1)" } }])("refuses invalid or legacy publication proof", publication => {
  expect(() => approvedAssetFromRender({ ...render, manifestJson: { publication } })).toThrow("proof");
});
it("refuses each changed immutable identity", () => {
  const asset = approvedAssetFromRender(render);
  for (const replacement of [{ scriptId: "other" }, { brandProfileId: 2 }, { storagePath: "local:other.mp4" }, { trackingId: "other" }, { aspectRatio: "1:1" }, { id: "other" }]) {
    expect(() => approvedAssetMatchesRender(asset, { ...render, ...replacement })).toThrow("identity");
  }
});
