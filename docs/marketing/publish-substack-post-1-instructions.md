# Publish post #1 on Substack — step-by-step

**Status:** awaiting Tom. Soren's first blog body is publish-ready;
Substack has no posting API, so the actual paste-and-publish step has
to happen manually. ~10 minutes.

## Before you start

- Publication: https://acreos.substack.com (logged in as the
  `acreagelandco@gmail.com` account)
- Source file: `docs/marketing/blog/the-buy-box-defined-six-filters.md`
- Frontmatter at the top of that file lists the verified sources, the
  target persona, and the SEO keywords — for reference only, don't
  paste them into the Substack body.

## Step 1 — Set up the publication shell (one-time, ~3 min)

1. Go to https://acreos.substack.com/publish/home
2. Click **Settings** (gear icon, bottom left)
3. Fill these fields, exact values:
   - **Publication name:** `AcreOS`
   - **Subdomain:** `acreos` (already locked in)
   - **Description:** *"Mechanics for property investors. Land flips, note
     books, deal pipelines, the slow compounding work."* (≤200 chars)
   - **Logo:** any AcreOS mark — skip if none yet; can add later.
   - **Categories:** pick "Business," sub-category "Real Estate" if offered
   - **About page:** copy from `docs/marketing/linkedin-org-page-setup.md`
     — the ~1180-char bio Soren wrote works on Substack with no edits.
4. Save settings. You can skip the email-import / paid-tier setup steps;
   we're in free-tier observe-mode until the warm channel proves itself.

## Step 2 — Create the post (~5 min)

1. Click **New post** (top right) → choose **Post** (not Thread or Note)
2. **Title** — paste exactly:
   ```
   The Buy-Box, Defined: Six Filters Every Land Investor Sets Before the First List
   ```
3. **Subtitle (optional but recommended)** — Soren's frontmatter
   contains the meta description; use:
   ```
   Mechanics, not hype. The six filters that turn an idea into a
   list that can pull overnight.
   ```
4. **Body** — open the source file, copy everything BELOW the closing
   `---` frontmatter delimiter (skip lines 1-N where N is the line of
   the second `---`), paste into the Substack editor.
5. Substack auto-converts markdown — your H2 / H3 / lists / bold all
   carry over. Verify nothing renders broken in the preview.
6. **Featured image** — skip; can add later. Substack handles missing
   images gracefully.
7. **Settings tab inside the post editor:**
   - **Send to:** Everyone (default; we have zero subscribers, but this
     wires the publication to email-on-publish for future readers)
   - **SEO description:** paste the meta description from the frontmatter
   - **Tags:** `land investing`, `buy box`, `real estate`, `mechanics`

## Step 3 — Publish (~30 sec)

1. Click **Continue** → **Publish now**
2. Substack will email the (currently zero) subscribers and place the
   post live at:
   ```
   https://acreos.substack.com/p/the-buy-box-defined-six-filters
   ```
3. Tell Solene "post #1 is live" and she will:
   - Add the post URL to the content runway doc as `shipped`
   - Wire a "Field Notes" subscribe section into the AcreOS landing
     (currently only the footer link goes to Substack)
   - Queue Soren on blog post #2 from the runway

## Why the manual step

Substack has no public REST API for content creation. Their write-side
APIs are reserved for paid Substack Pro accounts and even those don't
expose a clean POST /publish endpoint. The cost of a workaround
(headless browser scripting via Playwright) doesn't pay off until we
have 5+ posts/month, which we won't for a while.

The constraint binds; we work with it. Posting 1 essay every 2 weeks
manually takes 10 minutes of your time per post and frees the team to
work on substantive code.
