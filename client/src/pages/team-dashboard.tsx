import { useEffect } from "react";
import { useLocation } from "wouter";

export default function TeamDashboardPage() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/analytics#team");
  }, [setLocation]);

  return null;
}
