// ============================================================================
// server/services/audit/detectors/platformEmailIdentityDetector.ts
// ----------------------------------------------------------------------------
// TESS (reliability) — platform SES identity watchdog.
//
// Born from a real incident (2026-07): AWS Health mailed the founder that
// DKIM setup for acreos.io had been FAILING for 3 days — the three DKIM
// CNAMEs never landed in DNS while SPF/DMARC/MAIL-FROM all did. Nothing
// in-platform noticed; the only signal was an AWS email in a human inbox.
//
// This detector asks SES directly (GetEmailIdentity) once per domain-audit
// sweep and turns identity regressions into findings that page at cause-time:
//
//   dkim:<domain>       critical when SES reports FAILED/TEMPORARY_FAILURE,
//                       warn while PENDING/NOT_STARTED. For non-SUCCESS the
//                       detail lists the EXACT CNAME records SES expects —
//                       cross-checked against live DNS so the finding says
//                       which of the three are missing.
//   mail_from:<domain>  warn when the custom MAIL FROM domain is not SUCCESS.
//   sending:<domain>    critical when VerifiedForSendingStatus is false —
//                       SES will refuse or spam-folder everything.
//   check_error:<domain> warn when the SES lookup itself fails with creds
//                       configured (invalid key, network) — a blind watchdog
//                       is itself a finding, not a silent skip.
//
// Honest-green rule: with no AWS credentials configured (dev, CI) the
// detector returns [] — integrationReadiness already surfaces missing creds;
// re-reporting them here would be noise. Read-only; never mutates SES or DNS.
// ============================================================================

import type { DomainDetector, FindingInput } from "../domainAudit";

export interface SesIdentitySnapshot {
  found: boolean;
  dkimStatus?: string;
  dkimTokens?: string[];
  mailFromDomain?: string;
  mailFromStatus?: string;
  verifiedForSending?: boolean;
}

export interface PlatformEmailIdentityDeps {
  /** Platform send domain, e.g. "acreos.io". */
  domain: string;
  /** True when AWS credentials are configured (creds absent → honest green). */
  credentialsConfigured: boolean;
  /** Fetch the SES identity snapshot. Throws on API/network failure. */
  getIdentity: (domain: string) => Promise<SesIdentitySnapshot>;
  /** Resolve a CNAME; returns targets or [] when the record does not exist. */
  resolveCname: (host: string) => Promise<string[]>;
}

const CITED_DKIM =
  "Deliverability doctrine: the platform send identity must be DKIM-verified — unsigned mail is spam-foldered and AWS fails the identity after 72h of missing DNS.";
const CITED_SENDING =
  "Deliverability doctrine: SES must report the platform identity verified-for-sending; every transactional surface (verification, reset, receipts) rides this identity.";

function severityForDkim(status: string): "warn" | "critical" {
  return status === "FAILED" || status === "TEMPORARY_FAILURE" ? "critical" : "warn";
}

/**
 * Build the detector with injected deps (tests) — the exported
 * `platformEmailIdentityDetector` wires the real SES client + resolver.
 */
export function buildPlatformEmailIdentityDetector(
  deps: PlatformEmailIdentityDeps,
): DomainDetector {
  return {
    id: "platform_email_identity",
    domain: "reliability",
    async run(): Promise<FindingInput[]> {
      if (!deps.credentialsConfigured) return [];

      let snapshot: SesIdentitySnapshot;
      try {
        snapshot = await deps.getIdentity(deps.domain);
      } catch (err) {
        return [
          {
            domain: "reliability",
            detector: "platform_email_identity",
            severity: "warn",
            title: `SES identity check failed for ${deps.domain}`,
            detail: `GetEmailIdentity threw with AWS credentials configured: ${(err as Error).message}. The watchdog is blind until this resolves.`,
            citedReason: CITED_SENDING,
            dedupeKey: `check_error:${deps.domain}`,
          },
        ];
      }

      if (!snapshot.found) {
        return [
          {
            domain: "reliability",
            detector: "platform_email_identity",
            severity: "critical",
            title: `SES has no identity for ${deps.domain}`,
            detail: `GetEmailIdentity found no identity for ${deps.domain}. Run scripts/ses-setup.mjs on the Fly machine to (re)create it and publish DNS.`,
            citedReason: CITED_SENDING,
            dedupeKey: `dkim:${deps.domain}`,
          },
        ];
      }

      const findings: FindingInput[] = [];
      const dkimStatus = snapshot.dkimStatus ?? "UNKNOWN";

      if (dkimStatus !== "SUCCESS") {
        // Cross-check live DNS so the finding names the exact missing records.
        const tokens = snapshot.dkimTokens ?? [];
        const missing: string[] = [];
        for (const token of tokens) {
          const host = `${token}._domainkey.${deps.domain}`;
          const expected = `${token}.dkim.amazonses.com`;
          let targets: string[] = [];
          try {
            targets = await deps.resolveCname(host);
          } catch {
            targets = [];
          }
          const ok = targets.some(
            (t) => t.replace(/\.$/, "").toLowerCase() === expected.toLowerCase(),
          );
          if (!ok) missing.push(`CNAME ${host} → ${expected}`);
        }

        const dnsDetail =
          tokens.length === 0
            ? "SES returned no DKIM tokens — the identity needs to be recreated."
            : missing.length > 0
              ? `Missing/wrong in DNS (${missing.length}/${tokens.length}):\n${missing.join("\n")}`
              : "All 3 CNAMEs resolve — SES has not re-checked yet (or just failed the 72h window). Restart verification via scripts/ses-setup.mjs.";

        findings.push({
          domain: "reliability",
          detector: "platform_email_identity",
          severity: severityForDkim(dkimStatus),
          title: `DKIM ${dkimStatus} for ${deps.domain}`,
          detail: `SES reports DKIM status ${dkimStatus} for the platform send identity. ${dnsDetail}\nFix: fly ssh console -a acreos -C "node scripts/ses-setup.mjs" (idempotent; restarts verification when FAILED).`,
          citedReason: CITED_DKIM,
          dedupeKey: `dkim:${deps.domain}`,
          metadata: { dkimStatus, missingRecords: missing },
        });
      }

      const mailFromStatus = snapshot.mailFromStatus;
      if (snapshot.mailFromDomain && mailFromStatus && mailFromStatus !== "SUCCESS") {
        findings.push({
          domain: "reliability",
          detector: "platform_email_identity",
          severity: "warn",
          title: `MAIL FROM ${mailFromStatus} for ${snapshot.mailFromDomain}`,
          detail: `SES reports custom MAIL FROM status ${mailFromStatus}. Bounce alignment degrades to amazonses.com until the MX/SPF records for ${snapshot.mailFromDomain} verify.`,
          citedReason: CITED_DKIM,
          dedupeKey: `mail_from:${deps.domain}`,
          metadata: { mailFromStatus },
        });
      }

      if (snapshot.verifiedForSending === false) {
        findings.push({
          domain: "reliability",
          detector: "platform_email_identity",
          severity: "critical",
          title: `${deps.domain} not verified for sending`,
          detail: `SES reports VerifiedForSendingStatus=false — transactional email from ${deps.domain} is refused or unsigned. Complete identity verification (DKIM) to restore.`,
          citedReason: CITED_SENDING,
          dedupeKey: `sending:${deps.domain}`,
        });
      }

      return findings;
    },
  };
}

// ── Production wiring ────────────────────────────────────────────────────────

function platformDomain(): string {
  if (process.env.SES_DOMAIN) return process.env.SES_DOMAIN;
  const from = process.env.AWS_SES_FROM_EMAIL || "";
  const at = from.lastIndexOf("@");
  if (at > 0 && at < from.length - 1) return from.slice(at + 1).toLowerCase();
  return "acreos.io";
}

async function getIdentityViaSes(domain: string): Promise<SesIdentitySnapshot> {
  const { SESv2Client, GetEmailIdentityCommand } = await import("@aws-sdk/client-sesv2");
  const region = process.env.AWS_SES_REGION || process.env.AWS_REGION || "us-east-1";
  const client = new SESv2Client({ region });
  try {
    const r = await client.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
    return {
      found: true,
      dkimStatus: r.DkimAttributes?.Status,
      dkimTokens: r.DkimAttributes?.Tokens,
      mailFromDomain: r.MailFromAttributes?.MailFromDomain,
      mailFromStatus: r.MailFromAttributes?.MailFromDomainStatus,
      verifiedForSending: r.VerifiedForSendingStatus,
    };
  } catch (err) {
    if ((err as { name?: string }).name === "NotFoundException") {
      return { found: false };
    }
    throw err;
  } finally {
    client.destroy();
  }
}

async function resolveCnameSafe(host: string): Promise<string[]> {
  const dns = await import("node:dns/promises");
  try {
    return await dns.resolveCname(host);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") return [];
    throw err;
  }
}

export const platformEmailIdentityDetector: DomainDetector = buildPlatformEmailIdentityDetector({
  get domain() {
    return platformDomain();
  },
  get credentialsConfigured() {
    return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  },
  getIdentity: getIdentityViaSes,
  resolveCname: resolveCnameSafe,
});
