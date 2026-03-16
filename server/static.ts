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

  // Inject the per-request CSP nonce into index.html before serving it.
  // The build output uses a placeholder attribute `data-csp-nonce` on script/style
  // tags that need the nonce; we replace it at serve time.
  const indexPath = path.resolve(distPath, "index.html");
  app.use("*", (req: Request, res: Response) => {
    const nonce: string = res.locals.cspNonce || "";
    if (!nonce) {
      return res.sendFile(indexPath);
    }
    const html = fs.readFileSync(indexPath, "utf8");
    // Replace placeholder nonce attribute with the real per-request nonce.
    const injected = html.replace(/data-csp-nonce/g, `nonce="${nonce}" data-csp-nonce`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(injected);
  });
}
