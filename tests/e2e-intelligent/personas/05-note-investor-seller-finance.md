---
id: note-investor-seller-finance
name: James Folkes
age: 52
location: Columbus, Ohio
years_investing: 8
capital_available: $75,000-$150,000
investment_thesis: Buy land at wholesale prices and resell on seller-financed terms to create a portfolio of performing notes generating predictable monthly cash flow
source_of_interest: Attended a local real estate meetup in 2018 where a speaker described seller-financed land notes as "mailbox money with no landlord headaches"
tech_comfort: medium
patience: medium
preferred_device: desktop
competitor_mental_model: none
assigned_journeys: [04, 09, 10]
viewport: { width: 1440, height: 900 }
success_criteria:
  - Can model a seller-finance deal with down payment, interest rate, term, and monthly payment
  - Note portfolio view shows active notes, payment history, and remaining balances
  - Can track which buyers are current, late, or in default
  - Amortization schedules can be generated and exported or printed
  - System handles partial payments and payment application correctly
abandonment_triggers:
  - No seller-finance or note tracking capability — app only handles buy/sell, not carry
  - Payment tracking is too simplistic — no handling of late fees, partial payments, or escrow
  - Can't calculate or display an amortization schedule
  - Financial calculations don't match his spreadsheet when he spot-checks
  - Terms like "note" or "seller finance" are absent from the UI vocabulary
---

# Backstory

James Folkes is a former high school math teacher who took early retirement at 48 after his wife's career in pharmaceutical sales removed the financial pressure. He'd been dabbling in real estate since his mid-forties, starting with a duplex that he managed himself and hated. The tenants, the maintenance, the calls about a broken garbage disposal at 9 PM on a Wednesday — it wasn't the passive income he'd been promised. He sold the duplex at a small profit and swore off rentals.

Then he found land notes. A speaker at the Columbus REIA described a model that made James's math-teacher brain light up: buy a $5,000 lot, sell it for $15,000 with $2,500 down, 9% interest, 60-month term. Monthly payment: roughly $259. Yield on investment: extraordinary. Default rate: low, because the payments are affordable and the buyers want the land. And if they do default, you get the land back and do it again.

James now holds 14 active notes. He buys 5-6 lots per year at tax sales or through direct mail, improves the listing with photos and a basic listing page, and sells on terms. His buyers are mostly people who want a place to park an RV, put a mobile home, or just own a piece of land for the first time. He charges between 8% and 11% interest depending on the down payment. His monthly income from notes is about $3,400, and it grows every quarter.

He tracks everything in an Excel workbook with a tab for each note. Each tab has an amortization schedule, a payment log, and a status flag. It works, but it's fragile — he once accidentally deleted a formula row and spent a Saturday afternoon reconstructing six months of payment history. His wife suggested he find "an app for that."

James doesn't have a competitor mental model because no tool he's found actually handles what he does. PropStream is for finding deals, not managing notes. Podio is for pipelines, not amortization. He looked at loan servicing software, but those are designed for mortgage companies, not a guy with 14 notes in a spreadsheet. He wants something in between.

The things he'd say out loud while using AcreOS:

"So I just bought a lot in Muskingum County for $3,200. Where do I enter the purchase, and then set up the seller-finance terms?"

"Can I put in a custom amortization? I do 9.5% on a 48-month term with $1,500 down. Let me see if the math matches my spreadsheet."

"Oh, it shows me which notes are current and which are behind. That's... actually really useful. Can I send a reminder from here?"

"Wait, this buyer made a partial payment last month — $180 instead of $259. How does the system apply that? Interest first, then principal? That matters."

"I don't need to search for deals right now. I need to manage the deals I already have. Is there a way to skip the CRM stuff and go straight to my notes?"

"If this can generate year-end statements for my buyers and my accountant, I'll switch today. Right now I do that by hand and it takes an entire weekend."

James is patient but precise. He won't get frustrated by a learning curve, but he will get frustrated by math errors. If the amortization schedule shows a remaining balance that's off by even $20 from his manual calculation, he'll lose confidence in the entire system. Accuracy in financial calculations isn't a nice-to-have for James — it's the only thing that matters. Everything else is just UI.
