/**
 * Security-deposit return rules, served as data (bundle diet).
 *
 * The ONE source of truth stays shared/regulatory/depositReturnRules.ts
 * (DEPOSIT_RETURN_RULES) — the server and the test suites import that
 * module synchronously and compute over the bundled table. The client
 * no longer bundles the table: it ships as /deposit-return-rules.json
 * (generated verbatim from the module; tests/unit/
 * staticDataServedAsData.test.ts pins the asset deep-equal to the
 * module and byte-identical to the generator's output), and the one
 * client consumer — the rent roll's security-deposit clock — loads it
 * through the shared static-data loader and computes with the shared
 * module's own parameterised logic (computeDepositDeadlineFrom), so
 * the arithmetic, the two-branch selection and every unknownReason
 * string are the module's, not a client copy.
 *
 * Shape guard (the #716 D-2 mandate): the loaded value is validated
 * at this boundary before the consumer sees it. A wrong-shape 200 —
 * a truncated deploy, a stale asset, a hand-edited JSON — flows into
 * the same visible load-error path as a failed fetch, never into a
 * render that would crash on a missing field.
 *
 * Regenerate the asset after editing depositReturnRules.ts:
 *   npx tsx -e 'import {DEPOSIT_RETURN_RULES} from "./shared/regulatory/depositReturnRules"; import fs from "node:fs"; fs.writeFileSync("client/public/deposit-return-rules.json", JSON.stringify(DEPOSIT_RETURN_RULES, null, 2)+"\n")'
 */

import type { DepositReturnRule } from "@shared/regulatory/depositReturnRules";
import {
  DEPOSIT_RETURN_RULES_URL,
  useStaticData,
  type StaticDataState,
} from "@/lib/static-data";

export type DepositReturnRulesData = Record<string, DepositReturnRule>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function isDepositReturnRule(v: unknown): v is DepositReturnRule {
  return (
    isRecord(v) &&
    isStr(v.state) &&
    typeof v.deadlineDays === "number" &&
    (v.deadlineDaysNoDeductions === undefined ||
      typeof v.deadlineDaysNoDeductions === "number") &&
    (v.businessDays === undefined || typeof v.businessDays === "boolean") &&
    typeof v.itemizedStatementRequired === "boolean" &&
    isStr(v.citation) &&
    (v.note === undefined || isStr(v.note))
  );
}

/**
 * The boundary check for the served rules table: a non-empty plain
 * object keyed by state code, whose every value is a well-formed rule
 * for that same state. Anything else is a load error.
 */
export function isDepositReturnRulesData(
  v: unknown,
): v is DepositReturnRulesData {
  if (!isRecord(v)) return false;
  const entries = Object.entries(v);
  return (
    entries.length > 0 &&
    entries.every(([key, rule]) => isDepositReturnRule(rule) && rule.state === key)
  );
}

/**
 * The deposit rules for a page surface: `data` is null while the asset
 * is in flight; `error` is true on a failed fetch OR a wrong-shape
 * asset — consumers render their shell plus a visible error line,
 * never silently-empty sections (the static-data discipline).
 */
export function useDepositReturnRules(): StaticDataState<DepositReturnRulesData> {
  const { data, error } = useStaticData<unknown>(DEPOSIT_RETURN_RULES_URL);
  if (error) return { data: null, error: true };
  if (data === null) return { data: null, error: false };
  if (!isDepositReturnRulesData(data)) return { data: null, error: true };
  return { data, error: false };
}
