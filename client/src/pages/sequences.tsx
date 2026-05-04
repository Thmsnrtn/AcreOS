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
