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

  app.use(express.static(distPath));

  // fall through to index.html — inject CSP nonce into the HTML shell (F-A05-1)
  app.use("*", (req: Request, res: Response) => {
    const indexPath = path.resolve(distPath, "index.html");
    const nonce: string | undefined = res.locals.cspNonce;

    if (nonce && process.env.NODE_ENV === "production") {
      try {
        let html = fs.readFileSync(indexPath, "utf-8");
        // Inject nonce into all inline <script> and <style> tags emitted by the Vite build
        html = html.replace(/<script(?![^>]*\bnonce=)/g, `<script nonce="${nonce}"`);
        html = html.replace(/<style(?![^>]*\bnonce=)/g, `<style nonce="${nonce}"`);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.send(html);
      } catch {
        // If file read fails, fall back to sendFile
      }
    }

    res.sendFile(indexPath);
  });
}
