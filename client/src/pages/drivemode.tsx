/**
 * /drivemode page wrapper.
 *
 * DriveMode is a full-screen mobile-first surface (no sidebar, no
 * PageShell chrome) — the component owns its own header + back button.
 * This wrapper simply mounts the component behind ProtectedRoute and
 * sets the document title so browser history shows a sane label.
 *
 * Linked from:
 *   - PersonaMapStrip CurbCaptureStrip (wholesaler + fix_flipper personas)
 *   - Any deep link / PWA shortcut that references /drivemode directly
 *
 * Rafe B-1 fix — 2026-06-01.
 */

import { useDocumentTitle } from "@/hooks/use-document-title";
import { DriveMode } from "@/components/mobile/DriveMode";

export default function DriveModePage() {
  useDocumentTitle("Drive Mode — AcreOS");
  return <DriveMode />;
}
