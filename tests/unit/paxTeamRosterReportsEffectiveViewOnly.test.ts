/**
 * Pax's team-activity read reports each member's EFFECTIVE assigned-only flag.
 *
 * team_members.view_only_assigned_leads is a per-member OVERRIDE: NULL means
 * "the role's default", and a VA's default is assigned-only
 * (resolveViewOnlyAssignedLeads, the function the server enforces with).
 * Reporting the stored column would tell a customer, through Pax, that a VA
 * with no override sees every lead — while the server shows them only their
 * own. (Found reconciling the VA role path, #330, with Pax, #331.)
 */
import { describe, it, expect, vi } from "vitest";

const MEMBERS = [
  { id: 1, userId: "u-va", displayName: "Val", email: null, role: "va", isActive: true, viewOnlyAssignedLeads: null, joinedAt: null, invitedAt: null },
  { id: 2, userId: "u-m", displayName: "Mo", email: null, role: "member", isActive: true, viewOnlyAssignedLeads: null, joinedAt: null, invitedAt: null },
  { id: 3, userId: "u-va2", displayName: "Vic", email: null, role: "va", isActive: true, viewOnlyAssignedLeads: false, joinedAt: null, invitedAt: null },
];

vi.mock("../../server/db", () => {
  let call = 0;
  const chain = (rows: unknown[]): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return (res: (v: unknown) => unknown) => res(rows);
          return () => chain(rows);
        },
      },
    );
  return { db: { select: () => chain(call++ === 0 ? MEMBERS : []) } };
});

import { readTeamActivityForPax } from "../../server/services/paxAccountReads";

describe("readTeamActivityForPax — seesOnlyAssignedLeads is the effective value", () => {
  it("a VA with no override is assigned-only; a member is not; an explicit override wins", async () => {
    const out = await readTeamActivityForPax(9, {} as never);
    const byName = Object.fromEntries(out.members.map((m: { name: string; seesOnlyAssignedLeads: unknown }) => [m.name, m.seesOnlyAssignedLeads]));
    expect(byName).toEqual({ Val: true, Mo: false, Vic: false });
  });
});
