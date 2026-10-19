/**
 * Founder decision 2026-10-18 (1): every credit grant paid by CARD — a credit
 * pack, a mail recharge, an auto top-up — buys credits at CREDIT_PRICE_CENTS
 * (1.5¢), rounded down by creditsForPackPrice. The auto top-up credited one
 * credit per cent paid, so a top-up-funded house mail piece earned a third
 * less than the self-funding rule assumes.
 *
 * POPULATION (law 3): every place in server/ that can write a card-paid grant —
 *   A. an `addCredits(…, "<card-paid type>", …)` call, and
 *   B. a credit_transactions row literal `{ type: "<card-paid type>", amountCents, … }`
 * is found by an AST walk (comments never parsed), and each must size its
 * credits with creditsForPackPrice (or the CREDIT_PACKS catalogue derived from
 * it). Canaries hide the defect in fixtures; floors pin that the walk found
 * the known sites.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import ts from "typescript";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { listServerSources, parseSource, rel, ownerFunctionName } from "../helpers/serverPopulation";
import { CREDIT_PACKS } from "@shared/schema";
import { CREDIT_PACK_CATALOG, creditsForPackPrice } from "@shared/billing/credit-packs";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const CARD_PAID_TYPES = new Set(["topup", "purchase", "mail_credit_recharge"]);

interface Site {
  site: string;
  /** The enclosing function's source text. */
  body: string;
  /** The credit amount expression. */
  amount: string;
}

/**
 * The NAMED unit around a site (method / function declaration), not the
 * nearest arrow: a grant written inside `withTransaction(async (tx) => …)`
 * sizes its credits in the method around that callback.
 */
function enclosingFunction(node: ts.Node): ts.Node {
  let n: ts.Node | undefined = node.parent;
  let nearest: ts.Node | null = null;
  while (n) {
    if (ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) return n;
    if (!nearest && ts.isFunctionLike(n)) nearest = n;
    n = n.parent;
  }
  return nearest ?? node.getSourceFile();
}

function scan(fileName: string, text: string): Site[] {
  const sf = parseSource(fileName, text);
  const out: Site[] = [];
  const visit = (node: ts.Node) => {
    // A. addCredits(org, amount, "<type>", …)
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
      const typeArg = node.arguments[2];
      if (name === "addCredits" && typeArg && ts.isStringLiteralLike(typeArg) && CARD_PAID_TYPES.has(typeArg.text)) {
        out.push({ site: `${fileName}::${ownerFunctionName(node)}`, body: enclosingFunction(node).getText(sf), amount: node.arguments[1].getText(sf) });
      }
    }
    // B. { type: "<type>", amountCents: … } — a credit_transactions row.
    if (ts.isObjectLiteralExpression(node)) {
      const prop = (k: string) =>
        node.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === k);
      const type = prop("type");
      const amount = prop("amountCents");
      if (type && amount && ts.isStringLiteralLike(type.initializer) && CARD_PAID_TYPES.has(type.initializer.text)) {
        out.push({ site: `${fileName}::${ownerFunctionName(node)}`, body: enclosingFunction(node).getText(sf), amount: amount.initializer.getText(sf) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The credits are sized at the pack price: from creditsForPackPrice, or the catalogue derived from it. */
function sizedAtPackPrice(s: Site): boolean {
  const id = s.amount.trim();
  if (/^pack\.amountCents$/.test(id)) return /CREDIT_PACKS\[/.test(s.body);
  if (/^[A-Za-z_$][\w$]*$/.test(id)) {
    return new RegExp(`\\b(?:const|let)\\s+${id}\\s*=\\s*creditsForPackPrice\\(`).test(s.body);
  }
  return /^creditsForPackPrice\(/.test(id);
}

const REAL = listServerSources().flatMap((p) => scan(rel(p), fs.readFileSync(p, "utf8")));

describe("canaries — the walker sees each shape and the rule judges it", () => {
  it("flags a top-up that credits the cents it charged", () => {
    const bad = scan("fixture.ts", `async function f(o, amountCents) { await creditService.addCredits(o, amountCents, "topup", "x"); }`);
    expect(bad).toHaveLength(1);
    expect(sizedAtPackPrice(bad[0])).toBe(false);
  });
  it("passes a top-up sized by creditsForPackPrice", () => {
    const good = scan("fixture.ts", `async function f(o, amountCents) { const credits = creditsForPackPrice(amountCents); await creditService.addCredits(o, credits, "topup", "x"); }`);
    expect(good).toHaveLength(1);
    expect(sizedAtPackPrice(good[0])).toBe(true);
  });
  it("flags a row literal that grants the paid cents, and ignores Stripe metadata (no amountCents)", () => {
    const bad = scan("fixture.ts", `async function g(paidCents) { await tx.insert(creditTransactions).values({ type: "mail_credit_recharge", amountCents: paidCents }); }`);
    expect(bad).toHaveLength(1);
    expect(sizedAtPackPrice(bad[0])).toBe(false);
    expect(scan("fixture.ts", `const m = { type: "mail_credit_recharge", packCents: "1000" };`)).toEqual([]);
  });
  it("a comment naming the shape is not a site", () => {
    expect(scan("fixture.ts", `// addCredits(o, amountCents, "topup")\nconst x = 1;`)).toEqual([]);
  });
});

describe("every card-paid credit grant buys credits at the pack price", () => {
  it("finds the known sites (per-member vacuity)", () => {
    const sites = REAL.map((s) => s.site).sort();
    expect(sites).toEqual(
      expect.arrayContaining([
        "server/services/credits.ts::executeAutoTopUp",
        "server/services/credits.ts::applyCreditPackPurchase",
        "server/services/credits.ts::applyMailCreditRecharge",
      ]),
    );
  });

  it("each one sizes its credits with creditsForPackPrice", () => {
    const offenders = REAL.filter((s) => !sizedAtPackPrice(s)).map((s) => `${s.site} grants ${s.amount}`);
    expect(offenders).toEqual([]);
  });

  it("the pack catalogue IS creditsForPackPrice of its price (what applyCreditPackPurchase grants)", () => {
    for (const [id, pack] of Object.entries(CREDIT_PACKS)) {
      expect(pack.amountCents, id).toBe(creditsForPackPrice(pack.priceCents));
      expect(pack.amountCents, id).toBe(CREDIT_PACK_CATALOG[id as keyof typeof CREDIT_PACK_CATALOG].credits);
    }
  });
});
