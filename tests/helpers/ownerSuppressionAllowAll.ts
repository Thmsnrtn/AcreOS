/**
 * For tests about SOMETHING ELSE on a send path: the platform-wide owner
 * opt-out list (W5a) is empty. The guard reads the database and fails CLOSED,
 * so a test whose db mock cannot answer its query would otherwise see every
 * send refused. The guard's own behaviour is proven in
 * ownerSuppressionCore / ownerSuppressionRefuses / ownerSuppressionEmailLane.
 *
 *   vi.mock("../../server/services/trust/ownerSuppression", async () =>
 *     (await import("../helpers/ownerSuppressionAllowAll")).ownerSuppressionAllowAll);
 */
export const ownerSuppressionAllowAll = {
  OWNER_OPTOUT_REASON: "Owner opt-out request on file with AcreOS (platform-wide; do not contact)",
  assertOwnerContactAllowed: async () => undefined,
  ownerContactRefusal: async () => null,
  stampOwnerSuppression: async <T,>(rows: T[]) => ({ rows, suppressedCount: 0 }),
  ownerIdentifierHashes: () => [],
};
