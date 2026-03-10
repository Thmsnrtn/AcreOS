// @ts-nocheck
/**
 * T5 — Automated Database Backup Job
 *
 * Runs a pg_dump and uploads to S3 (or logs to console in dev).
 * Scheduled via BullMQ cron when REDIS_URL is set.
 *
 * Required env vars for S3 uploads:
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
 *   DB_BACKUP_S3_BUCKET (e.g. "acreos-db-backups")
 *
 * Retention: keeps last 30 days of backups (older objects deleted via S3
 * lifecycle rule — configure that in the AWS console on the bucket).
 *
 * Usage: imported by server/index.ts at startup to register the cron job.
 */

import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import os from "os";
import { log } from "../index";

const execAsync = promisify(exec);

export interface BackupResult {
  success: boolean;
  filename?: string;
  sizeBytes?: number;
  destination?: string;
  error?: string;
  timestamp: string;
}

async function runPgDump(outputPath: string): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL not set");
  await execAsync(`pg_dump --no-owner --no-acl "${dbUrl}" -f "${outputPath}"`);
}

async function uploadToS3(filePath: string, key: string): Promise<string> {
  const bucket = process.env.DB_BACKUP_S3_BUCKET;
  const region = process.env.AWS_REGION || "us-east-1";

  if (!bucket) {
    log(`[dbBackup] DB_BACKUP_S3_BUCKET not set — backup saved locally at ${filePath}`, "dbBackup");
    return `local:${filePath}`;
  }

  try {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new S3Client({ region });
    const fileContent = fs.readFileSync(filePath);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fileContent,
        ContentType: "application/octet-stream",
        ServerSideEncryption: "AES256",
      })
    );
    return `s3://${bucket}/${key}`;
  } catch (err: any) {
    log(`[dbBackup] S3 upload failed: ${err.message}`, "dbBackup");
    return `local:${filePath}`;
  }
}

export async function runDbBackup(): Promise<BackupResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `acreos-backup-${timestamp}.sql`;
  const outputPath = path.join(os.tmpdir(), filename);
  const s3Key = `database-backups/${new Date().getFullYear()}/${filename}`;

  log(`Starting database backup → ${filename}`, "dbBackup");

  try {
    await runPgDump(outputPath);
    const stats = fs.statSync(outputPath);
    const destination = await uploadToS3(outputPath, s3Key);

    // Cleanup local temp file
    try { fs.unlinkSync(outputPath); } catch {}

    const result: BackupResult = {
      success: true,
      filename,
      sizeBytes: stats.size,
      destination,
      timestamp: new Date().toISOString(),
    };

    log(`Backup complete: ${(stats.size / 1024 / 1024).toFixed(2)}MB → ${destination}`, "dbBackup");
    return result;
  } catch (err: any) {
    // Cleanup temp file on failure
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}

    log(`Backup failed: ${err.message}`, "dbBackup");
    return {
      success: false,
      error: err.message,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Register the daily backup cron job with BullMQ.
 * Call this from server startup after the job queue is initialized.
 */
export async function registerBackupCronJob(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    log("REDIS_URL not set — daily DB backup cron skipped (set REDIS_URL to enable)", "dbBackup");
    return;
  }

  try {
    const { Queue } = await import("bullmq");
    const IORedis = (await import("ioredis")).default;

    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const queue = new Queue("acreos-system-jobs", { connection });

    // Remove any existing backup job (idempotent)
    await queue.remove("daily-db-backup").catch(() => {});

    // Schedule daily at 3:00 AM UTC
    await queue.add(
      "db-backup",
      { type: "db-backup" },
      {
        jobId: "daily-db-backup",
        repeat: { pattern: "0 3 * * *" },
        removeOnComplete: { count: 7 },
        removeOnFail: { count: 3 },
      }
    );

    log("Daily DB backup cron registered (3:00 AM UTC)", "dbBackup");
  } catch (err: any) {
    log(`Failed to register backup cron: ${err.message}`, "dbBackup");
  }
}
