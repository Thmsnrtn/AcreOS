/**
 * ⌘K palette verb DATA — the 30 PALETTE_VERBS records.
 *
 * Source of truth for the verb registry, but NOT part of the client
 * bundle: the command palette loads the same data as the served asset
 * /palette-verbs.json (generated verbatim from PALETTE_VERBS below)
 * through the shared static-data loader, so the records ship as data,
 * not JS (the BD-6 / legal-docs / #680 pattern; tests/unit/
 * staticDataServedAsData.test.ts pins the asset deep-equal to this
 * module and byte-identical to the generator's output, so the two
 * cannot drift). The types, the loaded-shape guard and the loading
 * hook stay in client/src/lib/cmdkVerbs.ts. Tests import this module
 * synchronously; client code must not value-import it (type-only
 * imports are erased and fine).
 *
 * Labels still resolve from `@/lib/labels.ts` Verbs canon (Wave 9) at
 * generation time, so the palette stays in lockstep with buttons +
 * toasts elsewhere in the app — the asset carries the resolved canon
 * strings, baked in by the generator.
 *
 * Each verb is a pure data record:
 *   • `id`        stable key (telemetry + recency tracking)
 *   • `label`     user-visible string (must be a `Verbs` value)
 *   • `path`      route the palette navigates to on selection
 *   • `keywords`  extra haystack terms for the matcher (e.g. aliases,
 *                 verb-related synonyms users type instead of the verb)
 *   • `scope`     which scope chip surfaces this verb when active
 *   • `iconKey`   lucide-react icon name (resolved in command-palette.tsx)
 *
 * Side-effect verbs that need a modal use `path` with a `?action=` query
 * string — the destination page reads it and opens the modal. This
 * keeps the palette stateless.
 *
 * Regenerate the asset after editing:
 *   npx tsx -e 'import {PALETTE_VERBS} from "./client/src/data/cmdk-verbs-data"; import fs from "node:fs"; fs.writeFileSync("client/public/palette-verbs.json", JSON.stringify(PALETTE_VERBS,null,2)+"\n")'
 */

import { Verbs } from "@/lib/labels";
import type { PaletteVerb } from "@/lib/cmdkVerbs";

/**
 * 30 verbs spanning the full lifecycle. Order doesn't matter — the
 * matcher re-sorts on every keystroke.
 */
export const PALETTE_VERBS: readonly PaletteVerb[] = [
  // ── Lead lifecycle ──────────────────────────────────────────────────
  {
    id: "verb:lead-add",
    label: Verbs.LEAD_CREATE,
    hint: "Capture a new lead",
    path: "/leads?new=true",
    keywords: ["lead", "new", "create", "capture", "prospect"],
    scope: "leads",
    iconKey: "UserPlus",
  },
  {
    id: "verb:lead-edit",
    label: Verbs.LEAD_EDIT,
    path: "/leads",
    keywords: ["update", "modify", "change"],
    scope: "leads",
    iconKey: "ClipboardList",
  },
  {
    id: "verb:lead-mark-contacted",
    label: Verbs.LEAD_CONTACT,
    hint: "Log that you spoke or wrote",
    path: "/leads?action=mark-contacted",
    keywords: ["contacted", "called", "reached", "outreach"],
    scope: "leads",
    iconKey: "CheckCircle",
  },
  {
    id: "verb:lead-qualify",
    label: Verbs.LEAD_QUALIFY,
    path: "/leads?action=qualify",
    keywords: ["qualify", "score", "vet"],
    scope: "leads",
    iconKey: "Filter",
  },
  {
    id: "verb:lead-dismiss",
    label: Verbs.LEAD_DISMISS,
    path: "/leads?action=dismiss",
    keywords: ["dismiss", "reject", "drop"],
    scope: "leads",
    iconKey: "Trash2",
  },
  {
    id: "verb:lead-assign",
    label: Verbs.LEAD_ASSIGN,
    path: "/leads?action=assign",
    keywords: ["assign", "delegate", "team"],
    scope: "leads",
    iconKey: "Users",
  },
  {
    id: "verb:skip-trace",
    label: "Skip trace",
    hint: "Look up phone, email, & address",
    path: "/leads?action=skip-trace",
    keywords: ["skip", "trace", "lookup", "find", "owner"],
    scope: "leads",
    iconKey: "Search",
  },

  // ── Property lifecycle ──────────────────────────────────────────────
  {
    id: "verb:property-add",
    label: Verbs.PROPERTY_CREATE,
    path: "/properties?new=true",
    keywords: ["parcel", "land", "new"],
    scope: "properties",
    iconKey: "Home",
  },
  {
    id: "verb:property-edit",
    label: Verbs.PROPERTY_EDIT,
    path: "/properties",
    keywords: ["update", "edit"],
    scope: "properties",
    iconKey: "Building2",
  },
  {
    id: "verb:run-avm",
    label: Verbs.PROPERTY_RUN_AVM,
    hint: "Run the valuation model",
    path: "/avm",
    keywords: ["avm", "valuation", "value", "estimate", "appraisal"],
    scope: "properties",
    iconKey: "TrendingUp",
  },
  {
    id: "verb:property-flag-dd",
    label: Verbs.PROPERTY_FLAG_DD,
    path: "/properties?action=flag-dd",
    keywords: ["due", "diligence", "dd", "review"],
    scope: "properties",
    iconKey: "Tag",
  },

  // ── Deal lifecycle ──────────────────────────────────────────────────
  {
    id: "verb:deal-new",
    label: Verbs.DEAL_CREATE,
    path: "/deals?new=true",
    keywords: ["deal", "transaction", "open"],
    scope: "deals",
    iconKey: "FileText",
  },
  {
    id: "verb:deal-advance",
    label: Verbs.DEAL_ADVANCE,
    path: "/deals?action=advance",
    keywords: ["advance", "next", "progress", "stage"],
    scope: "deals",
    iconKey: "Handshake",
  },
  {
    id: "verb:deal-close-won",
    label: Verbs.DEAL_CLOSE_WON,
    path: "/deals?action=close-won",
    keywords: ["won", "closed", "closing", "complete"],
    scope: "deals",
    iconKey: "CheckCircle",
  },
  {
    id: "verb:deal-close-lost",
    label: Verbs.DEAL_CLOSE_LOST,
    path: "/deals?action=close-lost",
    keywords: ["lost", "dead", "killed"],
    scope: "deals",
    iconKey: "Trash2",
  },
  {
    id: "verb:deal-reopen",
    label: Verbs.DEAL_REOPEN,
    path: "/deals?action=reopen",
    keywords: ["reopen", "revive"],
    scope: "deals",
    iconKey: "RefreshCw",
  },
  {
    id: "verb:generate-offer",
    label: "Generate offer",
    hint: "Draft an offer letter",
    path: "/offers?generate=true",
    keywords: ["offer", "draft", "letter", "generate"],
    scope: "deals",
    iconKey: "Sparkles",
  },

  // ── Communication ───────────────────────────────────────────────────
  {
    id: "verb:send-letter",
    label: Verbs.SEND_LETTER,
    path: "/campaigns?action=send-letter",
    keywords: ["mail", "post", "letter", "direct"],
    scope: "inbox",
    iconKey: "Mail",
  },
  {
    id: "verb:send-text",
    label: Verbs.SEND_SMS,
    path: "/campaigns?action=send-text",
    keywords: ["sms", "text", "message"],
    scope: "inbox",
    iconKey: "MessageSquare",
  },
  {
    id: "verb:send-email",
    label: Verbs.SEND_EMAIL,
    path: "/inbox?action=compose",
    keywords: ["email", "compose", "send"],
    scope: "inbox",
    iconKey: "Send",
  },
  {
    id: "verb:make-call",
    label: Verbs.CALL,
    hint: "Place a call from a lead's record",
    path: "/leads?action=call",
    keywords: ["call", "dial", "phone"],
    scope: "inbox",
    iconKey: "Phone",
  },
  {
    id: "verb:new-task",
    label: "New task",
    path: "/tasks?action=new",
    keywords: ["task", "todo", "remind"],
    scope: "global",
    iconKey: "ListTodo",
  },

  // ── Generic CRUD ────────────────────────────────────────────────────
  {
    id: "verb:archive",
    label: Verbs.ARCHIVE,
    path: "/?action=archive",
    keywords: ["archive", "hide", "stash"],
    scope: "global",
    iconKey: "Archive",
  },
  {
    id: "verb:restore",
    label: Verbs.RESTORE,
    path: "/?action=restore",
    keywords: ["restore", "unarchive"],
    scope: "global",
    iconKey: "RefreshCw",
  },
  {
    id: "verb:delete",
    label: Verbs.DELETE,
    path: "/?action=delete",
    keywords: ["delete", "remove", "trash"],
    scope: "global",
    iconKey: "Trash2",
  },
  {
    id: "verb:export",
    label: Verbs.EXPORT,
    hint: "Download CSV / Excel",
    path: "/?action=export",
    keywords: ["export", "download", "csv", "excel"],
    scope: "global",
    iconKey: "Download",
  },
  {
    id: "verb:import",
    label: Verbs.IMPORT,
    hint: "Upload CSV / mapping",
    path: "/?action=import",
    keywords: ["import", "upload", "csv", "load"],
    scope: "global",
    iconKey: "Upload",
  },

  // ── Org / settings ──────────────────────────────────────────────────
  {
    id: "verb:switch-org",
    label: "Switch organization",
    hint: "Change the active workspace",
    path: "/settings?tab=org",
    keywords: ["org", "organization", "workspace", "switch", "change"],
    scope: "settings",
    iconKey: "Settings",
  },
  {
    id: "verb:invite-teammate",
    label: "Invite teammate",
    path: "/settings?tab=team",
    keywords: ["invite", "team", "user", "add"],
    scope: "settings",
    iconKey: "UserPlus",
  },
  {
    id: "verb:open-billing",
    label: "Open billing",
    path: "/settings?tab=billing",
    keywords: ["billing", "subscription", "plan", "invoice"],
    scope: "settings",
    iconKey: "DollarSign",
  },
];
