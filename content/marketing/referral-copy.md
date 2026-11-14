# AcreOS Referral Program Copy

<!-- Terms source of truth: server/services/referralReward.ts (P1-2 / CR-047).
     Referee: $49 account credit at their first paid invoice. Referrer: $49
     account credit after the referral stays an active subscriber for a
     30-day retention hold ($98 total if the referee chose annual billing),
     plus milestone bonuses of $100 at the 5th and $250 at the 10th converted
     referral. Credits apply to AcreOS invoices only — no cash out.
     tests/unit/referralCopyMatchesMachine.test.ts pins this file to those
     constants; if the machine's terms change, this copy must change with it. -->

## Referral Page

**Headline:** Share AcreOS. Get Rewarded.

**Description:** Know a fellow land investor who could use a better workflow? Send them your referral link. When they become a paying subscriber, they get a $49 account credit at their first paid invoice — and once they've stayed a subscriber for 30 days, you get a $49 credit too ($98 if they chose annual billing).

**How it works:**
1. Share your unique referral link (below)
2. Your friend signs up and starts using AcreOS
3. When their first paid invoice lands, they get a $49 account credit, applied automatically
4. Once they've stayed a subscriber for 30 days, you get a $49 account credit ($98 if they chose annual billing)
5. Bonus credits: $100 at your 5th converted referral and $250 at your 10th — no limit on how many people you refer

Credits apply to AcreOS invoices only.

---

## Shareable Referral Link CTA

**Button text:** Copy My Referral Link

**Toast on copy:** "Referral link copied! Share it with a fellow investor."

**Link format:** `https://app.acreos.io/signup?ref={USER_REFERRAL_CODE}`

---

## Email: "Invite a Fellow Investor"

**Subject:** Give a fellow investor the tool you wish you had earlier

**Body:**

Hey {firstName},

You've been using AcreOS for a while now, and I think you know investors who could benefit from it too.

Here's your referral link: {referralLink}

When someone signs up through your link and becomes a paying subscriber, they get a $49 account credit at their first paid invoice. Once they've stayed a subscriber for 30 days, you get a $49 credit too ($98 if they chose annual billing). No limit on how many people you refer.

Just forward this email or share the link in your investor group. The more people using AcreOS in your market, the better the market intelligence gets for everyone.

— Thomas

---

## Notification: Referral Signed Up

**Title:** {Name} signed up through your referral

**Body:** {firstName} {lastName} just created an AcreOS account using your referral link. When they become a paying subscriber, they'll get a $49 credit at their first paid invoice — and you'll get yours once they've stayed a subscriber for 30 days.

---

## Notification: Referral Became a Paying Subscriber

**Title:** Your referral just paid their first invoice

**Body:** {firstName} {lastName} became a paying subscriber — their $49 referral credit has been applied automatically. Yours lands once they've stayed a subscriber for 30 days.

---

## Notification: Referral Converted

**Title:** You earned a $49 credit!

**Body:** {firstName} {lastName} stayed a subscriber for 30 days — your $49 referral credit has been applied to your account. Keep sharing!

---

## Social Share Text

**Twitter/X:**
I've been using AcreOS for land investing — deal feed, due diligence from 18 data sources, note management, all in one. Sign up with my link and become a paying subscriber, and we both get a $49 credit — yours at your first paid invoice, mine after you've stayed 30 days. {referralLink}

**Facebook:**
Found a tool that actually consolidates my land investing workflow. AcreOS handles deal discovery, DD reports, campaigns, seller-financed notes, and compliance checking in one platform. If you sign up with my link and become a paying subscriber, we both get a $49 credit — yours at your first paid invoice, mine after you've stayed 30 days. {referralLink}

**Direct message (casual):**
Hey — been using this platform called AcreOS for my land deals. It's replaced Pebble + my spreadsheets + Mailchimp. If you want to try it, here's my referral link — we both get a $49 credit once you're a paying subscriber (yours at your first paid invoice, mine after you've stayed 30 days): {referralLink}
