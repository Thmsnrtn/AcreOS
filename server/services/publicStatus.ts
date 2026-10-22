/**
 * The public status projection behind GET /api/status.
 *
 * Until 2026-10-20 the route mapped a health status of "unconfigured" to
 * "operational", so a service with no key — no Stripe secret, no SES
 * credentials, no Redis — read as working on a PUBLIC page. "We never set
 * this up" is not "this is up". An unconfigured service is now reported as
 * `not_configured` and is EXCLUDED from the overall verdict (it is neither
 * evidence of health nor of an outage). An empty or all-unconfigured result
 * has nothing to vouch for, so the overall is "unknown", never "operational".
 */

export type PublicServiceStatus = "operational" | "degraded" | "outage" | "not_configured";
export type PublicOverallStatus = "operational" | "degraded" | "outage" | "unknown";

export function publicServiceStatus(healthStatus: unknown): PublicServiceStatus {
  switch (healthStatus) {
    case "healthy":
      return "operational";
    case "degraded":
      return "degraded";
    case "unconfigured":
      return "not_configured";
    default:
      return "outage";
  }
}

export function projectPublicStatus(services: ReadonlyArray<{ name: string; status: unknown }>): {
  status: PublicOverallStatus;
  services: { name: string; status: PublicServiceStatus }[];
} {
  const mapped = services.map((s) => ({ name: s.name, status: publicServiceStatus(s.status) }));
  const counted = mapped.filter((s) => s.status !== "not_configured");
  let status: PublicOverallStatus;
  if (counted.length === 0) status = "unknown";
  else if (counted.some((s) => s.status === "outage")) status = "outage";
  else if (counted.every((s) => s.status === "operational")) status = "operational";
  else status = "degraded";
  return { status, services: mapped };
}
