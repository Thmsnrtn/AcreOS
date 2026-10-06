#!/usr/bin/env node
// A pass-through tap in front of the model stand-in: every request body (system
// prompt, messages, tools offered) is appended IN FULL to $TAP_LOG, then the
// request is forwarded unchanged to the stand-in at $TAP_UPSTREAM. The stand-in
// itself logs only a 220-char excerpt; the Pax data-scope check needs the whole
// prompt to prove another org's data never reached the model.
import http from "node:http";
import fs from "node:fs";
const PORT = Number(process.env.TAP_PORT || 7830);
const UP = new URL(process.env.TAP_UPSTREAM || "http://127.0.0.1:7832");
const LOG = process.env.TAP_LOG || "prompts.jsonl";
http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    try { fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), path: req.url, body: body.toString("utf8") }) + "\n"); } catch {}
    const up = http.request({ host: UP.hostname, port: UP.port, path: req.url, method: req.method, headers: { ...req.headers, host: UP.host } }, (u) => { res.writeHead(u.statusCode || 502, u.headers); u.pipe(res); });
    up.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
    res.on("close", () => { if (!res.writableEnded) up.destroy(); });
    up.end(body);
  });
}).listen(PORT, "127.0.0.1", () => console.log(`prompt tap :${PORT} → ${UP.href} log ${LOG}`));
