# Persona 09 — Alex Petrov, Accessibility-Dependent User

## Demographics
- **Name:** Alex Petrov
- **Age:** 31
- **Location:** Richmond, Virginia
- **Role:** Data Analyst, independent consultant specializing in geospatial data for real estate firms

## Background

Alex lost his sight at 19 due to retinitis pigmentosa. He was already studying computer science at Virginia Tech and finished his degree. He has been fully blind for 12 years and has spent that entire time mastering assistive technology. He is not learning how to use a screen reader — he is an expert. He navigates complex enterprise applications (Jira, Confluence, Salesforce, QGIS with accessibility plugins) every day for paying clients. He files accessibility bugs with surgical precision, citing specific WCAG 2.1 success criteria by number.

Alex runs his own consulting practice. He evaluates land data for investment firms — county records, parcel geometries, zoning classifications, comparable sales. Three of his clients use AcreOS or are considering it. One client asked Alex to evaluate AcreOS's accessibility before they commit to a team-wide rollout. Alex agreed, partly as a professional engagement and partly because he might use AcreOS himself if it is accessible.

## Current Situation

Alex is sitting at his home office workstation:
- **OS:** Windows 11
- **Browser:** Firefox (latest stable)
- **Screen reader:** NVDA (latest stable)
- **Input:** Keyboard only (standard full-size keyboard)
- **Display:** Monitor is off. He does not use it.

Alex will navigate AcreOS entirely through NVDA's virtual buffer and keyboard interaction. He will hear every element on the page announced by NVDA — every heading, every link, every button, every image, every ARIA role. He will notice things sighted users never see: missing alt text, wrong heading hierarchy, elements announced as "clickable" with no role, focus order that jumps illogically across the page, modals that don't trap focus, modals that DO trap focus but don't release it.

He has a testing methodology. He will work through it systematically:
1. Page load and landmark navigation (do headings and landmarks exist and make sense?)
2. Interactive element reachability (can every actionable element be reached by Tab?)
3. Operable controls (can every reachable element be activated with Enter or Space?)
4. Form accessibility (are inputs labeled? Do error messages associate with fields?)
5. Dynamic content (do live regions announce changes? Do toasts/alerts reach the screen reader?)
6. Data tables (are they real `<table>` elements with `<th>` headers and scope attributes?)
7. Modal and dialog behavior (focus trap on open, focus return on close, Escape to dismiss)

## Goal for Using AcreOS

1. Determine whether AcreOS meets WCAG 2.1 Level AA compliance across all core workflows
2. Identify every accessibility barrier that would prevent a screen reader user from completing standard tasks (add a parcel, filter parcels, run an agent, view a report, change settings)
3. Produce a professional accessibility audit report for his client
4. If the product is accessible, use it himself as a data management tool for his consulting practice

## Technical Comfort Level

**Expert.** Alex is more technically proficient than 95% of AcreOS users. He:
- Understands the DOM, ARIA attributes, focus management, and live regions at an implementation level
- Can identify whether an accessibility issue is a missing ARIA label, a wrong role, a focus management bug, or a structural HTML problem — and he knows the difference matters
- Reads and writes JSON, CSV, and SQL daily
- Uses the command line extensively (PowerShell with NVDA)
- Files bugs with reproduction steps, expected behavior, actual behavior, and WCAG success criterion references

What he cannot do:
- Use a mouse or any pointer-based interaction
- Perceive visual-only feedback (color changes, animations, hover states, loading spinners that are not announced)
- Perceive spatial layout (he does not know that a button is "in the top right corner" — he knows it is the 47th focusable element on the page)

## Expectations Shaped by Other Products

| Product | Expectation Set |
|---------|----------------|
| **Jira** | Complex but navigable. Heading structure is logical. Forms are labeled. Keyboard shortcuts are documented and work. Board view is partially accessible (drag-and-drop has keyboard alternatives). |
| **Salesforce Lightning** | Mixed accessibility. Some components excellent, others broken. Alex knows which patterns work (standard form fields, list views) and which don't (custom Aura components, Canvas apps). He expects a product newer than Salesforce to do better, not worse. |
| **GitHub** | Strong accessibility baseline. Landmarks, headings, keyboard shortcuts, ARIA live regions for notifications. Sets Alex's bar for what a modern web app should achieve. |
| **Google Sheets** | Functional but painful. Screen reader mode exists but is slow. Alex tolerates it because there is no better alternative. He does NOT want AcreOS tables to be "Google Sheets level" — he wants them to be better. |

Alex's standard is not "can a screen reader technically parse this page." His standard is "can I complete the task as efficiently as a sighted user, or within a reasonable margin."

## Realistic Failure Modes

1. **Icon-only buttons without labels.** The toolbar has 8 icon buttons. None have `aria-label`. NVDA announces them as "button," "button," "button." Alex has no idea what any of them do. He tries each one and hopes nothing destructive happens.
2. **Focus trap in modal.** Alex opens a "Create Parcel" dialog. Focus is correctly moved into the dialog. He fills out the form and presses Escape. Nothing happens. He presses Tab — focus cycles within the dialog endlessly. He cannot escape. He has to close the browser tab and start over.
3. **Custom dropdown is not a dropdown.** A "Status" selector looks like a `<select>` to sighted users but is actually a `<div>` with click handlers. It has no ARIA role, no `aria-expanded`, no `aria-haspopup`. NVDA announces it as "text." Alex presses Enter — nothing happens. He presses Space — nothing happens. He cannot change the parcel status.
4. **Data table without headers.** The parcel list is rendered as a `<div>` grid with CSS, not a `<table>`. There are no `<th>` elements, no `scope` attributes, no `aria-colindex` or `aria-rowindex`. NVDA reads it as a wall of unsorted text: "123 Main Street New Active 5.2 acres Arizona..." Alex cannot tell which value belongs to which column.
5. **Toast notifications that don't announce.** Alex submits a form. A green toast appears in the bottom-right corner for 3 seconds: "Parcel saved successfully." NVDA says nothing. Alex does not know if the action succeeded or failed. He submits again. Now there are two duplicate parcels.
6. **Loading states invisible to screen reader.** Alex clicks "Run Agent." A spinner appears on screen. NVDA says nothing. Alex waits 10 seconds, hears nothing, and presses the button again. And again. He has now triggered the agent three times.
7. **Heading hierarchy is broken.** The page has an `<h1>` (logo/site name), then jumps to `<h4>` (section title), then has an `<h2>` (subsection), then `<h6>` (card title). NVDA's heading navigation (`H` key) reveals a structure that makes no semantic sense. Alex cannot build a mental model of the page.
8. **Color-only error indication.** A required field is empty. The border turns red. There is no text error message, no `aria-invalid`, no `aria-describedby` pointing to an error. Alex submits the form and gets a generic "Validation failed" toast (which also doesn't announce). He has no idea which field is wrong.

## What Would Make Him Abandon

Alex will close AcreOS and write a "not accessible, do not deploy" recommendation if:

- **Core workflows cannot be completed with keyboard alone.** If he cannot add a parcel, filter the list, or change a status using only keyboard and screen reader, the product is non-functional for him. Not "inconvenient" — non-functional.
- **Interactive elements are unlabeled.** If more than two buttons or controls lack accessible names, the product was not built with accessibility in mind. One missing label is a bug. Five missing labels is a policy.
- **Data tables are inaccessible.** If the primary data display (parcel list) cannot be navigated cell-by-cell with screen reader table commands, the product's core value proposition is inaccessible.
- **Dynamic feedback is invisible.** If form submissions, agent runs, and status changes produce no screen reader announcement, Alex is operating blind within blindness — he cannot trust any action he takes.
- **Focus management is broken.** If modals don't trap focus, or trapped focus cannot be escaped, or closing a modal sends focus to the top of the page instead of the trigger element, every interaction becomes a disorienting maze.

## Signature Quote

> "If I can't tab to it, it doesn't exist. If it doesn't announce, it didn't happen. I've been doing this for 12 years — I can tell in 5 minutes whether your team thought about accessibility or just checked a box."
