/**
 * Render orchestrator — turns a scored script into 3 rendered MP4s
 * (9:16, 1:1, 16:9), persisted with manifest and queued for founder review.
 *
 * Pipeline (deterministic given inputs):
 *   1. Load brand profile + script
 *   2. Fetch B-roll clips (Pexels → Pixabay fallback, deduped vs last 30d)
 *   3. Generate voiceover (ElevenLabs cloned founder voice)
 *   4. Spawn Remotion render for each aspect ratio (parallel within budget)
 *   5. Persist cmo_ad_renders rows with manifest + cost breakdown
 *   6. Create one decisions_inbox_items row per bundle for founder approval
 *
 * Failure modes are honest: partial artifacts (script, VO) persist even if
 * a render fails, so work is never lost. The script status flips to
 * 'rendered' only after at least one aspect ratio renders successfully.
 *
 * The orchestrator is invoked from server/jobs/cmoVideoRender.ts (outbox
 * job consumer). Direct invocation from CLI is supported for testing
 * via scripts/cmo-render-ad.ts.
 */

import crypto from "crypto";
import * as path from "path";
import { spawn } from "child_process";
import { db } from "../../db";
import {
  brandProfiles,
  cmoScripts,
  cmoAdRenders,
  decisionsInboxItems,
  type BrandProfile,
  type CmoScript,
  type CmoAdRender,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { fetchStockClips, recordAssetUsage, type StockClip } from "../../integrations/stockAssets";
import { generateVoiceover, type VoiceSettings } from "../../integrations/elevenLabs";
import { getStorage, renderKey, type StoragePath } from "./storage";
import {
  addCost,
  chargeBudget,
  emptyBreakdown,
  estimateRenderCostCents,
  type CostBreakdown,
} from "./costTracker";
import { logger } from "../../utils/logger";

const ASPECT_RATIOS: Array<{ id: string; composition: string; ratio: "9:16" | "1:1" | "16:9" }> = [
  { id: "9x16", composition: "ad-9x16", ratio: "9:16" },
  { id: "1x1", composition: "ad-1x1", ratio: "1:1" },
  { id: "16x9", composition: "ad-16x9", ratio: "16:9" },
];

export interface OrchestratorInput {
  scriptId: string;
  bundleId?: string;        // groups the 3 renders. Auto-generated if absent.
  aspectRatios?: Array<"9:16" | "1:1" | "16:9">; // defaults to all 3
}

export interface OrchestratorResult {
  bundleId: string;
  renders: CmoAdRender[];
  costBreakdown: CostBreakdown;
  decisionsInboxItemId: number;
}

export async function renderScriptToBundle(input: OrchestratorInput): Promise<OrchestratorResult> {
  const script = await db.query.cmoScripts.findFirst({
    where: eq(cmoScripts.id, input.scriptId),
  });
  if (!script) throw new Error(`[cmo:render] script ${input.scriptId} not found`);
  if (script.status === "rejected_pre_render") {
    throw new Error(`[cmo:render] script ${input.scriptId} was rejected pre-render — cannot render`);
  }
  if (!["scored", "draft"].includes(script.status)) {
    throw new Error(`[cmo:render] script ${input.scriptId} has status='${script.status}' — only 'scored' is renderable`);
  }

  const brand = await db.query.brandProfiles.findFirst({
    where: eq(brandProfiles.id, script.brandProfileId),
  });
  if (!brand) throw new Error(`[cmo:render] brand_profile ${script.brandProfileId} not found`);

  const bundleId = input.bundleId ?? crypto.randomUUID();
  const aspectRatios = input.aspectRatios ?? ["9:16", "1:1", "16:9"];

  let costs: CostBreakdown = emptyBreakdown();
  costs = addCost(costs, "scriptCents", script.generationCostCents);
  costs = addCost(costs, "scoringCents", script.scoringCostCents);

  // 1. Fetch B-roll
  logger.info(`[cmo:render] script=${script.id.slice(0, 8)} fetching B-roll for ${script.brollQueries.length} queries…`);
  const brollClips = await fetchStockClips(script.brollQueries, { count: 6 });

  // 2. Voiceover (one for the whole script, shared across aspect ratios)
  logger.info(`[cmo:render] script=${script.id.slice(0, 8)} generating voiceover…`);
  const voSettings: VoiceSettings = {
    voiceId: (brand.voice as VoiceSettings).voiceId!,
    stability: (brand.voice as VoiceSettings).stability,
    similarityBoost: (brand.voice as VoiceSettings).similarityBoost,
  };
  const voScriptText = `${script.hook} ${script.body} ${script.cta}`;
  const voKey = renderKey(bundleId, "voice.mp3");
  const voResult = await generateVoiceover(voScriptText, voSettings, voKey);
  costs = addCost(costs, "voiceCents", voResult.costCents);

  // Charge budget for VO before rendering (most expensive step before render).
  await chargeBudget(brand.id, voResult.costCents, `voice gen for script ${script.id}`);

  // 3. Render each aspect ratio
  const renders: CmoAdRender[] = [];
  const storage = getStorage();
  const voiceUrl = await storage.url(voResult.storagePath);

  for (const aspectRatio of aspectRatios) {
    const variant = ASPECT_RATIOS.find((a) => a.ratio === aspectRatio);
    if (!variant) continue;

    const renderId = crypto.randomUUID();
    const outputKey = renderKey(renderId, `${variant.id}.mp4`);
    const trackingId = `acreos-${variant.id}-${renderId.slice(0, 8)}`;

    const renderCostCents = estimateRenderCostCents(script.lengthTargetSec, 1);

    // Per-aspect-ratio cost is the same VO + assets cost amortized.
    const perRatioCost: CostBreakdown = {
      scriptCents: Math.ceil(script.generationCostCents / aspectRatios.length),
      scoringCents: Math.ceil(script.scoringCostCents / aspectRatios.length),
      voiceCents: Math.ceil(voResult.costCents / aspectRatios.length),
      assetsCents: 0, // Pexels + Pixabay are free
      renderCents: renderCostCents,
      totalCents: 0,
    };
    perRatioCost.totalCents =
      perRatioCost.scriptCents +
      perRatioCost.scoringCents +
      perRatioCost.voiceCents +
      perRatioCost.assetsCents +
      perRatioCost.renderCents;

    // Persist a 'queued' row immediately so the audit trail captures even
    // failed renders.
    const [row] = await db
      .insert(cmoAdRenders)
      .values({
        id: renderId,
        scriptId: script.id,
        brandProfileId: brand.id,
        trackingId,
        aspectRatio,
        durationSec: script.lengthTargetSec,
        storagePath: `local:${outputKey}`,
        bundleId,
        manifestJson: {
          stage: "queued",
        },
        status: "queued",
        costBreakdown: perRatioCost,
        voicePath: voResult.storagePath,
        brollAssetIds: brollClips.map((c) => `${c.provider}:${c.externalId}`),
      })
      .returning();

    try {
      await db
        .update(cmoAdRenders)
        .set({ status: "rendering", updatedAt: new Date() })
        .where(eq(cmoAdRenders.id, renderId));

      await runRemotionRender({
        compositionId: variant.composition,
        outputAbsPath: await resolveStorageAbsolutePath(outputKey),
        props: {
          hook: script.hook,
          body: script.body,
          cta: script.cta,
          ctaUrl: (brand.funnelStages as Record<string, { ctaUrl: string }>)[script.funnelStage]?.ctaUrl ?? "https://acreos.io",
          lengthTargetSec: script.lengthTargetSec,
          voiceAudioUrl: voiceUrl,
          brollClips: brollClips.map((c) => ({ url: c.url, durationSec: c.durationSec })),
          brand: {
            displayName: brand.displayName,
            primaryColor: (brand.brandKit as { primaryColor: string }).primaryColor,
            secondaryColor: (brand.brandKit as { secondaryColor: string }).secondaryColor,
            accentColor: (brand.brandKit as { accentColor?: string }).accentColor ?? "#B8842E",
            fonts: (brand.brandKit as { fonts: { display: string; body: string } }).fonts,
          },
          trackingId,
        },
        durationFrames: Math.round(script.lengthTargetSec * 30),
      });

      // Render asset usage
      for (const clip of brollClips) {
        await recordAssetUsage(clip, renderId);
      }

      const manifest = buildManifest({
        script,
        brand,
        renderId,
        trackingId,
        aspectRatio,
        brollClips,
        voicePath: voResult.storagePath,
        costBreakdown: perRatioCost,
      });

      const [updated] = await db
        .update(cmoAdRenders)
        .set({
          status: "ready",
          manifestJson: manifest as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(cmoAdRenders.id, renderId))
        .returning();
      renders.push(updated);
      costs = addCost(costs, "renderCents", renderCostCents);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[cmo:render] render failed for ${aspectRatio}: ${message}`, err instanceof Error ? err : undefined);
      await db
        .update(cmoAdRenders)
        .set({
          status: "error",
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(cmoAdRenders.id, renderId));
    }
  }

  if (renders.length === 0) {
    throw new Error(`[cmo:render] all aspect ratios failed for script ${script.id}`);
  }

  // 4. Flip script status to 'rendered'
  await db
    .update(cmoScripts)
    .set({ status: "rendered" })
    .where(eq(cmoScripts.id, script.id));

  // 5. Create founder approval item in decisions_inbox
  const inboxItem = await createApprovalItem(brand, script, renders, costs);

  return {
    bundleId,
    renders,
    costBreakdown: costs,
    decisionsInboxItemId: inboxItem.id,
  };
}

interface RemotionRenderArgs {
  compositionId: string;
  outputAbsPath: string;
  props: Record<string, unknown>;
  durationFrames: number;
}

async function runRemotionRender(args: RemotionRenderArgs): Promise<void> {
  const remotionRoot = path.resolve(process.cwd(), "apps", "remotion");
  const entry = path.join(remotionRoot, "src", "index.ts");

  // Encode props as a single CLI argument. Remotion accepts --props=<json>.
  const propsJson = JSON.stringify(args.props);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "npx",
      [
        "remotion",
        "render",
        entry,
        args.compositionId,
        args.outputAbsPath,
        `--props=${propsJson}`,
        `--frames=0-${args.durationFrames - 1}`,
        "--codec=h264",
        "--quality=80",
      ],
      {
        cwd: remotionRoot,
        env: { ...process.env, NODE_ENV: "production" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const stderrChunks: Buffer[] = [];
    child.stdout?.on("data", (chunk) => logger.debug(`[remotion:stdout] ${String(chunk).trim()}`));
    child.stderr?.on("data", (chunk) => stderrChunks.push(chunk));

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      const stderr = Buffer.concat(stderrChunks).toString().slice(0, 2000);
      reject(new Error(`remotion render exited with code ${code}: ${stderr}`));
    });
  });
}

async function resolveStorageAbsolutePath(key: string): Promise<string> {
  const root = process.env.CMO_STORAGE_ROOT ?? "/data/cmo";
  return path.join(root, key);
}

interface BuildManifestArgs {
  script: CmoScript;
  brand: BrandProfile;
  renderId: string;
  trackingId: string;
  aspectRatio: "9:16" | "1:1" | "16:9";
  brollClips: StockClip[];
  voicePath: StoragePath;
  costBreakdown: CostBreakdown;
}

function buildManifest(args: BuildManifestArgs) {
  return {
    schema: "cmo.manifest.v1",
    renderId: args.renderId,
    trackingId: args.trackingId,
    createdAt: new Date().toISOString(),
    brand: {
      id: args.brand.id,
      slug: args.brand.slug,
      displayName: args.brand.displayName,
    },
    script: {
      id: args.script.id,
      hookArchetype: args.script.hookArchetype,
      hook: args.script.hook,
      body: args.script.body,
      cta: args.script.cta,
      qualityScore: args.script.qualityScore,
      model: args.script.model,
      funnelStage: args.script.funnelStage,
      intent: args.script.intent,
    },
    rendering: {
      aspectRatio: args.aspectRatio,
      durationSec: args.script.lengthTargetSec,
    },
    voice: {
      storagePath: args.voicePath,
    },
    broll: args.brollClips.map((c) => ({
      provider: c.provider,
      externalId: c.externalId,
      query: c.query,
      durationSec: c.durationSec,
    })),
    cost: args.costBreakdown,
  };
}

async function createApprovalItem(
  brand: BrandProfile,
  script: CmoScript,
  renders: CmoAdRender[],
  costs: CostBreakdown,
) {
  const headlineRender = renders.find((r) => r.aspectRatio === "9:16") ?? renders[0];
  const aspectRatios = renders.map((r) => r.aspectRatio).join(", ");
  const totalCostUsd = (costs.totalCents / 100).toFixed(2);

  const analysis =
    `New ad ready for review. Hook archetype: ${script.hookArchetype}. ` +
    `Pre-render score: ${script.qualityScore ?? "?"}/100. ` +
    `Rendered: ${aspectRatios}. Total cost: $${totalCostUsd}.`;

  const [item] = await db
    .insert(decisionsInboxItems)
    .values({
      itemType: "cmo_ad_review",
      riskLevel: "low",
      urgencyScore: 35,
      estimatedImpactCents: null,
      sophieAnalysis: analysis,
      sophieConfidenceScore: script.qualityScore ?? 70,
      recommendedAction: "approve_and_broadcast",
      recommendedActionLabel: "Approve & broadcast to Meta + TikTok",
      actionPayload: {
        bundleId: headlineRender.bundleId,
        renderIds: renders.map((r) => r.id),
        scriptId: script.id,
        platforms: ["meta", "tiktok"],
      },
      ownerAgentCodename: "cmo",
      expectedOutcome: "Broadcast 3-aspect-ratio ad bundle to active platforms; track CTR/CPM/ROAS for archetype scoring.",
      contextBundle: {
        brandSlug: brand.slug,
        scriptHook: script.hook,
        scriptBody: script.body,
        scriptCta: script.cta,
        hookArchetype: script.hookArchetype,
        funnelStage: script.funnelStage,
        intent: script.intent,
        renders: renders.map((r) => ({
          id: r.id,
          aspectRatio: r.aspectRatio,
          storagePath: r.storagePath,
          trackingId: r.trackingId,
        })),
        costBreakdown: costs,
      },
    })
    .returning();

  return item;
}
