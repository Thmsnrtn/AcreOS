/**
 * Auto-generates closing checklists when deals move to accepted/under_contract.
 * Items are state-specific using stateDocumentConfig.ts data.
 */

import { db } from "../db";
import { storage } from "../storage";
import { dealChecklists } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { STATE_DOCUMENT_CONFIGS, getDeedTypeLabel } from "./stateDocumentConfig";
import { logger } from "../utils/logger";

interface ChecklistItem {
  id: string;
  title: string;
  description?: string;
  required: boolean;
  documentRequired: boolean;
  completed?: boolean;
  dueDate?: string;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function fmtDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

export async function generateClosingChecklist(
  dealId: number,
  state: string,
  closingDate: Date | string,
  isSellerFinanced: boolean = false
): Promise<{ items: ChecklistItem[]; count: number }> {
  const closing = typeof closingDate === "string" ? new Date(closingDate) : closingDate;
  if (isNaN(closing.getTime())) {
    return { items: [], count: 0 };
  }

  const config = STATE_DOCUMENT_CONFIGS[state?.toUpperCase()] || STATE_DOCUMENT_CONFIGS["TX"];
  const deedLabel = getDeedTypeLabel ? getDeedTypeLabel(config.primaryDeedType) : config.primaryDeedType.replace(/_/g, " ");
  const lienLabel = config.lienInstrument.replace(/_/g, " ");

  const items: ChecklistItem[] = [
    { id: "title-search", title: "Order title search", required: true, documentRequired: false, dueDate: fmtDate(addDays(closing, -21)) },
    { id: "title-review", title: "Review title commitment", required: true, documentRequired: true, dueDate: fmtDate(addDays(closing, -14)) },
    { id: "clear-liens", title: "Clear liens/encumbrances (if any)", required: false, documentRequired: false, dueDate: fmtDate(addDays(closing, -10)) },
    { id: "prepare-deed", title: `Prepare deed (${deedLabel} for ${config.stateName})`, required: true, documentRequired: true, dueDate: fmtDate(addDays(closing, -7)) },
    { id: "verify-costs", title: "Calculate and verify closing costs", required: true, documentRequired: false, dueDate: fmtDate(addDays(closing, -7)) },
    { id: "closing-statement", title: "Prepare closing statement", required: true, documentRequired: true, dueDate: fmtDate(addDays(closing, -5)) },
    { id: "send-docs", title: "Send closing documents for signature", required: true, documentRequired: true, dueDate: fmtDate(addDays(closing, -5)) },
    { id: "collect-funds", title: "Collect funds", required: true, documentRequired: false, dueDate: fmtDate(addDays(closing, -3)) },
    { id: "execute-closing", title: "Execute closing", required: true, documentRequired: false, dueDate: fmtDate(addDays(closing, 0)) },
    { id: "record-deed", title: "Record deed with county", required: true, documentRequired: true, dueDate: fmtDate(addDays(closing, 1)) },
    { id: "confirm-recording", title: "Confirm recording and obtain recording number", required: true, documentRequired: false, dueDate: fmtDate(addDays(closing, 7)) },
    { id: "send-deed-copy", title: "Send recorded deed copy to buyer", required: true, documentRequired: true, dueDate: fmtDate(addDays(closing, 14)) },
  ];

  if (isSellerFinanced) {
    items.push(
      { id: "promissory-note", title: "Prepare promissory note", required: true, documentRequired: true, dueDate: fmtDate(addDays(closing, -5)) },
      { id: "lien-instrument", title: `Prepare ${lienLabel} for ${config.stateName}`, required: true, documentRequired: true, dueDate: fmtDate(addDays(closing, -5)) },
      { id: "dodd-frank", title: "Run Dodd-Frank compliance check", required: true, documentRequired: false, dueDate: fmtDate(addDays(closing, -5)) },
      { id: "setup-note", title: "Set up note in AcreOS with payment schedule", required: true, documentRequired: false, dueDate: fmtDate(addDays(closing, 0)) },
    );
  }

  // Attorney requirement
  if (config.attorneyStateForClosing) {
    items.splice(0, 0, {
      id: "retain-attorney",
      title: `Retain closing attorney (required in ${config.stateName})`,
      required: true,
      documentRequired: false,
      dueDate: fmtDate(addDays(closing, -21)),
    });
  }

  // Check if checklist already exists
  const existing = await db
    .select()
    .from(dealChecklists)
    .where(eq(dealChecklists.dealId, dealId))
    .limit(1);

  if (existing.length > 0) {
    return { items: existing[0].items as ChecklistItem[], count: (existing[0].items as ChecklistItem[]).length };
  }

  // Insert checklist
  await db.insert(dealChecklists).values({
    dealId,
    items: items as any,
  });

  logger.info("Closing checklist generated", { dealId, state, itemCount: items.length });

  return { items, count: items.length };
}
