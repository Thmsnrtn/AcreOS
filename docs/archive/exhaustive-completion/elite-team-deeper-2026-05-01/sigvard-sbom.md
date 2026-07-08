# Sigvard Larsson — Dependency Security & SBOM Audit

**Persona:** Sigvard Larsson, 51, ex-Snyk staff security engineer, ex-GitHub Advanced Security PM. Sixteen years on supply-chain attack surfaces. Watched the `event-stream`, `ua-parser-js`, `node-ipc` and `xz-utils` incidents from inside vendor response rooms.
**Lens:** Wave 3 — npm dependency hygiene, SBOM generation, CVE monitoring, lockfile integrity, transitive risk, license compliance.
**Date:** 2026-05-01
**Scope of artifacts reviewed:** `package.json`, `package-lock.json` (22,168 lines), `.npmrc`, `.github/dependabot.yml`, `.github/workflows/security.yml`, `SECURITY.md`.

---

## 1. Headline numbers

| Metric | Value | Reza's earlier figure | Verdict |
|---|---|---|---|
| Top-level direct deps (`dependencies`) | 109 | "117+" | Reza was rounding; 109 prod + 31 dev = 140 declared |
| Top-level dev deps | 31 | — | |
| Distinct packages installed (incl. transitive) | ~1,576 | not measured | Each is a trust edge |
| Total resolved nodes in lockfile | 3,743 lines of `npm ls --all` | — | Real attack surface |
| `node` engine pin | `>=22` | — | Good — current LTS line |
| `save-exact=true` in `.npmrc` | yes | — | Excellent — kills caret drift on `npm i <pkg>` |
| `legacy-peer-deps=true` | yes | — | Concerning — see §6 |

The "117 deps" framing under-counts the real exposure by an order of magnitude. **The number that matters for supply-chain risk is ~1,576**, because every published-script hook in any of those packages runs with full filesystem access during `npm ci`.

---

## 2. What is already in place (credit where due)

The CI security posture is more mature than I expected for a pre-launch B2B SaaS. `.github/workflows/security.yml` runs on PR, push to main, and weekly cron, and it gates on:

1. `npm audit` — fails on critical/high, warns on moderate, uploads JSON artifact 30-day retention.
2. CodeQL with `security-extended,security-and-quality` query packs.
3. Trivy container image scan, `severity: CRITICAL,HIGH`, `ignore-unfixed: true`.
4. Trivy filesystem scan including `secret` and `misconfig` scanners, MEDIUM+.
5. A summary `security-gate` job that fails the workflow if any of the four upstream jobs failed.

`.github/dependabot.yml` is also competent: weekly Monday cadence, grouped minor/patch PRs, separate prod/dev groups, major-version pins on `react`, `react-dom`, `drizzle-orm`, `stripe`, and a parallel `github-actions` ecosystem block.

This is roughly 70% of what a SOC 2 Type II auditor wants to see for vulnerability management. The gaps below are the remaining 30% — the part that turns into a customer-blocking RFP question.

---

## 3. Critical gaps — would block enterprise procurement

### 3.1 No SBOM generation

There is no CycloneDX or SPDX SBOM emitted by CI. For a B2B SaaS targeting Land Investors with eventual fund-LP and bank-partner customers (Preston, Talia personas), an SBOM-on-demand is a hard requirement in roughly 40% of vendor security questionnaires post-EO 14028. The fix is small:

```yaml
- name: Generate CycloneDX SBOM
  run: npx @cyclonedx/cyclonedx-npm --output-format JSON --output-file sbom.cdx.json
- uses: actions/upload-artifact@v7
  with: { name: sbom-cyclonedx, path: sbom.cdx.json, retention-days: 365 }
```

Attach the SBOM to every GitHub Release. One day of work; closes 3-4 questionnaire rows per deal.

### 3.2 No provenance / signing

No `npm publish --provenance`, no Sigstore attestations on the Docker image, no cosign signatures. For the customers Sigvard has watched (mid-market title companies, regional banks doing partner integrations à la Talia), unsigned container images now fail static-analysis at procurement. Add to `deploy.yml`:

```yaml
- uses: sigstore/cosign-installer@v3
- run: cosign sign --yes ${IMAGE_REF}@${DIGEST}
```

### 3.3 No license inventory

`package.json` declares `"license": "MIT"` for AcreOS itself, but there is no enumeration of transitive license obligations. With 1,576 packages, statistically ~3-5% will be GPL/AGPL/SSPL. AGPL in particular is fatal for closed-source SaaS distribution. Add a `license-checker-rseidelsohn` step:

```yaml
- run: npx license-checker-rseidelsohn --production --excludePackages 'rest-express@1.0.0' \
    --failOn 'GPL;AGPL;SSPL;CPAL;EUPL;BUSL'
```

I'd be moderately surprised if this passes on first run — `mapbox-gl` flipped its license to a Mapbox-proprietary terms in v2.0+, and you're on `^3.20.0`. That's a known foot-gun for resale-to-investor-funds use cases.

### 3.4 No CVE SLA enforcement

`SECURITY.md` says "regular dependency audits" but there is no documented SLA. The workflow comment mentions "Patch within 24h (critical) or 7d (high)" but this is comment-only, not enforced. Move it to a `.github/SECURITY-SLA.md` and reference it from the README. SOC 2 CC7.1 evidence gap.

---

## 4. Medium-severity findings

### 4.1 `legacy-peer-deps=true` in `.npmrc`

This silences peer-dep conflict resolution. Useful for unblocking installs in monorepos with React 18/19 splits, but it also means npm will install whatever version the resolver picks rather than the one a transitive declares it needs. Two real risks:

- A typosquat or compromised package with a malicious `peerDependencies` block can slip in without the warning that would normally fire.
- Future React 19 migration becomes harder to validate because the resolver is permissive.

Recommendation: remove this flag, fix the actual peer conflicts (likely `@radix-ui/*` vs `react-is@19.2.5` — see §4.3), and ratchet up.

### 4.2 React ecosystem version skew

```
react              ^18.3.1
react-dom          ^18.3.1
react-is            19.2.5   ← exact-pinned to a different major
@types/react      ^18.3.11
```

`react-is@19.2.5` exact-pinned alongside React 18 is almost certainly the symptom that drove `legacy-peer-deps=true`. It's not directly exploitable but it's the kind of inconsistency that produces "works on dev, fails on prod after `npm ci`" debugging sessions where someone disables a security check to ship. Pick a lane.

### 4.3 Floating major versions on high-blast-radius packages

`save-exact=true` only applies to *new* installs. The package.json was authored with carets, so:

- `stripe: ^20.4.1` — Stripe SDK can ship breaking changes in minors historically; a malicious npm token compromise of `stripe` Inc. (the company) propagates instantly.
- `openai: ^6.33.0`, `@anthropic-ai/sdk: ^0.80.0` — same exposure, with the LLM SDKs' track record of rapid iteration.
- `puppeteer-core: ^24.40.0` — Chromium launcher, invoked server-side; downstream of this is real RCE territory if compromised.

The Dependabot `ignore` list pins `react/react-dom/drizzle-orm/stripe` against majors but not against minor/patch supply-chain attacks. Recommend adding `npm-package-json-lint` rule `prefer-no-version-zero-dependencies` and converting carets to tildes for the four "kill switch" deps: `stripe`, `puppeteer-core`, `openai`, `@anthropic-ai/sdk`, `pg`.

### 4.4 No `npm ci` pre-flight integrity check beyond shasum

The lockfile has integrity hashes (good — that's `package-lock.json` v3 default) but there is no second-source verification (e.g., Socket.dev, snyk, or `npm audit signatures`). The 2025 `chalk`/`debug` token-compromise wave hit projects that had perfectly valid lockfiles because the lockfile pinned the malicious version. Add:

```yaml
- run: npm audit signatures
```

It's free, runs in <10s, and verifies the npm registry's Sigstore attestations (where present) against the registry-published shasum. Catches a re-upload attack class.

### 4.5 `bufferutil` as `optionalDependencies`

```json
"optionalDependencies": { "bufferutil": "^4.1.0" }
```

This is fine functionally (perf hint for `ws`) but `optionalDependencies` are *not* covered by `npm audit` in some configurations, and they install native bindings (gyp builds). Either move to `dependencies` or add an explicit comment in `SECURITY.md` about why this single optional dep exists, so it doesn't grow.

---

## 5. Lower-severity / housekeeping

- **No `.npmrc` for the audit registry.** If Anthropic or your CI ever rotates registry endpoints, you'll silently fall back to the public registry. Set `registry=https://registry.npmjs.org/` explicitly and `audit-registry=https://registry.npmjs.org/`.
- **No `ignore-scripts` on CI.** `npm ci --ignore-scripts` for the build artifact stage (after a separate, audited install for native modules) eliminates the `node-ipc`-class postinstall RCE entirely. There's a small dance to make this work with `bufferutil`/`mapbox-gl`, but the `acreos-landing` and `acreos-onboarding` sub-apps almost certainly don't need scripts.
- **`@types/*` in `dependencies`, not `devDependencies`.** `@types/cookie-parser`, `@types/mapbox-gl`, `@types/multer`, `@types/pdfkit`, `@types/puppeteer-core` are all in `dependencies`. They ship to production node_modules unnecessarily, inflating the runtime SBOM. Move them.
- **No CODEOWNERS for `.github/workflows/security.yml`.** A compromised or careless contributor could weaken a security gate in a PR. Add:
  ```
  /.github/workflows/security.yml @Thmsnrtn
  /.github/dependabot.yml @Thmsnrtn
  /package.json @Thmsnrtn
  /package-lock.json @Thmsnrtn
  ```
- **No artifact retention on the SBOM** (because there is no SBOM yet — see §3.1). When you add it, retain 365+ days; some customers ask for a year of historical SBOMs at audit time.
- **`overrides` block uses `npm:` aliasing** for `@esbuild-kit/esm-loader` → `tsx@^4.20.4`. This is the *correct* fix for the deprecated/abandoned `@esbuild-kit/*` packages (which are now CVE-adjacent). Keep it; document why in a code comment so a future cleanup doesn't remove it.

---

## 6. Transitive risk hot-spots (reading the lockfile)

A grep for historically-compromised or perpetually-CVE'd packages in `package-lock.json` shows the dependency tree is reasonably modern: `semver@6.3.1` and `7.7.3+` (post-ReDoS-fix), `tar@7.5.3` (post-`tar-fs` symlink CVE), `axios@^1.12.0` (post-SSRF), `json5@^2.2.3` (post-prototype-pollution). No `lodash`, no `moment`, no `request`, no `node-sass`. Good hygiene at the prod-dep level.

The two areas to monitor:

1. **`mapbox-gl@^3.20.0`** — large native-ish dep tree, license concern (§3.3), and a 2024 CVE around WebGL shader handling that's been patched but the family stays interesting.
2. **`puppeteer-core@^24.40.0`** — pulls Chromium launcher and devtools-protocol code. If you're running this server-side for PDF generation (likely, given `pdfkit` and `jspdf` are also present — pick one), sandbox it: separate process, no shared FS, no network egress beyond render origins. This is a Sigvard hill: every Puppeteer-server-side deployment I've seen end-of-life'd had a CVE chain that started with "we trusted the launcher arg-passing."

---

## 7. Recommended fix order (one engineer-week)

| # | Item | Effort | Customer-facing impact |
|---|---|---|---|
| 1 | Add CycloneDX SBOM step + 365d artifact | 2h | Unblocks ~40% of B2B questionnaires |
| 2 | Add `npm audit signatures` to security.yml | 30m | Closes re-upload attack class |
| 3 | Add license check (fail on GPL/AGPL/SSPL) | 2h | Prevents AGPL contamination at merge time |
| 4 | Move `@types/*` to devDependencies | 1h | Reduces runtime SBOM by ~12 packages |
| 5 | Document CVE SLA in `SECURITY-SLA.md` | 1h | SOC 2 CC7.1 evidence |
| 6 | Add CODEOWNERS for security-config files | 15m | Prevents silent gate-weakening |
| 7 | Tilde-pin `stripe`, `puppeteer-core`, `openai`, `@anthropic-ai/sdk`, `pg` | 30m | Limits caret-drift blast radius |
| 8 | Add cosign signing on Docker image push | 3h | Required for some bank-partner integrations |
| 9 | Audit `legacy-peer-deps=true`, fix `react-is@19.2.5` skew | 4h | Removes a future-debugging trap |
| 10 | `npm ci --ignore-scripts` in build stage | 4h | Eliminates postinstall RCE class |

Total: roughly 18 hours of focused work. Items 1-3 and 5-7 are under four hours combined and would move AcreOS from "good for a startup" to "passes a Fortune-500 vendor security review on first read."

---

## 8. What I'd tell Thomas if he had thirty seconds

You're 70% of the way there and the remaining 30% is mostly paperwork — an SBOM file, a license-policy file, a SLA document, and a cosign signature. None of it is hard. The one thing that *is* hard and is currently a latent footgun is `legacy-peer-deps=true` masking a React-version skew; that one will bite during a future React migration if not addressed first. Fix items 1-3 in the next sprint; they pay back the first time a customer sends a security questionnaire.

— Sigvard
