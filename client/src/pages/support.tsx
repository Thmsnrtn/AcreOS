import { useEffect } from "react";
import { useLocation } from "wouter";

export default function SupportPage() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/help#support");
  }, [setLocation]);

  return null;
}
