import { useEffect } from "react";
import { useLocation } from "wouter";

export default function ABTestsRedirect() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/campaigns#ab-tests");
  }, [setLocation]);

  return null;
}
