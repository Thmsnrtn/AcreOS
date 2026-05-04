import { useEffect } from "react";
import { useLocation } from "wouter";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function MailSettings() {
  useDocumentTitle("Mail settings");

  const [, setLocation] = useLocation();
  
  useEffect(() => {
    setLocation("/settings#communications");
  }, [setLocation]);
  
  return null;
}
