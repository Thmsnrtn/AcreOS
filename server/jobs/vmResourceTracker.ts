/**
 * vmResourceTracker.ts — Fly.io VM rightsizing data collection.
 *
 * Why this exists
 * ───────────────
 * AcreOS prod runs on `cpu_kind = 'performance', cpus = 2, memory = '4gb'`,
 * which is the single biggest line-item on the Fly bill. Before we drop to
 * 2GB / 1 CPU or move to `cpu_kind = 'shared'`, we want 7+ days of real
 * utilisation data. This module samples `process.memoryUsage()` +
 * `process.cpuUsage()` + event-loop lag every 5 minutes and writes one row
 * per machine to `vm_resource_usage`.
 *
 * Wired in from server/index.ts via `scheduleSelfRescheduling`.
 *
 * The tracker is intentionally read-only against the host — it never flips
 * the VM size. The founder reviews the data and decides.
 */

import os from "node:os";
import { performance } from "node:perf_hooks";
import { db } from "../db";
import { vmResourceUsage } from "@shared/schema";
import { logger } from "../utils/logger";

const SAMPLE_WINDOW_MS = 5 * 60 * 1000;

// Snapshot kept across ticks so we can compute a CPU delta over the window.
let lastCpu: NodeJS.CpuUsage | null = null;
let lastSampleAt: number | null = null;

/**
 * Probe the event-loop lag by scheduling a `setImmediate` and measuring the
 * delay. A loose proxy — fine for trend lines, not for SLO alerting.
 */
async function measureEventLoopLagMs(): Promise<number> {
  return new Promise((resolve) => {
    const start = performance.now();
    setImmediate(() => {
      resolve(performance.now() - start);
    });
  });
}

/**
 * Compute CPU utilisation 0..100 from a process.cpuUsage() delta and the
 * wall-clock window between samples. Normalised against `cpuCount` so a
 * fully-pegged 2-CPU box reads ~100, not ~200.
 */
export function computeCpuPercent(
  cpuDelta: NodeJS.CpuUsage,
  windowMs: number,
  cpuCount: number,
): number {
  if (windowMs <= 0 || cpuCount <= 0) return 0;
  const totalCpuUs = cpuDelta.user + cpuDelta.system;
  const totalAvailableUs = windowMs * 1000 * cpuCount;
  const ratio = totalCpuUs / totalAvailableUs;
  return Math.max(0, Math.min(100, ratio * 100));
}

/**
 * Capture a single sample and persist it to vm_resource_usage. Returns 1
 * for "row written" so the scheduler reports `recordsProcessed` correctly.
 */
export async function captureVmResourceSample(): Promise<number> {
  const now = Date.now();
  const mem = process.memoryUsage();
  const cpuNow = process.cpuUsage();
  const cpuCount = os.cpus().length || 1;

  let cpuDelta: NodeJS.CpuUsage;
  let windowMs: number;
  if (lastCpu && lastSampleAt) {
    cpuDelta = {
      user: cpuNow.user - lastCpu.user,
      system: cpuNow.system - lastCpu.system,
    };
    windowMs = now - lastSampleAt;
  } else {
    // First sample — fall back to process-uptime-normalised CPU.
    cpuDelta = cpuNow;
    windowMs = Math.max(1, process.uptime() * 1000);
  }
  lastCpu = cpuNow;
  lastSampleAt = now;

  const cpuPercent = computeCpuPercent(cpuDelta, windowMs, cpuCount);
  const eventLoopLagMs = await measureEventLoopLagMs();
  const loadAvg1m = os.loadavg()[0];
  const totalMemoryBytes = os.totalmem();

  const machineId =
    process.env.FLY_MACHINE_ID ?? process.env.HOSTNAME ?? "local";
  const region = process.env.FLY_REGION ?? null;
  const processGroup = process.env.FLY_PROCESS_GROUP ?? "app";
  const appVersion = process.env.VITE_GIT_SHA ?? process.env.GIT_SHA ?? null;

  try {
    await db.insert(vmResourceUsage).values({
      machineId,
      region,
      processGroup,
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      externalBytes: mem.external,
      arrayBuffersBytes: mem.arrayBuffers ?? 0,
      cpuUserUs: cpuDelta.user,
      cpuSystemUs: cpuDelta.system,
      cpuPercent: cpuPercent.toFixed(2),
      cpuCount,
      loadAvg1m: loadAvg1m.toFixed(2),
      eventLoopLagMs: eventLoopLagMs.toFixed(2),
      totalMemoryBytes,
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      appVersion,
    });
    return 1;
  } catch (err) {
    logger.warn("[vm-resource-tracker] insert failed", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

export const VM_RESOURCE_SAMPLE_INTERVAL_MS = SAMPLE_WINDOW_MS;
