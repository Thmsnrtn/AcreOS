/**
 * The monthly forecasting run (job `forecasting_monthly`, registered in
 * server/jobs/runScheduledJobs.ts and the deadman roster).
 *
 * Order matters: record what is known today, then issue forecasts from what
 * was recorded, then score anything whose outcome has now been published.
 * Each stage reports refusals in words; a missing key stops only the families
 * that need it.
 */
import { recordCustomerOutcomes, recordPublicVintages, type OutcomeRecordingReport, type PublicRecordingReport } from "./vintageRecorder";
import { issueForecasts, scoreDueForecasts, type IssueReport } from "./forecastLedger";
import { logger } from "../../utils/logger";

export interface ForecastingRunReport {
  publicSeries: PublicRecordingReport;
  outcomes: OutcomeRecordingReport;
  issued: IssueReport;
  scored: number;
}

export async function runForecastingMonthly(): Promise<ForecastingRunReport> {
  const publicSeries = await recordPublicVintages();
  const outcomes = await recordCustomerOutcomes();
  const issued = await issueForecasts();
  const scored = await scoreDueForecasts();
  const report = { publicSeries, outcomes, issued, scored };
  logger.info("[forecasting] monthly run", {
    source: "forecasting_monthly",
    metadata: {
      families: publicSeries.families.map((f) => ({ family: f.family, refused: f.refused, appended: f.rowsAppended, failed: f.seriesFailed })),
      outcomesAppended: outcomes.appended,
      issued: issued.engines,
      scored,
    },
  });
  return report;
}
