/**
 * searchbugDncProvider — real DNC / litigator scrub adapter for the dncScrub seam.
 *
 * FOUNDER DECISION (2026-07-29): Searchbug is the DNC/litigator scrub vendor.
 * Rationale in docs/company/dnc-vendor-comparison.md — pay-as-you-go with no
 * subscription, a free API test account, and federal/state DNC + litigator +
 * FCC RND coverage that matches launch volume.
 *
 * API (verified 2026-07-29 against Searchbug's published integration guide,
 * https://www.searchbug.com/api/SearchBug_Identify_Phone_Number_API.pdf, linked
 * from https://www.searchbug.com/api/identify-phone-number.aspx):
 *
 *   GET https://data.searchbug.com/api/search.aspx
 *       ?CO_CODE=<AccountID>&PASS=<Password>&TYPE=api_dnc2&F=<Phone>&FORMAT=JSON
 *
 *   Auth is the CO_CODE (account id) + PASS (account password / API key) pair
 *   carried as query parameters — Searchbug publishes no header scheme for this
 *   endpoint. `TYPE=api_dnc2` is the "Do Not Call List and TCPA (only)" service.
 *
 *   Documented JSON envelope (api_dnc2 sample output):
 *     {
 *       "Status": "Success",
 *       "Data": {
 *         "PHONE": { "NUMBER": "3077721924", "NUMBER2": "(307) 772-1924",
 *                    "DNC": "FED,WY", "TCPA": "NO", "CODE": "TLX" },
 *         "STATS": { "DATE": "...", "DAILY": "2", "MONTHLY": "6",
 *                    "RATE": "0.02", "BALANCE": "554" }
 *       },
 *       "Error": null
 *     }
 *
 *   Field semantics, quoted from the guide:
 *     • DNC  — "will return NO if number is 'clean', meaning it's not on any
 *              state or federal DNC list and it's not a DNC Complainer.
 *              Otherwise, the results will include one or more codes separated
 *              by comma. The presence on a state DNC list will be marked with a
 *              two-letter state code, Federal - FED, DNC Complainer - CPL."
 *     • TCPA — "Yes/No. Indicates if phone number was used in the Telephone
 *              Consumer Protection ACT (TCPA) litigation from 2000 to present."
 *
 * MAPPING ONTO THE SEAM'S VERDICTS
 * ────────────────────────────────
 *   TCPA=YES              → `litigator`   (always blocked; consent irrelevant)
 *   DNC != "NO"           → `dnc_listed`  (blocked without express consent)
 *   DNC == "NO", TCPA=NO  → `clean`
 *   anything else         → `error` (= NOT CHECKED / unavailable)
 *
 *   Judgment call worth knowing: the CPL (DNC Complainer) code arrives INSIDE
 *   the DNC field per Searchbug's own definition, so it maps to `dnc_listed`,
 *   which express consent can override. Searchbug describes complainers as
 *   people who "have complained but have not yet sent demand letters or sued" —
 *   i.e. not litigators. Escalating CPL to `litigator` (block-always) would be
 *   a policy invention, not a vendor fact; the founder can make that call
 *   explicitly later. `listSource` always carries the raw code string so the
 *   distinction survives into `dnc_scrub_results` for auditing.
 *
 * WHAT THIS ADAPTER WILL NEVER DO
 * ───────────────────────────────
 * Return `clean` for a number it did not actually get a verdict on. No key, a
 * non-200, a malformed body, a missing DNC field, a timeout — every one of them
 * resolves to `error`, which the gate treats as "unverifiable" and fails CLOSED
 * for lead-matched marketing traffic. A number that could not be checked is not
 * a number that passed.
 *
 * NOT WIRED HERE: Searchbug's Reassigned Numbers Database is a separate service
 * type (`TYPE=api_rnd`) and a separate verdict class that this seam's status
 * enum (clean | dnc_listed | litigator | error) cannot express. It is
 * deliberately out of scope rather than silently folded into `dnc_listed`.
 */

import { logger } from "../../utils/logger";
import type { DncScrubOutcome, DncScrubProvider } from "./dncScrub";

/** Documented Searchbug API endpoint (fixed host — never user-supplied). */
export const SEARCHBUG_ENDPOINT = "https://data.searchbug.com/api/search.aspx";

/** "Do Not Call List and TCPA (only)" service type. */
export const SEARCHBUG_DNC_TYPE = "api_dnc2";

/** Account id (not secret — the Searchbug "Account ID" / CO_CODE). */
export const SEARCHBUG_CO_CODE_ENV = "SEARCHBUG_CO_CODE";
/** Account password / API key (secret — the Searchbug PASS value). */
export const SEARCHBUG_API_KEY_ENV = "SEARCHBUG_API_KEY";

const DEFAULT_TIMEOUT_MS = 8000;

type ProviderVerdict = Omit<DncScrubOutcome, "provider" | "fromCache">;

/** An honest "not checked" verdict. Never cached, never opens the gate. */
function unavailable(reason: string): ProviderVerdict {
  return { status: "error", listSource: null, reason };
}

function readCredentials(): { coCode: string; pass: string } | null {
  const coCode = (process.env[SEARCHBUG_CO_CODE_ENV] || "").trim();
  const pass = (process.env[SEARCHBUG_API_KEY_ENV] || "").trim();
  if (!coCode || !pass) return null;
  return { coCode, pass };
}

function timeoutMs(): number {
  const parsed = Number.parseInt(process.env.SEARCHBUG_TIMEOUT_MS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

export function buildSearchbugUrl(
  phoneLast10: string,
  creds: { coCode: string; pass: string },
): string {
  const url = new URL(SEARCHBUG_ENDPOINT);
  url.searchParams.set("CO_CODE", creds.coCode);
  url.searchParams.set("PASS", creds.pass);
  url.searchParams.set("TYPE", SEARCHBUG_DNC_TYPE);
  url.searchParams.set("F", phoneLast10);
  url.searchParams.set("FORMAT", "JSON");
  return url.toString();
}

/**
 * Pull the single PHONE record out of the documented envelope. Searchbug
 * accepts multiple `F=` params, so `PHONE` is tolerated as an array even
 * though we only ever send one number. Returns null when the shape is not
 * what the guide documents — which becomes `error`, not `clean`.
 */
function extractPhoneRecord(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const data = (body as Record<string, unknown>).Data;
  if (!data || typeof data !== "object") return null;
  const phone = (data as Record<string, unknown>).PHONE;
  const record = Array.isArray(phone) ? phone[0] : phone;
  if (!record || typeof record !== "object") return null;
  return record as Record<string, unknown>;
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

/**
 * Pure mapper over a parsed Searchbug body → seam verdict. Exported so the
 * mapping is unit-testable without touching the network.
 */
export function mapSearchbugResponse(body: unknown): ProviderVerdict {
  if (!body || typeof body !== "object") {
    return unavailable("Searchbug returned a non-object body — number NOT checked");
  }
  const envelope = body as Record<string, unknown>;

  // Documented failure signals: Status other than Success, or a non-null Error.
  const status = asTrimmedString(envelope.Status);
  if (status && status.toLowerCase() !== "success") {
    return unavailable(`Searchbug Status=${status} — number NOT checked`);
  }
  const errorField = envelope.Error;
  if (errorField !== undefined && errorField !== null && errorField !== "") {
    return unavailable("Searchbug returned an Error field — number NOT checked");
  }

  const record = extractPhoneRecord(envelope);
  if (!record) {
    return unavailable("Searchbug response had no PHONE record — number NOT checked");
  }

  const dncRaw = asTrimmedString(record.DNC);
  const tcpaRaw = asTrimmedString(record.TCPA);

  // Both fields are mandatory for a verdict. A missing one means we do not
  // know — and "do not know" is never "clean".
  if (dncRaw === null || tcpaRaw === null) {
    return unavailable(
      "Searchbug PHONE record was missing the DNC and/or TCPA field — number NOT checked",
    );
  }

  // Litigator first: it outranks everything and consent cannot override it.
  if (tcpaRaw.toUpperCase() === "YES") {
    return {
      status: "litigator",
      listSource: "searchbug-tcpa-litigation",
      reason: "TCPA=YES (used in TCPA litigation, 2000–present)",
    };
  }

  const dnc = dncRaw.toUpperCase();
  if (dnc !== "NO") {
    // Any non-"NO" value is one or more list codes (FED / two-letter state / CPL).
    // An empty string is NOT a documented "clean" value — treat it as unknown.
    if (dnc === "") {
      return unavailable("Searchbug returned an empty DNC field — number NOT checked");
    }
    return {
      status: "dnc_listed",
      listSource: `searchbug-dnc:${dnc}`,
      reason: `on DNC list(s): ${dnc}`,
    };
  }

  return { status: "clean", listSource: "searchbug", reason: "DNC=NO, TCPA=NO" };
}

export const searchbugDncProvider: DncScrubProvider = {
  name: "searchbug",

  isConfigured(): boolean {
    return readCredentials() !== null;
  },

  async scrub(phoneLast10: string): Promise<ProviderVerdict> {
    const creds = readCredentials();
    if (!creds) {
      // No key provisioned. Say so plainly — do NOT pretend the number cleared.
      logger.warn("[searchbugDnc] credentials absent — returning UNAVAILABLE (not clean)", {
        metadata: {
          required: [SEARCHBUG_CO_CODE_ENV, SEARCHBUG_API_KEY_ENV],
          __pii_safe: true,
        },
      });
      return unavailable(
        `Searchbug credentials not configured (${SEARCHBUG_CO_CODE_ENV} / ${SEARCHBUG_API_KEY_ENV}) — number NOT checked`,
      );
    }

    let response: Response;
    try {
      response = await fetch(buildSearchbugUrl(phoneLast10, creds), {
        method: "GET",
        signal: AbortSignal.timeout(timeoutMs()),
      });
    } catch (err) {
      logger.error(
        "[searchbugDnc] request failed — returning UNAVAILABLE (not clean)",
        err instanceof Error ? err : undefined,
        { metadata: { __pii_safe: true } },
      );
      return unavailable("Searchbug request failed (network/timeout) — number NOT checked");
    }

    if (!response.ok) {
      logger.error("[searchbugDnc] non-OK response — returning UNAVAILABLE (not clean)", undefined, {
        metadata: { statusCode: response.status, __pii_safe: true },
      });
      return unavailable(`Searchbug HTTP ${response.status} — number NOT checked`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      logger.error(
        "[searchbugDnc] response was not valid JSON — returning UNAVAILABLE (not clean)",
        err instanceof Error ? err : undefined,
        { metadata: { __pii_safe: true } },
      );
      return unavailable("Searchbug response was not valid JSON — number NOT checked");
    }

    const verdict = mapSearchbugResponse(body);
    if (verdict.status === "error") {
      logger.warn("[searchbugDnc] unusable response — returning UNAVAILABLE (not clean)", {
        metadata: { reason: verdict.reason, __pii_safe: true },
      });
    }
    return verdict;
  },
};
