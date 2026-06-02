/**
 * Cost Optimiser Weekly Spend Digest (Wave 8)
 *
 * Sends the founder a Monday-morning email summarising the latest cost-optimiser
 * run + the top open recommendations. Re-uses the existing emailService so
 * suppressions / bounces / event tracking all flow through the same plumbing
 * as the founder weekly digest.
 *
 * Reads from `cost_optimization_runs` (latest row by run_at). Falls back to
 * a "no data yet" message if the optimiser hasn't produced its first run
 * (e.g. fresh deploy on Sunday night, digest fires before optimiser has
 * landed its first nightly run).
 */

import { db } from "../db";
import { desc } from "drizzle-orm";
import { costOptimizationRuns, type CostRecommendation, type CostAutoAppliedAction } from "@shared/schema";
import { emailService } from "../services/emailService";
import { logger } from "../utils/logger";

interface DigestPayload {
  runAt: Date | null;
  totalAiCostUsd: number;
  totalFlyCostUsd: number;
  customerCount: number;
  mrrUsd: number;
  profitMarginPct: number;
  summary: string;
  recommendations: CostRecommendation[];
  autoAppliedActions: CostAutoAppliedAction[];
}

function fmtUsd(n: number, digits = 2): string {
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

async function loadLatestRun(): Promise<DigestPayload | null> {
  const [row] = await db
    .select()
    .from(costOptimizationRuns)
    .orderBy(desc(costOptimizationRuns.runAt))
    .limit(1);
  if (!row) return null;
  return {
    runAt: row.runAt,
    totalAiCostUsd: Number(row.totalAiCostUsd ?? 0),
    totalFlyCostUsd: Number(row.totalFlyCostUsd ?? 0),
    customerCount: row.customerCount,
    mrrUsd: Number(row.mrrUsd ?? 0),
    profitMarginPct: Number(row.profitMarginPct ?? 0),
    summary: row.summary ?? "",
    recommendations: (row.recommendations ?? []) as CostRecommendation[],
    autoAppliedActions: (row.autoAppliedActions ?? []) as CostAutoAppliedAction[],
  };
}

function severityColor(sev: CostRecommendation["severity"]): string {
  return sev === "critical" ? "#dc2626" : sev === "warning" ? "#d97706" : "#2563eb";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateHtml(d: DigestPayload | null, appUrl: string): { html: string; text: string; subject: string } {
  if (!d) {
    return {
      subject: "AcreOS Weekly Spend Report — No data yet",
      text:
        "The cost optimiser has not produced a run yet. The first nightly run will land within 24 hours; " +
        "next Monday's digest will include the full report.\n\n" +
        `Open dashboard: ${appUrl}/founder/cost-optimizer`,
      html: `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:680px;margin:0 auto;padding:20px;color:#1a1a1a;">
  <h1 style="font-size:18px;">AcreOS Weekly Spend Report</h1>
  <p>The cost optimiser has not produced a run yet. The first nightly run will land within 24 hours; next Monday's digest will include the full report.</p>
  <p><a href="${appUrl}/founder/cost-optimizer" style="color:#1e3a5f;">Open cost-optimiser dashboard →</a></p>
</body></html>`,
    };
  }

  const open = d.recommendations.filter((r) => !r.autoApplied);
  const applied = d.recommendations.filter((r) => r.autoApplied);
  const totalSavings = open.reduce((s, r) => s + (r.estimatedSavingsUsd ?? 0), 0);

  const recRows = open.slice(0, 6).map((r) => {
    const c = severityColor(r.severity);
    const savings = r.estimatedSavingsUsd ? ` · est savings ${fmtUsd(r.estimatedSavingsUsd)}` : "";
    return `<div style="border-left:4px solid ${c};padding:10px 14px;margin-bottom:8px;background:#fafafa;border-radius:0 6px 6px 0;">
      <div style="font-size:10px;color:${c};font-weight:700;text-transform:uppercase;">${r.severity} · ${r.category.replace(/_/g, " ")}</div>
      <div style="font-size:14px;font-weight:600;margin:4px 0;">${escapeHtml(r.title)}</div>
      <div style="font-size:12px;color:#6b7280;">${escapeHtml(r.detail)}${savings}</div>
    </div>`;
  }).join("");

  const appliedRows = applied.length === 0 && d.autoAppliedActions.length === 0
    ? `<div style="color:#6b7280;font-size:13px;">Nothing auto-applied this cycle.</div>`
    : [
        ...applied.map((r) => `<li style="font-size:12px;color:#374151;">${escapeHtml(r.title)} <span style="color:#9ca3af;">(${r.appliedBy ?? "auto"})</span></li>`),
        ...d.autoAppliedActions.map((a) => `<li style="font-size:12px;color:#374151;">${escapeHtml(a.description)} <span style="color:#9ca3af;">(${a.kind})</span></li>`),
      ].join("");

  const marginColor = d.profitMarginPct < 20 ? "#dc2626" : d.profitMarginPct < 40 ? "#d97706" : "#059669";

  const subject = `AcreOS Weekly Spend — ${fmtUsd(d.totalAiCostUsd)} AI · ${d.profitMarginPct.toFixed(1)}% margin`;
  const text =
    `AcreOS Weekly Spend Report\n\n` +
    `Customers: ${d.customerCount} | MRR: ${fmtUsd(d.mrrUsd)} | AI cost: ${fmtUsd(d.totalAiCostUsd)} | ` +
    `Fly est: ${fmtUsd(d.totalFlyCostUsd)} | Profit margin: ${d.profitMarginPct.toFixed(1)}%\n\n` +
    `${d.summary}\n\n` +
    `${open.length} open recommendation${open.length === 1 ? "" : "s"} (est ${fmtUsd(totalSavings)} savings).\n` +
    `${applied.length + d.autoAppliedActions.length} auto-applied actions.\n\n` +
    `Open dashboard: ${appUrl}/founder/cost-optimizer`;

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:680px;margin:0 auto;padding:20px;color:#1a1a1a;background:#fff;">

<div style="background:linear-gradient(135deg,#0f2a4a 0%,#1a4a3a 100%);padding:24px;border-radius:12px;margin-bottom:20px;color:white;">
  <h1 style="margin:0;font-size:20px;">AcreOS Weekly Spend Report</h1>
  <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.7);">Generated ${d.runAt ? new Date(d.runAt).toISOString().slice(0, 10) : "—"}</p>
</div>

<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:16px;">
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">
    <div style="text-align:center;background:white;padding:10px;border-radius:6px;">
      <div style="font-size:18px;font-weight:700;color:#1e3a5f;">${d.customerCount}</div>
      <div style="font-size:10px;color:#6b7280;">Customers</div>
    </div>
    <div style="text-align:center;background:white;padding:10px;border-radius:6px;">
      <div style="font-size:18px;font-weight:700;color:#1e3a5f;">${fmtUsd(d.mrrUsd)}</div>
      <div style="font-size:10px;color:#6b7280;">MRR</div>
    </div>
    <div style="text-align:center;background:white;padding:10px;border-radius:6px;">
      <div style="font-size:18px;font-weight:700;color:#7c3aed;">${fmtUsd(d.totalAiCostUsd)}</div>
      <div style="font-size:10px;color:#6b7280;">AI cost (30d)</div>
    </div>
    <div style="text-align:center;background:white;padding:10px;border-radius:6px;">
      <div style="font-size:18px;font-weight:700;color:${marginColor};">${d.profitMarginPct.toFixed(1)}%</div>
      <div style="font-size:10px;color:#6b7280;">Profit margin</div>
    </div>
  </div>
</div>

<p style="font-size:14px;line-height:1.55;color:#374151;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;">${escapeHtml(d.summary)}</p>

<h2 style="font-size:15px;color:#374151;margin-top:24px;">Top recommendations${open.length > 0 ? ` (${open.length}, est ${fmtUsd(totalSavings)} savings)` : ""}</h2>
${open.length === 0 ? `<div style="font-size:13px;color:#6b7280;">No open recommendations this week.</div>` : recRows}

<h2 style="font-size:15px;color:#374151;margin-top:20px;">Auto-applied actions</h2>
<ul style="margin:0;padding-left:18px;">${appliedRows}</ul>

<div style="text-align:center;margin:24px 0;">
  <a href="${appUrl}/founder/cost-optimizer" style="display:inline-block;background:#1e3a5f;color:white;padding:11px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Open cost-optimiser dashboard →</a>
</div>

<p style="text-align:center;font-size:11px;color:#9ca3af;margin-top:18px;">
  AcreOS Self-Tuning Cost Optimiser · weekly digest · sent only to verified founder addresses.
</p>
</body></html>`;

  return { html, text, subject };
}

export async function sendCostOptimizerWeeklyDigest(): Promise<{ sent: number; failed: number }> {
  const founderEmails = (process.env.FOUNDER_EMAIL || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  if (founderEmails.length === 0) {
    logger.warn("[CostOptimizerDigest] No FOUNDER_EMAIL configured — skipping weekly spend digest");
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  try {
    const payload = await loadLatestRun();
    const appUrl = process.env.APP_URL || "https://app.acreos.io";
    const { html, text, subject } = generateHtml(payload, appUrl);

    for (const email of founderEmails) {
      try {
        await emailService.sendEmail({ to: email, subject, html, text });
        sent++;
        logger.info(`[CostOptimizerDigest] Sent weekly spend digest to ${email}`);
      } catch (err: any) {
        logger.error(`[CostOptimizerDigest] Failed to send to ${email}`, err);
        failed++;
      }
    }
  } catch (err: any) {
    logger.error("[CostOptimizerDigest] Data load failed", err);
    failed = founderEmails.length;
  }

  return { sent, failed };
}
