/**
 * The market cohort's modelled parameters — ONE source, read by the 90-day
 * cohort (cohort-90-days.ts), its burden calendar (burden.ts) and the market
 * twin (tests/simulation/twin/parameters.ts). These are the cohort's stated
 * assumptions about what customers' sellers DO; they are not measurements.
 */

/** Arrival day on the 25-customer curve (index = spec.n - 1). Front-loaded launch, then ~2/week. */
export const ARRIVAL_25 = [0, 0, 2, 5, 8, 11, 14, 17, 21, 24, 28, 31, 35, 38, 42, 45, 49, 52, 56, 60, 64, 68, 73, 79, 85];
export const ARRIVAL_10 = [0, 6, 13, 20, 28, 37, 47, 57, 68, 80];
export const ARRIVAL_3 = [0, 30, 60];
/** Reply mix for an SMS touch (modelled). Exact keywords only in "stop". */
export const REPLY_RATE = 0.22;
export const REPLY_MIX: Array<[string, number, string[]]> = [
  ["stop", 0.18, ["STOP", "Stop", "STOP.", "unsubscribe"]],
  ["natural-optout", 0.17, ["Please stop texting me", "Take me off your list", "Do not contact me again", "Who is this? Don't text me again or I'll report you"]],
  ["wrong-number", 0.15, ["Wrong number", "I don't own any land, wrong person", "This isn't John"]],
  ["interested", 0.3, ["Yes I might sell, what's your offer?", "Maybe. How much?", "Interested, call me"]],
  ["angry", 0.2, ["How did you get my number?!", "Not selling. Leave me alone", "Scam"]],
];
export const MAIL_CALLBACK_RATE = 0.04; // sellers who phone in after a postcard
