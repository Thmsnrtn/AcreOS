/**
 * Shape of the props passed from server/jobs/cmoVideoRender.ts into the
 * Remotion bundle. Keep this in sync with `RemotionRenderInput` on the
 * server side. The shape is part of the public contract between the
 * render pipeline and the templates.
 */

export interface CmoAdProps {
  // Script
  hook: string;
  body: string;
  cta: string;
  ctaUrl: string;        // for QR-code variant in 1:1 / 16:9; 9:16 typically has bare-text CTA
  lengthTargetSec: number;

  // Voice
  voiceAudioUrl: string; // local file: URI or data: URI; Remotion can <Audio src={...}>

  // B-roll
  brollClips: Array<{
    url: string;
    durationSec: number;
  }>;

  // Brand kit
  brand: {
    displayName: string;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    fonts: {
      display: string;
      body: string;
    };
  };

  // Tracking
  trackingId: string;    // baked into the manifest; not visually rendered
}
