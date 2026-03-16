// @ts-nocheck
/**
 * Deal Handoff Workflow Service (T55)
 *
 * Manages the formal handoff of a deal from one team member to another
 * (e.g., acquisitions → dispositions).  A handoff:
 *  1. Records required checklist items with completion status
 *  2. Stores notes from the outgoing party
 *  3. Notifies the incoming team member via activity log + email
 *  4. Generates an Atlas briefing for the new owner on the deal context
 *
 * Storage: organizationIntegrations with provider='deal_handoffs' (JSON blob).
 */

import { db } from "../db";
import {
  organizationIntegrations,
  teamMembers,
  deals,
  leads,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HandoffChecklistItem {
  id: string;
  label: string;
  required: boolean;
  completed: boolean;
  completedAt?: Date;
}

export type HandoffStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface DealHandoff {
  id: string;
  organizationId: number;
  dealId: number;
  fromTeamMemberId: number;
  toTeamMemberId: number;
  fromRole: string;    // e.g. "acquisitions"
  toRole: string;      // e.g. "dispositions"
  status: HandoffStatus;
  notes: string;
  checklist: HandoffChecklistItem[];
  initiatedAt: Date;
  completedAt?: Date;
}

export interface InitiateHandoffInput {
  dealId: number;
  fromTeamMemberId: number;
  toTeamMemberId: number;
  fromRole: string;
  toRole: string;
  notes: string;
  customChecklist?: Array<{ label: string; required: boolean }>;
}

// Default checklist items for acquisitions → dispositions handoff
const DEFAULT_CHECKLIST: Array<{ label: string; required: boolean }> = [
  { label: "Purchase and Sale Agreement attached", required: true },
  { label: "Title search completed or ordered", required: true },
  { label: "Due diligence checklist filled out", required: true },
  { label: "Property photos uploaded", required: false },
  { label: "Survey attached (if available)", required: false },
  { label: "Seller contact information confirmed", required: true },
  { label: "Closing timeline documented", required: true },
  { label: "Known liens or encumbrances noted", required: false },
  { label: "Property access instructions provided", required: false },
];

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function getHandoffsStore(organizationId: number): Promise<DealHandoff[]> {
  const [row] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, "deal_handoffs")
      )
    )
    .limit(1);

  if (!row?.credentials) return [];
  const creds = row.credentials as any;
  const raw: DealHandoff[] = Array.isArray(creds.handoffs) ? creds.handoffs : [];
  return raw.map((h) => ({
    ...h,
    initiatedAt: new Date(h.initiatedAt),
    completedAt: h.completedAt ? new Date(h.completedAt) : undefined,
    checklist: h.checklist.map((c: any) => ({
      ...c,
      completedAt: c.completedAt ? new Date(c.completedAt) : undefined,
    })),
  }));
}

async function saveHandoffsStore(
  organizationId: number,
  handoffs: DealHandoff[]
): Promise<void> {
  const [existing] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, "deal_handoffs")
      )
    )
    .limit(1);

  const credentials = { handoffs };

  if (existing) {
    await db
      .update(organizationIntegrations)
      .set({ credentials, updatedAt: new Date() })
      .where(eq(organizationIntegrations.id, existing.id));
  } else {
    await db.insert(organizationIntegrations).values({
      organizationId,
      provider: "deal_handoffs",
      isEnabled: true,
      credentials,
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function initiateHandoff(
  organizationId: number,
  input: InitiateHandoffInput
): Promise<DealHandoff> {
  const handoffs = await getHandoffsStore(organizationId);

  const checklistSource = input.customChecklist ?? DEFAULT_CHECKLIST;
  const checklist: HandoffChecklistItem[] = checklistSource.map((item, idx) => ({
    id: `item_${idx}`,
    label: item.label,
    required: item.required,
    completed: false,
  }));

  const handoff: DealHandoff = {
    id: `handoff_${input.dealId}_${Date.now()}`,
    organizationId,
    dealId: input.dealId,
    fromTeamMemberId: input.fromTeamMemberId,
    toTeamMemberId: input.toTeamMemberId,
    fromRole: input.fromRole,
    toRole: input.toRole,
    status: "pending",
    notes: input.notes,
    checklist,
    initiatedAt: new Date(),
  };

  // Cancel any prior pending/in_progress handoff for this deal
  const filtered = handoffs.filter(
    (h) =>
      !(h.dealId === input.dealId && ["pending", "in_progress"].includes(h.status))
  );
  filtered.push(handoff);
  await saveHandoffsStore(organizationId, filtered);

  // Notify the recipient asynchronously
  setImmediate(async () => {
    try {
      await sendHandoffNotification(organizationId, handoff);
    } catch (err) {
      console.error("[DealHandoff] Notification failed:", err);
    }
  });

  console.log(
    `[DealHandoff] Initiated handoff ${handoff.id} for deal ${input.dealId}: member ${input.fromTeamMemberId} → ${input.toTeamMemberId}`
  );

  return handoff;
}

export async function updateHandoffChecklist(
  organizationId: number,
  handoffId: string,
  checklistItemId: string,
  completed: boolean
): Promise<DealHandoff> {
  const handoffs = await getHandoffsStore(organizationId);
  const idx = handoffs.findIndex((h) => h.id === handoffId);
  if (idx < 0) throw new Error(`Handoff not found: ${handoffId}`);

  const handoff = handoffs[idx];
  const updatedChecklist = handoff.checklist.map((item) =>
    item.id === checklistItemId
      ? {
          ...item,
          completed,
          completedAt: completed ? new Date() : undefined,
        }
      : item
  );

  // Auto-advance status
  const allRequired = updatedChecklist
    .filter((i) => i.required)
    .every((i) => i.completed);
  const newStatus: HandoffStatus =
    handoff.status === "pending" && updatedChecklist.some((i) => i.completed)
      ? "in_progress"
      : handoff.status;

  handoffs[idx] = {
    ...handoff,
    checklist: updatedChecklist,
    status: newStatus,
  };

  await saveHandoffsStore(organizationId, handoffs);
  return handoffs[idx];
}

export async function completeHandoff(
  organizationId: number,
  handoffId: string
): Promise<DealHandoff> {
  const handoffs = await getHandoffsStore(organizationId);
  const idx = handoffs.findIndex((h) => h.id === handoffId);
  if (idx < 0) throw new Error(`Handoff not found: ${handoffId}`);

  const handoff = handoffs[idx];

  // Check required items
  const incompleteRequired = handoff.checklist.filter(
    (i) => i.required && !i.completed
  );
  if (incompleteRequired.length > 0) {
    throw new Error(
      `Cannot complete handoff — ${incompleteRequired.length} required checklist item(s) incomplete: ${incompleteRequired.map((i) => i.label).join(", ")}`
    );
  }

  handoffs[idx] = {
    ...handoff,
    status: "completed",
    completedAt: new Date(),
  };

  await saveHandoffsStore(organizationId, handoffs);

  // Generate Atlas briefing for the recipient
  setImmediate(async () => {
    try {
      await generateAtlasBriefing(organizationId, handoffs[idx]);
    } catch (err) {
      console.error("[DealHandoff] Atlas briefing failed:", err);
    }
  });

  console.log(`[DealHandoff] Completed handoff ${handoffId}`);
  return handoffs[idx];
}

export async function getHandoffsForDeal(
  organizationId: number,
  dealId: number
): Promise<DealHandoff[]> {
  const handoffs = await getHandoffsStore(organizationId);
  return handoffs.filter((h) => h.dealId === dealId);
}

export async function getHandoffsForMember(
  organizationId: number,
  teamMemberId: number,
  direction: "from" | "to" | "both" = "both"
): Promise<DealHandoff[]> {
  const handoffs = await getHandoffsStore(organizationId);
  return handoffs.filter((h) => {
    if (direction === "from") return h.fromTeamMemberId === teamMemberId;
    if (direction === "to") return h.toTeamMemberId === teamMemberId;
    return h.fromTeamMemberId === teamMemberId || h.toTeamMemberId === teamMemberId;
  });
}

export async function getAllHandoffs(organizationId: number): Promise<DealHandoff[]> {
  const handoffs = await getHandoffsStore(organizationId);
  return handoffs.sort(
    (a, b) => b.initiatedAt.getTime() - a.initiatedAt.getTime()
  );
}

// ---------------------------------------------------------------------------
// Notification & Atlas briefing helpers
// ---------------------------------------------------------------------------

async function sendHandoffNotification(
  organizationId: number,
  handoff: DealHandoff
): Promise<void> {
  try {
    const [recipient] = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.id, handoff.toTeamMemberId))
      .limit(1);

    if (!recipient?.email) return;

    const [deal] = await db
      .select()
      .from(deals)
      .where(eq(deals.id, handoff.dealId))
      .limit(1);

    const { sendEmail } = await import("./emailService");
    const requiredItems = handoff.checklist
      .filter((i) => i.required)
      .map((i) => `<li>${i.label}</li>`)
      .join("");

    await sendEmail({
      to: recipient.email,
      subject: `Deal Handoff — Deal #${handoff.dealId} has been assigned to you`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#1e3a5f;">Deal Handoff Notification</h2>
          <p>Deal #${handoff.dealId} has been handed off to you (<strong>${handoff.toRole}</strong>).</p>
          ${handoff.notes ? `<p><strong>Notes from outgoing agent:</strong><br>${handoff.notes}</p>` : ""}
          <h3>Required checklist items to complete:</h3>
          <ul>${requiredItems}</ul>
          <p>Log in to AcreOS to review the full deal and complete the handoff checklist.</p>
        </div>
      `,
      text: `Deal #${handoff.dealId} has been handed off to you. Notes: ${handoff.notes}`,
    });

    console.log(
      `[DealHandoff] Notification sent to ${recipient.email} for handoff ${handoff.id}`
    );
  } catch (err) {
    console.error("[DealHandoff] Failed to send notification:", err);
  }
}

async function generateAtlasBriefing(
  organizationId: number,
  handoff: DealHandoff
): Promise<void> {
  try {
    const { manuallyAddMemory } = await import("./atlasMemory");
    const [deal] = await db
      .select()
      .from(deals)
      .where(eq(deals.id, handoff.dealId))
      .limit(1);

    if (!deal) return;

    const summary = [
      `Deal #${handoff.dealId} was handed off to you`,
      `From: ${handoff.fromRole} (member #${handoff.fromTeamMemberId})`,
      `To: ${handoff.toRole} (member #${handoff.toTeamMemberId})`,
      handoff.notes ? `Notes: ${handoff.notes}` : "",
      `Status: ${deal.status}`,
      deal.acceptedAmount
        ? `Accepted amount: $${Number(deal.acceptedAmount).toLocaleString()}`
        : "",
    ]
      .filter(Boolean)
      .join(". ");

    await manuallyAddMemory(
      organizationId,
      "fact",
      `deal_handoff_${handoff.dealId}`,
      summary,
      "atlas"
    );
  } catch (err) {
    console.error("[DealHandoff] Atlas memory update failed:", err);
  }
}
