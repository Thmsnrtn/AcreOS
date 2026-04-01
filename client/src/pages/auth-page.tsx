import { SignIn, SignUp } from "@clerk/react";
import { Redirect } from "wouter";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";

function getInitialMode(): "sign-in" | "sign-up" {
  const params = new URLSearchParams(window.location.search);
  return params.get("mode") === "register" ? "sign-up" : "sign-in";
}

export default function AuthPage() {
  const { user, isLoading } = useAuth();
  const [mode] = useState(getInitialMode);

  if (!isLoading && user) {
    return <Redirect to="/" />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      {mode === "sign-up" ? (
        <SignUp routing="hash" forceRedirectUrl="/today" />
      ) : (
        <SignIn routing="hash" forceRedirectUrl="/today" />
      )}
    </div>
  );
}
