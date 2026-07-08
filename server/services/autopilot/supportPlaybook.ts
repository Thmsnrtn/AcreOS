/**
 * Founder Autopilot — the support playbook.
 *
 * When the brain decides "clear_support_backlog," this turns it into a
 * concrete, craft-bound support action. Support is CUSTOMER-FACING, so it
 * always routes through witnessed-send (the founder taps before anything
 * reaches a customer) — the autopilot drafts; the human approves. That's the
 * point: real people are waiting, and the bar for what's sent to them is the
 * highest in the system.
 *
 * Unlike growth, support isn't a rotating catalog — it's one disciplined play:
 * triage the oldest open cases and draft grounded, honest, genuinely-helpful
 * replies that solve the problem (or say plainly what's true), never
 * over-promising. The craft standard ("support" surface) layers on at dispatch.
 *
 * Pure + deterministic so it's trivially testable.
 */

/** How many of the oldest cases a single support pass should draft for. */
export const SUPPORT_BATCH_SIZE = 5;

/**
 * The concrete rationale for a support pass, given the current open backlog.
 * Honest about the count; never invents details about the cases themselves
 * (the agent reads the real cases at dispatch time).
 */
export function supportPlayRationale(openBacklog: number): string {
  const n = Math.max(0, Math.trunc(openBacklog));
  const batch = Math.min(n, SUPPORT_BATCH_SIZE);
  const subject =
    n === 0
      ? "No open support cases are waiting — confirm the queue is clear and surface anything that's been awaiting a customer too long."
      : `${n} support case${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} waiting. Triage by age + urgency and draft grounded, genuinely-helpful replies for the ${batch} oldest.`;
  return [
    subject,
    "Solve the actual problem or say plainly what's true; never over-promise, never guess at facts you can't verify, never copy-paste a non-answer.",
    "Each reply is a DRAFT for the founder's approval before it reaches the customer (witnessed-send).",
  ].join(" ");
}
