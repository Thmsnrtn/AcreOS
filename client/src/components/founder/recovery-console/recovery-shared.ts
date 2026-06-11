/**
 * Shared types for the /founder/recovery-console surface.
 *
 * Extracted from client/src/pages/founder/recovery-console.tsx (W3-5
 * decomposition). Mirrors the seven founder-gated recovery endpoints in
 * server/routes-admin-recovery.ts (commit 84109ef).
 */

export interface UserHit {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  clerkUserId: string | null;
}

export interface SessionRow {
  sessionId: string;
  createdAt: string | null;
  lastActiveAt: string | null;
  ip: string | null;
  userAgent: string | null;
  status: string | null;
}

export interface AuditRow {
  id: string;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string;
  justification: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export type ProofType =
  | "video_call"
  | "court_doc"
  | "id_photo"
  | "notarized_statement";

export const PROOF_LABEL: Record<ProofType, string> = {
  video_call: "Video call (Zoom/Meet recording)",
  court_doc: "Court document (probate, power of attorney, etc.)",
  id_photo: "Government-issued ID photo",
  notarized_statement: "Notarized statement",
};
