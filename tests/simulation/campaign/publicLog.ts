/**
 * Public-log guard for a sim whose stdout/stderr is published (a CI log on a
 * public repository).
 *
 * The rule such a sim follows is "print counts and route templates, never a
 * response body or row data". Writing only safe lines is the first half; this
 * is the second: every write to stdout/stderr is checked for the run's own
 * data markers (the forged canary text every synthesized text column carries),
 * and a chunk that carries one is replaced before it reaches the stream. The
 * check is on the BYTES written, not on which variable was printed, so a body
 * that reaches the log through any path — a finding title, an error message, a
 * debug line — is caught the same way.
 *
 * `leaks()` reports how many chunks were withheld; a sim exits non-zero when it
 * is above zero, so a regression is a red job rather than a quiet redaction.
 */

type Write = typeof process.stdout.write;

export interface PublicLogGuard {
  /** Chunks withheld because they carried a run marker. */
  leaks(): number;
  /** Restore the original stream writers. */
  uninstall(): void;
}

export const WITHHELD_LINE = "[public-log] a line carrying run data was withheld\n";

export function installPublicLogGuard(
  markers: () => readonly (string | RegExp)[],
  streams: Array<NodeJS.WriteStream> = [process.stdout, process.stderr],
): PublicLogGuard {
  let withheld = 0;
  const originals = new Map<NodeJS.WriteStream, Write>();
  for (const stream of streams) {
    const original = stream.write.bind(stream) as Write;
    originals.set(stream, stream.write);
    const guarded = function (this: unknown, chunk: unknown, ...rest: unknown[]): boolean {
      const text =
        typeof chunk === "string" ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk).toString("utf8") : String(chunk);
      const hit = markers().some((m) => (typeof m === "string" ? m.length > 0 && text.includes(m) : m.test(text)));
      if (hit) {
        withheld++;
        return (original as (...a: unknown[]) => boolean)(WITHHELD_LINE, ...rest);
      }
      return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
    };
    stream.write = guarded as Write;
  }
  return {
    leaks: () => withheld,
    uninstall: () => {
      for (const [stream, w] of originals) stream.write = w;
    },
  };
}

/**
 * Keep a database session's failed statements out of the database SERVER log.
 *
 * Postgres logs every failed statement with a DETAIL line that quotes the
 * offending values. A sweep that forges rows expects refusals, and in CI the
 * database service container's log is printed into the public job log when
 * the job ends — outside any stream guard. Raising this session's thresholds
 * to `panic` keeps its statements out of that log. It needs a superuser (the
 * CI service user is one); returns false when the setting was refused.
 */
export async function quietSessionServerLog(db: { query(sql: string): Promise<unknown> }): Promise<boolean> {
  try {
    await db.query("SET log_min_error_statement = 'panic'");
    await db.query("SET log_min_messages = 'panic'");
    return true;
  } catch {
    return false;
  }
}
