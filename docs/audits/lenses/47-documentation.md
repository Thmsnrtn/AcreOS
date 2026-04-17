# Lens 47 -- Documentation & Developer Experience Audit

**Auditor persona:** Documentation writer
**Date:** 2026-04-15
**Scope:** README, CLAUDE.md, .env.example, docs/ directory, code comments, API docs, deployment instructions
**Metric:** Can a new developer get productive in 30 minutes?
**Verdict:** No. Multiple contradictions, stale auth references, and critical gaps would block a fresh checkout from reaching a running app.

---

## Executive Summary

AcreOS has a surprisingly large volume of documentation -- a 59 KB Owner's Manual, 10 ADRs, 8 architecture decision records, 9 runbooks, deployment checklists, security audits, and a Swagger UI endpoint. The quantity is not the problem. The problem is that the documents contradict each other on fundamental facts (which auth system is used, how many tables exist, which email provider is primary), the README omits two required services (Clerk, Redis), and the OpenAPI spec covers 29 of 926 endpoints.

---

## P1 -- Blocks deployment or onboarding from README

### 47-P1-01: README describes wrong auth system

**Files:** `/README.md` lines 73, 88
**Evidence:** README states "Passport-local auth (bcrypt + sessions)" and "Passport-local with bcrypt password hashing and express-session (PostgreSQL-backed via connect-pg-simple)." The actual auth system is Clerk (`server/auth/clerkAuth.ts`), as confirmed by orientation doc, recent commits (ff7b154, 8aaaf88, 7237416), and .env.example listing `CLERK_SECRET_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` as REQUIRED.

A developer following the README would never configure Clerk and would be unable to authenticate.

### 47-P1-02: README omits Clerk keys from required environment variables

**File:** `/README.md` lines 53-60
**Evidence:** The "Environment Variables" section lists only `DATABASE_URL`, `SESSION_SECRET`, and `FOUNDER_EMAILS` as required. It does not mention `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, or `CLERK_PUBLISHABLE_KEY`, all three of which are marked "REQUIRED" in `.env.example` (lines 177-183). Without these, the app cannot authenticate any user.

### 47-P1-03: README omits Redis as a required dependency

**Files:** `/README.md`, `/docs/developer-guide.md` line 8
**Evidence:** The developer guide correctly lists "Redis 7+" as a prerequisite. The README Quick Start does not mention Redis at all. The `.env.example` (line 163) marks `REDIS_URL` as required ("required after BullMQ job queue migration"), and `docker-compose.yml` provisions a Redis container. A developer following only the README would hit runtime errors from missing Redis.

### 47-P1-04: README Quick Start skips Redis and Clerk setup

**File:** `/README.md` lines 7-19
**Evidence:** The four-step Quick Start (`npm install`, `cp .env.example .env`, `npm run db:push`, `npm run dev`) does not instruct the user to start Redis or obtain Clerk API keys. Both are required for the app to function. The Docker Quick Start partially addresses this (docker-compose includes Redis) but still does not mention Clerk.

### 47-P1-05: Owner's Manual references "Continue with Replit" auth flow

**File:** `/docs/OWNERS-MANUAL.md` lines 39, 1331
**Evidence:** The Owner's Manual instructs users to "Click 'Continue with Replit' to authenticate using your Replit account." The app uses Clerk (Google OAuth), not Replit. This would confuse any user or support agent consulting the manual.

### 47-P1-06: fly-secrets.example omits Clerk keys

**File:** `/fly-secrets.example`
**Evidence:** The Fly.io secrets template lists DATABASE_URL, SESSION_SECRET, REDIS_URL, Stripe, AWS SES, etc. but does not include `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, or `CLERK_PUBLISHABLE_KEY`. A production deployment following this template would be unable to authenticate users.

---

## P2 -- Incomplete or misleading documentation

### 47-P2-01: OpenAPI spec covers ~3% of API surface

**Files:** `/server/openapi-spec.ts`, `/server/routes-api-docs.ts`
**Evidence:** The OpenAPI spec defines 29 path entries. The orientation doc counts 926 API endpoints across 121 route files. The Swagger UI at `/api/docs` gives a false sense of completeness -- a developer or partner using it would see only Auth, Leads, Properties, Deals, AVM, Voice, Marketplace, Portfolio, Land Credit, and Data API, missing campaigns, billing, AI agents, documents, onboarding, founder, teams, settings, and 100+ other route groups.

### 47-P2-02: api-reference.md describes wrong auth system

**File:** `/docs/api-reference.md` line 7
**Evidence:** States "AcreOS uses Replit OAuth (OpenID Connect) for authentication." This is stale. Auth is Clerk with Google OAuth.

### 47-P2-03: Developer guide shows `(req as any)` anti-pattern

**File:** `/docs/developer-guide.md` line 84
**Evidence:** The API patterns section demonstrates `const org = (req as any).organization;` as the recommended pattern. CLAUDE.md explicitly prohibits this: "Never use `(req as any)`." The developer guide teaches new developers the wrong pattern. The orientation doc flags 66 existing `(req as any)` casts as a P1 issue.

### 47-P2-04: Developer guide claims ~220 tables; actual count is 429

**File:** `/docs/developer-guide.md` line 68
**Evidence:** States "Schema is in `shared/schema.ts` (~220 tables)." The orientation doc counts 429 Drizzle tables in 14,883 lines. The number is nearly double what the guide claims, which misleads developers about the schema's complexity.

### 47-P2-05: Developer guide describes auth as "Express sessions (postgres-backed)"

**File:** `/docs/developer-guide.md` line 47
**Evidence:** Tech stack section says "Auth: Express sessions (postgres-backed)." Auth is now Clerk. The developer guide's auth description, middleware example, and route pattern are all based on the defunct session system.

### 47-P2-06: Rate limit documentation inconsistent across files

**Files:** `/docs/api-reference.md` lines 17-22, `/README.md` line 92
**Evidence:** The API reference says default rate limit is 100 req/min; the README says "Sliding-window in-memory rate limiter" and the orientation doc says "Global 1000 req/min only." The actual values are unclear and contradictory.

### 47-P2-07: No CONTRIBUTING.md or CHANGELOG

**Evidence:** No CONTRIBUTING.md exists at the project root. The developer guide has a "PR Workflow" section (lines 169-176) that mentions CI auto-running but the orientation doc notes "No CI pipeline -- No GitHub Actions running tests on PR." There is no CHANGELOG tracking releases. Contributors have no documented process for how to contribute, what branch strategy is used, or release cadence.

### 47-P2-08: Deployment docs reference `npm run check` passing, but 1,815 TS errors exist

**Files:** `/docs/deployment-checklist.md` line 27, `/docs/LAUNCH-DAY-CHECKLIST.md` line 31, `/docs/deployment.md` line 13
**Evidence:** Multiple deployment documents include "TypeScript check passes (`npm run check`)" or "0 TypeScript errors" as a prerequisite. The orientation doc reports 1,815 TypeScript errors, meaning this gate has never passed. Deployment docs present an unrealistic prerequisite without acknowledging the known failure.

### 47-P2-09: Deployment docs reference "CI pipeline is green" but no CI exists

**Files:** `/docs/deployment-checklist.md` line 19, `/docs/developer-guide.md` line 174
**Evidence:** The deployment checklist requires "CI pipeline is green (lint, type-check, unit tests, integration tests)." The developer guide says "Open PR -> CI runs automatically." The orientation doc flags "No CI pipeline -- No GitHub Actions running tests on PR" as problem #18. These documents describe infrastructure that does not exist.

### 47-P2-10: docs/api-reference.md rate limit table differs from OpenAPI spec security schemes

**File:** `/docs/api-reference.md`, `/server/openapi-spec.ts`
**Evidence:** The api-reference.md describes session cookies as the auth mechanism. The OpenAPI spec defines both `sessionCookie` and `apiKey` security schemes. The api-reference.md doesn't mention the X-API-Key partner authentication, and the OpenAPI spec doesn't reflect Clerk-based auth.

### 47-P2-11: `SENDGRID_API_KEY` listed in README as optional but missing from .env.example

**File:** `/README.md` line 60
**Evidence:** README lists `SENDGRID_API_KEY` as an optional env var. The `.env.example` file has `SENDGRID_FROM_EMAIL` (line 250) but no `SENDGRID_API_KEY` entry. The actual email system is AWS SES, not SendGrid. Only `server/services/performanceEnhancements.ts` references it as a fallback check.

### 47-P2-12: Multiple overlapping deployment docs with no clear canonical source

**Files:** `/README.md` (Deployment section), `/docs/deployment.md`, `/docs/deployment-checklist.md`, `/docs/LAUNCH-DAY-CHECKLIST.md`
**Evidence:** There are four separate documents covering deployment, each with slightly different commands and checklists. No document is marked as canonical. The README says "Docker (recommended)," the deployment checklist focuses on Fly.io, and the launch-day checklist is a superset. A new DevOps engineer would not know which to follow.

---

## P3 -- Nice-to-have improvements

### 47-P3-01: No inline architecture diagram

**Evidence:** The docs/architecture/ directory has 8 ADRs but no visual diagram (no Mermaid, no PNG, no draw.io file). The README has an ASCII tree but no system architecture, data flow, or deployment topology diagram. For a 926-endpoint, 429-table system, a visual architecture overview would significantly reduce onboarding time.

### 47-P3-02: Code comments are present but inconsistent

**Evidence:** 333 of 383 service files (87%) contain at least one JSDoc comment. 73 of 121 route files (60%) contain JSDoc. Key utility files (`errors.ts`, `logger.ts`, `clerkAuth.ts`) are well-documented. However, there is no enforced standard -- some files have thorough JSDoc on every export, others have none. The main `routes.ts` (1,778 lines) has minimal inline documentation.

### 47-P3-03: console.log usage in server code despite logger standard

**Evidence:** CLAUDE.md mandates "Always use structured `logger`... Never use `console.log/warn/error` in production server code." A count reveals 10 occurrences of `console.log/warn/error` across 6 server files, including `server/auth/clerkAuth.ts` line 44 (`console.warn`). Minor but contradicts the stated standard.

### 47-P3-04: .env.example is comprehensive but long (274 lines)

**File:** `/.env.example`
**Evidence:** At 274 lines with 50+ optional services, the .env.example is thorough. However, a new developer must read the entire file to understand which vars are required vs optional. A summary table at the top listing only the 6-8 truly required vars (DATABASE_URL, SESSION_SECRET, CLERK_SECRET_KEY, VITE_CLERK_PUBLISHABLE_KEY, CLERK_PUBLISHABLE_KEY, REDIS_URL, FOUNDER_EMAIL, APP_URL) would accelerate setup.

### 47-P3-05: No troubleshooting section for common Clerk/OAuth errors

**Evidence:** The developer guide has a "Common Issues" section covering module paths, org errors, DB/Redis connections. It does not cover Clerk configuration issues, OAuth redirect mismatches, or JWT fallback -- the exact problems that recent commits (ff7b154, 7237416) have been fixing. Given that auth is flagged as the #1 P0 issue, troubleshooting guidance here would be high-value.

### 47-P3-06: 9 runbooks exist but are not cross-referenced from deployment or developer docs

**Files:** `/docs/runbooks/*.md`
**Evidence:** Well-written runbooks exist for Redis connection loss, Stripe webhook failures, DB migration failures, AI quota exceeded, data breach response, and more. However, neither the README, developer guide, nor deployment docs link to them. A new on-call engineer would not discover them without browsing the docs directory.

### 47-P3-07: Owner's Manual is 59 KB but not versioned or dated

**File:** `/docs/OWNERS-MANUAL.md`
**Evidence:** The manual says "Version 1.0" but has no date, no changelog, and references the defunct Replit auth. For a customer-facing document of this size, version tracking and a "last updated" date would help readers assess currency.

---

## Summary Table

| ID | Severity | Finding |
|----|----------|---------|
| 47-P1-01 | P1 | README describes Passport-local auth; actual is Clerk |
| 47-P1-02 | P1 | README omits Clerk keys from required env vars |
| 47-P1-03 | P1 | README omits Redis as required dependency |
| 47-P1-04 | P1 | Quick Start skips Redis and Clerk setup |
| 47-P1-05 | P1 | Owner's Manual references defunct "Continue with Replit" auth |
| 47-P1-06 | P1 | fly-secrets.example omits Clerk keys |
| 47-P2-01 | P2 | OpenAPI spec covers ~3% of 926 endpoints |
| 47-P2-02 | P2 | api-reference.md says "Replit OAuth" |
| 47-P2-03 | P2 | Developer guide teaches `(req as any)` anti-pattern |
| 47-P2-04 | P2 | Developer guide claims ~220 tables; actual is 429 |
| 47-P2-05 | P2 | Developer guide describes defunct session-based auth |
| 47-P2-06 | P2 | Rate limit numbers contradict across documents |
| 47-P2-07 | P2 | No CONTRIBUTING.md or CHANGELOG |
| 47-P2-08 | P2 | Deployment docs require passing `npm run check` (1,815 TS errors) |
| 47-P2-09 | P2 | Deployment docs reference CI pipeline that does not exist |
| 47-P2-10 | P2 | API reference auth does not match OpenAPI spec security schemes |
| 47-P2-11 | P2 | README lists SENDGRID_API_KEY; not in .env.example; SES is primary |
| 47-P2-12 | P2 | Four deployment docs with no canonical source identified |
| 47-P3-01 | P3 | No architecture diagram |
| 47-P3-02 | P3 | Code comments present but inconsistent (87% services, 60% routes) |
| 47-P3-03 | P3 | 10 console.log/warn/error in server code despite logger mandate |
| 47-P3-04 | P3 | .env.example lacks quick-reference summary of required vars |
| 47-P3-05 | P3 | No Clerk/OAuth troubleshooting in developer guide |
| 47-P3-06 | P3 | Runbooks not cross-referenced from main docs |
| 47-P3-07 | P3 | Owner's Manual undated with stale auth references |

**Totals:** 6 P1, 12 P2, 7 P3

---

## 30-Minute Onboarding Assessment

A new developer cloning this repo today would:

1. Read the README Quick Start and run `npm install && cp .env.example .env && npm run db:push && npm run dev`.
2. Not start Redis (not mentioned in README) -- app fails at BullMQ initialization.
3. Not configure Clerk keys (not mentioned in README required vars) -- app starts but all auth fails with 401.
4. Consult the developer guide, which describes Passport-local auth -- still no Clerk guidance.
5. Eventually find Clerk keys in .env.example by reading all 274 lines.
6. Potentially get stuck on Google OAuth redirect configuration (no troubleshooting docs).

Estimated time to first successful login with current docs: **60-90 minutes** for an experienced developer who reads .env.example carefully. Significantly longer if they follow only the README.
