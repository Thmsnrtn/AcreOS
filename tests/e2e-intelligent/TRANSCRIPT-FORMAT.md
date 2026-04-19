# Transcript Format

This document defines the exact structure of `transcript.md` files produced by both the SDK harness (`src/harness/transcript-writer.ts`) and Claude Code agent sessions. Every transcript follows this format so that downstream tooling (aggregators, dashboards, CI checks) can parse them reliably.

## File Location

Transcripts are written to `artifacts/runs/<runId>/transcript.md`. Each run directory also contains a `screenshots/` folder and a `claude-reasoning.jsonl` decision log.

## Structure

### 1. Header Block

The transcript opens with the run's identity and summary metadata as a Markdown unordered list.

```markdown
# E2E Intelligent Test Transcript

- **Run ID**: <runId>
- **Persona**: <personaId>
- **Journey**: <journeyId>
- **Date**: <ISO 8601 timestamp>
- **Steps**: <total step count>
```

The Run ID is a unique string generated at the start of the run. Persona and Journey are the IDs from the persona and journey config files. Date is the wall-clock time when the transcript was written (not when the run started). Steps is the total number of `StepRecord` entries.

### 2. Steps Section

A horizontal rule (`---`) separates the header from the steps.

```markdown
---

## Steps
```

Each step is an H3 heading with sequential numbering:

```markdown
### Step <N>

- **URL**: <current page URL>
- **Screenshot**: ![step](<relative path to PNG>)
- **Action**: `<formatted decision>`
- **Duration**: <milliseconds>ms
- **Reasoning**: <agent's reasoning for this decision>
- **In-character thought**: _"<persona's thought in quotes>"_
```

**Action formatting** follows the `formatDecision` function in `transcript-writer.ts`:
- `click(<selector>)`
- `type(<selector>, "<text truncated to 50 chars>")`
- `navigate(<url>)`
- `scroll(<direction>)`
- `wait(<ms>ms)`
- `abandon: <reason truncated to 80 chars>`
- `complete: <summary truncated to 80 chars>`

**Reasoning** is present for all decision types. **In-character thought** is present for `click`, `type`, `navigate`, `abandon`, and `complete` decisions (any decision that has a `thought` field).

**Console errors**, if any were captured during the step, appear as a sub-list:

```markdown
- **Console errors**: <count>
  - `<error text, truncated to 200 chars>`
  - `<error text>`
```

### 3. AI Output Evaluations Section

Present only if the run encountered AI-generated content. Separated by a horizontal rule.

```markdown
---

## AI Output Evaluations
```

Each evaluation is an H3 heading:

```markdown
### Evaluation at Step <N>

- **Context**: <where the AI output appeared>
- **Overall**: <CREDIBLE | QUESTIONABLE | NOT_CREDIBLE>
- **Domain Accuracy**: <score>/5
- **Actionability**: <score>/5
- **Appropriate Caution**: <score>/5
- **Signal to Noise**: <score>/5
- **Credibility**: <score>/5
- **Reasoning**: <evaluator's reasoning for the scores>
```

The five dimension scores map to the `AIQualityFinding` type. The Overall verdict is computed from the average as defined in `evaluators/ai-output-rubric.md`.

### 4. Journey Verdict Section

Always present. Separated by a horizontal rule.

```markdown
---

## Journey Verdict

- **Outcome**: <COMPLETED_SATISFIED | COMPLETED_UNSATISFIED | ABANDONED | BLOCKED>
- **Satisfaction**: <1-5>/5
- **Would Recommend**: <yes | not_yet | no>
- **Reasoning**: <one-paragraph summary>
```

If the verdict includes top issues, they appear as a sub-section:

```markdown
### Top Issues

- <issue 1>
- <issue 2>
- <issue 3>
```

Each issue is a single sentence describing the most impactful problem encountered during the journey.

## Companion Files

Each run directory also contains:

- **`screenshots/step-001.png`, `step-002.png`, ...** -- PNG screenshots captured at each step, numbered with zero-padded 3-digit indices.
- **`claude-reasoning.jsonl`** -- One JSON object per line, each containing: `step` (number), `timestamp` (epoch ms), `url` (string), `decision` (the full Decision object), `consoleErrors` (string array), and `durationMs` (number). This file is machine-readable and used by CI tooling.

## Parsing Notes

- All section headers use ATX-style Markdown (`#`, `##`, `###`).
- Metadata fields use bold key names followed by a colon and a space (`- **Key**: value`).
- Screenshot paths are relative to the run directory.
- The transcript is self-contained: a reader can understand the full journey without access to the JSONL file or screenshots, though those provide additional detail.
