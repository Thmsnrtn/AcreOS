// acreos/pages-tier1.jsx — Pipeline · Parcel · Contacts · Inbox

// ─── Pipeline ───────────────────────────────────────────
const Pipeline = () => {
  const [view, setView] = React.useState('list');
  const [stage, setStage] = React.useState('all');
  const stages = ['New','Analyzing','Offer Sent','Negotiating','Due Diligence','Review'];
  const filtered = stage === 'all' ? DEALS : DEALS.filter(d => d.stage === stage);
  const totalValue = filtered.reduce((s,d)=>s+d.askingK*1000,0);

  return (<div className="pg">
    <header className="pg-hd">
      <div>
        <div className="acr-eyebrow">Pipeline</div>
        <h1 className="pg-title">{filtered.length} active deals · {fmtK(totalValue)} in flight</h1>
      </div>
      <div className="pg-actions">
        <div className="seg">
          <button className={cx('seg-b', view==='list'&&'seg-on')} onClick={()=>setView('list')}>List</button>
          <button className={cx('seg-b', view==='kanban'&&'seg-on')} onClick={()=>setView('kanban')}>Kanban</button>
          <button className={cx('seg-b', view==='map'&&'seg-on')} onClick={()=>setView('map')}>Map</button>
        </div>
        <Button icon="plus" variant="primary">New deal</Button>
      </div>
    </header>

    <div className="pg-filters">
      <button className={cx('chip', stage==='all'&&'chip-on')} onClick={()=>setStage('all')}>All · {DEALS.length}</button>
      {stages.map(s => {
        const n = DEALS.filter(d=>d.stage===s).length;
        return <button key={s} className={cx('chip', stage===s&&'chip-on')} onClick={()=>setStage(s)}>{s} · {n}</button>;
      })}
    </div>

    {view==='list' && (
      filtered.length === 0 ? (
        <EmptyState
          icon="folder"
          eyebrow={`Stage · ${stage}`}
          title={`No deals in ${stage} right now.`}
          body="Move a deal here from another stage, or queue a new acquisition. Nothing's wrong — this column just hasn't filled up yet."
          actions={[
            { label: 'See all stages', onClick: () => setStage('all'), variant: 'subtle' },
            { label: 'New deal', icon: 'plus', variant: 'primary' },
          ]}
        />
      ) : (
      <Card padded={false}>
        <table className="tbl">
          <thead><tr>
            <th>Parcel</th><th>County</th><th>Acres</th><th>Owner</th>
            <th className="num">Asking</th><th>Stage</th><th>Atlas</th><th>Temp</th><th></th>
          </tr></thead>
          <tbody>
            {filtered.map(d => (
              <tr key={d.id} className="tbl-row tbl-row-clickable" onClick={() => window.__nav && window.__nav('parcels')}>
                <td className="mono">{d.parcel}</td>
                <td>{d.county}</td>
                <td className="num">{d.acres}</td>
                <td>{d.owner}</td>
                <td className="num">{fmtK(d.askingK*1000)}</td>
                <td><Pill>{d.stage}</Pill></td>
                <td><span className={cx('score', d.atlasScore>=85&&'score-hi', d.atlasScore>=75&&d.atlasScore<85&&'score-mid')}>{d.atlasScore}</span></td>
                <td><span className={cx('temp', `temp-${d.temp}`)} /></td>
                <td><I.chevRt size={14} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      )
    )}

    {view==='kanban' && (
      <div className="kb">
        {stages.map(s => {
          const ds = DEALS.filter(d=>d.stage===s);
          return (<div key={s} className="kb-col">
            <div className="kb-hd"><span>{s}</span><span className="kb-n">{ds.length}</span></div>
            {ds.map(d => (
              <Card key={d.id} className="kb-card">
                <div className="kb-parcel">{d.parcel}</div>
                <div className="kb-county">{d.county} · {d.acres}ac</div>
                <div className="kb-foot"><span className="mono">{fmtK(d.askingK*1000)}</span><span className="score score-hi">{d.atlasScore}</span></div>
              </Card>
            ))}
          </div>);
        })}
      </div>
    )}

    {view==='map' && (
      <Card className="pg-map" padded={false}>
        <div className="map-canvas">
          <svg viewBox="0 0 800 400" className="map-svg">
            <rect width="800" height="400" fill="var(--surface-2)"/>
            {/* stylized topo */}
            {Array.from({length:12}).map((_,i)=>(
              <path key={i} d={`M0 ${30+i*30} Q 200 ${20+i*30}, 400 ${35+i*30} T 800 ${30+i*30}`} stroke="var(--line-soft)" fill="none"/>
            ))}
            {DEALS.map((d,i)=>(
              <g key={d.id} transform={`translate(${80+i*95},${120+(i%3)*80})`}>
                <circle r="18" fill="var(--brand-soft)" />
                <circle r="6" fill="var(--brand)" />
                <text y="34" textAnchor="middle" fill="var(--ink-2)" fontSize="11" fontFamily="var(--font-mono)">{d.parcel}</text>
              </g>
            ))}
          </svg>
        </div>
      </Card>
    )}
  </div>);
};

// ─── Parcel / Atlas detail ───────────────────────────────
const ParcelDetail = () => {
  const d = DEALS[2]; // Pritchard, Luna NM
  return (<div className="pg">
    <div className="parcel-hd">
      <div>
        <div className="acr-eyebrow">Parcel · {d.parcel}</div>
        <h1 className="pg-title">{d.acres} acres · {d.county}</h1>
        <div className="parcel-sub">Owner: <b>{d.owner}</b> · Asking {fmtK(d.askingK*1000)} · Stage: {d.stage}</div>
      </div>
      <div className="pg-actions">
        <Button icon="phone">Call owner</Button>
        <Button icon="mail">Message</Button>
        <Button variant="primary" icon="plus">Draft offer</Button>
      </div>
    </div>

    <div className="parcel-grid">
      <div className="parcel-main">
        <Card padded={false} className="parcel-map">
          <div className="map-canvas">
            <svg viewBox="0 0 800 320" className="map-svg">
              <rect width="800" height="320" fill="var(--surface-2)"/>
              {Array.from({length:8}).map((_,i)=>(
                <path key={i} d={`M0 ${40+i*38} Q 300 ${30+i*38}, 500 ${45+i*38} T 800 ${40+i*38}`} stroke="var(--line-soft)" fill="none"/>
              ))}
              <polygon points="300,100 520,80 540,230 320,250" fill="var(--brand-soft)" stroke="var(--brand)" strokeWidth="2" />
              <text x="420" y="175" textAnchor="middle" fill="var(--brand)" fontSize="13" fontWeight="600">Subject</text>
              {[[180,140],[620,110],[560,270],[140,250]].map(([x,y],i)=>(
                <g key={i} transform={`translate(${x},${y})`}>
                  <circle r="9" fill="var(--surface)" stroke="var(--accent)" strokeWidth="1.5"/>
                  <text y="3" textAnchor="middle" fontSize="9" fill="var(--accent)" fontWeight="600">C{i+1}</text>
                </g>
              ))}
            </svg>
          </div>
        </Card>

        <Card className="atlas-summary">
          <div className="atlas-row">
            <div className="atlas-score-big">
              <div className="score-num">{d.atlasScore}</div>
              <div className="score-label">Atlas score</div>
            </div>
            <div className="atlas-comps">
              <div className="acr-eyebrow">Comp-based value</div>
              <div className="atlas-val">{fmtK(18200)} <span className="atlas-range">· range {fmtK(16400)}–{fmtK(21800)}</span></div>
              <div className="atlas-hint">Based on 4 comps within 8mi, last 180 days</div>
            </div>
            <div className="atlas-offer">
              <div className="acr-eyebrow">Recommended offer</div>
              <div className="atlas-val" style={{color:'var(--brand)'}}>{fmtK(11500)}</div>
              <div className="atlas-hint">63% of value · standard for this market</div>
            </div>
          </div>
        </Card>

        <SectionTitle eyebrow="Comparables" title="4 recent sales within 8 miles" action={<Button size="sm">View all</Button>}>
          <Card padded={false}>
            <table className="tbl">
              <thead><tr><th>#</th><th>Parcel</th><th>Dist</th><th>Acres</th><th className="num">Sold</th><th className="num">$/ac</th><th>Sold on</th></tr></thead>
              <tbody>
                {[
                  ['C1','08-441-119','1.2mi',10.0,18500,1850,'Nov 18'],
                  ['C2','08-441-088','2.8mi',12.0,22400,1867,'Oct 04'],
                  ['C3','08-442-031','5.4mi',9.5,15800,1663,'Sep 22'],
                  ['C4','08-443-214','7.1mi',11.2,21800,1946,'Sep 02'],
                ].map((r,i)=>(
                  <tr key={i}><td>{r[0]}</td><td className="mono">{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td>
                    <td className="num">{fmtK(r[4])}</td><td className="num">${r[5]}</td><td>{r[6]}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        </SectionTitle>
      </div>

      <aside className="parcel-side">
        <Card>
          <div className="acr-eyebrow">Owner</div>
          <div className="owner-name">{d.owner}</div>
          <div className="owner-meta">Absentee since 2019 · owns 3 parcels · Luna & Doña Ana</div>
          <div className="owner-row"><I.phone size={13}/>(575) 555-0142 <Pill tone="pos" dot>Verified</Pill></div>
          <div className="owner-row"><I.mail size={13}/>jspritchard@…</div>
          <div className="owner-row"><I.house size={13}/>12402 Cobblestone, Albuquerque NM</div>
        </Card>

        <Card>
          <div className="acr-eyebrow">Facts</div>
          <dl className="facts">
            <dt>APN</dt><dd className="mono">{d.parcel}</dd>
            <dt>Zoning</dt><dd>Rural-residential</dd>
            <dt>Road access</dt><dd>Dirt · county-maintained</dd>
            <dt>Power</dt><dd>Nearest pole 0.3mi</dd>
            <dt>Water</dt><dd>Well required</dd>
            <dt>Annual tax</dt><dd>$84</dd>
            <dt>FEMA flood</dt><dd>Zone X</dd>
            <dt>Slope</dt><dd>4% avg</dd>
          </dl>
        </Card>

        <Card className="atlas-note">
          <div className="atlas-note-hd"><I.sparkle size={14}/><b>Atlas says</b></div>
          <p>Strong comps, clean title, absentee owner has responded before. Suggest offer at $11.5K with 6% SF option — prior deals in this zip closed at 58–65% of value.</p>
          <Button size="sm" variant="subtle">See reasoning</Button>
        </Card>
      </aside>
    </div>
  </div>);
};

// ─── Contacts ────────────────────────────────────────────
const Contacts = () => {
  const [q, setQ] = React.useState('');
  const all = DEALS.map(d => ({ name: d.owner, parcel: d.parcel, county: d.county, deals: 1, last: `${d.lastTouchH}h ago`, status: d.temp }));
  const contacts = q.trim()
    ? all.filter(c => (c.name + ' ' + c.parcel + ' ' + c.county).toLowerCase().includes(q.trim().toLowerCase()))
    : all;
  return (<div className="pg">
    <header className="pg-hd">
      <div><div className="acr-eyebrow">Contacts</div><h1 className="pg-title">{all.length} people · 3 in active conversation</h1></div>
      <div className="pg-actions">
        <div className="pg-search">
          <I.search size={13}/>
          <input
            type="text"
            placeholder="Search name, parcel, county"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search contacts"
          />
        </div>
        <Button icon="plus" variant="primary">Add contact</Button>
      </div>
    </header>
    {contacts.length === 0 ? (
      <EmptyState
        icon="search"
        eyebrow="No matches"
        title={`Nothing for "${q}".`}
        body="Try a different name, parcel ID, or county. Or clear the search to see everyone."
        actions={[
          { label: 'Clear search', onClick: () => setQ(''), variant: 'subtle' },
        ]}
      />
    ) : (
    <Card padded={false}>
      <table className="tbl">
        <thead><tr><th></th><th>Name</th><th>Parcel</th><th>County</th><th>Deals</th><th>Last contact</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {contacts.map((c,i)=>(
            <tr key={i} className="tbl-row">
              <td><Avatar name={c.name} size={26}/></td>
              <td><b>{c.name}</b></td>
              <td className="mono">{c.parcel}</td>
              <td>{c.county}</td>
              <td>{c.deals}</td>
              <td>{c.last}</td>
              <td><span className={cx('temp', `temp-${c.status}`)}/></td>
              <td><I.chevRt size={14}/></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
    )}
  </div>);
};

// ─── Inbox ───────────────────────────────────────────────
const Inbox = () => {
  const [sel, setSel] = React.useState(INBOX[0].id);
  const [filter, setFilter] = React.useState('all');
  const msgs = filter==='all' ? INBOX : INBOX.filter(m=>m.channel===filter);
  const selMsg = INBOX.find(m=>m.id===sel) || INBOX[0];
  return (<div className="inbox">
    <div className="inbox-left">
      <div className="inbox-tabs">
        {['all','email','sms','mail'].map(f=>(
          <button key={f} className={cx('inbox-tab', filter===f&&'inbox-tab-on')} onClick={()=>setFilter(f)}>
            {f==='all'?'All':f.toUpperCase()} {f==='all'?INBOX.filter(m=>m.unread).length:INBOX.filter(m=>m.channel===f&&m.unread).length ? <span className="inbox-badge">{f==='all'?INBOX.filter(m=>m.unread).length:INBOX.filter(m=>m.channel===f&&m.unread).length}</span>:null}
          </button>
        ))}
      </div>
      <div className="inbox-list">
        {msgs.map(m => (
          <button key={m.id} className={cx('inbox-item', sel===m.id&&'inbox-item-on', m.unread&&'inbox-unread')} onClick={()=>setSel(m.id)}>
            <div className="inbox-item-hd">
              <span className="inbox-from">{m.from}</span>
              <span className="inbox-time">{m.time}</span>
            </div>
            <div className="inbox-subj">{m.subj || <span className="muted">(no subject)</span>}</div>
            <div className="inbox-prev">{m.preview}</div>
            <div className="inbox-item-foot">
              <Pill>{m.channel.toUpperCase()}</Pill>
              {m.dealId && <Pill tone="brand">{m.dealId}</Pill>}
            </div>
          </button>
        ))}
      </div>
    </div>
    <div className="inbox-right">
      <div className="inbox-msg-hd">
        <div>
          <div className="acr-eyebrow">{selMsg.channel.toUpperCase()} from {selMsg.from}</div>
          <h2 className="inbox-msg-subj">{selMsg.subj || '(no subject)'}</h2>
        </div>
        <div className="pg-actions">
          <Button size="sm" icon="folder">Move</Button>
          <Button size="sm" variant="primary" icon="arrow">Reply</Button>
        </div>
      </div>
      <div className="inbox-body">
        <p>{selMsg.preview}</p>
        <p>If the timeline works, I can call my grandson to look at the property this weekend. Otherwise send what you have over.</p>
        <p>— {selMsg.from}</p>
      </div>
      <Card className="inbox-ai">
        <div className="inbox-ai-hd"><I.sparkle size={14}/><b>Pax drafted a reply</b> · ready to review</div>
        <p className="inbox-ai-body">Thanks for the counter, {selMsg.from.split(' ')[0]}. We can meet in the middle at $13,800 with 24-month terms, 12% APR, $500/mo. I'll send paperwork today if that works.</p>
        <div className="pg-actions"><Button size="sm" variant="subtle">Edit</Button><Button size="sm" variant="primary">Send</Button></div>
      </Card>
    </div>
  </div>);
};

const TIER1_CSS = `
  .pg { display: flex; flex-direction: column; gap: 20px; }
  .pg-hd { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
  .pg-title { font: 600 22px/1.2 var(--font-display); letter-spacing: -0.02em; margin: 4px 0 0; color: var(--ink); }
  .pg-actions { display: flex; gap: 8px; align-items: center; }

  .pg-search {
    display: inline-flex; align-items: center; gap: 8px;
    background: var(--surface); border: 0.5px solid var(--line);
    border-radius: 8px; padding: 0 10px; height: 32px;
    color: var(--ink-3); transition: border-color .12s, box-shadow .12s;
    min-width: 240px;
  }
  .pg-search:focus-within { border-color: var(--brand); box-shadow: var(--ring); color: var(--ink-2); }
  .pg-search input {
    border: 0; outline: 0; background: transparent;
    font: 500 12.5px/1 var(--font-sans); color: var(--ink);
    flex: 1; min-width: 0;
  }
  .pg-search input::placeholder { color: var(--ink-3); }
  @media (max-width: 767px) { .pg-search { min-width: 0; flex: 1; } }

  .seg { display: inline-flex; background: var(--surface-2); border: 0.5px solid var(--line); border-radius: 8px; padding: 2px; }
  .seg-b { background: transparent; border: 0; color: var(--ink-2); padding: 5px 10px; font: 500 12px/1 var(--font-sans); border-radius: 6px; cursor: default; }
  .seg-b:hover { color: var(--ink); }
  .seg-on { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-1); }

  .pg-filters { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { background: var(--surface); border: 0.5px solid var(--line); color: var(--ink-2); padding: 5px 10px; border-radius: 999px; font: 500 12px/1 var(--font-sans); cursor: default; }
  .chip:hover { background: var(--surface-2); color: var(--ink); }
  .chip-on { background: var(--ink); color: var(--bg); border-color: var(--ink); }

  .tbl { width: 100%; border-collapse: collapse; }
  .tbl th { text-align: left; font: 500 11px/1 var(--font-sans); letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-3); padding: 12px 14px; border-bottom: 0.5px solid var(--line); }
  .tbl td { padding: 12px 14px; border-bottom: 0.5px solid var(--line-soft); font: 500 13px/1.3 var(--font-sans); color: var(--ink); }
  .tbl .num, .tbl th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .tbl .mono { font-family: var(--font-mono); font-size: 12px; color: var(--ink-2); }
  .tbl-row { cursor: default; }
  .tbl-row:hover td { background: var(--surface-2); }
  .tbl tr:last-child td { border-bottom: 0; }

  .score { display: inline-block; min-width: 28px; padding: 2px 7px; border-radius: 6px; background: var(--surface-2); color: var(--ink-2); font: 600 12px/1.4 var(--font-mono); text-align: center; border: 0.5px solid var(--line-soft); }
  .score-hi { background: var(--pos-soft); color: var(--pos); border-color: transparent; }
  .score-mid { background: var(--warn-soft); color: var(--warn); border-color: transparent; }

  .temp { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
  .temp-hot { background: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
  .temp-warm { background: var(--warn); box-shadow: 0 0 0 3px var(--warn-soft); }
  .temp-cold { background: var(--ink-4); }

  .kb { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
  .kb-col { display: flex; flex-direction: column; gap: 8px; }
  .kb-hd { display: flex; justify-content: space-between; padding: 4px 2px; font: 600 11px/1 var(--font-sans); letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-3); }
  .kb-n { background: var(--surface-2); padding: 2px 6px; border-radius: 999px; font-size: 10px; color: var(--ink-2); }
  .kb-card { padding: 10px 12px; }
  .kb-parcel { font: 600 12px/1 var(--font-mono); color: var(--ink); }
  .kb-county { font: 500 11.5px/1.3 var(--font-sans); color: var(--ink-3); margin: 4px 0 10px; }
  .kb-foot { display: flex; justify-content: space-between; align-items: center; }

  .pg-map .map-canvas, .parcel-map .map-canvas { width: 100%; aspect-ratio: 2; border-radius: 14px; overflow: hidden; }
  .map-svg { width: 100%; height: 100%; display: block; }

  .parcel-hd { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
  .parcel-sub { color: var(--ink-2); font-size: 13px; margin-top: 6px; }
  .parcel-grid { display: grid; grid-template-columns: 1fr 340px; gap: 20px; }
  .parcel-main { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
  .parcel-side { display: flex; flex-direction: column; gap: 14px; }

  .atlas-row { display: grid; grid-template-columns: auto 1fr 1fr; gap: 24px; align-items: center; }
  .atlas-score-big { text-align: center; padding-right: 24px; border-right: 0.5px solid var(--line); }
  .score-num { font: 600 36px/1 var(--font-display); color: var(--brand); letter-spacing: -0.02em; }
  .score-label { font: 500 11px/1 var(--font-sans); color: var(--ink-3); letter-spacing: 0.04em; text-transform: uppercase; margin-top: 6px; }
  .atlas-val { font: 600 18px/1.2 var(--font-display); color: var(--ink); margin: 4px 0; }
  .atlas-range { font-weight: 500; color: var(--ink-3); font-size: 13px; }
  .atlas-hint { font-size: 12px; color: var(--ink-3); }

  .owner-name { font: 600 15px/1.3 var(--font-display); color: var(--ink); margin: 4px 0 2px; }
  .owner-meta { font-size: 12px; color: var(--ink-3); margin-bottom: 12px; }
  .owner-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 12.5px; color: var(--ink-2); border-top: 0.5px solid var(--line-soft); }
  .facts { display: grid; grid-template-columns: 1fr 1.4fr; gap: 8px 12px; margin: 8px 0 0; font-size: 12.5px; }
  .facts dt { color: var(--ink-3); }
  .facts dd { margin: 0; color: var(--ink); text-align: right; }
  .atlas-note p { font-size: 13px; line-height: 1.55; color: var(--ink-2); margin: 8px 0 12px; }
  .atlas-note-hd { display: flex; align-items: center; gap: 6px; color: var(--brand); font-size: 12px; }

  .inbox { display: grid; grid-template-columns: 380px 1fr; gap: 0; background: var(--surface); border: 0.5px solid var(--line); border-radius: 14px; overflow: hidden; min-height: 640px; }
  .inbox-left { border-right: 0.5px solid var(--line); display: flex; flex-direction: column; }
  .inbox-tabs { display: flex; gap: 2px; padding: 10px; border-bottom: 0.5px solid var(--line); }
  .inbox-tab { flex: 1; background: transparent; border: 0; padding: 6px; border-radius: 6px; font: 500 11.5px/1 var(--font-sans); color: var(--ink-3); cursor: default; display: inline-flex; align-items: center; justify-content: center; gap: 4px; }
  .inbox-tab:hover { background: var(--surface-2); color: var(--ink); }
  .inbox-tab-on { background: var(--surface-2); color: var(--ink); }
  .inbox-badge { background: var(--brand); color: var(--brand-ink); border-radius: 999px; padding: 1px 5px; font-size: 10px; }
  .inbox-list { flex: 1; overflow-y: auto; }
  .inbox-item { width: 100%; text-align: left; background: transparent; border: 0; padding: 12px 14px; border-bottom: 0.5px solid var(--line-soft); cursor: default; display: flex; flex-direction: column; gap: 4px; }
  .inbox-item:hover { background: var(--surface-2); }
  .inbox-item-on { background: var(--brand-soft); }
  .inbox-item-on:hover { background: var(--brand-soft); }
  .inbox-unread .inbox-from, .inbox-unread .inbox-subj { font-weight: 600; color: var(--ink); }
  .inbox-item-hd { display: flex; justify-content: space-between; }
  .inbox-from { font: 500 13px/1 var(--font-sans); color: var(--ink); }
  .inbox-time { font-size: 11px; color: var(--ink-3); }
  .inbox-subj { font-size: 12.5px; color: var(--ink-2); }
  .inbox-prev { font-size: 12px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .inbox-item-foot { display: flex; gap: 5px; margin-top: 4px; }

  .inbox-right { display: flex; flex-direction: column; }
  .inbox-msg-hd { display: flex; justify-content: space-between; padding: 20px; border-bottom: 0.5px solid var(--line); }
  .inbox-msg-subj { font: 600 18px/1.2 var(--font-display); letter-spacing: -0.015em; margin: 4px 0 0; color: var(--ink); }
  .inbox-body { padding: 20px; font: 500 14px/1.6 var(--font-sans); color: var(--ink-2); flex: 1; }
  .inbox-body p { margin: 0 0 12px; }
  .inbox-ai { margin: 0 20px 20px; background: var(--brand-soft); border-color: transparent; }
  .inbox-ai-hd { display: flex; align-items: center; gap: 6px; color: var(--brand); font-size: 12px; margin-bottom: 8px; }
  .inbox-ai-body { font-size: 13px; color: var(--ink-2); line-height: 1.5; margin: 0 0 12px; }
`;

Object.assign(window, { Pipeline, ParcelDetail, Contacts, Inbox, TIER1_CSS });
