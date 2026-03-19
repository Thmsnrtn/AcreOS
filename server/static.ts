import express, { type Express, type Request, type Response } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Task #193: Static assets with content-hash filenames (e.g., main.abc123.js)
  // get 1-year max-age with immutable flag. The HTML shell is served with no-cache
  // so browsers always fetch the latest entry point (which references hashed assets).
  app.use(express.static(distPath, {
    maxAge: process.env.NODE_ENV === "production" ? "1y" : 0,
    immutable: process.env.NODE_ENV === "production",
    setHeaders: (res, filePath) => {
      // HTML files should never be cached — they reference hashed asset URLs
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    },
  }));

  // fall through to index.html — inject CSP nonce into the HTML shell (F-A05-1)
  // Skip API routes — they should have already sent a response
  const indexPath = path.resolve(distPath, "index.html");
  app.use("*", (req: Request, res: Response) => {
    if (res.headersSent) return;
    // Don't serve index.html for API routes — if we got here, the API route didn't match
    if (req.originalUrl.startsWith("/api/")) {
      return res.status(404).json({ message: "Not found" });
    }

    const nonce: string = res.locals.cspNonce || "";
    if (!nonce) {
      return res.sendFile(indexPath);
    }

    try {
      const html = fs.readFileSync(indexPath, "utf-8");
      const injected = html.replace(/data-csp-nonce/g, `nonce="${nonce}" data-csp-nonce`);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(injected);
    } catch {
      // If file read fails, fall back to sendFile
      res.sendFile(indexPath);
    }
  });
}
