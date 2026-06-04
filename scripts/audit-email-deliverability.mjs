#!/usr/bin/env node
/**
 * audit-email-deliverability.mjs — phase D3.
 *
 * Self-contained Node ESM audit. No npm install: uses node:dns and
 * node:fs/promises only. Resolves SPF / DKIM / DMARC / MX for a domain,
 * reviews the welcome-email content in server/services/emailService.ts,
 * and writes a dated markdown report to docs/internal/.
 *
 * Exit codes:
 *   0 — clean
 *   1 — warnings
 *   2 — critical findings
 *
 * Usage:
 *   node scripts/audit-email-deliverability.mjs --help
 *   node scripts/audit-email-deliverability.mjs audit --domain=acreos.io
 *   node scripts/audit-email-deliverability.mjs audit --domain=acreos.io --out=/tmp/report.md
 *
 * The script intentionally reimplements the SPF / DMARC parsing rather than
 * importing the .ts library, so it can run without a TS toolchain. The two
 * surfaces are kept aligned by shared unit tests on the library version.
 */

import { promises as dns } from "node:dns";
import { promises as fs } from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { _: [] };
  for (const raw of argv) {
    if (raw.startsWith("--")) {
      const eq = raw.indexOf("=");
      if (eq > 0) args[raw.slice(2, eq)] = raw.slice(eq + 1);
      else args[raw.slice(2)] = true;
    } else {
      args._.push(raw);
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(`audit-email-deliverability — DNS SPF/DKIM/DMARC/MX + welcome-email content review

USAGE
  node scripts/audit-email-deliverability.mjs --help
  node scripts/audit-email-deliverability.mjs audit --domain=<domain> [--out=<path>] [--selectors=0,1,2]

OPTIONS
  --domain=<domain>       Domain to audit (required for the 'audit' subcommand).
  --out=<path>            Path to write the markdown report. Default: docs/internal/email-deliverability-report-<date>.md
  --selectors=a,b,c       DKIM selector prefixes (each becomes <prefix>._domainkey.<domain>). Default: 0,1,2.
  --skip-content          Skip the welcome-email content review.

EXIT CODES
  0  clean
  1  warnings
  2  critical findings

Pairs with server/services/email/deliverabilityCheck.ts (the in-process variant).
`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsers (mirror server/services/email/deliverabilityCheck.ts)
// ─────────────────────────────────────────────────────────────────────────────

function parseSpf(raw) {
  const trimmed = raw.trim();
  const tokens = trimmed.split(/\s+/);
  const mechanisms = [];
  let allPolicy = null;

  const versionCount = tokens.filter((t) => t.toLowerCase() === "v=spf1").length;
  if (versionCount > 1) {
    return { raw: trimmed, mechanisms: [], allPolicy: null, malformed: true };
  }

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === "v=spf1") continue;
    if (lower === "+all" || lower === "~all" || lower === "-all" || lower === "?all") {
      allPolicy = lower;
      continue;
    }
    if (token.length > 0) mechanisms.push(token);
  }
  return { raw: trimmed, mechanisms, allPolicy, malformed: false };
}

function parseDmarc(raw) {
  const trimmed = raw.trim();
  const tags = new Map();
  for (const part of trimmed.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    tags.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim());
  }
  const rawPolicy = tags.get("p");
  const policy = ["none", "quarantine", "reject"].includes(rawPolicy) ? rawPolicy : null;
  const rawPct = tags.get("pct");
  let percent = 100;
  if (rawPct !== undefined) {
    const n = Number.parseInt(rawPct, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 100) percent = n;
  }
  const rua = (tags.get("rua") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ruf = (tags.get("ruf") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return { raw: trimmed, policy, percent, rua, ruf };
}

// ─────────────────────────────────────────────────────────────────────────────
// DNS resolution
// ─────────────────────────────────────────────────────────────────────────────

async function resolveTxtSafe(hostname) {
  try {
    const chunks = await dns.resolveTxt(hostname);
    return chunks.map((parts) => parts.join(""));
  } catch (err) {
    if (err?.code === "ENOTFOUND" || err?.code === "ENODATA") return [];
    throw err;
  }
}

async function resolveMxSafe(hostname) {
  try {
    return await dns.resolveMx(hostname);
  } catch (err) {
    if (err?.code === "ENOTFOUND" || err?.code === "ENODATA") return [];
    throw err;
  }
}

async function auditDns(domain, selectors) {
  // SPF
  const spfIssues = [];
  let spfRecord = null;
  let spfFound = false;
  try {
    const txt = await resolveTxtSafe(domain);
    const matches = txt.filter((r) => /^\s*v=spf1\b/i.test(r));
    if (matches.length === 0) {
      spfIssues.push("No v=spf1 TXT record at apex.");
    } else if (matches.length > 1) {
      spfIssues.push(
        `Multiple SPF records (${matches.length}) — RFC 7208 §3.2 violation; receivers will treat as permerror.`,
      );
      spfFound = true;
      spfRecord = parseSpf(matches[0]);
    } else {
      spfFound = true;
      spfRecord = parseSpf(matches[0]);
      if (spfRecord.malformed) spfIssues.push("SPF record has duplicate v=spf1 markers.");
      if (spfRecord.allPolicy === null) spfIssues.push("SPF record has no all-mechanism.");
      else if (spfRecord.allPolicy === "+all") spfIssues.push("SPF policy is `+all` — open relay.");
      else if (spfRecord.allPolicy === "?all") spfIssues.push("SPF policy is `?all` — neutral.");
    }
  } catch (err) {
    spfIssues.push(`SPF lookup failed: ${err.message}`);
  }

  // DKIM
  const dkimFound = [];
  const dkimIssues = [];
  for (const selector of selectors) {
    const hostname = `${selector}.${domain}`;
    try {
      const txt = await resolveTxtSafe(hostname);
      const record = txt.find((r) => /v=DKIM1/i.test(r)) ?? null;
      const valid = record !== null && /p=[A-Za-z0-9+/=]+/i.test(record);
      dkimFound.push({ selector, record, valid });
      if (!valid) dkimIssues.push(`Selector ${selector} missing or malformed.`);
    } catch (err) {
      dkimFound.push({ selector, record: null, valid: false });
      dkimIssues.push(`Selector ${selector} lookup failed: ${err.message}`);
    }
  }

  // DMARC
  let dmarcFound = false;
  let dmarcRecord = null;
  const dmarcIssues = [];
  try {
    const txt = await resolveTxtSafe(`_dmarc.${domain}`);
    const match = txt.find((r) => /^\s*v=DMARC1\b/i.test(r));
    if (!match) dmarcIssues.push("No DMARC record. Critical for protecting the domain from spoofing.");
    else {
      dmarcFound = true;
      dmarcRecord = parseDmarc(match);
      if (dmarcRecord.policy === null) dmarcIssues.push("DMARC missing p= tag.");
      else if (dmarcRecord.policy === "none")
        dmarcIssues.push(
          "DMARC `p=none` (monitor-only). Upgrade to quarantine after 30 days of clean aggregate reports.",
        );
      if (dmarcRecord.rua.length === 0) dmarcIssues.push("No `rua=` reporting address.");
    }
  } catch (err) {
    dmarcIssues.push(`DMARC lookup failed: ${err.message}`);
  }

  // MX
  const mxRecords = [];
  const mxIssues = [];
  try {
    const records = await resolveMxSafe(domain);
    for (const r of records) mxRecords.push(`${r.priority} ${r.exchange}`);
    if (mxRecords.length === 0) mxIssues.push("No MX records — inbound mail cannot be received.");
  } catch (err) {
    mxIssues.push(`MX lookup failed: ${err.message}`);
  }

  return {
    spf: { found: spfFound, record: spfRecord, issues: spfIssues },
    dkim: { selectorsChecked: selectors, selectorsFound: dkimFound, issues: dkimIssues },
    dmarc: { found: dmarcFound, record: dmarcRecord, issues: dmarcIssues },
    mx: { records: mxRecords, issues: mxIssues },
  };
}

function scoreSeverity(dns) {
  if (!dns.spf.found || dns.spf.record === null) return "critical";
  if (dns.spf.record.allPolicy === null) return "critical";
  const valid = dns.dkim.selectorsFound.filter((s) => s.valid).length;
  if (valid === 0) return "critical";
  const partial = valid < dns.dkim.selectorsChecked.length;
  if (partial || dns.mx.issues.length > 0) return "warning";
  if (!dns.dmarc.found || dns.dmarc.record === null) return "informational";
  if (dns.dmarc.record.policy === null) return "warning";
  if (dns.dmarc.record.policy === "none") return "informational";
  if (dns.dmarc.record.rua.length === 0) return "informational";
  return "clean";
}

// ─────────────────────────────────────────────────────────────────────────────
// Welcome-email content review
// ─────────────────────────────────────────────────────────────────────────────

const SPAM_TRIGGERS = ["free", "urgent", "act now", "guaranteed", "winner", "$$$", "click here", "limited time"];

function reviewWelcomeContent(subject, html) {
  const linkCount = (html.match(/<a\b[^>]*href=/gi) ?? []).length;
  const imageCount = (html.match(/<img\b/gi) ?? []).length;
  const textOnly = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const textLength = textOnly.length;
  const imageToTextRatio = textLength === 0 ? Infinity : imageCount / Math.max(1, Math.floor(textLength / 200));
  const haystack = `${subject} ${textOnly}`.toLowerCase();
  const spamTriggerWords = SPAM_TRIGGERS.filter((w) => haystack.includes(w));
  const unsubscribePresent = /unsubscribe/i.test(html);
  const physicalAddressLikelyPresent =
    /\b\d{1,6}\s+\w+\s+(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|pl|place|ct|court)\b/i.test(
      textOnly,
    ) || /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(textOnly);

  const issues = [];
  if (linkCount > 10) issues.push(`Link count ${linkCount} exceeds the 10-link spam-filter threshold.`);
  if (imageToTextRatio > 1) issues.push("Image-to-text ratio looks heavy.");
  if (spamTriggerWords.length > 0) issues.push(`Spam-trigger words present: ${spamTriggerWords.join(", ")}.`);
  if (!unsubscribePresent) issues.push("No unsubscribe link — CAN-SPAM §5 violation.");
  if (!physicalAddressLikelyPresent)
    issues.push("No physical mailing address detected — CAN-SPAM §5 violation.");

  return {
    linkCount,
    imageCount,
    textLength,
    imageToTextRatio,
    spamTriggerWords,
    unsubscribePresent,
    physicalAddressLikelyPresent,
    issues,
  };
}

async function locateAndReviewWelcomeEmail(projectRoot) {
  const emailServicePath = path.join(projectRoot, "server", "services", "emailService.ts");
  try {
    const source = await fs.readFile(emailServicePath, "utf8");
    // Find the welcome template block. We look for the literal subject and
    // the buildWelcomeTemplate function body.
    const subjectMatch = source.match(/welcome:\s*\{\s*subject:\s*['"]([^'"]+)['"]/);
    const subject = subjectMatch ? subjectMatch[1] : "Welcome to AcreOS";
    const bodyMatch = source.match(/buildWelcomeTemplate\s*\([^)]*\)\s*:\s*string\s*\{\s*return\s*`([\s\S]*?)`;\s*\}/);
    if (!bodyMatch) {
      return {
        path: emailServicePath,
        subject,
        review: null,
        error: "Could not locate buildWelcomeTemplate body for analysis.",
      };
    }
    return {
      path: emailServicePath,
      subject,
      review: reviewWelcomeContent(subject, bodyMatch[1]),
      error: null,
    };
  } catch (err) {
    return { path: emailServicePath, subject: null, review: null, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Report rendering
// ─────────────────────────────────────────────────────────────────────────────

function statusBadge(severity) {
  if (severity === "clean") return "✅";
  if (severity === "informational") return "ℹ️";
  if (severity === "warning") return "⚠️";
  return "❌";
}

function spfStatus(dns) {
  if (!dns.spf.found || dns.spf.record === null) return { badge: "❌", line: "No SPF record published." };
  if (dns.spf.record.allPolicy === null) return { badge: "❌", line: "SPF record missing all-mechanism." };
  if (dns.spf.record.allPolicy === "+all" || dns.spf.record.allPolicy === "?all") {
    return { badge: "⚠️", line: `SPF policy ${dns.spf.record.allPolicy} gives little protection.` };
  }
  return { badge: "✅", line: `SPF published, policy ${dns.spf.record.allPolicy}.` };
}

function dkimStatus(dns) {
  const valid = dns.dkim.selectorsFound.filter((s) => s.valid).length;
  const total = dns.dkim.selectorsChecked.length;
  if (valid === 0) return { badge: "❌", line: `All ${total} DKIM selectors missing or malformed.` };
  if (valid < total) return { badge: "⚠️", line: `${valid}/${total} DKIM selectors valid.` };
  return { badge: "✅", line: `All ${total} DKIM selectors valid.` };
}

function dmarcStatus(dns) {
  if (!dns.dmarc.found || dns.dmarc.record === null) return { badge: "ℹ️", line: "No DMARC record." };
  if (dns.dmarc.record.policy === null) return { badge: "⚠️", line: "DMARC record malformed (no p=)." };
  if (dns.dmarc.record.policy === "none")
    return { badge: "ℹ️", line: `DMARC p=none (monitor-only). pct=${dns.dmarc.record.percent}.` };
  if (dns.dmarc.record.rua.length === 0)
    return { badge: "ℹ️", line: `DMARC p=${dns.dmarc.record.policy} but no rua=.` };
  return { badge: "✅", line: `DMARC p=${dns.dmarc.record.policy}, rua published.` };
}

function mxStatus(dns) {
  if (dns.mx.records.length === 0) return { badge: "⚠️", line: "No MX records." };
  return { badge: "✅", line: `${dns.mx.records.length} MX record(s) published.` };
}

function contentStatus(contentResult) {
  if (!contentResult || contentResult.review === null) {
    return { badge: "ℹ️", line: contentResult?.error ?? "Welcome-email content review skipped." };
  }
  const issues = contentResult.review.issues;
  if (issues.length === 0) return { badge: "✅", line: "Welcome-email content checks pass." };
  const blocking = issues.some((i) => i.includes("CAN-SPAM"));
  return { badge: blocking ? "❌" : "⚠️", line: `${issues.length} content finding(s).` };
}

function renderReport({ domain, dns, severity, content, checkedAt }) {
  const spfS = spfStatus(dns);
  const dkimS = dkimStatus(dns);
  const dmarcS = dmarcStatus(dns);
  const mxS = mxStatus(dns);
  const contentS = contentStatus(content);

  const findings = [
    ...dns.spf.issues.map((i) => `[SPF] ${i}`),
    ...dns.dkim.issues.map((i) => `[DKIM] ${i}`),
    ...dns.dmarc.issues.map((i) => `[DMARC] ${i}`),
    ...dns.mx.issues.map((i) => `[MX] ${i}`),
    ...(content?.review?.issues?.map((i) => `[Content] ${i}`) ?? []),
  ];

  const day = checkedAt.toISOString().slice(0, 10);

  return `# Email deliverability audit — ${day}

Domain: \`${domain}\`
Audit run: ${checkedAt.toISOString()}
Overall severity: **${statusBadge(severity)} ${severity}**

## Summary
- SPF: ${spfS.badge} ${spfS.line}
- DKIM: ${dkimS.badge} ${dkimS.line}
- DMARC: ${dmarcS.badge} ${dmarcS.line}
- MX: ${mxS.badge} ${mxS.line}
- Welcome-email content: ${contentS.badge} ${contentS.line}

## SPF detail
${
  dns.spf.record
    ? `\`\`\`\n${dns.spf.record.raw}\n\`\`\`\n- All-policy: \`${dns.spf.record.allPolicy ?? "(none)"}\`\n- Mechanisms: ${dns.spf.record.mechanisms.length === 0 ? "_(none)_" : dns.spf.record.mechanisms.map((m) => `\`${m}\``).join(", ")}`
    : "_No record published._"
}
${dns.spf.issues.length === 0 ? "" : `\nIssues:\n${dns.spf.issues.map((i) => `- ${i}`).join("\n")}`}

## DKIM detail
${dns.dkim.selectorsFound
  .map((s) => `- \`${s.selector}\` — ${s.valid ? "✅ valid" : "❌ missing/malformed"}${s.record ? `\n  \`\`\`\n  ${s.record}\n  \`\`\`` : ""}`)
  .join("\n")}
${dns.dkim.issues.length === 0 ? "" : `\nIssues:\n${dns.dkim.issues.map((i) => `- ${i}`).join("\n")}`}

## DMARC detail
${
  dns.dmarc.record
    ? `\`\`\`\n${dns.dmarc.record.raw}\n\`\`\`\n- Policy: \`${dns.dmarc.record.policy ?? "(none)"}\`\n- pct: \`${dns.dmarc.record.percent}\`\n- rua: ${dns.dmarc.record.rua.length === 0 ? "_(none)_" : dns.dmarc.record.rua.map((r) => `\`${r}\``).join(", ")}\n- ruf: ${dns.dmarc.record.ruf.length === 0 ? "_(none)_" : dns.dmarc.record.ruf.map((r) => `\`${r}\``).join(", ")}`
    : "_No record published._"
}
${dns.dmarc.issues.length === 0 ? "" : `\nIssues:\n${dns.dmarc.issues.map((i) => `- ${i}`).join("\n")}`}

## MX detail
${dns.mx.records.length === 0 ? "_No MX records published._" : dns.mx.records.map((r) => `- \`${r}\``).join("\n")}
${dns.mx.issues.length === 0 ? "" : `\nIssues:\n${dns.mx.issues.map((i) => `- ${i}`).join("\n")}`}

## Welcome-email content review
${
  content?.review
    ? `Source: \`${content.path}\` — subject: "${content.subject}"
- Link count: ${content.review.linkCount}
- Image count: ${content.review.imageCount}
- Text length: ${content.review.textLength} chars
- Image-to-text ratio: ${Number.isFinite(content.review.imageToTextRatio) ? content.review.imageToTextRatio.toFixed(3) : "n/a"}
- Spam-trigger words: ${content.review.spamTriggerWords.length === 0 ? "none ✅" : content.review.spamTriggerWords.join(", ")}
- Unsubscribe link: ${content.review.unsubscribePresent ? "present ✅" : "missing ❌"}
- Physical mailing address: ${content.review.physicalAddressLikelyPresent ? "present ✅" : "missing ❌"}
${content.review.issues.length === 0 ? "" : `\nIssues:\n${content.review.issues.map((i) => `- ${i}`).join("\n")}`}`
    : `_Review skipped or source not parseable: ${content?.error ?? "unknown"}._`
}

## Findings + Tom-action items
${findings.length === 0 ? "_No findings — clean run._" : findings.map((f) => `- [ ] ${f}`).join("\n")}

## Sender-warming plan (recommended)
The platform was a cold sending domain prior to Phase 0 acquisitions. To
avoid the wave landing in spam, ramp gradually:

1. Week 1: ≤ 10 sends/day, exclusively to engaged users (founders + invited beta).
2. Week 2: ≤ 30 sends/day, prioritize confirmed-opt-in recipients.
3. Week 3: ≤ 100 sends/day, broaden to recent signups.
4. Week 4+: open the floodgates once Google Postmaster Tools shows a clean
   sender reputation + DMARC aggregate reports show < 1% fail rate.

The warming queue is enforced server-side in
\`server/services/emailWarmup.ts\` via \`reserveSend(orgId)\`. Tune the
per-org daily cap in line with the schedule above.

## Manual verification steps
- Sign in at \`postmaster.google.com\` and verify \`acreos.io\` is added with
  the TXT verification record. Watch the IP reputation / domain reputation
  dashboards weekly.
- Sign in at \`sendersupport.olc.protection.outlook.com\` (SNDS) for the IPs
  SES sends from — only relevant once Microsoft inbox traffic is non-trivial.
- After 30 days of clean aggregate reports on DMARC \`p=none\`, upgrade to
  \`p=quarantine\` for 30 days, then \`p=reject\`.

---
Generated by \`scripts/audit-email-deliverability.mjs\` — phase D3.
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help || args.h) {
    printHelp();
    return 0;
  }
  const subcommand = args._[0];
  if (subcommand !== "audit") {
    process.stderr.write("Unknown subcommand. Use --help.\n");
    return 64;
  }
  if (!args.domain || args.domain === true) {
    process.stderr.write("--domain=<domain> is required.\n");
    return 64;
  }

  const domain = String(args.domain).trim();
  const selectors = String(args.selectors ?? "0,1,2")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `${s}._domainkey`);

  const checkedAt = new Date();
  const dnsResult = await auditDns(domain, selectors);
  const severity = scoreSeverity(dnsResult);

  const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  let content = null;
  if (!args["skip-content"]) {
    content = await locateAndReviewWelcomeEmail(projectRoot);
  }

  const markdown = renderReport({ domain, dns: dnsResult, severity, content, checkedAt });

  const outPath =
    args.out && args.out !== true
      ? path.resolve(String(args.out))
      : path.join(
          projectRoot,
          "docs",
          "internal",
          `email-deliverability-report-${checkedAt.toISOString().slice(0, 10)}.md`,
        );
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, markdown, "utf8");

  process.stdout.write(`Report written: ${outPath}\nSeverity: ${severity}\n`);

  if (severity === "critical") return 2;
  if (severity === "warning") return 1;
  return 0;
}

// Only run when invoked directly (not when imported, e.g. by tests).
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("audit-email-deliverability.mjs");

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`Audit failed: ${err.stack ?? err.message}\n`);
      process.exit(3);
    });
}

export { parseSpf, parseDmarc, auditDns, scoreSeverity, reviewWelcomeContent, renderReport };
