# ADR 007: React + Vite as Frontend Stack

**Status**: Accepted
**Date**: 2025-01-10
**Deciders**: Engineering team

## Context

AcreOS needs a frontend framework for a complex, data-rich real estate CRM with 75+ pages, real-time updates, interactive maps, and AI chat interfaces. The stack must support fast development, TypeScript, and production performance.

## Decision

We use **React 18** with **Vite** as the build tool, **TypeScript**, **TanStack Query** for data fetching, **Wouter** for routing, and **Shadcn/UI + Tailwind CSS** for components.

## Rationale

| Concern | Next.js | Create React App | React + Vite |
|---|---|---|---|
| **Build speed (dev)** | Fast | Slow | Very fast (ESBuild) |
| **SSR requirement** | Yes | No | No |
| **Bundle control** | Complex | Limited | Full control |
| **TypeScript** | Excellent | Good | Excellent |
| **Flexibility** | Framework constraints | Minimal | Maximum |

**Why Vite over CRA:**
- 10-100× faster HMR via native ESBuild
- Simpler configuration
- First-class TypeScript support
- Code splitting out of the box

**Why Wouter over React Router:**
- 3× smaller bundle (1.5KB vs 5KB)
- Simpler API for our use case
- Full TypeScript support

**Why TanStack Query:**
- Sophisticated caching and invalidation
- Optimistic updates support
- DevTools for debugging

## Consequences

- No SSR/SSG — Fly.io serves the SPA from a static directory
- SEO not a concern for authenticated B2B SaaS dashboard
- Bundle size managed via Vite's built-in code splitting
- Mobile PWA support via Capacitor (not React Native)
