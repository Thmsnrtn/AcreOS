/**
 * The auction calendar and the bidder-registration gate — V-Tax-1 T3b. Pure.
 *
 *   - An auction date is the COUNTY's calendar date. A time of day means
 *     nothing without the county's time zone, and AcreOS holds no county→zone
 *     map: the zone is stated by the operator with where it came from, like
 *     every other procedure fact. With no zone stated, no time is shown and no
 *     countdown is computed — the date alone is shown, as a date.
 *   - Instants are computed from the county's local wall-clock time in its
 *     IANA zone, so a 10:00 sale in Phoenix is 10:00 in Phoenix whether the
 *     server, the operator or the browser sits in New York.
 *   - Registration is a STAGE GATE, not a note field: deposit, funds, entity
 *     documents, W-9 and the bidder registration itself. Which items a county
 *     requires is the county's, stated per item with its source; an item whose
 *     requirement is not stated is open, never assumed not required.
 */

export interface StatedZone {
  value: string;
  source: string;
  asOf: string;
}

export interface AuctionCalendarRecord {
  /** The county's IANA time zone, as the operator stated it. */
  timeZone: StatedZone | null;
  /** Local wall-clock start time on the sale date, "HH:MM". */
  startTimeLocal: string | null;
  /** Registration deadline in the county's local time. */
  registrationDeadline: { date: string; timeLocal: string | null; source: string } | null;
  /** What the county requires to bid: deposit and form of funds. A notebook — no money moves through AcreOS. */
  funds: { depositCents: number | null; form: string | null; source: string } | null;
}

export function isValidTimeZone(zone: string): boolean {
  if (!zone || !zone.includes("/")) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export function isLocalTime(t: string): boolean {
  return HHMM.test(t);
}

/** The offset (minutes) of `zone` from UTC at the instant `at`. */
function offsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** The instant of a local wall-clock time in `zone`. Two passes settle a DST transition. */
function zonedInstant(date: string, timeLocal: string, zone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = timeLocal.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = new Date(wall - offsetMinutes(zone, new Date(wall)) * 60_000);
  guess = new Date(wall - offsetMinutes(zone, guess) * 60_000);
  return guess;
}

export type CalendarMoment =
  | { status: "timed"; local: string; zone: string; instant: string; hoursFromNow: number }
  | { status: "date_only"; date: string; why: string };

function moment(date: string, timeLocal: string | null, zone: StatedZone | null, now: Date): CalendarMoment {
  if (!zone) return { status: "date_only", date, why: "the county's time zone is not stated, so no time is shown" };
  if (!timeLocal) return { status: "date_only", date, why: "no time of day is stated" };
  const at = zonedInstant(date, timeLocal, zone.value);
  return { status: "timed", local: `${date} ${timeLocal}`, zone: zone.value, instant: at.toISOString(), hoursFromNow: Math.round(((at.getTime() - now.getTime()) / 3_600_000) * 10) / 10 };
}

export interface AuctionCalendarView {
  saleDate: string;
  timeZone: StatedZone | null;
  start: CalendarMoment;
  registration: null | (CalendarMoment & { source: string; closed: boolean });
  funds: AuctionCalendarRecord["funds"];
}

export function auctionCalendar(saleDate: string, record: AuctionCalendarRecord | null, now: Date): AuctionCalendarView {
  const r = record ?? { timeZone: null, startTimeLocal: null, registrationDeadline: null, funds: null };
  const reg = r.registrationDeadline;
  let registration: AuctionCalendarView["registration"] = null;
  if (reg) {
    const m = moment(reg.date, reg.timeLocal, r.timeZone, now);
    // With no time or zone, the deadline closes at the END of its calendar
    // date at the latest; "closed" is only claimed once that day has passed
    // everywhere (UTC−12), never earlier.
    // Compared on the instant itself, never on the rounded hours shown.
    const closed = m.status === "timed" ? Date.parse(m.instant) <= now.getTime() : now.getTime() > Date.parse(`${reg.date}T23:59:59-12:00`);
    registration = { ...m, source: reg.source, closed };
  }
  return { saleDate, timeZone: r.timeZone, start: moment(saleDate, r.startTimeLocal, r.timeZone, now), registration, funds: r.funds };
}

// ── Bidder registration, a stage gate ──────────────────────────────────────

export const REGISTRATION_ITEMS = ["deposit", "funds", "entity_docs", "w9", "bidder_registration"] as const;
export type RegistrationItem = (typeof REGISTRATION_ITEMS)[number];

const REGISTRATION_ITEM_LABEL: Record<RegistrationItem, string> = {
  deposit: "Deposit",
  funds: "Funds in the form the county accepts",
  entity_docs: "Entity documents",
  w9: "W-9",
  bidder_registration: "Registered as a bidder",
};

export interface RegistrationItemRecord {
  /** Whether the county requires it, as stated with its source. null = not stated. */
  requirement: null | { status: "required" | "not_required"; source: string; asOf: string };
  /** Done, with who and when; a note says what (bidder number, deposit receipt). */
  done: null | { at: string; byUserId: string | null; note: string | null };
}

export type RegistrationRecord = Partial<Record<RegistrationItem, RegistrationItemRecord>>;

export interface RegistrationStanding {
  complete: boolean;
  items: Array<{ key: RegistrationItem; label: string; state: "not_stated" | "not_required" | "required_open" | "done"; why: string }>;
}

export function registrationStanding(record: RegistrationRecord | null): RegistrationStanding {
  const items = REGISTRATION_ITEMS.map((key) => {
    const r = record?.[key];
    const label = REGISTRATION_ITEM_LABEL[key];
    // Registering as a bidder is never "not required": it is the act the
    // other items lead up to. Its requirement is implied; only "done" counts.
    if (key === "bidder_registration") {
      return r?.done
        ? { key, label, state: "done" as const, why: `done ${r.done.at.slice(0, 10)}${r.done.note ? ` — ${r.done.note}` : ""}` }
        : { key, label, state: "required_open" as const, why: "not registered yet" };
    }
    if (!r?.requirement) return { key, label, state: "not_stated" as const, why: "whether the county requires it is not stated" };
    if (r.requirement.status === "not_required") return { key, label, state: "not_required" as const, why: `not required — ${r.requirement.source}, as of ${r.requirement.asOf}` };
    if (r.done) return { key, label, state: "done" as const, why: `done ${r.done.at.slice(0, 10)}${r.done.note ? ` — ${r.done.note}` : ""}` };
    return { key, label, state: "required_open" as const, why: `required (${r.requirement.source}) and not done yet` };
  });
  return { complete: items.every((i) => i.state === "done" || i.state === "not_required"), items };
}
