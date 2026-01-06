import { useEffect } from "react";
import { useLocation } from "wouter";

export default function EmailSettings() {
  const [, setLocation] = useLocation();
  
  useEffect(() => {
    setLocation("/settings#communications");
  }, [setLocation]);
  
  return null;
}
