# Structural Rubric

Rules for identifying and classifying structural defects observed during an E2E intelligent test run.

## What Counts as a Structural Finding

A structural finding is any browser-observable defect that exists independently of the persona's goals or workflow. These are product bugs, not opinion.

- **HTTP errors**: Any 4xx or 5xx response from the AcreOS server (observed via network activity or error pages).
- **Console errors**: Unhandled exceptions, failed fetch calls, React rendering errors, or any `console.error` output captured by the harness.
- **Broken navigation**: A link or button that leads to a blank page, a 404, an infinite redirect loop, or a URL that does not resolve within the application.
- **Missing elements**: A page that loads but is missing expected interactive elements (e.g., a form with no submit button, a table header with no rows and no empty-state component).
- **Timeout**: Any page or API call that does not complete within the journey's configured `timeoutMinutes`. A page that takes more than 8 seconds to become interactive is also a finding at MEDIUM severity.

## Severity Levels

| Severity | Definition | Example |
|---|---|---|
| **CRITICAL** | A 5xx error or total failure on a core product flow (dashboard, parcel analysis, lead management, AI assistant). The user cannot proceed. | `500 Internal Server Error` on `/api/parcels/:id/analysis` |
| **HIGH** | A broken affordance that blocks a meaningful action but has a workaround, or a 4xx error that indicates a real product bug (not user error). | "Add Lead" button triggers a 422 with no validation message; clicking "Export" downloads an empty file |
| **MEDIUM** | A console warning or error that does not block the user but indicates a latent defect. Also: slow loads (3-8 seconds) that degrade experience without blocking. | React `key` warning in the lead list; `Failed to load` console error for a non-critical resource |
| **LOW** | Cosmetic or minor: a slow load that resolves (under 3 seconds but perceptible), a deprecation warning in the console, a tooltip that does not appear. | `console.warn` about a deprecated API; image loads after a visible delay |

## Recording

Each structural finding is recorded with: an auto-generated ID (e.g., `STR-001`), the step number where it was observed, the URL, a short description, the raw evidence (error text, status code, or console output), and the severity level. Findings appear in both the transcript and the aggregated findings file.
