import { useEffect } from "react";
import { useLocation } from "wouter";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function ABTestsRedirect() {
  useDocumentTitle("A/B tests");

  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/campaigns#ab-tests");
  }, [setLocation]);

  return null;
}
