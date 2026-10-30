// Child-process probe for importingJobQueueDoesNotBootServer.test.ts.
// Imports ONE module in a fresh process and reports whether anything bound a
// listener or started a background loop. Run via `tsx`, never imported.
import http from "node:http";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

const created: number[] = [];
const origCreate = http.createServer;
(http as any).createServer = function (this: unknown, ...a: unknown[]) {
  created.push(1);
  return (origCreate as any).apply(this, a);
};
syncBuiltinESMExports(); // make `import { createServer } from "http"` see the wrapper

const listened: unknown[] = [];
const origListen = net.Server.prototype.listen;
(net.Server.prototype as any).listen = function (this: unknown, ...a: unknown[]) {
  listened.push(a[0]);
  return (origListen as any).apply(this, a);
};

await import(process.argv[2]);
// The entrypoint's IIFE awaits before it listens; give it the time it needs.
await new Promise((r) => setTimeout(r, Number(process.argv[3] ?? 2500)));
console.log(
  "PROBE " +
    JSON.stringify({
      httpServersCreated: created.length,
      listenCalls: listened.length,
      backgroundIntervals: ((globalThis as any).__bgIntervals ?? []).length,
    }),
);
process.exit(0);
