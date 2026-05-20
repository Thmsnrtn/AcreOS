/**
 * Remotion entry point. Registers three compositions — one per aspect
 * ratio. Each renders the same script + voice + B-roll through the
 * shared HookOverlayBroll template with aspect-ratio-specific layout.
 *
 * Server-side render flow (server/jobs/cmoVideoRender.ts):
 *   1. Compose CmoAdProps for the script
 *   2. For each target aspect ratio (9:16, 1:1, 16:9):
 *        npx remotion render src/index.ts --props=... --composition=<id>
 *      → outputs MP4 to a temp path
 *   3. Upload MP4 to storage at renders/<renderId>/<aspect>.mp4
 *   4. Write manifest sidecar with provenance
 */

import { Composition, registerRoot } from "remotion";
import { HookOverlayBroll } from "./templates/HookOverlayBroll";
import type { CmoAdProps } from "./types";

const FPS = 30;

const defaultProps: CmoAdProps = {
  hook: "Stub hook.",
  body: "Stub body.",
  cta: "Stub CTA.",
  ctaUrl: "https://acreos.io",
  lengthTargetSec: 18,
  voiceAudioUrl: "",
  brollClips: [],
  brand: {
    displayName: "AcreOS",
    primaryColor: "#A04428",
    secondaryColor: "#1F1810",
    accentColor: "#B8842E",
    fonts: { display: "Fraunces", body: "Inter" },
  },
  trackingId: "stub",
};

const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ad-9x16"
        component={HookOverlayBrollWrapper("9:16", 1080, 1920)}
        durationInFrames={FPS * 30} // server overrides per-script
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={defaultProps}
      />
      <Composition
        id="ad-1x1"
        component={HookOverlayBrollWrapper("1:1", 1080, 1080)}
        durationInFrames={FPS * 30}
        fps={FPS}
        width={1080}
        height={1080}
        defaultProps={defaultProps}
      />
      <Composition
        id="ad-16x9"
        component={HookOverlayBrollWrapper("16:9", 1920, 1080)}
        durationInFrames={FPS * 30}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={defaultProps}
      />
    </>
  );
};

function HookOverlayBrollWrapper(
  aspectRatio: "9:16" | "1:1" | "16:9",
  width: number,
  height: number,
) {
  // Returns a component that injects the variant into HookOverlayBroll
  // without forcing the server to know about the variant prop shape.
  const Component: React.FC<CmoAdProps> = (props) => {
    return <HookOverlayBroll {...props} variant={{ aspectRatio, width, height }} />;
  };
  Component.displayName = `AdComposition_${aspectRatio.replace(":", "x")}`;
  return Component;
}

// React JSX in a `.ts` file — needs the import for the JSX factory to resolve.
// (Convert to .tsx in v2 cleanup if desired; .ts works because Remotion bundles via esbuild.)
import * as React from "react";

registerRoot(RemotionRoot);
