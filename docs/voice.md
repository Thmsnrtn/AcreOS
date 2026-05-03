# AcreOS Voice & Microcopy Standards

The voice rules below are binding for all customer-facing surfaces (dashboards, modals,
empty states, toasts, marketing pages). Founder-only surfaces (`/founder*`) follow the
same rules but may use the founder vocabulary (Sophie, Forge, Atlas, etc.) where
appropriate. Customer surfaces only ever see Pax.

These rules are derived from `CLAUDE.md`, the persona architecture memory, the v6
positioning work, and `docs/exhaustive-completion/_ACTION-PLAN.md`.

---

## 1. Audience & terminology

- **"Land Investors"** is the canonical audience label. Never write "real estate
  professional," "real estate agent," "realtor," or "land flipper" in customer copy.
- **No competitor name references.** Zero mentions of Land Geek, GeekPay, LG Pass,
  Mark Podolsky, REI Pro, PropStream, BatchLeads, etc. — even comparatively.
- **No founder-codename leaks.** Customers must only see "Pax." Never expose Sophie,
  Forge, Atlas, Eleanor, Nova, or other internal agent names in customer surfaces.
  Founder-only surfaces (`/founder*`) may use them.
- **Avoid "AI-powered" framing.** Say "the assistant," "Pax," or describe the actual
  capability ("Pax drafted three offers"). Never write "AI-powered insights,"
  "powered by AI," or "AI magic."

## 2. Tone

- **Plain English over jargon.** Prefer "we couldn't find that" over "resource not
  found." Prefer "your saved searches" over "persisted query criteria."
- **Active voice.** Write "we sent the offer" not "the offer was sent."
- **Concise.** Button labels are 1–3 words. No "click here." No "please."
- **Specific.** "3 leads need a reply" beats "you have new activity."
- **Calm and direct.** No exclamation marks except in genuine celebration moments.
  No emoji except where the user explicitly opts in (reactions, custom tags).

## 3. Buttons & links

- Use verbs: "Send offer," "Skip trace," "Add property."
- Sentence-case (not Title Case): "Send offer" not "Send Offer."
- Destructive actions name the thing: "Delete lead" not "Delete."
- Avoid "Submit," "OK," "Click here," "Learn more" with no context.

## 4. Empty states

- One sentence describing what lives here when populated.
- One purposeful CTA (the action that produces the first item).
- Use the `EmptyState` component from `client/src/components/empty-states/`.

## 5. Loading states

- Use `Skeleton` components shaped like the content. Never spinners.

## 6. Error messages

Every error explains **why** in plain English and gives a **CTA**. The canonical
error mapping lives in `client/src/lib/error-utils.ts`:

| HTTP / kind  | Message                                                                                               |
|--------------|-------------------------------------------------------------------------------------------------------|
| 401          | "You're signed out. Refresh and sign back in."                                                        |
| 403          | "You don't have permission for that. Ask the org owner if you need access."                           |
| 404          | "We couldn't find that. It may have been deleted."                                                    |
| 422          | "We couldn't process that — check the highlighted fields."                                            |
| 429          | "You're moving too fast. Try again in a moment."                                                      |
| 500/502/503  | "Something on our end. Refresh; if it persists, /security has our incident channel."                  |
| Network      | "Connection issue. Check your internet."                                                              |

Server-side error responses must conform to `{ error, message, details?, statusCode }`
via the `Errors.*` helpers in `server/utils/errors.ts`. Client-side renderers must
classify by status code first, message second.

## 7. Domain glossary tooltips

Land-investing has dense vocabulary (yellow letter, AVM, ALTA, executory contract,
§5.069, etc.). Wrap first or prominent uses with `<GlossaryTerm slug="...">` so the
definition is one hover/tap away. The registry lives in `client/src/lib/glossary.ts`
and the component in `client/src/components/Glossary.tsx`.

Do **not** wrap every occurrence on a page. Wrap the first prominent occurrence per
view, plus any occurrence in a place where the user is most likely to be confused
(empty states, onboarding, error toasts).

## 8. Numbers & money

- Use `tabular-nums` for any column of numbers.
- Money: `usd()` from `client/src/lib/format.ts`. Default to no cents above $100.
- Acres: one decimal place under 100, integer above.
- Dates: relative for the last 7 days ("3 days ago"), absolute beyond ("Mar 14").

## 9. Accessibility

- Every icon-only button has `aria-label`.
- Every interactive element has a visible focus state.
- Every form input has an associated label.
- Glossary terms expose definitions via `aria-describedby`.

## 10. Don'ts (quick reference)

- Avoid "Real estate professional" → use "Land investor"
- Avoid "AI-powered insights" → use "What Pax noticed"
- Avoid "Click here to learn more" → use "See setup guide"
- Avoid "An error occurred." → use "We couldn't save that. Check your connection and try again."
- Avoid "Sophie suggests..." on customer surfaces → use "Pax suggests..."
- Avoid "Submit" → use "Send offer" / "Save lead" / etc.
