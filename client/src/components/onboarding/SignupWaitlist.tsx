/**
 * Signup trim (W1.4): the investor types a new signup cannot pick yet.
 *
 * Not radios. Each row offers "Tell me when it opens", which records the
 * request in the founder's feedback inbox (POST /api/onboarding/waitlist).
 * A row only says "on the list" after the server confirmed it saved.
 */
import { useState } from "react";
import type { ComponentType } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";

export interface WaitlistChoice {
  value: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}

type RowState = "saving" | "done" | "error";

export function SignupWaitlist({ choices }: { choices: WaitlistChoice[] }) {
  const [rows, setRows] = useState<Record<string, RowState>>({});

  async function join(value: string) {
    setRows((r) => ({ ...r, [value]: "saving" }));
    try {
      const res = await apiRequest("POST", "/api/onboarding/waitlist", { type: value });
      setRows((r) => ({ ...r, [value]: res.ok ? "done" : "error" }));
    } catch {
      setRows((r) => ({ ...r, [value]: "error" }));
    }
  }

  return (
    <details style={{ marginTop: 12 }} data-testid="details-signup-waitlist">
      <summary
        className="ob2-hint"
        style={{ cursor: "pointer", userSelect: "none", marginBottom: 8 }}
        data-testid="summary-signup-waitlist"
      >
        Don't see your investor type? Join the waitlist
      </summary>
      <ul className="ob2-waitlist" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {choices.map(({ value, label, description, icon: Icon }) => {
          const state = rows[value];
          return (
            <li
              key={value}
              className="ob2-type-card"
              style={{ cursor: "default" }}
              data-testid={`waitlist-${value}`}
            >
              <span className="ob2-type-card-glyph" aria-hidden="true">
                <Icon className="w-4 h-4" />
              </span>
              <span className="ob2-type-card-title">{label}</span>
              <span className="ob2-type-card-desc">{description}</span>
              {state === "done" ? (
                <span role="status" data-testid={`waitlist-done-${value}`}>
                  You're on the list. We'll tell you when {label} opens.
                </span>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={state === "saving"}
                    onClick={() => join(value)}
                    aria-label={`Tell me when ${label} opens`}
                    data-testid={`button-waitlist-${value}`}
                  >
                    {state === "saving" ? "Saving..." : "Tell me when it opens"}
                  </Button>
                  {state === "error" && (
                    <span role="alert" data-testid={`waitlist-error-${value}`}>
                      Couldn't save that. Try again.
                    </span>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
