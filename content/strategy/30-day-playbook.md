# AcreOS 30-Day Post-Deploy Playbook

## Week 1: Deploy & Recruit

### Day 1 — Deploy
- Deploy to Fly.io (follow docs/deployment-checklist.md)
- Smoke test: create account, complete onboarding, verify sample data loads
- Configure Stripe webhook (production keys)
- Verify SES sender identity
- Confirm health endpoint returns green: `curl https://acreos.fly.dev/api/health`
- Set up Sentry error monitoring (verify first error capture)

### Day 2 — Record & Publish
- Record demo video using the script from content/demo/demo-script.md (3-5 min)
- Edit: add captions, trim dead air, export at 1080p
- Upload to YouTube (unlisted initially), Loom (for DMs), and keep a downloadable version
- Set up blog (Substack, Ghost, or simple /blog route on acreos.io)
- Publish the landing page with demo video embedded

### Day 3 — First Outreach
- Send beta DM #1 (beginner persona) to someone who posted "what software?" in a land investing group
- Post "18 Free Data Sources Every Land Investor Should Know" in one Facebook group
- Don't pitch AcreOS in the post — pure value. CTA is the closing paragraph of the blog post.
- Respond to 3 community questions with genuine, detailed answers (no product mention)

### Day 4 — Continue Outreach
- Send beta DMs #2 (active operator) and #3 (seller finance focused)
- Engage in 5+ community discussions — answer questions, share knowledge
- Follow up on any Day 3 responses

### Day 5 — More Outreach
- Send beta DMs #4 (team manager) and #5 (competitor switcher)
- Follow up on all unanswered DMs from Day 3-4 (one gentle follow-up per person)
- Post a helpful comment in r/LandInvesting

### Day 6-7 — Onboard
- For anyone who expressed interest: send them the signup link with a personal note
- Offer to screen share while they go through onboarding (15 min max)
- Watch how they use the product. Don't guide — observe. Take notes on confusion points.
- Fix any critical UX issues discovered during observation (same-day if possible)

---

## Week 2: Learn & Fix

### Day 8-10 — Rapid Fixes
- Compile feedback from Week 1 beta users into a prioritized list
- Fix the top 3 issues. Ship daily — one fix per day minimum.
- Email each beta user when their specific issue is fixed: "You mentioned X. Fixed it. Try it now."
- Monitor Sentry for new error types — fix any that affect user flows

### Day 11 — Content Push
- Publish "How I Automate My Land Investing Pipeline" on the blog
- Share in 1-2 communities where it's relevant (not spammy)
- Email the blog post to existing beta users: "Wrote about how the platform works under the hood"

### Day 12 — Demo Distribution
- Post the demo video in 2 land investing communities with a short intro: "Built this for land investors — here's a 3-minute walkthrough"
- Share on personal LinkedIn/Twitter with context about why you built it
- Send the video link to anyone who asked for more info but hasn't signed up

### Day 13-14 — More Onboarding
- Target: at least 5 active beta users by end of Week 2
- For new signups: repeat the screen share observation from Day 6-7
- Check activation metrics: how many completed onboarding? How many imported leads? How many ran a DD report?

---

## Week 3: Engage & Improve

### Day 15-17 — Deep Content
- Publish "Seller Financing for Land: The Complete Operational Guide"
- Share in seller finance / note investing communities
- Engage in 3+ community discussions per day — establish presence as a knowledgeable resource
- Track which posts/comments drive the most profile visits or DMs

### Day 18-19 — User Interviews
- Schedule 15-minute calls with each active beta user
- The 7 questions:
  1. What were you using before AcreOS?
  2. What's the first thing you do when you open AcreOS?
  3. What's the most useful feature you've found?
  4. What's confusing or annoying?
  5. What's missing that would make you pay for it?
  6. Would you recommend it to another investor? Why or why not?
  7. What would make you stop using it?
- Record the calls (with permission). Transcribe key quotes.

### Day 20-21 — Build What They Asked For
- Identify the #1 requested feature or fix from interview feedback
- Build and ship it within 48 hours
- Email users: "You asked for X. It's live. Here's how to use it."

---

## Week 4: Monetize

### Day 22-24 — Soft Upgrade Conversation
- Email beta users: "Your 90-day Pro access is still active. Here's what you'd lose on the free tier: [specific features they've used]."
- Frame it as information, not pressure: "I want to make sure you know what the tiers include so there are no surprises."
- For users who haven't engaged: send the "Features You Haven't Tried" email from the onboarding sequence

### Day 25-27 — First Revenue Target
- Goal: at least 1 paying customer at $20/month or $49/month
- For the most engaged beta users: direct message. "Would the Starter or Pro plan make sense for your workflow? I'm happy to walk through what each includes."
- Even $20/month = validation. It means someone will pay for what you built.
- If no conversions: diagnose why. Is it the product? The pricing? The audience?

### Day 28-30 — Assess & Plan
- Compile metrics:
  - Total signups
  - Activation rate (completed onboarding / total signups)
  - Feature usage (which features get used, which don't)
  - Retention (still logging in after 2+ weeks?)
  - Revenue (MRR, even if $0)
  - Feedback themes (top 5 requests/complaints)
- Write a Month 1 retrospective: what worked, what didn't, what to change
- Plan Month 2: double down on what worked, cut what didn't, add one major feature from user feedback
