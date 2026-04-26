// acreos/data.jsx — fixtures + navigation structure

const DEALS = [
  { id: 'D-2201', parcel: '37-091-014', county: 'Costilla, CO',  acres: 5.12,  owner: 'R. Martinez',       askingK: 12.5, atlasScore: 86, stage: 'Offer Sent',    intent: 'high',   lastTouchH: 3,  mailSent: 2, temp: 'hot'  },
  { id: 'D-2198', parcel: '12-008-117', county: 'Apache, AZ',    acres: 40.00, owner: 'Blue Ridge LLC',    askingK: 58.0, atlasScore: 79, stage: 'Analyzing',     intent: 'medium', lastTouchH: 26, mailSent: 1, temp: 'warm' },
  { id: 'D-2196', parcel: '08-441-002', county: 'Luna, NM',      acres: 10.25, owner: 'J. & S. Pritchard', askingK: 19.8, atlasScore: 92, stage: 'Negotiating',   intent: 'high',   lastTouchH: 1,  mailSent: 3, temp: 'hot'  },
  { id: 'D-2193', parcel: '55-102-088', county: 'Modoc, CA',     acres: 2.50,  owner: 'K. Anders',         askingK: 7.4,  atlasScore: 71, stage: 'New',           intent: 'medium', lastTouchH: 48, mailSent: 0, temp: 'cold' },
  { id: 'D-2187', parcel: '29-014-201', county: 'Hudspeth, TX',  acres: 20.00, owner: 'Torres Holdings',   askingK: 34.0, atlasScore: 83, stage: 'Due Diligence', intent: 'high',   lastTouchH: 8,  mailSent: 2, temp: 'warm' },
  { id: 'D-2180', parcel: '63-007-045', county: 'Park, WY',      acres: 160.0, owner: 'Estate of L. Webb', askingK: 188.0,atlasScore: 68, stage: 'Review',        intent: 'low',    lastTouchH: 72, mailSent: 1, temp: 'cold' },
  { id: 'D-2176', parcel: '41-220-009', county: 'Mohave, AZ',    acres: 1.25,  owner: 'P. Alvarez',        askingK: 4.2,  atlasScore: 74, stage: 'Offer Sent',    intent: 'medium', lastTouchH: 12, mailSent: 2, temp: 'warm' },
  { id: 'D-2172', parcel: '19-557-311', county: 'Lincoln, NV',   acres: 80.0,  owner: 'Redrock Ventures',  askingK: 96.0, atlasScore: 88, stage: 'Negotiating',   intent: 'high',   lastTouchH: 4,  mailSent: 4, temp: 'hot'  },
];

const TASKS = [
  { id: 't1', title: 'Call R. Martinez about counter',        due: 'Today · 2:30 PM', dealId: 'D-2201', priority: 'high',   agent: 'pax'   },
  { id: 't2', title: 'Review Atlas report on Apache parcel',  due: 'Today · 4:00 PM', dealId: 'D-2198', priority: 'medium', agent: 'atlas' },
  { id: 't3', title: 'Approve mail batch · 142 recipients',   due: 'Today · EOD',     dealId: null,     priority: 'high',   agent: 'pax'   },
  { id: 't4', title: 'Follow up: Pritchard signed LOI',       due: 'Tomorrow · 9 AM', dealId: 'D-2196', priority: 'medium', agent: 'pax'   },
  { id: 't5', title: 'Deposit wire · Luna County title co.',  due: 'Wed · 11 AM',     dealId: 'D-2196', priority: 'high',   agent: null    },
];

const ACTIVITY = [
  { id: 'a1', t: '8m',  who: 'Atlas',       msg: 'Flagged 3 new parcels in Costilla matching your criteria.', kind: 'atlas'   },
  { id: 'a2', t: '24m', who: 'Pax',         msg: 'Sent 47 yellow-letter mailers for Apache campaign.',        kind: 'pax'     },
  { id: 'a3', t: '1h',  who: 'R. Martinez', msg: 'Replied — counter at $14.2K, open to seller finance.',      kind: 'inbound' },
  { id: 'a4', t: '2h',  who: 'Sophie',      msg: 'Resolved a billing question from Borrower #043.',           kind: 'sophie'  },
  { id: 'a5', t: '3h',  who: 'Atlas',       msg: 'Completed AVM on 12 parcels · 4 scored above 80.',          kind: 'atlas'   },
  { id: 'a6', t: '5h',  who: 'Lob',         msg: 'Delivered: 14 mailers to Hudspeth, TX.',                    kind: 'system'  },
];

const METRICS = {
  pipelineValue: 1240000, pipelineDeltaPct: 12.4,
  dealsInFlight: 23, mailSent7d: 412, mailDelta7d: 38,
  repliesRate: 6.8, repliesDelta: 1.2,
  closedMTD: 84200, closedDelta: 22.1,
};

const SPARK = [620,640,638,655,670,665,680,695,712,710,728,741,760,758,775,790,812,808,830,855,872,888,902,918,945,970,1002,1040,1108,1240].map(v => v*1000);

const AI_SUGGESTIONS = [
  { id: 's1', kind: 'atlas', title: 'New high-score parcel',
    body: '160ac in Park, WY · score 91 · owner absentee since 2014. Want me to queue a mailer?',
    primary: 'Queue mailer', secondary: 'Analyze' },
  { id: 's2', kind: 'pax', title: 'Reply draft ready',
    body: 'R. Martinez countered at $14.2K. Drafted a $13.8K counter with 24-month terms — review?',
    primary: 'Review draft', secondary: 'Send as-is' },
  { id: 's3', kind: 'atlas', title: 'Comp spread alert',
    body: 'Hudspeth parcel comp set tightened — revised value $31.8K (was $34K). Adjust offer?',
    primary: 'Adjust', secondary: 'Ignore' },
];

// ─── Inbox messages ──────────────────────────────
const INBOX = [
  { id: 'm1', channel: 'email', from: 'R. Martinez',    subj: 'Re: your offer on 37-091-014', preview: "I'd do $14,200 if we can do 24-month terms. Let me know.", time: '8m',  dealId: 'D-2201', unread: true,  tone: 'inbound' },
  { id: 'm2', channel: 'sms',   from: 'P. Alvarez',     subj: '',                             preview: 'got ur letter. willing to talk. call after 5pm',        time: '42m', dealId: 'D-2176', unread: true,  tone: 'inbound' },
  { id: 'm3', channel: 'email', from: 'Title Co. Luna', subj: 'Wire instructions · Pritchard', preview: 'Attached are the wire instructions for the Pritchard…', time: '1h',  dealId: 'D-2196', unread: true,  tone: 'internal' },
  { id: 'm4', channel: 'mail',  from: 'Torres Holdings',subj: 'Returned letter · Hudspeth',   preview: 'USPS returned — addressee moved, no forwarding.',       time: '3h',  dealId: 'D-2187', unread: false, tone: 'system'  },
  { id: 'm5', channel: 'email', from: 'K. Anders',      subj: 'Re: Modoc parcel',             preview: 'Not interested right now, maybe in the spring.',         time: '5h',  dealId: 'D-2193', unread: false, tone: 'inbound' },
  { id: 'm6', channel: 'sms',   from: 'J. Pritchard',   subj: '',                             preview: 'signed the LOI. sent back via docusign.',                time: '1d',  dealId: 'D-2196', unread: false, tone: 'inbound' },
];

// ─── Lists & buy-boxes ──────────────────────────
const BUY_BOXES = [
  { id: 'bb1', name: 'Desert SW · 5-40ac',   states: ['AZ','NM','NV'], acres: '5–40',   priceMax: 40000, score: 85, active: true,  matches: 412 },
  { id: 'bb2', name: 'Rockies · 40-200ac',   states: ['CO','WY','MT'], acres: '40–200', priceMax: 220000, score: 78, active: true,  matches: 167 },
  { id: 'bb3', name: 'Texas West · small',   states: ['TX'],           acres: '1–20',   priceMax: 18000,  score: 80, active: true,  matches: 284 },
  { id: 'bb4', name: 'California NE',        states: ['CA'],           acres: '2–10',   priceMax: 12000,  score: 72, active: false, matches: 91  },
];

const LISTS = [
  { id: 'L-014', name: 'Costilla absentee 2024',  source: 'County records', count: 1840, enriched: 1790, cost: 184, created: 'Jan 18', status: 'ready' },
  { id: 'L-013', name: 'Park WY — tax delinquent', source: 'DataTree',      count: 612,  enriched: 598,  cost: 61,  created: 'Jan 12', status: 'ready' },
  { id: 'L-012', name: 'Apache AZ — absentee 5+',  source: 'County records', count: 2215, enriched: 2115, cost: 221, created: 'Jan 09', status: 'ready' },
  { id: 'L-011', name: 'Luna NM — inherited',      source: 'Probate feed',   count: 147,  enriched: 147,  cost: 15,  created: 'Jan 03', status: 'ready' },
  { id: 'L-010', name: 'Hudspeth TX — vacant 10+', source: 'County records', count: 3418, enriched: 0,    cost: 0,   created: 'Running…', status: 'enriching' },
];

const CAMPAIGNS = [
  { id: 'c1', name: 'Costilla yellow letter · Jan', channel: 'mail',  status: 'active',    sent: 412, replies: 28, offers: 6, deals: 2, spend: 498, roi: 4.2, start: 'Jan 20' },
  { id: 'c2', name: 'Apache SMS drip',              channel: 'sms',   status: 'active',    sent: 180, replies: 21, offers: 4, deals: 1, spend: 63,  roi: 3.1, start: 'Jan 24' },
  { id: 'c3', name: 'Park WY — handwritten',        channel: 'mail',  status: 'paused',    sent: 142, replies: 9,  offers: 2, deals: 0, spend: 298, roi: 0,   start: 'Jan 12' },
  { id: 'c4', name: 'Luna NM · cold call (Pax)',    channel: 'phone', status: 'active',    sent: 96,  replies: 14, offers: 3, deals: 1, spend: 12,  roi: 6.8, start: 'Jan 22' },
  { id: 'c5', name: 'Hudspeth email warm-up',       channel: 'email', status: 'scheduled', sent: 0,   replies: 0,  offers: 0, deals: 0, spend: 0,   roi: 0,   start: 'Feb 01' },
];

// ─── Agents & automations ───────────────────────
const AGENT_RUNS = [
  { id: 'r1', agent: 'Atlas', task: 'Score 142 parcels in Mohave AZ',    status: 'running',   progress: 0.62, started: '4m ago', cost: 1.84 },
  { id: 'r2', agent: 'Pax',   task: 'Reply to R. Martinez counter',       status: 'review',    progress: 1.0,  started: '12m ago', cost: 0.21 },
  { id: 'r3', agent: 'Sophie',task: 'Resolve billing question · #043',    status: 'completed', progress: 1.0,  started: '2h ago', cost: 0.08 },
  { id: 'r4', agent: 'Pax',   task: 'Draft follow-up for 14 warm leads',  status: 'completed', progress: 1.0,  started: '3h ago', cost: 0.92 },
  { id: 'r5', agent: 'Atlas', task: 'Comp set refresh · Park WY region',  status: 'completed', progress: 1.0,  started: '5h ago', cost: 0.44 },
  { id: 'r6', agent: 'Pax',   task: 'Phone campaign · Luna NM batch 3',   status: 'failed',    progress: 0.3,  started: '6h ago', cost: 0.11 },
];

const AUTOMATIONS = [
  { id: 'au1', name: 'New lead → enrich + score',        trigger: 'Lead created',          status: 'active', runs7d: 840, successRate: 98 },
  { id: 'au2', name: 'Reply received → draft response',  trigger: 'Inbound reply',         status: 'active', runs7d: 74,  successRate: 94 },
  { id: 'au3', name: 'Offer accepted → title package',   trigger: 'Stage = Accepted',      status: 'active', runs7d: 3,   successRate: 100 },
  { id: 'au4', name: 'Stale deal → nudge seller',        trigger: '7 days no reply',       status: 'active', runs7d: 42,  successRate: 91 },
  { id: 'au5', name: 'Close date → disposition listing', trigger: 'Closing completed',     status: 'paused', runs7d: 0,   successRate: 100 },
];

// ─── Founder / ops-side data ────────────────────
const FOUNDER_METRICS = {
  mrr:          48400,  mrrDelta: 8.2,
  arr:          580800, arrDelta: 14.1,
  activeTenants:231,    tenantsDelta: 12,
  trials:       48,     trialsDelta: 6,
  netRev30d:    58400,  netRev30dDelta: 11.4,
  agentCost30d: 11280,  agentCost30dDelta: 28.4,
  grossMargin:  0.806,  grossMarginDelta: -0.018,
  nps:          62,     npsDelta: 4,
};

const FOUNDER_TENANTS = [
  { id: 'T-0042', name: 'Norton Holdings',     plan: 'Scale',   mrr: 499, seats: 4, health: 94, lastActive: '2m',  signups: 'Oct 2024', owner: 'Thomas Norton' },
  { id: 'T-0104', name: 'Meridian Land Co',    plan: 'Scale',   mrr: 499, seats: 6, health: 91, lastActive: '8m',  signups: 'Nov 2024', owner: 'C. Whitlock' },
  { id: 'T-0117', name: 'Basin & Range',       plan: 'Growth',  mrr: 199, seats: 2, health: 88, lastActive: '22m', signups: 'Dec 2024', owner: 'R. Basnet' },
  { id: 'T-0189', name: 'Red Sagebrush LLC',   plan: 'Growth',  mrr: 199, seats: 1, health: 74, lastActive: '3h',  signups: 'Jan 2025', owner: 'M. Holliday' },
  { id: 'T-0204', name: 'TerraNova Partners',  plan: 'Scale',   mrr: 499, seats: 8, health: 96, lastActive: '12m', signups: 'Jan 2025', owner: 'A. Kessler' },
  { id: 'T-0218', name: 'Dust Bowl Capital',   plan: 'Starter', mrr: 49,  seats: 1, health: 52, lastActive: '2d',  signups: 'Feb 2025', owner: 'J. Dupree' },
  { id: 'T-0231', name: 'Coyote Creek Ranch',  plan: 'Growth',  mrr: 199, seats: 3, health: 82, lastActive: '1h',  signups: 'Feb 2025', owner: 'L. Trejo' },
];

const FOUNDER_ALERTS = [
  { id: 'fa1', kind: 'churn',   title: 'At-risk: Dust Bowl Capital', body: 'Usage down 74% in last 14d · support ticket unresolved 2d.', tone: 'neg' },
  { id: 'fa2', kind: 'cost',    title: 'Atlas cost anomaly',         body: 'Basin & Range consumed 4.2× their plan credit yesterday.',   tone: 'warn'},
  { id: 'fa3', kind: 'growth',  title: 'Trial conversion up',        body: '11 trials converted this week (avg: 6). Keep the pricing holds.', tone: 'pos' },
  { id: 'fa4', kind: 'signup',  title: 'Enterprise inbound',         body: 'Meridian referred a 12-seat prospect. Pax queued intro email.', tone: 'pos' },
];

const FOUNDER_AGENT_COSTS = [
  { agent: 'Atlas',  runs: 8420, cost: 6180, trend: '+18%' },
  { agent: 'Pax',    runs: 12740, cost: 3840, trend: '+22%' },
  { agent: 'Sophie', runs: 1840, cost: 1260, trend: '+41%' },
];

const FOUNDER_SPARK_MRR = [22,24,26,27,29,30,32,33,34,35,36,37,38,38,39,40,41,42,43,44,45,46,47,48].map(v => v*1000);

// ─── Team members ───────────────────────────────
const TEAM = [
  { id: 'u1', name: 'Thomas Norton',  email: 'thomas@nortonhldg.com',  role: 'Owner',       lastActive: 'now',   dealsTouched: 126 },
  { id: 'u2', name: 'Priya Shah',     email: 'priya@nortonhldg.com',   role: 'Acquisitions', lastActive: '14m',  dealsTouched: 84  },
  { id: 'u3', name: 'Marcus Lee',     email: 'marcus@nortonhldg.com',  role: 'Dispositions', lastActive: '2h',   dealsTouched: 42  },
  { id: 'u4', name: 'Elena Velasquez', email: 'elena@nortonhldg.com',  role: 'Analyst',     lastActive: '1d',    dealsTouched: 18  },
];

// ─── Navigation ─────────────────────────────────
// Founder group hidden via `hidden: true`. Revealed with key combo or Tweak toggle.
const NAV = [
  { group: 'Today', items: [
    { id: 'home',       label: 'Command Center', icon: 'home',     badge: 3 },
    { id: 'inbox',      label: 'Inbox',          icon: 'inbox',    badge: 3 },
    { id: 'calendar',   label: 'Calendar',       icon: 'calendar' },
  ]},
  { group: 'Deals', items: [
    { id: 'pipeline',   label: 'Pipeline',       icon: 'pipeline' },
    { id: 'parcels',    label: 'Parcels',        icon: 'map' },
    { id: 'contacts',   label: 'Contacts',       icon: 'users' },
    { id: 'offers',     label: 'Offers',         icon: 'note' },
    { id: 'documents',  label: 'Documents',      icon: 'folder' },
  ]},
  { group: 'Acquire', items: [
    { id: 'buybox',     label: 'Buy-boxes',      icon: 'filter' },
    { id: 'lists',      label: 'Lists',          icon: 'layers' },
    { id: 'campaigns',  label: 'Campaigns',      icon: 'mail' },
    { id: 'perf',       label: 'Campaign perf',  icon: 'chart' },
  ]},
  { group: 'Close & Hold', items: [
    { id: 'finance',    label: 'Seller finance', icon: 'coin' },
    { id: 'dispos',     label: 'Dispositions',   icon: 'house' },
  ]},
  { group: 'Intelligence', items: [
    { id: 'pax',        label: 'Ask AcreOS',     icon: 'sparkle' },
    { id: 'agents',     label: 'Agent workspace',icon: 'wand' },
    { id: 'automation', label: 'Automations',    icon: 'bolt' },
    { id: 'audit',      label: 'Audit log',      icon: 'shield' },
  ]},
  { group: 'Platform', items: [
    { id: 'team',       label: 'Team',           icon: 'users' },
    { id: 'billing',    label: 'Billing',        icon: 'coin' },
    { id: 'integrations',label: 'Integrations',  icon: 'layers' },
  ]},
  { group: 'Founder', hidden: true, items: [
    { id: 'founder',      label: 'Overview',       icon: 'shield' },
    { id: 'founder-rev',  label: 'Revenue',        icon: 'chart' },
    { id: 'founder-tenants', label: 'Tenants',     icon: 'users' },
    { id: 'founder-cost', label: 'Agent economics',icon: 'spark' },
    { id: 'founder-ops',  label: 'Ops & incidents',icon: 'bolt' },
  ]},
];

const NAV_FOOTER = [
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

Object.assign(window, {
  DEALS, TASKS, ACTIVITY, METRICS, SPARK, AI_SUGGESTIONS,
  INBOX, BUY_BOXES, LISTS, CAMPAIGNS,
  AGENT_RUNS, AUTOMATIONS,
  FOUNDER_METRICS, FOUNDER_TENANTS, FOUNDER_ALERTS, FOUNDER_AGENT_COSTS, FOUNDER_SPARK_MRR,
  TEAM,
  NAV, NAV_FOOTER
});
