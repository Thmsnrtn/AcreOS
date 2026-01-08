# AcreOS Owner's Manual

## Complete Guide to the Land Investment Management Platform

**Version 1.0**

---

# Table of Contents

1. [Getting Started](#part-1-getting-started)
2. [Leads Management](#part-2-leads-management)
3. [Properties](#part-3-properties)
4. [Deals Pipeline](#part-4-deals-pipeline)
5. [Finance Module](#part-5-finance-module)
6. [Marketing & Campaigns](#part-6-marketing--campaigns)
7. [AI Agents & Command Center](#part-7-ai-agents--command-center)
8. [Team & Collaboration](#part-8-team--collaboration)
9. [Billing, Credits & BYOK](#part-9-billing-credits--byok)
10. [Settings & Administration](#part-10-settings--administration)
11. [Founder Dashboard](#part-11-founder-dashboard)
12. [Appendices](#appendices)

---

# Part 1: Getting Started

## Welcome to AcreOS

AcreOS is a comprehensive platform designed specifically for land investors. Whether you're flipping vacant land, investing in seller-financed notes, or running a hybrid business, AcreOS provides the tools you need to manage your entire operation from a single dashboard.

The platform combines CRM functionality, property management, deal tracking, seller financing, marketing automation, and AI-powered insights into one unified system.

## Creating Your Account

### Sign In Process

1. Navigate to the AcreOS login page
2. Click "Continue with Replit" to authenticate using your Replit account
3. Upon first login, an organization is automatically created for you
4. You become the owner of this organization with full administrative access

### What Happens on First Login

When you first sign in:
- A new organization is created using your username
- You're assigned as the organization owner
- Default settings are configured for you
- You'll see an optional onboarding wizard to help you get started

## Understanding the Dashboard

### Main Navigation

The sidebar on the left provides access to all major areas of AcreOS:

| Section | Description |
|---------|-------------|
| **Dashboard** | Overview of your business metrics and recent activity |
| **Inbox** | Unified inbox for all communications (email responses, SMS, etc.) |
| **Leads (CRM)** | Manage your seller and buyer contacts |
| **Inventory** | Track properties in your pipeline |
| **Deal Pipeline** | Kanban-style board for managing deals |
| **Tasks** | Your personal and team task list |
| **Automation** | Set up automated workflows and sequences |
| **Insights** | Analytics and performance metrics |
| **Finance** | Seller financing, notes, and payment tracking |
| **Portfolio** | Overview of your owned properties and investments |
| **Listings** | Manage properties you're selling |
| **Documents** | Document templates and generated documents |
| **Marketing** | Campaign management for direct mail, email, and SMS |
| **Tools** | Utility calculators and helpers |
| **AI** | AI Command Center for intelligent assistance |
| **Help & Support** | Access help documentation and support |
| **Settings** | Configure your account and organization |

### The Home Dashboard

Your home dashboard displays:

- **Quick Stats**: At-a-glance metrics including total leads, active deals, properties owned, and pending payments
- **Recent Activity**: A timeline of recent actions taken by you and your team
- **Lead Aging**: Visual breakdown of leads by how long they've been in your system
- **Deal Pipeline Summary**: Overview of deals by stage
- **Upcoming Tasks**: Tasks due soon that need your attention
- **Notifications**: Important alerts and system messages

## Theme Settings

AcreOS supports both light and dark modes with a Sedona Desert-inspired color scheme.

### Changing Your Theme

1. Look at the bottom of the sidebar for the "Theme" toggle
2. Click the sun/moon icon to switch between light and dark mode
3. Your preference is saved automatically and persists across sessions

Alternatively, on the login page:
- A theme toggle is available in the corner
- The background video changes based on your selected theme

### Theme Characteristics

**Light Mode**:
- Warm sandy cream backgrounds
- Terracotta primary accents
- Desert sage green highlights

**Dark Mode**:
- Deep warm brown backgrounds
- Rich terracotta accents
- Subtle sage green highlights

## Mobile Access

AcreOS is fully responsive and works on mobile devices:

- On mobile, tap the menu button (three lines) in the top-left corner to open the sidebar
- All features are accessible on mobile, though some complex tables may require horizontal scrolling
- The interface adapts to your screen size for optimal viewing

---

# Part 2: Leads Management

## Overview

The Leads module is your CRM (Customer Relationship Management) hub. Here you track every seller and buyer contact, their status, communication history, and how likely they are to transact.

## Understanding Lead Types

AcreOS supports two primary lead types:

### Seller Leads
People who own land and may want to sell. These are your acquisition targets.

**Seller Statuses:**
| Status | Description |
|--------|-------------|
| New | Just added, no contact made |
| Mailed | Direct mail sent to this lead |
| Responded | Lead has responded to your outreach |
| Negotiating | Active discussions about a deal |
| Accepted | Offer accepted, moving to closing |
| Closed | Deal completed |
| Dead | Lead is not interested or unreachable |

### Buyer Leads
People interested in purchasing land from you. These are your disposition targets.

**Buyer Statuses:**
| Status | Description |
|--------|-------------|
| New | Just added to your buyer list |
| Interested | Has expressed interest in properties |
| Qualified | Verified they can purchase |
| Under Contract | Currently in a transaction |
| Closed | Has purchased from you |
| Dead | No longer interested or qualified |

## Adding Leads

### Adding a Single Lead

1. Navigate to **Leads (CRM)** in the sidebar
2. Click the **Add Lead** button in the top-right
3. Fill in the lead information:
   - **First Name** (required)
   - **Last Name** (required)
   - **Email** (optional but recommended)
   - **Phone** (optional)
   - **Address, City, State, ZIP** (for property owners)
   - **Type**: Select Seller or Buyer
   - **Source**: How you found this lead (tax list, referral, website, etc.)
   - **Notes**: Any initial notes about this lead
4. Click **Save** to create the lead

### Importing Leads in Bulk

1. From the Leads page, click **Import**
2. Download the CSV template to see the required format
3. Prepare your data file with columns matching the template
4. Upload your CSV file
5. Map your columns to AcreOS fields if they differ
6. Review the import preview
7. Click **Import** to add all leads

### Lead Sources

Common lead sources you can track:
- Tax List (delinquent tax records)
- Referral
- Website
- Facebook
- Craigslist
- Direct Mail Response
- Cold Call
- Skip Traced
- Probate
- Inherited

## Lead Scoring System

AcreOS includes an intelligent lead scoring system that helps you prioritize which leads to contact first.

### How Scoring Works

Each lead receives a score based on multiple factors that indicate their likelihood to sell at a favorable price. The system uses public data enrichment and your own engagement data to calculate scores.

### Scoring Factors

The scoring system evaluates leads across three categories:

**Property-Based Factors:**
| Factor | What It Measures |
|--------|------------------|
| Ownership Duration | How long they've owned the property (longer = higher score) |
| Tax Delinquency | Whether property taxes are unpaid (delinquent = higher score) |
| Absentee Owner | If owner doesn't live at the property (absentee = higher score) |
| Property Size | Acreage of the parcel |
| Assessed Value | County-assessed value of the property |

**Owner-Based Factors:**
| Factor | What It Measures |
|--------|------------------|
| Corporate Owner | If owned by a company vs individual |
| Out-of-State Owner | Owner lives in a different state than the property |
| Inheritance Indicator | Signs the property may have been inherited |
| Multiple Properties | Owner has multiple parcels |

**Engagement Factors:**
| Factor | What It Measures |
|--------|------------------|
| Response Recency | How recently they responded to your outreach |
| Email Engagement | Opens and clicks on your emails |
| Campaign Touches | Number of times you've contacted them |

### Score Recommendations

Based on the total score, leads receive a recommendation:

| Score Range | Recommendation | Meaning |
|-------------|----------------|---------|
| 100+ | **Mail** | High priority - definitely reach out |
| 0 to 99 | **Maybe** | Consider contacting if budget allows |
| Below 0 | **Skip** | Low probability of success |

### Nurturing Stages

Leads are automatically categorized into nurturing stages:

| Stage | Score Range | Action |
|-------|-------------|--------|
| **Hot** | High scores (100+) | Prioritize immediate follow-up |
| **Warm** | Medium scores (0-99) | Include in regular outreach |
| **Cold** | Low scores (below 0) | Deprioritize or remove from campaigns |

### Viewing Lead Scores

1. On the Leads page, look for the **Score** column
2. Click on any lead to open their detail view
3. Click the **Score Details** button to see the full breakdown
4. The breakdown shows each factor, its contribution, and the data used

### Triggering a Rescore

Scores update automatically when:
- New enrichment data is available
- The lead responds to outreach
- Email engagement is detected
- Manual rescore is requested

To manually rescore:
1. Open the lead detail view
2. Click the **Rescore** button
3. The system will fetch fresh data and recalculate

## Working with Leads

### Lead Detail View

Click on any lead to open their full profile, which includes:

- **Contact Information**: Name, email, phone, address
- **Lead Score**: Current score with breakdown button
- **Status**: Current status with history
- **Notes**: All notes added to this lead
- **Activity Timeline**: Complete history of interactions
- **Tags**: Labels for organization
- **Assigned To**: Team member responsible for this lead
- **Related Properties**: Properties linked to this lead
- **Related Deals**: Deals involving this lead

### Adding Notes

1. Open the lead detail view
2. Scroll to the Notes section
3. Type your note in the text field
4. Click **Add Note**
5. Notes are timestamped and attributed to you

### Changing Lead Status

1. Open the lead detail view
2. Click the current status badge or the **Change Status** button
3. Select the new status from the dropdown
4. Optionally add a note about why the status changed
5. Click **Save**

Status changes are logged in the activity timeline.

### Assigning Leads to Team Members

1. Open the lead detail view
2. Find the **Assigned To** field
3. Click to open the team member dropdown
4. Select the team member
5. They will be notified of the assignment

### Adding Tags

Tags help you organize and filter leads:

1. Open the lead detail view
2. Find the **Tags** section
3. Click **Add Tag**
4. Type a tag name (e.g., "priority", "cash-buyer", "motivated")
5. Press Enter to add
6. Click the X on any tag to remove it

## Bulk Operations

### Selecting Multiple Leads

1. On the Leads list, check the box next to each lead you want to select
2. Or use **Select All** to select all visible leads
3. A toolbar appears showing how many are selected

### Available Bulk Actions

| Action | Description |
|--------|-------------|
| **Change Status** | Set all selected leads to a new status |
| **Assign To** | Assign all selected leads to a team member |
| **Add to Campaign** | Include leads in a marketing campaign |
| **Add Tags** | Apply tags to all selected leads |
| **Export** | Download selected leads as CSV |
| **Delete** | Remove selected leads (use caution!) |

### Exporting Leads

1. Select the leads you want to export (or select all)
2. Click **Export**
3. Choose your export format (CSV or Excel)
4. The file downloads automatically

## Filtering and Saved Views

### Using Filters

1. Click the **Filter** button above the leads list
2. Add filter conditions:
   - Status equals "Responded"
   - Score greater than 50
   - State equals "Texas"
   - Created in last 30 days
3. Click **Apply** to see filtered results

### Creating Saved Views

Save frequently-used filters as views:

1. Set up your desired filters
2. Click **Save View**
3. Give your view a name (e.g., "Hot Texas Leads")
4. Choose whether to save column visibility and sort order
5. Click **Save**

### Using Saved Views

1. Click the **Views** dropdown above the list
2. Select a saved view
3. The list updates with your saved filters
4. To modify, adjust filters and click **Update View**

## Custom Fields

If the standard fields don't capture everything you need, create custom fields.

### Adding Custom Fields

1. Go to **Settings** > **Custom Fields**
2. Select **Leads** as the entity type
3. Click **Add Custom Field**
4. Configure your field:
   - **Name**: The field label (e.g., "Asking Price")
   - **Type**: Text, Number, Date, Dropdown, Checkbox, etc.
   - **Required**: Whether the field must be filled
   - **Options** (for dropdowns): The available choices
5. Click **Save**

Custom fields appear on the lead detail page and can be included in filters and exports.

---

# Part 3: Properties

## Overview

The Properties module (labeled "Inventory" in the sidebar) tracks every parcel you're working with. From initial prospect through acquisition, ownership, listing, and sale, properties move through your pipeline here.

## Property Statuses

Properties progress through these stages:

| Status | Description |
|--------|-------------|
| **Prospect** | A property you're interested in but haven't pursued |
| **Due Diligence** | Actively researching this property |
| **Offer Sent** | You've made an offer to the owner |
| **Under Contract** | Offer accepted, in closing process |
| **Owned** | You now own this property |
| **Listed** | Property is listed for sale |
| **Sold** | Property has been sold |

## Adding Properties

### Adding a Single Property

1. Navigate to **Inventory** in the sidebar
2. Click **Add Property**
3. Enter property information:
   - **APN** (Assessor's Parcel Number) - required
   - **Legal Description** - optional but recommended
   - **Address, City, County, State, ZIP**
   - **Acreage**
   - **GPS Coordinates** (latitude/longitude)
   - **Zoning**
   - **Status** - select current stage
   - **Notes**
4. Click **Save**

### Linking Properties to Leads

Properties often connect to leads (the owners):

1. When adding a property, select an existing lead as the owner
2. Or from a lead's detail page, click **Link Property**
3. Search for and select the property
4. The relationship is now tracked

## Property Information

### Core Details

Each property record contains:

- **Identification**: APN, legal description, address
- **Physical**: Acreage, zoning, GPS coordinates
- **Financial**: Purchase price, estimated value, acquisition costs
- **Status**: Current stage in your pipeline
- **Owner**: Linked lead record

### Parcel Data Enrichment

AcreOS can automatically enrich property records with public data:

**Data Sources:**
- **County GIS Portals**: Free data from county assessor websites
- **Regrid API**: Comprehensive parcel data (uses credits)

**Enriched Data May Include:**
- Owner name and mailing address
- Last sale date and price
- Assessed value (land and improvements)
- Tax information and delinquency status
- Lot dimensions
- Flood zone status
- Zoning classification

### Triggering Enrichment

1. Open a property's detail page
2. Click **Enrich Data**
3. The system queries available data sources
4. Results populate automatically

## Due Diligence Reports

For properties in active consideration, generate comprehensive due diligence reports.

### What's Included

A due diligence report compiles:

- **Property Overview**: Basic property information
- **Ownership History**: Chain of title information
- **Tax History**: Tax payments and any delinquencies
- **Market Analysis**: Comparable sales and market trends
- **Risk Assessment**: Flood zones, environmental concerns
- **AI Summary**: An intelligent summary of key findings

### Generating a Report

1. Open the property detail page
2. Click **Generate Due Diligence Report**
3. Wait while the system compiles data (may take a minute)
4. Review the report on screen
5. Click **Export PDF** to download a formatted document

## Map View

### Viewing Properties on Map

1. On the Inventory page, click the **Map** tab
2. All properties with GPS coordinates appear as pins
3. Click a pin to see property details
4. Use the map controls to zoom and pan

### Adding Properties from Map

1. In Map view, click **Add Property**
2. Click on the map to place a marker
3. Coordinates are automatically captured
4. Complete the property form
5. Click **Save**

## Property Documents

Track documents associated with each property:

### Uploading Documents

1. Open the property detail page
2. Scroll to the **Documents** section
3. Click **Upload Document**
4. Select your file
5. Add a description (e.g., "Deed", "Survey", "Title Report")
6. Click **Upload**

### Generating Documents

AcreOS can generate documents from templates:

1. Click **Generate Document**
2. Select a template (Offer Letter, Purchase Agreement, etc.)
3. Review the auto-filled information
4. Make any edits
5. Click **Generate**
6. Download or send the document

---

# Part 4: Deals Pipeline

## Overview

The Deal Pipeline is where you manage transactions from initial negotiation through closing. It uses a visual Kanban-style board for easy tracking.

## Understanding Deal Types

### Acquisition Deals
Deals where you're **buying** land from a seller.

### Disposition Deals
Deals where you're **selling** land to a buyer.

## Deal Stages

Deals progress through customizable stages:

**Default Acquisition Stages:**
1. **Negotiating** - Initial discussions with seller
2. **Offer Sent** - Written offer delivered
3. **Under Contract** - Signed agreement
4. **Title & Escrow** - In closing process
5. **Closed** - Transaction complete

**Default Disposition Stages:**
1. **Listed** - Property on market
2. **Showing** - Active showings
3. **Offer Received** - Buyer made offer
4. **Under Contract** - Signed agreement
5. **Closed** - Transaction complete

## The Kanban Board

### Using the Board

1. Navigate to **Deal Pipeline**
2. See all deals organized by stage in columns
3. Each deal appears as a card showing key info

### Card Information

Each deal card shows:
- Property address or name
- Deal value
- Days in current stage
- Assigned team member
- Priority indicator (if set)

### Moving Deals Between Stages

**Drag and Drop:**
1. Click and hold a deal card
2. Drag it to the new stage column
3. Release to update the status

**Via Detail View:**
1. Click the deal card
2. Use the **Stage** dropdown
3. Select the new stage

## Creating Deals

### From a Property

1. Open a property's detail page
2. Click **Create Deal**
3. Select deal type (Acquisition or Disposition)
4. The property is automatically linked
5. Fill in deal details
6. Click **Create**

### From the Pipeline

1. On the Deal Pipeline page, click **Add Deal**
2. Select deal type
3. Search for and select a property
4. Enter deal details:
   - **Offer Amount**
   - **Assigned To**
   - **Priority**
   - **Expected Close Date**
   - **Notes**
5. Click **Create**

## Deal Details

### Financial Information

Each deal tracks:

- **Offer Price**: Your proposed purchase/sale price
- **Accepted Price**: Final agreed price
- **Earnest Money**: Deposit amount
- **Closing Costs**: Estimated fees
- **Expected Profit**: Projected margin

### Deal Analysis

For acquisition deals, AcreOS can analyze:

- **After Repair Value (ARV)**: Estimated resale value
- **Maximum Allowable Offer (MAO)**: Highest price you should pay
- **Comparable Sales**: Recent similar transactions
- **Investment Returns**: ROI calculations

### Timeline & Tasks

Each deal has its own task list:

1. Open the deal detail page
2. Scroll to **Tasks**
3. Add tasks specific to this deal
4. Assign to team members
5. Set due dates
6. Track completion

## Deal Documents

### Required Documents

Common deal documents:
- Purchase Agreement
- Assignment Contract (if wholesaling)
- Warranty Deed or Quit Claim Deed
- Promissory Note (if seller financing)
- Title Insurance
- Closing Statement

### Generating Documents

1. From the deal page, click **Documents**
2. Click **Generate** next to a template
3. Review auto-filled information
4. Edit as needed
5. Generate and download

### E-Signature

If configured, send documents for electronic signature:

1. Generate the document
2. Click **Send for Signature**
3. Enter recipient email(s)
4. The recipient receives a signing link
5. Track signature status in the Documents section

---

# Part 5: Finance Module

## Overview

The Finance module manages seller financing, promissory notes, payment tracking, and borrower communications. This is essential if you offer payment plans to buyers.

**Important**: The Finance module provides tools for record-keeping. For legal and tax advice regarding seller financing, please consult qualified professionals.

## Understanding Seller Financing

When you sell land with seller financing:
1. The buyer makes a down payment
2. They pay the remaining balance over time
3. You hold the note until paid in full
4. You earn interest on the financed amount

## Creating Notes (Loans)

### Adding a New Note

1. Navigate to **Finance** in the sidebar
2. Click **Create Note**
3. Enter note details:

**Property Information:**
- Link to a property in your inventory
- Or enter property details manually

**Borrower Information:**
- Link to a buyer lead
- Or enter borrower contact details

**Loan Terms:**
| Field | Description |
|-------|-------------|
| **Principal Amount** | Total financed amount (sale price minus down payment) |
| **Interest Rate** | Annual interest rate (e.g., 9.9%) |
| **Term** | Length of loan in months |
| **Payment Frequency** | Monthly, bi-weekly, or weekly |
| **Start Date** | When payments begin |
| **Down Payment** | Amount paid upfront |

4. Click **Create Note**

### Note Statuses

| Status | Description |
|--------|-------------|
| **Draft** | Note created but not yet active |
| **Active** | Payments are being collected |
| **Delinquent** | Payment(s) are past due |
| **Paid Off** | Note is fully satisfied |
| **Default** | Borrower has defaulted |
| **Cancelled** | Note was cancelled |

## Amortization Schedules

Every note generates an amortization schedule showing:

- Each payment number
- Payment due date
- Payment amount
- Principal portion
- Interest portion
- Remaining balance

### Viewing the Schedule

1. Open a note's detail page
2. Click the **Amortization** tab
3. See the complete payment schedule
4. Paid payments are marked with checkmarks
5. Past due payments are highlighted

### Downloading the Schedule

1. From the Amortization tab
2. Click **Export**
3. Download as PDF or CSV

## Recording Payments

### When a Payment Is Received

1. Open the note detail page
2. Click **Record Payment**
3. Enter payment details:
   - **Amount Received**
   - **Payment Date**
   - **Payment Method** (check, ACH, cash, etc.)
   - **Transaction ID** (optional reference number)
   - **Notes** (optional)
4. Click **Record**

### Partial Payments

If a borrower pays less than the full amount:
1. Record the partial payment as received
2. The system tracks the remaining balance due
3. A partial payment is still progress!

### Extra Payments

If a borrower pays extra:
1. Record the actual amount received
2. Extra funds reduce the principal
3. The amortization schedule adjusts accordingly

## Payment Tracking

### Payment Status

| Status | Description |
|--------|-------------|
| **Pending** | Payment not yet due |
| **Due** | Payment is due today or this period |
| **Paid** | Payment received in full |
| **Partial** | Some but not all of payment received |
| **Late** | Past due date, not fully paid |

### Dashboard Overview

The Finance dashboard shows:

- **Total Notes Outstanding**: Count of active notes
- **Total Principal Owed**: Sum of remaining balances
- **Monthly Payment Expected**: What you should collect this month
- **Payments Received This Month**: What you've actually collected
- **Delinquent Accounts**: Notes with past-due payments

### Delinquency Alerts

AcreOS monitors for late payments:

1. When a payment is 1 day late, status changes to "Late"
2. After configurable days (default: 30), note becomes "Delinquent"
3. You receive notifications for delinquent accounts
4. The AI Operations Agent can help track and follow up

## Borrower Portal

Give your borrowers a way to view their loan and make payments.

### What Borrowers See

When a borrower accesses their portal:
- Current balance
- Next payment amount and due date
- Payment history
- Amortization schedule
- Ability to make payments (if online payments enabled)

### Enabling Portal Access

1. Open the note detail page
2. Click **Borrower Portal** tab
3. Toggle **Enable Portal Access**
4. An access link is generated
5. Send this link to your borrower

### Online Payments

If you've connected Stripe:
1. Borrowers can pay via credit card or ACH
2. Payments are automatically recorded
3. You receive funds in your Stripe account

## Financial Reports

### Available Reports

| Report | Description |
|--------|-------------|
| **Collections Report** | Payments due and received by period |
| **Delinquency Report** | All past-due accounts with aging |
| **Portfolio Summary** | Overview of all notes |
| **Interest Income** | Interest earned by period |
| **Principal Recovery** | Principal collected by period |

### Generating Reports

1. From the Finance section, click **Reports**
2. Select the report type
3. Choose date range and filters
4. Click **Generate**
5. View on screen or export to PDF/Excel

---

# Part 6: Marketing & Campaigns

## Overview

The Marketing module helps you reach potential sellers and buyers through direct mail, email, and SMS campaigns. Track every touchpoint and measure results.

## Campaign Types

### Direct Mail
Physical letters, postcards, or mailers sent via postal mail.

**How It Works:**
1. Create your mail piece design
2. Select recipients from your leads
3. AcreOS sends through Lob (mail partner)
4. Track delivery status and responses

### Email Campaigns
Digital emails sent to your leads.

**How It Works:**
1. Create your email content
2. Select recipients (who have email addresses)
3. Campaigns send through SendGrid
4. Track opens, clicks, and responses

### SMS Campaigns
Text messages sent to leads' phones.

**How It Works:**
1. Compose your text message
2. Select recipients (who have phone numbers and consent)
3. Messages send through Twilio
4. Track delivery and responses

## Creating a Campaign

### Step 1: Start New Campaign

1. Navigate to **Marketing** in the sidebar
2. Click **Create Campaign**
3. Enter campaign basics:
   - **Name**: Internal name for your reference
   - **Type**: Direct Mail, Email, or SMS
   - **Description**: Notes about this campaign

### Step 2: Select Recipients

Choose who receives this campaign:

**From Leads:**
- Select individual leads
- Use saved views to filter
- Include/exclude by status, tags, score, etc.

**From Lists:**
- Upload a new list
- Use a previously uploaded list

**Filters Available:**
- Lead score above/below threshold
- Status equals/doesn't equal
- Tags include/exclude
- Location (state, county, zip)
- Last contacted more/less than X days ago

### Step 3: Create Content

Content varies by campaign type:

**Direct Mail:**
- Select template (letter, postcard, self-mailer)
- Upload your design or use the builder
- Add merge fields for personalization ({{first_name}}, {{property_address}}, etc.)
- Preview with sample data

**Email:**
- Enter subject line
- Create email body (rich text editor)
- Add merge fields
- Include tracking pixel (automatic)
- Add links (automatically tracked)

**SMS:**
- Compose message (160 characters recommended)
- Add merge fields
- Keep it short and clear

### Step 4: Configure Settings

**Timing:**
- Send immediately
- Schedule for later date/time
- Drip over time (X recipients per day)

**Tracking:**
- Tracking code (for responses)
- UTM parameters (for web links)

**Budget:**
- Set maximum spend
- Get alerts at thresholds

### Step 5: Review and Launch

1. Review all settings
2. See cost estimate
3. Click **Send Test** to preview (optional)
4. Click **Launch Campaign**

## Campaign Metrics

### Key Metrics Tracked

| Metric | Direct Mail | Email | SMS |
|--------|-------------|-------|-----|
| Sent | Yes | Yes | Yes |
| Delivered | Yes | Yes | Yes |
| Bounced/Returned | Yes | Yes | Yes |
| Opened | No | Yes | No |
| Clicked | No | Yes | Yes |
| Responded | Yes | Yes | Yes |
| Converted | Yes | Yes | Yes |

### Viewing Results

1. Open the campaign
2. Click the **Metrics** tab
3. See real-time statistics
4. View recipient-level details
5. Export data for analysis

### Response Tracking

When recipients respond:
1. The response is matched to the campaign via tracking code
2. The lead's status updates
3. Response appears in your Inbox
4. Campaign conversion counts increase

## Campaign Sequences

Create multi-touch sequences that automatically follow up:

### Creating a Sequence

1. Click **Create Sequence**
2. Name your sequence
3. Add steps:

**Step Types:**
- Wait X days
- Send email
- Send SMS
- Send direct mail
- Create task
- Update lead status

**Example Sequence:**
```
Day 0: Send initial letter
Day 14: Wait
Day 14: Send follow-up postcard
Day 28: Wait
Day 28: Send email
Day 35: Wait
Day 35: Create task "Call if no response"
```

### Enrolling Leads

1. Open the sequence
2. Click **Enroll Leads**
3. Select leads or use filters
4. Set start date
5. Click **Enroll**

### Managing Sequences

- **Pause**: Temporarily stop all sends
- **Resume**: Continue from where paused
- **Cancel**: Stop sequence for specific leads
- **Skip Step**: Jump past a step for a lead

## Budget Management

### Setting Budgets

1. Go to **Marketing** > **Budget**
2. Set monthly budget cap
3. Allocate by channel (mail, email, SMS)
4. Receive alerts at thresholds (50%, 75%, 90%, 100%)

### Tracking Spend

The budget dashboard shows:
- Total spent this month
- Remaining budget
- Projected spend (based on scheduled campaigns)
- Cost per lead/response/conversion

## Templates

### Using Templates

Save time with reusable templates:

1. Go to **Marketing** > **Templates**
2. Browse existing templates
3. Click **Use Template**
4. Customize for your campaign

### Creating Templates

1. Click **Create Template**
2. Select type (mail, email, SMS)
3. Design your content
4. Add merge fields
5. Save for future use

### Template Categories

Organize templates by purpose:
- Initial outreach
- Follow-up
- Price offers
- Holiday greetings
- Thank you notes
- Contract reminders

---

# Part 7: AI Agents & Command Center

## Overview

AcreOS includes four specialized AI agents that help automate and enhance your land investing operations. Access them through the AI Command Center at `/command-center` or `/ai`.

**Important**: AI agents provide analysis and suggestions, not financial, legal, or investment advice. Always verify AI recommendations independently.

## The Four Super-Agents

### 1. Research & Intelligence Agent

**Purpose**: Conduct due diligence and research on properties and markets.

**Capabilities:**
- Property research and data gathering
- Environmental risk lookups (flood zones, wetlands, superfund sites)
- Investment analysis and feasibility studies
- Market comparables research
- Owner lookup and skip tracing
- Title issue identification

**Example Requests:**
- "Research the property at 123 Oak Road, Smith County, TX"
- "Find flood zone status for APN 12345678"
- "What are comparable sales in this area?"
- "Is this property in a wetland area?"

### 2. Deals & Acquisition Agent

**Purpose**: Help with offer generation and deal analysis.

**Capabilities:**
- Generate offer letters
- Calculate maximum allowable offers
- Analyze deal profitability
- Run comp (comparable sales) research
- Calculate financing scenarios
- Evaluate investment returns

**Example Requests:**
- "Generate an offer letter at 40% of assessed value"
- "What's the MAO on this property with 50% target margin?"
- "Calculate seller financing terms for $15,000 at 9.9% over 60 months"
- "What's my projected ROI on this acquisition?"

### 3. Communications Agent

**Purpose**: Assist with outreach and lead nurturing.

**Capabilities:**
- Draft emails and SMS messages
- Create follow-up sequences
- Suggest response messages
- Generate campaign content
- Personalize communication templates

**Example Requests:**
- "Write a follow-up email for John who didn't respond to our first letter"
- "Draft an SMS to check if Mary received our offer"
- "Create a 3-touch email sequence for cold leads"
- "Help me respond to this seller's counter-offer email"

### 4. Operations Agent

**Purpose**: Monitor your business and handle operational tasks.

**Capabilities:**
- Check for delinquent payments
- Monitor campaign performance
- Generate daily/weekly digests
- Create alerts for important events
- Analyze team performance
- Optimize campaign targeting

**Example Requests:**
- "Which notes have late payments this week?"
- "How are my current campaigns performing?"
- "Give me a summary of this week's activity"
- "What should I focus on today?"

## Using the Command Center

### Accessing the Command Center

1. Click **AI** in the sidebar
2. Or navigate directly to `/command-center`
3. The chat interface opens

### Starting a Conversation

1. Type your question or request in the input field
2. Press Enter or click Send
3. The system routes your request to the appropriate agent
4. The agent responds with information and/or actions

### Conversation Context

The AI remembers context within a conversation:
- You can ask follow-up questions
- Reference previous responses
- Build on prior analysis

Start a new conversation for unrelated topics.

### Agent Selection

Usually, the system automatically selects the right agent. You can also specify:
- "Ask the Research agent about..."
- "Have the Deals agent calculate..."
- "@Research what's the flood zone for..."

### Task Execution

Some requests create tasks or take actions:
- Generating documents
- Sending messages (with your approval)
- Creating leads or notes
- Updating records

You'll be asked to confirm before any action that modifies data.

## Agent Status & History

### Viewing Agent Status

1. From the Command Center, click **Agent Status**
2. See which agents are active
3. View recent agent activity
4. Check for any errors or issues

### Conversation History

1. Click **History** in the Command Center
2. Browse previous conversations
3. Click to continue any past conversation
4. Search conversations by keyword

## Best Practices

### Be Specific
- Bad: "Tell me about this property"
- Good: "What's the flood zone status for 123 Main St, Austin, TX 78701?"

### Provide Context
- Bad: "Write an email"
- Good: "Write a follow-up email to John Smith about his property at 456 Oak Lane. He showed interest but hasn't responded to our offer of $12,000."

### Review Before Acting
- Always review AI-generated content before sending
- Verify calculations and recommendations
- The AI can make mistakes

### Use for Efficiency, Not Replacement
- AI speeds up research and drafting
- Human judgment is still essential
- Combine AI assistance with your expertise

---

# Part 8: Team & Collaboration

## Overview

AcreOS supports teams with role-based permissions, task assignment, activity tracking, and performance monitoring.

## Team Roles

### Available Roles

| Role | Description |
|------|-------------|
| **Owner** | Full access to everything, including billing and settings |
| **Admin** | Full access except billing management |
| **Acquisitions** | Focus on leads, properties, and acquisition deals |
| **Marketing** | Focus on campaigns and lead management |
| **Finance** | Focus on notes, payments, and financial records |
| **Member** | Basic access to assigned work |

### Role Permissions

Each role has different access levels:

| Feature | Owner | Admin | Acquisitions | Marketing | Finance | Member |
|---------|-------|-------|--------------|-----------|---------|--------|
| View Leads | Yes | Yes | Yes | Yes | View | Assigned |
| Edit Leads | Yes | Yes | Yes | Yes | No | Assigned |
| View Properties | Yes | Yes | Yes | View | View | Assigned |
| Manage Deals | Yes | Yes | Yes | No | View | Assigned |
| Manage Finance | Yes | Yes | No | No | Yes | No |
| Run Campaigns | Yes | Yes | No | Yes | No | No |
| Team Settings | Yes | Yes | No | No | No | No |
| Billing | Yes | No | No | No | No | No |

## Inviting Team Members

### Sending Invitations

1. Go to **Settings** > **Team**
2. Click **Invite Member**
3. Enter their email address
4. Select their role
5. Click **Send Invitation**

### Invitation Process

1. Invitee receives an email with join link
2. They click the link and sign in with Replit
3. They're added to your organization
4. They appear in your team list

### Managing Pending Invitations

- View pending invitations in **Settings** > **Team**
- Resend invitation emails
- Cancel invitations
- Invitations expire after 7 days

## Managing Team Members

### Changing Roles

1. Go to **Settings** > **Team**
2. Find the team member
3. Click their current role
4. Select the new role
5. Changes apply immediately

### Removing Team Members

1. Go to **Settings** > **Team**
2. Find the team member
3. Click **Remove**
4. Confirm the removal
5. Their access is revoked immediately

Note: Removing a member does not delete their work. All leads, notes, and activities they created remain.

## Task Assignment

### Assigning Tasks

1. Create a task (from Tasks page or within a lead/deal)
2. Click **Assign To**
3. Select a team member
4. Set due date if applicable
5. The assignee is notified

### Task Visibility

Team members see:
- Tasks assigned to them
- Tasks they created
- Team-wide tasks (if configured)

### Task Notifications

Notifications are sent when:
- You're assigned a task
- A due date approaches
- A task you're watching is updated
- A task you assigned is completed

## Activity Feed

### Viewing Activity

The Dashboard shows recent activity including:
- Leads added or updated
- Status changes
- Notes added
- Deals created or closed
- Payments recorded
- Campaigns sent

### Filtering Activity

1. Go to **Insights** > **Activity**
2. Filter by:
   - Team member
   - Activity type
   - Date range
   - Related entity (lead, property, deal)

### Activity on Individual Records

Every lead, property, deal, and note has an activity timeline:
1. Open the record
2. Scroll to the Activity section
3. See all historical activity
4. Entries show who, what, and when

## Team Performance Dashboard

### Accessing Performance Metrics

1. Go to **Insights** > **Team Performance**
2. View aggregated team metrics

### Metrics Tracked

| Metric | Description |
|--------|-------------|
| Leads Added | New leads per team member |
| Leads Converted | Leads that became deals |
| Deals Closed | Completed transactions |
| Payments Collected | Finance collections |
| Tasks Completed | Task completion rate |
| Response Time | Average time to follow up |
| Activity Count | Total actions taken |

### Date Range Selection

- View by day, week, month, quarter, or year
- Compare periods (this month vs last month)
- Track trends over time

### Individual Performance

Click on a team member to see their detailed metrics:
- Activity breakdown
- Conversion rates
- Response times
- Open tasks
- Recent activity

## Collaboration Features

### Mentions

Mention team members in notes:
1. Type @ followed by their name
2. Select from the dropdown
3. They receive a notification

### Watching Records

Watch leads, properties, or deals to get updates:
1. Open the record
2. Click the **Watch** (eye icon) button
3. Receive notifications on changes

### Shared Views

Share saved views with team:
1. Create a saved view (see Leads section)
2. Check "Share with team"
3. Team members see it in their views

---

# Part 9: Billing, Credits & BYOK

## Subscription Tiers

AcreOS offers tiered subscription plans to match your business size and needs.

### Plan Comparison

| Feature | Free | Starter | Pro | Scale | Enterprise |
|---------|------|---------|-----|-------|------------|
| **Leads** | 50 | 500 | 5,000 | Unlimited | Unlimited |
| **Properties** | 10 | 100 | 1,000 | Unlimited | Unlimited |
| **Notes** | 5 | 50 | 500 | Unlimited | Unlimited |
| **AI Requests/Day** | 100 | 1,000 | 10,000 | Unlimited | Unlimited |
| **Included Seats** | 1 | 2 | 5 | 10 | 25 |
| **Max Seats** | 1 | 5 | 20 | 100 | Unlimited |
| **Additional Seat Cost** | N/A | $20/month | $30/month | $40/month | $50/month |

### Upgrading Your Plan

1. Go to **Settings** > **Billing**
2. Click **Upgrade Plan**
3. Select your new tier
4. Enter payment information
5. Confirm the upgrade
6. New limits apply immediately

### Downgrading

1. Go to **Settings** > **Billing**
2. Click **Change Plan**
3. Select a lower tier
4. Note: You may need to reduce usage to fit new limits
5. Change takes effect at next billing cycle

## Credits System

Some actions in AcreOS consume credits from your balance.

### Actions That Use Credits

| Action | Credit Cost | Description |
|--------|-------------|-------------|
| Direct Mail | Varies | Physical mail sending (postage + printing) |
| Email Send | ~0.5 cents | Transactional email delivery |
| SMS Send | ~1-2 cents | Text message delivery |
| AI Request | ~0.5-5 cents | AI agent queries (varies by complexity) |
| PDF Generation | ~1 cent | Document creation |
| Parcel Data (Regrid) | ~5-25 cents | Property data lookup |

Note: Costs are approximate and may vary.

### Viewing Your Balance

1. Look in the sidebar footer for your credit balance
2. Or go to **Settings** > **Billing** > **Credits**
3. See current balance and recent usage

### Purchasing Credits

1. Go to **Settings** > **Billing** > **Credits**
2. Click **Add Credits**
3. Select an amount:
   - $10 = 1,000 credits
   - $25 = 2,500 credits
   - $50 = 5,000 credits
   - $100 = 10,000 credits
4. Complete payment
5. Credits are added immediately

### Auto Top-Up

Never run out of credits with automatic refills:

1. Go to **Settings** > **Billing** > **Credits**
2. Enable **Auto Top-Up**
3. Set the threshold (e.g., when balance falls below $2)
4. Set the refill amount (e.g., add $25)
5. Save settings

When your balance drops below the threshold, credits are automatically purchased.

## BYOK (Bring Your Own Key)

Use your own API keys for external services to avoid using AcreOS credits.

### Supported Services

| Service | What It Covers |
|---------|----------------|
| **Lob** | Direct mail sending |
| **Regrid** | Parcel data lookups |
| **SendGrid** | Email delivery |
| **Twilio** | SMS messaging |

### Setting Up Your Own Keys

1. Go to **Settings** > **Integrations**
2. Find the service (e.g., Lob)
3. Click **Configure**
4. Enter your API key
5. Click **Validate** to test
6. Click **Save**

### How BYOK Works

When you add your own keys:
- Actions use your service account, not AcreOS credits
- You're billed directly by the service provider
- Usage counts against your service plan limits
- You have full control over your API usage

### Switching Between Platform and BYOK

You can use platform credits for some services and BYOK for others. For each service:
- If your key is configured: Your key is used
- If no key is configured: Platform credits are used

## Usage Monitoring

### Viewing Usage

1. Go to **Settings** > **Usage**
2. See resource consumption:
   - Lead count vs limit
   - Property count vs limit
   - Note count vs limit
   - AI requests today vs daily limit

### Usage Alerts

Receive notifications when approaching limits:
- At 75% of any limit
- At 90% of any limit
- When limit is reached

### Usage History

View historical usage trends:
1. Go to **Insights** > **Usage History**
2. Select date range
3. See daily/weekly/monthly consumption
4. Identify usage patterns

---

# Part 10: Settings & Administration

## Organization Settings

### General Settings

1. Go to **Settings** > **Organization**
2. Configure:
   - **Organization Name**: Your company name
   - **Timezone**: For scheduling and timestamps
   - **Currency**: Display currency for financials
   - **Default Interest Rate**: For new seller financing notes
   - **Default Term**: Default loan term in months

### Company Information

Add your company details for documents:
- Company name
- Address
- Phone number
- Email address
- Logo (for generated documents)

### Preferences

Customize platform behavior:
- Show/hide tips and suggestions
- Enable/disable onboarding checklist
- Notification preferences
- Default views

## Custom Fields

Create additional fields to capture data specific to your business.

### Managing Custom Fields

1. Go to **Settings** > **Custom Fields**
2. Select entity type: Leads, Properties, or Deals

### Creating a Custom Field

1. Click **Add Field**
2. Configure:
   - **Field Name**: Label shown in the UI
   - **Field Type**: Text, Number, Date, Dropdown, Checkbox, etc.
   - **Required**: Whether field must be filled
   - **Default Value**: Pre-populated value
   - **Help Text**: Guidance for users
3. For dropdowns, add the available options
4. Click **Save**

### Field Types Available

| Type | Description |
|------|-------------|
| Text | Single line of text |
| Text Area | Multi-line text |
| Number | Numeric values |
| Currency | Money amounts |
| Date | Date picker |
| Dropdown | Select from options |
| Multi-Select | Choose multiple options |
| Checkbox | Yes/No toggle |
| Email | Email format validation |
| Phone | Phone format validation |
| URL | Web link format |

### Using Custom Fields

Custom fields appear:
- In add/edit forms
- On detail pages
- In filter options
- In export files

## Notification Settings

### Email Notifications

Configure which events trigger emails:

| Event | Default |
|-------|---------|
| Lead assigned to you | On |
| Task assigned to you | On |
| Task due date approaching | On |
| Deal stage change | On |
| Payment received | On |
| Payment past due | On |
| Campaign completed | On |
| New response received | On |

### In-App Notifications

The notification bell in the sidebar shows:
- Unread notification count
- Click to see recent notifications
- Click any notification to go to related item

### Notification Management

1. Go to **Settings** > **Notifications**
2. Toggle notifications on/off by category
3. Set email digest frequency (instant, daily, weekly)
4. Configure quiet hours (no emails during specified times)

## Data Management

### Exporting Data

Export your data for backup or analysis:

1. Go to **Settings** > **Data** > **Export**
2. Select what to export:
   - Leads
   - Properties
   - Deals
   - Notes
   - Payments
   - All data
3. Choose format (CSV or JSON)
4. Click **Export**
5. Download the generated file

### Data Retention Policies

Configure how long to keep data:

1. Go to **Settings** > **Data** > **Retention**
2. Set retention periods for:
   - Closed leads (e.g., 2 years)
   - Completed deals (e.g., 7 years)
   - Audit logs (e.g., 1 year)
   - Communications (e.g., 3 years)
3. Data past retention is automatically archived or deleted

### TCPA Compliance

For SMS and calling compliance:

1. Track consent for each lead
2. Record consent date and source
3. Honor opt-out requests
4. Mark leads as "Do Not Contact"
5. Export compliance records as needed

## Security

### Session Management

View and manage active sessions:

1. Go to **Settings** > **Security**
2. See all active sessions (devices/browsers)
3. End sessions you don't recognize
4. All other sessions are logged out

### Audit Log

Track important actions:

1. Go to **Settings** > **Audit Log**
2. See history of:
   - Login/logout events
   - Setting changes
   - Data exports
   - Team member changes
   - Permission changes
3. Filter by date, user, or action type

---

# Part 11: Founder Dashboard

The Founder Dashboard is a special administrative view available only to platform founders/administrators. It provides deep visibility into platform operations, data sources, and user analytics.

## Accessing the Founder Dashboard

1. If you have founder access, you'll see a special "Founder Dashboard" link in the sidebar with a crown icon
2. Click to access the administrative view
3. This section is only visible to designated founders

## Revenue & Business Metrics

### Overview Cards

The dashboard displays key metrics:

- **Monthly Recurring Revenue (MRR)**: Total subscription revenue
- **Annual Recurring Revenue (ARR)**: Projected yearly revenue
- **Total Users**: Registered user count
- **Active Organizations**: Organizations with recent activity
- **Total Leads**: Platform-wide lead count
- **Total Properties**: Platform-wide property count

### Revenue Trends

Interactive charts showing:
- Revenue over time
- Subscription tier distribution
- Churn rate and retention
- Growth trends

## System Health

### Service Status

Monitor platform components:

| Component | What It Monitors |
|-----------|-----------------|
| Database | PostgreSQL connectivity and performance |
| API | Response times and error rates |
| Background Jobs | Queue processing status |
| External APIs | Lob, SendGrid, Twilio, Regrid status |

### Error Tracking

View recent errors:
- Error counts by type
- Error trends over time
- Specific error details
- Stack traces for debugging

### Performance Metrics

- API response time (average, p95, p99)
- Database query performance
- Memory and CPU usage
- Request throughput

## Data Source Management

### Data Source Broker

AcreOS uses a tiered data source system with 500+ sources:

**Source Categories:**
- County GIS Portals (free)
- State/Federal databases (free)
- Commercial APIs (paid)
- AI/ML predictions (credits)

### Managing Sources

1. Go to **Data Sources** tab in Founder Dashboard
2. View all configured sources
3. See health status for each source
4. Enable/disable sources
5. Configure source priorities

### Source Health Monitoring

For each data source:
- Success rate (percentage)
- Average latency
- Last successful query
- Error history
- Usage statistics

### Adding County GIS Endpoints

Add free data sources from county portals:

1. Click **Add Source**
2. Enter:
   - State and county
   - Endpoint URL
   - Query parameters
   - Field mappings
3. Test the connection
4. Save and enable

## User Analytics

### All Users Table

View every registered user:
- User ID
- Email
- Organization
- Subscription tier
- Registration date
- Last active
- Usage metrics

### Subscription Lifecycle

Track subscription events:
- New subscriptions
- Upgrades
- Downgrades
- Cancellations
- Trial conversions

### User Segments

Analyze users by:
- Subscription tier
- Activity level
- Feature usage
- Geographic region
- Time since registration

## API Cost Tracking

### Cost Overview

See estimated costs for external API usage:

| Service | Metric | Cost Range |
|---------|--------|------------|
| Lob | Per mail piece | $0.50 - $2.00 |
| Regrid | Per parcel lookup | $0.05 - $0.25 |
| SendGrid | Per email | ~$0.0001 |
| Twilio | Per SMS | ~$0.0075 |
| OpenAI | Per request | $0.001 - $0.10 |

### Usage Breakdown

View costs by:
- Time period (day, week, month)
- Service
- Organization
- Feature area

### Cost Optimization

Identify opportunities to reduce costs:
- Cache hit rates
- Redundant API calls
- Optimization suggestions

## Alert Management

### Active Alerts

View system and business alerts:
- Critical errors
- Service degradation
- Unusual activity patterns
- Security concerns

### Alert Actions

For each alert:
- **Acknowledge**: Mark as seen
- **Resolve**: Mark as fixed
- **Snooze**: Temporarily dismiss
- **Escalate**: Flag for attention

### Bulk Alert Operations

- **Acknowledge All**: Mark all alerts as seen
- **Resolve All**: Clear all resolved issues

## Diagnostic Tools

### Endpoint Testing

Test data source connections:

1. Go to **Diagnostics** tab
2. Select a data source
3. Click **Test**
4. View results:
   - Response time
   - Data returned
   - Any errors

### Batch Testing

Test all endpoints at once:
1. Click **Test All**
2. Wait for all tests to complete
3. View summary of results
4. Focus on failed sources

### Debug Mode

Enable debug logging for troubleshooting:
1. Toggle **Debug Mode** on
2. Reproduce the issue
3. View detailed logs
4. Toggle off when done

---

# Appendices

## Appendix A: Glossary of Terms

| Term | Definition |
|------|------------|
| **APN** | Assessor's Parcel Number - unique identifier for a property |
| **Amortization** | Schedule of loan payments over time |
| **Absentee Owner** | Property owner who doesn't live at the property |
| **ARV** | After Repair Value - estimated value after improvements |
| **BYOK** | Bring Your Own Key - use your own API credentials |
| **Campaign** | Marketing outreach to multiple leads |
| **Credit** | Platform currency for paid actions |
| **CRM** | Customer Relationship Management |
| **Delinquent** | Past due on payments |
| **Due Diligence** | Research before purchasing |
| **Enrichment** | Adding data to records from external sources |
| **Lead** | Potential seller or buyer contact |
| **MAO** | Maximum Allowable Offer |
| **MRR** | Monthly Recurring Revenue |
| **Note** | A loan/financing agreement |
| **Parcel** | A distinct piece of land |
| **Principal** | The original loan amount (not including interest) |
| **ROI** | Return on Investment |
| **Seller Financing** | Seller acts as the lender for buyer |
| **Sequence** | Automated series of marketing touches |
| **Skip Trace** | Finding contact information for a person |
| **TCPA** | Telephone Consumer Protection Act (SMS compliance) |
| **Tier** | Subscription level |

## Appendix B: Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `G then D` | Go to Dashboard |
| `G then L` | Go to Leads |
| `G then P` | Go to Properties |
| `G then F` | Go to Finance |
| `G then M` | Go to Marketing |
| `G then A` | Go to AI Command Center |
| `G then S` | Go to Settings |
| `N` | New (context-dependent) |
| `/` | Focus search |
| `?` | Show shortcuts help |
| `Esc` | Close modal/dialog |

## Appendix C: Troubleshooting Common Issues

### Issue: Cannot See My Leads

**Possible Causes:**
1. Filters are applied - click "Clear Filters"
2. Viewing a saved view with filters - switch to "All Leads"
3. Permission issue - check with admin about your role

### Issue: Campaign Not Sending

**Possible Causes:**
1. Insufficient credits - add credits to your account
2. No valid recipients - check email/phone validity
3. Campaign paused - resume the campaign
4. Service integration issue - check API key configuration

### Issue: Payment Not Recording

**Possible Causes:**
1. Note is in draft status - activate the note first
2. Payment date is in the future - check the date
3. Amount format issue - ensure proper number format

### Issue: Map Not Loading

**Possible Causes:**
1. Mapbox token issue - check environment configuration
2. Browser location blocked - allow location access
3. Properties missing coordinates - add GPS data to properties

### Issue: AI Agent Not Responding

**Possible Causes:**
1. Daily AI request limit reached - wait for reset or upgrade
2. Complex query timing out - try simpler questions
3. Service temporarily unavailable - try again shortly

## Appendix D: Data Format Reference

### CSV Import Formats

**Leads Import:**
```
first_name,last_name,email,phone,address,city,state,zip,type,source,notes
John,Smith,john@email.com,555-123-4567,123 Main St,Austin,TX,78701,seller,tax_list,Hot lead
```

**Properties Import:**
```
apn,address,city,county,state,zip,acreage,latitude,longitude,status,notes
12345678,456 Oak Rd,Round Rock,Williamson,TX,78665,5.5,30.5083,-97.6789,prospect,Vacant lot
```

### Phone Number Format

Use E.164 format for best compatibility:
- US: +15551234567
- Include country code
- No spaces, dashes, or parentheses

### Date Format

Dates should be formatted as:
- YYYY-MM-DD (e.g., 2024-01-15)
- Or MM/DD/YYYY (e.g., 01/15/2024)

## Appendix E: API Rate Limits

| Service | Rate Limit | Notes |
|---------|------------|-------|
| AcreOS API | 1000 req/min | Per user |
| Lob | 300 req/min | Postcard/letter creation |
| Regrid | 60 req/min | Parcel lookups |
| SendGrid | 100 req/sec | Email sending |
| Twilio | 100 req/sec | SMS sending |
| OpenAI | 60 req/min | AI requests |

When limits are reached, requests are queued and processed as capacity allows.

## Appendix F: Status Codes Reference

### Lead Statuses

| Code | Status | Description |
|------|--------|-------------|
| `new` | New | Just added, no action taken |
| `mailed` | Mailed | Outreach sent |
| `responded` | Responded | Lead has responded |
| `negotiating` | Negotiating | In active discussions |
| `accepted` | Accepted | Offer accepted |
| `closed` | Closed | Transaction complete |
| `dead` | Dead | Not interested/unreachable |

### Property Statuses

| Code | Status | Description |
|------|--------|-------------|
| `prospect` | Prospect | Under consideration |
| `due_diligence` | Due Diligence | Actively researching |
| `offer_sent` | Offer Sent | Offer submitted |
| `under_contract` | Under Contract | In escrow |
| `owned` | Owned | You own it |
| `listed` | Listed | For sale |
| `sold` | Sold | Transaction closed |

### Note Statuses

| Code | Status | Description |
|------|--------|-------------|
| `draft` | Draft | Not yet active |
| `active` | Active | Payments being collected |
| `delinquent` | Delinquent | Past due |
| `paid_off` | Paid Off | Fully satisfied |
| `default` | Default | Borrower defaulted |
| `cancelled` | Cancelled | Note cancelled |

---

## Support & Resources

### Getting Help

- **In-App Help**: Click Help & Support in the sidebar
- **AI Assistant**: Ask questions in the AI Command Center
- **Documentation**: Access this manual and other guides
- **Support Email**: Contact support through the Help section

### Providing Feedback

We value your input:
- Use the feedback button in the app
- Suggest features
- Report issues
- Share success stories

---

**AcreOS Owner's Manual v1.0**

*This manual is regularly updated. Check for the latest version in the Help & Support section.*
