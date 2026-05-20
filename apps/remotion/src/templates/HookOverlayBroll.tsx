/**
 * Shared template body used by all three aspect-ratio compositions.
 *
 * Structure (timeline):
 *  0.0 – 1.5s  HOOK (bold text overlay over first B-roll clip)
 *  1.5 – Nsec  BODY (smaller text + B-roll cycling)
 *  Last 2s    END CARD (brand logo + CTA on brand-color background)
 *
 * Aspect ratio influences:
 *  - 9:16  : full-bleed B-roll, hook text bottom-left, large
 *  - 1:1   : letterboxed B-roll center, hook text top
 *  - 16:9  : full-bleed B-roll, hook text overlay center
 */

import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { CmoAdProps } from "../types";

const FPS = 30;

interface Variant {
  aspectRatio: "9:16" | "1:1" | "16:9";
  width: number;
  height: number;
}

export const HookOverlayBroll: React.FC<CmoAdProps & { variant: Variant }> = (props) => {
  const { hook, body, cta, brand, voiceAudioUrl, brollClips, lengthTargetSec, variant } = props;
  const { fps } = useVideoConfig();

  const totalFrames = Math.round(lengthTargetSec * fps);
  const hookFrames = Math.min(Math.round(1.5 * fps), totalFrames);
  const endCardFrames = Math.min(Math.round(2 * fps), totalFrames - hookFrames);
  const bodyFrames = totalFrames - hookFrames - endCardFrames;

  // Layout decisions per aspect ratio.
  const hookLayout =
    variant.aspectRatio === "9:16"
      ? { fontSize: "8vw", bottom: "12%", left: "6%", right: "6%", textAlign: "left" as const }
      : variant.aspectRatio === "1:1"
      ? { fontSize: "5.5vw", top: "8%", left: "8%", right: "8%", textAlign: "center" as const }
      : { fontSize: "5.5vw", top: "40%", left: "10%", right: "10%", textAlign: "center" as const };

  return (
    <AbsoluteFill style={{ backgroundColor: brand.secondaryColor }}>
      {/* Background B-roll cycle, plays through the whole ad until end card */}
      <Sequence from={0} durationInFrames={hookFrames + bodyFrames}>
        <BrollCycle clips={brollClips} totalFrames={hookFrames + bodyFrames} fps={fps} />
      </Sequence>

      {/* Voice plays under everything */}
      <Audio src={voiceAudioUrl} />

      {/* Hook overlay — animated in for the first 1.5s */}
      <Sequence from={0} durationInFrames={hookFrames + bodyFrames}>
        <HookOverlay
          text={hook}
          body={body}
          fontFamily={brand.fonts.display}
          color="#FFFFFF"
          hookFrames={hookFrames}
          bodyFrames={bodyFrames}
          layout={hookLayout}
        />
      </Sequence>

      {/* End card — brand color background, logo, CTA */}
      <Sequence from={hookFrames + bodyFrames} durationInFrames={endCardFrames}>
        <EndCard
          cta={cta}
          brand={brand}
          aspectRatio={variant.aspectRatio}
          totalFrames={endCardFrames}
        />
      </Sequence>
    </AbsoluteFill>
  );
};

const BrollCycle: React.FC<{
  clips: CmoAdProps["brollClips"];
  totalFrames: number;
  fps: number;
}> = ({ clips, totalFrames, fps }) => {
  if (clips.length === 0) {
    return <AbsoluteFill style={{ backgroundColor: "#1F1810" }} />;
  }

  // Cycle clips with a slow zoom on each. Total = sum of clip lengths,
  // truncated to totalFrames.
  let cursor = 0;
  return (
    <AbsoluteFill>
      {clips.map((clip, i) => {
        const start = cursor;
        const durationFrames = Math.min(
          Math.round(clip.durationSec * fps),
          Math.max(0, totalFrames - cursor),
        );
        cursor += durationFrames;
        if (durationFrames <= 0) return null;
        return (
          <Sequence key={i} from={start} durationInFrames={durationFrames}>
            <OffthreadVideo
              src={clip.url}
              muted
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                // Ken-Burns slow zoom for visual energy
                transform: "scale(1.04)",
              }}
            />
            <AbsoluteFill
              style={{
                background: "linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0.15) 40%, rgba(0,0,0,0.45))",
              }}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const HookOverlay: React.FC<{
  text: string;
  body: string;
  fontFamily: string;
  color: string;
  hookFrames: number;
  bodyFrames: number;
  layout: {
    fontSize: string;
    top?: string;
    bottom?: string;
    left: string;
    right: string;
    textAlign: "left" | "center" | "right";
  };
}> = ({ text, body, fontFamily, color, hookFrames, bodyFrames, layout }) => {
  const frame = useCurrentFrame();

  // Spring-in for the hook on frame 0.
  const hookEnter = spring({ frame, fps: FPS, config: { damping: 18, stiffness: 90 } });
  const hookOpacity = interpolate(hookEnter, [0, 1], [0, 1]);
  const hookY = interpolate(hookEnter, [0, 1], [20, 0]);

  // Fade hook out as body fades in.
  const transitionFrame = hookFrames;
  const hookFadeOut = interpolate(
    frame,
    [transitionFrame, transitionFrame + 8],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const bodyOpacity = interpolate(
    frame,
    [transitionFrame, transitionFrame + 12],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const isInBody = frame >= transitionFrame;

  return (
    <div
      style={{
        position: "absolute",
        ...(layout.bottom !== undefined ? { bottom: layout.bottom } : {}),
        ...(layout.top !== undefined ? { top: layout.top } : {}),
        left: layout.left,
        right: layout.right,
        textAlign: layout.textAlign,
        fontFamily,
        color,
        fontWeight: 700,
        letterSpacing: "-0.02em",
        textShadow: "0 2px 16px rgba(0,0,0,0.55)",
      }}
    >
      {!isInBody && (
        <div
          style={{
            opacity: hookOpacity * hookFadeOut,
            transform: `translateY(${hookY}px)`,
            fontSize: layout.fontSize,
            lineHeight: 1.05,
          }}
        >
          {text}
        </div>
      )}
      {isInBody && (
        <div
          style={{
            opacity: bodyOpacity,
            fontSize: "calc(" + layout.fontSize + " * 0.55)",
            lineHeight: 1.25,
            fontWeight: 500,
          }}
        >
          {body}
        </div>
      )}
    </div>
  );
};

const EndCard: React.FC<{
  cta: string;
  brand: CmoAdProps["brand"];
  aspectRatio: "9:16" | "1:1" | "16:9";
  totalFrames: number;
}> = ({ cta, brand, aspectRatio, totalFrames }) => {
  const frame = useCurrentFrame();
  const enter = spring({ frame, fps: FPS, config: { damping: 18, stiffness: 80 } });
  const opacity = interpolate(enter, [0, 1], [0, 1]);

  const logoFontSize = aspectRatio === "9:16" ? "12vw" : "6vw";
  const ctaFontSize = aspectRatio === "9:16" ? "5vw" : "3.5vw";

  return (
    <AbsoluteFill
      style={{
        backgroundColor: brand.primaryColor,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity,
      }}
    >
      <div
        style={{
          fontFamily: brand.fonts.display,
          color: "#FFF7E8",
          fontWeight: 700,
          fontSize: logoFontSize,
          letterSpacing: "-0.03em",
          marginBottom: "3%",
        }}
      >
        {brand.displayName}
      </div>
      <div
        style={{
          fontFamily: brand.fonts.body,
          color: "#FFF7E8",
          fontWeight: 600,
          fontSize: ctaFontSize,
          letterSpacing: "-0.005em",
          textAlign: "center",
          padding: "0 8%",
        }}
      >
        {cta}
      </div>
    </AbsoluteFill>
  );
};
