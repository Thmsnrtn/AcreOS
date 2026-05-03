/**
 * orgEmailIdentity — per-org DKIM/SPF/DMARC identity provisioning.
 *
 * Eleonora deliverability foundation (Phase 1 §10 / Week 7-8):
 *   1. provisionIdentity()  — generate 2048-bit RSA keypair, persist with
 *                             private key encrypted via fieldEncryption,
 *                             return DNS records the founder needs to
 *                             publish (DKIM TXT, SPF TXT, DMARC TXT).
 *   2. verifyIdentity()     — perform DNS lookups against the published
 *                             records; if all three resolve and DKIM
 *                             matches the stored public key we register
 *                             the domain with SendGrid (when configured)
 *                             and mark status=verified.
 *   3. getIdentityForOrg()  — used by emailService at send time to pick
 *                             the org-specific from-address + DKIM
 *                             selector for the outbound message.
 *
 * The DKIM record format follows RFC 6376 §3.6.1:
 *   v=DKIM1; k=rsa; p=<base64-pubkey-no-headers>
 *
 * SPF + DMARC are AcreOS-platform defaults — every org's published records
 * delegate sending authorization to sendgrid.net (and indirectly the
 * AcreOS infrastructure) so we don't have to teach customers to write
 * SPF includes by hand.
 */

import crypto from "node:crypto";
import dns from "node:dns/promises";
import { db } from "../db";
import { orgEmailIdentities } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { encrypt, decrypt } from "./fieldEncryption";
import { logger } from "../utils/logger";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ProvisionedDnsRecords {
  /** DKIM TXT record. host = "<selector>._domainkey.<dkimDomain>" */
  dkim: { host: string; type: "TXT"; value: string };
  /** SPF TXT record. host = "<dkimDomain>" (root). */
  spf: { host: string; type: "TXT"; value: string };
  /** DMARC TXT record. host = "_dmarc.<dkimDomain>". */
  dmarc: { host: string; type: "TXT"; value: string };
}

export interface ProvisionResult {
  identityId: number;
  dkimSelector: string;
  dkimDomain: string;
  fromAddress: string;
  status: "provisioning" | "verified" | "failed";
  records: ProvisionedDnsRecords;
}

export interface VerifyResult {
  ok: boolean;
  status: "provisioning" | "verified" | "failed";
  checks: {
    dkim: { ok: boolean; detail?: string };
    spf: { ok: boolean; detail?: string };
    dmarc: { ok: boolean; detail?: string };
  };
  sendgridRegistered?: boolean;
  error?: string;
}

// ── DKIM keypair + DNS-record formatting ───────────────────────────────────

/**
 * Strip PEM headers/footers and newlines from a public key, so the result
 * fits in a single DNS TXT record's `p=` parameter (DKIM RFC 6376).
 */
function pemToBareBase64(pem: string): string {
  return pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
}

export function generateDkimKeypair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

export function buildDkimRecordValue(publicKeyPem: string): string {
  const bareKey = pemToBareBase64(publicKeyPem);
  // RFC 6376 §3.6.1: v=DKIM1 is the version; k=rsa is the key type;
  // p= is the bare base64 public key (no PEM headers).
  return `v=DKIM1; k=rsa; p=${bareKey}`;
}

export function buildSpfRecordValue(): string {
  // Platform default. include:sendgrid.net authorizes SendGrid; ~all is the
  // RFC 7208-recommended soft-fail terminator (so non-aligned senders are
  // marked but not auto-rejected during initial warmup).
  return "v=spf1 include:sendgrid.net ~all";
}

export function buildDmarcRecordValue(reportEmail: string): string {
  // p=quarantine is the right starting posture per M3AAWG: aligned mail
  // delivers, unaligned mail goes to spam (rather than `reject` which is
  // safer for a fresh identity but punishes warmup).
  return `v=DMARC1; p=quarantine; rua=mailto:${reportEmail}; ruf=mailto:${reportEmail}; fo=1; pct=100; aspf=r; adkim=r`;
}

export function buildDnsRecords(opts: {
  dkimDomain: string;
  dkimSelector: string;
  publicKeyPem: string;
  dmarcReportEmail: string;
}): ProvisionedDnsRecords {
  return {
    dkim: {
      host: `${opts.dkimSelector}._domainkey.${opts.dkimDomain}`,
      type: "TXT",
      value: buildDkimRecordValue(opts.publicKeyPem),
    },
    spf: {
      host: opts.dkimDomain,
      type: "TXT",
      value: buildSpfRecordValue(),
    },
    dmarc: {
      host: `_dmarc.${opts.dkimDomain}`,
      type: "TXT",
      value: buildDmarcRecordValue(opts.dmarcReportEmail),
    },
  };
}

// ── Provisioning ────────────────────────────────────────────────────────────

export interface ProvisionInput {
  organizationId: number;
  fromAddress: string;
  dkimSelector?: string;
}

function inferDomain(fromAddress: string): string {
  const at = fromAddress.lastIndexOf("@");
  if (at < 0 || at === fromAddress.length - 1) {
    throw new Error(`fromAddress "${fromAddress}" is not a valid email`);
  }
  return fromAddress.slice(at + 1).toLowerCase();
}

/**
 * Generate a keypair, persist (private key encrypted), return the DNS
 * records the founder must publish. Idempotent: re-calling for the same
 * (org, domain) returns the existing identity unchanged unless
 * `regenerateKey` is true (not exposed via API yet; would require manual
 * support intervention to rotate).
 */
export async function provisionIdentity(input: ProvisionInput): Promise<ProvisionResult> {
  const dkimDomain = inferDomain(input.fromAddress);
  const dkimSelector = input.dkimSelector || "acreos1";
  const dmarcReportEmail = `dmarc-reports@${dkimDomain}`;

  // Existing identity? Reuse keypair so DNS records the founder published
  // last week still match the public key we hold.
  const existing = await db
    .select()
    .from(orgEmailIdentities)
    .where(
      and(
        eq(orgEmailIdentities.organizationId, input.organizationId),
        eq(orgEmailIdentities.dkimDomain, dkimDomain),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    return {
      identityId: row.id,
      dkimSelector: row.dkimSelector,
      dkimDomain: row.dkimDomain,
      fromAddress: row.fromAddress,
      status: row.status as ProvisionResult["status"],
      records: buildDnsRecords({
        dkimDomain: row.dkimDomain,
        dkimSelector: row.dkimSelector,
        publicKeyPem: row.dkimPublicKey,
        dmarcReportEmail,
      }),
    };
  }

  const { publicKey, privateKey } = generateDkimKeypair();
  const records = buildDnsRecords({
    dkimDomain,
    dkimSelector,
    publicKeyPem: publicKey,
    dmarcReportEmail,
  });

  const inserted = await db
    .insert(orgEmailIdentities)
    .values({
      organizationId: input.organizationId,
      fromAddress: input.fromAddress,
      dkimDomain,
      dkimSelector,
      dkimPublicKey: publicKey,
      dkimPrivateKeyEncrypted: encrypt(privateKey),
      spfRecord: records.spf.value,
      dmarcRecord: records.dmarc.value,
      status: "provisioning",
    })
    .returning({ id: orgEmailIdentities.id });

  logger.info("[orgEmailIdentity] provisioned", {
    metadata: { organizationId: input.organizationId, dkimDomain, dkimSelector },
  });

  return {
    identityId: inserted[0].id,
    dkimSelector,
    dkimDomain,
    fromAddress: input.fromAddress,
    status: "provisioning",
    records,
  };
}

// ── DNS verification ────────────────────────────────────────────────────────

async function resolveTxtSafely(host: string): Promise<string[][]> {
  try {
    return await dns.resolveTxt(host);
  } catch (err) {
    logger.debug("[orgEmailIdentity] dns lookup failed", {
      metadata: { host, error: (err as Error).message },
    });
    return [];
  }
}

/**
 * For a DKIM TXT record, the published value should equal the stored
 * value modulo whitespace and TXT-chunk concatenation. We compare the
 * `p=` base64 directly to avoid being tripped up by attribute reordering.
 */
function dkimMatches(published: string[][], expectedPubKeyBare: string): boolean {
  for (const chunks of published) {
    const joined = chunks.join("");
    const m = joined.match(/p=([A-Za-z0-9+/=]+)/);
    if (m && m[1] === expectedPubKeyBare) return true;
  }
  return false;
}

function spfPresent(published: string[][]): boolean {
  for (const chunks of published) {
    const joined = chunks.join("").toLowerCase();
    if (joined.startsWith("v=spf1") && joined.includes("sendgrid.net")) {
      return true;
    }
  }
  return false;
}

function dmarcPresent(published: string[][]): boolean {
  for (const chunks of published) {
    const joined = chunks.join("");
    if (joined.startsWith("v=DMARC1")) return true;
  }
  return false;
}

/**
 * Inject this function in tests to swap out the DNS resolver and the
 * SendGrid registration call without requiring real network I/O.
 */
export interface VerifyOptions {
  dnsResolveTxt?: (host: string) => Promise<string[][]>;
  registerWithSendGrid?: (input: {
    domain: string;
    dkimSelector: string;
  }) => Promise<{ ok: boolean; sendgridDomainId?: string; error?: string }>;
}

export async function verifyIdentity(
  identityId: number,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const resolveTxt = options.dnsResolveTxt ?? resolveTxtSafely;
  const registerWithSendGrid = options.registerWithSendGrid ?? registerSendGridDomain;

  const rows = await db
    .select()
    .from(orgEmailIdentities)
    .where(eq(orgEmailIdentities.id, identityId))
    .limit(1);
  if (rows.length === 0) {
    return {
      ok: false,
      status: "failed",
      checks: {
        dkim: { ok: false, detail: "identity not found" },
        spf: { ok: false },
        dmarc: { ok: false },
      },
      error: "identity not found",
    };
  }
  const row = rows[0];
  const expectedBare = pemToBareBase64(row.dkimPublicKey);

  const dkimHost = `${row.dkimSelector}._domainkey.${row.dkimDomain}`;
  const dmarcHost = `_dmarc.${row.dkimDomain}`;

  const [dkimTxt, spfTxt, dmarcTxt] = await Promise.all([
    resolveTxt(dkimHost),
    resolveTxt(row.dkimDomain),
    resolveTxt(dmarcHost),
  ]);

  const dkimOk = dkimMatches(dkimTxt, expectedBare);
  const spfOk = spfPresent(spfTxt);
  const dmarcOk = dmarcPresent(dmarcTxt);

  const allOk = dkimOk && spfOk && dmarcOk;

  let sendgridRegistered: boolean | undefined;
  let sendgridDomainId: string | undefined;
  let error: string | undefined;

  if (allOk) {
    const sgResult = await registerWithSendGrid({
      domain: row.dkimDomain,
      dkimSelector: row.dkimSelector,
    });
    sendgridRegistered = sgResult.ok;
    sendgridDomainId = sgResult.sendgridDomainId;
    if (!sgResult.ok) error = sgResult.error;
  }

  const newStatus: "provisioning" | "verified" | "failed" = allOk ? "verified" : "provisioning";
  await db
    .update(orgEmailIdentities)
    .set({
      status: newStatus,
      verifiedAt: newStatus === "verified" ? new Date() : null,
      sendgridDomainId: sendgridDomainId ?? row.sendgridDomainId,
      verificationError: error ?? null,
      updatedAt: new Date(),
    })
    .where(eq(orgEmailIdentities.id, identityId));

  return {
    ok: allOk,
    status: newStatus,
    checks: {
      dkim: { ok: dkimOk, detail: dkimOk ? undefined : "DKIM TXT not published or pubkey mismatch" },
      spf: { ok: spfOk, detail: spfOk ? undefined : "SPF TXT missing or does not include sendgrid.net" },
      dmarc: { ok: dmarcOk, detail: dmarcOk ? undefined : "DMARC TXT not published" },
    },
    sendgridRegistered,
    error,
  };
}

// ── SendGrid domain authentication API ──────────────────────────────────────

/**
 * Register the verified domain with SendGrid's domain-authentication API.
 * Uses REST (no @sendgrid/client dependency). When SENDGRID_API_KEY is not
 * set, returns ok:true with a placeholder so verification still completes
 * in environments that haven't been wired to SendGrid (dev, simulation).
 */
async function registerSendGridDomain(input: {
  domain: string;
  dkimSelector: string;
}): Promise<{ ok: boolean; sendgridDomainId?: string; error?: string }> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    logger.warn("[orgEmailIdentity] SENDGRID_API_KEY not set — skipping domain auth registration");
    return { ok: true, sendgridDomainId: `local-${input.domain}` };
  }
  try {
    const resp = await fetch("https://api.sendgrid.com/v3/whitelabel/domains", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        domain: input.domain,
        default: false,
        automatic_security: false,
        custom_dkim_selector: input.dkimSelector,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return { ok: false, error: `SendGrid ${resp.status}: ${body.slice(0, 240)}` };
    }
    const json = (await resp.json()) as { id?: number | string };
    return { ok: true, sendgridDomainId: json.id != null ? String(json.id) : undefined };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ── Send-time accessor ──────────────────────────────────────────────────────

export interface OrgEmailIdentityForSend {
  fromAddress: string;
  dkimDomain: string;
  dkimSelector: string;
  dkimPrivateKey: string;
  status: "provisioning" | "verified" | "failed";
}

/**
 * Returns the verified org-specific identity, or null if none exists or
 * none is verified yet. emailService falls back to the platform identity
 * in that case.
 */
export async function getIdentityForSend(
  organizationId: number,
): Promise<OrgEmailIdentityForSend | null> {
  const rows = await db
    .select()
    .from(orgEmailIdentities)
    .where(
      and(
        eq(orgEmailIdentities.organizationId, organizationId),
        eq(orgEmailIdentities.status, "verified"),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  let dkimPrivateKey: string;
  try {
    dkimPrivateKey = decrypt(row.dkimPrivateKeyEncrypted);
  } catch (err) {
    logger.error(
      "[orgEmailIdentity] failed to decrypt DKIM private key",
      err instanceof Error ? err : undefined,
      { metadata: { identityId: row.id, organizationId } },
    );
    return null;
  }
  return {
    fromAddress: row.fromAddress,
    dkimDomain: row.dkimDomain,
    dkimSelector: row.dkimSelector,
    dkimPrivateKey,
    status: row.status as OrgEmailIdentityForSend["status"],
  };
}
