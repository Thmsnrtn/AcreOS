/**
 * The trailing 12 months cut in a viewer's time zone, as [from, to) instants
 * bound as ISO strings — for figures bucketed by month on the server that a
 * viewer used to bucket by their own local month (W10.2b re-audit: Finance's
 * persona hero, server/storage/noteBookFigures.ts).
 */
// The hero bucketed `createdAt` by the VIEWER's local month (getFullYear /
// getMonth) over `new Date(y, m - i, 1)` boundaries. The client sends its
// IANA zone and the window is cut here in that zone, as instant boundaries
// bound as ISO strings — so the server's months are the ones the viewer saw.
// created_at is a timestamp without zone (written by defaultNow() in the DB
// session's zone). Drizzle reads such a value as UTC (`value + "+0000"`), so
// the client's months were cut over that UTC reading; Postgres drops the "Z"
// of an ISO literal compared to the column, so these bounds compare against
// the very same wall-clock the client read.

/** A zone Intl knows, else UTC (an unknown zone must not fail the read). */
export function resolveTimeZone(tz: unknown): string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** `tz`'s offset from UTC (ms) at instant `at`. */
function zoneOffsetMs(at: number, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(new Date(at))
      .map((x) => [x.type, x.value]),
  );
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return wall - Math.floor(at / 1000) * 1000;
}

/**
 * The instant local midnight opens the 1st of (year, month0) in `tz` — what
 * `new Date(year, month0, 1)` gives in that zone. The offset is re-read at
 * the first guess so a DST change between UTC and local midnight is honoured
 * (Sydney, Auckland… in Oct 2028 / Apr 2029). Only a DST gap that swallows
 * midnight on a 1st lands differently (an hour early) — America/Asuncion in
 * Oct 2017 and 2023; no zone's current rules do that.
 */
function zonedMonthStart(year: number, month0: number, tz: string): number {
  const wall = Date.UTC(year, month0, 1);
  return wall - zoneOffsetMs(wall - zoneOffsetMs(wall, tz), tz);
}

/** The trailing 12 local months ending with `now`'s, oldest first, as [from, to) ISO bounds. */
export function originationWindow(now: Date, tz: string): { month: string; from: string; to: string }[] {
  const local = new Date(now.getTime() + zoneOffsetMs(now.getTime(), tz));
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  return Array.from({ length: 12 }, (_, k) => {
    const i = 11 - k;
    const label = new Date(Date.UTC(y, m - i, 1));
    return {
      month: `${label.getUTCFullYear()}-${String(label.getUTCMonth() + 1).padStart(2, "0")}`,
      from: new Date(zonedMonthStart(y, m - i, tz)).toISOString(),
      to: new Date(zonedMonthStart(y, m - i + 1, tz)).toISOString(),
    };
  });
}
