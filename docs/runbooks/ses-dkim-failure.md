# SES DKIM verification failure (acreos.io)

**Symptom:** AWS Health email "Email DKIM setup FAILURE for <domain>" — SES
tried to detect the three DKIM CNAMEs for 72 hours and gave up. The identity's
DKIM status is now `FAILED`; outbound platform mail is unsigned or refused.

**In-platform signal:** the `platform_email_identity` detector (reliability
domain, daily `domain_audit` sweep) pages critical with the exact missing
CNAME records in the finding detail. If you got the AWS email but no page,
check that the domain-audit job is running (deadman / job roster).

## Diagnosis (from anywhere, no credentials needed)

The setup script writes SPF, DMARC, MAIL FROM MX/TXT, and 3 DKIM CNAMEs. Check
which subset is live:

```
dig TXT acreos.io                 # expect v=spf1 include:amazonses.com ~all
dig TXT _dmarc.acreos.io          # expect v=DMARC1; p=...
dig MX  mail.acreos.io            # expect feedback-smtp.us-east-1.amazonses.com
```

If those exist but AWS says DKIM failed, the three `<token>._domainkey`
CNAMEs are the missing piece. The tokens are per-identity — read them from
SES, not from old CSVs (tokens for a recreated identity differ).

## Fix — one command

```
fly ssh console -a acreos -C "node scripts/ses-setup.mjs"
```

The script is idempotent and, since 2026-07, handles the `FAILED` state:

1. Reads the live DKIM tokens from SES (`GetEmailIdentity`).
2. If DKIM status is `FAILED`/`TEMPORARY_FAILURE`, restarts Easy DKIM
   verification (`PutEmailIdentityDkimSigningAttributes`) — publishing the
   CNAMEs alone will NOT make SES re-check after a 72h failure.
3. Upserts the 3 CNAMEs (plus SPF/DMARC/MAIL FROM) into Cloudflare.
4. Prints current DKIM + MAIL FROM status.

Re-run the same command after ~15 minutes; expect `DKIM SUCCESS`. The
`platform_email_identity` finding stops firing on the next sweep and ages out.

## If the script fails

- **UnrecognizedClientException ("security token … invalid"):** the AWS
  access key in Fly secrets was deleted/deactivated in IAM. Mint a new key
  for the SES IAM user (AWS console → IAM → Users → Security credentials →
  Create access key), then
  `fly secrets set AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… -a acreos`
  (machines restart) and re-run.
- **Cloudflare zone not found / token error:** the Cloudflare API token on the
  Fly machine lacks `Zone:Read` + `DNS:Edit` on the domain. Fix the token in
  Fly secrets and re-run.
- **Expected 3 DKIM tokens, got N:** the SES identity is in a bad state —
  delete it in the SES console and re-run the script (it recreates the
  identity; tokens WILL change, and the script publishes the new ones).

## 2026-07-04 incident record (what actually happened)

Remote diagnosis via the `ses-dkim-fix.yml` workflow (Actions → flyctl ssh →
`scripts/ses-dkim-diagnose.mjs`) established:

1. The AWS access key on the machine is a well-formed permanent key
   (AKIA…, length 20, no session token, no whitespace) that AWS rejects —
   it was deleted or deactivated in IAM at some point.
2. Cloudflare DOES hold three SES DKIM CNAMEs (unproxied, correct form),
   but only ONE of the three amazonses token endpoints still serves a DKIM
   key. The identity was recreated at some point, rotating the tokens; two
   published CNAMEs are stale leftovers of the old generation, so SES
   could never see all three current records → 72h window expired → FAILED.
3. Because every ses-setup run since the key died aborts at the first SES
   call, nothing could self-heal. The fix chain is: new AWS key → re-run
   the workflow (it reads the CURRENT tokens, upserts the CNAMEs, restarts
   the FAILED verification). Stale `*._domainkey` CNAMEs whose amazonses
   target serves no TXT can be deleted in Cloudflare afterwards (cosmetic).
