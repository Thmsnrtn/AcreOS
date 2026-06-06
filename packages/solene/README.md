# @acreos/solene

The **first monorepo seam** (Tahoe E1). This package establishes the public API
boundary for the Solene COO / dispatch / constitution / self-audit substrate.

## Current state: a re-export seam, not a physical move

The canonical implementation **still lives under `server/services/solene/`**. The
barrel at `packages/solene/src/index.ts` only *re-exports* that surface. This keeps
the build green and the change fully reversible while pinning the public API that
consumers import:

```ts
// new code — import the named surface from the package boundary
import { enqueueDispatch, runSoleneAudit } from "@acreos/solene";

// legacy code — deep relative paths into server/services/solene/* (being migrated)
import { enqueueDispatch } from "./services/solene/dispatchQueue";
```

Why re-export first: a big-bang move of the 42 service files + schema would conflict
with the whole tree and destabilize the build. We pin the API now, relocate later.

## How the alias resolves

`@acreos/solene` resolves through the **same mechanism as `@shared`** — tsconfig
`paths` mirrored into the bundler configs. It is intentionally **path-only** (not an
npm workspace) for now, exactly like `@shared` and `@sovereign`:

- `tsconfig.json` → `compilerOptions.paths["@acreos/solene"]` +
  `include` extended with `packages/*/src/**/*`
- `vite.config.ts` → `resolve.alias["@acreos/solene"]`
- `vitest.config.ts` → `resolve.alias["@acreos/solene"]`

All three point at `packages/solene/src/index.ts`.

## The boundary

### Belongs in `@acreos/solene` (the coherent substrate — all re-exported today)

Dispatch & execution:
`dispatchQueue`, `dispatchRunner`, `dispatchToolExecutor`, `planProposals`,
`sessionTaskStore`

COO substrate:
`capitalTracker`, `pagerService`, `continuousLoop`

Agent coordination:
`agentClaims`, `agentIdentity`, `agentMessages`, `capabilityDiscovery`,
`distributedReasoning`, `codeReviewQueue`

Founder collaboration & bypass:
`founderCollab`, `founderBypass`

Constitution, alignment, self-audit:
`constitutionalGuard`, `preCallConstitutionalChecker`, `selfAudit`, `selfDebug`,
`adversarialTests`, `failureModeLibrary`

Reasoning, decisions, learning:
`decisionTraces`, `counterfactuals`, `speculations`, `timeAwareDecisions`,
`learningLoop`, `pipeline`

Confidence, evidence, scoring:
`confidenceObservations`, `confidenceParser`, `evidenceWeights`, `tokenEconomyScorer`

Memory:
`memoryFileStore`, `memoryRetrieval`

Chat (conversation surface):
`conversationStore`, `chat/turnRunner`, `chat/toolExecutor`, `chat/openRouterClient`,
`chat/anthropicClient`, `chat/contextBuilder`, `chat/modelRouter`,
`chat/providerSelector`

(Each module's `*.test.ts` is colocated and moves with its module.)

### Stays in the app (inbound dependencies the substrate still relies on)

These are intentionally **outside** this package boundary for now — factoring them
out is the *next* seam, not this one:

- `server/db` — drizzle client + connection
- `server/utils/logger` — structured logger
- `shared/schema` and `@shared/schema/solene-dispatch` — table definitions are deeply
  interwoven (454 `pgTable`s, many `agent_*` tables shared with non-Solene features),
  so schema is explicitly **not** moved. The substrate imports schema from the app.
- `@sovereign/immutables` — constitution constants (own alias already)
- `server/services/embeddings/voyageClient` — embedding provider

## Incremental relocation path (do later, one module at a time)

The seam is designed so files can be physically moved **without changing any
consumer import** (consumers already say `@acreos/solene`). Per module:

1. **Pick one leaf module** (no other solene module depends on it) — e.g.
   `pagerService` or `capitalTracker`.
2. `git mv server/services/solene/<mod>.ts packages/solene/src/<mod>.ts` (and its
   `.test.ts`).
3. Fix that file's now-outbound relative imports:
   - `../../db` → a shared `@acreos/db` alias (create it the same way) or keep a
     temporary relative `../../../server/db` until db is factored out.
   - `../../utils/logger` → likewise.
   - `@shared/...` and `@sovereign/...` already resolve from anywhere — no change.
   - sibling solene imports (`./dispatchQueue`) stay relative and keep working
     because the sibling is moving into the same dir.
4. In `packages/solene/src/index.ts`, change that module's re-export from
   `../../../server/services/solene/<mod>` to `./<mod>`.
5. Run `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` + `npm test` —
   green before moving the next module.
6. Repeat in dependency order (leaves first), ending with `dispatchRunner` /
   `selfAudit` (the heaviest hubs).

Once all 42 modules live under `packages/solene/src/`:

7. Migrate the remaining legacy importers (the ones still on
   `./services/solene/*`) to `@acreos/solene` — see "Remaining importers" below.
8. Delete the empty `server/services/solene/` directory.
9. (Optional) Promote to a real npm workspace: add `"workspaces": ["packages/*"]`
   to root `package.json`, give the package a build (`tsc -b`), and add a
   `references` entry — only worthwhile once a second package exists and we want
   independent builds.

## Remaining importers to migrate (proof-of-seam migrated 5 of these)

Already migrated to `@acreos/solene` in this change:
`routes-agent-claims.ts`, `routes-morning-pulse.ts`, `routes-plan-proposals.ts`,
`routes-dispatch.ts`, `routes-founder-bypass.ts`.

Still on deep `./services/solene/*` paths (migrate opportunistically; no rush —
both paths resolve to the same code):
`routes-ai.ts`, `routes-solene-chat.ts`, `routes-founder-collab.ts`,
`routes-solene-audit.ts`, `routes-solene-page.ts`, `jobs/runScheduledJobs.ts`,
`services/aiRouter.ts`, `services/improvement/autoDispatch.ts`,
`services/improvement/detector.ts`, plus dynamic `await import('../services/solene/...')`
call sites in `jobs/runScheduledJobs.ts`.

Find them anytime with:

```sh
grep -rln "services/solene/" server --include="*.ts" | grep -v "server/services/solene/"
```
