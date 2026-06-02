# Cuthbert Wrenning — DNS & Edge Audit

**Auditor:** Cuthbert Wrenning, 53, ex-Cloudflare DNS infrastructure (8 yrs on the authoritative-resolver team, 4 yrs running edge-cert pipelines for Pro/Business plans).
**Wave:** 3 — DNS specialist lens.
**Date:** 2026-05-01.
**Subject:** AcreOS DNS architecture, custom-domain provisioning, ACME/Let's Encrypt cert lifecycle, failover, DNSSEC, and DNS-driven feature flags.

---

## TL;DR

AcreOS has a credible apex DNS posture (Cloudflare in front of Fly.io, Clerk on a CNAMEd auth subdomain) but the **white-label custom-domain pipeline is a half-built bridge**. The product *promises* per-tenant custom domains (`whiteLabelConfigs.customDomain`, `whitelabel_tenants.subdomain`), middleware exists to *resolve* those domains at the request edge, and routes exist to *store* them — but **nothing in the codebase issues, renews, or revokes a TLS certificate, validates DNS ownership, or talks to the Cloudflare API**. The first reseller who points `app.acquireland.com` at AcreOS will get a Fly TLS error and a confused founder. There are also **two parallel white-label schemas** (`whitelabel_tenants` and `white_label_configs`), two parallel middlewares (`customDomainRouter.ts` and `white-label-domain.ts`), and they cache to two different in-process maps. That is a foot-gun in production: a domain edited via one path will be stale in the other for 5 minutes.

Severity rollup:

- **P0** — No ACME/cert automation; no DNS verification before activating a tenant; duplicate tenant schemas.
- **P1** — Two domain-resolution middlewares that don't share cache; no Redis pub/sub eviction on tenant edits; no DNSSEC documentation; no failover region story.
- **P2** — TTLs not codified; no `_acme-challenge` provisioning helper; no docs for the customer-facing CNAME instructions.

---

## 1. Apex / platform DNS (the part that works)

The production stack — per `fly.toml` and project memory — is **Cloudflare → Fly.io (iad) → Express (port 5000)**, with `force_https = true` and `min_machines_running = 2`. Clerk auth runs on a proxied subdomain (per `project_infra.md`).

What's right:

- Two warm machines per `min_machines_running = 2`, so a single-host outage does not nuke DNS-resolvable traffic. Healthchecks at `/api/health/cached` every 30s with a 15s grace — sane.
- `X-Forwarded-Host` is read first in `customDomainRouter.extractDomain()` (file: `server/middleware/customDomainRouter.ts:154`). Correct: behind Cloudflare, the `Host` header is the Fly-internal one; `XFH` carries the customer's hostname.
- Port-stripping and lowercasing happen on both extraction paths. Good — DNS is case-insensitive, but JS `Map` keys are not.

What's missing or unclear:

- **Cloudflare zone strategy is not documented in-repo.** The user-memory says "Cloudflare DNS," but I could not find a `terraform/`, `cloudflare/`, or `infra/dns.tf` directory. DNS is being managed by hand in the Cloudflare dashboard. That is fine for one zone (`acreos.io`); it is **not fine** the day the first white-label reseller goes live and you need to provision a CNAME plus a `_acme-challenge` record under SLA.
- **No documented record TTLs.** For a CRM where Twilio webhooks, Stripe webhooks, and Clerk callbacks all hit your apex, the apex `A`/`AAAA`/`CNAME` records should be on **Cloudflare's "Auto" (300s effective) at minimum, and ideally proxied (orange-cloud) so Cloudflare answers with edge IPs** and you can re-point Fly without a TTL wait. Confirm in dashboard.
- **No DNSSEC.** I cannot verify from the repo whether DNSSEC is enabled on `acreos.io` at the registrar. For a fintech-adjacent platform that signs deeds and moves money, DNSSEC is table stakes — without it, a BGP hijack or rogue resolver can MITM a cert issuance. **Action:** enable DNSSEC in Cloudflare, copy DS records to the registrar, validate with `dig +dnssec acreos.io`.

---

## 2. Custom-domain provisioning — the bridge to nowhere

This is the highest-leverage finding in this audit.

### 2.1 What exists

- `shared/schema.ts` defines two tables:
  - `white_label_configs.customDomain` (text, nullable, no unique index visible)
  - `whitelabel_tenants.subdomain` (text, **unique**, NOT NULL) plus presumably a `customDomain` field referenced by `customDomainRouter`.
- `server/middleware/customDomainRouter.ts` — reads `whitelabelTenants.customDomain`, caches in local `Map` + optional Redis (`tenant:domain:` prefix, 300s TTL), 404 guard via `requireTenant`.
- `server/middleware/white-label-domain.ts` — reads `whiteLabelConfigs.customDomain` via `whiteLabelService.resolveFromDomain()`, caches in a *different* local `Map`, no Redis path, has a 2s timeout fallback.
- `server/routes-white-label.ts` — CRUD for tenant configs, accepts `customDomain` via `PATCH /config` with **no DNS verification, no ownership check, no certificate provisioning trigger**.

### 2.2 What is missing — the cert problem

When a reseller sets `customDomain = "app.acquireland.com"`:

1. They CNAME their hostname to `acreos.io` (or to a Fly app hostname).
2. The next request lands on Fly. **Fly does not have a cert for `app.acquireland.com`.** Fly's TLS handshake fails. Browser shows `NET::ERR_CERT_COMMON_NAME_INVALID`.
3. There is no code anywhere in `/server` that calls `flyctl certs create` (or the Fly Machines API equivalent), no ACME client, no Cloudflare for SaaS / Custom Hostname API call, nothing.

You have **three** viable architectures; pick one and codify it:

| Option | How it works | Cost / complexity | When to pick |
|---|---|---|---|
| **A. Cloudflare for SaaS (Custom Hostnames)** | Reseller CNAMEs to `*.acreos.io`. Cloudflare issues + renews edge certs automatically via their API. AcreOS calls `POST /zones/:zone/custom_hostnames` on tenant create. | $0.10/active hostname/mo; ~50 lines of code. | **Default recommendation.** Best ergonomics, hands-off renewal, edge-terminated. |
| **B. Fly Certificates API** | On tenant create, call `flyctl certs create app.acquireland.com`. Fly handles ACME. Customer adds `_acme-challenge.app` TXT or CNAME-validates. | $0/cert; ~80 lines + a verification poll job. | If you want zero CDN dep. Worse cache/WAF story. |
| **C. Self-host an ACME client (caddy / lego / acme.sh)** | Run your own DNS-01 or HTTP-01 issuer. Store certs in S3 / DB. | Highest complexity. | Only if regulatory / sovereignty requires. **Not recommended.** |

### 2.3 DNS verification before activation

`whitelabel_tenants.status` flips to `"active"` with no proof the customer actually pointed DNS at you. That means a typo'd CNAME → tenant looks active in the dashboard → support fire. Add a **pre-activation verification step**:

```
1. Generate verification token (32-byte random hex).
2. Tell customer: "Add TXT _acreos-verify.<your-domain> = <token>"
3. Poll DNS (using a public resolver like 1.1.1.1, NOT the local stub —
   stale resolver cache is the #1 false-negative cause) for up to 30 min.
4. On match: status → "active", trigger cert provisioning.
5. On timeout: status → "verification_failed", surface in UI.
```

Use Node's `dns/promises` with `setServers(['1.1.1.1','8.8.8.8'])` to avoid resolver pollution.

---

## 3. The duplicate-schema problem

`whitelabel_tenants` and `white_label_configs` both exist (`shared/schema.ts`). Two middlewares each read one. Two services. **One of them must die.** Recommended consolidation:

- Keep `whitelabel_tenants` (snake-case-consistent, has the `subdomain` unique constraint, has metering FK relationships).
- Migrate `white_label_configs.customDomain`, `brandName`, `logoUrl`, `primaryColor`, `features`, `revenueShare`, `limits`, `plan`, `status` into `whitelabel_tenants`.
- Delete `whiteLabelService.ts` or fold it into a single service that the consolidated `customDomainRouter` reads.
- Add a unique index on `whitelabel_tenants.custom_domain` (currently I see uniqueness only on `subdomain`). A duplicate `customDomain` row will silently win whichever the DB returns first.

---

## 4. Cache coherence — the 5-minute stale window

Both middlewares cache for 300s. `customDomainRouter` has a Redis layer; `white-label-domain` does not. There is **no eviction on `PATCH /white-label/config`**. So:

- Reseller updates `customDomain` from `old.com` to `new.com`.
- For 5 minutes, requests to `old.com` still resolve to their tenant (because cached) and `new.com` 404s (because not yet looked up — actually, this would be a cache miss and lookup, so `new.com` works, but `old.com` is the leak).

Fix:

```ts
// On any white-label mutation:
await evictTenantCache(oldDomain);
await evictTenantCache(newDomain);
// Plus Redis pub/sub fan-out for multi-instance:
await redis.publish('tenant:evict', JSON.stringify({domains:[oldDomain,newDomain]}));
```

And subscribe at startup in `customDomainRouter` so all 2+ Fly machines drop the local-cache entry.

---

## 5. Failover & low-TTL records

`fly.toml` runs only in `iad`. Single region. For a platform that signs deeds and processes payments, this is a **business-continuity gap**, but it's specifically a DNS gap because:

- No `ord` / `sjc` secondary documented.
- No Cloudflare Load Balancer with health-checked origins.
- Apex TTL (assume 300s default) means a Fly-iad outage causes ~5 min of customer-visible downtime even if you flip DNS manually.

For Wave-3 minimum: enable a **Cloudflare Load Balancer** with two Fly origins (`iad` + one secondary), 30s health checks, **TTL 60s on the LB record**, geo-steering off (it's a CRM, not a CDN). $5/mo per LB. The DNS-failover story alone justifies it.

---

## 6. DNSSEC, CAA, MTA-STS, the boring-but-mandatory list

In Cloudflare dashboard, verify and document:

- **DNSSEC:** Enabled. DS record at registrar. `dig +dnssec acreos.io SOA` returns `ad` flag.
- **CAA records:** `acreos.io. CAA 0 issue "letsencrypt.org"` and `... "pki.goog"` (Cloudflare uses Google Trust Services for Universal SSL, Let's Encrypt for Custom Hostnames). Without CAA, **any public CA** can issue for your domain.
- **MTA-STS / TLS-RPT:** If you send email via Sendgrid/Postmark on `mail.acreos.io`, publish `_mta-sts.acreos.io` TXT and `mta-sts.acreos.io/.well-known/mta-sts.txt` to enforce TLS for inbound mail. Phishing protection.
- **DMARC / SPF / DKIM:** Out of my lane (Diallo's), but DNS-published — make sure the white-label flow doesn't break tenant SPF when they send from `mail.<their-domain>`.

---

## 7. DNS-driven feature flags — the unused leverage

AcreOS has `featureGate.ts` middleware. None of it is DNS-driven. For staged rollouts of risky features (the new e-sign stack, the Voice Pass), consider:

- TXT record `_acreos-flag.<feature>.acreos.io = "off"|"on"|"canary:0.1"`
- Read once per minute, cache in-process, override DB feature flag.
- Why DNS? Because it's **out of band** — if your DB is wedged, you can still kill a feature globally by editing one TXT record from your phone. Cloudflare API lets you do it from a script in 2 lines.

This is a Wave-4 nice-to-have, not P0. But it's the kind of operational lever a 53-year-old DNS guy reaches for during a 3am incident.

---

## 8. Action list (priority-ordered)

1. **[P0] Pick a custom-domain cert architecture** (recommend Cloudflare for SaaS) and implement. Until done, **disable the `customDomain` field in the white-label UI** — it currently misleads resellers.
2. **[P0] Add DNS pre-verification flow** (`_acreos-verify` TXT, polling resolver, status state machine).
3. **[P0] Consolidate `whitelabel_tenants` and `white_label_configs`** to one table; one middleware; one service. Add unique index on `custom_domain`.
4. **[P1] Cache eviction on tenant mutation**, plus Redis pub/sub fan-out across Fly machines.
5. **[P1] Multi-region Fly + Cloudflare Load Balancer**, TTL 60s on the LB record.
6. **[P1] Enable DNSSEC** at registrar, add **CAA** records pinning issuers.
7. **[P2] Document DNS runbook in `/docs/infra/dns.md`** — zones, records, TTLs, who-can-edit, rotation procedure for Cloudflare API token used by tenant provisioning.
8. **[P2] Codify Cloudflare zone via Terraform** (`infra/cloudflare.tf`) so the next ops hire isn't reading my mind from dashboard click-trails.
9. **[P3] DNS-backed kill switches** for risky features.

---

## 9. Files reviewed

- `/Users/user/AcreOS/AcreOS/fly.toml`
- `/Users/user/AcreOS/AcreOS/server/middleware/customDomainRouter.ts`
- `/Users/user/AcreOS/AcreOS/server/middleware/white-label-domain.ts`
- `/Users/user/AcreOS/AcreOS/server/services/whiteLabelService.ts`
- `/Users/user/AcreOS/AcreOS/server/routes-white-label.ts`
- `/Users/user/AcreOS/AcreOS/shared/schema.ts` (whitelabel sections)

## 10. Files I expected to find and didn't

- `infra/cloudflare.tf` or `terraform/dns/`
- `server/services/certificateProvisioning.ts`
- `server/services/dnsVerification.ts`
- `server/jobs/certRenewalCheck.ts`
- `docs/infra/dns.md`
- Any reference to `cloudflare.com/api`, `acme`, `lego`, or `node-acme-client` in `package.json`

Their absence is the audit.

— **Cuthbert Wrenning**
