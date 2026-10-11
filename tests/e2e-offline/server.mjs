// Minimal static server for the offline field-map spec: the REAL client/public
// files (sw.js, offline-map.html/.js), the harness bundle, and a fixture
// offline pack. Every response is no-store, so an offline reload can only be
// answered by the service worker, never the HTTP cache.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const pub = path.join(root, "client/public");
const port = Number(process.env.OFFLINE_SPEC_PORT ?? 4791);

const bundle = await build({
  entryPoints: [path.join(here, "harness.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  alias: { "@shared": path.join(root, "shared"), "@": path.join(root, "client/src") },
});
const harnessJs = bundle.outputFiles[0].text;

const PACK = {
  truncated: false,
  parcels: [
    {
      id: 1, apn: "TEST-APN-1", county: "Bastrop", state: "TX", acres: "12.5", address: "1 County Rd 301",
      status: "owned", zoning: "AG", roadAccess: "gravel", assessedValue: "41000", lat: 30.11, lng: -97.31,
      boundary: { type: "Polygon", coordinates: [[[-97.312, 30.108], [-97.308, 30.108], [-97.308, 30.112], [-97.312, 30.112], [-97.312, 30.108]]] },
    },
  ],
};

const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const send = (status, type, body) => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };
    if (url.pathname === "/harness.html") return send(200, "text/html", '<!doctype html><meta name="viewport" content="width=device-width"><title>harness</title><script type="module" src="/harness.js"></script>');
    if (url.pathname === "/harness.js") return send(200, "text/javascript", harnessJs);
    if (url.pathname === "/api/maps/offline-pack") return send(200, "application/json", JSON.stringify(PACK));
    if (url.pathname === "/") return send(200, "text/html", "<!doctype html><title>app shell</title>");
    const file = path.join(pub, path.normalize(url.pathname));
    if (!file.startsWith(pub) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(404, "text/plain", "not found");
    return send(200, types[path.extname(file)] ?? "application/octet-stream", fs.readFileSync(file));
  })
  .listen(port, () => console.log(`offline spec server on ${port}`));
