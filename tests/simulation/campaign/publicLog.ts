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
  markers: () => readonly string[],
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
      const live = markers().filter((m) => m.length > 0);
      if (live.some((m) => text.includes(m))) {
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
