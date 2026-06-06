# Voice Linter Spec

**Companion to:** `00-blueprint.md` §2 (Voice doctrine)
**Owner:** Soren (spec) → Iris (implementation, future)
**Status:** Specification. No code in this round.

---

## 1. Purpose

The voice linter is a deterministic gate that prevents drift between published copy and the voice doctrine. It runs at three points:

1. **Pre-commit** (developer machine) — fast, advisory.
2. **CI gate** (GitHub Actions) — blocking on `main`-bound PRs.
3. **Manual** — `npm run lint:voice` for ad-hoc author runs.

It is not a creativity gate. It catches the failure modes that have actually happened in this codebase (per `feedback_landing_voice` memory + the founder-letter removal from `client/src/pages/landing/copy.ts`).

---

## 2. Scope — files linted

The linter scans:

- `client/src/pages/landing/**/*.{ts,tsx}` — landing surface
- `client/src/pages/learn/**/*.{ts,tsx}` — /learn shell (content JSON is structurally separate)
- `content/learn/**/*.json` — programmatic SEO content
- `content/editorial/**/*.{md,mdx}` — editorial content (future)
- `content/briefs/**/*.yml` — editorial briefs (future)
- `marketing-copy/**/*.{ts,json,md}` — explicit marketing-copy directory (future)

The linter does NOT scan:

- `client/src/pages/founder-letter.tsx` (founder-internal surface, not customer-facing)
- `docs/internal/**` (internal documentation; this very document would otherwise fail rules on persona names)
- `server/**` (not customer-facing copy)

---

## 3. Rule set

Each rule is keyed `voice/<rule-id>` and has a severity (`error` blocks CI; `warn` does not block but appears in PR comments).

### 3.1 Forbidden tokens (severity: error)

| Rule ID | Pattern (case-insensitive) | Reason |
|---|---|---|
| `voice/no-competitor-land-geek` | `land\s*geek` | Per `feedback_competitor_refs` |
| `voice/no-competitor-geekpay` | `geek\s*pay` | Per `feedback_competitor_refs` |
| `voice/no-competitor-lgpass` | `lg\s*pass` | Per `feedback_competitor_refs` |
| `voice/no-competitor-podolsky` | `podolsky` | Per `feedback_competitor_refs` |
| `voice/no-founder-name` | `thomas\s+norton`, `tom\s+norton`, `thmsnrtn` | No founder name on customer surface |
| `voice/no-internal-persona-solene` | `\bsolene\b` | Per `project_persona_architecture` |
| `voice/no-internal-persona-iris` | `\biris\b` | Per `project_persona_architecture` |
| `voice/no-internal-persona-soren` | `\bsoren\b` | Per `project_persona_architecture` |
| `voice/no-internal-persona-others` | `\b(maren|beatrice|krieger|rafe|andrei|tess|iyari|quinn|henrik|lena|sophie|forge|atlas)\b` | Per `project_persona_architecture` |
| `voice/no-real-estate-professional` | `real\s*estate\s+professional`, `real\s*estate\s+investor` | Per `feedback_terminology` v6 — use "Land Investors" |
| `voice/no-investment-return-claims` | `make\s+\$[\d,]+\s+per\s+deal`, `average\s+investor\s+sees`, `guaranteed\s+returns?`, `passive\s+income\s+guarantee` | FTC compliance — no investment-return language |
| `voice/no-dark-pattern-urgency` | `\d+\s+spots?\s+left`, `only\s+\d+\s+remaining`, `act\s+now\s+before` | No manufactured urgency |
| `voice/no-fake-social-proof` | `\d{1,3},?\d{3}\s+(investors|operators|customers)\s+trust` (without a `// source:` adjacent comment) | Per truth engine — claims must have sources |

### 3.2 Forbidden voice patterns (severity: error)

Detected via regex on string literals (TS/TSX) and prose blocks (MD/MDX/JSON):

| Rule ID | Pattern | Reason |
|---|---|---|
| `voice/no-founder-first-person` | `\bI\s+(built|made|created|designed|wanted)\b` | Founder-letter tone |
| `voice/no-we-believe` | `\bwe\s+(believe|think|feel|know)\b` | Audience-flattering rhetoric |
| `voice/no-you-flattery` | `you're\s+(a\s+)?(serious|smart|sophisticated|experienced)` | Flattery hooks |
| `voice/no-rhetorical-question-hook` | `^(So,?\s+)?(what\s+if|imagine|picture)\b` (line-start) | Founder-letter open |

### 3.3 Required tokens (severity: warn → error at Phase 1)

| Rule ID | Pattern | Reason |
|---|---|---|
| `voice/required-land-investors` | At least 1 instance of `Land Investors?` per landing surface file | Positioning lock |
| `voice/required-five-verbs` | At least 3 of {find, mail, reply, close, service|servicing} per landing hero | Five-verb mechanic |

### 3.4 Numeric-claim provenance (severity: error)

Any string literal matching `\b\d+(\.\d+)?\s*(seconds?|minutes?|hours?|days?|comps?|pages?|counties|states|%|x|×)\b` must have an adjacent `// source: <pointer>` comment within 3 lines above OR be in a file with a `truthSources` export. The source pointer is one of:

- `code:<relative-path>:<symbol>` — references a code-level SLA or constant
- `data:<table>:<column>` — references a database-derived statistic
- `manual:<docs/path>` — references a manually maintained source doc

Examples from `client/src/pages/landing/copy.ts`:

- `"90 seconds"` → `source: code:server/jobs/lead-ingest.ts:LEAD_INGEST_SLA_SECONDS`
- `"10 minutes"` → `source: code:client/src/pages/onboarding/wizard.tsx:FIRST_LIST_TARGET_MINUTES`
- `"$41/mo (billed annually)"` → `source: code:shared/pricing.ts:PRO_TIER_ANNUAL_MONTHLY`

### 3.5 The truth-engine source-pointer file

```ts
// client/src/pages/landing/truth-sources.ts (future)
export const TRUTH_SOURCES = {
  "90 seconds: lead-ingest SLA": {
    claim: "AcreOS filters new leads against it within 90 seconds of ingest",
    source: "code:server/jobs/lead-ingest.ts:LEAD_INGEST_SLA_SECONDS",
    verified: "2026-06-05",
    verifier: "soren",
  },
  "10 minutes: first list": {
    claim: "Pax pulls your first list inside 10 minutes",
    source: "code:client/src/pages/onboarding/wizard.tsx:FIRST_LIST_TARGET_MINUTES",
    verified: "2026-06-05",
    verifier: "soren",
  },
  // ... etc
} as const;
```

The linter cross-references string literals on customer surfaces against this registry. Unregistered numeric claims fail CI.

---

## 4. How it runs

### 4.1 Pre-commit

Husky hook (or simple-git-hooks) runs `npm run lint:voice` on changed files only. Fast path: <2 seconds on a 50-file changeset. Failures print as advisory text; do not block commit.

### 4.2 CI gate

GitHub Actions runs `npm run lint:voice -- --all` on every PR touching files in §2 scope. Failures block merge to `main`.

### 4.3 Manual

`npm run lint:voice` runs against the full §2 scope. `--fix` is NOT supported — voice failures require human judgment.

### 4.4 Output format

```
client/src/pages/landing/copy.ts:48:8
  voice/no-competitor-podolsky — banned token "podolsky" found
  voice/numeric-claim-no-source — "14 comps" has no truth-source pointer

content/learn/land-flipping/texas.json:section[2].body:
  voice/no-founder-first-person — "I've watched dozens" violates third-person rule

Found 3 errors. Voice linter failed.
```

---

## 5. Implementation outline (for Iris, future)

- Node script in `scripts/lint-voice.ts`.
- Uses `ts-morph` to walk TS/TSX string literals and JSX text nodes.
- Uses `remark` to walk MD/MDX.
- Uses straight JSON traversal for `content/**/*.json`.
- Rules live in `scripts/voice-rules/*.ts` — one rule per file, exported as `{ id, severity, test }`.
- Wire to `package.json` as `"lint:voice": "tsx scripts/lint-voice.ts"`.
- CI: `.github/workflows/voice-lint.yml` runs on PRs touching scope files.

Estimated build time: 1.5 days. Estimated maintenance: 30 min/quarter to add rules as new failure modes appear.

---

## 6. What this spec does NOT do

- Does not check style (grammar, readability, sentence length). Voice ≠ style.
- Does not auto-fix. Voice is a judgment domain.
- Does not enforce SEO best practices. That is a separate lint (future).
- Does not check brand color/typography. That is a design-token concern.
