/**
 * The market twin's world: synthetic counties, parcels and owners.
 *
 * Seeded and deterministic (`twin.test.ts` pins it): `buildWorld(seed)` is a
 * pure function of the seed. Every probability it uses is a named entry in
 * PARAMS (parameters.ts) with a source; shapes that are not rates (acreage,
 * price) are lognormals whose medians are labelled assumptions here.
 */
import { Rng } from "./rng";
import { PARAMS } from "./parameters";

export interface County { fips: string; name: string; state: string; zone: string; medianAcres: number; medianPricePerAcre: number }
export interface Owner {
  id: string;
  first: string;
  last: string;
  mailLine1: string;
  mailState: string;
  mailZip: string;
  mailZone: string;
  areaCode: string;
  phone: string | null;
  phoneKind: "mobile" | "landline" | null;
  /** The traced phone reaches someone who is not this owner. */
  phoneWrongPerson: boolean;
  email: string | null;
  emailBounces: boolean;
  mailUndeliverable: boolean;
  /** Latent willingness to sell, 0..1. */
  motivation: number;
  /** Latent irritability: raises angry replies and opt-outs. */
  irritability: number;
}
export interface Parcel { apn: string; county: County; acres: number; assessedUsd: number; owner: Owner }
export interface World { seed: number; counties: County[]; parcels: Parcel[]; owners: Owner[] }

// Shapes (labelled assumptions; rates live in PARAMS).
const SHAPE = {
  medianAcres: { value: 5, sdLog: 1.0, note: "assumption: rural land lists are dominated by 1–20 acre lots" },
  pricePerAcre: { value: 1500, sdLog: 0.8, note: "assumption: cheap rural land, wide spread by county" },
} as const;
export const WORLD_SHAPES = SHAPE;

const STATES: Array<[string, string, string[]]> = [
  ["AZ", "America/Phoenix", ["Cochise", "Mohave", "Navajo", "Apache", "Yavapai"]],
  ["NM", "America/Denver", ["Luna", "Valencia", "Torrance", "Socorro"]],
  ["TX", "America/Chicago", ["Hudspeth", "Presidio", "Brewster", "Terrell"]],
  ["CO", "America/Denver", ["Costilla", "Huerfano", "Park", "Elbert"]],
  ["FL", "America/New_York", ["Putnam", "Levy", "Highlands", "Marion"]],
  ["NC", "America/New_York", ["Brunswick", "Pender", "Moore"]],
];
const HOMES: Array<[string, string, string, string]> = [
  ["CA", "90012", "213", "America/Los_Angeles"], ["TX", "77002", "713", "America/Chicago"], ["IL", "60601", "312", "America/Chicago"],
  ["NJ", "07102", "973", "America/New_York"], ["MA", "02108", "617", "America/New_York"], ["FL", "33101", "305", "America/New_York"],
  ["AZ", "85004", "602", "America/Phoenix"], ["WA", "98101", "206", "America/Los_Angeles"], ["CO", "80202", "303", "America/Denver"],
  ["NY", "14202", "716", "America/New_York"], ["GA", "30303", "404", "America/New_York"], ["HI", "96813", "808", "Pacific/Honolulu"],
];
const FIRST = ["John", "Mary", "Robert", "Patricia", "James", "Linda", "Michael", "Barbara", "David", "Elizabeth", "Wei", "Maria", "Jose", "Susan", "Aisha", "Tomasz"];
const LAST = ["Smith", "Johnson", "Garcia", "Martinez", "Brown", "Lopez", "Davis", "Miller", "Wilson", "Nguyen", "Kowalski", "Okafor", "Begay", "Yazzie"];

export function buildWorld(seed: number, opts: { parcels?: number } = {}): World {
  const rng = new Rng(seed);
  const rc = rng.fork("counties");
  const counties: County[] = [];
  for (const [state, zone, names] of STATES) {
    for (const name of names) {
      counties.push({
        fips: `${state}-${name}`,
        name,
        state,
        zone,
        medianAcres: rc.lognormal(SHAPE.medianAcres.value, 0.4),
        medianPricePerAcre: rc.lognormal(SHAPE.pricePerAcre.value, SHAPE.pricePerAcre.sdLog),
      });
    }
  }
  const ro = rng.fork("owners");
  const n = opts.parcels ?? 2000;
  const owners: Owner[] = [];
  const parcels: Parcel[] = [];
  for (let i = 0; i < n; i++) {
    const county = counties[i % counties.length];
    const home = ro.pick(HOMES);
    const hasPhone = ro.bernoulli(PARAMS.ownerHasPhone.value);
    const landline = hasPhone && ro.bernoulli(PARAMS.phoneIsLandline.value);
    const hasEmail = ro.bernoulli(PARAMS.ownerHasEmail.value);
    const first = ro.pick(FIRST), last = ro.pick(LAST);
    const owner: Owner = {
      id: `o${seed}-${i}`,
      first,
      last,
      mailLine1: `${100 + i} ${["N Main St", "E Elm Ave", "W Oak Dr", "S 4th St"][i % 4]}`,
      mailState: home[0],
      mailZip: home[1],
      mailZone: home[3],
      areaCode: home[2],
      phone: hasPhone ? `+1${home[2]}${String(300 + (i % 600)).padStart(3, "0")}${String(i).padStart(4, "0").slice(-4)}` : null,
      phoneKind: hasPhone ? (landline ? "landline" : "mobile") : null,
      phoneWrongPerson: hasPhone && ro.bernoulli(PARAMS.phoneWrongPerson.value),
      email: hasEmail ? `${first.toLowerCase()}.${last.toLowerCase()}.${seed}.${i}@example.net` : null,
      emailBounces: hasEmail && ro.bernoulli(PARAMS.emailHardBounce.value),
      mailUndeliverable: ro.bernoulli(PARAMS.uspsUndeliverableAsAddressed.value),
      motivation: Math.min(1, Math.max(0, ro.normal(0.3, 0.2))),
      irritability: Math.min(1, Math.max(0, ro.normal(0.3, 0.2))),
    };
    owners.push(owner);
    const acres = Math.max(0.1, ro.lognormal(county.medianAcres, SHAPE.medianAcres.sdLog));
    parcels.push({
      apn: `${county.state}${String(i).padStart(6, "0")}`,
      county,
      acres: Math.round(acres * 100) / 100,
      assessedUsd: Math.round(acres * ro.lognormal(county.medianPricePerAcre, 0.3)),
      owner,
    });
  }
  return { seed, counties, parcels, owners };
}

/** A stable digest of a world (determinism checks). */
export function worldDigest(w: World): string {
  let h = 2166136261;
  const feed = (s: string) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } };
  for (const p of w.parcels) feed(`${p.apn}|${p.acres}|${p.assessedUsd}|${p.owner.phone}|${p.owner.email}|${p.owner.motivation.toFixed(6)}`);
  return (h >>> 0).toString(16);
}
