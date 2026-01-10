import { db } from "../db";
import { countyGisEndpoints } from "@shared/schema";
import { eq } from "drizzle-orm";

interface ValidationJob {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: Date;
  completedAt?: Date;
  total: number;
  completed: number;
  stateFilter?: string;
  results: EndpointValidationResult[];
  summary?: ValidationSummary;
  error?: string;
}

const validationJobs = new Map<string, ValidationJob>();

function generateJobId(): string {
  return `gis-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

export function getValidationJob(jobId: string): ValidationJob | undefined {
  return validationJobs.get(jobId);
}

export function getAllValidationJobs(): ValidationJob[] {
  return Array.from(validationJobs.values())
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, 10);
}

export interface EndpointValidationResult {
  id: number;
  state: string;
  county: string;
  baseUrl: string;
  status: "online" | "offline" | "error" | "timeout";
  responseTime?: number;
  featureCount?: number;
  error?: string;
  lastChecked: Date;
}

export interface ValidationSummary {
  total: number;
  online: number;
  offline: number;
  errors: number;
  timeouts: number;
  avgResponseTime: number;
  byState: Record<string, { total: number; online: number }>;
  testedAt: Date;
}

async function testEndpoint(
  endpoint: typeof countyGisEndpoints.$inferSelect,
  timeoutMs: number = 10000
): Promise<EndpointValidationResult> {
  const startTime = Date.now();
  
  try {
    const baseUrl = endpoint.baseUrl.replace(/\/$/, "");
    const layerId = endpoint.layerId || "0";
    
    const isQueryUrl = baseUrl.includes("/query");
    const testUrl = isQueryUrl 
      ? `${baseUrl}?where=1=1&returnCountOnly=true&f=json`
      : `${baseUrl}/${layerId}/query?where=1=1&returnCountOnly=true&f=json`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await fetch(testUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
      },
    });
    
    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;
    
    if (!response.ok) {
      return {
        id: endpoint.id,
        state: endpoint.state,
        county: endpoint.county,
        baseUrl: endpoint.baseUrl,
        status: "error",
        responseTime,
        error: `HTTP ${response.status}`,
        lastChecked: new Date(),
      };
    }
    
    const data = await response.json();
    
    if (data.error) {
      return {
        id: endpoint.id,
        state: endpoint.state,
        county: endpoint.county,
        baseUrl: endpoint.baseUrl,
        status: "error",
        responseTime,
        error: data.error.message || JSON.stringify(data.error),
        lastChecked: new Date(),
      };
    }
    
    return {
      id: endpoint.id,
      state: endpoint.state,
      county: endpoint.county,
      baseUrl: endpoint.baseUrl,
      status: "online",
      responseTime,
      featureCount: data.count,
      lastChecked: new Date(),
    };
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    
    if (error.name === "AbortError") {
      return {
        id: endpoint.id,
        state: endpoint.state,
        county: endpoint.county,
        baseUrl: endpoint.baseUrl,
        status: "timeout",
        responseTime,
        error: `Timeout after ${timeoutMs}ms`,
        lastChecked: new Date(),
      };
    }
    
    return {
      id: endpoint.id,
      state: endpoint.state,
      county: endpoint.county,
      baseUrl: endpoint.baseUrl,
      status: "error",
      responseTime,
      error: error.message || String(error),
      lastChecked: new Date(),
    };
  }
}

export async function validateAllEndpoints(
  options: {
    maxConcurrent?: number;
    timeoutMs?: number;
    stateFilter?: string;
    onProgress?: (completed: number, total: number, result: EndpointValidationResult) => void;
  } = {}
): Promise<{ results: EndpointValidationResult[]; summary: ValidationSummary }> {
  const { maxConcurrent = 10, timeoutMs = 10000, stateFilter, onProgress } = options;
  
  let query = db.select().from(countyGisEndpoints).where(eq(countyGisEndpoints.isActive, true));
  
  const allEndpoints = await query;
  const endpoints = stateFilter 
    ? allEndpoints.filter(e => e.state.toUpperCase() === stateFilter.toUpperCase())
    : allEndpoints;
  
  console.log(`[GISValidation] Testing ${endpoints.length} endpoints...`);
  
  const results: EndpointValidationResult[] = [];
  let completed = 0;
  
  for (let i = 0; i < endpoints.length; i += maxConcurrent) {
    const batch = endpoints.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(
      batch.map(endpoint => testEndpoint(endpoint, timeoutMs))
    );
    
    for (const result of batchResults) {
      results.push(result);
      completed++;
      onProgress?.(completed, endpoints.length, result);
      
      if (result.status === "online") {
        await db.update(countyGisEndpoints)
          .set({ lastVerified: new Date() })
          .where(eq(countyGisEndpoints.id, result.id));
      }
    }
  }
  
  const online = results.filter(r => r.status === "online");
  const offline = results.filter(r => r.status === "offline");
  const errors = results.filter(r => r.status === "error");
  const timeouts = results.filter(r => r.status === "timeout");
  
  const avgResponseTime = online.length > 0
    ? online.reduce((sum, r) => sum + (r.responseTime || 0), 0) / online.length
    : 0;
  
  const byState: Record<string, { total: number; online: number }> = {};
  for (const result of results) {
    if (!byState[result.state]) {
      byState[result.state] = { total: 0, online: 0 };
    }
    byState[result.state].total++;
    if (result.status === "online") {
      byState[result.state].online++;
    }
  }
  
  const summary: ValidationSummary = {
    total: results.length,
    online: online.length,
    offline: offline.length,
    errors: errors.length,
    timeouts: timeouts.length,
    avgResponseTime: Math.round(avgResponseTime),
    byState,
    testedAt: new Date(),
  };
  
  console.log(`[GISValidation] Complete: ${online.length}/${results.length} online (${Math.round(online.length / results.length * 100)}%)`);
  
  return { results, summary };
}

export async function validateSampleEndpoints(
  sampleSize: number = 20
): Promise<{ results: EndpointValidationResult[]; summary: ValidationSummary }> {
  const allEndpoints = await db.select().from(countyGisEndpoints).where(eq(countyGisEndpoints.isActive, true));
  
  const shuffled = allEndpoints.sort(() => Math.random() - 0.5);
  const sample = shuffled.slice(0, sampleSize);
  
  console.log(`[GISValidation] Testing sample of ${sample.length} endpoints...`);
  
  const results: EndpointValidationResult[] = [];
  
  for (const endpoint of sample) {
    const result = await testEndpoint(endpoint, 8000);
    results.push(result);
    console.log(`[GISValidation] ${result.state}/${result.county}: ${result.status} (${result.responseTime}ms)`);
  }
  
  const online = results.filter(r => r.status === "online");
  const avgResponseTime = online.length > 0
    ? online.reduce((sum, r) => sum + (r.responseTime || 0), 0) / online.length
    : 0;
  
  const byState: Record<string, { total: number; online: number }> = {};
  for (const result of results) {
    if (!byState[result.state]) {
      byState[result.state] = { total: 0, online: 0 };
    }
    byState[result.state].total++;
    if (result.status === "online") {
      byState[result.state].online++;
    }
  }
  
  return {
    results,
    summary: {
      total: results.length,
      online: online.length,
      offline: results.filter(r => r.status === "offline").length,
      errors: results.filter(r => r.status === "error").length,
      timeouts: results.filter(r => r.status === "timeout").length,
      avgResponseTime: Math.round(avgResponseTime),
      byState,
      testedAt: new Date(),
    },
  };
}

export async function getEndpointStats(): Promise<{
  totalEndpoints: number;
  activeEndpoints: number;
  recentlyVerified: number;
  statesCovered: number;
  countiesCovered: number;
}> {
  const all = await db.select().from(countyGisEndpoints);
  const active = all.filter(e => e.isActive);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentlyVerified = active.filter(e => e.lastVerified && new Date(e.lastVerified) > oneDayAgo);
  
  const states = new Set(active.map(e => e.state));
  const counties = new Set(active.map(e => `${e.state}-${e.county}`));
  
  return {
    totalEndpoints: all.length,
    activeEndpoints: active.length,
    recentlyVerified: recentlyVerified.length,
    statesCovered: states.size,
    countiesCovered: counties.size,
  };
}

export async function startValidationJob(
  options: {
    stateFilter?: string;
    maxConcurrent?: number;
  } = {}
): Promise<{ jobId: string; message: string }> {
  const { stateFilter, maxConcurrent = 10 } = options;
  const jobId = generateJobId();
  
  const allEndpoints = await db.select().from(countyGisEndpoints).where(eq(countyGisEndpoints.isActive, true));
  const endpoints = stateFilter 
    ? allEndpoints.filter(e => e.state.toUpperCase() === stateFilter.toUpperCase())
    : allEndpoints;
  
  const job: ValidationJob = {
    id: jobId,
    status: "pending",
    startedAt: new Date(),
    total: endpoints.length,
    completed: 0,
    stateFilter,
    results: [],
  };
  
  validationJobs.set(jobId, job);
  
  setImmediate(async () => {
    try {
      job.status = "running";
      
      const result = await validateAllEndpoints({
        stateFilter,
        maxConcurrent,
        timeoutMs: 8000,
        onProgress: (completed, total, result) => {
          job.completed = completed;
          job.results.push(result);
        },
      });
      
      job.status = "completed";
      job.completedAt = new Date();
      job.summary = result.summary;
      job.results = result.results;
      
      console.log(`[GISValidation] Job ${jobId} completed: ${result.summary.online}/${result.summary.total} online`);
    } catch (error: any) {
      job.status = "failed";
      job.completedAt = new Date();
      job.error = error.message || String(error);
      console.error(`[GISValidation] Job ${jobId} failed:`, error);
    }
  });
  
  return {
    jobId,
    message: `Validation job started for ${endpoints.length} endpoints. Poll /api/founder/gis-job/${jobId} for status.`,
  };
}
