/**
 * routes-api-docs.ts
 *
 * Serves Swagger UI and OpenAPI 3.0 spec for the AcreOS API.
 *
 * GET /api/docs          → Swagger UI HTML
 * GET /api/docs/openapi.json → Raw OpenAPI 3.0 spec
 */

import { Router, type Request, type Response } from 'express';
import { generateOpenAPISpec } from './openapi-spec';

const docsRouter = Router();

// ── OpenAPI JSON Spec ──────────────────────────────────────────────────────────

docsRouter.get('/openapi.json', (_req: Request, res: Response) => {
  const spec = generateOpenAPISpec();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(spec);
});

// ── Swagger UI HTML ────────────────────────────────────────────────────────────

docsRouter.get('/', (_req: Request, res: Response) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AcreOS API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .topbar { background: #d97541 !important; }
    .topbar-wrapper img { content: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>'); height: 32px; width: 32px; }
    .topbar-wrapper a span { display: none; }
    .topbar-wrapper::after { content: 'AcreOS API'; color: white; font-weight: 700; font-size: 18px; margin-left: 8px; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: '/api/docs/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        plugins: [SwaggerUIBundle.plugins.DownloadUrl],
        layout: 'StandaloneLayout',
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 2,
        tryItOutEnabled: true,
        persistAuthorization: true,
        filter: true,
        displayRequestDuration: true,
      });
    };
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

export default docsRouter;
