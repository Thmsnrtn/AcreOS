/**
 * In-memory ThrottleBackend for the decisions-inbox throttle suites.
 *
 * Mirrors the DB backend's contract: values are stored as RAW JSON STRINGS and
 * read back through the module's own parsers (so an unparseable row behaves as
 * it does in founder_settings), and `withLock` serialises callers like the
 * advisory lock does. The throttle module under test is never mocked — only
 * its storage seam is replaced.
 */
import {
  DAY_KEY_PREFIX,
  SUBJECT_KEY_PREFIX,
  hash16,
  parseDayCounts,
  parseSubjectState,
  type ThrottleBackend,
  type ThrottleStore,
} from "../../server/services/decisionsInboxThrottle";

export interface MemoryBackend {
  backend: ThrottleBackend;
  /** Raw founder_settings-shaped rows: key → JSON string. */
  rows: Map<string, string>;
  flags: { readFails: boolean; backendDown: boolean };
  subjectRowCount(): number;
  subjectKeyFor(producer: string, subjectKey: string): string;
}

export function createMemoryBackend(): MemoryBackend {
  const rows = new Map<string, string>();
  const flags = { readFails: false, backendDown: false };
  const sk = (p: string, h: string) => `${SUBJECT_KEY_PREFIX}${p}.${h}`;
  const dk = (p: string, d: string) => `${DAY_KEY_PREFIX}${p}.${d}`;

  const store: ThrottleStore = {
    async readSubject(p, h) {
      if (flags.readFails) throw new Error("store read failed");
      return parseSubjectState(rows.get(sk(p, h)));
    },
    async readDay(p, d) {
      if (flags.readFails) throw new Error("store read failed");
      return parseDayCounts(rows.get(dk(p, d)));
    },
    async writeSubject(p, h, state) {
      rows.set(sk(p, h), JSON.stringify(state));
    },
    async writeDay(p, d, counts) {
      rows.set(dk(p, d), JSON.stringify(counts));
    },
  };

  let chain: Promise<unknown> = Promise.resolve();
  const backend: ThrottleBackend = {
    withLock(_producer, _subjectHash, fn) {
      if (flags.backendDown) return Promise.reject(new Error("backend down"));
      const run = chain.then(() => fn(store));
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };

  return {
    backend,
    rows,
    flags,
    subjectRowCount: () => [...rows.keys()].filter((k) => k.startsWith(SUBJECT_KEY_PREFIX)).length,
    subjectKeyFor: (producer, subjectKey) => sk(producer, hash16(subjectKey)),
  };
}
