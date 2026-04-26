// acreos/pages-tier2345.jsx — Acquire · Close/Hold · Intelligence · Platform

// ─── Buy-boxes ──────────────────────────────────
const BuyBoxes = () => (<div className="pg">
  <header className="pg-hd">
    <div><div className="acr-eyebrow">Acquire · Buy-boxes</div><h1 className="pg-title">{BUY_BOXES.filter(b=>b.active).length} active · {BUY_BOXES.reduce((s,b)=>s+b.matches,0).toLocaleString()} matching parcels</h1></div>
    <Button icon="plus" variant="primary">New buy-box</Button>
  </header>
  <div className="bb-grid">
    {BUY_BOXES.map(b => (
      <Card key={b.id} interactive className="bb-card">
        <div className="bb-hd">
          <h3>{b.name}</h3>
          {b.active ? <Pill tone="pos" dot>Active</Pill> : <Pill>Paused</Pill>}
        </div>
        <div className="bb-meta">{b.states.join(' · ')} · {b.acres} ac · max {fmtK(b.priceMax)}</div>
        <div className="bb-stats">
          <div><div className="stat-num">{b.matches.toLocaleString()}</div><div className="stat-label">matches</div></div>
          <div><div className="stat-num">{b.score}</div><div className="stat-label">avg score</div></div>
        </div>
        <Button size="sm" variant="subtle">View matches</Button>
      </Card>
    ))}
  </div>
</div>);

// ─── Lists ──────────────────────────────────────
const Lists = () => (<div className="pg">
  <header className="pg-hd">
    <div><div className="acr-eyebrow">Acquire · Lists</div><h1 className="pg-title">{LISTS.length} lists · {LISTS.reduce((s,l)=>s+l.count,0).toLocaleString()} records</h1></div>
    <div className="pg-actions"><Button icon="plus">Import list</Button><Button variant="primary" icon="wand">Build from county</Button></div>
  </header>
  <Card padded={false}>
    <table className="tbl">
      <thead><tr><th>List</th><th>Source</th><th className="num">Records</th><th className="num">Enriched</th><th className="num">Cost</th><th>Created</th><th></th></tr></thead>
      <tbody>
        {LISTS.map(l => (
          <tr key={l.id} className="tbl-row">
            <td><b>{l.name}</b><div className="mono" style={{color:'var(--ink-3)',fontSize:11,marginTop:2}}>{l.id}</div></td>
            <td>{l.source}</td>
            <td className="num">{l.count.toLocaleString()}</td>
            <td className="num">{l.enriched ? `${Math.round(l.enriched/l.count*100)}%` : <Pill tone="warn" dot>Running</Pill>}</td>
            <td className="num">{l.cost?`$${l.cost}`:'—'}</td>
            <td>{l.created}</td>
            <td><I.chevRt size={14}/></td>
          </tr>
        ))}
      </tbody>
    </table>
  </Card>
</div>);

// ─── Campaigns ──────────────────────────────────
const Campaigns = () => {
  const [status, setStatus] = React.useState('all');
  const filtered = status === 'all' ? CAMPAIGNS : CAMPAIGNS.filter(c => c.status === status);
  const counts = {
    all: CAMPAIGNS.length,
    active: CAMPAIGNS.filter(c=>c.status==='active').length,
    paused: CAMPAIGNS.filter(c=>c.status==='paused').length,
    draft: CAMPAIGNS.filter(c=>c.status==='draft').length,
    ended: CAMPAIGNS.filter(c=>c.status==='ended').length,
  };
  return (<div className="pg">
    <header className="pg-hd">
      <div><div className="acr-eyebrow">Acquire · Campaigns</div><h1 className="pg-title">{counts.active} active · {CAMPAIGNS.reduce((s,c)=>s+c.sent,0)} touches this month</h1></div>
      <Button icon="plus" variant="primary">New campaign</Button>
    </header>
    <div className="pg-filters">
      {[['all','All'],['active','Active'],['paused','Paused'],['draft','Draft'],['ended','Ended']].map(([k,label])=>(
        <button key={k} className={cx('chip', status===k && 'chip-on')} onClick={()=>setStatus(k)}>
          {label} · {counts[k] || 0}
        </button>
      ))}
    </div>
    {filtered.length === 0 ? (
      <EmptyState
        icon="mail"
        eyebrow={`Status · ${status}`}
        title={status==='draft' ? "No drafts in the queue." : status==='paused' ? "Nothing paused right now." : status==='ended' ? "No campaigns have wrapped this period." : `No ${status} campaigns.`}
        body={status==='draft'
          ? "Drafts wait here until you launch them. Build one when you're ready, or kick off straight from a list."
          : "Switch tabs above to see what's running, or spin up a new campaign."}
        actions={[
          { label: 'See all', onClick: () => setStatus('all'), variant: 'subtle' },
          { label: 'New campaign', icon: 'plus', variant: 'primary' },
        ]}
      />
    ) : (
    <div className="cp-grid">
      {filtered.map(c => (
        <Card key={c.id} interactive className="cp-card">
          <div className="cp-hd">
            <div className="cp-chan"><I.mail size={13}/> {c.channel.toUpperCase()}</div>
            <Pill tone={c.status==='active'?'pos':c.status==='paused'?'warn':'neutral'} dot>{c.status}</Pill>
          </div>
          <h3 className="cp-name">{c.name}</h3>
          <div className="cp-stats">
            <div><div className="stat-num">{c.sent}</div><div className="stat-label">sent</div></div>
            <div><div className="stat-num">{c.replies}</div><div className="stat-label">replies</div></div>
            <div><div className="stat-num">{c.offers}</div><div className="stat-label">offers</div></div>
            <div><div className="stat-num">{c.deals}</div><div className="stat-label">deals</div></div>
          </div>
          <div className="cp-foot">
            <span>Started {c.start}</span>
            <span className={cx('cp-roi', c.roi>=3 && 'cp-roi-hi')}>{c.roi?`${c.roi}× ROI`:'—'}</span>
          </div>
        </Card>
      ))}
    </div>
    )}
  </div>);
};

// ─── Campaign performance ──────────────────────
const CampaignPerf = () => {
  const totals = CAMPAIGNS.reduce((acc,c)=>({sent:acc.sent+c.sent, replies:acc.replies+c.replies, deals:acc.deals+c.deals, spend:acc.spend+c.spend}),{sent:0,replies:0,deals:0,spend:0});
  return (<div className="pg">
    <header className="pg-hd">
      <div><div className="acr-eyebrow">Acquire · Performance</div><h1 className="pg-title">Last 30 days</h1></div>
      <div className="pg-actions"><Button icon="filter">Filter</Button></div>
    </header>
    <div className="kpi-row">
      {[
        ['Touches', totals.sent, '+12% vs 30d'],
        ['Reply rate', `${(totals.replies/totals.sent*100).toFixed(1)}%`, '+0.8pp'],
        ['Cost per reply', `$${(totals.spend/totals.replies).toFixed(2)}`, '-$3.20'],
        ['Cost per deal', `$${(totals.spend/Math.max(1,totals.deals)).toFixed(0)}`, '-$84'],
      ].map((k,i)=>(
        <Card key={i}>
          <div className="acr-eyebrow">{k[0]}</div>
          <div className="kpi-val">{k[1]}</div>
          <div className="kpi-delta">{k[2]}</div>
        </Card>
      ))}
    </div>
    <SectionTitle eyebrow="By channel" title="Where the deals come from">
      <Card padded={false}>
        <table className="tbl">
          <thead><tr><th>Channel</th><th className="num">Sent</th><th className="num">Replies</th><th className="num">Offers</th><th className="num">Deals</th><th className="num">Spend</th><th className="num">CPA</th></tr></thead>
          <tbody>
            {['mail','sms','phone','email'].map(ch => {
              const list = CAMPAIGNS.filter(c=>c.channel===ch);
              const s = list.reduce((a,c)=>({sent:a.sent+c.sent,replies:a.replies+c.replies,offers:a.offers+c.offers,deals:a.deals+c.deals,spend:a.spend+c.spend}),{sent:0,replies:0,offers:0,deals:0,spend:0});
              return <tr key={ch} className="tbl-row">
                <td><b>{ch.toUpperCase()}</b></td>
                <td className="num">{s.sent}</td><td className="num">{s.replies}</td><td className="num">{s.offers}</td><td className="num">{s.deals}</td>
                <td className="num">${s.spend}</td>
                <td className="num">{s.deals?`$${Math.round(s.spend/s.deals)}`:'—'}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </Card>
    </SectionTitle>
  </div>);
};

// ─── Offers ─────────────────────────────────────
const Offers = () => (<div className="pg">
  <header className="pg-hd">
    <div><div className="acr-eyebrow">Close · Offers</div><h1 className="pg-title">4 out · 2 accepted · 1 countered</h1></div>
    <Button variant="primary" icon="plus">Draft offer</Button>
  </header>
  <Card padded={false}>
    <table className="tbl">
      <thead><tr><th>Offer</th><th>Parcel</th><th>Owner</th><th className="num">Amount</th><th>Terms</th><th>Status</th><th>Sent</th></tr></thead>
      <tbody>
        {[
          ['O-0421','08-441-002','J. & S. Pritchard',11500,'24mo · 12% APR','Countered','2d ago'],
          ['O-0420','12-008-117','Blue Ridge LLC',52000,'Cash','Pending','3d ago'],
          ['O-0417','37-091-014','R. Martinez',11000,'6mo balloon','Counter sent','1w ago'],
          ['O-0414','19-557-311','Redrock Ventures',88000,'Cash','Accepted','2w ago'],
        ].map((r,i)=>(
          <tr key={i} className="tbl-row">
            <td className="mono">{r[0]}</td><td className="mono">{r[1]}</td><td>{r[2]}</td>
            <td className="num">{fmtK(r[3])}</td><td>{r[4]}</td>
            <td><Pill tone={r[5]==='Accepted'?'pos':r[5]==='Countered'?'warn':'neutral'} dot>{r[5]}</Pill></td>
            <td>{r[6]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </Card>
</div>);

// ─── Documents ──────────────────────────────────
const Documents = () => {
  const [q, setQ] = React.useState('');
  const [tone, setTone] = React.useState('all');
  const docs = [
    ['Purchase Agreement','D-2196 · Pritchard','PDF · 4pg','signed'],
    ['Title Commitment','D-2196 · Pritchard','PDF · 14pg','review'],
    ['Promissory Note','D-2196 · Pritchard','DOCX','pending'],
    ['Deed of Trust','D-2172 · Redrock','PDF · 6pg','signed'],
    ['W-9 · Seller','D-2187 · Torres','PDF','pending'],
    ['HOA Disclosure','D-2172 · Redrock','PDF · 2pg','signed'],
  ];
  const filtered = docs.filter(d => {
    if (tone !== 'all' && d[3] !== tone) return false;
    if (q.trim() && !(d[0]+' '+d[1]).toLowerCase().includes(q.trim().toLowerCase())) return false;
    return true;
  });
  return (<div className="pg">
    <header className="pg-hd">
      <div><div className="acr-eyebrow">Close · Documents</div><h1 className="pg-title">Vault · 284 documents across 23 deals</h1></div>
      <div className="pg-actions">
        <div className="pg-search">
          <I.search size={13}/>
          <input
            type="text"
            placeholder="Search documents"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search documents"
          />
        </div>
        <Button icon="plus" variant="primary">Upload</Button>
      </div>
    </header>
    <div className="pg-filters">
      {[['all','All'],['signed','Signed'],['review','In review'],['pending','Pending']].map(([k,l])=>(
        <button key={k} className={cx('chip', tone===k && 'chip-on')} onClick={()=>setTone(k)}>{l}</button>
      ))}
    </div>
    {filtered.length === 0 ? (
      <EmptyState
        icon="folder"
        eyebrow={q.trim() ? "No matches" : `Filter · ${tone}`}
        title={q.trim() ? `Nothing for "${q}".` : `No documents in ${tone}.`}
        body={q.trim()
          ? "Try a different file name or deal ID. Or clear the search to see the whole vault."
          : "Switch filters to see what's elsewhere, or drop a file to upload."}
        actions={[
          { label: q.trim() ? 'Clear search' : 'See all', onClick: () => { setQ(''); setTone('all'); }, variant: 'subtle' },
          { label: 'Upload', icon: 'plus', variant: 'primary' },
        ]}
      />
    ) : (
    <div className="doc-grid">
      {filtered.map((d,i)=>(
        <Card key={i} interactive className="doc-card">
          <div className="doc-ic"><I.note size={18}/></div>
          <div className="doc-name">{d[0]}</div>
          <div className="doc-meta">{d[1]}</div>
          <div className="doc-foot"><span className="mono muted">{d[2]}</span><Pill tone={d[3]==='signed'?'pos':d[3]==='review'?'warn':'neutral'} dot>{d[3]}</Pill></div>
        </Card>
      ))}
    </div>
    )}
  </div>);
};

// ─── Seller finance ─────────────────────────────
const SellerFinance = () => (<div className="pg">
  <header className="pg-hd">
    <div><div className="acr-eyebrow">Hold · Seller finance</div><h1 className="pg-title">14 notes active · $184K principal outstanding · $2,140/mo in</h1></div>
    <Button variant="primary" icon="plus">New note</Button>
  </header>
  <div className="kpi-row">
    {[
      ['Monthly collections','$2,140','+$184'],
      ['Outstanding principal','$184,200','-$1,892'],
      ['Avg APR','11.8%','—'],
      ['Delinquent','1 note','-1 vs last mo'],
    ].map((k,i)=>(<Card key={i}><div className="acr-eyebrow">{k[0]}</div><div className="kpi-val">{k[1]}</div><div className="kpi-delta">{k[2]}</div></Card>))}
  </div>
  <Card padded={false}>
    <table className="tbl">
      <thead><tr><th>Note</th><th>Borrower</th><th>Parcel</th><th className="num">Principal</th><th className="num">Balance</th><th className="num">Payment</th><th>Next due</th><th>Status</th></tr></thead>
      <tbody>
        {[
          ['N-043','M. Reyes','08-441-119',18500,14200,298,'Feb 01','current'],
          ['N-041','D. Kim','29-014-201',22000,18400,388,'Feb 05','current'],
          ['N-038','B. Okoro','12-008-088',44000,32100,642,'Feb 10','late'],
          ['N-034','T. Lin','37-091-007',11200,6800,212,'Feb 12','current'],
        ].map((r,i)=>(
          <tr key={i} className="tbl-row">
            <td className="mono">{r[0]}</td><td>{r[1]}</td><td className="mono">{r[2]}</td>
            <td className="num">{fmtK(r[3])}</td><td className="num">{fmtK(r[4])}</td><td className="num">${r[5]}</td>
            <td>{r[6]}</td>
            <td><Pill tone={r[7]==='late'?'neg':'pos'} dot>{r[7]}</Pill></td>
          </tr>
        ))}
      </tbody>
    </table>
  </Card>
</div>);

// ─── Dispositions ───────────────────────────────
const Dispositions = () => (<div className="pg">
  <header className="pg-hd">
    <div><div className="acr-eyebrow">Hold · Dispositions</div><h1 className="pg-title">6 listed · 94 buyers on list · $412K in pending</h1></div>
    <Button variant="primary" icon="plus">List parcel</Button>
  </header>
  <div className="cp-grid">
    {[
      ['08-441-119','Luna NM · 10ac','Listed · Lands of America','3 inquiries',22800],
      ['12-008-088','Apache AZ · 40ac','Listed · email list','12 inquiries',64000],
      ['37-091-014','Costilla CO · 5ac','Draft','—',14200],
      ['29-014-201','Hudspeth TX · 20ac','Listed · LoopNet','7 inquiries',42000],
      ['19-557-311','Lincoln NV · 80ac','Under contract','1 buyer',124000],
      ['63-007-045','Park WY · 160ac','Pre-list','—',244000],
    ].map((p,i)=>(
      <Card key={i} interactive className="cp-card">
        <div className="cp-hd"><div className="mono" style={{color:'var(--ink-3)',fontSize:11}}>{p[0]}</div><Pill>{p[2].split(' · ')[0]}</Pill></div>
        <h3 className="cp-name">{p[1]}</h3>
        <div className="cp-stats"><div><div className="stat-num">{fmtK(p[4])}</div><div className="stat-label">asking</div></div><div><div className="stat-num">{p[3].split(' ')[0]}</div><div className="stat-label">inquiries</div></div></div>
      </Card>
    ))}
  </div>
</div>);

// ─── Agent workspace ────────────────────────────
const AgentWorkspace = () => (<div className="pg">
  <header className="pg-hd">
    <div><div className="acr-eyebrow">Intelligence · Agents</div><h1 className="pg-title">{AGENT_RUNS.filter(r=>r.status==='running').length} running · {AGENT_RUNS.filter(r=>r.status==='review').length} awaiting review</h1></div>
    <div className="pg-actions"><Button icon="pause">Pause all</Button><Button variant="primary" icon="bolt">New run</Button></div>
  </header>
  <Card padded={false}>
    <table className="tbl">
      <thead><tr><th>Agent</th><th>Task</th><th>Progress</th><th>Status</th><th>Started</th><th className="num">Cost</th><th></th></tr></thead>
      <tbody>
        {AGENT_RUNS.map(r => (
          <tr key={r.id} className="tbl-row">
            <td><Pill tone="brand" dot>{r.agent}</Pill></td>
            <td>{r.task}</td>
            <td style={{width:160}}>
              <div className="prog"><div className="prog-fill" style={{width:`${r.progress*100}%`,background:r.status==='failed'?'var(--neg)':'var(--brand)'}}/></div>
            </td>
            <td><Pill tone={r.status==='completed'?'pos':r.status==='failed'?'neg':r.status==='review'?'warn':'neutral'} dot>{r.status}</Pill></td>
            <td className="muted">{r.started}</td>
            <td className="num">${r.cost.toFixed(2)}</td>
            <td><I.chevRt size={14}/></td>
          </tr>
        ))}
      </tbody>
    </table>
  </Card>
</div>);

// ─── Automation builder ─────────────────────────
const Automations = () => (<div className="pg">
  <header className="pg-hd">
    <div><div className="acr-eyebrow">Intelligence · Automations</div><h1 className="pg-title">{AUTOMATIONS.filter(a=>a.status==='active').length} active · {AUTOMATIONS.reduce((s,a)=>s+a.runs7d,0)} runs this week</h1></div>
    <Button variant="primary" icon="plus">New automation</Button>
  </header>
  <div className="auto-list">
    {AUTOMATIONS.map(a => (
      <Card key={a.id} interactive className="auto-row">
        <div className="auto-l">
          <div className="auto-name">{a.name}</div>
          <div className="auto-trig"><I.bolt size={12}/> When <b>{a.trigger}</b></div>
        </div>
        <div className="auto-r">
          <div><div className="stat-num">{a.runs7d}</div><div className="stat-label">runs · 7d</div></div>
          <div><div className="stat-num">{a.successRate}%</div><div className="stat-label">success</div></div>
          <Pill tone={a.status==='active'?'pos':'neutral'} dot>{a.status}</Pill>
        </div>
      </Card>
    ))}
  </div>
</div>);

// ─── Audit log ──────────────────────────────────
const AuditLog = () => (<div className="pg">
  <header className="pg-hd">
    <div><div className="acr-eyebrow">Intelligence · Audit</div><h1 className="pg-title">Everything the platform did for you</h1></div>
    <div className="pg-actions"><Button icon="filter">Filter</Button><Button icon="folder">Export</Button></div>
  </header>
  <Card>
    <div className="audit-list">
      {[
        ['12:42 PM','Pax sent reply to R. Martinez via email','Approved by Thomas Norton'],
        ['12:39 PM','Atlas scored 142 parcels in Mohave AZ','Cost: $1.84 · 4m 12s'],
        ['12:28 PM','Automation: Stale deal → nudge seller · fired for D-2180','Success'],
        ['12:12 PM','Pax drafted follow-up for 14 warm leads','Pending review'],
        ['11:58 AM','Sophie resolved billing question · Borrower #043','Auto-resolved'],
        ['11:41 AM','User: Priya Shah exported Pipeline CSV','Exported 23 rows'],
        ['11:28 AM','Pax sent 47 yellow-letter mailers for Apache campaign','Via Lob'],
      ].map((a,i)=>(
        <div key={i} className="audit-row">
          <div className="audit-time mono">{a[0]}</div>
          <div className="audit-msg">{a[1]}</div>
          <div className="audit-meta">{a[2]}</div>
        </div>
      ))}
    </div>
  </Card>
</div>);

// ─── Team ───────────────────────────────────────
const Team = () => (<div className="pg">
  <header className="pg-hd">
    <div><div className="acr-eyebrow">Platform · Team</div><h1 className="pg-title">{TEAM.length} members · Scale plan</h1></div>
    <Button variant="primary" icon="plus">Invite member</Button>
  </header>
  <Card padded={false}>
    <table className="tbl">
      <thead><tr><th></th><th>Name</th><th>Email</th><th>Role</th><th>Deals touched</th><th>Last active</th><th></th></tr></thead>
      <tbody>
        {TEAM.map(m => (
          <tr key={m.id} className="tbl-row">
            <td><Avatar name={m.name} size={28}/></td>
            <td><b>{m.name}</b></td>
            <td className="muted">{m.email}</td>
            <td><Pill>{m.role}</Pill></td>
            <td>{m.dealsTouched}</td>
            <td className="muted">{m.lastActive}</td>
            <td><I.chevRt size={14}/></td>
          </tr>
        ))}
      </tbody>
    </table>
  </Card>
</div>);

// ─── Billing ────────────────────────────────────
const Billing = () => (<div className="pg">
  <header className="pg-hd">
    <div><div className="acr-eyebrow">Platform · Billing</div><h1 className="pg-title">Scale · $499/mo · renews Feb 28</h1></div>
    <Button>Manage plan</Button>
  </header>
  <div className="kpi-row">
    {[
      ['Atlas credits','8,420 / 12,000','70% used'],
      ['Pax minutes','412 / 1,000','41% used'],
      ['Mail sent (mo)','498 / unlimited','—'],
      ['Data lookups','2,184 / 5,000','44% used'],
    ].map((k,i)=>(<Card key={i}><div className="acr-eyebrow">{k[0]}</div><div className="kpi-val">{k[1]}</div><div className="kpi-delta">{k[2]}</div></Card>))}
  </div>
  <SectionTitle eyebrow="Invoices" title="Recent">
    <Card padded={false}>
      <table className="tbl">
        <thead><tr><th>Invoice</th><th>Date</th><th>Plan</th><th className="num">Amount</th><th>Status</th></tr></thead>
        <tbody>
          {[['INV-0042','Jan 28','Scale · monthly',499,'paid'],['INV-0038','Dec 28','Scale · monthly',499,'paid'],['INV-0034','Nov 28','Scale · monthly',499,'paid']].map((r,i)=>(
            <tr key={i} className="tbl-row"><td className="mono">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td className="num">${r[3]}</td><td><Pill tone="pos" dot>{r[4]}</Pill></td></tr>
          ))}
        </tbody>
      </table>
    </Card>
  </SectionTitle>
</div>);

// ─── Integrations ───────────────────────────────
const Integrations = () => (<div className="pg">
  <header className="pg-hd">
    <div><div className="acr-eyebrow">Platform · Integrations</div><h1 className="pg-title">7 connected · 14 available</h1></div>
  </header>
  <div className="int-grid">
    {[
      ['DataTree','Parcel & owner data','connected'],
      ['Lob','Direct mail delivery','connected'],
      ['Twilio','SMS & voice','connected'],
      ['Gmail','Email relay','connected'],
      ['DocuSign','E-signature','connected'],
      ['Stripe','Payment collection','connected'],
      ['Plaid','ACH & bank link','connected'],
      ['LandVision','Parcel GIS','available'],
      ['PropStream','Skip trace','available'],
      ['Zapier','Automation bridge','available'],
    ].map((x,i)=>(
      <Card key={i} interactive className="int-card">
        <div className="int-logo">{x[0][0]}</div>
        <div className="int-name">{x[0]}</div>
        <div className="int-desc">{x[1]}</div>
        {x[2]==='connected' ? <Pill tone="pos" dot>Connected</Pill> : <Button size="sm" variant="subtle">Connect</Button>}
      </Card>
    ))}
  </div>
</div>);

// ─── Calendar (compact) ─────────────────────────
const CalendarPage = () => (<div className="pg">
  <header className="pg-hd">
    <div><div className="acr-eyebrow">Today · Calendar</div><h1 className="pg-title">Week of Jan 27 · 14 events · 3 calls</h1></div>
    <div className="pg-actions"><Button icon="plus">Add event</Button></div>
  </header>
  <div className="cal-week">
    {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i)=>(
      <div key={d} className="cal-day">
        <div className="cal-day-hd"><span>{d}</span><span className="cal-day-num">{27+i}</span></div>
        {i===0 && <div className="cal-ev cal-ev-brand">2:30 · Call R. Martinez</div>}
        {i===0 && <div className="cal-ev">4:00 · Atlas review</div>}
        {i===1 && <div className="cal-ev cal-ev-accent">9:00 · Pritchard LOI follow-up</div>}
        {i===2 && <div className="cal-ev cal-ev-brand">11:00 · Wire · Luna title co.</div>}
        {i===3 && <div className="cal-ev">2:00 · Team sync</div>}
        {i===4 && <div className="cal-ev cal-ev-accent">10:30 · Buyer showing · Apache</div>}
      </div>
    ))}
  </div>
</div>);

// ─── Founder Dashboard (the crown jewel) ────────
const FounderHome = ({ onNav }) => {
  const M = FOUNDER_METRICS;
  return (<div className="pg founder-pg">
    <div className="founder-hero">
      <div>
        <div className="acr-eyebrow" style={{color:'var(--brand)'}}>⌁ Founder · ops-only</div>
        <h1 className="founder-title">Good afternoon, Thomas.</h1>
        <p className="founder-sub">You run <b>{M.activeTenants} tenants</b>, <b>{fmtK(M.mrr)}/mo MRR</b>, <b>{(M.grossMargin*100).toFixed(1)}% gross margin</b>. Three things need you today.</p>
      </div>
      <div className="pg-actions">
        <Button icon="sparkle" variant="subtle">Ask Atlas-F</Button>
        <Button icon="shield" variant="primary">Ops log</Button>
      </div>
    </div>

    {/* Hero metrics — bigger, editorial */}
    <div className="founder-metrics">
      <Card className="fm-card fm-primary">
        <div className="acr-eyebrow">MRR</div>
        <div className="fm-val">{fmtK(M.mrr)}</div>
        <div className="fm-delta fm-delta-pos">↑ {M.mrrDelta}% mo/mo</div>
        <div className="fm-spark"><Sparkline data={FOUNDER_SPARK_MRR} height={44}/></div>
      </Card>
      <Card className="fm-card">
        <div className="acr-eyebrow">ARR</div>
        <div className="fm-val">{fmtK(M.arr)}</div>
        <div className="fm-delta fm-delta-pos">↑ {M.arrDelta}%</div>
      </Card>
      <Card className="fm-card">
        <div className="acr-eyebrow">Tenants</div>
        <div className="fm-val">{M.activeTenants}</div>
        <div className="fm-delta fm-delta-pos">+{M.tenantsDelta} this month</div>
      </Card>
      <Card className="fm-card">
        <div className="acr-eyebrow">Gross margin</div>
        <div className="fm-val">{(M.grossMargin*100).toFixed(1)}%</div>
        <div className="fm-delta fm-delta-neg">{(M.grossMarginDelta*100).toFixed(1)}pp</div>
      </Card>
      <Card className="fm-card">
        <div className="acr-eyebrow">Agent spend 30d</div>
        <div className="fm-val">{fmtK(M.agentCost30d)}</div>
        <div className="fm-delta fm-delta-neg">↑ {M.agentCost30dDelta}%</div>
      </Card>
      <Card className="fm-card">
        <div className="acr-eyebrow">Trials</div>
        <div className="fm-val">{M.trials}</div>
        <div className="fm-delta fm-delta-pos">+{M.trialsDelta}</div>
      </Card>
    </div>

    {/* What needs you today */}
    <div className="founder-grid">
      <div className="founder-col">
        <SectionTitle eyebrow="Needs you" title="Three things today" action={<Button size="sm">All alerts</Button>}>
          <div className="fa-list">
            {FOUNDER_ALERTS.map(a => (
              <Card key={a.id} className={cx('fa-card',`fa-${a.tone}`)}>
                <div className="fa-hd">
                  <Pill tone={a.tone}>{a.kind}</Pill>
                  <span className="muted" style={{fontSize:11}}>Just now</span>
                </div>
                <div className="fa-title">{a.title}</div>
                <div className="fa-body">{a.body}</div>
                <div className="pg-actions" style={{marginTop:10}}>
                  <Button size="sm" variant="subtle">Dismiss</Button>
                  <Button size="sm" variant="primary">Take action</Button>
                </div>
              </Card>
            ))}
          </div>
        </SectionTitle>

        <SectionTitle eyebrow="Tenants" title="Top accounts by MRR" action={<Button size="sm" onClick={()=>onNav('founder-tenants')}>All tenants</Button>}>
          <Card padded={false}>
            <table className="tbl">
              <thead><tr><th>Tenant</th><th>Plan</th><th>Owner</th><th className="num">MRR</th><th>Seats</th><th>Health</th><th>Last active</th></tr></thead>
              <tbody>
                {FOUNDER_TENANTS.map(t => (
                  <tr key={t.id} className="tbl-row">
                    <td><b>{t.name}</b><div className="mono muted" style={{fontSize:11,marginTop:2}}>{t.id}</div></td>
                    <td><Pill tone={t.plan==='Scale'?'brand':'neutral'}>{t.plan}</Pill></td>
                    <td>{t.owner}</td>
                    <td className="num">${t.mrr}</td>
                    <td className="num">{t.seats}</td>
                    <td><span className={cx('score', t.health>=90&&'score-hi', t.health>=75&&t.health<90&&'score-mid', t.health<75&&'score-low')}>{t.health}</span></td>
                    <td className="muted">{t.lastActive}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </SectionTitle>
      </div>

      <aside className="founder-side">
        <Card>
          <div className="acr-eyebrow">Agent economics · 30d</div>
          <div style={{marginTop:10}}>
            {FOUNDER_AGENT_COSTS.map(c => (
              <div key={c.agent} className="ae-row">
                <div className="ae-agent"><Pill tone="brand">{c.agent}</Pill></div>
                <div className="ae-runs">{c.runs.toLocaleString()} runs</div>
                <div className="ae-cost">${c.cost.toLocaleString()}</div>
                <div className="ae-trend muted">{c.trend}</div>
              </div>
            ))}
          </div>
          <div className="ae-total">Total <b>{fmtK(M.agentCost30d)}</b> · <span style={{color:'var(--neg)'}}>+{M.agentCost30dDelta}%</span></div>
          <Button size="sm" variant="subtle" onClick={()=>onNav('founder-cost')}>Drill into unit economics →</Button>
        </Card>

        <Card>
          <div className="acr-eyebrow">System health</div>
          <div className="health-list">
            {[
              ['API latency p50','74ms','pos'],
              ['API latency p99','412ms','pos'],
              ['Pax avg run time','8.4s','pos'],
              ['Atlas queue depth','28','warn'],
              ['Error rate 24h','0.14%','pos'],
              ['Active incidents','0','pos'],
            ].map((h,i)=>(
              <div key={i} className="health-row">
                <span className="muted">{h[0]}</span>
                <span className={cx('health-val', h[2]==='pos'&&'health-pos', h[2]==='warn'&&'health-warn')}>{h[1]}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="acr-eyebrow">Quick actions</div>
          <div className="qa-list">
            <button className="qa-btn"><I.sparkle size={14}/><span>Draft investor update</span></button>
            <button className="qa-btn"><I.shield size={14}/><span>Impersonate tenant</span></button>
            <button className="qa-btn"><I.coin size={14}/><span>Issue credit</span></button>
            <button className="qa-btn"><I.bolt size={14}/><span>Kill switch · Agents</span></button>
            <button className="qa-btn"><I.users size={14}/><span>Invite investor</span></button>
          </div>
        </Card>

        <Card className="founder-nps">
          <div className="acr-eyebrow">NPS (30d)</div>
          <div className="nps-big">{M.nps}</div>
          <div className="muted" style={{fontSize:12}}>+{M.npsDelta} vs last month · 84 responses</div>
        </Card>
      </aside>
    </div>
  </div>);
};

// ─── Founder drill-downs ────────────────────────

const FounderRevenue = () => {
  const cohorts = [
    { month: 'Apr', signups: 14, retained: 14, mrr: 1316 },
    { month: 'May', signups: 22, retained: 21, mrr: 1974 },
    { month: 'Jun', signups: 31, retained: 28, mrr: 2632 },
    { month: 'Jul', signups: 28, retained: 24, mrr: 2256 },
    { month: 'Aug', signups: 36, retained: 31, mrr: 2914 },
    { month: 'Sep', signups: 41, retained: 37, mrr: 3478 },
    { month: 'Oct', signups: 38, retained: 35, mrr: 3290 },
  ];
  const totalMRR = cohorts.reduce((s,c)=>s+c.mrr,0);
  const arr = totalMRR * 12;
  return (<div className="pg">
    <header className="pg-hd">
      <div><div className="acr-eyebrow" style={{color:'var(--brand)'}}>⌁ Revenue</div><h1 className="pg-title">${(totalMRR/1000).toFixed(1)}K MRR · ${(arr/1000).toFixed(0)}K ARR · NRR 118%</h1></div>
      <div className="pg-actions"><Button icon="filter">Last 7 cohorts</Button><Button icon="arrow">Export CSV</Button></div>
    </header>

    <div className="kpi-row">
      {[
        ['Net new MRR', '+$2,140', '7-day · ↑ 18%'],
        ['Expansion', '+$680', 'Plan upgrades'],
        ['Churn', '-$340', '2 logos · 2.1%'],
        ['LTV : CAC', '4.2×', 'Trailing 12mo'],
      ].map((k,i)=>(
        <Card key={i}>
          <div className="acr-eyebrow">{k[0]}</div>
          <div className="kpi-val">{k[1]}</div>
          <div className="kpi-delta">{k[2]}</div>
        </Card>
      ))}
    </div>

    <SectionTitle eyebrow="Retention by cohort" title="Who's still paying">
      <Card padded={false}>
        <table className="tbl">
          <thead><tr><th>Cohort</th><th className="num">Signed up</th><th className="num">Retained</th><th className="num">Retention</th><th className="num">MRR</th><th className="num">ARPU</th></tr></thead>
          <tbody>
            {cohorts.map(c => (
              <tr key={c.month} className="tbl-row">
                <td><b>{c.month} 2024</b></td>
                <td className="num">{c.signups}</td>
                <td className="num">{c.retained}</td>
                <td className="num"><span className={cx('score', c.retained/c.signups>=0.9 && 'score-hi', c.retained/c.signups<0.9 && 'score-mid')}>{Math.round(c.retained/c.signups*100)}%</span></td>
                <td className="num">${c.mrr.toLocaleString()}</td>
                <td className="num">${Math.round(c.mrr/c.retained)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </SectionTitle>

    <SectionTitle eyebrow="Plan mix" title="Where the dollars come from">
      <div className="kpi-row">
        {[
          ['Solo · $89/mo', 142, 12638, 67],
          ['Team · $249/mo', 38, 9462, 18],
          ['Pro · $499/mo', 14, 6986, 7],
          ['Enterprise', 4, 4800, 2],
        ].map((p,i)=>(
          <Card key={i}>
            <div className="acr-eyebrow">{p[0]}</div>
            <div className="kpi-val">{p[1]}</div>
            <div className="kpi-delta">${p[2].toLocaleString()} · {p[3]}% of revenue</div>
          </Card>
        ))}
      </div>
    </SectionTitle>
  </div>);
};

const FounderTenants = () => {
  const [filter, setFilter] = React.useState('all');
  const tenants = (window.FOUNDER_TENANTS || []).slice(0, 12);
  const healthOf = (h) => {
    if (typeof h === 'number') {
      if (h >= 85) return 'healthy';
      if (h >= 70) return 'ok';
      return 'at-risk';
    }
    if (h === 'healthy' || h === 'good') return 'healthy';
    if (h === 'at-risk' || h === 'churn-risk') return 'at-risk';
    return 'ok';
  };
  const filtered = tenants.filter(t => {
    const cat = healthOf(t.health);
    if (filter === 'healthy') return cat === 'healthy';
    if (filter === 'at-risk') return cat === 'at-risk';
    if (filter === 'paid') return (t.plan || '').toLowerCase() !== 'trial';
    return true;
  });
  const counts = {
    all: tenants.length,
    healthy: tenants.filter(t => healthOf(t.health) === 'healthy').length,
    'at-risk': tenants.filter(t => healthOf(t.health) === 'at-risk').length,
    paid: tenants.filter(t => (t.plan || '').toLowerCase() !== 'trial').length,
  };
  return (<div className="pg">
    <header className="pg-hd">
      <div><div className="acr-eyebrow" style={{color:'var(--brand)'}}>⌁ Tenants</div><h1 className="pg-title">{tenants.length} active workspaces · 4 added this week</h1></div>
      <div className="pg-actions"><Button icon="search">Search</Button><Button icon="arrow">Export</Button></div>
    </header>
    <div className="pg-filters">
      {[['all','All'],['healthy','Healthy'],['at-risk','At risk'],['paid','Paid only']].map(([k,l]) => (
        <button key={k} className={cx('chip', filter===k && 'chip-on')} onClick={() => setFilter(k)}>{l} · {counts[k]||0}</button>
      ))}
    </div>
    {filtered.length === 0 ? (
      <EmptyState icon="users" eyebrow="No matches" title={`No tenants match "${filter}".`} body="Switch filters above to see the full list." actions={[{label:'See all', onClick:()=>setFilter('all'), variant:'subtle'}]} />
    ) : (
    <Card padded={false}>
      <table className="tbl">
        <thead><tr><th>Workspace</th><th>Plan</th><th>Seats</th><th className="num">MRR</th><th>Health</th><th>Last active</th><th></th></tr></thead>
        <tbody>
          {filtered.map((t,i) => (
            <tr key={i} className="tbl-row">
              <td><b>{t.name}</b><div className="muted" style={{fontSize:11.5,marginTop:2}}>{t.id || `T-${1000+i}`}</div></td>
              <td><Pill>{t.plan}</Pill></td>
              <td>{t.seats}</td>
              <td className="num">${(t.mrr||0).toLocaleString()}</td>
              <td>
                {(() => {
                  const cat = healthOf(t.health);
                  const label = typeof t.health === 'number' ? `${cat} · ${t.health}` : cat;
                  return (
                    <Pill tone={cat==='healthy'?'pos':cat==='at-risk'?'warn':'neutral'} dot>
                      {label}
                    </Pill>
                  );
                })()}
              </td>
              <td>{t.lastActive || '2h ago'}</td>
              <td><Button size="sm" variant="subtle">Impersonate</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
    )}
  </div>);
};

const FounderCost = () => {
  const agents = [
    { name: 'Atlas · Parcel analysis', runs: 18420, costPerRun: 0.42, marginPerRun: 1.18, totalCost: 7736, totalRevenue: 21735, margin: 64 },
    { name: 'Pax · Reply drafter',     runs: 9214,  costPerRun: 0.18, marginPerRun: 0.41, totalCost: 1658, totalRevenue: 5436,  margin: 69 },
    { name: 'Sophie · Doc OCR',        runs: 3142,  costPerRun: 0.08, marginPerRun: 0.27, totalCost: 251,  totalRevenue: 1109,  margin: 77 },
    { name: 'Atlas · Comp finder',     runs: 6210,  costPerRun: 0.61, marginPerRun: 0.39, totalCost: 3788, totalRevenue: 6210,  margin: 39 },
    { name: 'Pax · Inbox triage',      runs: 14820, costPerRun: 0.04, marginPerRun: 0.21, totalCost: 593,  totalRevenue: 3705,  margin: 84 },
  ];
  const totalRev = agents.reduce((s,a)=>s+a.totalRevenue,0);
  const totalCost = agents.reduce((s,a)=>s+a.totalCost,0);
  const blendedMargin = Math.round((totalRev-totalCost)/totalRev*100);
  return (<div className="pg">
    <header className="pg-hd">
      <div><div className="acr-eyebrow" style={{color:'var(--brand)'}}>⌁ Agent economics</div><h1 className="pg-title">${(totalRev/1000).toFixed(1)}K agent revenue · {blendedMargin}% blended margin</h1></div>
      <div className="pg-actions"><Button icon="filter">Last 30d</Button></div>
    </header>

    <div className="kpi-row">
      {[
        ['Total runs', `${agents.reduce((s,a)=>s+a.runs,0).toLocaleString()}`, 'Last 30 days'],
        ['Compute cost', `$${totalCost.toLocaleString()}`, '54% Atlas'],
        ['Agent revenue', `$${totalRev.toLocaleString()}`, 'In-plan + overage'],
        ['Blended margin', `${blendedMargin}%`, 'Healthy: 60%+'],
      ].map((k,i)=>(
        <Card key={i}>
          <div className="acr-eyebrow">{k[0]}</div>
          <div className="kpi-val">{k[1]}</div>
          <div className="kpi-delta">{k[2]}</div>
        </Card>
      ))}
    </div>

    <SectionTitle eyebrow="By agent" title="Who pays for itself">
      <Card padded={false}>
        <table className="tbl">
          <thead><tr><th>Agent</th><th className="num">Runs</th><th className="num">Cost / run</th><th className="num">Margin / run</th><th className="num">Total cost</th><th className="num">Revenue</th><th className="num">Margin</th></tr></thead>
          <tbody>
            {agents.map((a,i)=>(
              <tr key={i} className="tbl-row">
                <td><b>{a.name}</b></td>
                <td className="num">{a.runs.toLocaleString()}</td>
                <td className="num">${a.costPerRun.toFixed(2)}</td>
                <td className="num">${a.marginPerRun.toFixed(2)}</td>
                <td className="num">${a.totalCost.toLocaleString()}</td>
                <td className="num">${a.totalRevenue.toLocaleString()}</td>
                <td className="num"><span className={cx('score', a.margin>=60&&'score-hi', a.margin>=40&&a.margin<60&&'score-mid')}>{a.margin}%</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </SectionTitle>

    <SectionTitle eyebrow="Tenants losing money on agents" title="3 workspaces in the red">
      <Card padded={false}>
        <table className="tbl">
          <thead><tr><th>Workspace</th><th>Plan</th><th className="num">Atlas runs</th><th className="num">Compute cost</th><th className="num">Plan covers</th><th className="num">Loss</th><th></th></tr></thead>
          <tbody>
            {[
              ['Foothills Land Co.','Solo · $89',218,'$91.56','$89','-$2.56','Move to overage'],
              ['Westridge Holdings','Solo · $89',184,'$77.28','$89','+$11.72','—'],
              ['Cobalt Acres','Solo · $89',412,'$173.04','$89','-$84.04','Force upgrade'],
              ['Plainstate LLC','Solo · $89',267,'$112.14','$89','-$23.14','Notify'],
            ].map((r,i)=>(
              <tr key={i} className="tbl-row">
                <td><b>{r[0]}</b></td>
                <td>{r[1]}</td>
                <td className="num">{r[2]}</td>
                <td className="num">{r[3]}</td>
                <td className="num">{r[4]}</td>
                <td className="num"><span className={r[5].startsWith('-')?'kpi-delta-neg':'kpi-delta-pos'}>{r[5]}</span></td>
                <td><Button size="sm" variant="subtle">{r[6]}</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </SectionTitle>
  </div>);
};

const FounderOps = () => {
  const incidents = [
    { id:'INC-0118', title:'DataTree API timeouts', severity:'sev-2', status:'monitoring', owner:'M. Chen', opened:'2h ago', impact:'Atlas runs queued · 14 affected' },
    { id:'INC-0117', title:'Twilio short-code throughput', severity:'sev-3', status:'resolved', owner:'A. Patel', opened:'yesterday', impact:'SMS delivery delayed 22min' },
    { id:'INC-0116', title:'OpenAI 5xx spike',     severity:'sev-2', status:'resolved', owner:'M. Chen', opened:'2 days ago', impact:'Pax fallback served · 0 user-visible' },
  ];
  const killSwitches = [
    { id:'atlas-runs',    label:'Atlas analyses',     enabled:true,  detail:'Pause all parcel analysis. Cached results still served.' },
    { id:'pax-drafts',    label:'Pax reply drafts',   enabled:true,  detail:'Stop generating new drafts. Existing queue unaffected.' },
    { id:'sophie-ocr',    label:'Sophie doc OCR',     enabled:true,  detail:'Pause OCR. Files queue locally until re-enabled.' },
    { id:'auto-send',     label:'Autonomous sending', enabled:false, detail:'OFF · Currently no auto-send across any tenant.' },
    { id:'auto-mail',     label:'Direct-mail print',  enabled:true,  detail:'Pause PostGrid handoff. In-flight orders complete.' },
    { id:'new-signups',   label:'New tenant signups', enabled:true,  detail:'Block self-serve signups. Sales-led still works.' },
  ];
  const oncall = [
    { name:'Marcus Chen',  role:'Primary',   shift:'Now → Wed 9am', phone:'•••• 0234' },
    { name:'Aanya Patel',  role:'Secondary', shift:'Now → Wed 9am', phone:'•••• 8821' },
    { name:'Dani Weber',   role:'Manager',   shift:'Always', phone:'•••• 1102' },
  ];
  return (<div className="pg">
    <header className="pg-hd">
      <div><div className="acr-eyebrow" style={{color:'var(--brand)'}}>⌁ Ops & incidents</div><h1 className="pg-title">1 active · {incidents.filter(i=>i.status==='resolved').length} resolved this week · all systems nominal</h1></div>
      <div className="pg-actions"><Button icon="bell">Page on-call</Button><Button icon="plus" variant="primary">Open incident</Button></div>
    </header>

    <SectionTitle eyebrow="Active & recent" title="Incident timeline">
      <Card padded={false}>
        <table className="tbl">
          <thead><tr><th>Incident</th><th>Severity</th><th>Status</th><th>Owner</th><th>Opened</th><th>Impact</th></tr></thead>
          <tbody>
            {incidents.map(inc => (
              <tr key={inc.id} className="tbl-row">
                <td><div className="mono" style={{fontSize:11,color:'var(--ink-3)'}}>{inc.id}</div><b>{inc.title}</b></td>
                <td><Pill tone={inc.severity==='sev-2'?'warn':'neutral'} dot>{inc.severity}</Pill></td>
                <td><Pill tone={inc.status==='resolved'?'pos':'warn'} dot>{inc.status}</Pill></td>
                <td>{inc.owner}</td>
                <td>{inc.opened}</td>
                <td className="muted">{inc.impact}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </SectionTitle>

    <div className="founder-ops-grid">
      <SectionTitle eyebrow="Kill switches" title="Pull anything offline">
        <Card>
          <div className="kill-grid">
            {killSwitches.map(k => (
              <div key={k.id} className="kill-row">
                <div>
                  <div className="kill-label">{k.label}</div>
                  <div className="kill-detail">{k.detail}</div>
                </div>
                <Button size="sm" variant={k.enabled?'subtle':'primary'}>
                  {k.enabled ? 'Pause' : 'Resume'}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      </SectionTitle>

      <SectionTitle eyebrow="On-call" title="Who's holding the pager">
        <Card padded={false}>
          <table className="tbl">
            <thead><tr><th>Engineer</th><th>Role</th><th>Shift</th><th>Phone</th></tr></thead>
            <tbody>
              {oncall.map((p,i) => (
                <tr key={i} className="tbl-row">
                  <td><Avatar name={p.name} size={26} /> <b style={{marginLeft:8}}>{p.name}</b></td>
                  <td><Pill tone={p.role==='Primary'?'warn':'neutral'} dot>{p.role}</Pill></td>
                  <td className="muted">{p.shift}</td>
                  <td className="mono muted">{p.phone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </SectionTitle>
    </div>
  </div>);
};

const FounderSimple = ({ title, eyebrow, desc }) => (<div className="pg">
  <header className="pg-hd">
    <div><div className="acr-eyebrow" style={{color:'var(--brand)'}}>⌁ {eyebrow}</div><h1 className="pg-title">{title}</h1><div className="parcel-sub">{desc}</div></div>
  </header>
  <Card>
    <div className="acr-eyebrow">Drill-down</div>
    <p style={{color:'var(--ink-2)',fontSize:13.5,lineHeight:1.6,margin:'8px 0 0'}}>Tied to Overview. This surface extends the founder view with detailed breakdowns — cohorts, unit economics per agent, incident timeline, on-call rotation, impersonation tools.</p>
  </Card>
</div>);

const TIER2345_CSS = `
  .bb-grid, .cp-grid, .int-grid, .doc-grid { display: grid; gap: 14px; }
  .bb-grid { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  .cp-grid { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
  .int-grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
  .doc-grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }

  .founder-ops-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
  @media (max-width: 1080px) { .founder-ops-grid { grid-template-columns: 1fr; } }
  .kill-grid { display: flex; flex-direction: column; gap: 4px; }
  .kill-row {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 12px 0; border-bottom: 0.5px solid var(--line-soft);
  }
  .kill-row:last-child { border-bottom: 0; }
  .kill-label { font: 600 13.5px/1.3 var(--font-sans); color: var(--ink); letter-spacing: -0.005em; }
  .kill-detail { font: 400 12px/1.5 var(--font-sans); color: var(--ink-3); margin-top: 2px; max-width: 320px; }
  .kpi-delta-pos { color: var(--pos, #1f7a4d); font-variant-numeric: tabular-nums; }
  .kpi-delta-neg { color: var(--warn, #b04030); font-variant-numeric: tabular-nums; }

  .bb-card h3, .cp-card .cp-name { font: 600 15px/1.3 var(--font-display); margin: 6px 0; color: var(--ink); letter-spacing: -0.01em; }
  .bb-hd, .cp-hd { display: flex; justify-content: space-between; align-items: center; }
  .bb-meta { font-size: 12px; color: var(--ink-3); margin: 2px 0 14px; }
  .bb-stats, .cp-stats { display: flex; gap: 20px; margin-bottom: 14px; }
  .stat-num { font: 600 18px/1 var(--font-display); color: var(--ink); letter-spacing: -0.01em; }
  .stat-label { font: 500 10.5px/1 var(--font-sans); color: var(--ink-3); letter-spacing: 0.04em; text-transform: uppercase; margin-top: 4px; }
  .cp-chan { display: inline-flex; align-items: center; gap: 5px; font: 500 11px/1 var(--font-sans); color: var(--ink-3); letter-spacing: 0.04em; }
  .cp-foot { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--ink-3); }
  .cp-roi { color: var(--ink-2); font-weight: 600; }
  .cp-roi-hi { color: var(--pos); }

  .doc-card { display: flex; flex-direction: column; gap: 6px; padding: 14px; }
  .doc-ic { color: var(--ink-3); margin-bottom: 4px; }
  .doc-name { font: 600 13.5px/1.3 var(--font-display); color: var(--ink); }
  .doc-meta { font-size: 11.5px; color: var(--ink-3); }
  .doc-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; }

  .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .kpi-val { font: 600 22px/1.2 var(--font-display); color: var(--ink); letter-spacing: -0.015em; margin: 4px 0 2px; }
  .kpi-delta { font-size: 11.5px; color: var(--ink-3); }

  .auto-list { display: flex; flex-direction: column; gap: 8px; }
  .auto-row { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; }
  .auto-name { font: 600 14px/1.3 var(--font-display); color: var(--ink); }
  .auto-trig { font-size: 12px; color: var(--ink-3); margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; }
  .auto-r { display: flex; align-items: center; gap: 24px; }

  .prog { width: 100%; height: 4px; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
  .prog-fill { height: 100%; border-radius: 999px; transition: width .2s ease; }

  .audit-list { display: flex; flex-direction: column; }
  .audit-row { display: grid; grid-template-columns: 80px 1fr auto; gap: 14px; padding: 10px 0; border-bottom: 0.5px solid var(--line-soft); font-size: 12.5px; }
  .audit-row:last-child { border-bottom: 0; }
  .audit-time { color: var(--ink-3); }
  .audit-msg { color: var(--ink); }
  .audit-meta { color: var(--ink-3); }

  .int-card { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 16px; }
  .int-logo { width: 32px; height: 32px; border-radius: 8px; background: var(--brand-soft); color: var(--brand); display: inline-flex; align-items: center; justify-content: center; font-weight: 700; }
  .int-name { font: 600 13.5px/1 var(--font-display); color: var(--ink); margin-top: 6px; }
  .int-desc { font-size: 11.5px; color: var(--ink-3); margin-bottom: 6px; }

  .cal-week { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; }
  .cal-day { background: var(--surface); border: 0.5px solid var(--line); border-radius: 10px; padding: 10px; min-height: 180px; display: flex; flex-direction: column; gap: 6px; }
  .cal-day-hd { display: flex; justify-content: space-between; font-size: 11px; color: var(--ink-3); letter-spacing: 0.04em; text-transform: uppercase; }
  .cal-day-num { color: var(--ink); font-weight: 600; }
  .cal-ev { background: var(--surface-2); border-radius: 6px; padding: 6px 8px; font-size: 11.5px; color: var(--ink-2); }
  .cal-ev-brand { background: var(--brand-soft); color: var(--brand); }
  .cal-ev-accent { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }

  /* Founder */
  .founder-pg { gap: 24px; }
  .founder-hero { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 0.5px solid var(--line); padding-bottom: 20px; }
  .founder-title { font: 600 34px/1.1 var(--font-serif); letter-spacing: -0.02em; color: var(--ink); margin: 6px 0; }
  .founder-sub { font-size: 14px; color: var(--ink-2); max-width: 640px; line-height: 1.55; }

  .founder-metrics { display: grid; grid-template-columns: 1.4fr repeat(5, 1fr); gap: 12px; }
  .fm-card { padding: 16px; }
  .fm-primary { background: linear-gradient(180deg, var(--brand-soft), var(--surface)); border-color: transparent; }
  .fm-val { font: 600 26px/1 var(--font-display); letter-spacing: -0.02em; color: var(--ink); margin: 6px 0 4px; font-variant-numeric: tabular-nums; }
  .fm-primary .fm-val { font-size: 34px; color: var(--brand); }
  .fm-delta { font-size: 11.5px; }
  .fm-delta-pos { color: var(--pos); }
  .fm-delta-neg { color: var(--neg); }
  .fm-spark { margin-top: 10px; }

  .founder-grid { display: grid; grid-template-columns: 1fr 320px; gap: 20px; }
  .founder-col { display: flex; flex-direction: column; gap: 24px; min-width: 0; }
  .founder-side { display: flex; flex-direction: column; gap: 14px; }

  .fa-list { display: flex; flex-direction: column; gap: 10px; }
  .fa-card { border-left: 3px solid var(--line); padding: 14px 16px; }
  .fa-card.fa-neg { border-left-color: var(--neg); }
  .fa-card.fa-warn { border-left-color: var(--warn); }
  .fa-card.fa-pos { border-left-color: var(--pos); }
  .fa-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .fa-title { font: 600 14px/1.3 var(--font-display); color: var(--ink); }
  .fa-body { font-size: 13px; color: var(--ink-2); margin-top: 4px; line-height: 1.5; }

  .ae-row { display: grid; grid-template-columns: 80px 1fr auto auto; gap: 10px; align-items: center; padding: 6px 0; font-size: 12.5px; border-bottom: 0.5px solid var(--line-soft); }
  .ae-row:last-child { border-bottom: 0; }
  .ae-cost { font-variant-numeric: tabular-nums; font-weight: 600; }
  .ae-total { margin-top: 10px; padding-top: 10px; border-top: 0.5px solid var(--line); font-size: 13px; color: var(--ink-2); }
  .ae-total b { color: var(--ink); }

  .health-list { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
  .health-row { display: flex; justify-content: space-between; font-size: 12.5px; }
  .health-val { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--ink); }
  .health-pos { color: var(--pos); }
  .health-warn { color: var(--warn); }

  .qa-list { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; }
  .qa-btn { display: flex; align-items: center; gap: 10px; background: transparent; border: 0; color: var(--ink-2); padding: 8px 10px; border-radius: 6px; font: 500 12.5px/1 var(--font-sans); text-align: left; cursor: default; }
  .qa-btn:hover { background: var(--surface-2); color: var(--ink); }

  .founder-nps { text-align: center; }
  .nps-big { font: 600 48px/1 var(--font-display); color: var(--pos); letter-spacing: -0.03em; margin: 8px 0 4px; }

  .score-low { background: var(--neg-soft); color: var(--neg); border-color: transparent; }

  .muted { color: var(--ink-3); }
`;

Object.assign(window, {
  BuyBoxes, Lists, Campaigns, CampaignPerf,
  Offers, Documents, SellerFinance, Dispositions,
  AgentWorkspace, Automations, AuditLog,
  Team, Billing, Integrations, CalendarPage,
  FounderHome, FounderSimple, FounderRevenue, FounderTenants, FounderCost, FounderOps,
  TIER2345_CSS
});
