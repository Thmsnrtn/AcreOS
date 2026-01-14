import { dataSourceValidator } from "./data-source-validator";
import type { DataSource } from "@shared/schema";

const BATCH_SIZE = 10;
const DELAY_BETWEEN_BATCHES_MS = 5000;
const CONCURRENT_VALIDATIONS = 3;

let isRunning = false;
let currentBatchProgress = { completed: 0, total: 0, currentBatch: 0 };

export async function runValidationJob(options?: { 
  category?: string; 
  limit?: number;
  onProgress?: (progress: typeof currentBatchProgress) => void;
}): Promise<{ validated: number; valid: number; invalid: number }> {
  if (isRunning) {
    console.log("[DataSourceValidationJob] Job already running, skipping");
    return { validated: 0, valid: 0, invalid: 0 };
  }

  isRunning = true;
  let validated = 0;
  let valid = 0;
  let invalid = 0;

  try {
    const limit = options?.limit || 100;
    const sourcesToValidate = await dataSourceValidator.getSourcesNeedingValidation(limit, options?.category);
    
    if (sourcesToValidate.length === 0) {
      console.log("[DataSourceValidationJob] No sources need validation");
      return { validated: 0, valid: 0, invalid: 0 };
    }

    console.log(`[DataSourceValidationJob] Starting validation of ${sourcesToValidate.length} sources`);
    currentBatchProgress = { completed: 0, total: sourcesToValidate.length, currentBatch: 0 };

    const batches: DataSource[][] = [];
    for (let i = 0; i < sourcesToValidate.length; i += BATCH_SIZE) {
      batches.push(sourcesToValidate.slice(i, i + BATCH_SIZE));
    }

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      currentBatchProgress.currentBatch = batchIndex + 1;
      
      console.log(`[DataSourceValidationJob] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} sources)`);
      
      const results = await dataSourceValidator.validateBatch(batch, CONCURRENT_VALIDATIONS);
      
      for (const result of results) {
        validated++;
        currentBatchProgress.completed = validated;
        
        if (result.status === "valid") {
          valid++;
        } else {
          invalid++;
        }
      }

      options?.onProgress?.(currentBatchProgress);

      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
      }
    }

    console.log(`[DataSourceValidationJob] Completed: ${validated} validated, ${valid} valid, ${invalid} invalid`);
  } catch (error) {
    console.error("[DataSourceValidationJob] Error during validation:", error);
  } finally {
    isRunning = false;
  }

  return { validated, valid, invalid };
}

export function getValidationJobStatus() {
  return {
    isRunning,
    progress: currentBatchProgress,
  };
}

export function isValidationJobRunning() {
  return isRunning;
}
