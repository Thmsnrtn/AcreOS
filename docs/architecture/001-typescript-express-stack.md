# ADR-001: TypeScript + Express Stack

## Context

AcreOS needed a full-stack framework decision. Candidates included Next.js (full-stack React), Remix (server-rendered React), NestJS (structured Node.js), and Express + React (decoupled). The product requires real-time WebSocket, background job processing, heavy API surface area (240+ services), and a flexible frontend that may run as a mobile app via Capacitor.

## Decision

TypeScript + Express (server) + React 18 + Vite (client) as a monorepo. Shared types between client and server via a `shared/` directory. No SSR — the client is a Vite SPA.

Express was chosen over Next.js/Remix because: (1) the server needs WebSocket, background jobs, and complex middleware chains that SSR frameworks make awkward; (2) a SPA client works better for Capacitor mobile builds; (3) Express gives full control over the request pipeline without framework opinions about routing, data loading, or caching; (4) 15 years of Express ecosystem means every integration (Stripe, SES, Twilio) has battle-tested middleware.

## Consequences

**Positive:** Full control over server architecture. WebSocket and background jobs are straightforward. Capacitor mobile builds work without SSR hydration issues. Shared TypeScript types eliminate client/server contract drift. Vite provides fast HMR during development.

**Negative:** No built-in SSR for SEO on marketing pages (mitigated by separate landing page). Manual route registration pattern instead of file-based routing. Must manually configure CORS, security headers, and middleware ordering.
