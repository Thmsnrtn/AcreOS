# AcreOS Customer Support Playbook

## Response Guidelines

- Respond within 4 hours during business hours, 24 hours otherwise
- Lead with empathy: acknowledge the issue before jumping to solutions
- Be specific: steps, not vague instructions
- Close with: "Let me know if you need anything else."

---

## 1. "How do I import leads?"

Hi! Importing leads is straightforward:

1. Go to **Leads** in the sidebar
2. Click **Import** (top right)
3. Upload a CSV file with your leads
4. AcreOS auto-maps common column names (first_name, last_name, email, phone, address, city, state, zip, status)
5. For any columns that don't auto-map, select the matching AcreOS field from the dropdown
6. Click **Import** — your leads will appear in the list within a few seconds

**CSV requirements:** UTF-8 encoding, comma-separated, headers in the first row. At minimum, include first name + last name + one contact method (email, phone, or address).

Let me know if you need help with the column mapping!

---

## 2. "My payment failed"

Sorry about that — let me help you fix this:

1. Go to **Settings → Billing** and check the payment method on file
2. Make sure the card hasn't expired and has sufficient funds
3. If the card looks good, click **Retry Payment**
4. If it still fails, try adding a different card via **Update Payment Method**

Common causes: expired card, insufficient funds, or your bank blocked the charge as unfamiliar. If none of that works, let me know and I'll check on our end.

---

## 3. "How do I cancel?"

I'm sorry to see you go. Here's how:

1. Go to **Settings → Billing**
2. Click **Cancel Subscription**
3. Confirm the cancellation

Your account will remain active through the end of your current billing period. After that, you'll move to the Free tier — all your data is preserved. You can re-subscribe anytime and pick up right where you left off.

If there's something specific that's not working for you, I'd love to hear about it — maybe I can help.

---

## 4. "The enrichment data looks wrong"

Thanks for flagging this. A few questions to help me investigate:

1. Which property (APN or address)?
2. Which data point looks incorrect (flood zone, soil, elevation, etc.)?
3. Do you have a source showing the correct value?

Sometimes government data sources have known inaccuracies or haven't been updated recently. Here's what you can do:

1. Click **Re-Enrich** on the property page to pull fresh data from all sources
2. If the data is still wrong, you can manually override any field on the property page
3. I'll report the discrepancy to our data team so we can improve accuracy for that source

---

## 5. "How do I create a seller-financed note?"

Great question! Here's the step-by-step:

1. Go to **Finance** in the sidebar (or click **Finance** on a closed deal)
2. Click **Create Note**
3. Fill in the terms:
   - **Purchase price** — total sale price
   - **Down payment** — amount paid upfront
   - **Interest rate** — annual rate
   - **Term** — number of months
   - **Payment start date** — when the first payment is due
   - **Balloon payment** (optional) — lump sum due at end of term
4. AcreOS generates the amortization schedule automatically
5. The Dodd-Frank compliance checker runs in real-time — if anything's out of compliance, you'll see a flag before you finalize

Once created, you can set up the borrower portal so your buyer can view their balance and make payments.

---

## 6. "How do I connect my own data provider (BYOK)?"

BYOK is available on the Pro plan. Here's how:

1. Go to **Settings → Integrations**
2. Find the provider you want to connect (Regrid, ATTOM, or BatchData)
3. Click **Connect** and enter your API key
4. Click **Test Connection** to verify it works
5. Once connected, all lookups for that provider will use your key instead of platform credits

You'll need an active account with the data provider. Their pricing applies directly — AcreOS doesn't add any markup.

---

## 7. "How do I share a deal with my attorney?"

1. Open the deal you want to share
2. Click **Share** (in the actions area, top right)
3. Click **Create Share Link**
4. Copy the link and send it to your attorney

The link gives read-only access to the deal details, documents, and timeline. No login required. The link expires after 30 days by default — you can set a custom expiration.

---

## 8. "The app won't load"

Sorry about that. Let's troubleshoot:

1. **Clear your browser cache** and try again (Ctrl+Shift+Delete → clear cached files)
2. **Try incognito/private mode** — this rules out extension conflicts
3. **Try a different browser** — Chrome and Firefox work best
4. **Check your internet connection** — can you load other sites?
5. **Check our status:** if the app is having issues, you'll see an error message on the login page

If none of that works, let me know your browser, OS, and any error messages you see. I'll investigate on our end.

---

## 9. "How do I export my data?"

1. Go to **Settings → Data**
2. Click **Export All**
3. Choose your format: **JSON** (structured, includes all relationships) or **CSV** (tabular, one file per entity type)
4. Click **Start Export** — you'll get an email when it's ready to download

The export includes: leads, properties, deals, notes, payments, documents, activity log, and campaign records. Your data is yours — export anytime.

---

## 10. "I want to upgrade my plan"

1. Go to **Settings → Billing**
2. Click **Change Plan**
3. Select your new plan (Starter or Pro)
4. Confirm — the upgrade takes effect immediately

You'll be prorated for the current billing period (only charged the difference). All features on the new plan are available right away.

---

## 11. "Can I import from Pebble?"

Yes! Here's how:

1. In Pebble, export your leads as CSV (Leads → Export)
2. In AcreOS, go to **Leads → Import**
3. Upload the CSV — AcreOS will auto-map most Pebble fields
4. For any fields that don't auto-map, match them manually
5. Click **Import**

Most Pebble fields map cleanly. If you have custom fields in Pebble, you may need to create matching custom fields in AcreOS first (Leads → Settings → Custom Fields).

---

## 12. "How does the Deal Feed work?"

The Deal Feed scans your target counties daily and surfaces the best investment opportunities.

**How it scores:** Each opportunity gets a composite score (0-100) based on four factors:
- **Acquisition Radar** (30%) — how well the parcel matches your buying criteria
- **Seller Motivation** (30%) — tax delinquency, out-of-state owner, estate ownership
- **County Market** (20%) — price trends, transaction volume, demand indicators
- **Land Credit Score** (20%) — physical characteristics (flood, soil, access, etc.)

**How it learns:** When you pass on an opportunity (or close a deal), the system adjusts its scoring to better match your preferences. Over time, the top opportunities get more relevant to your specific strategy.

**Setup:** Go to **Settings → Counties** and add your target counties. The feed generates automatically.

---

## 13. "What's the Land Credit Score?"

The Land Credit Score (LCS) is a 300-850 rating of a parcel's investment quality — like a FICO score for land.

**6 dimensions:**
1. **Flood risk** — FEMA flood zone data (Zone X = high score, Zone A = low)
2. **Soil quality** — USDA soil data (drainage, agricultural capability)
3. **Access** — road proximity and type (paved = high, no access = low)
4. **Utilities** — proximity to power, water, sewer
5. **Topography** — slope and elevation (gentle = high, steep = low)
6. **Environmental** — EPA contamination, wetlands, endangered species

Each dimension is transparent — click into the score to see exactly why a parcel scored the way it did. Higher scores generally mean more profitable deals with fewer surprises.

---

## 14. "My note payment is late"

AcreOS handles late payments automatically based on your settings:

1. **Grace period** (default: 10 days) — no action taken
2. **Day 11:** Automatic reminder sent to the borrower
3. **Day 16:** Late fee applied (configured in note settings)
4. **Day 21:** Second reminder + phone call task created for you
5. **Day 30:** Formal notice of default sent

You can customize the dunning timeline in **Finance → Settings → Dunning**.

If you need to take manual action:
- Go to **Finance → Notes → [select note]**
- Click **Record Payment** to log a payment manually
- Click **Waive Late Fee** if you want to remove a fee
- Click **Contact Borrower** to send a direct message

---

## 15. "How do I set up campaigns?"

1. Go to **Campaigns** in the sidebar
2. Click **New Campaign**
3. **Select your audience:** filter leads by county, status, score, source, or custom criteria
4. **Choose your channel:** email, SMS, or direct mail
5. **Write your message:** type it yourself, or click **Generate Copy** to have the AI draft a message matching your communication style
6. **Preview:** review the message and audience count
7. **Send:** the campaign goes out, and all responses are automatically linked back to the originating lead

For drip campaigns (automated multi-step sequences), go to **Campaigns → Sequences → New Sequence** and configure the steps, delays, and conditions.

Let me know if you need anything else!
