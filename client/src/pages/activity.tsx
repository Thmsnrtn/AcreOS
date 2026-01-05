import { useEffect } from "react";
import { useLocation } from "wouter";

export default function ActivityPage() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/analytics#activity");
  }, [setLocation]);

  return null;
}
