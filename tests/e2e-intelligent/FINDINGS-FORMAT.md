# Findings Format

This document defines the structure of `findings.md` files produced after each journey run. Findings aggregate all defects and quality issues discovered during the run into a single, actionable report.

## File Location

Findings are written to `artifacts/runs/<runId>/findings.md` alongside the transcript and screenshots.

## Schema Per Finding

Each finding is an H3 heading followed by a structured field list:

```markdown
### <ID>: <Title>

- **Severity**: <CRITICAL | HIGH | MEDIUM | LOW>
- **Category**: <structural | workflow | ai-output | ux-coherence>
- **Step**: <step number where observed>
- **URL**: <page URL at time of observation>
- **Description**: <1-2 sentence explanation of the defect>
- **Evidence**: <raw data -- error text, status code, console output, or AI score summary>
- **Persona Impact**: <how this affected the persona's experience or ability to proceed>
- **Recommended Action**: <specific fix or investigation to resolve the issue>
```

## Field Definitions

- **ID**: Auto-generated, prefixed by category. `STR-001` for structural, `WF-001` for workflow, `AI-001` for AI output, `UX-001` for UX coherence. Sequential within each category per run.
- **Title**: A short, descriptive label (under 80 characters). Reads as a bug title, not a sentence.
- **Severity**: As defined in the relevant rubric (`evaluators/structural-rubric.md`, `evaluators/ux-coherence-rubric.md`). For AI output findings, NOT_CREDIBLE maps to CRITICAL, QUESTIONABLE maps to MEDIUM.
- **Category**: One of four values matching the evaluator that produced the finding.
- **Step**: The step number from the transcript where the finding was first observed.
- **URL**: The exact URL from the `UIObservation` at that step.
- **Description**: What is wrong, stated factually. No hedging, no suggestions.
- **Evidence**: The raw proof. For structural findings, this is the HTTP status code or console error text. For AI output findings, this is the five-dimension score summary. For UX findings, this is the persona's in-character thought that reveals the confusion.
- **Persona Impact**: How the finding affected the persona. "Persona could not submit the form" or "Persona lost confidence in the valuation and considered abandoning."
- **Recommended Action**: A concrete next step for the engineering team. "Fix the 500 error in the parcels analysis endpoint" or "Add empty-state component to the leads list when no leads exist."

## File Structure

The findings file groups entries by severity, highest first:

```markdown
# Findings Report

- **Run ID**: <runId>
- **Persona**: <personaId>
- **Journey**: <journeyId>
- **Total Findings**: <count>

## CRITICAL

### STR-001: ...

## HIGH

### UX-001: ...

## MEDIUM

### AI-001: ...

## LOW

### STR-002: ...
```

Severity sections with no findings are omitted entirely.
