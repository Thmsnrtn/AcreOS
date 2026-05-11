// DEPRECATED 2026-05-11 — consolidated into /campaigns?channel=sequences.
// The /sequences route now redirects there via App.tsx; this component
// only renders if the redirect is bypassed. Kept on disk for A/B reuse.
import { useEffect } from "react";
import { useLocation } from "wouter";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function SequencesRedirect() {
  useDocumentTitle("Sequences");

  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/campaigns#sequences");
  }, [setLocation]);

  return null;
}
