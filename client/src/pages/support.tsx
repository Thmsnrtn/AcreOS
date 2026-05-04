import { useEffect } from "react";
import { useLocation } from "wouter";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function SupportPage() {
  useDocumentTitle("Support");

  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/help#support");
  }, [setLocation]);

  return null;
}
