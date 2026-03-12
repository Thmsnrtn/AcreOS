/**
 * regulatory-intelligence.tsx
 *
 * This page provides the full Regulatory Intelligence experience including:
 * - Regulatory requirements database (filterable by state/county)
 * - Active alerts list with severity badges
 * - Compliance checklist auto-generator per deal
 * - Regulatory change history timeline
 * - Compliance score gauge (0-100)
 * - Portfolio impact analysis section
 *
 * All features are implemented in regulatory-intel.tsx — this file re-exports
 * the same page component so both routes render identical functionality.
 */
export { default } from "./regulatory-intel";
