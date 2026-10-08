/**
 * The twin → the provider stand-in (tests/simulation/campaign/market/
 * provider-standin.mjs, reused, not copied). The twin decides, per recipient,
 * what the real provider would answer — a landline is 30006, a filtered
 * message 30007, an unregistered sender 30034, a bad address a Lob 422, a
 * bounced address an SES rejection — and writes that into the stand-in's rules
 * file. The product then meets the provider's real failure shapes.
 */
import { writeFileSync } from "node:fs";
import { Rng } from "./rng";
import { PARAMS } from "./parameters";
import type { World } from "./world";

export interface ProviderRules {
  smsCodes: Record<string, number>;
  a2pUnregistered: string[];
  bounce: string[];
  lobReject: string[];
  sesThrottleEvery?: number;
  stripeDecline: string[];
  metaReject?: boolean;
}

export function providerRulesFor(world: World, opts: { unregisteredSenders?: string[]; seed?: number } = {}): ProviderRules {
  const rng = new Rng(opts.seed ?? world.seed).fork("providers");
  const codes = PARAMS.twilioErrorCodes.value;
  const smsCodes: Record<string, number> = {};
  const bounce: string[] = [];
  for (const o of world.owners) {
    if (o.phone && o.phoneKind === "landline") smsCodes[o.phone] = codes.landline;
    else if (o.phone && rng.bernoulli(PARAMS.carrierFilterRate.value)) smsCodes[o.phone] = codes.filtered;
    if (o.email && o.emailBounces) bounce.push(o.email);
  }
  const lobReject = world.owners.filter((o) => o.mailUndeliverable || rng.bernoulli(PARAMS.lobAddressInvalid.value)).map((o) => o.mailLine1);
  return { smsCodes, a2pUnregistered: opts.unregisteredSenders ?? [], bounce, lobReject, sesThrottleEvery: 200, stripeDecline: [], metaReject: false };
}

export function writeProviderRules(dir: string, rules: ProviderRules): void {
  writeFileSync(`${dir}/provider-rules.json`, JSON.stringify(rules));
}
