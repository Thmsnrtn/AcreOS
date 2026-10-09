/**
 * The `error` code of every plan-limit refusal, distinct from `LIMIT_EXCEEDED`.
 *
 * Its own module so the client can recognise a plan-limit refusal without
 * pulling the plan tables into its entry bundle; the server sends the
 * refusal's title and the next plan's name in `details`.
 */
export const PLAN_LIMIT_REACHED = "PLAN_LIMIT_REACHED" as const;
