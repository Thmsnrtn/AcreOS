// acreos/tier-b.jsx — B5/B6/B7/B8 upgraded pages
// Uses AIOutput, EmptyState, ConfirmAction from tier-a/tier-c.

const { useState: useBS, useEffect: useBE, useMemo: useBM } = React;

// ──────────────────────────────────────────────────────────
// B7 · Command Center — hierarchy, merged timeline, executor promoted
// ──────────────────────────────────────────────────────────

const CC_B_Metric = ({ label, value, delta, positive = true }) => (
  <div className="acr-metric">
    <div className="acr-metric-label">{label}</div>
    <div className="acr-metric-value acr-tabnum">{value}</div>
    {delta != null && (
      <div className={cx('acr-metric-delta', positive ? 'acr-delta-pos' : 'acr-delta-neg')}>
        {positive ? <I.arrowUp size={11}/> : <I.arrowDn size={11}/>}<span>{delta}</span>
      </div>
    )}
  </div>
);

// Promoted Executor — trust-critical, never hidden
const ExecutorPromoted = () => {
  const [paused, setPaused] = useBS(false);
  return (
    <Card className={cx('exec-card', paused && 'exec-paused')}>
      <div className="exec-hd">
        <div className="exec-title">
          <span className={cx('exec-dot', paused ? 'exec-dot-off' : 'exec-dot-on')} />
          <span>Autonomous Executor</span>
          <Pill tone={paused ? 'warn' : 'pos'} dot>{paused ? 'Paused' : 'Running · L2'}</Pill>
        </div>
        <div className="exec-actions">
          <Button size="sm" variant="ghost" icon="arrow">Audit log</Button>
          <ConfirmAction
            label={paused ? 'Resume' : 'Pause agents'}
            variant={paused ? 'primary' : 'subtle'}
            icon={paused ? 'bolt' : 'pause'}
            title={paused ? 'Resume all agents?' : 'Pause all agents?'}
            detail={paused
              ? 'Atlas, Pax, and Sophie will resume at their current autonomy levels. In-flight drafts remain queued.'
              : 'All AI agents stop immediately. 4 queued drafts are held. You can resume anytime — no work is lost.'}
            cta={paused ? 'Resume' : 'Pause'}
            onConfirm={() => setPaused(v => !v)}
          />
        </div>
      </div>
      <div className="exec-grid">
        <div className="exec-cell">
          <div className="exec-cell-val acr-tabnum">12m</div>
          <div className="exec-cell-lbl">Since last cycle</div>
        </div>
        <div className="exec-cell">
          <div className="exec-cell-val acr-tabnum">4</div>
          <div className="exec-cell-lbl">Actions taken</div>
        </div>
        <div className="exec-cell">
          <div className="exec-cell-val acr-tabnum">1</div>
          <div className="exec-cell-lbl">Waiting on you</div>
        </div>
        <div className="exec-cell">
          <div className="exec-cell-val acr-tabnum">$0.84</div>
          <div className="exec-cell-lbl">Spend · today</div>
        </div>
      </div>
    </Card>
  );
};

// Merged timeline — tasks + activity interleaved by recency
const MergedTimeline = () => {
  const items = useBM(() => {
    const tasks = TASKS.map(t => ({
      id: 't-' + t.id, kind: 'task', title: t.title, due: t.due,
      dealId: t.dealId, agent: t.agent, priority: t.priority,
      sortKey: t.priority === 'high' ? 0 : t.priority === 'medium' ? 1 : 2,
    }));
    const activity = ACTIVITY.map(a => ({
      id: 'a-' + a.id, kind: 'activity', who: a.who, msg: a.msg, t: a.t, agentKind: a.kind,
      sortKey: 3,
    }));
    return [...tasks, ...activity];
  }, []);

  return (
    <div className="tl">
      {items.map((it, i) => (
        <div key={it.id} className={cx('tl-row', `tl-${it.kind}`)}>
          <div className="tl-rail">
            <div className="tl-dot" />
            {i < items.length - 1 && <div className="tl-line" />}
          </div>
          <div className="tl-body">
            {it.kind === 'task' ? (
              <>
                <div className="tl-title">{it.title}</div>
                <div className="tl-meta">
                  <Pill tone={it.priority === 'high' ? 'neg' : it.priority === 'medium' ? 'warn' : 'neutral'}>{it.priority}</Pill>
                  <span>{it.due}</span>
                  {it.dealId && <span className="tl-sep">· {it.dealId}</span>}
                  {it.agent && <Pill tone="brand">{it.agent === 'atlas' ? 'Atlas' : it.agent === 'pax' ? 'Pax' : 'Sophie'}</Pill>}
                </div>
              </>
            ) : (
              <>
                <div className="tl-title tl-activity-title">
                  <span className="tl-who">{it.who}</span> {it.msg}
                </div>
                <div className="tl-meta">
                  <Pill tone="neutral">{it.agentKind || 'event'}</Pill>
                  <span>{it.t} ago</span>
                </div>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

const CommandCenterB = () => {
  const hotDeals = DEALS.filter(d => d.temp === 'hot' || d.atlasScore >= 80).slice(0, 5);
  const needs = hotDeals.filter(d => d.temp === 'hot').length;

  return (
    <div className="cc-b">
      {/* Editorial greeting — hierarchy: 1 primary answer */}
      <header className="cc-b-hero">
        <div>
          <div className="acr-eyebrow">Thursday, April 24</div>
          <h1 className="cc-b-greeting">
            {copy.greeting('Thomas')}.
            <span className="cc-b-greeting-soft"> {copy.needsAttention(needs)}</span>
          </h1>
        </div>
        <div className="cc-b-hero-actions">
          <Button variant="secondary" icon="plus">New deal</Button>
          <Button variant="primary" icon="sparkle">Ask AcreOS</Button>
        </div>
      </header>

      {/* Metric strip */}
      <div className="acr-cc-metrics">
        <CC_B_Metric label="Pipeline value"   value={fmtK(METRICS.pipelineValue)} delta={`${METRICS.pipelineDeltaPct}%`} />
        <CC_B_Metric label="Deals in flight"  value={METRICS.dealsInFlight}       delta="+4" />
        <CC_B_Metric label="Mail sent · 7d"   value={fmtInt(METRICS.mailSent7d)}  delta={`+${METRICS.mailDelta7d}`} />
        <CC_B_Metric label="Reply rate"       value={`${METRICS.repliesRate}%`}   delta={`+${METRICS.repliesDelta}pp`} />
        <CC_B_Metric label="Closed · MTD"     value={fmtK(METRICS.closedMTD)}     delta={`${METRICS.closedDelta}%`} />
      </div>

      {/* Executor promoted to hero row — trust is the product */}
      <ExecutorPromoted />

      <div className="cc-b-grid">
        {/* LEFT: For-you + pipeline */}
        <div className="cc-b-main">
          <SectionTitle
            eyebrow="Ambient · from your agents"
            title="For you"
            action={<Button variant="ghost" size="sm" iconRight="arrow">All suggestions</Button>}
          >
            <div className="cc-b-sugg">
              <AIOutput
                agent="atlas"
                shape="card"
                confidence="high"
                confidenceDetail="4 comps · 8mi · 180d"
                headline="Offer Pritchard at $11,500"
                body="Comp-based value $18,200. 63% offer is standard for this market; their last counter landed in this band."
                inputs={[
                  { label: 'Comp median', value: '$1,830/ac' },
                  { label: 'Owner history', value: 'Absentee · responded before' },
                  { label: 'Market', value: 'Luna NM · active' },
                ]}
                grounding={[
                  { label: '4 sales within 8mi' },
                  { label: 'DataTree · owner record' },
                  { label: 'Prior Pritchard offer' },
                ]}
                autonomy={{ level: 2, willAutoSend: false }}
                timestamp="3m"
                actions={[
                  { label: 'See offer', variant: 'subtle' },
                  {
                    label: 'Send',
                    icon: 'arrow',
                    confirm: {
                      title: 'Send offer to J. & S. Pritchard?',
                      detail: 'Email + certified mail · $11,500 · 24mo SF at 12% APR. You will see their reply in Inbox.',
                      cta: 'Send',
                    },
                  },
                ]}
              />
              <AIOutput
                agent="pax"
                shape="card"
                confidence="medium"
                confidenceDetail="3 replies · 48h window"
                headline="3 warm leads haven't been followed up"
                body="Martinez, Torres, and Okoro replied 36–52 hours ago. Pax can draft a tailored nudge for each in one pass."
                inputs={[
                  { label: 'Threads', value: 'Martinez · Torres · Okoro' },
                  { label: 'Avg reply lag', value: '42h' },
                ]}
                autonomy={{ level: 2, willAutoSend: false }}
                timestamp="18m"
                actions={[
                  { label: 'Skip', variant: 'ghost' },
                  { label: 'Draft 3 replies', icon: 'wand' },
                ]}
              />
              <AIOutput
                agent="sophie"
                shape="card"
                confidence="low"
                confidenceDetail="single data point"
                headline="Borrower #043 missed payment yesterday"
                body="First miss in 14 months. Sophie already sent a soft reminder; recommends a call before auto-escalation in 48h."
                inputs={[
                  { label: 'Note', value: 'N-043 · $298/mo' },
                  { label: 'History', value: '14 on-time payments' },
                ]}
                autonomy={{ level: 1, willAutoSend: false }}
                timestamp="1h"
                actions={[
                  { label: 'Call',  icon: 'phone', variant: 'subtle' },
                  { label: 'Review', variant: 'ghost' },
                ]}
              />
            </div>
          </SectionTitle>

          <SectionTitle
            title="Pipeline"
            action={<Button variant="ghost" size="sm" iconRight="arrow">View all</Button>}
          >
            <Card padded={false}>
              <div className="acr-deal-head">
                <div className="acr-deal-wick-sp" />
                <div className="acr-deal-col">Parcel</div>
                <div className="acr-deal-col">Owner</div>
                <div className="acr-deal-col">Asking</div>
                <div className="acr-deal-col">Atlas</div>
                <div className="acr-deal-col">Stage</div>
                <div className="acr-deal-col">Last touch</div>
              </div>
              <div className="acr-deal-list">
                {hotDeals.map(d => {
                  const tempClass = d.temp === 'hot' ? 'acr-temp-hot' : d.temp === 'warm' ? 'acr-temp-warm' : 'acr-temp-cold';
                  const scoreTone = d.atlasScore >= 85 ? 'pos' : d.atlasScore >= 75 ? 'brand' : d.atlasScore >= 65 ? 'warn' : 'neutral';
                  return (
                    <div key={d.id} className="acr-deal-row">
                      <div className={cx('acr-temp-wick', tempClass)} />
                      <div className="acr-deal-col acr-deal-parcel">
                        <div className="acr-deal-id">{d.parcel}</div>
                        <div className="acr-deal-county">{d.county} · {d.acres}ac</div>
                      </div>
                      <div className="acr-deal-col acr-deal-owner">
                        <div className="acr-deal-name">{d.owner}</div>
                        <div className="acr-deal-sub">{d.mailSent > 0 ? `${d.mailSent} mailed` : 'No contact'}</div>
                      </div>
                      <div className="acr-deal-col acr-deal-ask acr-tabnum">{fmtK(d.askingK * 1000)}</div>
                      <div className="acr-deal-col"><Pill tone={scoreTone}><I.sparkle size={10}/>{d.atlasScore}</Pill></div>
                      <div className="acr-deal-col acr-deal-stage">{d.stage}</div>
                      <div className="acr-deal-col acr-deal-touch"><I.clock size={11}/><span>{d.lastTouchH}h</span></div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </SectionTitle>
        </div>

        {/* RIGHT: one merged timeline */}
        <div className="cc-b-rail">
          <SectionTitle
            eyebrow="Today + recent"
            title="Timeline"
            action={<Button variant="ghost" size="sm" iconRight="arrow">Full log</Button>}
          >
            <Card padded={false}>
              <MergedTimeline />
            </Card>
          </SectionTitle>

          <SectionTitle title="Pipeline value · 30d" action={<Pill tone="pos" dot>+12.4%</Pill>}>
            <Card>
              <div className="acr-chart-hero">
                <div>
                  <div className="acr-metric-label">Today</div>
                  <div className="acr-chart-hero-value acr-tabnum">{fmtK(METRICS.pipelineValue)}</div>
                </div>
              </div>
              <div style={{ marginTop: 8 }}><Sparkline data={SPARK} height={64} /></div>
            </Card>
          </SectionTitle>
        </div>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────
// B5 · Parcel Detail — AIOutput hero, provenance, owner context
// ──────────────────────────────────────────────────────────

const ParcelDetailB = () => {
  const d = DEALS[2]; // Pritchard, Luna NM
  return (
    <div className="pg">
      {/* Header */}
      <div className="parcel-hd">
        <div>
          <div className="acr-eyebrow">Parcel · {d.parcel}</div>
          <h1 className="pg-title">{d.acres} acres · {d.county}</h1>
          <div className="parcel-sub">Owner <b>{d.owner}</b> · Asking {fmtK(d.askingK * 1000)} · Stage: {d.stage}</div>
        </div>
        <div className="pg-actions">
          <Button icon="phone">Call</Button>
          <Button icon="mail">Message</Button>
          <Button variant="primary" icon="plus">Draft offer</Button>
        </div>
      </div>

      {/* AIOutput hero — Atlas recommendation as the primary answer */}
      <AIOutput
        agent="atlas"
        shape="hero"
        confidence="high"
        confidenceDetail="4 comps · 8mi · 180d"
        headline="Offer $11,500 · expect counter at $13,800"
        body="Comp-based value is $18,200 (range $16,400–$21,800). A 63% opening offer is standard in this market. Owner replied within 48h last time; seller-finance option adds 6–8% to acceptance probability."
        inputs={[
          { label: 'Comp median',   value: '$1,830/ac · 4 sales' },
          { label: 'Value range',   value: '$16.4K – $21.8K' },
          { label: 'Market',        value: 'Luna NM · active, 3 mo absorption' },
          { label: 'Owner profile', value: 'Absentee · 3 parcels · prior reply <48h' },
          { label: 'Title',         value: 'Clean · last checked Oct 18' },
        ]}
        grounding={[
          { label: '4 comp sales' },
          { label: 'DataTree owner record' },
          { label: 'FEMA flood map · Zone X' },
          { label: 'Prior Pritchard thread' },
        ]}
        autonomy={{ level: 2, willAutoSend: false }}
        timestamp="refreshed 4m ago"
        actions={[
          { label: 'See full analysis', variant: 'subtle', onClick: () => window.__nav && window.__nav('atlas-run') },
          {
            label: 'Draft offer at $11,500',
            icon: 'plus',
            confirm: {
              title: 'Draft offer — review before sending?',
              detail: 'Creates a draft offer. You review and send. Nothing is sent yet.',
              cta: 'Draft',
            },
          },
        ]}
      />

      <div className="parcel-grid">
        <div className="parcel-main">
          {/* Map */}
          <Card padded={false} className="parcel-map">
            <div className="map-canvas">
              <svg viewBox="0 0 800 320" className="map-svg">
                <rect width="800" height="320" fill="var(--surface-2)" />
                {Array.from({ length: 8 }).map((_, i) => (
                  <path key={i} d={`M0 ${40+i*38} Q 300 ${30+i*38}, 500 ${45+i*38} T 800 ${40+i*38}`} stroke="var(--line-soft)" fill="none" />
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

          {/* Comps */}
          <SectionTitle
            eyebrow="Comparables · 180d"
            title="4 recent sales within 8 miles"
            action={<Button size="sm">Expand radius</Button>}
          >
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
                    <tr key={i} className="tbl-row"><td>{r[0]}</td><td className="mono">{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td>
                      <td className="num">{fmtK(r[4])}</td><td className="num">${r[5]}</td><td>{r[6]}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </SectionTitle>

          {/* Provenance — how we know what we know */}
          <SectionTitle
            eyebrow="Provenance"
            title="Where this data came from"
            action={<Pill tone="pos" dot>All fresh</Pill>}
          >
            <Card padded={false}>
              <div className="prov">
                {[
                  ['Parcel boundary', 'DataTree',   '4h ago',  'pos'],
                  ['Owner mailing',   'DataTree',   '4h ago',  'pos'],
                  ['Comp sales',      'LandVision · county recorder', '1d ago', 'pos'],
                  ['FEMA flood zone', 'FEMA NFHL',  '14d ago', 'pos'],
                  ['Tax assessment',  'Luna County · assessor',       '2d ago', 'pos'],
                  ['Owner phone',     'Skip trace · Whitepages',      '3d ago', 'warn'],
                  ['Prior contact',   'Internal · threads',           'live',   'pos'],
                ].map((r, i) => (
                  <div key={i} className="prov-row">
                    <div className="prov-field">{r[0]}</div>
                    <div className="prov-src">{r[1]}</div>
                    <div className="prov-age acr-tabnum">{r[2]}</div>
                    <Pill tone={r[3]} dot>{r[3] === 'pos' ? 'fresh' : 'verify'}</Pill>
                  </div>
                ))}
              </div>
            </Card>
          </SectionTitle>
        </div>

        {/* SIDE: Owner context */}
        <aside className="parcel-side">
          {/* Owner — deeply contextual */}
          <Card>
            <div className="acr-eyebrow">Owner</div>
            <div className="owner-name">{d.owner}</div>
            <div className="owner-meta">Absentee · owns 3 parcels across Luna & Doña Ana</div>

            <div className="own-ctx">
              <div className="own-stat"><div className="own-stat-v">3</div><div className="own-stat-l">parcels</div></div>
              <div className="own-stat"><div className="own-stat-v">2019</div><div className="own-stat-l">absentee since</div></div>
              <div className="own-stat"><div className="own-stat-v">42h</div><div className="own-stat-l">avg reply</div></div>
            </div>

            <div className="own-row"><I.phone size={13}/>(575) 555-0142 <Pill tone="pos" dot>Verified</Pill></div>
            <div className="own-row"><I.mail size={13}/>jspritchard@…</div>
            <div className="own-row"><I.house size={13}/>12402 Cobblestone, Albuquerque NM</div>

            <div className="own-threads">
              <div className="acr-eyebrow" style={{ marginTop: 14 }}>Prior threads · 2</div>
              <div className="own-thread">
                <div className="own-thread-hd"><Pill>SMS</Pill><span>Nov 04 · reply in 38h</span></div>
                <div className="own-thread-sub">"Price is too low, can we do $15K?"</div>
              </div>
              <div className="own-thread">
                <div className="own-thread-hd"><Pill>Mail</Pill><span>Oct 12 · no reply</span></div>
                <div className="own-thread-sub">Yellow-letter · Campaign LUN-02</div>
              </div>
            </div>
          </Card>

          {/* Facts */}
          <Card>
            <div className="acr-eyebrow">Facts</div>
            <dl className="facts">
              <dt>APN</dt><dd className="mono">{d.parcel}</dd>
              <dt>Zoning</dt><dd>Rural-residential</dd>
              <dt>Road access</dt><dd>Dirt · county</dd>
              <dt>Power</dt><dd>Pole 0.3mi</dd>
              <dt>Water</dt><dd>Well required</dd>
              <dt>Annual tax</dt><dd>$84</dd>
              <dt>FEMA flood</dt><dd>Zone X</dd>
              <dt>Slope</dt><dd>4% avg</dd>
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────
// B6 · Inbox — quote-and-reply, autonomy badges, mobile split
// ──────────────────────────────────────────────────────────

const InboxB = () => {
  const [sel, setSel] = useBS(INBOX[0].id);
  const [filter, setFilter] = useBS('all');
  const [view, setView] = useBS('list');
  const vp = useViewport();
  const [draftEdit, setDraftEdit] = useBS(false);
  const [draftText, setDraftText] = useBS(null);  // null = use default; string = regenerated

  const msgs = filter === 'all' ? INBOX : INBOX.filter(m => m.channel === filter);
  const selMsg = INBOX.find(m => m.id === sel) || INBOX[0];

  // On mobile, clicking list item switches to message view
  const onSelect = (id) => { setSel(id); if (vp.mobile) setView('msg'); };

  return (
    <div className="inbox" data-view={view}>
      {/* LIST */}
      <div className="inbox-left">
        <div className="inbox-tabs">
          {['all','email','sms','mail'].map(f => {
            const unread = f === 'all'
              ? INBOX.filter(m => m.unread).length
              : INBOX.filter(m => m.channel === f && m.unread).length;
            return (
              <button key={f} className={cx('inbox-tab', filter === f && 'inbox-tab-on')} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : f.toUpperCase()}
                {unread > 0 && <span className="inbox-badge">{unread}</span>}
              </button>
            );
          })}
        </div>

        {msgs.length === 0 ? (
          <div style={{ padding: 40 }}>
            <EmptyState
              icon="inbox"
              title="Inbox is clear."
              body="Nothing needs a reply right now. New messages from email, SMS, and mail scan land here."
              actions={[{ label: 'Compose', icon: 'plus' }]}
            />
          </div>
        ) : (
          <div className="inbox-list">
            {msgs.map(m => (
              <button key={m.id} className={cx('inbox-item', sel === m.id && 'inbox-item-on', m.unread && 'inbox-unread')} onClick={() => onSelect(m.id)}>
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
        )}
      </div>

      {/* MESSAGE */}
      <div className="inbox-right">
        {vp.mobile && (
          <button className="inbox-back" onClick={() => setView('list')}>
            <I.chevLt size={14}/> Back to inbox
          </button>
        )}

        <div className="inbox-msg-hd">
          <div>
            <div className="acr-eyebrow">{selMsg.channel.toUpperCase()} from {selMsg.from} · {selMsg.time}</div>
            <h2 className="inbox-msg-subj">{selMsg.subj || '(no subject)'}</h2>
          </div>
          <div className="pg-actions">
            {selMsg.dealId && (
              <Button size="sm" icon="arrow" variant="subtle" onClick={() => window.__nav && window.__nav('parcels')}>
                Open {selMsg.dealId}
              </Button>
            )}
            <Button size="sm" icon="folder">Move</Button>
          </div>
        </div>

        <div className="inbox-body">
          <p>{selMsg.preview}</p>
          <p>If the timeline works, I can call my grandson to look at the property this weekend. Otherwise send what you have over.</p>
          <p>— {selMsg.from}</p>
        </div>

        {/* Quote-and-reply with Pax draft */}
        <div className="reply">
          <div className="reply-quote">
            <span className="reply-quote-bar" />
            <div className="reply-quote-body">
              <div className="reply-quote-meta">On {selMsg.time}, {selMsg.from} wrote</div>
              <div className="reply-quote-text">{selMsg.preview}</div>
            </div>
          </div>

          <AIOutput
            agent="pax"
            shape="card"
            confidence="medium"
            confidenceDetail="counter within market band"
            headline={copy.drafted('Pax', 'a reply')}
            autonomy={{ level: 2, willAutoSend: false }}
            timestamp="12s"
            inputs={[
              { label: 'Your last position', value: '$11,500 · 24mo SF' },
              { label: 'Their counter',      value: '$15,000' },
              { label: 'Meet-in-middle',     value: '$13,800 · +6% APR' },
            ]}
            grounding={[
              { label: 'Prior thread · Nov 04' },
              { label: 'Offer playbook · SF' },
            ]}
            actions={[
              { label: 'Edit', variant: 'ghost', onClick: () => setDraftEdit(v => !v) },
              { label: 'Regenerate', icon: 'wand', variant: 'subtle', onClick: () => {
                const name = selMsg.from.split(' ')[0];
                setDraftText(window.nextRegenDraft ? window.nextRegenDraft(name) : null);
              }},
              {
                label: 'Send reply',
                icon: 'arrow',
                confirm: {
                  title: `Send this reply to ${selMsg.from}?`,
                  detail: `Goes via ${selMsg.channel.toUpperCase()} from your relay. They'll see it as from you.`,
                  cta: 'Send',
                },
              },
            ]}
          >
            {draftEdit ? (
              <textarea
                className="reply-textarea"
                defaultValue={draftText || `Thanks for the counter, ${selMsg.from.split(' ')[0]}. We can meet in the middle at $13,800 with 24-month terms, 12% APR, $500/mo. I'll send paperwork today if that works — or let me know what changes would help.`}
              />
            ) : draftText ? (
              <div className="reply-draft" key={draftText}>{draftText}</div>
            ) : (
              <div className="reply-draft">
                Thanks for the counter, <b>{selMsg.from.split(' ')[0]}</b>. We can meet in the middle at <b>$13,800</b> with <b>24-month terms, 12% APR, $500/mo</b>. I'll send paperwork today if that works — or let me know what changes would help.
              </div>
            )}
          </AIOutput>
        </div>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────
// B8 · Founder — density shift + kill-switch safety
// (Rewrite FounderHome with a compact density + confirm-heavy kill switches)
// ──────────────────────────────────────────────────────────

const FounderHomeB = ({ onNav }) => {
  const M = FOUNDER_METRICS;
  return (
    <div className="pg founder-pg">
      <div className="founder-hero">
        <div>
          <div className="acr-eyebrow" style={{ color: 'var(--brand)' }}>⌁ Founder · ops-only</div>
          <h1 className="founder-title">Good afternoon, Thomas.</h1>
          <p className="founder-sub">
            <b>{M.activeTenants}</b> tenants · <b>{fmtK(M.mrr)}/mo</b> MRR · <b>{(M.grossMargin * 100).toFixed(1)}%</b> gross margin.
            <br/>
            Three things need you today.
          </p>
        </div>
        <div className="pg-actions">
          <Button icon="sparkle" variant="subtle">Ask Atlas-F</Button>
          <Button icon="shield" variant="primary">Ops log</Button>
        </div>
      </div>

      {/* Metrics — tighter, data-dense */}
      <div className="founder-metrics founder-metrics-dense">
        <Card className="fm-card fm-primary">
          <div className="acr-eyebrow">MRR</div>
          <div className="fm-val">{fmtK(M.mrr)}</div>
          <div className="fm-delta fm-delta-pos">↑ {M.mrrDelta}% mo/mo</div>
          <div className="fm-spark"><Sparkline data={FOUNDER_SPARK_MRR} height={40}/></div>
        </Card>
        <Card className="fm-card"><div className="acr-eyebrow">ARR</div><div className="fm-val">{fmtK(M.arr)}</div><div className="fm-delta fm-delta-pos">↑ {M.arrDelta}%</div></Card>
        <Card className="fm-card"><div className="acr-eyebrow">Tenants</div><div className="fm-val">{M.activeTenants}</div><div className="fm-delta fm-delta-pos">+{M.tenantsDelta}</div></Card>
        <Card className="fm-card"><div className="acr-eyebrow">Margin</div><div className="fm-val">{(M.grossMargin * 100).toFixed(1)}%</div><div className="fm-delta fm-delta-neg">{(M.grossMarginDelta * 100).toFixed(1)}pp</div></Card>
        <Card className="fm-card"><div className="acr-eyebrow">Agent spend 30d</div><div className="fm-val">{fmtK(M.agentCost30d)}</div><div className="fm-delta fm-delta-neg">↑ {M.agentCost30dDelta}%</div></Card>
        <Card className="fm-card"><div className="acr-eyebrow">Trials</div><div className="fm-val">{M.trials}</div><div className="fm-delta fm-delta-pos">+{M.trialsDelta}</div></Card>
      </div>

      <div className="founder-grid">
        <div className="founder-col">
          <SectionTitle eyebrow="Needs you" title="Three things today" action={<Button size="sm">All alerts</Button>}>
            <div className="fa-list">
              {FOUNDER_ALERTS.map(a => (
                <Card key={a.id} className={cx('fa-card', `fa-${a.tone}`)}>
                  <div className="fa-hd">
                    <Pill tone={a.tone}>{a.kind}</Pill>
                    <span className="muted" style={{ fontSize: 11 }}>Just now</span>
                  </div>
                  <div className="fa-title">{a.title}</div>
                  <div className="fa-body">{a.body}</div>
                  <div className="pg-actions" style={{ marginTop: 10 }}>
                    <Button size="sm" variant="subtle">Dismiss</Button>
                    <Button size="sm" variant="primary">Take action</Button>
                  </div>
                </Card>
              ))}
            </div>
          </SectionTitle>

          <SectionTitle eyebrow="Tenants" title="Top accounts by MRR" action={<Button size="sm" onClick={() => onNav('founder-tenants')}>All tenants</Button>}>
            <Card padded={false}>
              <table className="tbl tbl-dense">
                <thead><tr><th>Tenant</th><th>Plan</th><th>Owner</th><th className="num">MRR</th><th>Seats</th><th>Health</th><th>Last active</th></tr></thead>
                <tbody>
                  {FOUNDER_TENANTS.map(t => (
                    <tr key={t.id} className="tbl-row">
                      <td><b>{t.name}</b><div className="mono muted" style={{ fontSize: 11, marginTop: 2 }}>{t.id}</div></td>
                      <td><Pill tone={t.plan === 'Scale' ? 'brand' : 'neutral'}>{t.plan}</Pill></td>
                      <td>{t.owner}</td>
                      <td className="num">${t.mrr}</td>
                      <td className="num">{t.seats}</td>
                      <td><span className={cx('score', t.health >= 90 && 'score-hi', t.health >= 75 && t.health < 90 && 'score-mid', t.health < 75 && 'score-low')}>{t.health}</span></td>
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
            <div style={{ marginTop: 10 }}>
              {FOUNDER_AGENT_COSTS.map(c => (
                <div key={c.agent} className="ae-row">
                  <div className="ae-agent"><Pill tone="brand">{c.agent}</Pill></div>
                  <div className="ae-runs">{c.runs.toLocaleString()} runs</div>
                  <div className="ae-cost">${c.cost.toLocaleString()}</div>
                  <div className="ae-trend muted">{c.trend}</div>
                </div>
              ))}
            </div>
            <div className="ae-total">Total <b>{fmtK(M.agentCost30d)}</b> · <span style={{ color: 'var(--neg)' }}>+{M.agentCost30dDelta}%</span></div>
            <Button size="sm" variant="subtle" onClick={() => onNav('founder-cost')}>Drill into unit economics →</Button>
          </Card>

          <Card>
            <div className="acr-eyebrow">System health</div>
            <div className="health-list">
              {[
                ['API p50','74ms','pos'],['API p99','412ms','pos'],
                ['Pax run avg','8.4s','pos'],['Atlas queue','28','warn'],
                ['Error 24h','0.14%','pos'],['Active incidents','0','pos'],
              ].map((h,i)=>(
                <div key={i} className="health-row">
                  <span className="muted">{h[0]}</span>
                  <span className={cx('health-val', h[2]==='pos'&&'health-pos', h[2]==='warn'&&'health-warn')}>{h[1]}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Kill switches — real safety surface with typed confirmation */}
          <Card className="kill-card">
            <div className="acr-eyebrow" style={{ color: 'var(--neg)' }}>⎈ Kill switches</div>
            <div className="kill-hint">Stop agents globally or per-tenant. All running work holds; nothing is deleted.</div>
            <div className="kill-list">
              <div className="kill-row">
                <div><b>Pause all AI agents</b><div className="kill-sub">Atlas, Pax, Sophie across all tenants</div></div>
                <ConfirmAction
                  label="Pause"
                  variant="secondary"
                  icon="pause"
                  title="Pause all AI agents globally?"
                  detail="Every tenant's agents stop. In-flight work holds. You can resume in one click."
                  cta="Pause all"
                  typeWord="PAUSE"
                  onConfirm={() => {}}
                />
              </div>
              <div className="kill-row">
                <div><b>Disable outbound mail</b><div className="kill-sub">No campaigns send. Inbound still receives.</div></div>
                <ConfirmAction
                  label="Disable"
                  variant="secondary"
                  icon="mail"
                  title="Disable all outbound mail?"
                  detail="Stops 23 scheduled sends across 8 campaigns. Inbound replies still route normally."
                  cta="Disable"
                  typeWord="DISABLE"
                  onConfirm={() => {}}
                />
              </div>
              <div className="kill-row kill-row-danger">
                <div><b>Emergency stop</b><div className="kill-sub">Full platform freeze. Reverses in &lt;30s.</div></div>
                <ConfirmAction
                  label="Stop"
                  variant="secondary"
                  icon="shield"
                  title="Emergency stop the platform?"
                  detail="All agents pause. All outbound channels disabled. Dashboard stays live. No data is lost. You can reverse this in one click."
                  cta="Emergency stop"
                  typeWord="STOP"
                  onConfirm={() => {}}
                />
              </div>
            </div>
          </Card>

          <Card className="founder-nps">
            <div className="acr-eyebrow">NPS (30d)</div>
            <div className="nps-big">{M.nps}</div>
            <div className="muted" style={{ fontSize: 12 }}>+{M.npsDelta} vs last month · 84 responses</div>
          </Card>
        </aside>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────
// CSS
// ──────────────────────────────────────────────────────────
const TIER_B_CSS = `
  /* ---- B7 Command Center ---- */
  .cc-b { display: flex; flex-direction: column; gap: 24px; }
  .cc-b-hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-top: 4px; }
  .cc-b-greeting {
    font: 600 32px/1.15 var(--font-display); letter-spacing: -0.03em; color: var(--ink);
    margin: 4px 0 0; text-wrap: pretty; max-width: 720px;
  }
  .cc-b-greeting-soft { color: var(--ink-3); font-weight: 500; }
  .cc-b-hero-actions { display: flex; gap: 8px; align-items: center; }

  .cc-b-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 24px; align-items: flex-start; }
  .cc-b-main, .cc-b-rail { display: flex; flex-direction: column; gap: 24px; }
  @media (max-width: 1180px) { .cc-b-grid { grid-template-columns: 1fr; } }

  .cc-b-sugg { display: flex; flex-direction: column; gap: 10px; }

  /* Executor promoted */
  .exec-card {
    padding: 0;
    background: linear-gradient(180deg,
      color-mix(in srgb, var(--pos) 5%, var(--surface)),
      var(--surface));
    border-color: color-mix(in srgb, var(--pos) 24%, var(--line));
  }
  .exec-paused {
    background: linear-gradient(180deg,
      color-mix(in srgb, var(--warn) 7%, var(--surface)),
      var(--surface));
    border-color: color-mix(in srgb, var(--warn) 28%, var(--line));
  }
  .exec-hd {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px; border-bottom: 0.5px solid var(--line-soft);
  }
  .exec-title {
    display: inline-flex; align-items: center; gap: 10px;
    font: 600 14px/1 var(--font-sans); color: var(--ink); letter-spacing: -0.005em;
  }
  .exec-dot { width: 8px; height: 8px; border-radius: 50%; }
  .exec-dot-on {
    background: var(--pos);
    box-shadow: 0 0 0 3px var(--pos-soft);
    animation: exec-pulse 2.4s ease-in-out infinite;
  }
  .exec-dot-off { background: var(--warn); box-shadow: 0 0 0 3px var(--warn-soft); }
  @keyframes exec-pulse {
    0%,100% { box-shadow: 0 0 0 3px var(--pos-soft); }
    50%     { box-shadow: 0 0 0 6px color-mix(in srgb, var(--pos) 10%, transparent); }
  }
  .exec-actions { display: flex; gap: 6px; align-items: center; }

  .exec-grid { display: grid; grid-template-columns: repeat(4, 1fr); }
  .exec-cell { padding: 14px 20px; border-right: 0.5px solid var(--line-soft); }
  .exec-cell:last-child { border-right: 0; }
  .exec-cell-val { font: 600 20px/1 var(--font-display); letter-spacing: -0.015em; color: var(--ink); }
  .exec-cell-lbl { font: 500 11px/1 var(--font-sans); color: var(--ink-3); letter-spacing: 0.03em; margin-top: 6px; }

  /* Merged timeline */
  .tl { padding: 4px 0; }
  .tl-row { display: grid; grid-template-columns: 28px 1fr; gap: 0; padding: 10px 14px 10px 0; }
  .tl-rail { display: flex; flex-direction: column; align-items: center; padding-top: 4px; position: relative; }
  .tl-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--ink-3); flex-shrink: 0;
    border: 2px solid var(--surface);
    box-shadow: 0 0 0 1px var(--line);
  }
  .tl-activity .tl-dot { background: var(--accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 40%, var(--line)); }
  .tl-task .tl-dot { background: var(--brand); box-shadow: 0 0 0 1px color-mix(in srgb, var(--brand) 40%, var(--line)); }
  .tl-line { width: 1px; flex: 1; background: var(--line-soft); margin-top: 4px; min-height: 16px; }
  .tl-body { min-width: 0; padding-left: 6px; }
  .tl-title { font: 500 13px/1.4 var(--font-sans); color: var(--ink); letter-spacing: -0.005em; text-wrap: pretty; }
  .tl-activity-title { color: var(--ink-2); }
  .tl-who { font-weight: 600; color: var(--ink); }
  .tl-meta { display: flex; gap: 6px; align-items: center; margin-top: 5px; flex-wrap: wrap;
    font: 500 11px/1 var(--font-sans); color: var(--ink-3); }
  .tl-sep { color: var(--ink-3); }

  /* ---- B5 Parcel ---- */
  .prov { display: flex; flex-direction: column; }
  .prov-row {
    display: grid;
    grid-template-columns: 1.2fr 1.4fr auto auto;
    gap: 16px; align-items: center;
    padding: 10px 14px; border-bottom: 0.5px solid var(--line-soft);
    font-size: 12.5px;
  }
  .prov-row:last-child { border-bottom: 0; }
  .prov-field { color: var(--ink); font-weight: 500; }
  .prov-src { color: var(--ink-2); }
  .prov-age { color: var(--ink-3); text-align: right; }

  .own-ctx {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
    margin: 14px 0;
    padding: 10px 0; border-top: 0.5px solid var(--line-soft); border-bottom: 0.5px solid var(--line-soft);
  }
  .own-stat { text-align: left; }
  .own-stat-v { font: 600 16px/1 var(--font-display); color: var(--ink); letter-spacing: -0.01em; }
  .own-stat-l { font: 500 10.5px/1 var(--font-sans); color: var(--ink-3); letter-spacing: 0.04em; text-transform: uppercase; margin-top: 4px; }
  .own-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 12.5px; color: var(--ink-2); }

  .own-threads { margin-top: 10px; }
  .own-thread { padding: 8px 10px; background: var(--surface-2); border-radius: 8px; margin-top: 6px; }
  .own-thread-hd { display: flex; justify-content: space-between; font-size: 11px; color: var(--ink-3); align-items: center; }
  .own-thread-sub { font-size: 12.5px; color: var(--ink-2); margin-top: 4px; line-height: 1.45; }

  /* ---- B6 Inbox ---- */
  .inbox-back {
    display: none;
    align-items: center; gap: 6px;
    background: transparent; border: 0; padding: 10px 14px;
    color: var(--ink-2); font: 500 12.5px/1 var(--font-sans);
    border-bottom: 0.5px solid var(--line);
    cursor: pointer;
  }
  .inbox-back:hover { color: var(--ink); }
  @media (max-width: 767px) { .inbox-back { display: inline-flex; } }

  .reply {
    padding: 0 20px 20px;
    display: flex; flex-direction: column; gap: 12px;
    border-top: 0.5px solid var(--line);
    padding-top: 16px;
    margin-top: 8px;
  }
  .reply-quote { display: flex; gap: 10px; padding: 10px 12px; background: var(--surface-2); border-radius: 8px; }
  .reply-quote-bar { width: 2px; background: var(--ink-4); border-radius: 1px; flex-shrink: 0; }
  .reply-quote-body { flex: 1; min-width: 0; }
  .reply-quote-meta { font: 500 11px/1 var(--font-sans); color: var(--ink-3); margin-bottom: 4px; }
  .reply-quote-text { font-size: 12.5px; color: var(--ink-3); line-height: 1.5; text-wrap: pretty; }
  .reply-draft { font: 400 13.5px/1.55 var(--font-sans); color: var(--ink); background: var(--surface-2); padding: 12px 14px; border-radius: 8px; text-wrap: pretty; animation: reply-fade .25s ease; }
  @keyframes reply-fade { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
  .reply-draft b { font-weight: 600; color: var(--ink); }
  .reply-textarea {
    width: 100%; min-height: 120px; resize: vertical;
    font: 400 13.5px/1.55 var(--font-sans); color: var(--ink);
    background: var(--surface); border: 0.5px solid var(--line);
    border-radius: 8px; padding: 10px 12px;
  }
  .reply-textarea:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--brand); }

  /* ---- B8 Founder ---- */
  .tbl-dense th { padding: 9px 14px; font-size: 10.5px; }
  .tbl-dense td { padding: 8px 14px; font-size: 12.5px; }

  .founder-metrics-dense { grid-template-columns: 1.4fr repeat(5, 1fr); }
  .founder-metrics-dense .fm-card { padding: 14px; }
  .founder-metrics-dense .fm-val { font-size: 24px; margin: 4px 0 2px; }
  .founder-metrics-dense .fm-primary .fm-val { font-size: 30px; }
  @media (max-width: 1180px) { .founder-metrics-dense { grid-template-columns: repeat(3, 1fr); } }

  .kill-card {
    background: linear-gradient(180deg,
      color-mix(in srgb, var(--neg) 4%, var(--surface)),
      var(--surface));
    border-color: color-mix(in srgb, var(--neg) 18%, var(--line));
  }
  .kill-hint { font-size: 12px; color: var(--ink-3); margin: 6px 0 10px; line-height: 1.5; text-wrap: pretty; }
  .kill-list { display: flex; flex-direction: column; gap: 8px; }
  .kill-row {
    display: flex; justify-content: space-between; gap: 10px; align-items: center;
    padding: 10px 0; border-top: 0.5px solid var(--line-soft);
    font-size: 12.5px;
  }
  .kill-row b { font: 600 13px/1.3 var(--font-sans); color: var(--ink); }
  .kill-sub { font-size: 11.5px; color: var(--ink-3); margin-top: 2px; text-wrap: pretty; }
  .kill-row-danger b { color: var(--neg); }
`;

// Expose upgraded components under the new names so app.jsx can opt in.
Object.assign(window, {
  CommandCenterB,
  ParcelDetailB,
  InboxB,
  FounderHomeB,
  TIER_B_CSS,
});
