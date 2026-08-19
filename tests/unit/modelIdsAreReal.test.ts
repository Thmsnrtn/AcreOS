/**
 * A pinned model id must be one the provider actually serves.
 *
 * THE DEFECT
 * ──────────
 * Three of the platform's pinned ids did not exist at OpenRouter, and the guard
 * that looked like it checked them checked something else entirely:
 * `models.ts` throws at boot if an id has no row in `AI_COST_RATES` — so the
 * only thing proven was that somebody had written down a PRICE. `aiCostRates`
 * dutifully carried one for a model that does not exist.
 *
 * Measured against the live catalogue on 2026-08-19 (415 models):
 *
 *   anthropic/claude-haiku-4-5-20251001   absent   ← MODEL_MODERATE, the cheap tier
 *   anthropic/claude-opus-4-8             absent   ← hyphenated version
 *   anthropic/claude-sonnet-4-6           absent   ← hyphenated version
 *   deepseek/deepseek-reasoner            absent   ← MODEL_REASONING
 *   gpt-4o                                absent   ← bare, no author prefix
 *
 * The catalogue's actual strings are `anthropic/claude-opus-4.8`,
 * `anthropic/claude-sonnet-4.6`, `anthropic/claude-haiku-4.5`,
 * `deepseek/deepseek-r1` and `openai/gpt-4o`.
 *
 * `MODEL_MODERATE` is returned by `modelForTier` for `standard` and
 * `background` and by `selectProviderAndModel` for `TaskComplexity.MODERATE`,
 * and the primary completion's catch RETHROWS rather than falling back — so the
 * whole cheap tier raised on every call.
 *
 * HOW IT HID
 * ──────────
 * `MODELS.HAIKU` was built as `` `anthropic/${ANTHROPIC_MODELS.HAIKU}` `` under
 * a comment claiming the two id sets were "kept in LOCKSTEP by construction".
 * They are different namespaces: Anthropic's API pins a DATED id, OpenRouter's
 * catalogue slug is undated. The derivation happens to be correct for Opus and
 * Sonnet — whose Anthropic ids carry no date — so two of three were right and
 * the third was silently wrong.
 *
 * WHY THESE ASSERTIONS AND NOT A LIVE PROBE
 * ─────────────────────────────────────────
 * A test that fetches the catalogue is a test that passes when the network is
 * down, which is a gate that can go permanently green in exactly the
 * environment that cannot check it. So the two rules below are the OFFLINE,
 * deterministic form of what the probe found, each verified against the live
 * catalogue at the time of writing:
 *
 *   1. Every OpenRouter id carries an `author/slug` prefix — 0 of 415 without.
 *      Catches the bare `gpt-4o` class.
 *   2. No Anthropic OpenRouter slug ends in a date — 0 of 28 with.
 *      Catches the concatenation that produced the 404.
 *
 * Rule 2 is the one that matters: rule 1 alone would have passed
 * `anthropic/claude-haiku-4-5-20251001` happily, since its SHAPE is fine. That
 * is the difference between proving the symbol and proving the behaviour.
 *
 * `scripts/check-model-ids.mjs` does the live probe for when the network is
 * there and the answer is wanted fresh.
 */

import { describe, it, expect } from "vitest";
import {
  MODELS,
  ANTHROPIC_MODELS,
  KNOWN_MODELS,
  OPENAI_DIRECT_MODELS,
  openAiModelIdFor,
} from "../../server/services/models";
import { AI_COST_RATES } from "../../server/services/aiCostRates";

describe("every pinned OpenRouter id is shaped like a real one", () => {
  it("vacuity: there are models pinned, and they are distinct", () => {
    expect(KNOWN_MODELS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(KNOWN_MODELS).size).toBe(KNOWN_MODELS.length);
  });

  it("carries an author/slug prefix — the catalogue has no bare ids", () => {
    // Measured 2026-08-19: 415 models, 0 without a prefix.
    const bare = KNOWN_MODELS.filter((id) => !/^[a-z0-9-]+\/.+/.test(id));
    expect(bare, "these ids have no provider prefix and will 404").toEqual([]);
  });

  it("no Anthropic slug carries a date — OpenRouter's are undated", () => {
    // Measured 2026-08-19: 28 Anthropic models, 0 ending in a date. This is one
    // of the two rules the concatenation broke, and the one a shape check alone
    // misses — `anthropic/claude-haiku-4-5-20251001` is shaped perfectly well.
    const dated = KNOWN_MODELS.filter(
      (id) => id.startsWith("anthropic/") && /-20\d{6}$/.test(id),
    );
    expect(
      dated,
      "an Anthropic OpenRouter slug must not carry a date suffix — that is the " +
        "Anthropic API's naming, not the catalogue's, and it 404s",
    ).toEqual([]);
  });

  it("versions are DOTTED, not hyphenated", () => {
    // The second rule, and the one the first pass of this fix got wrong: the
    // catalogue carries 18 dotted Anthropic ids (`claude-opus-4.8`) and ZERO
    // hyphenated ones. `/models/{id}/endpoints` normalises `-4-5` to `-4.5`,
    // which is very likely why a hyphenated id looked fine when probed
    // individually and is absent from the catalogue listing. Pin the canonical
    // string rather than relying on an undocumented normalisation.
    const hyphenated = KNOWN_MODELS.filter((id) => /-\d+-\d+(?:$|[^0-9])/.test(id));
    expect(
      hyphenated,
      "these ids use a hyphenated version; the catalogue uses dots",
    ).toEqual([]);
  });

  it("the two id namespaces are NOT derived from each other", () => {
    // The Anthropic-direct id for Haiku is dated and must stay that way; the
    // OpenRouter one must not be. If these two are ever equal modulo the
    // prefix again, the concatenation is back.
    expect(ANTHROPIC_MODELS.HAIKU).toMatch(/-20\d{6}$/);
    expect(MODELS.HAIKU).toBe("anthropic/claude-haiku-4.5");
    expect(
      MODELS.HAIKU,
      "MODELS.HAIKU is being derived from ANTHROPIC_MODELS.HAIKU again",
    ).not.toBe(`anthropic/${ANTHROPIC_MODELS.HAIKU}`);
  });

  it("the ids that 404'd are gone by name", () => {
    // Named explicitly so that reintroducing one — by any route — fails with
    // the reason attached, rather than only failing the shape rules above.
    for (const dead of [
      "anthropic/claude-haiku-4-5-20251001",
      "anthropic/claude-opus-4-8",
      "anthropic/claude-sonnet-4-6",
      "deepseek/deepseek-reasoner",
      "gpt-4o",
    ]) {
      expect(KNOWN_MODELS, `${dead} is not in the provider catalogue`).not.toContain(dead);
    }
  });
});

describe("the id follows the client, because the same model has two names", () => {
  // Measured 2026-08-19: OpenRouter serves `openai/gpt-4o` (200) and 404s
  // `gpt-4o`; OpenAI is the other way round. Two services and the router's
  // fallback build their client from AI_INTEGRATIONS_OPENAI_BASE_URL, a secret
  // with NO DEFAULT — and docs/runbooks/ai-quota-exceeded.md tells the operator
  // to repoint it at OpenRouter during a quota incident. So which name is
  // correct is decided at runtime, and guessing it wrong 404s every call in
  // those services at the exact moment someone is restoring service.

  it("prefixes for OpenRouter", () => {
    expect(
      openAiModelIdFor("https://openrouter.ai/api/v1", OPENAI_DIRECT_MODELS.GPT4O),
    ).toBe("openai/gpt-4o");
    expect(
      openAiModelIdFor("https://openrouter.ai/api/v1", OPENAI_DIRECT_MODELS.GPT4O_MINI),
    ).toBe("openai/gpt-4o-mini");
  });

  it("stays bare for OpenAI, and for an unset base URL", () => {
    // Unset is the production default: the OpenAI SDK falls back to
    // https://api.openai.com/v1, so the bare name is the correct one. An
    // unrecognised host resolves the same way — the env var is documented as
    // OpenAI's, and an OpenAI-compatible proxy takes OpenAI's names.
    expect(openAiModelIdFor(undefined, OPENAI_DIRECT_MODELS.GPT4O)).toBe("gpt-4o");
    expect(openAiModelIdFor("https://api.openai.com/v1", OPENAI_DIRECT_MODELS.GPT4O)).toBe(
      "gpt-4o",
    );
    expect(openAiModelIdFor("https://llm-proxy.internal/v1", OPENAI_DIRECT_MODELS.GPT4O)).toBe(
      "gpt-4o",
    );
  });

  it("the two forms are not equal — the whole point of the function", () => {
    // Vacuity guard. If the resolver ever returned its input unchanged, every
    // assertion above would still pass on the bare cases and the OpenRouter
    // case is the only one that catches it.
    expect(openAiModelIdFor("https://openrouter.ai/api/v1", OPENAI_DIRECT_MODELS.GPT4O)).not.toBe(
      openAiModelIdFor(undefined, OPENAI_DIRECT_MODELS.GPT4O),
    );
  });

  it("OPENAI_DIRECT_MODELS holds BARE names, deliberately", () => {
    // These are the one place a bare id is correct: they are the input to the
    // resolver, not something sent anywhere. check-model-prefix.mjs registers
    // them scoped to models.ts for exactly this reason.
    for (const id of Object.values(OPENAI_DIRECT_MODELS)) {
      expect(id, "OPENAI_DIRECT_MODELS must hold OpenAI's own names").not.toMatch(/\//);
    }
  });
});

describe("the price guard is not mistaken for an existence guard", () => {
  it("every pinned id still has a price row", () => {
    // The pre-existing boot guard, restated here so it is visible next to what
    // it does NOT prove.
    for (const id of KNOWN_MODELS) {
      expect(
        id in AI_COST_RATES || id.toLowerCase() in AI_COST_RATES,
        `${id} has no price row`,
      ).toBe(true);
    }
  });

  it("a price row does not make a model real — and the table still holds a dead id's price", () => {
    // `deepseek/deepseek-reasoner` keeps its row so a stored historical usage
    // row still prices. That is deliberate, and it is exactly why the price
    // table can never be the existence check: it is a LEDGER of what was
    // charged, not a catalogue of what can be called.
    expect(AI_COST_RATES["deepseek/deepseek-reasoner"]).toBeDefined();
    expect(KNOWN_MODELS).not.toContain("deepseek/deepseek-reasoner");
  });
});
