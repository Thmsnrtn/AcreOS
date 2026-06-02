#!/usr/bin/env node
/**
 * SES + Cloudflare DNS setup for acreos.io.
 *
 * Runs on the Fly machine where AWS + Cloudflare credentials live as secrets:
 *   fly ssh console -a acreos -C "node scripts/ses-setup.mjs"
 *
 * Idempotent: every step inspects current state before acting. Re-running is
 * safe and is the recommended way to verify state after DNS propagation.
 *
 * Required env (from Fly secrets):
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *   AWS_SES_REGION (optional; defaults to us-east-1)
 *   CLOUDFLARE_API_TOKEN (or CF_API_TOKEN / CLOUDFLARE_TOKEN / CF_TOKEN)
 *
 * Optional:
 *   SES_DOMAIN (defaults to acreos.io)
 *   SES_MAIL_FROM (defaults to mail.<domain>)
 *   SES_CONFIG_SET (defaults to acreos-transactional)
 *   SES_DMARC_POLICY (defaults to "none" — observe-only; switch to "quarantine" then "reject" after ~30 days of clean RUA reports)
 *   SES_DMARC_RUA (defaults to mailto:dmarc@<domain>)
 *
 * What it does, in order:
 *   1. Look up Cloudflare zone for the domain.
 *   2. Create SES email identity (DKIM auto-enabled via SESv2 default RSA_2048).
 *   3. Pull the 3 DKIM CNAME tokens from SES.
 *   4. Upsert the 3 DKIM CNAMEs into Cloudflare DNS.
 *   5. Configure custom MAIL FROM domain on the SES identity.
 *   6. Upsert MX + SPF TXT records for the MAIL FROM subdomain.
 *   7. Inspect/upsert the apex SPF TXT (skip if existing record already includes amazonses).
 *   8. Upsert _dmarc TXT with policy from SES_DMARC_POLICY.
 *   9. Create (or no-op) the SES configuration set for bounce/complaint tracking.
 *  10. Inspect production-access status; submit PutAccountDetails sandbox-exit if still in sandbox.
 *  11. Print a summary + next steps.
 */

import {
  SESv2Client,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  PutEmailIdentityMailFromAttributesCommand,
  CreateConfigurationSetCommand,
  GetAccountCommand,
  PutAccountDetailsCommand,
} from "@aws-sdk/client-sesv2";

const DOMAIN = process.env.SES_DOMAIN || "acreos.io";
const MAIL_FROM = process.env.SES_MAIL_FROM || `mail.${DOMAIN}`;
const REGION = process.env.AWS_SES_REGION || process.env.AWS_REGION || "us-east-1";
const CONFIG_SET = process.env.SES_CONFIG_SET || "acreos-transactional";
const DMARC_POLICY = process.env.SES_DMARC_POLICY || "none";
const DMARC_RUA = process.env.SES_DMARC_RUA || `mailto:dmarc@${DOMAIN}`;
const FROM_EMAIL = process.env.AWS_SES_FROM_EMAIL || `no-reply@${DOMAIN}`;

const CF_TOKEN =
  process.env.CLOUDFLARE_API_TOKEN ||
  process.env.CF_API_TOKEN ||
  process.env.CLOUDFLARE_TOKEN ||
  process.env.CF_TOKEN ||
  process.env.Cloudflare;

const AWS_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET = process.env.AWS_SECRET_ACCESS_KEY;

const ok = (msg) => console.log(`  ✓  ${msg}`);
const info = (msg) => console.log(`  ·  ${msg}`);
const warn = (msg) => console.log(`  !  ${msg}`);
const step = (n, label) => console.log(`\n[${n}] ${label}`);
const fail = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

if (!AWS_ID || !AWS_SECRET) {
  fail(
    "Missing AWS credentials. Both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set in Fly secrets.",
  );
}
if (!CF_TOKEN) {
  fail(
    "Missing Cloudflare API token. Set one of: CLOUDFLARE_API_TOKEN / CF_API_TOKEN / CLOUDFLARE_TOKEN / CF_TOKEN.",
  );
}

console.log(`\n══════════════════════════════════════════════════════════`);
console.log(` SES + Cloudflare setup for ${DOMAIN}`);
console.log(`══════════════════════════════════════════════════════════`);
console.log(` Region:        ${REGION}`);
console.log(` From email:    ${FROM_EMAIL}`);
console.log(` MAIL FROM:     ${MAIL_FROM}`);
console.log(` Config set:    ${CONFIG_SET}`);
console.log(` DMARC policy:  ${DMARC_POLICY}`);
console.log(`══════════════════════════════════════════════════════════`);

const ses = new SESv2Client({ region: REGION });

async function cf(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CF_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = { errors: [{ message: `HTTP ${res.status}: ${await res.text()}` }] };
  }
  if (!res.ok || !body.success) {
    const errs = (body.errors || []).map((e) => e.message).join("; ");
    throw new Error(`Cloudflare ${init.method || "GET"} ${path}: ${errs || JSON.stringify(body)}`);
  }
  return body.result;
}

async function getZoneId(domain) {
  const zones = await cf(`/zones?name=${encodeURIComponent(domain)}`);
  if (!zones.length) {
    throw new Error(
      `Zone ${domain} not found via this Cloudflare token. Verify the token has Zone:Read + DNS:Edit on ${domain}.`,
    );
  }
  return zones[0].id;
}

async function findRecord(zoneId, name, type) {
  const params = new URLSearchParams({ name, type, per_page: "100" });
  const records = await cf(`/zones/${zoneId}/dns_records?${params.toString()}`);
  return records;
}

async function upsert(zoneId, { name, type, content, priority, ttl = 1, proxied = false }) {
  const matches = await findRecord(zoneId, name, type);
  const exact = matches.find((r) => {
    if (r.content !== content) return false;
    if (typeof priority === "number" && r.priority !== priority) return false;
    return true;
  });
  if (exact) {
    info(`${type} ${name} already correct`);
    return exact;
  }
  // For singletons (CNAME / MX with same name+type), update the first match in place.
  const same = matches.find((r) => r.name === name && r.type === type);
  const payload = { type, name, content, ttl, proxied };
  if (typeof priority === "number") payload.priority = priority;
  if (same && (type === "CNAME" || type === "MX")) {
    const updated = await cf(`/zones/${zoneId}/dns_records/${same.id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    ok(`${type} ${name} updated`);
    return updated;
  }
  const created = await cf(`/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  ok(`${type} ${name} added`);
  return created;
}

async function run() {
  step(1, `Cloudflare zone lookup`);
  const zoneId = await getZoneId(DOMAIN);
  ok(`zone ${zoneId}`);

  step(2, `SES email identity for ${DOMAIN}`);
  try {
    await ses.send(
      new CreateEmailIdentityCommand({
        EmailIdentity: DOMAIN,
        DkimSigningAttributes: { NextSigningKeyLength: "RSA_2048_BIT" },
      }),
    );
    ok(`created`);
  } catch (e) {
    if (e.name === "AlreadyExistsException") {
      info(`identity ${DOMAIN} already exists`);
    } else {
      throw e;
    }
  }

  step(3, `Retrieving DKIM tokens`);
  const idDetails = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: DOMAIN }));
  const tokens = idDetails.DkimAttributes?.Tokens || [];
  if (tokens.length !== 3) {
    fail(`Expected 3 DKIM tokens, got ${tokens.length}. Re-check SES identity.`);
  }
  ok(`3 tokens retrieved`);
  const dkimStatus = idDetails.DkimAttributes?.Status || "UNKNOWN";
  const mailFromStatus = idDetails.MailFromAttributes?.MailFromDomainStatus || "UNKNOWN";
  info(`current DKIM status: ${dkimStatus}`);
  info(`current MAIL FROM status: ${mailFromStatus}`);

  step(4, `Upserting DKIM CNAMEs in Cloudflare`);
  for (const token of tokens) {
    await upsert(zoneId, {
      name: `${token}._domainkey.${DOMAIN}`,
      type: "CNAME",
      content: `${token}.dkim.amazonses.com`,
    });
  }

  step(5, `Configuring SES custom MAIL FROM (${MAIL_FROM})`);
  await ses.send(
    new PutEmailIdentityMailFromAttributesCommand({
      EmailIdentity: DOMAIN,
      MailFromDomain: MAIL_FROM,
      BehaviorOnMxFailure: "USE_DEFAULT_VALUE",
    }),
  );
  ok(`MAIL FROM set`);

  step(6, `MAIL FROM DNS records`);
  await upsert(zoneId, {
    name: MAIL_FROM,
    type: "MX",
    content: `feedback-smtp.${REGION}.amazonses.com`,
    priority: 10,
  });
  await upsert(zoneId, {
    name: MAIL_FROM,
    type: "TXT",
    content: `"v=spf1 include:amazonses.com ~all"`,
  });

  step(7, `Apex SPF (${DOMAIN}) inspection`);
  const apexTxt = await findRecord(zoneId, DOMAIN, "TXT");
  const spfRecords = apexTxt.filter((r) => {
    const v = r.content.replace(/^"|"$/g, "");
    return v.toLowerCase().startsWith("v=spf1");
  });
  if (spfRecords.length === 0) {
    await upsert(zoneId, {
      name: DOMAIN,
      type: "TXT",
      content: `"v=spf1 include:amazonses.com ~all"`,
    });
  } else if (spfRecords.length > 1) {
    warn(
      `Multiple SPF records on ${DOMAIN} — RFC 7208 forbids this. Manual cleanup required: ${spfRecords.map((r) => r.content).join(" | ")}`,
    );
  } else {
    const existing = spfRecords[0];
    if (existing.content.includes("amazonses.com")) {
      info(`apex SPF already includes amazonses.com`);
    } else {
      warn(
        `apex SPF exists but does NOT include amazonses.com — must be merged manually, not duplicated: ${existing.content}`,
      );
    }
  }

  step(8, `DMARC (_dmarc.${DOMAIN}) policy=${DMARC_POLICY}`);
  await upsert(zoneId, {
    name: `_dmarc.${DOMAIN}`,
    type: "TXT",
    content: `"v=DMARC1; p=${DMARC_POLICY}; rua=${DMARC_RUA}; pct=100; aspf=r; adkim=r"`,
  });

  step(9, `SES configuration set ${CONFIG_SET}`);
  try {
    await ses.send(
      new CreateConfigurationSetCommand({
        ConfigurationSetName: CONFIG_SET,
        DeliveryOptions: { TlsPolicy: "REQUIRE" },
        ReputationOptions: { ReputationMetricsEnabled: true },
        SendingOptions: { SendingEnabled: true },
      }),
    );
    ok(`created`);
  } catch (e) {
    if (e.name === "AlreadyExistsException") {
      info(`already exists`);
    } else {
      throw e;
    }
  }

  step(10, `Sandbox-exit / production-access`);
  const account = await ses.send(new GetAccountCommand({}));
  if (account.ProductionAccessEnabled) {
    ok(`already out of sandbox — production access enabled`);
  } else {
    info(`currently in sandbox`);
    try {
      await ses.send(
        new PutAccountDetailsCommand({
          MailType: "TRANSACTIONAL",
          WebsiteURL: `https://${DOMAIN}`,
          UseCaseDescription:
            "AcreOS is a multi-tenant SaaS for property investors. Transactional email types: account-verification, password-reset, two-factor-auth, AI-assistant (Pax) summaries, deal-pipeline notifications, payment receipts, account-activity digests. Recipients are users who have explicitly signed up to AcreOS and consented at account creation via clickwrap acceptance of our Terms of Service and Privacy Policy. We honor unsubscribe via RFC 8058 List-Unsubscribe headers with one-click tokenized URLs, maintain an org-scoped suppression list, enforce per-org daily send caps for IP warmup, have circuit-breaker + exponential-backoff retry logic to avoid bounces, and log every send to an auditable per-org event stream.",
          ContactLanguage: "EN",
          ProductionAccessEnabled: true,
        }),
      );
      ok(`production-access requested — AWS typically reviews within 24 hours`);
    } catch (e) {
      const msg = (e.message || "").toLowerCase();
      const name = (e.name || "").toLowerCase();
      // AWS returns ConflictException when a request is already pending — that's
      // a successful idempotent path, not an error. "Already" appears in some
      // variants. ValidationException can fire if details are partially set.
      if (name.includes("conflict") || msg.includes("already") || msg.includes("pending")) {
        info(`production access already requested or granted — submission is in AWS queue`);
      } else {
        throw e;
      }
    }
  }

  console.log(`\n══════════════════════════════════════════════════════════`);
  console.log(` Summary`);
  console.log(`══════════════════════════════════════════════════════════`);
  console.log(`  Domain identity:     ${DOMAIN}  (DKIM ${dkimStatus})`);
  console.log(`  MAIL FROM domain:    ${MAIL_FROM}  (status ${mailFromStatus})`);
  console.log(`  DKIM CNAMEs:         3 upserted`);
  console.log(`  MAIL FROM MX/SPF:    upserted`);
  console.log(`  Apex SPF:            ${spfRecords.length === 1 ? "exists" : spfRecords.length === 0 ? "added" : "multi-record warning"}`);
  console.log(`  DMARC policy:        ${DMARC_POLICY}`);
  console.log(`  Configuration set:   ${CONFIG_SET}`);
  console.log(`  Production access:   ${account.ProductionAccessEnabled ? "ENABLED" : "REQUESTED"}`);
  console.log(`══════════════════════════════════════════════════════════\n`);

  console.log(`Next steps:`);
  console.log(`  · DKIM verification typically completes within 5-15 minutes.`);
  console.log(`  · Re-run this script to see updated DKIM + MAIL FROM status.`);
  console.log(`  · Once DKIM goes to SUCCESS, the domain is fully verified.`);
  console.log(`  · AWS will email you about production-access approval (~24h).`);
  console.log(`  · After approval, the daily-send cap becomes 50,000/day initial.`);
  console.log(`  · DMARC starts at p=${DMARC_POLICY}; move to quarantine then reject after ~30 days of clean RUA reports.\n`);
}

run().catch((e) => fail(`${e.message}\n${e.stack || ""}`));
