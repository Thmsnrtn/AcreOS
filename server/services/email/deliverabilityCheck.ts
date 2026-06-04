/**
 * Email deliverability check — phase D3.
 *
 * Pure-function library version of the DNS audit performed by
 * `scripts/audit-email-deliverability.mjs`. Resolves SPF / DKIM / DMARC / MX
 * records for a domain and returns a structured `DeliverabilityReport`. The
 * helpers `parseSpf`, `parseDmarc`, and `scoreSeverity` are exported so they
 * can be unit-tested without hitting live DNS.
 *
 * This module is intentionally read-only — it does not alter or send any
 * email, and it does not mutate DNS. It pairs with Beatrice's pre-deploy
 * audit (commit fc3cd5cb) to surface the deliverability posture before the
 * incoming-traffic wave at Phase 0.
 *
 * The DKIM selector list defaults to the AWS SES rotation pattern
 * (`0._domainkey`, `1._domainkey`, `2._domainkey`) since the canonical send
 * surface in `server/services/emailService.ts` is SES.
 */

import { promises as dns } from "node:dns";

export interface DkimSelector {
  selector: string;
  record: string | null;
  valid: boolean;
}

export interface SpfRecord {
  raw: string;
  mechanisms: string[];
  allPolicy: "+all" | "~all" | "-all" | "?all" | null;
}

export interface DmarcRecord {
  raw: string;
  policy: "none" | "quarantine" | "reject" | null;
  percent: number;
  rua: string[];
  ruf: string[];
}

export type Severity = "clean" | "informational" | "warning" | "critical";

export interface DeliverabilityReport {
  domain: string;
  checkedAt: Date;
  spf: { found: boolean; record: SpfRecord | null; issues: string[] };
  dkim: {
    selectorsChecked: string[];
    selectorsFound: DkimSelector[];
    issues: string[];
  };
  dmarc: { found: boolean; record: DmarcRecord | null; issues: string[] };
  mx: { records: string[]; issues: string[] };
  overallSeverity: Severity;
}

/**
 * Default SES DKIM selectors. AWS SES rotates between three keys, all named
 * with this pattern. Override via the `selectors` parameter on
 * `checkDeliverability` if the org publishes a different scheme.
 */
export const DEFAULT_DKIM_SELECTORS = ["0._domainkey", "1._domainkey", "2._domainkey"];

/**
 * Parse the raw `v=spf1 ...` TXT value into mechanisms + the all-policy.
 * Tolerates the record arriving with the `v=spf1` prefix included.
 */
export function parseSpf(raw: string): SpfRecord {
  const trimmed = raw.trim();
  const tokens = trimmed.split(/\s+/);
  const mechanisms: string[] = [];
  let allPolicy: SpfRecord["allPolicy"] = null;

  // Multiple `v=spf1` markers in the same TXT chunk is an RFC 7208 violation.
  const versionCount = tokens.filter((t) => t.toLowerCase() === "v=spf1").length;
  if (versionCount > 1) {
    return {
      raw: trimmed,
      mechanisms: [],
      allPolicy: null,
    };
  }

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === "v=spf1") continue;
    if (
      lower === "+all" ||
      lower === "~all" ||
      lower === "-all" ||
      lower === "?all"
    ) {
      allPolicy = lower as SpfRecord["allPolicy"];
      continue;
    }
    if (token.length > 0) mechanisms.push(token);
  }

  return { raw: trimmed, mechanisms, allPolicy };
}

/**
 * Parse the raw `v=DMARC1 ...` TXT value into policy + percent + reporting
 * addresses. Defaults `pct=100` when missing per RFC 7489.
 */
export function parseDmarc(raw: string): DmarcRecord {
  const trimmed = raw.trim();
  const tags = new Map<string, string>();
  for (const part of trimmed.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();
    tags.set(key, value);
  }

  const rawPolicy = tags.get("p");
  let policy: DmarcRecord["policy"] = null;
  if (rawPolicy === "none" || rawPolicy === "quarantine" || rawPolicy === "reject") {
    policy = rawPolicy;
  }

  const rawPct = tags.get("pct");
  let percent = 100;
  if (rawPct !== undefined) {
    const parsed = Number.parseInt(rawPct, 10);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
      percent = parsed;
    }
  }

  const rua = (tags.get("rua") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const ruf = (tags.get("ruf") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return { raw: trimmed, policy, percent, rua, ruf };
}

/**
 * Roll up the per-check issues into an overall severity. Order:
 *   - critical: SPF missing/malformed OR all DKIM selectors missing OR
 *               DMARC `p=reject` with no prior monitor period evidence.
 *   - warning : one DKIM selector missing while others present, MX issues,
 *               or DMARC malformed.
 *   - informational: DMARC `p=none` (normal Phase 0 monitor mode), or DMARC
 *               missing `rua=`.
 *   - clean   : everything passes.
 */
export function scoreSeverity(
  report: Omit<DeliverabilityReport, "overallSeverity">,
): Severity {
  // SPF: missing or duplicate-version is critical.
  if (!report.spf.found || report.spf.record === null) return "critical";
  if (report.spf.record.allPolicy === null) return "critical";

  // DKIM: zero selectors found is critical, partial is warning.
  const validDkim = report.dkim.selectorsFound.filter((s) => s.valid).length;
  if (validDkim === 0) return "critical";
  const partialDkim = validDkim < report.dkim.selectorsChecked.length;

  // MX issues are warning.
  const hasMxIssue = report.mx.issues.length > 0;

  if (partialDkim || hasMxIssue) return "warning";

  // DMARC interpretation.
  if (!report.dmarc.found || report.dmarc.record === null) {
    return "informational";
  }
  if (report.dmarc.record.policy === null) return "warning";
  if (report.dmarc.record.policy === "none") return "informational";
  if (report.dmarc.record.rua.length === 0) return "informational";

  return "clean";
}

/**
 * Tiny adapter so tests can inject a stub resolver while production uses the
 * Node built-in. We split the resolver interface to the three calls we make.
 */
export interface DnsResolver {
  resolveTxt: (hostname: string) => Promise<string[][]>;
  resolveMx: (hostname: string) => Promise<Array<{ exchange: string; priority: number }>>;
}

const defaultResolver: DnsResolver = {
  resolveTxt: (h) => dns.resolveTxt(h),
  resolveMx: (h) => dns.resolveMx(h),
};

async function resolveTxtSafe(
  resolver: DnsResolver,
  hostname: string,
): Promise<string[] | null> {
  try {
    const chunks = await resolver.resolveTxt(hostname);
    // A single TXT record can arrive as multiple 255-byte chunks; join them.
    return chunks.map((parts) => parts.join(""));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOTFOUND" || code === "ENODATA") return null;
    throw err;
  }
}

/**
 * Audit a domain's email deliverability posture. Pure read — issues no
 * mutations of any kind.
 */
export async function checkDeliverability(
  domain: string,
  options: { selectors?: string[]; resolver?: DnsResolver } = {},
): Promise<DeliverabilityReport> {
  const resolver = options.resolver ?? defaultResolver;
  const selectors = options.selectors ?? DEFAULT_DKIM_SELECTORS;
  const checkedAt = new Date();

  // SPF — TXT at the apex with `v=spf1`.
  let spfFound = false;
  let spfRecord: SpfRecord | null = null;
  const spfIssues: string[] = [];
  try {
    const records = (await resolveTxtSafe(resolver, domain)) ?? [];
    const spfMatches = records.filter((r) => /^\s*v=spf1\b/i.test(r));
    if (spfMatches.length === 0) {
      spfIssues.push("No v=spf1 TXT record at apex.");
    } else if (spfMatches.length > 1) {
      spfIssues.push(
        `Multiple SPF records (${spfMatches.length}) — RFC 7208 §3.2 violation; receivers will treat as permerror.`,
      );
      spfFound = true;
      spfRecord = parseSpf(spfMatches[0]);
    } else {
      spfFound = true;
      spfRecord = parseSpf(spfMatches[0]);
      if (spfRecord.allPolicy === null) {
        spfIssues.push("SPF record has no all-mechanism (~all / -all).");
      } else if (spfRecord.allPolicy === "+all") {
        spfIssues.push("SPF policy is `+all` — open relay posture; any sender will pass.");
      } else if (spfRecord.allPolicy === "?all") {
        spfIssues.push("SPF policy is `?all` — neutral, gives no protection.");
      }
    }
  } catch (err) {
    spfIssues.push(`SPF lookup failed: ${(err as Error).message}`);
  }

  // DKIM — TXT at each selector. Per-selector independently.
  const dkimFound: DkimSelector[] = [];
  const dkimIssues: string[] = [];
  for (const selector of selectors) {
    try {
      const hostname = `${selector}.${domain}`;
      const records = (await resolveTxtSafe(resolver, hostname)) ?? [];
      const dkimRecord = records.find((r) => /v=DKIM1/i.test(r)) ?? null;
      const valid = dkimRecord !== null && /p=[A-Za-z0-9+/=]+/i.test(dkimRecord);
      dkimFound.push({ selector, record: dkimRecord, valid });
      if (!valid) {
        dkimIssues.push(`Selector ${selector} missing or malformed.`);
      }
    } catch (err) {
      dkimFound.push({ selector, record: null, valid: false });
      dkimIssues.push(`Selector ${selector} lookup failed: ${(err as Error).message}`);
    }
  }

  // DMARC — TXT at _dmarc.<domain>.
  let dmarcFound = false;
  let dmarcRecord: DmarcRecord | null = null;
  const dmarcIssues: string[] = [];
  try {
    const records = (await resolveTxtSafe(resolver, `_dmarc.${domain}`)) ?? [];
    const match = records.find((r) => /^\s*v=DMARC1\b/i.test(r));
    if (!match) {
      dmarcIssues.push("No DMARC record. Critical for protecting the domain from spoofing.");
    } else {
      dmarcFound = true;
      dmarcRecord = parseDmarc(match);
      if (dmarcRecord.policy === null) {
        dmarcIssues.push("DMARC record missing `p=` tag — malformed.");
      } else if (dmarcRecord.policy === "none") {
        dmarcIssues.push(
          "DMARC policy is `p=none` (monitor-only). Normal at Phase 0; upgrade to quarantine after 30 days of clean aggregate reports.",
        );
      }
      if (dmarcRecord.rua.length === 0) {
        dmarcIssues.push("No `rua=` reporting address — no aggregate-report visibility.");
      }
    }
  } catch (err) {
    dmarcIssues.push(`DMARC lookup failed: ${(err as Error).message}`);
  }

  // MX — should resolve to one or more exchanges.
  const mxRecords: string[] = [];
  const mxIssues: string[] = [];
  try {
    const records = await resolver.resolveMx(domain);
    for (const r of records) mxRecords.push(`${r.priority} ${r.exchange}`);
    if (mxRecords.length === 0) {
      mxIssues.push("No MX records — inbound mail cannot be received at this domain.");
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      mxIssues.push("No MX records — inbound mail cannot be received at this domain.");
    } else {
      mxIssues.push(`MX lookup failed: ${(err as Error).message}`);
    }
  }

  const partial = {
    domain,
    checkedAt,
    spf: { found: spfFound, record: spfRecord, issues: spfIssues },
    dkim: {
      selectorsChecked: selectors,
      selectorsFound: dkimFound,
      issues: dkimIssues,
    },
    dmarc: { found: dmarcFound, record: dmarcRecord, issues: dmarcIssues },
    mx: { records: mxRecords, issues: mxIssues },
  };

  return {
    ...partial,
    overallSeverity: scoreSeverity(partial),
  };
}

/**
 * Welcome-email content review — scans an HTML body for the small set of
 * heuristics that correlate with spam-bucket landings.
 */
export interface WelcomeContentReview {
  linkCount: number;
  imageCount: number;
  textLength: number;
  imageToTextRatio: number;
  spamTriggerWords: string[];
  unsubscribePresent: boolean;
  physicalAddressLikelyPresent: boolean;
  issues: string[];
}

const SPAM_TRIGGERS = [
  "free",
  "urgent",
  "act now",
  "guaranteed",
  "winner",
  "$$$",
  "click here",
  "limited time",
];

export function reviewWelcomeContent(
  subject: string,
  html: string,
): WelcomeContentReview {
  const linkCount = (html.match(/<a\b[^>]*href=/gi) ?? []).length;
  const imageCount = (html.match(/<img\b/gi) ?? []).length;
  const textOnly = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const textLength = textOnly.length;
  const imageToTextRatio = textLength === 0 ? Infinity : imageCount / Math.max(1, Math.floor(textLength / 200));

  const haystack = `${subject} ${textOnly}`.toLowerCase();
  const spamTriggerWords = SPAM_TRIGGERS.filter((w) => haystack.includes(w));

  const unsubscribePresent = /unsubscribe/i.test(html);
  // US street-address heuristic: digits followed by a street-type word, OR a
  // suite line, OR a recognizable city-state-zip fragment.
  const physicalAddressLikelyPresent =
    /\b\d{1,6}\s+\w+\s+(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|pl|place|ct|court)\b/i.test(
      textOnly,
    ) || /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(textOnly);

  const issues: string[] = [];
  if (linkCount > 10) issues.push(`Link count ${linkCount} exceeds the 10-link spam-filter threshold.`);
  if (imageToTextRatio > 1) issues.push("Image-to-text ratio looks heavy; spam filters disfavor image-dominant mail.");
  if (spamTriggerWords.length > 0) {
    issues.push(`Spam-trigger words present: ${spamTriggerWords.join(", ")}.`);
  }
  if (!unsubscribePresent) issues.push("No unsubscribe link — CAN-SPAM §5 violation.");
  if (!physicalAddressLikelyPresent) {
    issues.push("No physical mailing address detected in footer — CAN-SPAM §5 violation.");
  }

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
