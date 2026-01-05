import { useEffect } from "react";
import { useLocation } from "wouter";

export default function SequencesRedirect() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/campaigns#sequences");
  }, [setLocation]);

  return null;
}
