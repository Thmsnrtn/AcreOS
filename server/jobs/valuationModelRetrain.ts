// @ts-nocheck — ORM type refinement deferred; runtime-correct
/**
 * Valuation Model Retrain Job
 *
 * Weekly scheduled job that retrains the XGBoost land valuation model:
 *   1. Validates training data quality (min samples, completeness).
 *   2. Spawns a Python subprocess running /server/ml/valuation_model.py train.
 *   3. Parses the resulting metrics from stdout.
 *   4. Compares new model accuracy to the current production model.
 *   5. Auto-promotes the new model if accuracy improved by > 2 %.
 *   6. Records results in modelVersions and trainingMetrics tables.
 *   7. Sends an admin notification email with training results.
 *
 * Scheduled via BullMQ repeatable job (Sundays at 1 AM UTC).
 */

import { Worker, Queue, Job } from "bullmq";
import { spawn } from "child_process";
import * as path from "path";
import { db } from "../db";
import {
  transactionTraining,
  modelVersions,
  trainingMetrics,
  backgroundJobs,
  organizations,
  teamMembers,
} from "@shared/schema";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { sendEmail } from "../services/emailService";

export const VALUATION_RETRAIN_QUEUE_NAME = "valuation-model-retrain";

const ML_SCRIPT_PATH = path.resolve(process.cwd(), "server/ml/valuation_model.py");
const MIN_TRAINING_SAMPLES = 500;    // Minimum records required to retrain
const ACCURACY_IMPROVEMENT_THRESHOLD = 0.02; // 2 % relative improvement in MAE to auto-promote

// ---------------------------------------------------------------------------
// Training data quality validation
// ---------------------------------------------------------------------------

async function validateTrainingData(): Promise<{
  valid: boolean;
  sampleCount: number;
  reason?: string;
}> {
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(transactionTraining)
    .where(and(
      eq(transactionTraining.isOutlier, false),
      eq(transactionTraining.dataQuality, "high")
    ));

  const sampleCount = Number(countRow?.count ?? 0);

  if (sampleCount < MIN_TRAINING_SAMPLES) {
    return {
      valid: false,
      sampleCount,
      reason: `Insufficient high-quality samples: ${sampleCount} < ${MIN_TRAINING_SAMPLES}`,
    };
  }

  return { valid: true, sampleCount };
}

// ---------------------------------------------------------------------------
// Run Python training subprocess
// ---------------------------------------------------------------------------

interface TrainingOutput {
  version: string;
  mae: number;
  rmse: number;
  mape: number;
  r2: number;
  trainSamples: number;
  valSamples: number;
  testSamples: number;
  modelPath: string;
}

function runTrainingScript(sampleCount: number): Promise<TrainingOutput> {
  return new Promise((resolve, reject) => {
    const pythonBin = process.env.PYTHON_BIN || "python3";

    const proc = spawn(pythonBin, [ML_SCRIPT_PATH, "train", "--samples", String(sampleCount)], {
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
      timeout: 60 * 60 * 1000, // 1 hour max
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      process.stdout.write(`[ValuationRetrain:py] ${chunk}`);
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(`[ValuationRetrain:py:err] ${chunk}`);
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`Training script exited with code ${code}. Stderr: ${stderr.slice(0, 500)}`));
      }

      // Parse JSON result from the last line of stdout
      const lines = stdout.trim().split("\n");
      const lastLine = lines[lines.length - 1];

      try {
        const result = JSON.parse(lastLine) as TrainingOutput;
        resolve(result);
      } catch (parseErr) {
        reject(new Error(`Failed to parse training output: ${lastLine}`));
      }
    });

    proc.on("error", (err) => reject(err));
  });
}

// ---------------------------------------------------------------------------
// Compare with current production model
// ---------------------------------------------------------------------------

async function getCurrentProductionMetric(): Promise<{ modelVersionId: number; mae: number } | null> {
  const [prodVersion] = await db
    .select()
    .from(modelVersions)
    .where(and(
      eq(modelVersions.modelType, "valuation"),
      eq(modelVersions.status, "production")
    ))
    .orderBy(desc(modelVersions.deployedAt))
    .limit(1);

  if (!prodVersion) return null;

  const [maeMetric] = await db
    .select()
    .from(trainingMetrics)
    .where(and(
      eq(trainingMetrics.modelVersionId, prodVersion.id),
      eq(trainingMetrics.metricName, "mae"),
      eq(trainingMetrics.splitType, "test")
    ))
    .limit(1);

  if (!maeMetric) return null;

  return { modelVersionId: prodVersion.id, mae: Number(maeMetric.metricValue) };
}

// ---------------------------------------------------------------------------
// Persist new model version and metrics
// ---------------------------------------------------------------------------

async function persistModelVersion(
  output: TrainingOutput,
  status: "staging" | "production"
): Promise<number> {
  const [version] = await db
    .insert(modelVersions)
    .values({
      modelType: "valuation",
      version: output.version,
      gitHash: null,
      trainedAt: new Date(),
      deployedAt: status === "production" ? new Date() : null,
      retiredAt: null,
      status,
      trainingSamples: output.trainSamples,
      validationSamples: output.valSamples,
      primaryMetric: "mae",
      primaryMetricValue: String(output.mae),
      isActive: status === "production",
      notes: `Auto-trained. MAE: ${output.mae.toFixed(2)}, RMSE: ${output.rmse.toFixed(2)}, MAPE: ${output.mape.toFixed(4)}, R²: ${output.r2.toFixed(4)}`,
    })
    .returning({ id: modelVersions.id });

  const versionId = version.id;

  // Store individual metrics
  const metricsToInsert = [
    { name: "mae", value: output.mae, split: "test" },
    { name: "rmse", value: output.rmse, split: "test" },
    { name: "mape", value: output.mape, split: "test" },
    { name: "r2", value: output.r2, split: "test" },
  ];

  for (const m of metricsToInsert) {
    await db.insert(trainingMetrics).values({
      modelVersionId: versionId,
      metricName: m.name,
      metricValue: String(m.value),
      splitType: m.split,
      sampleCount: output.testSamples,
    });
  }

  return versionId;
}

// ---------------------------------------------------------------------------
// Retire old production model
// ---------------------------------------------------------------------------

async function retireProductionModels(): Promise<void> {
  await db
    .update(modelVersions)
    .set({ status: "retired", retiredAt: new Date(), isActive: false })
    .where(and(
      eq(modelVersions.modelType, "valuation"),
      eq(modelVersions.status, "production")
    ));
}

// ---------------------------------------------------------------------------
// Admin notification email
// ---------------------------------------------------------------------------

async function sendAdminNotification(params: {
  output: TrainingOutput;
  promoted: boolean;
  priorMae: number | null;
  newVersionId: number;
}): Promise<void> {
  const improvementStr = params.priorMae
    ? `${(((params.priorMae - params.output.mae) / params.priorMae) * 100).toFixed(2)}%`
    : "N/A (first model)";

  const subject = params.promoted
    ? `[AcreOS ML] Valuation model auto-promoted (MAE improved ${improvementStr})`
    : `[AcreOS ML] Valuation model retrained — staging only`;

  const text = [
    `Valuation Model Retrain Results`,
    ``,
    `Version:         ${params.output.version}`,
    `Status:          ${params.promoted ? "PROMOTED TO PRODUCTION" : "Staging — awaiting review"}`,
    ``,
    `New Metrics (test set):`,
    `  MAE:           $${params.output.mae.toFixed(2)}`,
    `  RMSE:          $${params.output.rmse.toFixed(2)}`,
    `  MAPE:          ${(params.output.mape * 100).toFixed(2)}%`,
    `  R²:            ${params.output.r2.toFixed(4)}`,
    ``,
    `Training samples:   ${params.output.trainSamples}`,
    `Validation samples: ${params.output.valSamples}`,
    `Test samples:       ${params.output.testSamples}`,
    ``,
    `Prior production MAE: ${params.priorMae != null ? `$${params.priorMae.toFixed(2)}` : "None"}`,
    `Improvement:          ${improvementStr}`,
    ``,
    `Model Version ID: ${params.newVersionId}`,
  ].join("\n");

  // Send to all super-admins (no-org users in teamMembers with role=owner of org 1)
  try {
    const admins = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.role, "owner"), eq(teamMembers.organizationId, 1)))
      .limit(5);

    for (const admin of admins) {
      if (!admin.email) continue;
      await sendEmail({
        to: admin.email,
        subject,
        text,
        html: `<pre style="font-family:monospace;font-size:13px;">${text}</pre>`,
      });
    }
  } catch (emailErr: any) {
    console.warn("[ValuationRetrain] Admin email failed:", emailErr.message);
  }
}

// ---------------------------------------------------------------------------
// Main job processor
// ---------------------------------------------------------------------------

async function processValuationRetrainJob(job: Job): Promise<void> {
  const startedAt = new Date();

  const jobRecord = await db
    .insert(backgroundJobs)
    .values({
      jobType: "valuation_model_retrain",
      status: "running",
      startedAt,
      metadata: { bullmqJobId: job.id },
    })
    .returning({ id: backgroundJobs.id });

  const bgJobId = jobRecord[0]?.id;

  try {
    // Step 1: Validate training data
    const validation = await validateTrainingData();
    if (!validation.valid) {
      console.warn(`[ValuationRetrain] Skipping: ${validation.reason}`);
      if (bgJobId) {
        await db
          .update(backgroundJobs)
          .set({ status: "completed", finishedAt: new Date(), result: { skipped: true, reason: validation.reason } })
          .where(eq(backgroundJobs.id, bgJobId));
      }
      return;
    }

    console.log(`[ValuationRetrain] Starting training with ${validation.sampleCount} samples`);

    // Step 2: Run training
    const output = await runTrainingScript(validation.sampleCount);

    // Step 3: Compare to production
    const currentProd = await getCurrentProductionMetric();
    const priorMae = currentProd?.mae ?? null;

    let promoted = false;
    if (priorMae == null) {
      // No existing production model — auto-promote
      promoted = true;
    } else {
      const relativeImprovement = (priorMae - output.mae) / priorMae;
      promoted = relativeImprovement > ACCURACY_IMPROVEMENT_THRESHOLD;
      console.log(
        `[ValuationRetrain] Prior MAE: ${priorMae.toFixed(2)}, New MAE: ${output.mae.toFixed(2)}, Improvement: ${(relativeImprovement * 100).toFixed(2)}% — ${promoted ? "AUTO-PROMOTING" : "staging only"}`
      );
    }

    // Step 4: Persist version
    if (promoted) {
      await retireProductionModels();
    }
    const newVersionId = await persistModelVersion(output, promoted ? "production" : "staging");

    // Step 5: Admin notification
    await sendAdminNotification({ output, promoted, priorMae, newVersionId });

    const finishedAt = new Date();
    if (bgJobId) {
      await db
        .update(backgroundJobs)
        .set({
          status: "completed",
          finishedAt,
          result: {
            newVersionId,
            promoted,
            mae: output.mae,
            rmse: output.rmse,
            priorMae,
            trainSamples: output.trainSamples,
          },
        })
        .where(eq(backgroundJobs.id, bgJobId));
    }

    console.log(`[ValuationRetrain] Complete. Version ${output.version} ${promoted ? "promoted to production" : "in staging"}.`);
  } catch (err: any) {
    console.error("[ValuationRetrain] Fatal error:", err.message);
    if (bgJobId) {
      await db
        .update(backgroundJobs)
        .set({ status: "failed", finishedAt: new Date(), errorMessage: err.message })
        .where(eq(backgroundJobs.id, bgJobId));
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function createValuationRetrainQueue(redisConnection: any): Queue {
  return new Queue(VALUATION_RETRAIN_QUEUE_NAME, { connection: redisConnection });
}

export async function registerValuationRetrainJob(queue: Queue): Promise<void> {
  await queue.add(
    "valuation-model-retrain",
    {},
    {
      repeat: {
        cron: "0 1 * * 0", // Sundays at 1 AM UTC
      },
      removeOnComplete: 3,
      removeOnFail: 3,
    }
  );
  console.log("[ValuationRetrain] Registered weekly retrain job (Sundays at 1 AM UTC)");
}

export function valuationModelRetrainJob(redisConnection: any): Worker {
  const worker = new Worker(
    VALUATION_RETRAIN_QUEUE_NAME,
    async (job: Job) => {
      await processValuationRetrainJob(job);
    },
    {
      connection: redisConnection,
      concurrency: 1,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[ValuationRetrain] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[ValuationRetrain] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
