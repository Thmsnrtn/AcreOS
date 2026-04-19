# UX Coherence Rubric

Rules for evaluating the coherence, navigability, and clarity of the AcreOS user interface as experienced by a persona during a journey.

## What Is Checked

### Screen-to-Screen Coherence

When the persona navigates from one screen to another, the transition should make sense. The destination should match what the clicked element promised. Breadcrumbs, page titles, and navigation highlights should update to reflect the current location. If data was entered on a previous screen, it should persist or be clearly summarized on the next.

### Dead-End Paths

A dead end is any screen where the persona has no clear next action and no way to return to a productive state without using the browser back button. Pages that load with no content, no empty-state message, and no CTA are dead ends. Modal dialogs that cannot be dismissed are dead ends.

### Broken Affordances

An element that looks interactive but does nothing (a button that does not respond to clicks, a link styled as text, a dropdown that does not open). Also: elements that do the wrong thing (a "Save" button that navigates away without saving, a "Delete" that does not confirm).

### Information Hierarchy

Can the persona find what they need without scanning the entire page? Key data (parcel value, lead status, AI analysis results) should be visually prominent. Secondary information should be accessible but not competing for attention. Long pages should have structure (sections, headings, expandable areas).

### Empty States

When a list, table, or dashboard section has no data, the application should show an `EmptyState` component with a clear explanation and a CTA to populate it. A blank area with no guidance is a finding.

### Jargon and Labeling

Labels, tooltips, and instructional text should use terminology that the persona understands given their `techComfort` and experience level. Internal system terms exposed to users (database column names, enum values, developer shorthand) are findings.

## Severity by Impact

| Severity | Criteria |
|---|---|
| **CRITICAL** | The persona cannot determine how to proceed. The UI provides no path forward and no error message. Effectively a dead end on a core flow. |
| **HIGH** | The persona can eventually proceed but only after significant confusion (backtracking, re-reading, trial and error). The UI actively misleads. |
| **MEDIUM** | The persona notices an inconsistency or unclear label but can still proceed with reasonable confidence. Experience is degraded but not blocked. |
| **LOW** | Minor cosmetic or labeling issue that the persona may not even consciously register. Noted for polish but does not affect the journey outcome. |

## Recording

Each UX coherence finding is recorded with: an auto-generated ID (e.g., `UX-001`), the step number, the URL, the specific element or transition involved, a description of the problem, and the severity. The persona's in-character thought at that step provides the evidence for how the issue was perceived.
